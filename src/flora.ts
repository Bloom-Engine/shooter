// Phase 3.1 / 3.2 - the small plants on the arena floor and the tree line on the hills beyond it.
//
// Nine kinds of foliage card (fern, shrub, reed, flower, weed, far tree, grass clump, tall
// grass, herb), each ONE mesh drawn
// instanced through assets/materials/card_instanced.wgsl. The textures are slices of one array
// (ORDER IS THE ABI: the SLICE_* constants below, the path list in initFlora, and the slice a
// mesh writes into its vertex colour). Where a plant stands is decided here at load from the
// world data, like the grass: ferns under trees, reeds where the ground meets the water, flowers
// in the open meadow, weeds against rocks, logs and walls, shrubs toward the arena's edge.
// Nothing here collides or blocks a shot.
//
// Perry rules this module follows (see environment.ts): no engine calls at module scope, state
// in the const FLORA object, flat `new Array<number>(n)` arrays written by index.
import {
  createMeshExplicit, compileMaterialInstanced, createInstanceBuffer,
  setMaterialParams, setMaterialProbeVisible, drawMeshWithMaterialInstanced,
} from 'bloom';
import { readFile } from 'bloom/core';
import {
  createTextureArrayFromFiles, setMaterialTextureArray,
  TEXTURE_ARRAY_ALBEDO, TEX_ARRAY_FORMAT_SRGB,
} from 'bloom/models';
import * as W from './world-runtime';
import { terrainHeightAt } from './terrain';
import { ANDROID, MOBILE } from './input';

const SLICE_FERN = 0;
const SLICE_SHRUB = 1;
const SLICE_REED = 2;
const SLICE_FLOWER = 3;
const SLICE_WEED = 4;
const SLICE_TREE = 5;
// 2026-11-15: three kinds photographed from scanned plants (Poly Haven grass_medium_01 and
// shrub_03, CC0) by tools/blender/plant_card.py: a clump of lawn grass, taller grass in seed,
// and a flowering herb. Their pictures are oblong; the card sizes below are what that tool prints.
const SLICE_GRASS = 6;
const SLICE_TALLGRASS = 7;
const SLICE_HERB = 8;
const KINDS = 9;
// The fern, shrub and weed pictures are generated images, brighter and more saturated than the
// scanned plants now standing beside them (mean leaf 85 / 109 / 23 against 77 / 84 / 35):
// their instance tints are scaled by this.
const GEN_R = 0.80, GEN_G = 0.70, GEN_B = 0.86;

/// What the frame loop draws. Written once in initFlora(). Plain module-level arrays, written by
/// index: an array inside an `any` object is not something Perry is trusted with across modules.
const FL_MAT = [0, 0];                     // near plants, far trees
const FL_MESH = new Array<any>(KINDS);
const FL_INST = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const FL_COUNT = [0, 0, 0, 0, 0, 0, 0, 0, 0];

// ---- mesh building ---------------------------------------------------------------------
// Scratch for one mesh at a time: 12 floats a vertex (pos.3 normal.3 colour.4 uv.2).
const MV_MAX = 400;
const MV = new Array<number>(MV_MAX * 12);
const MI = new Array<number>(MV_MAX * 3);
const MS = [0, 0];   // vertex count, index count

function mvReset(): void { MS[0] = 0; MS[1] = 0; }

function mvVert(x: number, y: number, z: number, nx: number, ny: number, nz: number,
                sway: number, slice: number, u: number, v: number): void {
  let o = MS[0] * 12;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) + 0.0001;
  MV[o++] = x; MV[o++] = y; MV[o++] = z;
  MV[o++] = nx / nl; MV[o++] = ny / nl; MV[o++] = nz / nl;
  MV[o++] = sway; MV[o++] = 1; MV[o++] = slice / 10; MV[o++] = 1;
  MV[o++] = u; MV[o++] = v;
  MS[0] = MS[0] + 1;
}

/// Two triangles a-b-c-d, both windings (a card is seen from both sides).
function mvQuad(a: number, b: number, c: number, d: number): void {
  let o = MS[1];
  MI[o++] = a; MI[o++] = b; MI[o++] = c; MI[o++] = a; MI[o++] = c; MI[o++] = d;
  MI[o++] = a; MI[o++] = c; MI[o++] = b; MI[o++] = a; MI[o++] = d; MI[o++] = c;
  MS[1] = o;
}

