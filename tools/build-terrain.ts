// Terrain mesh generator — builds assets/models/terrain_hills.glb.
//
//   bun tools/build-terrain.ts [assets/worlds/arena_02.world.json]
//
// The arena's heights are NOT invented here any more: they are read from
// `world.terrain` in the world file, which is what the game loads for physics
// and what the editor sculpts. This tool turns those heights into the textured
// visual mesh, and extends them outward with a procedural "skirt" of hills that
// hides the horizon (nothing walks out there, and the physics heightfield does
// not cover it, so the skirt is derived rather than authored).
//
// So: sculpt in the editor → save → re-run this → the visuals follow. Physics
// and terrain-height queries need no rebuild at all; they read the world file
// directly at startup.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { encodePng, grassTexture, heightToNormal } from './png';
import { skirtHeightAt, ARENA_HALF, EXTENT_HALF } from './terrain-shape';

const OUT_GLB = 'assets/models/terrain_hills.glb';
const WORLD_PATH = process.argv[2] || 'assets/worlds/arena_02.world.json';

// Visual mesh: 256 × 256 over ±EXTENT_HALF ≈ 1.1 m spacing = 65 k verts /
// 130 k tris, still one draw call. Finer than the authored heightmap on
// purpose — the extra vertices carry the skirt and keep the silhouette smooth.
const WIDTH = 256;
const DEPTH = 256;
const CELL = (EXTENT_HALF * 2) / (WIDTH - 1);
const ORIGIN_X = -EXTENT_HALF;
const ORIGIN_Z = -EXTENT_HALF;

// ---- authored heights from the world file ------------------------------------

interface TerrainData {
  width: number;
  depth: number;
  cellSize: number;
  origin: [number, number, number];
  heights: number[];
}

const world = JSON.parse(readFileSync(WORLD_PATH, 'utf8'));
const terrain: TerrainData | null = world.terrain || null;
if (!terrain) {
  console.error(
    `${WORLD_PATH} has no terrain. Seed it first:
` +
    `  bun tools/bake-terrain-to-world.ts ${WORLD_PATH}`,
  );
  process.exit(1);
}
console.log(
  `terrain from ${WORLD_PATH}: ${terrain.width}×${terrain.depth} @ ` +
  `${terrain.cellSize.toFixed(4)} m`,
);

// Bilinear sample of the authored grid, clamped at the edges so the skirt has a
// continuous base to rise from.
function sampleWorldHeight(x: number, z: number): number {
  const t = terrain as TerrainData;
  const fx = (x - t.origin[0]) / t.cellSize;
  const fz = (z - t.origin[2]) / t.cellSize;

  const cx = Math.min(Math.max(fx, 0), t.width - 1.001);
  const cz = Math.min(Math.max(fz, 0), t.depth - 1.001);

  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const tx = cx - x0;
  const tz = cz - z0;

  const h00 = t.heights[z0 * t.width + x0];
  const h10 = t.heights[z0 * t.width + x0 + 1];
  const h01 = t.heights[(z0 + 1) * t.width + x0];
  const h11 = t.heights[(z0 + 1) * t.width + x0 + 1];

  const h0 = h00 + (h10 - h00) * tx;
  const h1 = h01 + (h11 - h01) * tx;
  return t.origin[1] + h0 + (h1 - h0) * tz;
}

// Inside the arena: exactly what the game loads. Outside: the same heights,
// clamped at the boundary, plus the skirt — so a hill sculpted at the arena's
// edge continues into the surrounding landscape instead of ending in a cliff.
function heightAt(x: number, z: number): number {
  return sampleWorldHeight(x, z) + skirtHeightAt(x, z);
}

// Build the mesh.
const vertCount = WIDTH * DEPTH;
const triCount = (WIDTH - 1) * (DEPTH - 1) * 2;

const positions = new Float32Array(vertCount * 3);
const normals   = new Float32Array(vertCount * 3);
const uvs       = new Float32Array(vertCount * 2);
const indices   = new Uint32Array(triCount * 3);

// UV tile rate — 1 texture repeat per UV_TILE world metres. Larger = fewer
// visible repeats across the 80 m field (4 m gave ~20 obvious repeats); the
// seamless grass texture + higher resolution keep per-metre detail crisp.
const UV_TILE = 8;

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
    uvs[i * 2]     = wx / UV_TILE;
    uvs[i * 2 + 1] = wz / UV_TILE;
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

