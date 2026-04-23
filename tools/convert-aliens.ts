// Converter for all 5 Unvanquished alien classes (level0..level4).
//
// Parses each IQE, splits into sub-meshes per material, writes a glTF 2.0
// .glb with one primitive per sub-mesh. Diffuse textures are downscaled
// via macOS `sips` and embedded. Y-up axis swap + triangle rewind are
// applied to convert from Quake's Z-up to glTF's Y-up.
//
// Static T-pose only — skinning, bones, and animation are ignored.
//
// Run with:  bun tools/convert-aliens.ts   (from the shooter repo root)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, dirname } from 'node:path';

const TEX_MAX = 512;
const IQE_ROOT = 'vendor/unvanquished/pkg/res-players_src.dpkdir/models/players';
const OUT_DIR  = 'assets/models';
const CACHE_DIR = 'tools/.cache';

interface AlienSpec {
  name: string;      // output filename stem
  dir: string;       // subdirectory under IQE_ROOT
}

const ALIENS: AlienSpec[] = [
  { name: 'enemy_dretch',   dir: 'level0' },
  { name: 'enemy_mantis',   dir: 'level1' },
  { name: 'enemy_marauder', dir: 'level2' },
  { name: 'enemy_dragoon',  dir: 'level3' },
  { name: 'enemy_tyrant',   dir: 'level4' },
];

// ---- IQE parser -----------------------------------------------------------
// IQE is a line-oriented text format. We care about the static-mesh subset:
//   mesh "<name>"              — start a new sub-mesh
//   material "<path>"          — associate the mesh with a material
//   vp <x> <y> <z>             — vertex position
//   vn <x> <y> <z>             — vertex normal
//   vt <u> <v>                 — vertex UV
//   fm <a> <b> <c>             — triangle, three vertex indices
//
// Positions/normals are rebased to the sub-mesh on each `mesh` boundary.

interface SubMesh {
  name: string;
  material: string;       // e.g. "models/players/level2/level2_body"
  positions: number[];
  normals:   number[];
  uvs:       number[];
  indices:   number[];
}

function parseIqe(text: string): SubMesh[] {
  const subs: SubMesh[] = [];
  let cur: SubMesh | null = null;
  let vpCount = 0;  // sub-mesh-local count for padding vn/vt

  function ensureCurrent(): SubMesh {
    if (!cur) {
      cur = { name: '', material: '', positions: [], normals: [], uvs: [], indices: [] };
      subs.push(cur);
      vpCount = 0;
    }
    return cur;
  }

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.length === 0 || ln.charAt(0) === '#') continue;
    const sp = ln.indexOf(' ');
    if (sp < 0) continue;
    const tag = ln.substring(0, sp);
    const rest = ln.substring(sp + 1).trim();

    if (tag === 'mesh') {
      cur = { name: rest.replace(/^"|"$/g, ''),
              material: '', positions: [], normals: [], uvs: [], indices: [] };
      subs.push(cur);
      vpCount = 0;
    } else if (tag === 'material') {
      ensureCurrent().material = rest.replace(/^"|"$/g, '');
    } else if (tag === 'vp') {
      const m = ensureCurrent();
      const a = rest.split(/\s+/);
      // Y-up swap: (x, y, z) -> (x, z, -y).
      const ox = parseFloat(a[0]), oy = parseFloat(a[1]), oz = parseFloat(a[2]);
      m.positions.push(ox, oz, -oy);
      vpCount++;
    } else if (tag === 'vn') {
      const m = ensureCurrent();
      while (m.normals.length / 3 + 1 < vpCount) m.normals.push(0, 1, 0);
      const a = rest.split(/\s+/);
      const ox = parseFloat(a[0]), oy = parseFloat(a[1]), oz = parseFloat(a[2]);
      m.normals.push(ox, oz, -oy);
    } else if (tag === 'vt') {
      const m = ensureCurrent();
      while (m.uvs.length / 2 + 1 < vpCount) m.uvs.push(0, 0);
      const a = rest.split(/\s+/);
      m.uvs.push(parseFloat(a[0]), 1.0 - parseFloat(a[1]));
    } else if (tag === 'fm') {
      const m = ensureCurrent();
      const a = rest.split(/\s+/);
      // Reverse winding for the mirrored axis flip.
      m.indices.push(parseInt(a[0], 10), parseInt(a[2], 10), parseInt(a[1], 10));
    }
  }

  // Pad any trailing sub-meshes missing vn/vt for the last few verts.
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    const vcount = s.positions.length / 3;
    while (s.normals.length / 3 < vcount) s.normals.push(0, 1, 0);
    while (s.uvs.length / 2    < vcount) s.uvs.push(0, 0);
  }

  // Drop empty placeholders.
  return subs.filter(s => s.positions.length > 0 && s.indices.length > 0);
}

