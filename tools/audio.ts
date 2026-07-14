// Shared WAV I/O + analysis for the music tools.
//
// PCM16 only — that is what Suno hands back and what the engine streams. Anything
// else is rejected loudly rather than half-decoded into noise.

import { readFileSync, writeFileSync } from 'node:fs';

export interface Wav {
  sampleRate: number;
  channels: number;
  /// Interleaved samples, -1..1.
  data: Float32Array;
  /// Frames = data.length / channels.
  frames: number;
}

export function readWav(path: string): Wav {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(path + ': not a RIFF/WAVE file');
  }
  let p = 12;
  let sampleRate = 0, channels = 0, bits = 0, fmtTag = 0;
  let dataOff = -1, dataLen = 0;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4);
    const len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      fmtTag = b.readUInt16LE(p + 8);
      channels = b.readUInt16LE(p + 10);
      sampleRate = b.readUInt32LE(p + 12);
      bits = b.readUInt16LE(p + 22);
    } else if (id === 'data') {
      dataOff = p + 8;
      dataLen = len;
    }
    p += 8 + len + (len & 1);   // chunks are word-aligned
  }
  if (dataOff < 0) throw new Error(path + ': no data chunk');
  if (fmtTag !== 1 || bits !== 16) {
    throw new Error(`${path}: expected PCM16, got fmtTag=${fmtTag} bits=${bits}`);
  }
  const frames = Math.floor(dataLen / (channels * 2));
  const data = new Float32Array(frames * channels);
  for (let i = 0; i < frames * channels; i++) {
    data[i] = b.readInt16LE(dataOff + i * 2) / 32768;
  }
  return { sampleRate, channels, data, frames };
}

export function writeWav(path: string, w: Wav): void {
  const n = w.frames * w.channels;
  const bytes = Buffer.alloc(44 + n * 2);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + n * 2, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);                       // PCM
  bytes.writeUInt16LE(w.channels, 22);
  bytes.writeUInt32LE(w.sampleRate, 24);
  bytes.writeUInt32LE(w.sampleRate * w.channels * 2, 28);
  bytes.writeUInt16LE(w.channels * 2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.round(w.data[i] * 32767);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    bytes.writeInt16LE(v, 44 + i * 2);
  }
  writeFileSync(path, bytes);
}

export function toMono(w: Wav): Float32Array {
  if (w.channels === 1) return w.data;
  const m = new Float32Array(w.frames);
  for (let i = 0; i < w.frames; i++) {
    let s = 0;
    for (let c = 0; c < w.channels; c++) s += w.data[i * w.channels + c];
    m[i] = s / w.channels;
  }
  return m;
}

// ---- onset envelope + tempo -------------------------------------------------

export const HOP = 512;   // ~10.7 ms at 48 kHz

/// Half-wave-rectified log-energy flux. Not a spectral flux (no FFT here), which
/// makes it weaker on pads and perfectly adequate on anything with a kick drum —
/// which is the track whose tempo we actually need.
export function onsetEnvelope(mono: Float32Array, sr: number): Float32Array {
  const frames = Math.floor(mono.length / HOP);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const off = f * HOP;
    for (let i = 0; i < HOP; i++) { const v = mono[off + i]; e += v * v; }
    energy[f] = Math.log(1e-8 + e / HOP);
  }
  const env = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = energy[f] - energy[f - 1];
    env[f] = d > 0 ? d : 0;
  }
  return env;
}

export interface Tempo { bpm: number; confidence: number; }

/// Autocorrelate the onset envelope over a plausible tempo range.
///
/// Returns the best period AND a confidence, because on an ambient pad with no
/// percussion this is close to guesswork and the caller must be told so rather
/// than handed a confident-looking number.
export function estimateTempo(env: Float32Array, sr: number,
                              minBpm = 70, maxBpm = 180): Tempo {
  const fps = sr / HOP;
  const minLag = Math.floor(fps * 60 / maxBpm);
  const maxLag = Math.ceil(fps * 60 / minBpm);

  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= env.length;

  let best = -1, bestLag = minLag, sum = 0, count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = lag; i < env.length; i++) acc += (env[i] - mean) * (env[i - lag] - mean);
    acc /= (env.length - lag);
    sum += acc; count++;
    if (acc > best) { best = acc; bestLag = lag; }
  }
  const avg = sum / Math.max(1, count);

  // Parabolic interpolation around the winning lag. WITHOUT this the estimate is
  // quantised to integer frame lags, and at hop=512/48kHz the bins around 120 BPM
  // are 119.7 and 122.3 — so two tracks that are both 120 land in different bins
  // and look like they disagree by 2%. That is an artefact of the estimator, not
  // a property of the music, and it nearly sent me time-stretching a track that
  // did not need it.
  const at = (lag: number): number => {
    let acc = 0;
    for (let i = lag; i < env.length; i++) acc += (env[i] - mean) * (env[i - lag] - mean);
    return acc / (env.length - lag);
  };
  let refined = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = at(bestLag - 1), y1 = best, y2 = at(bestLag + 1);
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-12) {
      const d = 0.5 * (y0 - y2) / denom;
      if (d > -1 && d < 1) refined = bestLag + d;
    }
  }
  const bpm = 60 * fps / refined;
  // Confidence = how far the winning lag stands above the average correlation.
  const confidence = avg > 0 ? (best / avg) : 0;
  return { bpm, confidence };
}

