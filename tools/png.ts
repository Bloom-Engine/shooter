// Minimal PNG encoder — RGBA only, no interlacing, no palette.
//
// Used by the procedural prop / terrain / water generators so we don't need
// an external image library. Output is a valid PNG that Bloom's texture
// loader (stb_image → wgpu) accepts.

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function writeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(out.subarray(4, 8), 0);
  crcInput.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcInput), false);
  return out;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: rgba length mismatch');

  // IHDR
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  ihdr[8]  = 8;   // bit depth
  ihdr[9]  = 6;   // color type: RGBA
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace

  // Raw scanlines with filter byte 0 (None) prefix.
  const raw = new Uint8Array(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    const rowStart = y * width * 4;
    raw.set(rgba.subarray(rowStart, rowStart + width * 4), o);
    o += width * 4;
  }
  const idat = new Uint8Array(deflateSync(raw));

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = writeChunk('IHDR', ihdr);
  const idatChunk = writeChunk('IDAT', idat);
  const iendChunk = writeChunk('IEND', new Uint8Array());

  const out = new Uint8Array(sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let p = 0;
  out.set(sig, p); p += sig.length;
  out.set(ihdrChunk, p); p += ihdrChunk.length;
  out.set(idatChunk, p); p += idatChunk.length;
  out.set(iendChunk, p);
  return out;
}

// -----------------------------------------------------------------------------
// Procedural generators
// -----------------------------------------------------------------------------

// Deterministic 2D value noise. Smooth enough for natural-looking textures.
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 0xFFFFFFFF) / 0xFFFFFFFF;
}
function fade(t: number): number { return t * t * (3 - 2 * t); }
function noise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const u = fade(xf), v = fade(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x: number, y: number, octaves: number): number {
  let s = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    s += amp * noise2(x * freq, y * freq);
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return s / norm;
}

// Periodic (seamless-tiling) value noise. Lattice coords wrap modulo the
// supplied period, so a texture sampled over x,y ∈ [0, period) tiles with no
// visible seam. Returns [0,1] like noise2.
function wrapInt(a: number, p: number): number { return ((a % p) + p) % p; }
function noise2p(x: number, y: number, px: number, py: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(wrapInt(xi, px),     wrapInt(yi, py));
  const b = hash2(wrapInt(xi + 1, px), wrapInt(yi, py));
  const c = hash2(wrapInt(xi, px),     wrapInt(yi + 1, py));
  const d = hash2(wrapInt(xi + 1, px), wrapInt(yi + 1, py));
  const u = fade(xf), v = fade(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
// Seamless fbm over a [0, period) domain. `base` is the lattice cells across
// the tile at octave 0; each octave doubles frequency AND period so the wrap
// stays exact.
function fbmp(u: number, v: number, octaves: number, base: number): number {
  let s = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const p = base * freq;
    s += amp * noise2p(u * p, v * p, p, p);
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return s / norm;
}

// Build an RGBA buffer procedurally via a (x, y) -> [r, g, b, a] callback.
export function makeTexture(width: number, height: number,
                            fn: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  let o = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = fn(x, y);
      out[o++] = c[0] & 0xFF;
      out[o++] = c[1] & 0xFF;
      out[o++] = c[2] & 0xFF;
      out[o++] = c[3] & 0xFF;
    }
  }
  return out;
}

// Grass texture: green fbm + scattered brighter / darker tufts + occasional
// dirt specks. Seamless wrap via modular hash inputs.
export function grassTexture(size: number): Uint8Array {
  const s = size;
  const cb = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : Math.floor(n));
  // fbmp returns [0,1] and tiles seamlessly over u,v ∈ [0,1).
  return makeTexture(s, s, (x, y) => {
    const u = x / s, v = y / s;
    // Three seamless scales: big lush/dry patches, medium tufts, fine blades.
    const patch = fbmp(u, v, 4, 3);
    const clump = fbmp(u, v, 3, 10);
    const blade = fbmp(u, v, 2, 38);
    // Dryness drives a lush-green → olive shift across large areas.
    const dry = Math.max(0, Math.min(1, (patch - 0.34) / 0.40));
    let r = 58 + dry * 54;          // lush 58 → dry/olive 112
    let g = 112 + dry * 6;          // stays green, dry a touch lighter
    let b = 46 + dry * 16;          // lush cool → dry warm
    // Tuft shading: clumps catch light (brighter), gaps recede (darker). A
    // little extra green in the tuft highlights reads as fresh blades. Floor
    // the multiplier so gaps darken without going muddy/near-black.
    const shade = Math.max(0.72, 1 + (clump - 0.5) * 0.4 + (blade - 0.5) * 0.32);
    r *= shade;
    g = g * shade + (clump - 0.5) * 26;
    b *= shade;
    // Sparse dirt/earth patches (low-freq, only the high tail) for variety.
    const dirt = fbmp(u, v, 3, 5);
    if (dirt > 0.66) {
      const dt = Math.min(1, (dirt - 0.66) / 0.14);
      r = r + (118 - r) * dt;
      g = g + (88 - g) * dt;
      b = b + (58 - b) * dt;
    }
    return [cb(r), cb(g), cb(b), 255];
  });
}

