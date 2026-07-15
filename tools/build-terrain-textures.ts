// SH-009 / SH-010 / SH-050 — the four terrain splat layers + a shared detail
// normal.
//
// The ground is the single most-looked-at surface in the game and until now it
// had NO texture at any scale: `terrain.wgsl` blended three colour stops by a
// hash-noise, so pressing the camera to the floor showed a smooth gradient.
// This generates the layers that fix that.
//
//   bun tools/fetch-external-textures.ts   # once — get the sources
//   bun tools/build-terrain-textures.ts
//
// SH-050 — THE LAYERS ARE NOW REAL CC0 PHOTOSCANS (ASSET-TODO T1). SH-009
// shipped procedural stand-ins and promised the swap would be a file drop; this
// is that drop. What changed, and why it matters more than the resolution bump:
//
//   - ALBEDO is a photograph of ground instead of two octaves of value noise.
//     The old layers were *statistically* like grass — the right colours at the
//     right frequencies — with none of the structure a real surface has, which
//     is why they read as cartoon from any distance.
//   - NORMALS ARE MEASURED, not guessed. The old ones were Sobel'd out of the
//     albedo's luminance, which assumes dark = deep. On grass that is simply
//     false (a dark blade is not a pit), so the relief actively fought the
//     light. Poly Haven ships a real nor_gl per set — already the engine's
//     convention (green up), no conversion.
//
// The procedural generators BELOW ARE KEPT and still run for any layer whose
// external set is missing, so a checkout without assets/textures/external/
// still builds a complete array — the same contract build-props.ts documents.
//
// LAYER ORDER (indexed by terrain.wgsl — do not reorder):
//   0 grass_lush   1 grass_dry   2 dirt   3 rock
//
// PHYSICAL SCALE: each source is a scan of a known real-world extent, recorded
// in SOURCES.md and in LAYERS below. terrain.wgsl scales each layer by its own
// size so a pebble is its real size; if you swap a source, update sizeM there
// AND the per-layer multiplier in main.ts's TERRAIN_PARAMS, or the new texture
// arrives at the old texture's scale.

import { encodePng, makeTexture, heightToNormal } from './png';
import { loadRgbaExact } from './imgutil';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

