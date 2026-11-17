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

import { readFile, writeFile, fileExists, isMobile, getPlatform, getPreferredLanguages } from 'bloom/core';
import { resetBinds, bindsJson, bindsFromObject } from './binds';

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
// Plan 2.9 - look speed while aiming down the sights, as a multiple of the hip speed, and
// the pad's aim assist (slowdown, rotation, magnetism) as one switch.
export const SET_ADS_SENS   = 20;
export const SET_AIM_ASSIST = 21;  // 0/1
// Plan 3.5 - depth of field (behind menus and end screens), per-object motion blur, and dynamic resolution
// toward 60 Hz. The last two ship OFF: motion blur is a taste, and dynamic resolution trades
// sharpness for frame rate, which is the player's call and not a default.
export const SET_DOF        = 22;  // 0/1
export const SET_MOTION_BLUR = 23; // 0/1
export const SET_AUTO_RES   = 24;  // 0/1
// Plan Phase 4 (SH-059). Choice rows store the option's index.
export const SET_DIFFICULTY = 25;  // 0 easy, 1 normal, 2 hard (director + score read it)
export const SET_LANG       = 26;  // index into strings.ts LANG_NAMES
export const SET_HUD_SCALE  = 27;  // 0.8 .. 1.3 on top of the resolution scale
export const SET_COMPASS    = 28;  // 0/1 - the bearing strip at the top of the HUD
export const SET_DEADZONE   = 29;  // stick dead zone, 0.05 .. 0.40
export const SET_CURVE      = 30;  // stick response: 0 linear, 1 squared, 2 cubed
export const SET_VIBRATION  = 31;  // 0/1
export const SET_PRESET     = 32;  // 0 low, 1 medium, 2 high, 3 ultra, 4 custom
export const SET_WINDOW     = 33;  // 0 full screen, 1 windowed
export const SET_VSYNC      = 34;  // 0/1
export const SET_FPS_CAP    = 35;  // index into FPS_CAPS
export const SET_CAPTION_SIZE = 36; // 0 small, 1 medium, 2 large
export const SET_CAPTION_BG = 37;  // 0/1 - a dark plate behind subtitles
export const SET_PALETTE    = 38;  // 0 standard, 1 red-green safe, 2 blue-yellow safe, 3 high contrast
export const SET_CROUCH_TOGGLE = 39; // 0 = hold, 1 = toggle
// Plan Phase 6 - the tutorial and the one-time hints (tutor.ts).
export const SET_HINTS      = 40;  // 0/1
// Lit fog (the arenas that have it) and lamps that cast shadows: both are part of the quality
// presets, both desktop only. The display the game opens on: -1 = wherever the system put it.
export const SET_VFOG       = 41;  // 0/1
export const SET_LAMP_SHADOWS = 42; // 0/1
export const SET_MONITOR    = 43;  // display index, -1 = not chosen
// The river's mirrored reflection (a planar probe that redraws the scene: about 5 ms of a fight
// frame on an integrated GPU). Off, the water reflects the sky only. Part of the presets.
export const SET_WATER_REFL = 44;  // 0/1
// The GPU the graphics settings were last chosen for (autotune.ts): vendor id * 65536 + device
// id from the engine's adapter report, 0 = not recorded yet. Not a row.
export const SET_GPU_ID     = 45;
// The largest model texture, as a level: 0 = 1024 px, 1 = 2048, 2 = as authored (4096). Read
// before the models load, so a change applies at the next start. Part of the presets.
export const SET_TEXTURES   = 46;
export const SET_COUNT      = 47;
/// Pixels for each SET_TEXTURES level; 0 = no cap.
export const TEXTURE_CAPS = [1024, 2048, 0];

/// Frames per second for each SET_FPS_CAP option; 0 = no limit.
export const FPS_CAPS = [30, 60, 120, 144, 0];
/// Bumped when the meaning of stored values changes. v2: phones and the browser read the video
/// block (before, they ignored it, so an old file holds desktop values that would sink them).
const FILE_VERSION = 2;