// Leaf-cluster cutout texture (RGBA with a real alpha channel) for PUBG-style
// foliage cards: clumpy green leaves with transparent gaps, so an alpha-tested
// quad reads as a clump of leaves instead of a solid card. The alpha is hard
// (0/255) for crisp MASK cutout, faded to transparent near the card border so
// the quad's square edge disappears.
export function leafTexture(size: number): Uint8Array {
  const s = size;
  // NOTE: this project's fbm/noise2 are zero-centred (~[-0.3, 0.3]), not [0,1]
  // — they're designed to be ADDED to a base. Remap accordingly.
  return makeTexture(s, s, (x, y) => {
    const u = x / s, v = y / s;
    const clump  = fbm(u * 4.5, v * 4.5, 4);   // ~[-0.3, 0.3]
    const detail = fbm(u * 22, v * 22, 3);
    // Clump density centred at 0.5; big clumps dominate, detail nibbles edges.
    let mask = 0.5 + clump * 1.7 + detail * 0.8;
    // Fade the card border to transparent so quads don't show a hard square.
    const edge = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
    mask *= fade(Math.min(1, edge / 0.12));
    const a = mask > 0.42 ? 255 : 0;
    // Green with leaf variation (remap the ±0.3 noise to ~0.2..0.8).
    const cd = clump + 0.5, dd = detail + 0.5;
    const yellow = noise2(u * 9 + 3.1, v * 9 + 7.7) + 0.5;
    const shade = 0.72 + dd * 0.55;
    const r = Math.min(255, Math.floor((40 + yellow * 78) * shade));
    const g = Math.min(255, Math.floor((96 + cd * 86) * shade));
    const b = Math.min(255, Math.floor((26 + yellow * 26) * shade));
    return [r, g, b, a];
  });
}

// Grass-blade cutout (RGBA) for scattered ground tufts. A spray of thin
// tapering blades — opaque inside each blade, transparent elsewhere — so an
// alpha-MASK card reads as a clump of grass. Card UVs put v=0 at the card
// BOTTOM, and glTF samples v=0 at the texture TOP, so blade ROOTS live at the
// top row (v=0) and TIPS at the bottom (v→tip height); that lands roots at the
// ground end of the card. Tips are brighter, roots darker (fake AO).
export function grassBladeTexture(size: number): Uint8Array {
  const s = size;
  return makeTexture(s, s, (x, y) => {
    const u = x / s, v = y / s;   // v: 0 = root end, increasing toward tips
    let a = 0, shade = 0;
    const NB = 13;
    for (let i = 0; i < NB; i++) {
      const base = (i + 0.5) / NB + (hash2(i * 3, 1) - 0.5) * 0.04;
      const bh = 0.62 + hash2(i, 11) * 0.36;          // tip height (in v)
      if (v < bh) {
        const lean = (hash2(i, 17) - 0.5) * 0.55;
        const cx = base + lean * (v / bh);             // blade curves over with height
        const w = (0.016 + hash2(i, 7) * 0.018) * (1 - (v / bh) * 0.85);
        if (Math.abs(u - cx) < w) {
          a = 255;
          const sh = 0.42 + (v / bh) * 0.55 + hash2(i, 5) * 0.14;
          if (sh > shade) shade = sh;
        }
      }
    }
    if (a === 0) return [0, 0, 0, 0];
    const g = Math.min(255, Math.floor(72 + shade * 118));
    const r = Math.min(255, Math.floor(40 + shade * 50));
    const b = Math.min(255, Math.floor(26 + shade * 30));
    return [r, g, b, a];
  });
}

