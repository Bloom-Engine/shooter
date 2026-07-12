// Generates the particle + decal atlases (SH-033 / EN-026 / EN-027).
//
// These are procedural stand-ins, deliberately. The *systems* they feed are
// the real thing — pool, sim, instancing, blending — and swapping in
// hand-authored or photographic art is a file drop with no code change (see
// docs/ASSET-TODO.md T2/T3). Generating them here means the VFX round is
// testable and shippable today instead of blocked on sourcing.
//
//   bun tools/build-vfx-textures.ts
//
// Layout: both atlases are 4x4 grids of 256px cells (1024x1024). The shader
// gets a cell index in instance_extra and maps UVs into it.

import { encodePng } from './png';
import { writeFileSync, mkdirSync } from 'fs';

// One PNG per effect, not one packed atlas. Custom materials can only bind
// texture *arrays* (the per-material bind group hardwires a white stub into
// the plain 2D slots), and an array layer per effect is strictly better than
// an atlas cell anyway: no UV mapping, no bilinear bleed between neighbours,
// and mips that don't smear one effect into the next.
const CELL = 256;
const GRID = 1;
const SIZE = CELL;

// Deterministic RNG so re-running the tool doesn't churn the committed PNGs.
let seed = 0x2F6E2B1;
function rnd(): number {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return (seed & 0xffffff) / 0xffffff;
}

function px(buf: Uint8Array, x: number, y: number, r: number, g: number, b: number, a: number) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const o = (y * SIZE + x) * 4;
  // Premultiply-free straight alpha; the materials handle blending.
  buf[o] = Math.max(0, Math.min(255, r | 0));
  buf[o + 1] = Math.max(0, Math.min(255, g | 0));
  buf[o + 2] = Math.max(0, Math.min(255, b | 0));
  buf[o + 3] = Math.max(0, Math.min(255, a | 0));
}

/// Value noise, smoothed — used for the wispy edges that keep a puff from
/// reading as a circle.
function fbm(x: number, y: number, oct: number): number {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < oct; o++) {
    const xi = Math.floor(x * f), yi = Math.floor(y * f);
    const xf = x * f - xi, yf = y * f - yi;
    const h = (a: number, b: number) => {
      const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const n00 = h(xi, yi), n10 = h(xi + 1, yi), n01 = h(xi, yi + 1), n11 = h(xi + 1, yi + 1);
    v += amp * ((n00 * (1 - u) + n10 * u) * (1 - w) + (n01 * (1 - u) + n11 * u) * w);
    amp *= 0.5; f *= 2;
  }
  return v;
}

type CellFn = (buf: Uint8Array, ox: number, oy: number) => void;

function render(cell: CellFn): Uint8Array {
  const buf = new Uint8Array(SIZE * SIZE * 4);
  cell(buf, 0, 0);
  return buf;
}

function emit(name: string, cell: CellFn) {
  writeFileSync(`assets/textures/${name}.png`, encodePng(SIZE, SIZE, render(cell)));
  console.log(`wrote assets/textures/${name}.png (${SIZE}x${SIZE})`);
}

// ---- Particle atlas cells ---------------------------------------------------

/// 0: soft smoke puff — noisy falloff so scale-up doesn't reveal a hard disc.
const smoke: CellFn = (buf, ox, oy) => {
  const c = CELL / 2;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const dx = (x - c) / c, dy = (y - c) / c;
    const d = Math.sqrt(dx * dx + dy * dy);
    const n = fbm(x / CELL * 4, y / CELL * 4, 4);
    // Push the edge in/out by the noise: a lumpy silhouette, not a ball.
    const edge = 0.62 + (n - 0.5) * 0.45;
    let a = 1 - d / edge;
    a = Math.max(0, Math.min(1, a));
    a = a * a * (0.55 + 0.45 * n);
    const v = 200 + n * 55;
    px(buf, ox + x, oy + y, v, v, v, a * 255);
  }
};

