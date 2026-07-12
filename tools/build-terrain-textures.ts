// SH-009 / SH-010 — the four terrain splat layers + a shared detail normal.
//
// The ground is the single most-looked-at surface in the game and until now it
// had NO texture at any scale: `terrain.wgsl` blended three colour stops by a
// hash-noise, so pressing the camera to the floor showed a smooth gradient.
// This generates the layers that fix that.
//
// These are procedural stand-ins for CC0 photoscans (ASSET-TODO T1) — but the
// *system* they feed is the real one: a 4-layer triplanar splat with per-layer
// normals, blended by slope / height / noise / distance-to-water. Dropping Poly
// Haven sets in later is a file swap, because the layer ORDER is the ABI.
//
//   bun tools/build-terrain-textures.ts
//
// LAYER ORDER (indexed by terrain.wgsl — do not reorder):
//   0 grass_lush   1 grass_dry   2 dirt   3 rock

import { encodePng, makeTexture, heightToNormal } from './png';
import { writeFileSync, mkdirSync } from 'fs';

const SIZE = 512;

// Deterministic RNG so re-running doesn't churn the committed PNGs.
let seed = 0x9E3779B9;
function rnd(): number {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return (seed & 0xffffff) / 0xffffff;
}

/// Tileable value noise: hash on integer lattice, wrapped at `period` so the
/// texture repeats seamlessly. A non-wrapping noise would put a visible seam
/// down the middle of every terrain tile.
function hash(xi: number, yi: number, period: number, salt: number): number {
  const x = ((xi % period) + period) % period;
  const y = ((yi % period) + period) % period;
  const n = Math.sin((x * 127.1 + y * 311.7 + salt * 74.7)) * 43758.5453;
  return n - Math.floor(n);
}
function vnoise(x: number, y: number, period: number, salt: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, period, salt);
  const b = hash(xi + 1, yi, period, salt);
  const c = hash(xi, yi + 1, period, salt);
  const d = hash(xi + 1, yi + 1, period, salt);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