// Wildflower cutout (RGBA): a few thin green stems each topped with a small
// coloured blossom (white / yellow / pink / lilac), on transparent. Same UV
// orientation convention as grassBladeTexture (v=0 = root/card-bottom). Adds
// colour pops to the otherwise all-green meadow.
export function flowerTexture(size: number): Uint8Array {
  const s = size;
  const palR = [240, 248, 232, 188];
  const palG = [240, 224, 120, 158];
  const palB = [248, 96, 150, 238];
  const palN = 4;
  return makeTexture(s, s, (x, y) => {
    const u = x / s, v = y / s;       // v: 0 root → increasing toward tip
    let a = 0;
    let cr = 50, cg = 110, cb = 40;
    const NB = 6;
    for (let i = 0; i < NB; i++) {
      const base = (i + 0.5) / NB + (hash2(i * 3, 1) - 0.5) * 0.05;
      const bh = 0.55 + hash2(i, 11) * 0.30;          // blossom height (in v)
      const lean = (hash2(i, 17) - 0.5) * 0.40;
      // Stem.
      if (v < bh) {
        const cx = base + lean * (v / bh);
        const w = 0.011 * (1 - (v / bh) * 0.5);
        if (Math.abs(u - cx) < w) { a = 255; cr = 46; cg = 104; cb = 36; }
      }
      // Blossom at the tip.
      const bcx = base + lean;
      const dx = u - bcx, dy = v - bh;
      const br = 0.045 + hash2(i, 23) * 0.022;
      const dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < br) {
        a = 255;
        // hash2 here is SIGNED (~[-1,1]); take the fractional part for a safe
        // [0,1) → palette index (a raw negative index would read undefined).
        const hv = hash2(i, 31);
        const fr = hv - Math.floor(hv);
        const idx = Math.min(palN - 1, Math.floor(fr * palN));
        if (dd < br * 0.38) { cr = 250; cg = 210; cb = 70; }   // yellow centre
        else { cr = palR[idx]; cg = palG[idx]; cb = palB[idx]; }
      }
    }
    if (a === 0) return [0, 0, 0, 0];
    return [cr, cg, cb, 255];
  });
}

// Bark texture: vertical brown fibres with darker grooves + knots, for the
// tree trunk. Opaque.
export function barkTexture(size: number): Uint8Array {
  const s = size;
  return makeTexture(s, s, (x, y) => {
    const u = x / s, v = y / s;
    // Vertical fibres: high-freq in u (around the trunk), low-freq in v (up).
    // fbm is zero-centred (~±0.3) — remap to ~0.2..0.8.
    const fibre = fbm(u * 26, v * 4, 4) + 0.5;
    const groove = Math.sin(u * Math.PI * 2 * 14 + fbm(u * 5, v * 5, 2) * 6) * 0.5 + 0.5;
    const knot = fbm(u * 3, v * 3, 3) + 0.5;
    const g0 = 0.6 + groove * 0.4;
    const shade = (0.6 + fibre * 0.5) * g0 * (0.85 + knot * 0.3);
    const r = Math.min(255, Math.floor(95 * shade + 30));
    const g = Math.min(255, Math.floor(66 * shade + 22));
    const b = Math.min(255, Math.floor(44 * shade + 14));
    return [r, g, b, 255];
  });
}

