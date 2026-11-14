#!/usr/bin/env python3
"""Strip finger, toe-tip and head-tip joints from a rigged GLB (plan 2.6).

    tools/gen/strip_joints.py <in.glb> <out.glb> [--drop REGEX]

The engine has 1024 joint matrices per frame for every skinned draw together, and a creature on
the Mixamo skeleton spends 43 of its 66 on fingers and end bones nobody sees move at fighting
distance. This drops them: a dropped joint's skin weight goes to its nearest kept ancestor (the
hand, the toe base, the head), so those vertices follow that bone rigidly, in their bind pose.
Clip names, clip order, materials and images are untouched; Root stays joint 0.

Plain glTF surgery (json + struct): no Blender, no re-encode of textures. Animation channels for
dropped nodes go, and the buffer is rebuilt from the views still in use, so the file shrinks.
Writes to a temp file and renames, so a failed run never leaves a half-written model.
"""
import json
import os
import re
import struct
import sys

DEFAULT_DROP = r'(Hand(Index|Middle|Pinky|Ring|Thumb)\d|Toe_End|HeadTop_End)$'
COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, _ = struct.unpack('<III', data[:12])
    if magic != 0x46546C67 or version != 2:
        sys.exit(path + ': not a glTF 2 binary')
    off, gltf, blob = 12, None, b''
    while off < len(data):
        n, kind = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8:off + 8 + n]
        if kind == 0x4E4F534A:
            gltf = json.loads(chunk)
        elif kind == 0x004E4942:
            blob = chunk
        off += 8 + n
    return gltf, blob


def write_glb(path, gltf, blob):
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * (-len(js) % 4)
    blob += b'\0' * (-len(blob) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(blob), 0x004E4942) + blob)
    os.replace(tmp, path)


def acc_read(gltf, blob, ai):
    a = gltf['accessors'][ai]
    if 'sparse' in a:
        sys.exit('sparse accessors are not supported')
    bv = gltf['bufferViews'][a['bufferView']]
    fmt, size = COMP[a['componentType']]
    n = NCOMP[a['type']]
    stride = bv.get('byteStride') or size * n
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    out = []
    for i in range(a['count']):
        out.append(struct.unpack_from('<' + fmt * n, blob, base + i * stride))
    return out