/// Multi-octave, each octave wrapping at its own period so the sum still tiles.
function fbm(x: number, y: number, base: number, oct: number, salt: number): number {
  let v = 0, amp = 0.5, f = base;
  for (let o = 0; o < oct; o++) {
    v += amp * vnoise(x * f / SIZE * SIZE, y * f / SIZE * SIZE, f, salt + o * 13);
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

type Px = [number, number, number, number];

// PALETTE NOTE: keep these OLIVE, not emerald. The round-4 de-cartoonification
// pass specifically replaced saturated toy-greens with a desaturated olive
// because the saturated version read as a plastic lawn — and the first cut of
// these textures walked straight back into it. Green channel stays close to
// red; blue stays low but present.

/// 0 — lush grass. Fine blade-scale streaks plus clump-scale mottling, so it
/// reads as grass close up and as texture (not noise) at range.
const grassLush = (x: number, y: number): Px => {
  const nx = x / SIZE, ny = y / SIZE;
  const clump = fbm(nx * SIZE, ny * SIZE, 6, 3, 1);
  // Blade streaks: high-frequency, anisotropic (stretched along +y).
  const blade = vnoise(nx * 96, ny * 22, 96, 7);
  const m = clump * 0.65 + blade * 0.35;
  const r = 48 + m * 30;
  const g = 64 + m * 38;
  const b = 33 + m * 20;
  return [r, g, b, 255];
};

/// 1 — dry grass. Same structure, straw palette, a bit patchier.
const grassDry = (x: number, y: number): Px => {
  const nx = x / SIZE, ny = y / SIZE;
  const clump = fbm(nx * SIZE, ny * SIZE, 5, 3, 21);
  const blade = vnoise(nx * 88, ny * 20, 88, 23);
  const m = clump * 0.6 + blade * 0.4;
  const r = 96 + m * 44;
  const g = 88 + m * 40;
  const b = 46 + m * 22;
  return [r, g, b, 255];
};

/// 2 — dirt. Granular, with scattered darker pebbles.
const dirt = (x: number, y: number): Px => {
  const nx = x / SIZE, ny = y / SIZE;
  const grain = fbm(nx * SIZE, ny * SIZE, 12, 4, 41);
  const peb = vnoise(nx * 40, ny * 40, 40, 43);
  const pebble = peb > 0.78 ? (peb - 0.78) / 0.22 : 0;
  let r = 92 + grain * 52;
  let g = 72 + grain * 42;
  let b = 50 + grain * 30;
  // Pebbles read darker + cooler.
  r = r * (1 - pebble * 0.45) + 60 * pebble * 0.45;
  g = g * (1 - pebble * 0.45) + 58 * pebble * 0.45;
  b = b * (1 - pebble * 0.45) + 54 * pebble * 0.45;
  return [r, g, b, 255];
};

/// 3 — rock. Stratified: banded strata plus fracture lines, which is what makes
/// a cliff read as rock rather than as grey noise.
const rock = (x: number, y: number): Px => {
  const nx = x / SIZE, ny = y / SIZE;
  // Strata: low-frequency bands along y, warped by noise so they aren't ruler
  // straight.
  const warp = fbm(nx * SIZE, ny * SIZE, 4, 3, 61) * 0.25;
  const band = Math.abs(Math.sin((ny + warp) * Math.PI * 7));
  const grain = fbm(nx * SIZE, ny * SIZE, 16, 4, 63);
  // Fractures: thin dark cracks where a ridged noise gets close to zero.
  const rid = Math.abs(vnoise(nx * 18, ny * 18, 18, 67) - 0.5) * 2;
  const crack = rid < 0.06 ? 1 - rid / 0.06 : 0;
  let v = 96 + band * 34 + grain * 40;
  v = v * (1 - crack * 0.55);
  return [v * 1.02, v, v * 0.96, 255];
};

// ---- emit -------------------------------------------------------------------

mkdirSync('assets/textures', { recursive: true });

interface Layer { name: string; fn: (x: number, y: number) => Px; bump: number; }
const layers: Layer[] = [
  { name: 'terrain_grass_lush', fn: grassLush, bump: 2.5 },
  { name: 'terrain_grass_dry',  fn: grassDry,  bump: 2.2 },
  { name: 'terrain_dirt',       fn: dirt,      bump: 3.5 },
  { name: 'terrain_rock',       fn: rock,      bump: 5.0 },
];

for (const l of layers) {
  const albedo = makeTexture(SIZE, SIZE, l.fn);
  writeFileSync(`assets/textures/${l.name}_albedo.png`, encodePng(SIZE, SIZE, albedo));
  // Normals are derived from the albedo's luminance as a height field. Real
  // scans ship a measured normal; this is the honest approximation, and it is
  // what gives the surface relief under a raking sun.
  const normal = heightToNormal(SIZE, SIZE, albedo, l.bump);
  writeFileSync(`assets/textures/${l.name}_normal.png`, encodePng(SIZE, SIZE, normal));
  console.log(`wrote ${l.name}_albedo.png + _normal.png (${SIZE}x${SIZE})`);
}

// SH-010 — one shared detail normal, tiled ~40x on top of every layer. A 512px
// texture stretched over an 80 m terrain is ~15 cm per texel; ground detail
// breaks down at 2 cm (blade roots, grit, cracks), and this is what covers that
// last order of magnitude without a 4K texture.
const detailSrc = makeTexture(SIZE, SIZE, (x, y) => {
  const nx = x / SIZE, ny = y / SIZE;
  const g = fbm(nx * SIZE, ny * SIZE, 24, 4, 91);
  const v = 90 + g * 130;
  return [v, v, v, 255];
});
const detail = heightToNormal(SIZE, SIZE, detailSrc, 2.0);
writeFileSync('assets/textures/terrain_detail_normal.png', encodePng(SIZE, SIZE, detail));
console.log(`wrote terrain_detail_normal.png (${SIZE}x${SIZE})`);