// Stone-block wall texture. Running-bond courses of warm-grey blocks with
// recessed dark mortar, per-block tint variation, edge AO, and two scales of
// surface grain. Seamless (fbmp + integer block grid). Tiles at TILE_METRES
// (2 m) in the prop builder, so 3 cols × 4 rows ≈ 0.66 m blocks.
export function stoneTexture(size: number): Uint8Array {
  const s = size;
  const cb = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : Math.floor(n));
  const COLS = 3, ROWS = 4, MORTAR = 0.06;
  return makeTexture(s, s, (x, y) => {
    const u = x / s, v = y / s;
    const rowF = v * ROWS;
    const row = Math.floor(rowF);
    const fbv = rowF - row;
    const bu = u * COLS + (row % 2) * 0.5;     // running-bond half-offset
    const col = Math.floor(bu);
    const fbu = bu - col;
    const eu = Math.min(fbu, 1 - fbu);
    const ev = Math.min(fbv, 1 - fbv);
    const m = Math.min(eu, ev);                // distance to nearest mortar
    const bid = hash2(col + (row % 2) * 977, row);   // stable per-block tint
    const grain = fbmp(u, v, 4, 24);           // fine pitting
    const blot  = fbmp(u, v, 3, 6);            // larger weathering blotches
    let base = 98 + bid * 42 + (grain - 0.5) * 44 + (blot - 0.5) * 30;
    // Edge AO: blocks darken toward their borders (chamfer/shadow).
    base *= 0.78 + 0.22 * Math.min(1, m / 0.16);
    let r = base * 1.04, g = base * 0.99, b = base * 0.88;
    if (m < MORTAR) { const d = 0.46; r *= d; g *= d; b *= d; }  // recessed mortar
    return [cb(r), cb(g), cb(b), 255];
  });
}

// Wood-plank texture (crates / props). Vertical planks separated by dark gaps,
// each plank a slightly different warm-brown tone, with along-grain streaks.
export function woodTexture(size: number): Uint8Array {
  const s = size;
  const cb = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : Math.floor(n));
  const PLANKS = 4;
  return makeTexture(s, s, (x, y) => {
    const u = x / s, v = y / s;
    const pf = u * PLANKS;
    const p = Math.floor(pf);
    const fp = pf - p;
    const pid = hash2(p, 7);
    // Grain runs along the plank (v): high-freq across (u), low along (v).
    const grain = fbmp(u, v * 0.5, 4, 32);
    const streak = Math.sin((fp + (grain - 0.5) * 0.6) * Math.PI * 3.0) * 0.5 + 0.5;
    let base = 120 + pid * 40 + (grain - 0.5) * 36 + streak * 22;
    const gap = Math.min(fp, 1 - fp) < 0.04 ? 0.5 : 1.0;   // dark seam between planks
    base *= gap;
    return [cb(base * 1.0), cb(base * 0.72), cb(base * 0.46), 255];
  });
}

// Brushed-metal texture: cool grey with fine horizontal brushing + a few darker
// streaks. Low roughness in the material; this just supplies albedo variation.
export function metalTexture(size: number): Uint8Array {
  const s = size;
  const cb = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : Math.floor(n));
  return makeTexture(s, s, (x, y) => {
    const u = x / s, v = y / s;
    const brush = fbmp(u * 0.25, v, 3, 64);     // streaky along u
    const blot = fbmp(u, v, 3, 8);
    let base = 150 + (brush - 0.5) * 60 + (blot - 0.5) * 24;
    return [cb(base * 0.96), cb(base * 0.97), cb(base * 1.02), 255];
  });
}

// Floor texture: warm wooden boards laid along one axis, darker board seams,
// per-board tone variation. Seamless.
export function floorTexture(size: number): Uint8Array {
  const s = size;
  const cb = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : Math.floor(n));
  const BOARDS = 4;
  return makeTexture(s, s, (x, y) => {
    const u = x / s, v = y / s;
    const bf = v * BOARDS;
    const b = Math.floor(bf);
    const fb = bf - b;
    const bid = hash2(b, 31);
    const grain = fbmp(u * 0.5, v, 4, 40);
    let base = 132 + bid * 34 + (grain - 0.5) * 40;
    const seam = Math.min(fb, 1 - fb) < 0.035 ? 0.55 : 1.0;
    base *= seam;
    return [cb(base * 0.92), cb(base * 0.68), cb(base * 0.44), 255];
  });
}

// Water texture: deep-blue gradient with ripple lines + lighter highlights.
// UV flow scrolling in the shader gives the sense of current.
export function waterTexture(size: number): Uint8Array {
  const s = size;
  return makeTexture(s, s, (x, y) => {
    const u = x / s, v = y / s;
    const n = fbm(u * 3, v * 8, 3);
    const ripple = Math.sin(v * 18 + n * 4) * 0.5 + 0.5;
    const r = Math.floor(40 + n * 20 + ripple * 30);
    const g = Math.floor(80 + n * 35 + ripple * 45);
    const b = Math.floor(130 + n * 40 + ripple * 50);
    // slight transparency variance
    const a = Math.floor(180 + ripple * 50);
    return [r, g, b, a];
  });
}
