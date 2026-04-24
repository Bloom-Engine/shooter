// Procedural terrain GLB generator.
//
// Builds assets/models/terrain_hills.glb — a heightmap-driven triangle mesh
// covering 80 × 80 m with procedural hills. Single PBR material (grassy
// green). The generated mesh has per-vertex flat-ish normals computed from
// neighbour heights. The shooter uses this as the world ground; collisions
// are approximated with box colliders per hill (still declared in the world
// file) because Jolt heightfield shapes aren't wired to the FFI yet.
//
// Run with:  bun tools/build-terrain.ts    (from the shooter repo root)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = 'assets/models/terrain_hills.glb';

// Grid parameters. 96 × 96 cells = 9,216 verts, 18,050 tris — well within
// one draw call. At cellSize 0.83 m the mesh spans ~80 × 80 m.
const WIDTH = 96;
const DEPTH = 96;
const CELL = 80 / (WIDTH - 1);
const ORIGIN_X = -40;
const ORIGIN_Z = -40;

// Two axis-aligned "hill" centres plus a long ridge. The plaza itself (a
// ring around the origin with radius 15 m) stays flat so gameplay colliders
// line up with the world file. Values are hand-tuned for something
// believable without going over 3 m tall.
function heightAt(x: number, z: number): number {
  // Distance to origin — suppress height near spawn.
  const r = Math.sqrt(x * x + z * z);
  const plazaBlend = r < 16 ? 0 : Math.min(1, (r - 16) / 8);

  // Two gentle gaussian hills.
  const hill = (cx: number, cz: number, sigma: number, h: number) => {
    const dx = x - cx, dz = z - cz;
    const d = dx * dx + dz * dz;
    return h * Math.exp(-d / (2 * sigma * sigma));
  };
  let h = 0;
  h += hill( 26, -24, 10, 3.2);
  h += hill(-24,  26,  9, 2.6);
  h += hill( 30,  28,  7, 1.8);
  // Long rolling ridge to the west.
  h += 1.1 * Math.exp(-Math.pow(x + 28, 2) / 140) *
       0.6 * (1 + Math.sin(z * 0.12));
  // Low-frequency waviness everywhere so the flat plate doesn't look dead.
  h += 0.25 * Math.sin(x * 0.08) * Math.cos(z * 0.10);
  h += 0.18 * Math.sin(x * 0.17 + z * 0.11);
  return h * plazaBlend;
}

// Build the mesh.
const vertCount = WIDTH * DEPTH;
const triCount = (WIDTH - 1) * (DEPTH - 1) * 2;

const positions = new Float32Array(vertCount * 3);
const normals   = new Float32Array(vertCount * 3);
const indices   = new Uint32Array(triCount * 3);

// First pass: positions only.
const heights = new Float32Array(vertCount);
for (let z = 0; z < DEPTH; z++) {
  for (let x = 0; x < WIDTH; x++) {
    const wx = ORIGIN_X + x * CELL;
    const wz = ORIGIN_Z + z * CELL;
    const wy = heightAt(wx, wz);
    const i = z * WIDTH + x;
    heights[i] = wy;
    positions[i * 3]     = wx;
    positions[i * 3 + 1] = wy;
    positions[i * 3 + 2] = wz;
  }
}

// Second pass: normals via central differences.
for (let z = 0; z < DEPTH; z++) {
  for (let x = 0; x < WIDTH; x++) {
    const i = z * WIDTH + x;
    const hL = heights[z * WIDTH + Math.max(0, x - 1)];
    const hR = heights[z * WIDTH + Math.min(WIDTH - 1, x + 1)];
    const hD = heights[Math.max(0, z - 1) * WIDTH + x];
    const hU = heights[Math.min(DEPTH - 1, z + 1) * WIDTH + x];
    const nx = (hL - hR);
    const nz = (hD - hU);
    const ny = 2 * CELL;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    normals[i * 3]     = nx / len;
    normals[i * 3 + 1] = ny / len;
    normals[i * 3 + 2] = nz / len;
  }
}

