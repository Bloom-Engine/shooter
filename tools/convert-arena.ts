// Generates assets/models/arena.glb — a textured 50×50m hall with floor,
// four walls, and a ceiling. Six textured quads, three unique materials
// (floor tile, wall panel, ceiling panel), UVs tile the texture so the
// surface reads as "industrial hallway" instead of stretched-to-fit.
//
// Source textures are pulled from the Unvanquished tex-tech_src pack and
// downscaled to 512×512 via `sips`.
//
// Run with:  bun tools/convert-arena.ts   (from the shooter repo root)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';

const TEX_MAX = 512;
const TEX_ROOT = 'vendor/unvanquished/pkg/tex-tech_src.dpkdir/textures/shared_tech_src';
const OUT_GLB = 'assets/models/arena.glb';
const CACHE = 'tools/.cache';

// Arena extents (must stay in sync with main.ts debugBoxes / colliders).
const H = 25;      // half-size of floor in X and Z
const WALL_H = 6;  // wall/ceiling height
const TILE_WORLD = 4;  // 1 UV repetition per 4 world-metres

// --- Source textures -------------------------------------------------------

interface MatSrc { key: string; pngPath: string }
const MAT_FLOOR:   MatSrc = { key: 'floor',   pngPath: TEX_ROOT + '/floortile2_d.png' };
const MAT_WALL:    MatSrc = { key: 'wall',    pngPath: TEX_ROOT + '/wall3_d.png' };
const MAT_CEILING: MatSrc = { key: 'ceiling', pngPath: TEX_ROOT + '/ceiling1_d.png' };

// --- Quad helpers ----------------------------------------------------------

interface Quad {
  verts: number[];      // [x,y,z, x,y,z, x,y,z, x,y,z] — 4 corners CCW from outside
  normal: [number, number, number];
  uvTileU: number;      // how many times to repeat across the quad's U axis
  uvTileV: number;
  material: string;     // MatSrc.key
}

// Build a Quad from four CCW corners + normal + uv tiling.
function quad(p0: number[], p1: number[], p2: number[], p3: number[],
              normal: [number, number, number], tileU: number, tileV: number,
              material: string): Quad {
  return {
    verts: [p0[0],p0[1],p0[2], p1[0],p1[1],p1[2], p2[0],p2[1],p2[2], p3[0],p3[1],p3[2]],
    normal, uvTileU: tileU, uvTileV: tileV, material,
  };
}

// floor (y = 0) — CCW from above (+Y up). UV tiles across world XZ.
const q_floor = quad(
  [-H, 0,  H],
  [ H, 0,  H],
  [ H, 0, -H],
  [-H, 0, -H],
  [0, 1, 0], (2 * H) / TILE_WORLD, (2 * H) / TILE_WORLD, 'floor');

// ceiling (y = WALL_H) — CCW from below (so normal points -Y).
const q_ceiling = quad(
  [-H, WALL_H, -H],
  [ H, WALL_H, -H],
  [ H, WALL_H,  H],
  [-H, WALL_H,  H],
  [0, -1, 0], (2 * H) / TILE_WORLD, (2 * H) / TILE_WORLD, 'ceiling');

// Walls — inner face pointing inward, CCW from inside the room.
// North wall (z = -H), normal +Z (points into the room).
const q_wall_n = quad(
  [-H, 0,      -H],
  [-H, WALL_H, -H],
  [ H, WALL_H, -H],
  [ H, 0,      -H],
  [0, 0, 1], (2 * H) / TILE_WORLD, WALL_H / TILE_WORLD, 'wall');
// South wall (z = +H), normal -Z.
const q_wall_s = quad(
  [ H, 0,       H],
  [ H, WALL_H,  H],
  [-H, WALL_H,  H],
  [-H, 0,       H],
  [0, 0, -1], (2 * H) / TILE_WORLD, WALL_H / TILE_WORLD, 'wall');
// East wall (x = +H), normal -X.
const q_wall_e = quad(
  [ H, 0,      -H],
  [ H, WALL_H, -H],
  [ H, WALL_H,  H],
  [ H, 0,       H],
  [-1, 0, 0], (2 * H) / TILE_WORLD, WALL_H / TILE_WORLD, 'wall');
// West wall (x = -H), normal +X.
const q_wall_w = quad(
  [-H, 0,       H],
  [-H, WALL_H,  H],
  [-H, WALL_H, -H],
  [-H, 0,      -H],
  [ 1, 0, 0], (2 * H) / TILE_WORLD, WALL_H / TILE_WORLD, 'wall');