const V = new Array<number>(SET_COUNT);
// A command-line override (`--render-scale 0.5` and friends) is for ONE launch. It lands in V so
// the game and the menu show it, and these three remember what the file held, so that a save
// during that launch (a harness, an arena change) writes the file's own value back. A row the
// player moved afterwards no longer equals the override and is saved as moved.
const OV_ON = new Array<number>(SET_COUNT);
const OV_VAL = new Array<number>(SET_COUNT);
const OV_KEEP = new Array<number>(SET_COUNT);
for (let i = 0; i < SET_COUNT; i++) { OV_ON[i] = 0; OV_VAL[i] = 0; OV_KEEP[i] = 0; }

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
  V[SET_ADS_SENS]   = 0.7;
  V[SET_AIM_ASSIST] = 1;
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
  V[SET_DOF]        = 1;
  V[SET_MOTION_BLUR] = 0;
  V[SET_AUTO_RES]   = 1;   // Phase 7.1: on for a fresh desktop install (40 -> 51 fps on the M1 Max)
  // Off by default: Lumen is the default GI everywhere; path tracing is
  // opt-in (it trades ~half the frame rate for traced lighting).
  V[SET_PT]         = 0;
  V[SET_DIFFICULTY] = 1;
  V[SET_LANG]       = systemLanguage();
  V[SET_HUD_SCALE]  = 1.0;
  V[SET_COMPASS]    = 1;
  V[SET_DEADZONE]   = 0.18;
  V[SET_CURVE]      = 1;
  V[SET_VIBRATION]  = 1;
  V[SET_PRESET]     = 2;
  V[SET_GPU_ID]     = 0;
  V[SET_TEXTURES]   = 1;
  V[SET_WINDOW]     = 0;
  V[SET_VSYNC]      = 1;
  V[SET_FPS_CAP]    = 1;
  V[SET_CAPTION_SIZE] = 1;
  V[SET_CAPTION_BG] = 1;
  V[SET_PALETTE]    = 0;
  V[SET_CROUCH_TOGGLE] = 0;
  V[SET_HINTS]      = 1;
  V[SET_VFOG]       = 1;
  V[SET_LAMP_SHADOWS] = 1;
  V[SET_WATER_REFL] = 1;
  V[SET_MONITOR]    = -1;
  platformDefaults();
  resetBinds();
  for (let i = 0; i < MAX_ARENAS; i++) best[i] = 0;
  M[0] = 0;
}

/// Phones and the browser start from their own render budget (measured in main.ts's profile
/// comments: an iPhone 16 Pro, a Pixel 4a, WebGPU without a profiler). Since Phase 4 these are
/// DEFAULTS the player may change, not a fixed profile; global illumination and path tracing
/// stay unavailable there (menu.ts hides the rows, applyGraphicsSettings skips them).
function platformDefaults(): void {
  const plat = getPlatform();
  const web = plat === 7;
  if (!isMobile() && !web) return;
  V[SET_AUTO_RES] = 0;           // desktop only: the row is hidden here and the scale is fixed
  V[SET_SSGI] = 0;
  V[SET_SSR] = 0;
  V[SET_PT] = 0;
  V[SET_DOF] = 0;
  V[SET_RENDER_SCALE] = web ? 0.65 : 0.5;
  V[SET_PRESET] = 4;
  if (plat === 5) {              // Android: the low tier
    V[SET_SHADOWS] = 0;
    V[SET_SSAO] = 0;
    V[SET_BLOOM] = 0;
  }
}

/// First run: start in the system's language when the game has it.
function systemLanguage(): number {
  const langs = getPreferredLanguages();
  if (langs.length < 1) return 0;
  const tag = langs[0];
  if (tag === null || tag === undefined || tag.length < 2) return 0;
  const c0 = tag.charCodeAt(0) | 32;
  const c1 = tag.charCodeAt(1) | 32;
  if (c0 === 100 && c1 === 101) return 1;   // de
  if (c0 === 102 && c1 === 114) return 2;   // fr
  if (c0 === 101 && c1 === 115) return 3;   // es
  return 0;
}