/// 1: hot spark — tight core, fast falloff. Additive, so RGB carries the heat.
const spark: CellFn = (buf, ox, oy) => {
  const c = CELL / 2;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const dx = (x - c) / c, dy = (y - c) / c;
    const d = Math.sqrt(dx * dx + dy * dy);
    const core = Math.max(0, 1 - d / 0.30);
    const glow = Math.max(0, 1 - d / 0.85);
    const a = Math.min(1, core * core * 1.2 + glow * glow * 0.35);
    px(buf, ox + x, oy + y, 255, 200 + core * 55, 120 + core * 100, a * 255);
  }
};

/// 2: blood/fluid droplet — irregular blob with a couple of satellites, so a
/// burst doesn't read as identical circles.
const droplet: CellFn = (buf, ox, oy) => {
  const c = CELL / 2;
  const sats: number[][] = [];
  for (let i = 0; i < 3; i++) {
    sats.push([c + (rnd() - 0.5) * CELL * 0.5, c + (rnd() - 0.5) * CELL * 0.5, CELL * (0.05 + rnd() * 0.06)]);
  }
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const dx = x - c, dy = y - c;
    const d = Math.sqrt(dx * dx + dy * dy);
    const n = fbm(x / CELL * 3, y / CELL * 3, 3);
    let a = Math.max(0, 1 - d / (CELL * (0.30 + (n - 0.5) * 0.12)));
    for (const s of sats) {
      const sd = Math.sqrt((x - s[0]) ** 2 + (y - s[1]) ** 2);
      a = Math.max(a, Math.max(0, 1 - sd / s[2]));
    }
    a = Math.min(1, a * 1.6);
    px(buf, ox + x, oy + y, 255, 255, 255, a * 255);
  }
};

/// 3: muzzle flash star — 6-point, hot centre.
const flash: CellFn = (buf, ox, oy) => {
  const c = CELL / 2;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const dx = (x - c) / c, dy = (y - c) / c;
    const d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
    const ang = Math.atan2(dy, dx);
    const spikes = Math.abs(Math.cos(ang * 3)) * 0.55 + 0.45;
    const core = Math.max(0, 1 - d / 0.22);
    const ray = Math.max(0, 1 - d / (0.95 * spikes));
    const a = Math.min(1, core * 1.4 + Math.pow(ray, 2.5) * 0.8);
    px(buf, ox + x, oy + y, 255, 235, 170, a * 255);
  }
};

/// 4: dust — flatter, browner, wider than smoke.
const dust: CellFn = (buf, ox, oy) => {
  const c = CELL / 2;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const dx = (x - c) / c, dy = (y - c) / c;
    const d = Math.sqrt(dx * dx + dy * dy);
    const n = fbm(x / CELL * 5, y / CELL * 5, 4);
    let a = Math.max(0, 1 - d / (0.70 + (n - 0.5) * 0.4));
    a = Math.pow(a, 1.6) * (0.4 + 0.6 * n);
    px(buf, ox + x, oy + y, 214, 198, 168, a * 200);
  }
};

/// 5: shell casing — a little brass cylinder, seen side-on.
const shell: CellFn = (buf, ox, oy) => {
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const u = x / CELL, v = y / CELL;
    const inBody = u > 0.36 && u < 0.64 && v > 0.20 && v < 0.80;
    if (!inBody) { px(buf, ox + x, oy + y, 0, 0, 0, 0); continue; }
    // Cylindrical shading across the width + a darker rim at the base.
    const across = (u - 0.36) / 0.28;
    const shade = Math.sin(across * Math.PI);
    const base = v > 0.72 ? 0.65 : 1.0;
    const r = (150 + 105 * shade) * base;
    const g = (115 + 90 * shade) * base;
    const b = (40 + 45 * shade) * base;
    px(buf, ox + x, oy + y, r, g, b, 255);
  }
};

// ---- Decal atlas cells ------------------------------------------------------