function mvUpload(): any {
  const nv = MS[0], ni = MS[1];
  const v = new Array<number>(nv * 12);
  const ix = new Array<number>(ni);
  for (let i = 0; i < nv * 12; i++) v[i] = MV[i];
  for (let i = 0; i < ni; i++) ix[i] = MI[i];
  return createMeshExplicit(v, nv, ix, ni);
}

/// `planes` upright cards through the origin, the picture's bottom centre on the root.
/// `round` > 0 gives the corners normals that lean away from the trunk, so two flat cards shade
/// like a crown (the far trees); 0 keeps a mostly-up normal (small plants shade as one soft mass).
function buildFan(slice: number, planes: number, width: number, height: number,
                  lean: number, round: number): any {
  mvReset();
  for (let p = 0; p < planes; p++) {
    const ang = (p * Math.PI) / planes + 0.3;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const hw = width * 0.5;
    // the card leans a little off vertical, alternating, so the fan has depth from above
    const lx = -dz * lean * (p % 2 === 0 ? 1 : -1), lz = dx * lean * (p % 2 === 0 ? 1 : -1);
    const b = MS[0];
    const cnx = -dz * 0.4, cnz = dx * 0.4;
    mvVert(-dx * hw, 0, -dz * hw, cnx - dx * round, 0.9, cnz - dz * round, 0, slice, 0, 1);
    mvVert(dx * hw, 0, dz * hw, cnx + dx * round, 0.9, cnz + dz * round, 0, slice, 1, 1);
    mvVert(dx * hw + lx, height, dz * hw + lz, cnx + dx * round, 0.9 + round, cnz + dz * round, 1, slice, 1, 0);
    mvVert(-dx * hw + lx, height, -dz * hw + lz, cnx - dx * round, 0.9 + round, cnz - dz * round, 1, slice, 0, 0);
    mvQuad(b, b + 1, b + 2, b + 3);
  }
  return mvUpload();
}

/// A fern: fronds arching out of one root, each a strip of four segments that rises and droops.
function buildFern(): any {
  mvReset();
  const FRONDS = 9, SEG = 4;
  let ts = 0x2f6e1 | 0;
  for (let f = 0; f < FRONDS; f++) {
    ts = (ts * 16807) % 2147483647; const q1 = ts / 0x7fffffff;
    ts = (ts * 16807) % 2147483647; const q2 = ts / 0x7fffffff;
    const ang = f * 2.39996 + q1 * 0.5;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const len = 0.62 + q2 * 0.30;
    const rise = 0.30 + q1 * 0.22;
    const hw = 0.15;
    const b = MS[0];
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const r = len * (0.06 + 0.94 * t);
      const y = rise * Math.sin(t * 2.25) + 0.02;
      const cx = dx * r, cz = dz * r;
      mvVert(cx - dz * hw, y, cz + dx * hw, dx * 0.25, 0.95, dz * 0.25, t, SLICE_FERN, 0, 1 - t);
      mvVert(cx + dz * hw, y, cz - dx * hw, dx * 0.25, 0.95, dz * 0.25, t, SLICE_FERN, 1, 1 - t);
    }
    for (let s = 0; s < SEG; s++) {
      const o = b + s * 2;
      mvQuad(o, o + 1, o + 3, o + 2);
    }
  }
  return mvUpload();
}

