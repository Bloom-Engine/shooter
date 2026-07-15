// SH-049 — the boot sequence: splash, loading screen, and the fade into the menu.
//
// The game used to open a black window, freeze for several seconds while every
// GLB, sound and shader loaded on the main thread, and then snap to a title
// card. That freeze is not a small thing: it is the first several seconds a
// player ever spends with the game, and it read as a hang.
//
// There is no async loading and no worker thread (EN-032 would give us one), so
// nothing here pretends the loads are in the background. Instead the loads are
// INTERLEAVED with frames: main.ts calls `bootStage()` between groups of loads,
// and each call draws one frame of the loading screen. The bar therefore shows
// real progress through real work — it is not a timer pretending to be one.
//
// The consequence, stated honestly: the screen is static WHILE a stage loads
// (a synchronous load cannot yield), so the animation advances in steps at
// stage boundaries. The splash and the outro, which own their own loops, are
// smoothly animated because they can be.
//
// PERRY: this module is imported, so its body runs BEFORE main.ts calls
// initWindow() — it must therefore make no engine calls at module scope (see
// docs/perry-quirks.md and the module-init-order note). Data only up here;
// every engine call lives inside a function main.ts invokes after the window
// exists. The easing below is also deliberately INLINE arithmetic rather than
// factored into `ease(t)` helpers: Perry miscompiles some small numeric
// functions in imported modules into a constant (EN-050/051), and a splash that
// silently stops animating is exactly the bug that would hide there.

import {
  beginDrawing, endDrawing, clearBackground,
  drawText, drawRect, measureText,
  getScreenWidth, getScreenHeight, getTime,
  isAnyInputPressed,
} from 'bloom';
import { writeFile } from 'bloom/core';

// ---- Stage table ------------------------------------------------------------
// The bar is only honest if the weights are what the stages actually COST, so
// these are measured, not guessed: BOOT_TIMING prints each stage's duration and
// the weights below are those milliseconds. Re-measure when the asset load
// changes materially (the alien pool is the one that moves).
// These MUST be in the order main.ts actually loads things: the bar's progress
// is the sum of the weights before the current stage, so a stage called out of
// order would send it backwards.
export const BOOT_AUDIO    = 0;
export const BOOT_MUSIC    = 1;
export const BOOT_WORLD    = 2;
export const BOOT_MESHES   = 3;
export const BOOT_TREES    = 4;
export const BOOT_TERRAIN  = 5;
export const BOOT_PLAYER   = 6;
export const BOOT_WEAPONS  = 7;
export const BOOT_VFX      = 8;
export const BOOT_WATER    = 9;
export const BOOT_GRASS    = 10;
export const BOOT_PROPS    = 11;
export const BOOT_ALIENS   = 12;
export const BOOT_SCENE    = 13;
export const BOOT_READY    = 14;
const BOOT_COUNT = 15;

// What the player reads while each stage runs. Say what is loading, not
// "Loading..." — a name that changes is the difference between "working" and
// "hung", and it costs nothing.
const LABELS = [
  'sound effects',
  'music',
  'building the arena',
  'arena geometry',
  'growing the forest',
  'terrain',
  'the marine',
  'weapons',
  'particles and decals',
  'water',
  'grass',
  'props',
  'the aliens',
  'lighting',
  'ready',
];

// Cost of each stage in milliseconds, MEASURED (BOOT_TIMING, 2026-07-14, this
// box). Equal weights would make the bar lurch, because the stages are nowhere
// near equal: the alien pool alone is 61% of the load and the sound effects are
// 0.3% of it. A bar that crawls through one stage and jumps four is read as a
// broken loader, not as an honest picture of the work.
//
// Note what these numbers say: boot is ~7.9 s of loading, and `the aliens` is
// 5.5 s of that — initEnemyPool() loads a separate ModelAnimation per enemy
// SLOT, not per kind. That is deliberate (the mixer's clock lives in the
// handle), but it is the one number to attack if boot time is ever worth
// fixing. Re-measure after any change to what loads.
const WEIGHTS = [
  24, 33, 234, 114, 132, 88, 1315, 21, 70, 46, 90, 64, 5518, 7, 129,
];