/// 0: bullet hole in stone — dark pit, bright chipped rim, radial cracks.
const bulletHole: CellFn = (buf, ox, oy) => {
  const c = CELL / 2;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const dx = (x - c) / c, dy = (y - c) / c;
    const d = Math.sqrt(dx * dx + dy * dy);
    const ang = Math.atan2(dy, dx);
    const n = fbm(x / CELL * 6, y / CELL * 6, 3);
    // Cracks: a few radial spokes of varying length.
    const crack = Math.pow(Math.abs(Math.cos(ang * 2.5 + n * 3)), 12) * (1 - d) * 0.5;
    const pit = Math.max(0, 1 - d / (0.30 + (n - 0.5) * 0.08));
    const rim = Math.max(0, 1 - Math.abs(d - 0.36) / 0.16);
    let a = Math.min(1, pit * 1.5 + rim * 0.7 + crack);
    if (d > 0.62) a = 0;
    // Dark hole, pale dust rim.
    const dark = pit;
    const r = 40 + (1 - dark) * 150;
    px(buf, ox + x, oy + y, r * 0.9, r * 0.88, r * 0.85, a * 255);
  }
};

/// 1: scorch — soft sooty ring, no hard edge.
const scorch: CellFn = (buf, ox, oy) => {
  const c = CELL / 2;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const dx = (x - c) / c, dy = (y - c) / c;
    const d = Math.sqrt(dx * dx + dy * dy);
    const n = fbm(x / CELL * 4, y / CELL * 4, 4);
    let a = Math.max(0, 1 - d / (0.75 + (n - 0.5) * 0.3));
    a = Math.pow(a, 1.8) * (0.5 + 0.5 * n);
    const v = 25 + n * 30;
    px(buf, ox + x, oy + y, v, v * 0.95, v * 0.9, a * 235);
  }
};

/// 2: blood splat — irregular centre with cast-off droplets and a couple of
/// runs. Straight white so the material can tint it per alien kind.
const splat: CellFn = (buf, ox, oy) => {
  const c = CELL / 2;
  const blobs: number[][] = [[c, c, CELL * 0.26]];
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const r = CELL * (0.18 + rnd() * 0.26);
    blobs.push([c + Math.cos(a) * r, c + Math.sin(a) * r, CELL * (0.02 + rnd() * 0.07)]);
  }
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const n = fbm(x / CELL * 5, y / CELL * 5, 3);
    let a = 0;
    for (const b of blobs) {
      const d = Math.sqrt((x - b[0]) ** 2 + (y - b[1]) ** 2);
      a = Math.max(a, Math.max(0, 1 - d / (b[2] * (0.8 + n * 0.5))));
    }
    a = Math.min(1, a * 1.8);
    px(buf, ox + x, oy + y, 255, 255, 255, a * 255);
  }
};

/// 3: crater/impact ring for the cannon — bigger, dirt-toned.
const crater: CellFn = (buf, ox, oy) => {
  const c = CELL / 2;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const dx = (x - c) / c, dy = (y - c) / c;
    const d = Math.sqrt(dx * dx + dy * dy);
    const n = fbm(x / CELL * 5, y / CELL * 5, 4);
    const bowl = Math.max(0, 1 - d / (0.55 + (n - 0.5) * 0.14));
    const ejecta = Math.max(0, 1 - Math.abs(d - 0.66) / 0.22) * n;
    let a = Math.min(1, bowl * 1.3 + ejecta * 0.8);
    if (d > 0.92) a = 0;
    const v = 60 + (1 - bowl) * 70 + n * 30;
    px(buf, ox + x, oy + y, v * 1.05, v * 0.92, v * 0.78, a * 245);
  }
};

// ---- Emit -------------------------------------------------------------------

mkdirSync('assets/textures', { recursive: true });

// LAYER ORDER IS THE ABI. src/vfx.ts indexes these by number (PTEX_*/DTEX_*);
// reordering here silently swaps smoke for blood in game.
emit('vfx_smoke', smoke);      // particle layer 0
emit('vfx_spark', spark);      // particle layer 1
emit('vfx_droplet', droplet);  // particle layer 2
emit('vfx_flash', flash);      // particle layer 3
emit('vfx_dust', dust);        // particle layer 4
emit('vfx_shell', shell);      // particle layer 5

emit('decal_bullet', bulletHole); // decal layer 0
emit('decal_scorch', scorch);     // decal layer 1
emit('decal_splat', splat);       // decal layer 2
emit('decal_crater', crater);     // decal layer 3