export function get(i: number): number { return V[i]; }
export function set(i: number, v: number): void { V[i] = v; }
/// Set a value for this launch only (see OV_ON above). Call after loadSettings.
export function override(i: number, v: number): void {
  if (OV_ON[i] === 0) OV_KEEP[i] = V[i];
  OV_ON[i] = 1; OV_VAL[i] = v; V[i] = v;
}
/// What saveSettings writes for a value: the file's own while a launch override still stands.
function P(i: number): number {
  if (OV_ON[i] !== 0 && V[i] === OV_VAL[i]) return OV_KEEP[i];
  return V[i];
}
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
  V[SET_ADS_SENS]    = num(c, 'adsSensitivity', V[SET_ADS_SENS]);
  V[SET_AIM_ASSIST]  = num(c, 'aimAssist', V[SET_AIM_ASSIST]);
  V[SET_INVERT_Y]    = num(c, 'invertY',       V[SET_INVERT_Y]);
  V[SET_AIM_TOGGLE]  = num(c, 'aimToggle',     V[SET_AIM_TOGGLE]);
  V[SET_SPRINT_TOGGLE] = num(c, 'sprintToggle', V[SET_SPRINT_TOGGLE]);

  const m0: any = o['meta'];
  const fileV = num(m0, 'v', 1);
  const g: any = o['game'];
  V[SET_DIFFICULTY] = num(g, 'difficulty', V[SET_DIFFICULTY]);
  V[SET_LANG]       = num(g, 'language', V[SET_LANG]);
  V[SET_HUD_SCALE]  = num(g, 'hudScale', V[SET_HUD_SCALE]);
  V[SET_COMPASS]    = num(g, 'compass', V[SET_COMPASS]);
  V[SET_HINTS]      = num(g, 'hints', V[SET_HINTS]);
  V[SET_DEADZONE]   = num(c, 'deadzone', V[SET_DEADZONE]);
  V[SET_CURVE]      = num(c, 'curve', V[SET_CURVE]);
  V[SET_VIBRATION]  = num(c, 'vibration', V[SET_VIBRATION]);
  V[SET_CROUCH_TOGGLE] = num(c, 'crouchToggle', V[SET_CROUCH_TOGGLE]);
  bindsFromObject(o['binds']);

  // An older file on a phone or in the browser holds desktop video values nothing read.
  const skipVideo = fileV < 2 && (isMobile() || getPlatform() === 7);
  const vd: any = skipVideo ? null : o['video'];
  V[SET_PRESET]  = num(vd, 'preset', fileV < 2 ? 4 : V[SET_PRESET]);
  V[SET_WINDOW]  = num(vd, 'window', V[SET_WINDOW]);
  V[SET_VSYNC]   = num(vd, 'vsync', V[SET_VSYNC]);
  V[SET_FPS_CAP] = num(vd, 'fpsCap', V[SET_FPS_CAP]);
  V[SET_FOV]          = num(vd, 'fov',         V[SET_FOV]);
  V[SET_RENDER_SCALE] = num(vd, 'renderScale', V[SET_RENDER_SCALE]);
  V[SET_OUTPUT_SCALE] = num(vd, 'outputScale', V[SET_OUTPUT_SCALE]);
  V[SET_SHADOWS] = num(vd, 'shadows', V[SET_SHADOWS]);
  V[SET_SSAO]    = num(vd, 'ssao', V[SET_SSAO]);
  V[SET_SSR]     = num(vd, 'ssr', V[SET_SSR]);
  V[SET_SSGI]    = num(vd, 'ssgi', V[SET_SSGI]);
  V[SET_BLOOM]   = num(vd, 'bloom', V[SET_BLOOM]);
  V[SET_DOF]     = num(vd, 'dof', V[SET_DOF]);
  V[SET_MOTION_BLUR] = num(vd, 'motionBlur', V[SET_MOTION_BLUR]);
  V[SET_AUTO_RES] = num(vd, 'autoRes', V[SET_AUTO_RES]);
  V[SET_PT]      = num(vd, 'pathTracing', V[SET_PT]);
  V[SET_VFOG]    = num(vd, 'litFog', V[SET_VFOG]);
  // A file from before the row existed: lamps cast shadows where they did then (high, ultra
  // and custom).
  V[SET_LAMP_SHADOWS] = num(vd, 'lampShadows', V[SET_PRESET] >= 2 ? 1 : 0);
  V[SET_WATER_REFL] = num(vd, 'waterReflections', V[SET_PRESET] === 0 ? 0 : 1);
  V[SET_MONITOR] = num(vd, 'monitor', V[SET_MONITOR]);
  V[SET_GPU_ID] = num(vd, 'gpuId', V[SET_GPU_ID]);
  // A file from before the row: what the preset would give (low 1024, ultra as authored).
  V[SET_TEXTURES] = num(vd, 'textures', V[SET_PRESET] === 0 ? 0 : (V[SET_PRESET] === 3 ? 2 : 1));

  const ac: any = o['access'];
  V[SET_SHAKE]      = num(ac, 'shake',      V[SET_SHAKE]);
  V[SET_CAPTIONS]   = num(ac, 'captions',   V[SET_CAPTIONS]);
  V[SET_CAPTION_SIZE] = num(ac, 'captionSize', V[SET_CAPTION_SIZE]);
  V[SET_CAPTION_BG] = num(ac, 'captionBg', V[SET_CAPTION_BG]);
  V[SET_PALETTE]    = num(ac, 'palette', V[SET_PALETTE]);
  clampChoices();

  const m: any = o['meta'];
  M[0] = num(m, 'unlocks', 0);
  for (let i = 0; i < MAX_ARENAS; i++) {
    best[i] = num(m, 'best' + i, 0);
  }
}