// Procedural grass texture — tiled across the whole terrain via UVs above.
// Plus a derived normal map so the grass catches the directional sun (per-texel
// surface relief) instead of shading flat.
const TEX_SIZE = 512;
const grassRgba = grassTexture(TEX_SIZE);
const grassPng = encodePng(TEX_SIZE, TEX_SIZE, grassRgba);
const grassNrmPng = encodePng(TEX_SIZE, TEX_SIZE,
  heightToNormal(TEX_SIZE, TEX_SIZE, grassRgba, 2.5));

const idxOff = 0;
const idxLen = indices.byteLength;
const posOff = align4(idxOff + idxLen);
const posLen = positions.byteLength;
const nrmOff = align4(posOff + posLen);
const nrmLen = normals.byteLength;
const uvOff  = align4(nrmOff + nrmLen);
const uvLen  = uvs.byteLength;
const imgOff = align4(uvOff + uvLen);
const imgLen = grassPng.length;
const nrmImgOff = align4(imgOff + imgLen);
const nrmImgLen = grassNrmPng.length;
const binLen = align4(nrmImgOff + nrmImgLen);

const bin = new Uint8Array(binLen);
bin.set(new Uint8Array(indices.buffer),   idxOff);
bin.set(new Uint8Array(positions.buffer), posOff);
bin.set(new Uint8Array(normals.buffer),   nrmOff);
bin.set(new Uint8Array(uvs.buffer),       uvOff);
bin.set(grassPng,                         imgOff);
bin.set(grassNrmPng,                      nrmImgOff);

const gltf = {
  asset: { version: '2.0', generator: 'shooter-build-terrain' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes:  [{ mesh: 0, name: 'terrain_hills' }],
  meshes: [{ primitives: [{
    attributes: { POSITION: 1, NORMAL: 2, TEXCOORD_0: 3 },
    indices: 0,
    material: 0,
    mode: 4,
  }] }],
  materials: [{
    name: 'grass',
    pbrMetallicRoughness: {
      baseColorFactor: [1.0, 1.0, 1.0, 1.0],
      baseColorTexture: { index: 0 },
      metallicFactor: 0.0,
      roughnessFactor: 0.95,
    },
    normalTexture: { index: 1, scale: 1.0 },
  }],
  textures: [{ source: 0, sampler: 0 }, { source: 1, sampler: 0 }],
  images: [
    { bufferView: 4, mimeType: 'image/png' },
    { bufferView: 5, mimeType: 'image/png' },
  ],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }], // REPEAT
  buffers: [{ byteLength: binLen }],
  bufferViews: [
    { buffer: 0, byteOffset: idxOff, byteLength: idxLen, target: 34963 },
    { buffer: 0, byteOffset: posOff, byteLength: posLen, target: 34962 },
    { buffer: 0, byteOffset: nrmOff, byteLength: nrmLen, target: 34962 },
    { buffer: 0, byteOffset: uvOff,  byteLength: uvLen,  target: 34962 },
    { buffer: 0, byteOffset: imgOff, byteLength: imgLen },
    { buffer: 0, byteOffset: nrmImgOff, byteLength: nrmImgLen },
  ],
  accessors: [
    { bufferView: 0, componentType: 5125, count: indices.length,  type: 'SCALAR' },
    { bufferView: 1, componentType: 5126, count: vertCount,       type: 'VEC3',
      min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    { bufferView: 2, componentType: 5126, count: vertCount,       type: 'VEC3' },
    { bufferView: 3, componentType: 5126, count: vertCount,       type: 'VEC2' },
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

mkdirSync(dirname(OUT_GLB), { recursive: true });
writeFileSync(OUT_GLB, out);
console.log('wrote', OUT_GLB, '(' + out.length, 'bytes,', vertCount, 'verts,', triCount, 'tris)');
console.log('  y range:', minY.toFixed(2), '...', maxY.toFixed(2));

// The physics heightfield is NOT emitted here any more. The game reads
// `world.terrain` at startup and feeds it straight to Jolt, so collision and the
// terrain-height queries follow an edited world with no rebuild — only the
// visual mesh above needs this tool.