// Indices.
let o = 0;
for (let z = 0; z < DEPTH - 1; z++) {
  for (let x = 0; x < WIDTH - 1; x++) {
    const tl = z * WIDTH + x;
    const tr = tl + 1;
    const bl = tl + WIDTH;
    const br = bl + 1;
    indices[o++] = tl; indices[o++] = bl; indices[o++] = br;
    indices[o++] = tl; indices[o++] = br; indices[o++] = tr;
  }
}

// Position bounds.
let minX = positions[0], maxX = positions[0];
let minY = positions[1], maxY = positions[1];
let minZ = positions[2], maxZ = positions[2];
for (let v = 1; v < vertCount; v++) {
  const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
  if (x < minX) minX = x; else if (x > maxX) maxX = x;
  if (y < minY) minY = y; else if (y > maxY) maxY = y;
  if (z < minZ) minZ = z; else if (z > maxZ) maxZ = z;
}

// GLB assembly.
function align4(n: number): number { return (n + 3) & ~3; }

const idxOff = 0;
const idxLen = indices.byteLength;
const posOff = align4(idxOff + idxLen);
const posLen = positions.byteLength;
const nrmOff = align4(posOff + posLen);
const nrmLen = normals.byteLength;
const binLen = align4(nrmOff + nrmLen);

const bin = new Uint8Array(binLen);
bin.set(new Uint8Array(indices.buffer),   idxOff);
bin.set(new Uint8Array(positions.buffer), posOff);
bin.set(new Uint8Array(normals.buffer),   nrmOff);

const gltf = {
  asset: { version: '2.0', generator: 'shooter-build-terrain' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes:  [{ mesh: 0, name: 'terrain_hills' }],
  meshes: [{ primitives: [{
    attributes: { POSITION: 1, NORMAL: 2 },
    indices: 0,
    material: 0,
    mode: 4,
  }] }],
  materials: [{
    name: 'grass',
    pbrMetallicRoughness: {
      baseColorFactor: [0.22, 0.42, 0.22, 1.0],
      metallicFactor: 0.0,
      roughnessFactor: 0.95,
    },
  }],
  buffers: [{ byteLength: binLen }],
  bufferViews: [
    { buffer: 0, byteOffset: idxOff, byteLength: idxLen, target: 34963 },
    { buffer: 0, byteOffset: posOff, byteLength: posLen, target: 34962 },
    { buffer: 0, byteOffset: nrmOff, byteLength: nrmLen, target: 34962 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5125, count: indices.length,  type: 'SCALAR' },
    { bufferView: 1, componentType: 5126, count: vertCount,       type: 'VEC3',
      min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    { bufferView: 2, componentType: 5126, count: vertCount,       type: 'VEC3' },
  ],
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
odv.setUint32(16, 0x4E4F534A, true);
out.set(jsonPad, 20);
const binOff = 20 + jsonPad.length;
odv.setUint32(binOff,     bin.length,  true);
odv.setUint32(binOff + 4, 0x004E4942,  true);
out.set(bin, binOff + 8);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log('wrote', OUT, '(' + out.length, 'bytes,', vertCount, 'verts,', triCount, 'tris)');
console.log('  y range:', minY.toFixed(2), '...', maxY.toFixed(2));

// Also export the collider samples so the world file can put box colliders
// over the tallest hills. Sampling peaks on the heightmap itself would be
// cleaner — for now we emit the hard-coded centres from heightAt().
const colliders = [
  { x:  26, z: -24, r: 10, h: 3.2 },
  { x: -24, z:  26, r:  9, h: 2.6 },
  { x:  30, z:  28, r:  7, h: 1.8 },
];
console.log('  suggested box colliders:');
for (const c of colliders) {
  console.log(`    center=(${c.x}, ${(c.h / 2).toFixed(2)}, ${c.z}) halfExtents=(${c.r.toFixed(1)}, ${(c.h / 2).toFixed(2)}, ${c.r.toFixed(1)})`);
}