/// A hand-edited or damaged file must not index a table out of range.
function clampChoice(i: number, n: number): void {
  let v = Math.floor(V[i]);
  if (!(v >= 0)) v = 0;
  if (v > n - 1) v = n - 1;
  V[i] = v;
}
function clampChoices(): void {
  clampChoice(SET_DIFFICULTY, 3);
  clampChoice(SET_LANG, 4);
  clampChoice(SET_CURVE, 3);
  clampChoice(SET_PRESET, 5);
  clampChoice(SET_TEXTURES, 3);
  clampChoice(SET_WINDOW, 2);
  clampChoice(SET_FPS_CAP, 5);
  clampChoice(SET_CAPTION_SIZE, 3);
  clampChoice(SET_PALETTE, 4);
  V[SET_MONITOR] = Math.floor(V[SET_MONITOR]);
  if (!(V[SET_MONITOR] >= 0) || V[SET_MONITOR] > 15) V[SET_MONITOR] = -1;
  if (!(V[SET_HUD_SCALE] >= 0.8)) V[SET_HUD_SCALE] = 0.8;
  if (V[SET_HUD_SCALE] > 1.3) V[SET_HUD_SCALE] = 1.3;
  if (!(V[SET_DEADZONE] >= 0.05)) V[SET_DEADZONE] = 0.05;
  if (V[SET_DEADZONE] > 0.4) V[SET_DEADZONE] = 0.4;
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
        + ', "adsSensitivity": ' + V[SET_ADS_SENS]
        + ', "aimAssist": ' + V[SET_AIM_ASSIST]
        + ', "invertY": ' + V[SET_INVERT_Y]
        + ', "aimToggle": ' + V[SET_AIM_TOGGLE]
        + ', "sprintToggle": ' + V[SET_SPRINT_TOGGLE]
        + ', "crouchToggle": ' + V[SET_CROUCH_TOGGLE]
        + ', "deadzone": ' + V[SET_DEADZONE]
        + ', "curve": ' + V[SET_CURVE]
        + ', "vibration": ' + V[SET_VIBRATION] + ' },\n';
  s = s + '  "game": { "difficulty": ' + V[SET_DIFFICULTY]
        + ', "language": ' + V[SET_LANG]
        + ', "hudScale": ' + V[SET_HUD_SCALE]
        + ', "compass": ' + V[SET_COMPASS]
        + ', "hints": ' + V[SET_HINTS] + ' },\n';
  s = s + '  "binds": { ' + bindsJson() + ' },\n';
  s = s + '  "video": { "fov": ' + P(SET_FOV)
        + ', "renderScale": ' + P(SET_RENDER_SCALE)
        + ', "outputScale": ' + P(SET_OUTPUT_SCALE)
        + ', "shadows": ' + P(SET_SHADOWS)
        + ', "ssao": ' + P(SET_SSAO)
        + ', "ssr": ' + P(SET_SSR)
        + ', "ssgi": ' + P(SET_SSGI)
        + ', "bloom": ' + P(SET_BLOOM)
        + ', "dof": ' + P(SET_DOF)
        + ', "motionBlur": ' + P(SET_MOTION_BLUR)
        + ', "autoRes": ' + P(SET_AUTO_RES)
        + ', "pathTracing": ' + P(SET_PT)
        + ', "preset": ' + P(SET_PRESET)
        + ', "window": ' + P(SET_WINDOW)
        + ', "vsync": ' + P(SET_VSYNC)
        + ', "fpsCap": ' + P(SET_FPS_CAP)
        + ', "litFog": ' + P(SET_VFOG)
        + ', "lampShadows": ' + P(SET_LAMP_SHADOWS)
        + ', "waterReflections": ' + P(SET_WATER_REFL)
        + ', "textures": ' + P(SET_TEXTURES)
        + ', "monitor": ' + P(SET_MONITOR)
        + ', "gpuId": ' + V[SET_GPU_ID] + ' },\n';
  s = s + '  "access": { "shake": ' + V[SET_SHAKE]
        + ', "captions": ' + V[SET_CAPTIONS]
        + ', "captionSize": ' + V[SET_CAPTION_SIZE]
        + ', "captionBg": ' + V[SET_CAPTION_BG]
        + ', "palette": ' + V[SET_PALETTE] + ' },\n';
  s = s + '  "meta": { "v": ' + FILE_VERSION + ', "unlocks": ' + M[0];
  for (let i = 0; i < MAX_ARENAS; i++) {
    s = s + ', "best' + i + '": ' + best[i];
  }
  s = s + ' }\n}\n';
  writeFile(PATH, s);
}