/// Find the phase (in frames) of the strongest beat grid at `bpm` — i.e. where the
/// downbeats actually are. Cutting a loop anywhere else puts the seam mid-bar.
export function beatPhase(env: Float32Array, sr: number, bpm: number, beatsPerBar: number): number {
  const fps = sr / HOP;
  const beatLag = fps * 60 / bpm;
  const barLag = beatLag * beatsPerBar;
  let best = -Infinity, bestPhase = 0;
  const step = Math.max(1, Math.floor(barLag / 96));
  for (let ph = 0; ph < Math.floor(barLag); ph += step) {
    let acc = 0;
    for (let b = 0; ; b++) {
      const f = Math.round(ph + b * barLag);
      if (f >= env.length) break;
      acc += env[f];
    }
    if (acc > best) { best = acc; bestPhase = ph; }
  }
  return bestPhase * HOP;   // frames
}

/// RMS envelope in dB, one value per `hop` frames. For plotting and for finding
/// where a track is actually at full strength.
export function rmsDb(mono: Float32Array, hop: number): Float32Array {
  const n = Math.floor(mono.length / hop);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = 0; j < hop; j++) { const v = mono[i * hop + j]; e += v * v; }
    out[i] = 20 * Math.log10(Math.sqrt(e / hop) + 1e-6);
  }
  return out;
}

// ---- key detection ----------------------------------------------------------
//
// I told the composer that a KEY MISMATCH between the two beds is the one failure
// the mix cannot rescue — they are crossfaded, not cut, so a 2 s overlap of two
// keys is two songs colliding. It would be negligent to hand back loops without
// checking that claim against the audio that actually came back.

/// In-place iterative radix-2 FFT. `re`/`im` length must be a power of two.
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k],           ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;            im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;  im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;         cr = nr;
      }
    }
  }
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/// 12-bin pitch-class energy, averaged over the whole track.
export function chroma(mono: Float32Array, sr: number): Float32Array {
  const N = 4096;
  const re = new Float32Array(N), im = new Float32Array(N);
  const out = new Float32Array(12);
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);

  for (let off = 0; off + N < mono.length; off += N) {
    for (let i = 0; i < N; i++) { re[i] = mono[off + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const f = k * sr / N;
      if (f < 55 || f > 2000) continue;              // A1..~B6; above that is mostly noise
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const midi = 69 + 12 * Math.log2(f / 440);
      out[((Math.round(midi) % 12) + 12) % 12] += mag;
    }
  }
  let s = 0;
  for (let i = 0; i < 12; i++) s += out[i];
  if (s > 0) for (let i = 0; i < 12; i++) out[i] /= s;
  return out;
}

// Krumhansl-Schmuckler profiles.
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: number[], b: Float32Array, rot: number): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[(i + rot) % 12]; }
  ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma, y = b[(i + rot) % 12] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / (Math.sqrt(da * db) + 1e-12);
}

export interface Key { name: string; score: number; runnerUp: string; }

export function estimateKey(mono: Float32Array, sr: number): Key {
  const c = chroma(mono, sr);
  const cands: { name: string; score: number }[] = [];
  for (let r = 0; r < 12; r++) {
    cands.push({ name: NOTES[r] + ' major', score: corr(MAJ, c, r) });
    cands.push({ name: NOTES[r] + ' minor', score: corr(MIN, c, r) });
  }
  cands.sort((a, b) => b.score - a.score);
  return { name: cands[0].name, score: cands[0].score, runnerUp: cands[1].name };
}
