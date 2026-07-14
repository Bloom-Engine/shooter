// Turn what Suno hands back into what the game needs.
//
//   bun tools/music-master.ts
//
// Reads assets/music/src/*.wav (the raw Suno renders) and writes the game's
// assets/music/*.wav. Re-runnable: the sources are never modified.
//
// Two jobs.
//
// BEDS (calm / combat / menu) must LOOP FOREVER. Suno writes songs — they fade in,
// they build, they end. So we cut a chunk out of the middle and crossfade the seam:
// the tail of the loop is blended with the audio that *followed* the cut, so when
// it wraps, the music continues into itself instead of jumping.
//
// The loop point is SEARCHED, not assumed. I do not trust the tempo estimate to
// pick it — at hop 512 the autocorrelation bins around 120 BPM are 119.7 and 122.3,
// so two tracks that are both 120 land in different bins and appear to disagree by
// 2%. Instead we score candidate (start, length) pairs by how similar the music
// actually sounds at `start` and at `start + length`, which is precisely what makes
// a crossfade inaudible, and which self-corrects any tempo error.
//
// STINGERS are one-shots played OVER the bed. They must be short and end in silence.
// Suno returned 9 s, 24 s and 49 s pieces, and the payload is not always at the
// front — the victory swell does not land until 0:29. The windows below were read
// off the rendered waveforms (tools/music-inspect.ts) rather than guessed.

import { readWav, writeWav, toMono, onsetEnvelope, estimateTempo, rmsDb, Wav, HOP } from './audio';
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';

const SRC = 'assets/music/src';
const OUT = 'assets/music';

/// Crossfade length at the loop seam. About one bar at 120 BPM — long enough to
/// hide a chord change, short enough not to smear the downbeat.
const XFADE_SEC = 1.6;

/// Leave the outputs a hair below full scale. The game's mixer scales these down
/// anyway; the point is only that no two files differ wildly in loudness.
const PEAK_DBFS = -1.5;

interface BedSpec {
  name: string;
  /// Candidate loop lengths, in bars. Longer is less repetitive; the search takes
  /// the best-scoring one, biased toward longer.
  bars: number[];
  /// Ignore this much at the head and tail — that is where the intro and the
  /// outro fade live, and a loop must contain neither.
  skipHead: number;
  skipTail: number;
}

const BEDS: BedSpec[] = [
  { name: 'music_calm',   bars: [32, 24, 16], skipHead: 8,  skipTail: 8 },
  { name: 'music_combat', bars: [24, 16],     skipHead: 4,  skipTail: 6 },
  { name: 'music_menu',   bars: [32, 24, 16], skipHead: 10, skipTail: 10 },
];

interface StingSpec {
  name: string;
  /// Seconds into the source. Read off the waveform plots.
  start: number;
  len: number;
  /// Fade the tail to silence over this long — a stinger that stops dead clicks,
  /// and one that stops *abruptly* sounds like a bug in the game.
  fadeOut: number;
}

const STINGS: StingSpec[] = [
  // Already a stinger: hits at 0, swells, decays to silence by ~7 s. Just shorten it.
  { name: 'sting_wave_clear', start: 0.05, len: 5.0, fadeOut: 1.6 },
  // The collapse is right at the front; it decays through ~8 s.
  { name: 'sting_death',      start: 0.45, len: 4.0, fadeOut: 1.4 },
  // The swell does not LAND until ~0:29. Taking the first 4 s would ship an intro.
  { name: 'sting_victory',    start: 28.0, len: 5.0, fadeOut: 1.8 },
];

// ---- helpers ----------------------------------------------------------------

function slice(w: Wav, startFrame: number, frames: number): Wav {
  const ch = w.channels;
  const data = new Float32Array(frames * ch);
  data.set(w.data.subarray(startFrame * ch, (startFrame + frames) * ch));
  return { sampleRate: w.sampleRate, channels: ch, data, frames };
}

function normalize(w: Wav, targetDb: number): void {
  let peak = 0;
  for (let i = 0; i < w.data.length; i++) {
    const v = Math.abs(w.data[i]);
    if (v > peak) peak = v;
  }
  if (peak < 1e-6) return;
  const target = Math.pow(10, targetDb / 20);
  const g = target / peak;
  for (let i = 0; i < w.data.length; i++) w.data[i] *= g;
}

