// SH-037 — settings + persistence.
//
// Nothing in this game used to survive a restart: every tunable was a compile-
// time constant and there was no save of any kind. This file is the foundation
// the menus (SH-038), the gamepad bindings (SH-039), the accessibility options
// (SH-043) and the score bests (SH-041) all stand on.
//
// Perry rules that bind here: JSON.parse is safe at LOAD time on 0.5.1208 but
// never on a frame path, and arrays must be built with `new Array(n)` + index
// assignment, never `.push()`. So: parse once at boot into flat state, and
// serialise by hand.

import { readFile, writeFile, fileExists } from 'bloom/core';

const PATH = 'settings.json';

// One flat array. Index constants are the public API of this module.
export const SET_MASTER_VOL = 0;
export const SET_MUSIC_VOL  = 1;
export const SET_SFX_VOL    = 2;
export const SET_SENS       = 3;   // mouse look sensitivity multiplier
export const SET_PAD_SENS   = 4;
export const SET_INVERT_Y   = 5;   // 0/1
export const SET_FOV        = 6;   // degrees
export const SET_SHAKE      = 7;   // 0..1
export const SET_RENDER_SCALE = 8;
export const SET_AIM_TOGGLE = 9;   // 0 = hold, 1 = toggle
export const SET_SPRINT_TOGGLE = 10;
// RETIRED (2026-07-15). SH-043's cues — the white hit flash + tick, and the
// damage-direction arc — are shape/position and draw UNCONDITIONALLY: they
// REPLACED the colour-only versions rather than sitting beside them, so there was
// never anything for this to switch. It had a menu row that adjusted, displayed
// and persisted a value nothing read. The row is gone; the key stays reserved so
// old settings.json files keep parsing (num() ignores what it isn't asked for)
// and so the index numbering below does not shift.
export const SET_COLORBLIND = 11;  // reserved — do not reuse
export const SET_CAPTIONS   = 12;  // 0/1 — telegraph captions
// --- Graphics. The player's call, not ours. ---------------------------------
//
// On a 4K display the two scale knobs below are worth more than everything else
// here put together, and they trade off against DIFFERENT things — so the game
// has no business deciding for the person looking at the screen.
//
// SET_OUTPUT_SCALE shrinks the SWAPCHAIN. It is the only knob that touches the
// fixed cost of the TSR upscale + final composite (measured 3.1 ms + 2.4 ms at
// 4K), which the render scale does not affect at all. Costs overall sharpness,
// HUD included.
//
// SET_RENDER_SCALE shrinks the G-BUFFER and everything drawn at render
// resolution; TSR reconstructs up to the swapchain. Costs scene detail, but the
// HUD and the final image stay at full output resolution.
export const SET_OUTPUT_SCALE = 13;   // 0.5 .. 1.0 of native
export const SET_SHADOWS    = 14;  // 0/1
export const SET_SSAO       = 15;  // 0/1 — ambient occlusion
export const SET_SSR        = 16;  // 0/1 — screen-space reflections
export const SET_SSGI       = 17;  // 0/1 — global illumination
export const SET_BLOOM      = 18;  // 0/1
// PT-5 — hardware path tracing: 0 off, 1 progressive (converges while
// the camera is still — stills/photo mode), 2 realtime (SVGF-denoised
// gameplay mode). Applied only when the device reports ray-query
// support; on anything else the setting is inert and the menu says so.
export const SET_PT         = 19;
export const SET_COUNT      = 20;

const V = new Array<number>(SET_COUNT);

// Best score per arena, and the unlock bitmask, ride in the same file.
const MAX_ARENAS = 8;
const best = new Array<number>(MAX_ARENAS);
const M = [0];   // M[0] = unlock bitmask

