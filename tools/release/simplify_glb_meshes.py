"""Lower the triangle count of the models in a bundle's COPY of assets/models (Android's low tier).

  python3 tools/release/simplify_glb_meshes.py <copy-of-assets>/models

A Pixel 4a (Adreno 618) spends most of a frame on geometry: a creature is 60k skinned triangles
drawn twice (depth prepass and main pass), a crate 24k, a piece of the house's furniture 16-24k
(SH-069 measurements, 2026-11-15). meshoptimizer's gltfpack simplifies each model in place:

  creatures and the Trooper   30 % of the triangles (skeleton, joint order and clip order are
                              kept, so the clip indices and `Root` as joint 0 still hold)
  weapons                     50 % (seen close, in the hand)
  props                       down to ~6000 triangles
  trees, terrain              untouched (leaf cards do not survive simplification; the terrain
                              is a heightfield the physics and the shaders read as authored)

Animation is left exactly as authored: for a skinned model only the simplified MESH (its vertex
and index data) is taken from gltfpack and written into the original file, whose skin, clips and
nodes are kept byte for byte. gltfpack's own animation output broke the Trooper twice (dropped
constant tracks, so `Root` posed at identity and he stood on his head; with -ac, one-key tracks the
engine does not draw at all). Simplification keeps UV seams (no -sa: aggressive mode tears the texture layout). Run it BEFORE
shrink_glb_textures.py and the ASTC step. Always point it at a copy: it rewrites files in place.
"""
import json, struct, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GLTFPACK = ["npx", "--yes", "gltfpack@1.3.0"]
PROP_TARGET = 6000


def triangles(path):
    d = path.read_bytes()
    jl = struct.unpack_from("<I", d, 12)[0]
    j = json.loads(d[20:20 + jl])
    return sum(j["accessors"][p["indices"]]["count"] // 3
               for m in j.get("meshes", []) for p in m["primitives"] if "indices" in p)


def ratio_for(name, tris):
    if name.startswith(("prop_tree", "terrain_", "_gizmo")):
        return 1.0
    if name.startswith(("enemy_", "player_")):
        return 0.30
    if name.startswith("weapon_"):
        return 0.50
    return min(1.0, PROP_TARGET / max(tris, 1))


def read_glb(path):
    d = path.read_bytes()
    jl = struct.unpack_from("<I", d, 12)[0]
    j = json.loads(d[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack_from("<I", d, off)[0]
    return j, d[off + 8:off + 8 + bl]


def write_glb(path, j, bin_):
    bin_ = bin_ + b"\0" * (-len(bin_) % 4)
    j["buffers"] = [{"byteLength": len(bin_)}]
    js = json.dumps(j, separators=(",", ":")).encode()
    js = js + b" " * (-len(js) % 4)
    path.write_bytes(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
                     + struct.pack("<II", len(js), 0x4E4F534A) + js
                     + struct.pack("<II", len(bin_), 0x004E4942) + bin_)


def splice_meshes(orig_path, simp_path):
    """The original GLB with each primitive's geometry (attributes + indices) replaced by the
    simplified file's. Everything else (skins, animations, nodes, materials, images) stays."""
    oj, ob = read_glb(orig_path)
    sj, sb = read_glb(simp_path)
    om = [p for m in oj["meshes"] for p in m["primitives"]]
    sm = [p for m in sj["meshes"] for p in m["primitives"]]
    if len(om) != len(sm):
        return False
    out = bytearray(ob)
    def add_accessor(si):
        a = dict(sj["accessors"][si])
        bv = sj["bufferViews"][a["bufferView"]]
        start = bv.get("byteOffset", 0)
        data = sb[start:start + bv["byteLength"]]
        out.extend(b"\0" * (-len(out) % 4))
        nbv = {"buffer": 0, "byteOffset": len(out), "byteLength": len(data)}
        for k in ("byteStride", "target"):
            if k in bv:
                nbv[k] = bv[k]
        out.extend(data)
        oj["bufferViews"].append(nbv)
        a["bufferView"] = len(oj["bufferViews"]) - 1
        oj["accessors"].append(a)
        return len(oj["accessors"]) - 1
    for po, ps in zip(om, sm):
        po["attributes"] = {k: add_accessor(v) for k, v in ps["attributes"].items()}
        if "indices" in ps:
            po["indices"] = add_accessor(ps["indices"])
    write_glb(orig_path, oj, bytes(out))
    return True


def simplify(path, ratio):
    out = path.with_suffix(".simp.glb")
    cmd = GLTFPACK + ["-i", str(path), "-o", str(out), "-si", f"{ratio:.3f}",
                      "-noq", "-kn", "-km", "-ke"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not out.exists():
        print(f"[simplify] {path.name}: gltfpack failed, kept as is\n{r.stderr.strip()}")
        out.unlink(missing_ok=True)
        return
    before, after = triangles(path), triangles(out)
    if read_glb(path)[0].get("skins"):
        ok = splice_meshes(path, out)
        out.unlink(missing_ok=True)
        if not ok:
            print(f"[simplify] {path.name}: primitive layout changed, kept as is")
            return
    else:
        out.replace(path)
    print(f"[simplify] {path.name}: {before} -> {after} triangles")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    models = Path(args[0])
    if models.resolve() == (ROOT / "assets" / "models").resolve():
        sys.exit(f"refusing to rewrite {models}: it is the repository's models folder, not a copy")
    for glb in sorted(models.glob("*.glb")):
        if glb.name.endswith((".astc.glb", ".simp.glb")):
            continue
        r = ratio_for(glb.name, triangles(glb))
        if r < 0.98:
            simplify(glb, r)