/// Spectral-ish fingerprint of a window: per-frame RMS (dB) and zero-crossing rate.
/// Cheap, and enough to tell "these two moments sound alike" from "one is a drum
/// break and the other is a pad".
function features(mono: Float32Array, start: number, frames: number): Float32Array {
  const n = Math.floor(frames / HOP);
  const f = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    let e = 0, zc = 0;
    const off = start + i * HOP;
    let prev = mono[off];
    for (let j = 0; j < HOP; j++) {
      const v = mono[off + j];
      e += v * v;
      if ((v >= 0) !== (prev >= 0)) zc++;
      prev = v;
    }
    f[i * 2 + 0] = 20 * Math.log10(Math.sqrt(e / HOP) + 1e-6);
    f[i * 2 + 1] = (zc / HOP) * 100;   // scaled into the same rough range as dB
  }
  return f;
}

function featDist(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}

// ---- bed: find and cut the loop ---------------------------------------------

function masterBed(spec: BedSpec): void {
  const w = readWav(`${SRC}/${spec.name}.wav`);
  const sr = w.sampleRate;
  const mono = toMono(w);

  const env = onsetEnvelope(mono, sr);
  const tempo = estimateTempo(env, sr);
  const barFrames = Math.round(4 * 60 / tempo.bpm * sr);
  const xf = Math.round(XFADE_SEC * sr);

  const db = rmsDb(mono, HOP);
  let meanDb = 0;
  for (let i = 0; i < db.length; i++) meanDb += db[i];
  meanDb /= db.length;

  const headF = Math.round(spec.skipHead * sr);
  const tailF = Math.round(spec.skipTail * sr);

  // Best cut for EACH candidate length, then choose between the lengths.
  //
  // Not one combined score with a length bonus — I tried that and it traded a
  // 63 s loop for a 31 s one to buy a seam improvement nobody could hear. A short
  // loop is a real cost (the player hears the repeat), so the rule is: take the
  // LONGEST loop whose seam is not meaningfully worse than the best available.
  interface Cand { s: number; L: number; cost: number; bars: number; }
  const perLength: Cand[] = [];

  for (const bars of spec.bars) {
    const L = bars * barFrames;
    // The loop, plus the crossfade tail it steals from the continuation, must fit.
    const maxStart = w.frames - tailF - L - xf;
    if (maxStart <= headF) continue;

    let bestHere: Cand | null = null;
    // Step by a bar: a seam anywhere else is mid-bar and no crossfade will save it.
    for (let s2 = headF; s2 <= maxStart; s2 += barFrames) {
      // The loop must be at full strength throughout — one containing the intro
      // fade would get quieter every time it wrapped.
      let quiet = 0;
      const f0 = Math.floor(s2 / HOP), f1 = Math.floor((s2 + L) / HOP);
      for (let i = f0; i < f1 && i < db.length; i++) if (db[i] < meanDb - 6) quiet++;
      const quietFrac = quiet / Math.max(1, f1 - f0);

      // How alike is the music at the cut, and at the point it wraps back from?
      const a = features(mono, s2, xf);
      const b = features(mono, s2 + L, xf);
      const cost = featDist(a, b) + quietFrac * 12;

      if (bestHere === null || cost < bestHere.cost) bestHere = { s: s2, L, cost, bars };
    }
    if (bestHere !== null) perLength.push(bestHere);
  }

  if (perLength.length === 0) throw new Error(`${spec.name}: no loop fits`);

  console.log(`  ${spec.name}: ` + perLength
    .map(c => `${c.bars}bars=${(c.L / sr).toFixed(1)}s cost ${c.cost.toFixed(2)}`).join('  |  '));

  let cheapest = perLength[0];
  for (const c of perLength) if (c.cost < cheapest.cost) cheapest = c;

  // Any seam under GOOD_ENOUGH is one the 1.6 s equal-power crossfade will hide —
  // the cost is roughly "average dB difference across the seam window", and a
  // couple of dB is nothing once it is faded. So do NOT trade loop length for a
  // seam improvement nobody can hear: among the acceptable lengths, take the
  // longest. A short loop is a cost the player actually notices.
  const GOOD_ENOUGH = 3.0;
  const limit = Math.max(GOOD_ENOUGH, cheapest.cost * 1.15);
  let best: Cand | null = null;
  for (const c of perLength) {
    if (c.cost <= limit && (best === null || c.bars > best.bars)) best = c;
  }
  if (best === null) best = cheapest;

  if (best === null) throw new Error(`${spec.name}: no loop fits`);

  // Build it. out[i] = src[s+i], except the first `xf` frames, which are the
  // CONTINUATION (src[s+L+i]) fading out under the loop head fading in. So when
  // the loop wraps, the audio the ear expected to hear next is already there.
  const ch = w.channels;
  const out: Wav = {
    sampleRate: sr, channels: ch, frames: best.L,
    data: new Float32Array(best.L * ch),
  };
  for (let i = 0; i < best.L; i++) {
    for (let c = 0; c < ch; c++) {
      const head = w.data[(best.s + i) * ch + c];
      if (i < xf) {
        const t = i / xf;
        // Equal power, so the seam does not dip ~3 dB the way a linear fade would.
        const gIn = Math.sin(t * Math.PI * 0.5);
        const gOut = Math.cos(t * Math.PI * 0.5);
        const cont = w.data[(best.s + best.L + i) * ch + c];
        out.data[i * ch + c] = head * gIn + cont * gOut;
      } else {
        out.data[i * ch + c] = head;
      }
    }
  }
  normalize(out, PEAK_DBFS);
  writeWav(`${OUT}/${spec.name}.wav`, out);

  // Verify the seam. A click is a sample-to-sample jump at the wrap that is far
  // outside the normal range of jumps in the file — so measure both and compare.
  let sum = 0, n = 0, p99 = 0;
  const deltas: number[] = [];
  for (let i = 1; i < out.frames; i += 97) {          // sparse sample; this is a check, not a filter
    const d = Math.abs(out.data[i * ch] - out.data[(i - 1) * ch]);
    deltas.push(d); sum += d; n++;
  }
  deltas.sort((x, y) => x - y);
  p99 = deltas[Math.floor(deltas.length * 0.99)];
  const wrap = Math.abs(out.data[0] - out.data[(out.frames - 1) * ch]);

  const secs = best.L / sr;
  console.log(
    `${spec.name.padEnd(14)} ${(w.frames / sr).toFixed(1)}s -> ${secs.toFixed(2)}s ` +
    `(${best.bars} bars @ ${tempo.bpm.toFixed(1)} bpm, cut @ ${(best.s / sr).toFixed(1)}s)  ` +
    `seam: wrap-jump ${wrap.toFixed(4)} vs p99 ${p99.toFixed(4)} ` +
    `${wrap <= p99 * 1.5 ? 'OK' : '** CHECK **'}`);
}