// Flip on to record each stage's real duration, then paste the numbers into
// WEIGHTS above. A progress bar built on guessed weights lurches, which reads
// as a bug in the loader rather than a lie in the numbers.
//
// It writes a FILE rather than logging: console.log from module scope does not
// reliably survive a redirect on Windows (the same class of gap as EN-038 /
// the dead-stderr note in docs), and a measurement you cannot read is not a
// measurement.
const BOOT_TIMING = false;
const TIMING_PATH = 'tools/.testout/boot_timing.txt';
let timingLog = '';

// 0 = stage index reached, 1 = wall clock at the last stage, 2 = boot start,
// 3 = splash start (or -1 before it has run).
const B = [0, 0, 0, -1];

function totalWeight(): number {
  let t = 0;
  for (let i = 0; i < BOOT_COUNT; i++) t = t + WEIGHTS[i];
  return t;
}

/// Fraction of the load DONE before stage `i` begins.
function fractionBefore(i: number): number {
  let done = 0;
  for (let k = 0; k < i; k++) done = done + WEIGHTS[k];
  return done / totalWeight();
}

// ---- Painting ---------------------------------------------------------------
// Everything is laid out against a 720p design height and scaled, so the boot
// screen looks the same on a 1080p laptop and a 4K monitor. (The HUD does this
// with a 2D camera; here raw pixels are simpler — there is no world behind.)

const INK      = { r: 236, g: 226, b: 178, a: 255 };
const DIM      = { r: 150, g: 146, b: 132, a: 200 };
const AMBER    = { r: 255, g: 200, b: 110, a: 255 };
const BAR_BED  = { r: 60,  g: 58,  b: 56,  a: 220 };

/// The backdrop both the splash and the loading screen sit on: near-black, with
/// a faint warm lift toward the bottom so it reads as a lit room rather than a
/// dead framebuffer.
function backdrop(sw: number, sh: number): void {
  // clearBackground alone is NOT enough here, and the first build proved it: the
  // renderer still runs its sky pass every frame, so the clear colour was
  // painted over and the "dark splash" came out as a washed-out blue sky with
  // text on it. 2D draws land after the 3D pass, so an OPAQUE full-screen rect
  // is the thing that actually holds the screen.
  clearBackground({ r: 12, g: 12, b: 14, a: 255 });
  drawRect(0, 0, sw, sh, { r: 12, g: 12, b: 14, a: 255 });
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    const t = i / bands;
    const y = sh * (0.55 + t * 0.45);
    const a = Math.floor(10 * t);
    drawRect(0, y, sw, sh * 0.06 + 2, { r: 60, g: 45, b: 30, a: a });
  }
}

/// The wordmark. `a` is 0..255 so callers can fade it.
function wordmark(sw: number, sh: number, s: number, a: number): void {
  const title = 'BLOOM SHOOTER';
  const ts = 64 * s;
  const tw = measureText(title, ts);
  drawText(title, (sw - tw) / 2, sh * 0.34 - ts * 0.5, ts,
    { r: INK.r, g: INK.g, b: INK.b, a: a });

  // A rule under the title, drawn from the centre out. Cheap, and it gives the
  // splash something to DO rather than just appearing.
  const ruleW = tw * 0.92;
  const ruleA = Math.floor(a * 0.55);
  drawRect((sw - ruleW) / 2, sh * 0.34 + ts * 0.62, ruleW, Math.max(1, 2 * s),
    { r: AMBER.r, g: AMBER.g, b: AMBER.b, a: ruleA });
}

/// One frame of the loading screen: wordmark, real progress, and what is
/// loading right now.
function paintLoading(frac: number, label: string): void {
  const sw = getScreenWidth();
  const sh = getScreenHeight();
  const s = sh / 720;

  beginDrawing();
  backdrop(sw, sh);
  wordmark(sw, sh, s, 255);

  // --- the bar
  const barW = sw * 0.34;
  const barH = 6 * s;
  const barX = (sw - barW) / 2;
  const barY = sh * 0.60;
  drawRect(barX, barY, barW, barH, BAR_BED);
  drawRect(barX, barY, barW * frac, barH, AMBER);

  // A pulse riding the leading edge. It is driven by getTime(), so between two
  // stages — when nothing is being drawn — it simply does not move. That is the
  // truth of a synchronous loader and it is better than a spinner that keeps
  // twirling while the process is actually wedged.
  if (frac > 0.001 && frac < 0.999) {
    const pulse = Math.floor(120 + Math.sin(getTime() * 7.0) * 100);
    drawRect(barX + barW * frac - 2 * s, barY - 2 * s, 4 * s, barH + 4 * s,
      { r: 255, g: 235, b: 190, a: pulse });
  }

  // --- what is loading, and how far in
  const ls = 18 * s;
  const lw = measureText(label, ls);
  drawText(label, (sw - lw) / 2, barY + barH + 16 * s, ls, DIM);

  const pct = '' + Math.floor(frac * 100) + '%';
  const ps = 16 * s;
  const pw = measureText(pct, ps);
  drawText(pct, (sw - pw) / 2, barY - ps - 12 * s, ps,
    { r: 190, g: 185, b: 170, a: 190 });

  footer(sw, sh, s, 255);
  endDrawing();
}