const QUADS = [q_floor, q_ceiling, q_wall_n, q_wall_s, q_wall_e, q_wall_w];

// --- GLB assembly ----------------------------------------------------------
// One primitive per quad. Shared materials = wall/floor/ceiling. UVs are
// (0,0)-(tileU, tileV) across the 4 corners — sampler wrap = REPEAT causes
// tiling.

function align4(n: number): number { return (n + 3) & ~3; }

function resizeTexture(src: string, cachePath: string): Uint8Array {
  mkdirSync(dirname(cachePath), { recursive: true });
  execSync(`sips --resampleHeightWidthMax ${TEX_MAX} "${src}" --out "${cachePath}"`,
           { stdio: 'pipe' });
  return new Uint8Array(readFileSync(cachePath));
}

// Resolve and resize all unique textures.
mkdirSync(CACHE, { recursive: true });
const materials: { key: string; bytes: Uint8Array }[] = [];
for (let i = 0; i < QUADS.length; i++) {
  const q = QUADS[i];
  if (materials.some(m => m.key === q.material)) continue;
  const src = q.material === 'floor' ? MAT_FLOOR.pngPath
           : q.material === 'wall'  ? MAT_WALL.pngPath
           : MAT_CEILING.pngPath;
  if (!existsSync(src)) { console.error('missing texture:', src); process.exit(1); }
  const cache = CACHE + '/arena_' + q.material + '.png';
  materials.push({ key: q.material, bytes: resizeTexture(src, cache) });
  console.log('tex:', q.material, '(' + materials[materials.length - 1].bytes.length, 'bytes)');
}

// Per-quad vertex/index data.
interface QuadBin {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  materialIdx: number;
}
const qb: QuadBin[] = QUADS.map(q => {
  const positions = q.verts.slice();
  const normals: number[] = [];
  for (let i = 0; i < 4; i++) normals.push(q.normal[0], q.normal[1], q.normal[2]);
  const uvs = [0, 0,   q.uvTileU, 0,   q.uvTileU, q.uvTileV,   0, q.uvTileV];
  const indices = [0, 1, 2,  0, 2, 3];
  const materialIdx = materials.findIndex(m => m.key === q.material);
  return { positions, normals, uvs, indices, materialIdx };
});

// Lay out the BIN chunk: per-quad (indices, pos, nrm, uv), then each image.
interface Slot { off: number; len: number }
interface QuadSlots { idx: Slot; pos: Slot; nrm: Slot; uv: Slot }
const slots: QuadSlots[] = [];
let binLen = 0;
for (let i = 0; i < qb.length; i++) {
  const q = qb[i];
  const idxOff = align4(binLen); binLen = idxOff + align4(q.indices.length * 2);
  const posOff = binLen;          binLen = posOff + q.positions.length * 4;
  const nrmOff = binLen;          binLen = nrmOff + q.normals.length * 4;
  const uvOff  = binLen;          binLen = uvOff  + q.uvs.length * 4;
  slots.push({
    idx: { off: idxOff, len: q.indices.length * 2 },
    pos: { off: posOff, len: q.positions.length * 4 },
    nrm: { off: nrmOff, len: q.normals.length * 4 },
    uv:  { off: uvOff,  len: q.uvs.length * 4 },
  });
}
const imgSlots: Slot[] = [];
for (let i = 0; i < materials.length; i++) {
  const off = align4(binLen);
  binLen = off + materials[i].bytes.length;
  imgSlots.push({ off, len: materials[i].bytes.length });
}
binLen = align4(binLen);

const bin = new Uint8Array(binLen);
const dv = new DataView(bin.buffer);
for (let i = 0; i < qb.length; i++) {
  const q = qb[i];
  const s = slots[i];
  for (let k = 0; k < q.indices.length; k++) dv.setUint16(s.idx.off + k * 2, q.indices[k], true);
  for (let k = 0; k < q.positions.length; k++) dv.setFloat32(s.pos.off + k * 4, q.positions[k], true);
  for (let k = 0; k < q.normals.length;   k++) dv.setFloat32(s.nrm.off + k * 4, q.normals[k],   true);
  for (let k = 0; k < q.uvs.length;       k++) dv.setFloat32(s.uv.off  + k * 4, q.uvs[k],       true);
}
for (let i = 0; i < materials.length; i++) bin.set(materials[i].bytes, imgSlots[i].off);

