// Procedural stand-in SFX.
//
// WHY THIS EXISTS. The code for footsteps (SH-003), weapon tails (SH-035),
// reload and UI sound has been shipped for a while, and all of it has been
// SILENT — `optional()` in audio-mix.ts probes for a file, gets nothing, and
// falls back to no sound. So the systems are built, wired, mixed and routed to
// their buses, and none of them make a noise. That is the worst state for a
// feature to sit in: it looks done and it does nothing.
//
// These are synthesised, not recorded. They are honest stand-ins: they make the
// systems audible and testable NOW, and every one of them is a straight file
// drop away from being replaced by real recordings (same names, same format, no
// code change). See docs/ASSET-TODO.md.
//
// Format is what the engine's `parse_wav` accepts and what SOURCES.md documents:
// 16-bit mono PCM at 44.1 kHz. Mono because anything positional must not carry
// baked-in panning that would fight playSound3D's listener.
//
//   bun tools/gen-sfx.ts

const SR = 44100;

// --- WAV -------------------------------------------------------------------

function writeWav(path: string, samples: Float32Array): void {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);          // PCM chunk size
  buf.writeUInt16LE(1, 20);           // format = PCM
  buf.writeUInt16LE(1, 22);           // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);      // byte rate
  buf.writeUInt16LE(2, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  Bun.write(path, buf);
}

// --- deterministic noise ---------------------------------------------------
// Seeded, so re-running the tool reproduces byte-identical files rather than a
// new set of "slightly different" assets in every diff.
let seed = 0x2f6e2b1;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x3fffffff - 1.0;   // -1..1
}

// --- building blocks -------------------------------------------------------

/** One-pole low-pass. `cut` in Hz. */
function lowpass(x: Float32Array, cut: number): Float32Array {
  const a = Math.exp(-2 * Math.PI * cut / SR);
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; out[i] = y; }
  return out;
}

/** One-pole high-pass (input minus its low-passed self). */
function highpass(x: Float32Array, cut: number): Float32Array {
  const lp = lowpass(x, cut);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - lp[i];
  return out;
}

function bandpass(x: Float32Array, lo: number, hi: number): Float32Array {
  return highpass(lowpass(x, hi), lo);
}

function noise(dur: number): Float32Array {
  const out = new Float32Array(Math.floor(dur * SR));
  for (let i = 0; i < out.length; i++) out[i] = rnd();
  return out;
}

/** Exponential decay envelope with a short linear attack (no click at t=0). */
function env(x: Float32Array, attack: number, decay: number): Float32Array {
  const out = new Float32Array(x.length);
  const aN = Math.max(1, Math.floor(attack * SR));
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const a = i < aN ? i / aN : 1;
    out[i] = x[i] * a * Math.exp(-t / decay);
  }
  return out;
}

/** Decaying sine — the "body" under an impact. */
function thump(dur: number, freq: number, decay: number, sweep: number): Float32Array {
  const out = new Float32Array(Math.floor(dur * SR));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    // Pitch falls as it decays: real impacts do this, and a fixed sine reads as a beep.
    const f = freq * (1 - sweep * (1 - Math.exp(-t / decay)));
    phase += 2 * Math.PI * f / SR;
    out[i] = Math.sin(phase) * Math.exp(-t / decay);
  }
  return out;
}

function mix(...layers: Float32Array[]): Float32Array {
  const n = Math.max(...layers.map((l) => l.length));
  const out = new Float32Array(n);
  for (const l of layers) for (let i = 0; i < l.length; i++) out[i] += l[i];
  return out;
}

function gain(x: Float32Array, g: number): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
  return out;
}

/** Normalise to a target peak, so the mixer's per-sound gains mean something. */
function norm(x: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m < 1e-6) return x;
  return gain(x, peak / m);
}

// --- the sounds ------------------------------------------------------------

// FOOTSTEPS. A step is two things at once and it falls apart if you only do one:
// a broadband *impact* and a *scuff* as the foot moves through the surface. Grass
// is nearly all scuff (bright, brushy, almost no body); dirt is mostly impact
// (a soft low thud with a little grit on top).
function stepGrass(variant: number): Float32Array {
  const d = 0.20 + variant * 0.012;
  // Brushy scuff: high band noise, quick in, quick out.
  const scuff = env(bandpass(noise(d), 1800, 9000), 0.004, 0.055 + variant * 0.006);
  // Grains: a handful of individual blade-flicks, so it isn't a smooth "shh".
  const grains = new Float32Array(Math.floor(d * SR));
  for (let g = 0; g < 7; g++) {
    const at = Math.floor((0.01 + Math.abs(rnd()) * 0.09) * SR);
    const len = Math.floor(0.006 * SR);
    for (let i = 0; i < len && at + i < grains.length; i++) {
      grains[at + i] += rnd() * Math.exp(-i / (len * 0.35)) * 0.5;
    }
  }
  const body = gain(thump(d, 110, 0.035, 0.4), 0.18);
  return norm(mix(scuff, gain(highpass(grains, 2500), 0.7), body), 0.85);
}

function stepDirt(variant: number): Float32Array {
  const d = 0.24 + variant * 0.015;
  const body = gain(thump(d, 85 + variant * 5, 0.055, 0.5), 0.9);
  const grit = env(bandpass(noise(d), 400, 3500), 0.003, 0.045);
  return norm(mix(body, gain(grit, 0.45)), 0.85);
}