/// A shrub: branch cards growing up and out of a knot of stems.
function buildShrub(): any {
  mvReset();
  const CARDS = 18;
  let ts = 0x51ab3 | 0;
  for (let c = 0; c < CARDS; c++) {
    ts = (ts * 16807) % 2147483647; const q1 = ts / 0x7fffffff;
    ts = (ts * 16807) % 2147483647; const q2 = ts / 0x7fffffff;
    ts = (ts * 16807) % 2147483647; const q3 = ts / 0x7fffffff;
    const az = c * 2.39996 + q1 * 0.7;
    const el = 0.55 + q2 * 0.85;                       // radians above the horizontal
    const dx = Math.cos(az) * Math.cos(el), dy = Math.sin(el), dz = Math.sin(az) * Math.cos(el);
    const wx = -Math.sin(az), wz = Math.cos(az);       // card width axis, horizontal
    const size = 0.42 + q3 * 0.22;      // a card is one branch tip: leaves come out about 6 cm
    const hw = size * 0.5;
    const rx = Math.cos(az) * 0.30 * q3, ry = 0.05 + q1 * 0.55, rz = Math.sin(az) * 0.30 * q3;
    const b = MS[0];
    const nx = Math.cos(az) * 0.5, nz = Math.sin(az) * 0.5;
    mvVert(rx - wx * hw, ry, rz - wz * hw, nx, 0.85, nz, 0.25, SLICE_SHRUB, 0, 1);
    mvVert(rx + wx * hw, ry, rz + wz * hw, nx, 0.85, nz, 0.25, SLICE_SHRUB, 1, 1);
    mvVert(rx + wx * hw + dx * size, ry + dy * size, rz + wz * hw + dz * size, nx, 0.85, nz, 1, SLICE_SHRUB, 1, 0);
    mvVert(rx - wx * hw + dx * size, ry + dy * size, rz - wz * hw + dz * size, nx, 0.85, nz, 1, SLICE_SHRUB, 0, 0);
    mvQuad(b, b + 1, b + 2, b + 3);
  }
  return mvUpload();
}

// ---- scatter ---------------------------------------------------------------------------
const RNG = [0x3c6ef | 0];
function rnd(): number {
  RNG[0] = (RNG[0] * 16807) % 2147483647;
  return RNG[0] / 0x7fffffff;
}

// A cell hash that stays inside what a double holds exactly (Park-Miller steps). The bit-mixing
// hash environment.ts uses multiplies past 2^53 and leans on `| 0` wrapping; compiled by Perry
// that came out nearly constant here (every noise threshold failed and almost nothing was placed).
function hashCell(ix: number, iz: number): number {
  let h = ((ix + 4096) * 7919 + (iz + 4096) * 104729 + 12345) % 2147483647;
  h = (h * 16807) % 2147483647;
  h = (h * 48271) % 2147483647;
  h = (h * 16807) % 2147483647;
  return h / 2147483647;
}
function patchNoise(x: number, z: number): number {
  const fx = Math.floor(x), fz = Math.floor(z);
  const tx = x - fx, tz = z - fz;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hashCell(fx, fz), b = hashCell(fx + 1, fz);
  const c = hashCell(fx, fz + 1), d = hashCell(fx + 1, fz + 1);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

/// The horizon skirt's height outside the arena. A port of skirtHeightAt in
/// tools/terrain-shape.ts, which builds the drawn terrain mesh: keep the two in step.
function skirtHeight(x: number, z: number): number {
  const ARENA_HALF = 40, EXTENT_HALF = 140;
  const dEdge = Math.max(Math.abs(x), Math.abs(z));
  if (dEdge <= ARENA_HALF) return 0;
  const t = Math.min(1, (dEdge - ARENA_HALF) / (EXTENT_HALF - ARENA_HALF));
  const ss = t * t * (3 - 2 * t);
  const ang = Math.atan2(z, x);
  const lobes = 1 + 0.35 * Math.sin(ang * 3 + 1.7) + 0.2 * Math.sin(ang * 7 + 0.6);
  const roll = Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05 + 0.4) * 3.2
             + Math.sin(x * 0.11 + z * 0.07) * 1.6;
  return Math.max(ss * (12.0 * lobes + roll), ss * 6.5);
}
function groundAt(x: number, z: number): number {
  const cx = Math.max(-39.6, Math.min(39.6, x));
  const cz = Math.max(-39.6, Math.min(39.6, z));
  return terrainHeightAt(cx, cz) + skirtHeight(x, z);
}