// Build JSON graph.
interface Accessor { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }
interface BV { buffer: number; byteOffset: number; byteLength: number; target?: number }

const bufferViews: BV[] = [];
const accessors: Accessor[] = [];
const primitives: { attributes: Record<string, number>; indices: number; material: number; mode: number }[] = [];

for (let i = 0; i < qb.length; i++) {
  const q = qb[i];
  const s = slots[i];
  const vc = q.positions.length / 3;
  const ic = q.indices.length;

  const bvIdx = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: s.idx.off, byteLength: ic * 2,     target: 34963 });
  const bvPos = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: s.pos.off, byteLength: vc * 3 * 4, target: 34962 });
  const bvNrm = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: s.nrm.off, byteLength: vc * 3 * 4, target: 34962 });
  const bvUv  = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: s.uv.off,  byteLength: vc * 2 * 4, target: 34962 });

  // Position bounds (just for validator politeness).
  const min = [q.positions[0], q.positions[1], q.positions[2]];
  const max = [q.positions[0], q.positions[1], q.positions[2]];
  for (let k = 3; k < q.positions.length; k += 3) {
    if (q.positions[k]   < min[0]) min[0] = q.positions[k];
    if (q.positions[k+1] < min[1]) min[1] = q.positions[k+1];
    if (q.positions[k+2] < min[2]) min[2] = q.positions[k+2];
    if (q.positions[k]   > max[0]) max[0] = q.positions[k];
    if (q.positions[k+1] > max[1]) max[1] = q.positions[k+1];
    if (q.positions[k+2] > max[2]) max[2] = q.positions[k+2];
  }

  const aIdx = accessors.length; accessors.push({ bufferView: bvIdx, componentType: 5123, count: ic, type: 'SCALAR' });
  const aPos = accessors.length; accessors.push({ bufferView: bvPos, componentType: 5126, count: vc, type: 'VEC3', min, max });
  const aNrm = accessors.length; accessors.push({ bufferView: bvNrm, componentType: 5126, count: vc, type: 'VEC3' });
  const aUv  = accessors.length; accessors.push({ bufferView: bvUv,  componentType: 5126, count: vc, type: 'VEC2' });

  primitives.push({
    attributes: { POSITION: aPos, NORMAL: aNrm, TEXCOORD_0: aUv },
    indices: aIdx,
    material: q.materialIdx,
    mode: 4,
  });
}

const imageBv: number[] = [];
for (let i = 0; i < materials.length; i++) {
  const bv = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: imgSlots[i].off, byteLength: imgSlots[i].len });
  imageBv.push(bv);
}

const gltf = {
  asset: { version: '2.0', generator: 'shooter-convert-arena' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes:  [{ mesh: 0, name: 'arena' }],
  meshes: [{ primitives }],
  materials: materials.map((m, i) => ({
    name: m.key,
    pbrMetallicRoughness: {
      baseColorTexture: { index: i },
      metallicFactor: 0.0,
      roughnessFactor: 0.95,
    },
  })),
  textures: materials.map((_, i) => ({ source: i, sampler: 0 })),
  images: materials.map((_, i) => ({ bufferView: imageBv[i], mimeType: 'image/png' })),
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }], // REPEAT
  buffers: [{ byteLength: binLen }],
  bufferViews,
  accessors,
};

const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
const jsonPad = new Uint8Array(align4(jsonBytes.length));
jsonPad.set(jsonBytes);
for (let i = jsonBytes.length; i < jsonPad.length; i++) jsonPad[i] = 0x20;

const totalLen = 12 + 8 + jsonPad.length + 8 + bin.length;
const out = new Uint8Array(totalLen);
const odv = new DataView(out.buffer);
odv.setUint32(0,  0x46546C67, true);
odv.setUint32(4,  2,          true);
odv.setUint32(8,  totalLen,   true);
odv.setUint32(12, jsonPad.length, true);
odv.setUint32(16, 0x4E4F534A, true); // JSON
out.set(jsonPad, 20);
const binOff = 20 + jsonPad.length;
odv.setUint32(binOff,     bin.length,  true);
odv.setUint32(binOff + 4, 0x004E4942,  true); // BIN\0
out.set(bin, binOff + 8);

mkdirSync(dirname(OUT_GLB), { recursive: true });
writeFileSync(OUT_GLB, out);
console.log('wrote', OUT_GLB, '(' + out.length, 'bytes,', materials.length, 'materials,', QUADS.length, 'quads)');