function defaults(): void {
  V[SET_MASTER_VOL] = 1.0;
  V[SET_MUSIC_VOL]  = 0.5;
  V[SET_SFX_VOL]    = 1.0;
  V[SET_SENS]       = 1.0;
  V[SET_PAD_SENS]   = 1.0;
  V[SET_INVERT_Y]   = 0;
  V[SET_FOV]        = 70;
  V[SET_SHAKE]      = 1.0;
  // 0.75: re-measured 2026-07-14 — 0.5 reads visibly upscale-soft at 4K
  // while 0.75 is dramatically sharper at ~30 fps (1.0 = ~19 fps, kept
  // selectable for stills). PT's realtime ray budget is decoupled from
  // this engine-side, so raising it does not slow path tracing.
  V[SET_RENDER_SCALE] = 0.75;
  V[SET_AIM_TOGGLE] = 0;
  V[SET_SPRINT_TOGGLE] = 0;
  V[SET_COLORBLIND] = 0;
  V[SET_CAPTIONS]   = 0;
  V[SET_OUTPUT_SCALE] = 1.0;   // native — a fresh install shows the game at its best
  V[SET_SHADOWS]    = 1;
  V[SET_SSAO]       = 1;
  // SSR ships OFF (2026-07-16, the "indoor blizzard"): the march on rough
  // interior concrete hits bright window/sky content and splatters white
  // firefly texels over every interior surface (captures in tools/.testout/
  // bliz-*.png; engine EN-061). This game has no SSR receivers that matter -
  // water reflections are the PLANAR probe, and the July audit measured SSR
  // invisible outdoors - so OFF is a pure quality win here. The settings row
  // stays for whoever wants to A/B it.
  V[SET_SSR]        = 0;
  V[SET_SSGI]       = 1;
  V[SET_BLOOM]      = 1;
  // Off by default: Lumen is the default GI everywhere; path tracing is
  // opt-in (it trades ~half the frame rate for traced lighting).
  V[SET_PT]         = 0;
  for (let i = 0; i < MAX_ARENAS; i++) best[i] = 0;
  M[0] = 0;
}

export function get(i: number): number { return V[i]; }
export function set(i: number, v: number): void { V[i] = v; }
export function bestScore(arena: number): number {
  if (arena >= 0 && arena < MAX_ARENAS) return best[arena];
  return 0;
}
export function setBestScore(arena: number, s: number): void {
  if (arena >= 0 && arena < MAX_ARENAS && s > best[arena]) best[arena] = s;
}
export function unlockMask(): number { return M[0]; }
export function setUnlockMask(m: number): void { M[0] = m; }

/// Pull one number out of a parsed JSON object, falling back to whatever
/// `defaults()` put there. Written as an explicit key read because Perry's
/// object handling is only trustworthy with literal keys.
function num(o: any, key: string, fallback: number): number {
  if (o === null || o === undefined) return fallback;
  const v = o[key];
  if (v === undefined || v === null) return fallback;
  const n = v as number;
  // A corrupt file must never poison the game with NaN.
  if (n !== n) return fallback;
  return n;
}