// TYRANT FOOTFALL. Deliberately huge and long: SH-003 wants an unseen tyrant to be
// *heard* coming, and the trauma rumble is keyed off the same event.
function stepHeavy(): Float32Array {
  const d = 0.75;
  const body  = gain(thump(d, 48, 0.16, 0.35), 1.0);
  const crack = env(bandpass(noise(d), 200, 2200), 0.002, 0.05);
  const debris = env(bandpass(noise(d), 1500, 7000), 0.02, 0.22);
  return norm(mix(body, gain(crack, 0.5), gain(debris, 0.18)), 0.95);
}

// RELOAD. Mechanical: a noise transient for the clack plus two metallic partials
// that ring on briefly. Start = magazine out (lower), end = seated (higher, harder).
function reload(high: boolean): Float32Array {
  const d = 0.28;
  const clack = env(bandpass(noise(d), 900, 6000), 0.001, 0.02);
  const f = high ? 1500 : 950;
  const ring1 = gain(env(thump(d, f, 0.06, 0.05), 0.001, 0.06), 0.35);
  const ring2 = gain(env(thump(d, f * 1.94, 0.04, 0.05), 0.001, 0.04), 0.2);
  const body  = gain(thump(d, high ? 150 : 110, 0.03, 0.3), 0.4);
  return norm(mix(clack, ring1, ring2, body), 0.8);
}

// UI. Short and soft — these play on every menu move, so anything with a sharp
// transient becomes torture within a minute.
function uiBlip(freq: number, dur: number): Float32Array {
  const d = dur;
  const tone = gain(env(thump(d, freq, 0.05, 0.0), 0.004, 0.05), 0.9);
  const air  = gain(env(bandpass(noise(d), 3000, 9000), 0.002, 0.012), 0.12);
  return norm(mix(tone, air), 0.55);
}

// WEAPON TAILS. This is the "BOOM" half of the crack-BOOM: the report leaving and
// coming back off the world. Band-limited decaying noise, routed to the reverb
// send by the mixer — the point is that it is LONG and dark, where the body layer
// is short and bright.
function weaponTail(lo: number, hi: number, decay: number, dur: number,
                    lowBody: number): Float32Array {
  const n = bandpass(noise(dur), lo, hi);
  const tail = env(n, 0.006, decay);
  const boom = gain(thump(dur, lowBody, decay * 0.7, 0.55), 0.5);
  return norm(mix(tail, boom), 0.75);
}

// AMBIENT WIND / LEAF RUSTLE (SH-001). Must LOOP, so the last second is
// cross-faded into the first — a rustle bed with a seam in it is worse than none.
// Structure: a broadband bed, band-passed to the "leaves" register, modulated by
// several slow LFOs at incommensurate rates so gusts swell and fade without ever
// landing on an obvious period.
function ambientWind(dur: number): Float32Array {
  const n = Math.floor(dur * SR);
  const bed = bandpass(noise(dur + 1.0), 700, 6500);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const gust =
        0.55
      + 0.26 * Math.sin(2 * Math.PI * 0.037 * t)
      + 0.13 * Math.sin(2 * Math.PI * 0.091 * t + 1.7)
      + 0.09 * Math.sin(2 * Math.PI * 0.231 * t + 3.1);
    out[i] = bed[i] * gust;
  }
  // Seamless loop: fade the tail over the head.
  const xf = Math.floor(1.0 * SR);
  for (let i = 0; i < xf; i++) {
    const w = i / xf;
    out[i] = out[i] * w + bed[n + i] * (1 - w) * 0.6;
  }
  return norm(out, 0.55);
}

// --- emit ------------------------------------------------------------------

const OUT = 'assets/sounds';
let count = 0;
function emit(name: string, s: Float32Array): void {
  writeWav(`${OUT}/${name}`, s);
  console.log(`  ${name.padEnd(22)} ${(s.length / SR).toFixed(2)}s`);
  count++;
}

console.log('procedural stand-in SFX -> assets/sounds/');
for (let i = 0; i < 4; i++) emit(`step_grass${i + 1}.wav`, stepGrass(i));
for (let i = 0; i < 4; i++) emit(`step_dirt${i + 1}.wav`, stepDirt(i));
emit('step_heavy1.wav', stepHeavy());
emit('reload_start.wav', reload(false));
emit('reload_end.wav', reload(true));
emit('ui_move.wav', uiBlip(520, 0.10));
emit('ui_select.wav', uiBlip(780, 0.14));
// Rifle: tight and mid. Blaster: energy, brighter and shorter. Chaingun: bigger
// and rougher. Cannon: the long one — it should still be audible when the next
// shot would already have landed.
emit('rifle_tail.wav',   weaponTail(300, 4200, 0.28, 1.1, 90));
emit('blaster_tail.wav', weaponTail(700, 6500, 0.18, 0.8, 140));
emit('chain_tail.wav',   weaponTail(220, 3600, 0.34, 1.3, 75));
emit('cannon_tail.wav',  weaponTail(120, 2600, 0.70, 2.4, 48));
emit('ambient_wind.wav', ambientWind(16.0));
console.log(`${count} files written (synthesised stand-ins — see docs/ASSET-TODO.md)`);
