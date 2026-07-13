// Prove the loops actually loop.
//
//   bun tools/music-loopcheck.ts
//
// For each bed, writes:
//   tools/.testout/music/loopcheck_<name>.wav  — the loop played TWICE, back to
//       back. The join is at the exact midpoint. If you can hear where it is,
//       the loop is wrong. This is the only test that really counts, and it is
//       the one only a human can run.
//   tools/.testout/music/wrap_<name>.png       — the 2 s either side of the wrap,
//       with the join marked. A level jump or a dead spot shows up here.

import { readWav, writeWav, toMono, Wav } from './audio';
import { encodePng } from './png';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'tools/.testout/music';
const BEDS = ['music_calm', 'music_combat', 'music_menu'];

mkdirSync(OUT, { recursive: true });

for (const name of BEDS) {
  const w = readWav(`assets/music/${name}.wav`);
  const ch = w.channels;

  // Twice through, so the join is audible if it is audible at all.
  const dbl: Wav = {
    sampleRate: w.sampleRate, channels: ch, frames: w.frames * 2,
    data: new Float32Array(w.data.length * 2),
  };
  dbl.data.set(w.data, 0);
  dbl.data.set(w.data, w.data.length);
  writeWav(`${OUT}/loopcheck_${name}.wav`, dbl);

  // Plot the 2 s either side of the wrap.
  const win = Math.round(2.0 * w.sampleRate);
  const mono = toMono(w);
  const W = 1200, H = 220;
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    px[i * 4] = 18; px[i * 4 + 1] = 20; px[i * 4 + 2] = 26; px[i * 4 + 3] = 255;
  }
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  };
  // Left half = the END of the loop; right half = the START. Played back to back
  // this is exactly what the ear hears at the wrap.
  const per = Math.max(1, Math.floor(win / (W / 2)));
  for (let x = 0; x < W; x++) {
    const fromEnd = x < W / 2;
    const k = fromEnd ? x : x - W / 2;
    const base = fromEnd ? (mono.length - win) + k * per : k * per;
    let peak = 0;
    for (let i = 0; i < per; i++) {
      const idx = base + i;
      if (idx < 0 || idx >= mono.length) continue;
      const v = Math.abs(mono[idx]);
      if (v > peak) peak = v;
    }
    const h = Math.min(H / 2 - 2, peak * (H / 2 - 2));
    for (let y = Math.floor(H / 2 - h); y <= Math.floor(H / 2 + h); y++) {
      set(x, y, 110, 200, 130);
    }
  }
  for (let y = 0; y < H; y++) set(Math.floor(W / 2), y, 240, 90, 90);   // the join

  writeFileSync(`${OUT}/wrap_${name}.png`, encodePng(W, H, px));

  // Numbers, so this is not purely a vibe check: level either side of the join.
  const rms = (from: number, n: number) => {
    let e = 0;
    for (let i = 0; i < n; i++) { const v = mono[from + i]; e += v * v; }
    return 20 * Math.log10(Math.sqrt(e / n) + 1e-9);
  };
  const half = Math.round(0.5 * w.sampleRate);
  const before = rms(mono.length - half, half);
  const after = rms(0, half);
  console.log(`${name.padEnd(14)} ${(w.frames / w.sampleRate).toFixed(1)}s  ` +
    `level into the wrap ${before.toFixed(1)}dB -> out of it ${after.toFixed(1)}dB  ` +
    `(delta ${Math.abs(before - after).toFixed(1)}dB ${Math.abs(before - after) < 3 ? 'OK' : '** CHECK **'})`);
}
console.log(`\nlisten: ${OUT}/loopcheck_*.wav  (the join is at the exact midpoint)`);
