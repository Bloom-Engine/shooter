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
  return makeTexture(s, s, (x, y) => {
    const u = x / s, v = y / s;
    // Base fbm noise (wraps via *0.5 trick — not truly seamless but close
    // enough for distant ground).
    const n = fbm(u * 6, v * 6, 4);
    // Small-scale "blade" noise.
    const n2 = fbm(u * 32, v * 32, 2);
    // Mix greens.
    const r = Math.floor(52 + n * 40 + n2 * 12);
    const g = Math.floor(92 + n * 60 + n2 * 20);
    const b = Math.floor(38 + n * 30 + n2 * 10);
    // Occasional dirt speck.
    const speck = hash2((x * 17) | 0, (y * 17) | 0);
    if (speck > 0.985) return [110, 82, 50, 255];
    return [r, g, b, 255];
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