/// The engine credit, bottom-centre. This is the "studio logo" beat — the game
/// is built on Bloom and says so.
function footer(sw: number, sh: number, s: number, a: number): void {
  const cred = 'BLOOM ENGINE';
  const cs = 15 * s;
  const cw = measureText(cred, cs);
  drawText(cred, (sw - cw) / 2, sh * 0.90, cs,
    { r: 120, g: 118, b: 112, a: Math.floor(a * 0.75) });
}

// ---- The three beats --------------------------------------------------------

/// Beat 1 — the splash. Runs BEFORE any asset loads, in its own loop, so it is
/// the one part of the boot that can animate smoothly. Any key skips it: a
/// splash you cannot skip is a splash you resent by the third launch.
export function bootSplash(seconds: number): void {
  B[2] = getTime();
  B[3] = getTime();
  const t0 = getTime();
  let t = 0;
  while (t < seconds) {
    t = getTime() - t0;
    if (isAnyInputPressed()) break;

    const sw = getScreenWidth();
    const sh = getScreenHeight();
    const s = sh / 720;

    // Fade in over the first 40%, hold, fade out over the last 25%. Inline, and
    // with `if`s — see the Perry note at the top of this file.
    let a = 1.0;
    const fadeIn = seconds * 0.40;
    const fadeOut = seconds * 0.25;
    if (t < fadeIn) {
      a = t / fadeIn;
    } else if (t > seconds - fadeOut) {
      a = (seconds - t) / fadeOut;
    }
    if (a < 0) a = 0;
    if (a > 1) a = 1;
    // Smoothstep, written out: a linear fade reads as a slope change at both ends.
    a = a * a * (3.0 - 2.0 * a);
    const alpha = Math.floor(a * 255);

    beginDrawing();
    backdrop(sw, sh);
    wordmark(sw, sh, s, alpha);
    footer(sw, sh, s, alpha);
    endDrawing();
  }
}

/// Beat 2 — called by main.ts between groups of asset loads. Draws one frame
/// showing what is ABOUT to load and how much is already done.
export function bootStage(stage: number): void {
  if (BOOT_TIMING && stage > 0) {
    const ms = (getTime() - B[1]) * 1000;
    timingLog = timingLog + LABELS[B[0]] + ' = ' + ms.toFixed(0) + ' ms\n';
  }
  B[0] = stage;
  B[1] = getTime();
  paintLoading(fractionBefore(stage), LABELS[stage]);
}

/// Beat 3 — loading is done. Hold the completed bar just long enough to be seen
/// (a bar that snaps from 40% to gone never reads as "finished"), then fade the
/// whole screen out so the main menu comes up from black instead of cutting.
export function bootOutro(): void {
  if (BOOT_TIMING) {
    const lastMs = (getTime() - B[1]) * 1000;
    timingLog = timingLog + LABELS[B[0]] + ' = ' + lastMs.toFixed(0) + ' ms\n';
    const total = (getTime() - B[2]) * 1000;
    timingLog = timingLog + 'TOTAL = ' + total.toFixed(0) + ' ms\n';
    writeFile(TIMING_PATH, timingLog);
  }
  const holdT = getTime();
  while (getTime() - holdT < 0.35) {
    paintLoading(1.0, 'ready');
  }

  const t0 = getTime();
  const dur = 0.45;
  let t = 0;
  while (t < dur) {
    t = getTime() - t0;
    let a = 1 - t / dur;
    if (a < 0) a = 0;
    a = a * a * (3.0 - 2.0 * a);

    const sw = getScreenWidth();
    const sh = getScreenHeight();
    const s = sh / 720;
    const alpha = Math.floor(a * 255);

    beginDrawing();
    backdrop(sw, sh);
    wordmark(sw, sh, s, alpha);
    footer(sw, sh, s, alpha);
    endDrawing();
  }
}
