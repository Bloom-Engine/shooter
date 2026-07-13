// Look at the music before cutting it.
//
//   bun tools/music-inspect.ts
//
// Prints tempo/level stats and renders an RMS envelope PNG per track into
// tools/.testout/music/, so the loop points can be chosen by LOOKING at where the
// arrangement is at full strength rather than by guessing at timestamps.

import { readWav, toMono, onsetEnvelope, estimateTempo, beatPhase, rmsDb, estimateKey, HOP } from './audio';
import { encodePng } from './png';
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const SRC = 'assets/music';
const OUT = 'tools/.testout/music';

const W = 1600, H = 200;

function plot(name: string, mono: Float32Array, sr: number, bpm: number, phase: number): void {
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    px[i * 4 + 0] = 18; px[i * 4 + 1] = 20; px[i * 4 + 2] = 26; px[i * 4 + 3] = 255;
  }
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  };

  // 10-second gridlines.
  const dur = mono.length / sr;
  for (let t = 0; t < dur; t += 10) {
    const x = Math.floor((t / dur) * W);
    for (let y = 0; y < H; y++) set(x, y, 42, 46, 58);
  }
  // Bar lines, if we have a tempo worth believing.
  if (bpm > 0) {
    const barSec = 4 * 60 / bpm;
    for (let t = phase / sr; t < dur; t += barSec) {
      const x = Math.floor((t / dur) * W);
      for (let y = H - 12; y < H; y++) set(x, y, 90, 70, 40);
    }
  }

  // Peak envelope, column by column.
  const per = Math.max(1, Math.floor(mono.length / W));
  for (let x = 0; x < W; x++) {
    let peak = 0;
    const off = x * per;
    for (let i = 0; i < per && off + i < mono.length; i++) {
      const v = Math.abs(mono[off + i]);
      if (v > peak) peak = v;
    }
    const h = Math.min(H / 2 - 2, peak * (H / 2 - 2));
    for (let y = Math.floor(H / 2 - h); y <= Math.floor(H / 2 + h); y++) {
      set(x, y, 110, 200, 130);
    }
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.png`, encodePng(W, H, px));
}

const files = readdirSync(SRC).filter(f => f.endsWith('.wav')).sort();
for (const f of files) {
  const w = readWav(`${SRC}/${f}`);
  const mono = toMono(w);
  const env = onsetEnvelope(mono, w.sampleRate);
  const t = estimateTempo(env, w.sampleRate);
  const phase = beatPhase(env, w.sampleRate, t.bpm, 4);
  const db = rmsDb(mono, HOP);

  // Where does the track sit at full strength? (Loudest 10 s window.)
  const win = Math.floor(10 * w.sampleRate / HOP);
  let bestSum = -Infinity, bestAt = 0;
  let run = 0;
  for (let i = 0; i < db.length; i++) {
    run += db[i];
    if (i >= win) run -= db[i - win];
    if (i >= win && run > bestSum) { bestSum = run; bestAt = (i - win) * HOP / w.sampleRate; }
  }
  let peak = 0;
  for (let i = 0; i < w.data.length; i++) { const v = Math.abs(w.data[i]); if (v > peak) peak = v; }

  const dur = w.frames / w.sampleRate;
  const barSec = 4 * 60 / t.bpm;
  const key = estimateKey(mono, w.sampleRate);
  console.log(
    `${f.padEnd(22)} ${dur.toFixed(1).padStart(6)}s  ` +
    `bpm=${t.bpm.toFixed(1).padStart(5)} (conf ${t.confidence.toFixed(1).padStart(4)})  ` +
    `key=${key.name.padEnd(9)} (2nd ${key.runnerUp.padEnd(9)})  ` +
    `peak=${(20 * Math.log10(peak + 1e-9)).toFixed(1)}dB  loud10s@${bestAt.toFixed(0)}s`);
  plot(f.replace('.wav', ''), mono, w.sampleRate, t.bpm, phase);
}
console.log(`\nplots -> ${OUT}/`);
