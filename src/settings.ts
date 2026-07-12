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
export const SET_COLORBLIND = 11;  // 0/1 — shape+flash cues instead of colour only
export const SET_CAPTIONS   = 12;  // 0/1 — telegraph captions
export const SET_COUNT      = 13;

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
  V[SET_RENDER_SCALE] = 0.5;
  V[SET_AIM_TOGGLE] = 0;
  V[SET_SPRINT_TOGGLE] = 0;
  V[SET_COLORBLIND] = 0;
  V[SET_CAPTIONS]   = 0;
  for (let i = 0; i < MAX_ARENAS; i++) best[i] = 0;
  M[0] = 0;
}

export function get(i: number): number { return V[i]; }
export function set(i: number, v: number): void { V[i] = v; }
export function bestScore(arena: number): number {
  return arena >= 0 && arena < MAX_ARENAS ? best[arena] : 0;
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
  const text = readFile(PATH);
  if (text === null || text === undefined || text.length < 2) return;

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
        + ', "renderScale": ' + V[SET_RENDER_SCALE] + ' },\n';
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