// ---- Texture prep ---------------------------------------------------------

function resolveTexture(iqeDir: string, material: string): string {
  const base = basename(material);            // e.g. "level2_body"
  const candidate = iqeDir + '/' + base + '.png';
  if (existsSync(candidate)) return candidate;
  // Try sibling directory in case material path differs (not expected for res-players).
  throw new Error('texture not found for material ' + material + ' at ' + candidate);
}

function resizeTexture(src: string, cachePath: string): Buffer {
  mkdirSync(dirname(cachePath), { recursive: true });
  execSync(`sips --resampleHeightWidthMax ${TEX_MAX} "${src}" --out "${cachePath}"`,
           { stdio: 'pipe' });
  return readFileSync(cachePath);
}

// ---- GLB writer (multi-primitive) ----------------------------------------
// Binary buffer layout (all 4-byte aligned):
//   per sub-mesh: indices(u16) | positions(f32) | normals(f32) | uvs(f32)
//   per unique material: image bytes
// JSON describes:
//   meshes[0].primitives: one per sub-mesh, each with attributes + material + indices
//   materials[i], textures[i], images[i], samplers[0]: one per unique material
//   accessors + bufferViews wired up to the buffer regions above

function align4(n: number): number { return (n + 3) & ~3; }

interface MatEntry {
  material: string;      // "models/players/level2/level2_body"
  imgBytes: Uint8Array;
}

function computeBounds(positions: number[]): { min: number[]; max: number[] } {
  const min = [+Infinity, +Infinity, +Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i]   < min[0]) min[0] = positions[i];
    if (positions[i+1] < min[1]) min[1] = positions[i+1];
    if (positions[i+2] < min[2]) min[2] = positions[i+2];
    if (positions[i]   > max[0]) max[0] = positions[i];
    if (positions[i+1] > max[1]) max[1] = positions[i+1];
    if (positions[i+2] > max[2]) max[2] = positions[i+2];
  }
  return { min, max };
}