// ---- stinger: trim, fade, normalize -----------------------------------------

function masterSting(spec: StingSpec): void {
  const w = readWav(`${SRC}/${spec.name}.wav`);
  const sr = w.sampleRate;
  const ch = w.channels;
  const start = Math.round(spec.start * sr);
  let frames = Math.round(spec.len * sr);
  if (start + frames > w.frames) frames = w.frames - start;

  const out = slice(w, start, frames);

  const fadeIn = Math.round(0.015 * sr);            // 15 ms — kills the edge click, nothing more
  const fadeOut = Math.round(spec.fadeOut * sr);
  for (let i = 0; i < frames; i++) {
    let g = 1;
    if (i < fadeIn) g *= i / fadeIn;
    const fromEnd = frames - 1 - i;
    if (fromEnd < fadeOut) {
      const t = fromEnd / fadeOut;
      g *= t * t;                                   // squared: decays to true silence, not a shelf
    }
    for (let c = 0; c < ch; c++) out.data[i * ch + c] *= g;
  }
  normalize(out, PEAK_DBFS);
  writeWav(`${OUT}/${spec.name}.wav`, out);

  // Last sample must be silent, or the one-shot ends in a click every time.
  let tail = 0;
  for (let c = 0; c < ch; c++) tail = Math.max(tail, Math.abs(out.data[(frames - 1) * ch + c]));
  console.log(
    `${spec.name.padEnd(18)} ${(w.frames / sr).toFixed(1)}s -> ${(frames / sr).toFixed(2)}s ` +
    `(from ${spec.start.toFixed(2)}s)  tail=${tail.toFixed(6)} ${tail < 1e-4 ? 'OK' : '** CLICK **'}`);
}

// ---- main -------------------------------------------------------------------

if (!existsSync(SRC)) {
  console.error(`No ${SRC}/. Put the raw Suno renders there (same six filenames).`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

console.log('beds — loop point is searched, not assumed:');
for (const b of BEDS) {
  if (!existsSync(`${SRC}/${b.name}.wav`)) { console.log(`  [skip] ${b.name}`); continue; }
  masterBed(b);
}
console.log('\nstingers — windows read off the waveform, not guessed:');
for (const s of STINGS) {
  if (!existsSync(`${SRC}/${s.name}.wav`)) { console.log(`  [skip] ${s.name}`); continue; }
  masterSting(s);
}