// 512 -> 1024. At the ~2 m tiling period these layers are authored for, 512
// spends ~4 mm on a texel; the scans resolve grit finer than that, and the
// ground is the surface the camera gets closest to.
//
// MEASURED, same binary, only the PNGs swapped (FPSPROBE harness, title screen,
// 240-frame wall-clock window):
//   512²  -> 26.69 fps
//   1024² -> 26.50 fps
// 0.19 fps, i.e. nothing. It costs ~37 MB more VRAM (four albedo + five normal
// slices with mips: ~12 MB -> ~50 MB) for no measurable frame time, because
// mips keep the texel:pixel ratio at any given distance unchanged — the bigger
// texture only supplies detail the near field was already asking for and not
// getting.
const SIZE = 1024;
const EXT = 'assets/textures/external';

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
/// `x`/`y` are PIXEL coordinates; each octave maps the texture across `f` noise
/// cells and wraps the hash at `f`, which is what makes the sum seamless.
///
/// SH-050 — this used to read `vnoise(x * f / SIZE * SIZE, ...)`, which parses
/// as `((x*f)/SIZE)*SIZE` — i.e. exactly `x*f`, the `/SIZE` and `*SIZE`
/// cancelling. With integer pixel coords in, every sample landed precisely on a
/// lattice point (fract == 0), and the hash wraps that at period f, where
/// `(x*f) % f` is 0 for every x. So every texel of every octave returned
/// hash(0,0) and fbm was A CONSTANT.
///
/// It went unnoticed because the two things it fed both hid it: the layer
/// albedos summed it with a separate `vnoise` streak term that DID vary (the
/// constant just shifted their brightness), and the detail normal — which is
/// pure fbm — came out a uniform (127,127,255), the exact encoding of "flat".
/// A no-op normal map is invisible; it does not look broken, it looks like
/// nothing, which is why SH-010's detail pass has been dead since it shipped.
/// Verify with: distinct colour count of terrain_detail_normal.png must be
/// thousands, not 1.
function fbm(x: number, y: number, base: number, oct: number, salt: number): number {
  let v = 0, amp = 0.5, f = base;
  for (let o = 0; o < oct; o++) {
    v += amp * vnoise(x * f / SIZE, y * f / SIZE, f, salt + o * 13);
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

/// A layer: a CC0 photoscan when we have one, the procedural generator above
/// when we do not. `src` names the external set (folder and filename stem are
/// both the Poly Haven asset id); `sizeM` is its real-world extent, which
/// main.ts turns into that layer's UV scale.
interface Layer {
  name: string;                          // output stem
  src: string | null;                    // external asset id, or null = procedural
  sizeM: number;                         // source's real-world extent, metres
  fn: (x: number, y: number) => Px;      // procedural fallback albedo
  bump: number;                          // fallback heightToNormal strength
}
const LAYERS: Layer[] = [
  { name: 'terrain_grass_lush', src: 'forrest_ground_01', sizeM: 2.0,  fn: grassLush, bump: 2.5 },
  { name: 'terrain_grass_dry',  src: 'withered_grass',    sizeM: 2.0,  fn: grassDry,  bump: 2.2 },
  { name: 'terrain_dirt',       src: 'brown_mud_dry',     sizeM: 1.3,  fn: dirt,      bump: 3.5 },
  { name: 'terrain_rock',       src: 'cliff_side',        sizeM: 1.83, fn: rock,      bump: 5.0 },
];

/// Path to one map of an external set, or null when it is not on disk.
function srcMap(id: string, map: string): string | null {
  const p = `${EXT}/${id}/${id}_${map}_2k.jpg`;
  return existsSync(p) ? p : null;
}

for (const l of LAYERS) {
  const diff = l.src ? srcMap(l.src, 'diff') : null;
  const nor  = l.src ? srcMap(l.src, 'nor_gl') : null;

  // Albedo — photoscan if present, else the procedural stand-in.
  let albedo: Uint8Array;
  if (diff) {
    albedo = loadRgbaExact(diff, SIZE).rgba;
  } else {
    albedo = makeTexture(SIZE, SIZE, l.fn);
  }
  writeFileSync(`assets/textures/${l.name}_albedo.png`, encodePng(SIZE, SIZE, albedo));

  // Normal — the scan's MEASURED nor_gl if present. Poly Haven's _nor_gl is
  // OpenGL-convention tangent space (+Y up in green), which is already what the
  // engine decodes (`v * 2/255 - 1`) and what heightToNormal emitted, so it
  // needs no channel flip. Without a scan, fall back to Sobel-from-luminance.
  let normal: Uint8Array;
  if (nor) {
    normal = loadRgbaExact(nor, SIZE).rgba;
  } else {
    normal = heightToNormal(SIZE, SIZE, albedo, l.bump);
  }
  writeFileSync(`assets/textures/${l.name}_normal.png`, encodePng(SIZE, SIZE, normal));

  const how = diff ? `scan ${l.src} (${l.sizeM} m)` : 'PROCEDURAL fallback';
  const nhow = nor ? 'measured normal' : 'normal from luminance';
  console.log(`wrote ${l.name}_albedo/_normal.png ${SIZE}² — ${how}, ${nhow}`);
}

// SH-010 — one shared detail normal, tiled ~6x on top of every layer, covering
// the last order of magnitude (grit, blade roots) below what a tiled macro
// texture resolves.
//
// It stays PROCEDURAL on purpose while the layers went photographic: it is
// high-frequency grain with no structure to get wrong, which is the one thing
// value noise is actually good at.
//
// It MUST be generated at SIZE. It rides slice 4 of the normal array, and
// createTextureArrayFromFiles takes the FIRST file's dimensions and SKIPS any
// slice that mismatches — with only a warning. A 512² detail map next to 1024²
// layers would not fail the build, it would silently drop the detail normal.
const detailSrc = makeTexture(SIZE, SIZE, (x, y) => {
  const nx = x / SIZE, ny = y / SIZE;
  const g = fbm(nx * SIZE, ny * SIZE, 24, 4, 91);
  const v = 90 + g * 130;
  return [v, v, v, 255];
});
const detail = heightToNormal(SIZE, SIZE, detailSrc, 2.0);
writeFileSync('assets/textures/terrain_detail_normal.png', encodePng(SIZE, SIZE, detail));
console.log(`wrote terrain_detail_normal.png (${SIZE}x${SIZE})`);