function buildGlb(subs: SubMesh[], mats: MatEntry[]): Uint8Array {
  // Walk sub-meshes once to plan buffer layout + accessors.
  interface SlotRange { off: number; len: number }
  interface SubSlots  { idx: SlotRange; pos: SlotRange; nrm: SlotRange; uv: SlotRange; material: number }

  const slots: SubSlots[] = [];
  let binLen = 0;

  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    const vc = s.positions.length / 3;
    const ic = s.indices.length;
    const idxOff = align4(binLen);   binLen = idxOff + align4(ic * 2);
    const posOff = binLen;            binLen = posOff + vc * 3 * 4;
    const nrmOff = binLen;            binLen = nrmOff + vc * 3 * 4;
    const uvOff  = binLen;            binLen = uvOff  + vc * 2 * 4;
    const matIdx = mats.findIndex(m => m.material === s.material);
    slots.push({
      idx: { off: idxOff, len: ic * 2 },
      pos: { off: posOff, len: vc * 3 * 4 },
      nrm: { off: nrmOff, len: vc * 3 * 4 },
      uv:  { off: uvOff,  len: vc * 2 * 4 },
      material: matIdx,
    });
  }

  const imgRanges: SlotRange[] = [];
  for (let i = 0; i < mats.length; i++) {
    const off = align4(binLen);
    binLen = off + mats[i].imgBytes.length;
    imgRanges.push({ off, len: mats[i].imgBytes.length });
  }
  binLen = align4(binLen);

  const bin = new Uint8Array(binLen);
  const dv  = new DataView(bin.buffer);
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    const sl = slots[i];
    for (let k = 0; k < s.indices.length; k++) dv.setUint16(sl.idx.off + k * 2, s.indices[k], true);
    for (let k = 0; k < s.positions.length; k++) dv.setFloat32(sl.pos.off + k * 4, s.positions[k], true);
    for (let k = 0; k < s.normals.length;   k++) dv.setFloat32(sl.nrm.off + k * 4, s.normals[k],   true);
    for (let k = 0; k < s.uvs.length;       k++) dv.setFloat32(sl.uv.off  + k * 4, s.uvs[k],       true);
  }
  for (let i = 0; i < mats.length; i++) {
    bin.set(mats[i].imgBytes, imgRanges[i].off);
  }

  // Build JSON graph.
  interface Accessor { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }
  interface BufferView { buffer: number; byteOffset: number; byteLength: number; target?: number }
  const bufferViews: BufferView[] = [];
  const accessors: Accessor[] = [];
  const primitives: { attributes: Record<string, number>; indices: number; material: number; mode: number }[] = [];

  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    const sl = slots[i];
    const vc = s.positions.length / 3;
    const ic = s.indices.length;
    const bounds = computeBounds(s.positions);

    const bvIdx = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: sl.idx.off, byteLength: ic * 2,      target: 34963 });
    const bvPos = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: sl.pos.off, byteLength: vc * 3 * 4, target: 34962 });
    const bvNrm = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: sl.nrm.off, byteLength: vc * 3 * 4, target: 34962 });
    const bvUv  = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: sl.uv.off,  byteLength: vc * 2 * 4, target: 34962 });

    const aIdx = accessors.length; accessors.push({ bufferView: bvIdx, componentType: 5123, count: ic, type: 'SCALAR' });
    const aPos = accessors.length; accessors.push({ bufferView: bvPos, componentType: 5126, count: vc, type: 'VEC3', min: bounds.min, max: bounds.max });
    const aNrm = accessors.length; accessors.push({ bufferView: bvNrm, componentType: 5126, count: vc, type: 'VEC3' });
    const aUv  = accessors.length; accessors.push({ bufferView: bvUv,  componentType: 5126, count: vc, type: 'VEC2' });

    primitives.push({
      attributes: { POSITION: aPos, NORMAL: aNrm, TEXCOORD_0: aUv },
      indices: aIdx,
      material: sl.material,
      mode: 4,
    });
  }

  const imageBv: number[] = [];
  for (let i = 0; i < mats.length; i++) {
    const bv = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: imgRanges[i].off, byteLength: imgRanges[i].len });
    imageBv.push(bv);
  }

  const images = mats.map((_, i) => ({ bufferView: imageBv[i], mimeType: 'image/png' }));
  const textures = mats.map((_, i) => ({ source: i, sampler: 0 }));
  const materials = mats.map((m, i) => ({
    name: basename(m.material),
    pbrMetallicRoughness: {
      baseColorTexture: { index: i },
      metallicFactor: 0.0,
      roughnessFactor: 0.9,
    },
  }));

  const gltf = {
    asset: { version: '2.0', generator: 'shooter-convert-aliens' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes:  [{ mesh: 0, name: 'alien' }],
    meshes: [{ primitives }],
    materials, textures, images,
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    buffers: [{ byteLength: binLen }],
    bufferViews,
    accessors,
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadded = new Uint8Array(align4(jsonBytes.length));
  jsonPadded.set(jsonBytes);
  for (let i = jsonBytes.length; i < jsonPadded.length; i++) jsonPadded[i] = 0x20;

  const totalLen = 12 + 8 + jsonPadded.length + 8 + bin.length;
  const out = new Uint8Array(totalLen);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, 0x46546C67, true);
  odv.setUint32(4, 2, true);
  odv.setUint32(8, totalLen, true);
  odv.setUint32(12, jsonPadded.length, true);
  odv.setUint32(16, 0x4E4F534A, true);  // 'JSON'
  out.set(jsonPadded, 20);
  const binChunkOff = 20 + jsonPadded.length;
  odv.setUint32(binChunkOff, bin.length, true);
  odv.setUint32(binChunkOff + 4, 0x004E4942, true); // 'BIN\0'
  out.set(bin, binChunkOff + 8);
  return out;
}

// ---- Main -----------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

for (let i = 0; i < ALIENS.length; i++) {
  const a = ALIENS[i];
  const iqePath = IQE_ROOT + '/' + a.dir + '/' + a.dir + '.iqe';
  if (!existsSync(iqePath)) {
    console.warn('[skip]', a.name, '— not found:', iqePath);
    continue;
  }
  console.log('[' + a.name + ']');
  const text = readFileSync(iqePath, 'utf8');
  const subs = parseIqe(text);
  console.log('  sub-meshes:', subs.length);

  // Resolve + load unique textures per material referenced by the sub-meshes.
  const iqeDir = dirname(iqePath);
  const mats: MatEntry[] = [];
  for (let j = 0; j < subs.length; j++) {
    const m = subs[j].material;
    if (mats.some(x => x.material === m)) continue;
    const texSrc = resolveTexture(iqeDir, m);
    const cachePath = CACHE_DIR + '/' + a.name + '_' + basename(m) + '.png';
    const bytes = resizeTexture(texSrc, cachePath);
    mats.push({ material: m, imgBytes: new Uint8Array(bytes) });
    console.log('  tex:', basename(m) + '.png', '(' + bytes.length + ' bytes)');
  }

  const glb = buildGlb(subs, mats);
  const outPath = OUT_DIR + '/' + a.name + '.glb';
  writeFileSync(outPath, glb);
  console.log('  wrote', outPath, '(' + glb.length + ' bytes)');
}