/// Painted mud + rock at a point, 0..1 (0 where the world has no paint).
function bareAt(x: number, z: number): number {
  if (W.TERRAIN_SPLAT_COUNT === 0) return 0;
  const u = Math.round((x - W.TERRAIN_ORIGIN_X) / W.TERRAIN_CELL_SIZE);
  const v = Math.round((z - W.TERRAIN_ORIGIN_Z) / W.TERRAIN_CELL_SIZE);
  if (u < 0 || v < 0 || u >= W.TERRAIN_SPLAT_W || v >= W.TERRAIN_SPLAT_H) return 0;
  const packed = W.TERRAIN_SPLAT_DATA[v * W.TERRAIN_SPLAT_W + u];
  return ((Math.floor(packed / 65536) % 256) + (Math.floor(packed / 16777216) % 256)) / 255;
}

function nearestTree(x: number, z: number): number {
  let best = 1e9;
  for (let i = 0; i < W.FOREST_COUNT; i++) {
    const dx = W.FOREST_X[i] - x, dz = W.FOREST_Z[i] - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/// Inside a prop's box (grown by `m`), or the building, or outside the arena.
function blocked(x: number, z: number, m: number): boolean {
  if (Math.abs(x) > 38.5 || Math.abs(z) > 38.5) return true;
  if (W.keepOutBuilding(x, z, 0.35)) return true;
  for (let i = 0; i < W.MESH_COUNT; i++) {
    if (W.MESH_COLLIDER[i] !== 1 || W.MESH_CATEGORY[i] !== 3) continue;
    const r = Math.max(W.MESH_COLLIDER_HX[i], W.MESH_COLLIDER_HZ[i]) + m;
    const dx = W.MESH_X[i] - x, dz = W.MESH_Z[i] - z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

function waterY(): number {
  return W.WATER_COUNT > 0 ? W.WATER_CY[0] + 0.05 : -1000;
}
function underWater(x: number, z: number, y: number): boolean {
  if (W.WATER_COUNT === 0) return false;
  return y < waterY() + 0.04
    && Math.abs(x - W.WATER_CX[0]) < W.WATER_SX[0] * 0.5 + 3.5
    && Math.abs(z - W.WATER_CZ[0]) < W.WATER_SZ[0] * 0.5 + 3.5;
}

// One kind's instances while they are being scattered: 9 floats each.
const SC_MAX = 12000;
const SC = new Array<number>(SC_MAX * 9);
const SCN = [0];

function scAdd(x: number, y: number, z: number, scale: number, tr: number, tg: number, tb: number): void {
  if (SCN[0] >= SC_MAX) return;
  let o = SCN[0] * 9;
  SC[o++] = x; SC[o++] = y; SC[o++] = z;
  SC[o++] = rnd() * 6.2832;
  SC[o++] = scale;
  SC[o++] = tr; SC[o++] = tg; SC[o++] = tb; SC[o++] = 1;
  SCN[0] = SCN[0] + 1;
}

function scUpload(kind: number): void {
  const n = SCN[0];
  FL_COUNT[kind] = n;
  if (n === 0) { FL_INST[kind] = 0; return; }
  const data = new Array<number>(n * 9);
  for (let i = 0; i < n * 9; i++) data[i] = SC[i];
  FL_INST[kind] = createInstanceBuffer(data, n);
  SCN[0] = 0;
}

export function initFlora(): void {
  const src = readFile('assets/materials/card_instanced.wgsl');
  const matNear = compileMaterialInstanced(src);
  const matFar = compileMaterialInstanced(src);
  if (matNear <= 0 || matFar <= 0) { console.log('[flora] card material failed to compile'); return; }
  const tex = createTextureArrayFromFiles([
    'assets/textures/flora_fern.png',
    'assets/textures/flora_shrub.png',
    'assets/textures/flora_reed.png',
    'assets/textures/flora_flower.png',
    'assets/textures/flora_weed.png',
    'assets/textures/flora_tree.png',
    'assets/textures/flora_grass.png',
    'assets/textures/flora_tallgrass.png',
    'assets/textures/flora_herb.png',
  ], TEX_ARRAY_FORMAT_SRGB, 11);
  if (tex <= 0) { console.log('[flora] textures missing: assets/textures/flora_*.png'); return; }
  setMaterialTextureArray(matNear, TEXTURE_ARRAY_ALBEDO, tex);
  setMaterialTextureArray(matFar, TEXTURE_ARRAY_ALBEDO, tex);
  // tint rgb, transmission; alpha cutoff, wind scale, (unused), self-shadow depth
  setMaterialParams(matNear, [0.86, 0.90, 0.80, 0.30,   0.42, 1.0, 0.0, 0.45]);
  setMaterialParams(matFar,  [0.60, 0.68, 0.54, 0.06,   0.40, 0.0, 0.0, 0.72]);
  // The small plants are sub-pixel in the 512 px water probe; the far tree line is what the
  // river should mirror, so that one stays in.
  setMaterialProbeVisible(matNear, false);

  FL_MESH[SLICE_FERN] = buildFern();
  FL_MESH[SLICE_SHRUB] = buildShrub();
  FL_MESH[SLICE_REED] = buildFan(SLICE_REED, 3, 1.05, 1.30, 0.10, 0);
  FL_MESH[SLICE_FLOWER] = buildFan(SLICE_FLOWER, 3, 0.55, 0.55, 0.05, 0);
  FL_MESH[SLICE_WEED] = buildFan(SLICE_WEED, 3, 0.80, 0.70, 0.14, 0);
  FL_MESH[SLICE_TREE] = buildFan(SLICE_TREE, 2, 1.0, 1.0, 0.0, 0.9);
  // Scanned at 0.91 x 0.22 m, 0.62 x 0.33 m and 0.38 x 0.42 m; drawn about twice life size
  // (a meadow, not a lawn), which the per-instance scale then varies.
  // (Narrower than the picture's own 4 : 1: three 1.7 m planes read as an asterisk from above.)
  FL_MESH[SLICE_GRASS] = buildFan(SLICE_GRASS, 3, 1.15, 0.42, 0.20, 0);
  FL_MESH[SLICE_TALLGRASS] = buildFan(SLICE_TALLGRASS, 3, 1.10, 0.70, 0.14, 0);
  FL_MESH[SLICE_HERB] = buildFan(SLICE_HERB, 2, 0.62, 0.68, 0.04, 0);

  const DENS = ANDROID ? 0 : (MOBILE ? 0.4 : 1.0);

  // Ferns: the forest floor. Two to five round each tree, between the roots and the drip line.
  SCN[0] = 0;
  for (let i = 0; i < W.FOREST_COUNT && DENS > 0; i++) {
    const n = Math.floor((2 + rnd() * 3.99) * DENS + 0.5);
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.2832, r = (0.9 + rnd() * 3.2) * W.FOREST_SCALE[i];
      const x = W.FOREST_X[i] + Math.cos(a) * r, z = W.FOREST_Z[i] + Math.sin(a) * r;
      if (blocked(x, z, 0.1)) continue;
      const y = terrainHeightAt(x, z);
      if (underWater(x, z, y) || bareAt(x, z) > 0.45) continue;
      const g = 0.82 + rnd() * 0.30;
      scAdd(x, y - 0.02, z, 0.75 + rnd() * 0.7, g * GEN_R, (g + 0.04) * GEN_G, (g - 0.06) * GEN_B);
    }
  }
  scUpload(SLICE_FERN);

  // Shrubs: toward the edge of the arena and at the feet of the hills, in loose groups.
  for (let t = 0; t < 2200 * DENS && SCN[0] < 150 * DENS; t++) {
    const x = -38 + rnd() * 76, z = -38 + rnd() * 76;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge < 17 && rnd() > 0.10) continue;
    if (patchNoise(x * 0.11 + 40, z * 0.11) < 0.52) continue;
    if (blocked(x, z, 1.0) || bareAt(x, z) > 0.25) continue;
    const y = terrainHeightAt(x, z);
    if (underWater(x, z, y - 0.2)) continue;
    const d = nearestTree(x, z);
    if (d < 1.4) continue;
    const g = 0.78 + rnd() * 0.30;
    scAdd(x, y - 0.03, z, 0.9 + rnd() * 0.9, g * GEN_R, (g + 0.03) * GEN_G, (g - 0.08) * GEN_B);
  }
  scUpload(SLICE_SHRUB);

  // Reeds: where the ground is within a hand of the water surface, either side of it.
  if (W.WATER_COUNT > 0 && DENS > 0) {
    const wy = waterY();
    for (let t = 0; t < 9000 && SCN[0] < 230 * DENS; t++) {
      const x = W.WATER_CX[0] + (rnd() - 0.5) * (W.WATER_SX[0] + 7);
      const z = W.WATER_CZ[0] + (rnd() - 0.5) * (W.WATER_SZ[0] + 7);
      if (Math.abs(x) > 38.5 || Math.abs(z) > 38.5) continue;
      const y = terrainHeightAt(x, z);
      if (y < wy - 0.22 || y > wy + 0.14) continue;
      if (patchNoise(x * 0.23, z * 0.23 + 17) < 0.60) continue;      // reed beds, with gaps
      if (bareAt(x, z) > 0.7) continue;                               // a trail's ford stays open
      const g = 0.62 + rnd() * 0.22;
      scAdd(x, y - 0.05, z, 0.55 + rnd() * 0.5, g * 0.86, g, g * 0.74);
    }
  }
  scUpload(SLICE_REED);

  // Flowers: drifts in the open meadow, away from the trees' shade.
  for (let t = 0; t < 9000 * DENS && SCN[0] < 700 * DENS; t++) {
    const x = -38 + rnd() * 76, z = -38 + rnd() * 76;
    if (patchNoise(x * 0.16, z * 0.16 + 90) < 0.60) continue;
    if (blocked(x, z, 0.2) || bareAt(x, z) > 0.2) continue;
    const y = terrainHeightAt(x, z);
    if (underWater(x, z, y - 0.1)) continue;
    if (nearestTree(x, z) < 3.2) continue;
    scAdd(x, y - 0.02, z, 0.75 + rnd() * 0.6, 1.0, 1.0, 1.0);
  }
  scUpload(SLICE_FLOWER);

  // Weeds: against anything that stands on the ground, and scattered thinly elsewhere.
  for (let i = 0; i < W.MESH_COUNT && DENS > 0; i++) {
    if (W.MESH_CATEGORY[i] !== 3 || W.MESH_COLLIDER[i] !== 1) continue;
    if (W.keepOutBuilding(W.MESH_X[i], W.MESH_Z[i], 0.0)) continue;   // furniture indoors
    const n = Math.floor((2 + rnd() * 3) * DENS + 0.5);
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.2832;
      const r = Math.max(W.MESH_COLLIDER_HX[i], W.MESH_COLLIDER_HZ[i]) + 0.15 + rnd() * 0.6;
      const x = W.MESH_X[i] + Math.cos(a) * r, z = W.MESH_Z[i] + Math.sin(a) * r;
      if (blocked(x, z, 0.0)) continue;
      const y = terrainHeightAt(x, z);
      if (underWater(x, z, y)) continue;
      const g = 0.80 + rnd() * 0.25;
      scAdd(x, y - 0.03, z, 0.7 + rnd() * 0.7, g * GEN_R, (g + 0.03) * GEN_G, (g - 0.05) * GEN_B);
    }
  }
  for (let t = 0; t < 4000 * DENS && SCN[0] < 520 * DENS; t++) {
    const x = -38 + rnd() * 76, z = -38 + rnd() * 76;
    const wall = W.keepOutBuilding(x, z, 1.3);
    if (!wall && patchNoise(x * 0.2 + 7, z * 0.2) < 0.62) continue;
    if (blocked(x, z, 0.15) || bareAt(x, z) > 0.35) continue;
    const y = terrainHeightAt(x, z);
    if (underWater(x, z, y)) continue;
    const g = 0.80 + rnd() * 0.25;
    scAdd(x, y - 0.03, z, 0.6 + rnd() * 0.7, g * GEN_R, (g + 0.03) * GEN_G, (g - 0.05) * GEN_B);
  }
  scUpload(SLICE_WEED);

  // Grass clumps: the meadow itself. Everywhere a plant may stand, thinner on painted mud and
  // rock and in the deepest shade right at a trunk.
  const grassMax = ANDROID ? 0 : (MOBILE ? 2500 : 11500);
  for (let t = 0; t < grassMax * 3 && SCN[0] < grassMax; t++) {
    const x = -38 + rnd() * 76, z = -38 + rnd() * 76;
    if (blocked(x, z, 0.1)) continue;
    const bare = bareAt(x, z);
    if (rnd() * 0.9 + 0.05 < bare) continue;
    const y = terrainHeightAt(x, z);
    if (underWater(x, z, y - 0.05)) continue;
    const lush = patchNoise(x * 0.09 + 3, z * 0.09 + 11);
    if (lush < 0.22 && rnd() < 0.6) continue;
    const g = 0.80 + rnd() * 0.26;
    scAdd(x, y - 0.03, z, 0.75 + rnd() * 0.55 + lush * 0.25, g * (1.0 + (0.5 - lush) * 0.16), g, g * 0.92);
  }
  scUpload(SLICE_GRASS);

  // Taller grass in seed: in patches, and along the water.
  for (let t = 0; t < 26000 * DENS && SCN[0] < 2600 * DENS; t++) {
    const x = -38 + rnd() * 76, z = -38 + rnd() * 76;
    if (patchNoise(x * 0.13 + 61, z * 0.13 + 5) < 0.56) continue;
    if (blocked(x, z, 0.25) || bareAt(x, z) > 0.3) continue;
    const y = terrainHeightAt(x, z);
    if (underWater(x, z, y - 0.05)) continue;
    const g = 0.82 + rnd() * 0.24;
    scAdd(x, y - 0.03, z, 0.8 + rnd() * 0.7, g * 1.03, g, g * 0.88);
  }
  scUpload(SLICE_TALLGRASS);

  // Flowering herbs: loose drifts in the open.
  for (let t = 0; t < 9000 * DENS && SCN[0] < 420 * DENS; t++) {
    const x = -38 + rnd() * 76, z = -38 + rnd() * 76;
    if (patchNoise(x * 0.18 + 23, z * 0.18 + 47) < 0.64) continue;
    if (blocked(x, z, 0.2) || bareAt(x, z) > 0.25) continue;
    const y = terrainHeightAt(x, z);
    if (underWater(x, z, y - 0.1)) continue;
    if (nearestTree(x, z) < 2.0) continue;
    const g = 0.84 + rnd() * 0.2;
    scAdd(x, y - 0.02, z, 0.8 + rnd() * 0.6, g, g, g * 0.92);
  }
  scUpload(SLICE_HERB);

  // The far tree line: the hills outside the arena, wooded in copses that thin toward the
  // horizon. A card is 1 m square at scale 1 with its root at the origin; the scale is the
  // tree's height.
  const farMax = ANDROID ? 350 : (MOBILE ? 900 : 2400);
  for (let t = 0; t < farMax * 12 && SCN[0] < farMax; t++) {
    const x = -134 + rnd() * 268, z = -134 + rnd() * 268;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge < 50) continue;        // closer than this a card is seen for what it is
    const copse = patchNoise(x * 0.035 + 9.1, z * 0.035 + 3.3) * 0.7 + patchNoise(x * 0.11, z * 0.11) * 0.3;
    const near = 1 - Math.min(1, (edge - 50) / 60);                 // denser close in
    if (copse < 0.60 - near * 0.22) continue;
    const h = 7.5 + rnd() * 6.5;
    const g = 0.62 + rnd() * 0.30;
    scAdd(x, groundAt(x, z) - 0.25, z, h, g * 0.94, g, g * 0.86);
  }
  scUpload(SLICE_TREE);

  FL_MAT[0] = matNear;
  FL_MAT[1] = matFar;
  console.log('[flora] fern ' + FL_COUNT[0] + ' shrub ' + FL_COUNT[1] + ' reed ' + FL_COUNT[2]
    + ' flower ' + FL_COUNT[3] + ' weed ' + FL_COUNT[4] + ' far trees ' + FL_COUNT[5]
    + ' grass ' + FL_COUNT[6] + ' tall grass ' + FL_COUNT[7] + ' herb ' + FL_COUNT[8]);
}

/// One instanced draw per kind, inside the 3D pass.
export function drawFlora(): void {
  if (FL_MAT[0] <= 0) return;
  for (let k = 0; k < KINDS; k++) {
    if (FL_COUNT[k] <= 0 || FL_INST[k] <= 0) continue;
    drawMeshWithMaterialInstanced(k === SLICE_TREE ? FL_MAT[1] : FL_MAT[0],
      FL_MESH[k], 0, FL_INST[k], FL_COUNT[k]);
  }
}