/// Load at boot. A missing or corrupt file is not an error — it is a first run.
export function loadSettings(): void {
  defaults();
  if (!fileExists(PATH)) return;
  let text = readFile(PATH);
  if (text === null || text === undefined || text.length < 2) return;

  // A corrupt settings.json must not brick the game — and the comment above only
  // became TRUE with this block. On Perry, `JSON.parse` on malformed input ABORTS
  // the process; there is no exception to catch. So the file has to be vetted
  // before it is handed over.
  //
  // The realistic corruption is a BOM. Anything that writes this file with a
  // Windows text editor — or PowerShell's `Set-Content -Encoding utf8`, which
  // silently prepends U+FEFF — kills the game on the next launch with
  // "JSON parse error: expected value at line 1 column 1". The second is a
  // truncated file, from a crash or a full disk mid-write.
  //
  // This is not a JSON validator and does not pretend to be. It converts the two
  // corruptions that actually happen into a clean fall back to defaults.
  let a0 = 0;
  while (a0 < text.length) {
    const c = text.charCodeAt(a0);
    if (c === 0xfeff || c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) { a0 = a0 + 1; continue; }
    break;
  }
  let b0 = text.length - 1;
  while (b0 > a0) {
    const c = text.charCodeAt(b0);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) { b0 = b0 - 1; continue; }
    break;
  }
  if (b0 <= a0) return;
  text = text.substring(a0, b0 + 1);
  // Must be a whole JSON object: starts with '{', ends with '}'.
  if (text.charCodeAt(0) !== 0x7b || text.charCodeAt(text.length - 1) !== 0x7d) return;

  const o: any = JSON.parse(text);
  if (o === null || o === undefined) return;

  const a: any = o['audio'];
  V[SET_MASTER_VOL] = num(a, 'master', V[SET_MASTER_VOL]);
  V[SET_MUSIC_VOL]  = num(a, 'music',  V[SET_MUSIC_VOL]);
  V[SET_SFX_VOL]    = num(a, 'sfx',    V[SET_SFX_VOL]);

  const c: any = o['controls'];
  V[SET_SENS]        = num(c, 'sensitivity',   V[SET_SENS]);
  V[SET_PAD_SENS]    = num(c, 'padSensitivity', V[SET_PAD_SENS]);
  V[SET_INVERT_Y]    = num(c, 'invertY',       V[SET_INVERT_Y]);
  V[SET_AIM_TOGGLE]  = num(c, 'aimToggle',     V[SET_AIM_TOGGLE]);
  V[SET_SPRINT_TOGGLE] = num(c, 'sprintToggle', V[SET_SPRINT_TOGGLE]);

  const vd: any = o['video'];
  V[SET_FOV]          = num(vd, 'fov',         V[SET_FOV]);
  V[SET_RENDER_SCALE] = num(vd, 'renderScale', V[SET_RENDER_SCALE]);
  V[SET_OUTPUT_SCALE] = num(vd, 'outputScale', V[SET_OUTPUT_SCALE]);
  V[SET_SHADOWS] = num(vd, 'shadows', V[SET_SHADOWS]);
  V[SET_SSAO]    = num(vd, 'ssao', V[SET_SSAO]);
  V[SET_SSR]     = num(vd, 'ssr', V[SET_SSR]);
  V[SET_SSGI]    = num(vd, 'ssgi', V[SET_SSGI]);
  V[SET_BLOOM]   = num(vd, 'bloom', V[SET_BLOOM]);
  V[SET_PT]      = num(vd, 'pathTracing', V[SET_PT]);

  const ac: any = o['access'];
  V[SET_SHAKE]      = num(ac, 'shake',      V[SET_SHAKE]);
  V[SET_COLORBLIND] = num(ac, 'colorblind', V[SET_COLORBLIND]);
  V[SET_CAPTIONS]   = num(ac, 'captions',   V[SET_CAPTIONS]);

  const m: any = o['meta'];
  M[0] = num(m, 'unlocks', 0);
  for (let i = 0; i < MAX_ARENAS; i++) {
    best[i] = num(m, 'best' + i, 0);
  }
}

/// Serialise by hand. JSON.stringify on Perry is not a road worth walking, and
/// the schema is small enough that building the text is clearer anyway.
export function saveSettings(): void {
  let s = '{\n';
  s = s + '  "audio": { "master": ' + V[SET_MASTER_VOL]
        + ', "music": ' + V[SET_MUSIC_VOL]
        + ', "sfx": ' + V[SET_SFX_VOL] + ' },\n';
  s = s + '  "controls": { "sensitivity": ' + V[SET_SENS]
        + ', "padSensitivity": ' + V[SET_PAD_SENS]
        + ', "invertY": ' + V[SET_INVERT_Y]
        + ', "aimToggle": ' + V[SET_AIM_TOGGLE]
        + ', "sprintToggle": ' + V[SET_SPRINT_TOGGLE] + ' },\n';
  s = s + '  "video": { "fov": ' + V[SET_FOV]
        + ', "renderScale": ' + V[SET_RENDER_SCALE]
        + ', "outputScale": ' + V[SET_OUTPUT_SCALE]
        + ', "shadows": ' + V[SET_SHADOWS]
        + ', "ssao": ' + V[SET_SSAO]
        + ', "ssr": ' + V[SET_SSR]
        + ', "ssgi": ' + V[SET_SSGI]
        + ', "bloom": ' + V[SET_BLOOM]
        + ', "pathTracing": ' + V[SET_PT] + ' },\n';
  s = s + '  "access": { "shake": ' + V[SET_SHAKE]
        + ', "colorblind": ' + V[SET_COLORBLIND]
        + ', "captions": ' + V[SET_CAPTIONS] + ' },\n';
  s = s + '  "meta": { "unlocks": ' + M[0];
  for (let i = 0; i < MAX_ARENAS; i++) {
    s = s + ', "best' + i + '": ' + best[i];
  }
  s = s + ' }\n}\n';
  writeFile(PATH, s);
}