def main():
    args = sys.argv[1:]
    pattern = DEFAULT_DROP
    if '--drop' in args:
        i = args.index('--drop')
        pattern = args[i + 1]
        del args[i:i + 2]
    if len(args) != 2:
        sys.exit(__doc__)
    src, dst = args
    gltf, blob = read_glb(src)
    size_in = os.path.getsize(src)
    if len(gltf.get('buffers', [])) != 1:
        sys.exit('expected one binary buffer')
    nodes = gltf['nodes']
    drop_re = re.compile(pattern)

    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i

    joint_nodes = set()
    for sk in gltf.get('skins', []):
        joint_nodes.update(sk['joints'])
    dropped = set(i for i in joint_nodes if drop_re.search(nodes[i].get('name', '')))
    # a dropped joint takes its whole subtree with it, unless something kept hangs below
    for i in list(dropped):
        stack = list(nodes[i].get('children', []))
        while stack:
            c = stack.pop()
            if c in joint_nodes and c not in dropped:
                sys.exit('kept joint %s sits under dropped joint %s'
                         % (nodes[c].get('name'), nodes[i].get('name')))
            if 'mesh' in nodes[c] or 'camera' in nodes[c]:
                sys.exit('a mesh or camera hangs under dropped joint ' + nodes[i].get('name', '?'))
            dropped.add(c)
            stack.extend(nodes[c].get('children', []))
    if not dropped:
        print('%s: nothing to strip' % src)
        if os.path.abspath(src) != os.path.abspath(dst):
            write_glb(dst, gltf, blob)
        return

    def kept_ancestor(n):
        while n in dropped:
            n = parent[n]
        return n

    # accessors that get new data: accessor index -> (bytes, count)
    new_data = {}
    before = after = 0
    for sk in gltf['skins']:
        old = sk['joints']
        keep = [j for j in old if j not in dropped]
        new_index = {n: i for i, n in enumerate(keep)}
        remap = [new_index[kept_ancestor(j)] for j in old]
        before += len(old)
        after += len(keep)
        if 'inverseBindMatrices' in sk:
            ibm = acc_read(gltf, blob, sk['inverseBindMatrices'])
            rows = [ibm[i] for i, j in enumerate(old) if j not in dropped]
            new_data[sk['inverseBindMatrices']] = (
                b''.join(struct.pack('<16f', *m) for m in rows), len(rows))
        sk['_remap'] = remap
        sk['joints'] = keep

    # which skin does each mesh use
    mesh_skin = {}
    for n in nodes:
        if 'mesh' in n and 'skin' in n:
            mesh_skin[n['mesh']] = n['skin']
    done = set()
    for mi, mesh in enumerate(gltf['meshes']):
        if mi not in mesh_skin:
            continue
        remap = gltf['skins'][mesh_skin[mi]]['_remap']
        for prim in mesh['primitives']:
            at = prim['attributes']
            if 'JOINTS_0' not in at:
                continue
            if 'JOINTS_1' in at:
                sys.exit('more than four influences per vertex is not supported')
            ja, wa = at['JOINTS_0'], at['WEIGHTS_0']
            if ja in done:
                continue
            done.add(ja)
            if gltf['accessors'][wa]['componentType'] != 5126:
                sys.exit('WEIGHTS_0 must be float')
            J = acc_read(gltf, blob, ja)
            Wt = acc_read(gltf, blob, wa)
            jf = COMP[gltf['accessors'][ja]['componentType']][0]
            jb, wb = bytearray(), bytearray()
            for js, ws in zip(J, Wt):
                acc = {}
                for j, w in zip(js, ws):
                    if w > 0:
                        nj = remap[j]
                        acc[nj] = acc.get(nj, 0.0) + w
                items = sorted(acc.items(), key=lambda t: -t[1])[:4]
                tot = sum(w for _, w in items)
                if tot <= 0:
                    items, tot = [(remap[js[0]], 1.0)], 1.0
                items = [(j, w / tot) for j, w in items]
                while len(items) < 4:
                    items.append((0, 0.0))
                jb += struct.pack('<4' + jf, *[j for j, _ in items])
                wb += struct.pack('<4f', *[w for _, w in items])
            new_data[ja] = (bytes(jb), len(J))
            new_data[wa] = (bytes(wb), len(J))
    for sk in gltf['skins']:
        del sk['_remap']

    # animations: drop channels on dropped nodes, then the samplers nothing uses
    for anim in gltf.get('animations', []):
        chans = [c for c in anim['channels'] if c['target'].get('node') not in dropped]
        used = sorted(set(c['sampler'] for c in chans))
        ren = {s: i for i, s in enumerate(used)}
        for c in chans:
            c['sampler'] = ren[c['sampler']]
        anim['samplers'] = [anim['samplers'][s] for s in used]
        anim['channels'] = chans

    # nodes: unlink and renumber
    node_new = {}
    for i in range(len(nodes)):
        if i not in dropped:
            node_new[i] = len(node_new)
    kept_nodes = []
    for i, n in enumerate(nodes):
        if i in dropped:
            continue
        if 'children' in n:
            ch = [node_new[c] for c in n['children'] if c not in dropped]
            if ch:
                n['children'] = ch
            else:
                del n['children']
        kept_nodes.append(n)
    gltf['nodes'] = kept_nodes
    for sc in gltf.get('scenes', []):
        sc['nodes'] = [node_new[n] for n in sc['nodes'] if n not in dropped]
    for sk in gltf['skins']:
        sk['joints'] = [node_new[j] for j in sk['joints']]
        if 'skeleton' in sk:
            sk['skeleton'] = node_new[kept_ancestor(sk['skeleton'])]
    for anim in gltf.get('animations', []):
        for c in anim['channels']:
            if 'node' in c['target']:
                c['target']['node'] = node_new[c['target']['node']]

    # accessors still referenced
    used_acc = set()
    for mesh in gltf['meshes']:
        for prim in mesh['primitives']:
            used_acc.update(prim['attributes'].values())
            if 'indices' in prim:
                used_acc.add(prim['indices'])
            for tgt in prim.get('targets', []):
                used_acc.update(tgt.values())
    for sk in gltf['skins']:
        if 'inverseBindMatrices' in sk:
            used_acc.add(sk['inverseBindMatrices'])
    for anim in gltf.get('animations', []):
        for s in anim['samplers']:
            used_acc.add(s['input'])
            used_acc.add(s['output'])
    acc_order = sorted(used_acc)
    acc_new = {a: i for i, a in enumerate(acc_order)}

    # rebuild the buffer: one fresh view per rewritten accessor, the old views for the rest
    out = bytearray()
    views = []
    view_new = {}

    def add_view(payload, proto):
        out.extend(b'\0' * (-len(out) % 4))
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(payload)}
        for k in ('byteStride', 'target', 'name'):
            if proto and k in proto:
                v[k] = proto[k]
        out.extend(payload)
        views.append(v)
        return len(views) - 1

    def old_view(vi):
        if vi not in view_new:
            bv = gltf['bufferViews'][vi]
            o = bv.get('byteOffset', 0)
            view_new[vi] = add_view(blob[o:o + bv['byteLength']], bv)
        return view_new[vi]

    accessors = []
    for ai in acc_order:
        a = gltf['accessors'][ai]
        if ai in new_data:
            payload, count = new_data[ai]
            proto = dict(gltf['bufferViews'][a['bufferView']])
            proto.pop('byteStride', None)
            a['bufferView'] = add_view(payload, proto)
            a['byteOffset'] = 0
            a['count'] = count
            if a['type'] == 'VEC4' and a['componentType'] != 5126:      # JOINTS_0 bounds
                a.pop('min', None)
                a.pop('max', None)
        elif 'bufferView' in a:
            a['bufferView'] = old_view(a['bufferView'])
        accessors.append(a)
    for img in gltf.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = old_view(img['bufferView'])
    gltf['accessors'] = accessors
    gltf['bufferViews'] = views

    for mesh in gltf['meshes']:
        for prim in mesh['primitives']:
            prim['attributes'] = {k: acc_new[v] for k, v in prim['attributes'].items()}
            if 'indices' in prim:
                prim['indices'] = acc_new[prim['indices']]
            if 'targets' in prim:
                prim['targets'] = [{k: acc_new[v] for k, v in t.items()} for t in prim['targets']]
    for sk in gltf['skins']:
        if 'inverseBindMatrices' in sk:
            sk['inverseBindMatrices'] = acc_new[sk['inverseBindMatrices']]
    for anim in gltf.get('animations', []):
        for s in anim['samplers']:
            s['input'] = acc_new[s['input']]
            s['output'] = acc_new[s['output']]

    out.extend(b'\0' * (-len(out) % 4))
    gltf['buffers'][0]['byteLength'] = len(out)
    write_glb(dst, gltf, bytes(out))
    print('%s: joints %d -> %d, %d bytes -> %d' % (
        os.path.basename(dst), before, after, size_in, os.path.getsize(dst)))


if __name__ == '__main__':
    main()
