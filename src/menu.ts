// SH-038 / plan Phase 4 (SH-059) - the front end: title, pause, settings, arena select,
// results and credits.
//
// An immediate-mode menu on the engine's 2D calls with ONE focus model shared by mouse,
// keyboard, gamepad and touch. Phase 4 rebuilt what it draws (ui.ts: panels, glyphs, the
// palette, the string table) and what it holds:
//
//   - settings are six TABS of rows built from one table (addRow), not one 25-row list;
//   - the BINDINGS tab rebinds keyboard/mouse and pad per action (binds.ts);
//   - the arena select is a row of cards with a picture each;
//   - the end of a run is a RESULTS screen with the run's numbers and somewhere to go
//     (it used to be a caption saying "press R");
//   - every screen change animates in, and every interaction makes a sound.
//
// (Engine EN-030 proposes a widget layer. This file is still the game's own; if that lands,
// the row table below is the part that maps onto it.)
//
// Perry rules: top-level functions, state in const arrays, tables filled by index in
// initMenus() (never .push), nothing touching the engine at module scope.

import {
  isKeyPressed, Key, loadTexture, fileExists, drawRect,
  isMouseButtonPressed, isMouseButtonDown, getMouseX, getMouseY, getMouseWheel,
  isGamepadAvailable, isGamepadButtonPressed, getGamepadAxis, isTV,
} from 'bloom';
import { drawTextureProRaw } from 'bloom/textures';
import { setLocalLightShadows } from 'bloom/scene';
import {
  getPhysicalHeight,
  setOutputScale, setRenderScale, setShadowsEnabled, setMotionBlurEnabled, setAutoResolution,
  setSsaoEnabled, setSsrEnabled, setSsgiEnabled, setBloomEnabled,
  setPathTracing, isPathTracingSupported, setPresentMode, setTargetFPS, toggleFullscreen,
  getMonitorCount, getMonitorWidth, getMonitorHeight, getCurrentMonitor, setMonitor,
} from 'bloom/core';
import * as SET from './settings';
import * as MIX from './audio-mix';
import * as FEEL from './feel';
import * as SCORE from './score';
import * as PROFILE from './profile';
import * as WPN from './weapons';
import * as UI from './ui';
import * as B from './binds';
import * as STR from './strings';
import { T, fmt } from './strings';
import { MOBILE, WEB, SMALL_GPU } from './input';
import { KIND_NAME } from './enemies';
import { ARENAS, ARENA_COUNT, ARENA_INDEX, selectArena } from './world-runtime';
import {
  A_EMBLEM, A_FADE_R, A_FADE_H, A_ARROW_L, A_ARROW_R, A_STAR, A_CHECK, A_SOFT,
  A_PANEL, A_PANEL_LINE, A_DISC, A_RING, A_LOCK, A_WPN_RIFLE, A_PIP,
} from './ui-atlas';

export const MENU_NONE     = 0;
export const MENU_PAUSE    = 1;
export const MENU_SETTINGS = 2;
export const MENU_LEVELS   = 3;
/// SH-049 - the front door. Same rows, same focus model, same draw code as the pause menu.
export const MENU_MAIN     = 4;
export const MENU_CREDITS  = 5;
/// The end of a run: its numbers, and where to go next.
export const MENU_RESULTS  = 6;
/// Phase 6 - spend credits on weapon upgrades, and the profile's lifetime numbers.
export const MENU_ARMORY   = 7;
export const MENU_RECORD   = 8;

// Row kinds.
const ROW_ACTION = 0;
const ROW_SLIDER = 1;
const ROW_TOGGLE = 2;
const ROW_CHOICE = 3;   // one of n named options; confirm cycles, left/right step
const ROW_BIND   = 4;   // an action's keyboard/mouse and pad bindings

// Row flags.
const F_DESKTOP = 1;    // not on phones, not in the browser (the platform decides these there)
const F_NOTOUCH = 2;    // not on phones (mouse and keyboard rows)

// Special R_IDX values of action rows.
const IDX_BACK = -1;
const IDX_RESET_BINDS = -2;

//   0 current menu   1 selected row   2 stick-repeat cooldown
//   3 where SETTINGS / ARENAS / CREDITS go back TO (they open from both the title and pause)
//   4 settings tab (index into TABS_VIS)   5 seconds since this screen or tab appeared
//   6 first visible row (scroll)   7 results: 1 = the run was won   8 bindings column
//   (0 keyboard, 1 pad)   9 results: wave reached   10 results: waves in the arena
//   11 selection highlight, smoothed y   12 1 = the pointer is what moved the selection last
//   13 previous mouse x   14 previous mouse y   15 results: 1 = new best score
//   16 1 = this screen opened this frame: the key that opened it must not also answer it
//   17 armoury: the weapon shown   18 armoury: seconds left of the "bought" flash
//   19 record: 1 = RESET PROGRESS has been pressed once (the next press erases)
const S = [MENU_NONE, 0, 0, MENU_PAUSE, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// The action a click/confirm produced this frame, read by main.ts.
export const ACT_NONE     = 0;
export const ACT_RESUME   = 1;
export const ACT_RESTART  = 2;
export const ACT_QUIT     = 3;
/// A level was chosen. The choice is already written; the game relaunches into it.
export const ACT_LEVEL    = 4;
/// Start the run from the main menu.
export const ACT_PLAY     = 5;
/// Leave the run for the title screen.
export const ACT_TITLE    = 6;
const A = [ACT_NONE];

// ---- the settings table -----------------------------------------------------------------
const TAB_GAME = 0, TAB_CONTROLS = 1, TAB_BINDS = 2, TAB_VIDEO = 3, TAB_AUDIO = 4, TAB_ACCESS = 5;
const TAB_COUNT = 6;
const TAB_LABEL = [STR.S_TAB_GAME, STR.S_TAB_CONTROLS, STR.S_TAB_BINDS, STR.S_TAB_VIDEO,
                   STR.S_TAB_AUDIO, STR.S_TAB_ACCESS];
// The tabs this platform shows (a phone has no BINDINGS tab), and how many.
const TABS_VIS = new Array<number>(TAB_COUNT);
const TN = [0];

const MAXR = 96;
const R_TAB   = new Array<number>(MAXR);
const R_KIND  = new Array<number>(MAXR);
const R_IDX   = new Array<number>(MAXR);   // setting index, action index (binds), or IDX_*
const R_LABEL = new Array<number>(MAXR);   // string id
const R_MIN   = new Array<number>(MAXR);
const R_MAX   = new Array<number>(MAXR);
const R_STEP  = new Array<number>(MAXR);
const R_OPT   = new Array<number>(MAXR);   // first option's string id (choices); -1 = languages, -2 = displays
const R_FLAGS = new Array<number>(MAXR);
const RN = [0];
// The rows of the open tab, in order.
const VIS = new Array<number>(MAXR);
const VN = [0];

function addRow(tab: number, kind: number, idx: number, label: number,
                min: number, max: number, step: number, opt: number, flags: number): void {
  const n = RN[0];
  if (n >= MAXR) return;
  R_TAB[n] = tab; R_KIND[n] = kind; R_IDX[n] = idx; R_LABEL[n] = label;
  R_MIN[n] = min; R_MAX[n] = max; R_STEP[n] = step; R_OPT[n] = opt; R_FLAGS[n] = flags;
  RN[0] = n + 1;
}
function slider(tab: number, idx: number, label: number, min: number, max: number, step: number, flags: number): void {
  addRow(tab, ROW_SLIDER, idx, label, min, max, step, 0, flags);
}
function toggle(tab: number, idx: number, label: number, flags: number): void {
  addRow(tab, ROW_TOGGLE, idx, label, 0, 1, 1, 0, flags);
}
function choice(tab: number, idx: number, label: number, opt: number, n: number, flags: number): void {
  addRow(tab, ROW_CHOICE, idx, label, 0, n - 1, 1, opt, flags);
}

function buildRows(): void {
  RN[0] = 0;
  // GAME
  choice(TAB_GAME, SET.SET_DIFFICULTY, STR.S_DIFFICULTY, STR.S_DIFF_0, 3, 0);
  choice(TAB_GAME, SET.SET_LANG, STR.S_LANGUAGE, -1, STR.LANG_COUNT, 0);
  slider(TAB_GAME, SET.SET_HUD_SCALE, STR.S_HUD_SCALE, 0.8, 1.3, 0.05, 0);
  toggle(TAB_GAME, SET.SET_COMPASS, STR.S_COMPASS, 0);
  toggle(TAB_GAME, SET.SET_HINTS, STR.S_HINTS, 0);
  slider(TAB_GAME, SET.SET_FOV, STR.S_FOV, 60, 100, 5, 0);
  // CONTROLS
  slider(TAB_CONTROLS, SET.SET_SENS, STR.S_SENS, 0.2, 3.0, 0.1, F_NOTOUCH);
  slider(TAB_CONTROLS, SET.SET_PAD_SENS, STR.S_PAD_SENS, 0.2, 3.0, 0.1, 0);
  slider(TAB_CONTROLS, SET.SET_ADS_SENS, STR.S_ADS_SENS, 0.3, 1.0, 0.05, 0);
  toggle(TAB_CONTROLS, SET.SET_INVERT_Y, STR.S_INVERT_Y, 0);
  slider(TAB_CONTROLS, SET.SET_DEADZONE, STR.S_DEADZONE, 0.05, 0.4, 0.01, 0);
  choice(TAB_CONTROLS, SET.SET_CURVE, STR.S_CURVE, STR.S_CURVE_0, 3, 0);
  toggle(TAB_CONTROLS, SET.SET_VIBRATION, STR.S_VIBRATION, 0);
  // BINDINGS: one row per action, then reset
  for (let a = 0; a < B.ACT_COUNT; a++) {
    addRow(TAB_BINDS, ROW_BIND, a, STR.S_ACT_0 + a, 0, 0, 0, 0, F_NOTOUCH);
  }
  addRow(TAB_BINDS, ROW_ACTION, IDX_RESET_BINDS, STR.S_RESET_BINDS, 0, 0, 0, 0, F_NOTOUCH);
  // VIDEO
  choice(TAB_VIDEO, SET.SET_PRESET, STR.S_PRESET, STR.S_PRESET_0, 5, F_DESKTOP);
  choice(TAB_VIDEO, SET.SET_WINDOW, STR.S_WINDOW_MODE, STR.S_WINDOW_0, 2, F_DESKTOP);
  // One option per display; the row is hidden while there is only one (rowHidden).
  choice(TAB_VIDEO, SET.SET_MONITOR, STR.S_MONITOR, -2, SMALL_GPU || WEB ? 1 : getMonitorCount(), F_DESKTOP);
  toggle(TAB_VIDEO, SET.SET_VSYNC, STR.S_VSYNC, F_DESKTOP);
  choice(TAB_VIDEO, SET.SET_FPS_CAP, STR.S_FPS_CAP, STR.S_FPS_0, 5, F_DESKTOP);
  slider(TAB_VIDEO, SET.SET_OUTPUT_SCALE, STR.S_OUT_SCALE, 0.5, 1.0, 0.05, F_DESKTOP);
  slider(TAB_VIDEO, SET.SET_RENDER_SCALE, STR.S_RENDER_SCALE, 0.5, 1.0, 0.05, 0);
  toggle(TAB_VIDEO, SET.SET_SHADOWS, STR.S_SHADOWS, 0);
  toggle(TAB_VIDEO, SET.SET_LAMP_SHADOWS, STR.S_LAMP_SHADOWS, F_DESKTOP);
  toggle(TAB_VIDEO, SET.SET_VFOG, STR.S_VFOG, F_DESKTOP);
  toggle(TAB_VIDEO, SET.SET_SSAO, STR.S_SSAO, 0);
  toggle(TAB_VIDEO, SET.SET_SSR, STR.S_SSR, F_DESKTOP);
  toggle(TAB_VIDEO, SET.SET_SSGI, STR.S_SSGI, F_DESKTOP);
  toggle(TAB_VIDEO, SET.SET_BLOOM, STR.S_BLOOM, 0);
  toggle(TAB_VIDEO, SET.SET_DOF, STR.S_DOF, F_DESKTOP);
  toggle(TAB_VIDEO, SET.SET_MOTION_BLUR, STR.S_MOTION_BLUR, F_DESKTOP);
  toggle(TAB_VIDEO, SET.SET_AUTO_RES, STR.S_AUTO_RES, F_DESKTOP);
  choice(TAB_VIDEO, SET.SET_PT, STR.S_PT, STR.S_PT_0, 3, F_DESKTOP);
  // AUDIO
  slider(TAB_AUDIO, SET.SET_MASTER_VOL, STR.S_MASTER_VOL, 0, 1, 0.05, 0);
  slider(TAB_AUDIO, SET.SET_MUSIC_VOL, STR.S_MUSIC_VOL, 0, 1, 0.05, 0);
  slider(TAB_AUDIO, SET.SET_SFX_VOL, STR.S_SFX_VOL, 0, 1, 0.05, 0);
  // ACCESSIBILITY
  toggle(TAB_ACCESS, SET.SET_CAPTIONS, STR.S_CAPTIONS, 0);
  choice(TAB_ACCESS, SET.SET_CAPTION_SIZE, STR.S_CAPTION_SIZE, STR.S_SIZE_0, 3, 0);
  toggle(TAB_ACCESS, SET.SET_CAPTION_BG, STR.S_CAPTION_BG, 0);
  choice(TAB_ACCESS, SET.SET_PALETTE, STR.S_PALETTE, STR.S_PALETTE_0, 4, 0);
  choice(TAB_ACCESS, SET.SET_AIM_TOGGLE, STR.S_AIM_MODE, STR.S_MODE_0, 2, 0);
  choice(TAB_ACCESS, SET.SET_SPRINT_TOGGLE, STR.S_SPRINT_MODE, STR.S_MODE_0, 2, F_NOTOUCH);
  choice(TAB_ACCESS, SET.SET_CROUCH_TOGGLE, STR.S_CROUCH_MODE, STR.S_MODE_0, 2, F_NOTOUCH);
  slider(TAB_ACCESS, SET.SET_AIM_ASSIST, STR.S_AIM_ASSIST, 0, 1, 0.1, 0);
  slider(TAB_ACCESS, SET.SET_SHAKE, STR.S_SHAKE, 0, 1, 0.1, 0);
  // every tab ends on BACK
  for (let t = 0; t < TAB_COUNT; t++) addRow(t, ROW_ACTION, IDX_BACK, STR.S_BACK, 0, 0, 0, 0, 0);

  let tn = 0;
  for (let t = 0; t < TAB_COUNT; t++) {
    if (t === TAB_BINDS && MOBILE) continue;
    TABS_VIS[tn] = t;
    tn = tn + 1;
  }
  TN[0] = tn;
}

function rowHidden(r: number): boolean {
  const f = R_FLAGS[r];
  if ((f & F_DESKTOP) !== 0 && (SMALL_GPU || WEB)) return true;
  if ((f & F_NOTOUCH) !== 0 && MOBILE) return true;
  if (R_IDX[r] === SET.SET_MONITOR && R_KIND[r] === ROW_CHOICE && R_MAX[r] < 1) return true;
  return false;
}

function rebuildVis(): void {
  const tab = TABS_VIS[S[4]];
  let n = 0;
  for (let r = 0; r < RN[0]; r++) {
    if (R_TAB[r] !== tab || rowHidden(r)) continue;
    VIS[n] = r;
    n = n + 1;
  }
  VN[0] = n;
}

// ---- row lists of the plain menus -----------------------------------------------------------
const PAUSE_LABELS = [STR.S_RESUME, STR.S_SETTINGS, STR.S_LEVEL_SELECT, STR.S_RESTART_RUN,
                      STR.S_MAIN_MENU, STR.S_QUIT];
// iOS, tvOS and Android apps do not quit themselves (the system closes them; Apple's review
// guidelines say so outright), so QUIT, the last row of both lists, is left off there.
const HAS_QUIT = !MOBILE && !isTV();
const PAUSE_COUNT = HAS_QUIT ? 6 : 5;
const MAIN_LABELS = [STR.S_PLAY, STR.S_LEVEL_SELECT, STR.S_SETTINGS, STR.S_ARMORY, STR.S_RECORD,
                     STR.S_CREDITS, STR.S_QUIT];
const MAIN_COUNT = HAS_QUIT ? 7 : 6;
// Results rows are built per run (NEXT ARENA only after a win with an arena left that the
// player's stars have opened).
const RES_ROWS = [0, 0, 0, 0, 0];  // what each row does: 1 again, 2 next arena, 3 arenas, 4 title, 5 armoury
const ARM_ROWS = PROFILE.TRACKS + 1;      // the four tracks, then BACK
const RES_N = [0];

// The run's length for the results screen (main owns the clock).
const S_TIME = [0];
export function setResultsTime(sec: number): void { S_TIME[0] = sec; }

// Arena thumbnails: -1 untried, 0 missing, else a texture handle.
const THUMB = [-1, -1, -1, -1, -1, -1, -1, -1];

export function initMenus(): void {
  S[0] = MENU_NONE; S[1] = 0; S[2] = 0; S[3] = MENU_PAUSE; S[4] = 0; S[5] = 0; S[6] = 0;
  S[8] = 0; S[11] = 0; S[12] = 0;
  A[0] = ACT_NONE;
  buildRows();
  rebuildVis();
}

export function menuOpen(): boolean { return S[0] !== MENU_NONE; }
export function currentMenu(): number { return S[0]; }
/// The selected row and the settings tab, for the harnesses.
export function menuRow(): number { return S[1]; }
export function menuTab(): number { return S[4]; }

function enter(m: number): void {
  S[0] = m; S[1] = 0; S[5] = 0; S[6] = 0; S[11] = -1; S[16] = 1;
  B.captureCancel();
}

export function openPause(): void { enter(MENU_PAUSE); S[3] = MENU_PAUSE; }
export function openMain(): void { enter(MENU_MAIN); S[3] = MENU_MAIN; }
export function closeMenu(): void {
  if (S[0] === MENU_SETTINGS) SET.saveSettings();
  B.captureCancel();
  S[0] = MENU_NONE;
}

/// The run has ended: show its numbers. `wave` is the wave reached (1-based), `waves` how many
/// the arena has.
export function openResults(won: boolean, wave: number, waves: number, newBest: boolean): void {
  enter(MENU_RESULTS);
  S[3] = MENU_RESULTS;
  S[7] = won ? 1 : 0; S[9] = wave; S[10] = waves; S[15] = newBest ? 1 : 0;
  let n = 0;
  RES_ROWS[n] = 1; n = n + 1;
  if (won && ARENA_INDEX + 1 < ARENA_COUNT && PROFILE.arenaUnlocked(ARENA_INDEX + 1)) { RES_ROWS[n] = 2; n = n + 1; }
  RES_ROWS[n] = 5; n = n + 1;
  RES_ROWS[n] = 3; n = n + 1;
  RES_ROWS[n] = 4; n = n + 1;
  RES_N[0] = n;
}

/// Open the settings on a given tab / the arena select / the credits (harnesses and main).
export function openSettingsTab(tab: number): void {
  enter(MENU_SETTINGS);
  S[4] = tab < TN[0] ? tab : 0;
  rebuildVis();
}
export function openLevels(): void { enter(MENU_LEVELS); S[1] = ARENA_INDEX; }
export function openCredits(): void { enter(MENU_CREDITS); }
export function openArmory(weapon: number): void { enter(MENU_ARMORY); S[17] = weapon; S[18] = 0; }
export function openRecord(): void { enter(MENU_RECORD); S[19] = 0; }
/// The weapon the armoury shows (the key-test harness).
export function armoryWeapon(): number { return S[17]; }
export function selectRow(r: number): void { S[1] = r; keepVisible(); }

/// Leave a sub-screen for whichever menu opened it. Settings are written on the way out, so
/// BACK is also SAVE: there is no separate "apply" to forget.
function back(): void {
  if (S[0] === MENU_SETTINGS) SET.saveSettings();
  MIX.uiBack();
  enter(S[3]);
}

function rowCount(): number {
  if (S[0] === MENU_MAIN) return MAIN_COUNT;
  if (S[0] === MENU_PAUSE) return PAUSE_COUNT;
  if (S[0] === MENU_LEVELS) return ARENA_COUNT + 1;   // + BACK
  if (S[0] === MENU_CREDITS) return 1;
  if (S[0] === MENU_RESULTS) return RES_N[0];
  if (S[0] === MENU_ARMORY) return ARM_ROWS;
  if (S[0] === MENU_RECORD) return 2;
  return VN[0];
}

// ---- applying settings ----------------------------------------------------------------------

/// The graphics rows a quality preset sets. Changing any of them by hand makes it CUSTOM.
function isPresetRow(idx: number): boolean {
  return idx === SET.SET_RENDER_SCALE || idx === SET.SET_SHADOWS || idx === SET.SET_SSAO
      || idx === SET.SET_SSR || idx === SET.SET_SSGI || idx === SET.SET_BLOOM
      || idx === SET.SET_MOTION_BLUR || idx === SET.SET_LAMP_SHADOWS || idx === SET.SET_VFOG;
}

/// Plan 4.3 - quality presets. Reflections stay off in all four: screen-space reflections
/// still splatter fireflies indoors (engine EN-061), so no preset may switch them on.
function applyPreset(p: number): void {
  if (p < 0 || p > 3) return;
  //                 low   medium high  ultra
  const scale    = [0.5,  0.6,   0.75, 1.0];
  const ssao     = [0,    1,     1,    1];
  const ssgi     = [0,    0,     1,    1];
  const lamps    = [0,    0,     1,    1];
  const fog      = [0,    1,     1,    1];
  SET.set(SET.SET_RENDER_SCALE, scale[p]);
  SET.set(SET.SET_SHADOWS, 1);
  SET.set(SET.SET_SSAO, ssao[p]);
  SET.set(SET.SET_SSR, 0);
  SET.set(SET.SET_SSGI, ssgi[p]);
  SET.set(SET.SET_BLOOM, 1);
  SET.set(SET.SET_MOTION_BLUR, 0);
  SET.set(SET.SET_LAMP_SHADOWS, lamps[p]);
  SET.set(SET.SET_VFOG, fog[p]);
  pushGraphics();
}

function applyFrameCap(): void {
  const v = SET.get(SET.SET_VSYNC) !== 0;
  // 0 = Fifo (vsync), 3 = AutoNoVsync. The cap is a sleep, so it holds with either.
  setPresentMode(v ? 0 : 3);
  const cap = SET.FPS_CAPS[SET.get(SET.SET_FPS_CAP)];
  // No limit and no vsync still gets a ceiling: an uncapped menu is a space heater.
  setTargetFPS(cap > 0 ? cap : (v ? 0 : 400));
}

/// Some settings must take effect the instant they move, or the row is a guess.
function applyLive(idx: number): void {
  if (idx === SET.SET_MASTER_VOL || idx === SET.SET_MUSIC_VOL || idx === SET.SET_SFX_VOL) {
    MIX.applyVolumes();
  } else if (idx === SET.SET_SHAKE) {
    FEEL.setShakeScale(SET.get(SET.SET_SHAKE));
  } else if (idx === SET.SET_VIBRATION) {
    FEEL.setRumbleOn(SET.get(SET.SET_VIBRATION) !== 0);
    FEEL.rumble(0.5, 0.5, 0.15);
  } else if (idx === SET.SET_LANG) {
    STR.setLanguage(SET.get(SET.SET_LANG));
  } else if (idx === SET.SET_PALETTE) {
    UI.setPalette(SET.get(SET.SET_PALETTE));
  } else if (idx === SET.SET_PRESET) {
    applyPreset(SET.get(SET.SET_PRESET));
    applyLampShadows();
  } else if (idx === SET.SET_WINDOW) {
    toggleFullscreen();
  } else if (idx === SET.SET_MONITOR) {
    setMonitor(SET.get(SET.SET_MONITOR));
  } else if (idx === SET.SET_VSYNC || idx === SET.SET_FPS_CAP) {
    applyFrameCap();
  } else if (idx === SET.SET_OUTPUT_SCALE) {
    setOutputScale(SET.get(SET.SET_OUTPUT_SCALE));
  } else if (idx === SET.SET_RENDER_SCALE) {
    setRenderScale(SET.get(SET.SET_RENDER_SCALE));
  } else if (idx === SET.SET_SHADOWS) {
    setShadowsEnabled(SET.get(SET.SET_SHADOWS) !== 0);
  } else if (idx === SET.SET_SSAO) {
    setSsaoEnabled(SET.get(SET.SET_SSAO) !== 0);
  } else if (idx === SET.SET_SSR) {
    setSsrEnabled(SET.get(SET.SET_SSR) !== 0);
  } else if (idx === SET.SET_SSGI) {
    setSsgiEnabled(SET.get(SET.SET_SSGI) !== 0);
  } else if (idx === SET.SET_BLOOM) {
    setBloomEnabled(SET.get(SET.SET_BLOOM) !== 0);
  } else if (idx === SET.SET_MOTION_BLUR) {
    setMotionBlurEnabled(SET.get(SET.SET_MOTION_BLUR) !== 0);
  } else if (idx === SET.SET_AUTO_RES) {
    applyAutoRes();
  } else if (idx === SET.SET_PT) {
    // No-op on devices without hardware ray query: the row reads "not supported" there.
    if (isPathTracingSupported()) setPathTracing(SET.get(SET.SET_PT));
  }
  if (isPresetRow(idx)) SET.set(SET.SET_PRESET, 4);
  if (isPresetRow(idx)) applyLampShadows();
}

/// Lamps that cast shadows on the house and the ground (engine EN-068). The four work lights
/// nearest the camera get a shadow cube. Desktop only (the engine refuses elsewhere) and only
/// with the sun's shadows on (it reuses their caster lists). Its own row since SH-066; the two
/// lowest presets switch it off, being for machines with no frame time to spare.
/// (The lit fog's row needs nothing here: main.ts watches the setting, because the fog's
/// numbers are the arena's and live there.)
export function applyLampShadows(): void {
  if (SMALL_GPU || WEB) return;
  const on = SET.get(SET.SET_SHADOWS) !== 0 && SET.get(SET.SET_LAMP_SHADOWS) !== 0;
  setLocalLightShadows(on ? 4 : 0, 512);
}

/// The render passes, from the settings. Phones and the browser never get global
/// illumination, reflections or path tracing whatever the file says (see settings.ts).
function pushGraphics(): void {
  const small = SMALL_GPU || WEB;
  setRenderScale(SET.get(SET.SET_RENDER_SCALE));
  setShadowsEnabled(SET.get(SET.SET_SHADOWS) !== 0);
  setSsaoEnabled(SET.get(SET.SET_SSAO) !== 0);
  setSsrEnabled(!small && SET.get(SET.SET_SSR) !== 0);
  setSsgiEnabled(!small && SET.get(SET.SET_SSGI) !== 0);
  setBloomEnabled(SET.get(SET.SET_BLOOM) !== 0);
  if (!small) setMotionBlurEnabled(SET.get(SET.SET_MOTION_BLUR) !== 0);
  applyLampShadows();
}

/// Push every setting that lives outside the frame loop into the engine and the game's own
/// modules. Called at boot, after settings load, on EVERY platform since Phase 4 (phones and
/// the browser used to ignore the file; their profile is now the file's default).
export function applyGraphicsSettings(): void {
  pushGraphics();
  // The Apple TV draws for a 1080p screen whatever the television is. On a 4K set the surface
  // is 3840 x 2160: every output-resolution target at that size was part of what took the game
  // past tvOS's 2.1 GB limit while loading (2026-11-15), and an A12 cannot fill it. 720p was
  // 6 ms a frame cheaper (--harness drawsweep, 2026-11-16) and shipped for a few hours: the
  // menus and the HUD are drawn at this size, and at 720p on a 4K set they were blurred.
  if (isTV() && getPhysicalHeight() > 1200) setOutputScale(0.5);
  if (!SMALL_GPU && !WEB) {
    setOutputScale(SET.get(SET.SET_OUTPUT_SCALE));
    applyAutoRes();
    applyFrameCap();
    if (isPathTracingSupported()) setPathTracing(SET.get(SET.SET_PT));
    // A chosen display that is still attached, and is not where the window opened.
    const mon = SET.get(SET.SET_MONITOR);
    if (mon >= 0 && mon < getMonitorCount() && mon !== getCurrentMonitor()) setMonitor(mon);
    // The game starts full screen; a saved "windowed" is one toggle away from that.
    if (SET.get(SET.SET_WINDOW) === 1) toggleFullscreen();
  }
  STR.setLanguage(SET.get(SET.SET_LANG));
  UI.setPalette(SET.get(SET.SET_PALETTE));
  FEEL.setRumbleOn(SET.get(SET.SET_VIBRATION) !== 0);
}

/// Dynamic resolution: on, the engine steps the render scale between 0.5 and 1.0 to hold
/// 60 Hz; off, the scale goes back to the player's own slider.
function applyAutoRes(): void {
  const on = SET.get(SET.SET_AUTO_RES) !== 0;
  setAutoResolution(60, on);
  if (!on) setRenderScale(SET.get(SET.SET_RENDER_SCALE));
}

// ---- changing rows --------------------------------------------------------------------------

/// Adjust the selected settings row. `dir` is -1 / +1.
function weaponOpen(w: number): boolean {
  return w < 2 || (SET.unlockMask() & (1 << w)) !== 0;
}

function armWeapon(w: number): void {
  S[17] = (w + PROFILE.WEAPONS) % PROFILE.WEAPONS;
  S[18] = 0;
  MIX.uiTab();
}

function adjust(dir: number): void {
  if (S[0] === MENU_ARMORY) { armWeapon(S[17] + dir); return; }
  if (S[0] !== MENU_SETTINGS) return;
  const r = VIS[S[1]];
  const kind = R_KIND[r];
  if (kind === ROW_ACTION) return;
  if (kind === ROW_BIND) {
    // Left/right picks the column: keyboard or pad.
    S[8] = dir > 0 ? 1 : 0;
    MIX.uiMove();
    return;
  }
  const idx = R_IDX[r];
  let v = SET.get(idx);
  // No display chosen yet: start from the one the window is on.
  if (idx === SET.SET_MONITOR && v < 0) v = getCurrentMonitor();
  if (kind === ROW_TOGGLE) {
    v = v !== 0 ? 0 : 1;
    MIX.uiToggle();
  } else if (kind === ROW_CHOICE) {
    if (rowDead(r)) { MIX.uiError(); return; }
    const n = R_MAX[r] + 1;
    v = (v + dir + n) % n;
    MIX.uiToggle();
  } else {
    const before = v;
    v = v + dir * R_STEP[r];
    if (v < R_MIN[r]) v = R_MIN[r];
    if (v > R_MAX[r]) v = R_MAX[r];
    // Kill float dust so the display doesn't read 0.7000000000000001.
    v = Math.round(v * 1000) / 1000;
    if (v !== before) MIX.uiTick();
  }
  SET.set(idx, v);
  applyLive(idx);
}

function setTab(t: number): void {
  const n = TN[0];
  S[4] = (t + n) % n;
  S[1] = 0; S[5] = 0; S[6] = 0; S[11] = -1;
  B.captureCancel();
  rebuildVis();
  MIX.uiTab();
}

function confirm(): void {
  if (S[0] === MENU_MAIN) {
    if (S[1] === 0) { MIX.uiStart(); A[0] = ACT_PLAY; closeMenu(); return; }
    MIX.uiSelect();
    if (S[1] === 1) { enter(MENU_LEVELS); S[1] = ARENA_INDEX; }
    else if (S[1] === 2) { enter(MENU_SETTINGS); rebuildVis(); }
    else if (S[1] === 3) { enter(MENU_ARMORY); S[17] = 0; S[18] = 0; }
    else if (S[1] === 4) { enter(MENU_RECORD); S[19] = 0; }
    else if (S[1] === 5) { enter(MENU_CREDITS); }
    else if (S[1] === 6) { A[0] = ACT_QUIT; }
    return;
  }
  if (S[0] === MENU_ARMORY) {
    if (S[1] >= PROFILE.TRACKS) { back(); return; }
    if (weaponOpen(S[17]) && PROFILE.buyUpgrade(S[17], S[1])) { MIX.uiStart(); S[18] = 0.6; }
    else MIX.uiError();
    return;
  }
  if (S[0] === MENU_RECORD) {
    if (S[1] === 0) { back(); return; }
    // RESET PROGRESS erases what was earned, so it has to be pressed twice.
    if (S[19] === 0) { S[19] = 1; MIX.uiError(); }
    else { PROFILE.resetProfile(); S[19] = 0; MIX.uiBack(); }
    return;
  }
  if (S[0] === MENU_PAUSE) {
    MIX.uiSelect();
    if (S[1] === 0) { A[0] = ACT_RESUME; closeMenu(); }
    else if (S[1] === 1) { enter(MENU_SETTINGS); rebuildVis(); }
    else if (S[1] === 2) { enter(MENU_LEVELS); S[1] = ARENA_INDEX; }
    else if (S[1] === 3) { A[0] = ACT_RESTART; closeMenu(); }
    else if (S[1] === 4) { A[0] = ACT_TITLE; }
    else if (S[1] === 5) { A[0] = ACT_QUIT; }
    return;
  }
  if (S[0] === MENU_RESULTS) {
    const what = RES_ROWS[S[1]];
    if (what === 1) { MIX.uiStart(); A[0] = ACT_RESTART; closeMenu(); }
    else if (what === 2) {
      MIX.uiSelect();
      selectArena(ARENAS[ARENA_INDEX + 1].id);
      A[0] = ACT_LEVEL;
    }
    else if (what === 3) { MIX.uiSelect(); enter(MENU_LEVELS); S[1] = ARENA_INDEX; }
    else if (what === 5) { MIX.uiSelect(); enter(MENU_ARMORY); S[17] = 0; S[18] = 0; }
    else if (what === 4) { MIX.uiSelect(); A[0] = ACT_TITLE; }
    return;
  }
  if (S[0] === MENU_CREDITS) { back(); return; }
  if (S[0] === MENU_LEVELS) {
    if (S[1] >= ARENA_COUNT) { back(); return; }
    // An arena opens when the stars earned in the others reach its number.
    if (!PROFILE.arenaUnlocked(S[1])) { MIX.uiError(); return; }
    MIX.uiSelect();
    // Picking a level writes the choice and asks the game to restart into it: a mid-run swap
    // would mean tearing down every collider, scatter and GI proxy the world built at startup.
    selectArena(ARENAS[S[1]].id);
    A[0] = ACT_LEVEL;
    return;
  }
  if (S[0] === MENU_SETTINGS) {
    const r = VIS[S[1]];
    const kind = R_KIND[r];
    if (kind === ROW_ACTION) {
      if (R_IDX[r] === IDX_RESET_BINDS) { B.resetBinds(); MIX.uiSelect(); }
      else back();
    } else if (kind === ROW_BIND) {
      const pad = S[8] === 1;
      if (B.rebindable(R_IDX[r], pad)) { B.captureStart(R_IDX[r], pad); MIX.uiSelect(); }
      else MIX.uiError();
    } else if (kind === ROW_TOGGLE || kind === ROW_CHOICE) {
      adjust(1);
    }
  }
}

function move(dir: number): void {
  const n = rowCount();
  S[1] = (S[1] + dir + n) % n;
  S[12] = 0;
  S[19] = 0;
  keepVisible();
  MIX.uiMove();
}

// ---- layout -----------------------------------------------------------------------------------
// One function says where row i is, and both the drawing and the pointer ask it.
//   G: 0 x  1 y  2 w  3 h   of the row asked for
//   L: 0 size factor  1 list x  2 list y  3 list w  4 row height  5 rows that fit
const G = [0, 0, 0, 0];
const L = [1, 0, 0, 0, 0, 0];

/// Size factor: 1 on a desktop-sized logical space, smaller on a phone's 460-unit height.
function kOf(sh: number): number { return sh < 760 ? sh / 760 : 1; }

function layout(sw: number, sh: number): void {
  const k = kOf(sh);
  L[0] = k;
  if (S[0] === MENU_MAIN || S[0] === MENU_PAUSE) {
    L[1] = sw * 0.085; L[3] = 440 * k; L[4] = (S[0] === MENU_MAIN ? 52 : 58) * k;
    L[2] = S[0] === MENU_MAIN ? sh * 0.43 : sh * 0.34;
    L[5] = rowCount();
  } else if (S[0] === MENU_ARMORY) {
    let w = sw * 0.62;
    if (w > 860 * k) w = 860 * k;
    if (w < 560 * k && sw * 0.94 >= 560 * k) w = 560 * k;
    L[3] = w; L[1] = (sw - w) / 2; L[2] = sh * 0.20 + 196 * k; L[4] = 62 * k; L[5] = ARM_ROWS;
  } else if (S[0] === MENU_RECORD) {
    L[3] = 300 * k; L[1] = (sw - L[3]) / 2; L[4] = 50 * k; L[2] = sh * 0.80; L[5] = 2;
  } else if (S[0] === MENU_SETTINGS) {
    let w = sw * 0.66;
    if (w > 1180 * k) w = 1180 * k;
    L[3] = w; L[1] = (sw - w) / 2; L[2] = sh * 0.235; L[4] = 44 * k;
    if (TABS_VIS[S[4]] === TAB_BINDS) L[4] = 34 * k;
    // A list a row or two too long is squeezed to fit before it is made to scroll.
    const avail = sh * 0.90 - L[2];
    if (VN[0] * L[4] > avail && avail / VN[0] >= 29 * k) L[4] = avail / VN[0];
    let fit = Math.floor(avail / L[4] + 0.001);
    if (fit < 3) fit = 3;
    L[5] = fit;
  } else if (S[0] === MENU_RESULTS) {
    // Under the numbers panel, whose top depends on whether the stars row is there
    // (drawResults lays the same things out in the same order).
    // Tighter on a phone, where five rows have to fit under the numbers.
    L[3] = 380 * k; L[1] = (sw - L[3]) / 2; L[4] = (k < 1 ? 44 : 52) * k;
    let cy = sh * 0.075 + 124 * k;
    cy = S[7] === 1 ? cy + 62 * k : cy + 10 * k;
    L[2] = cy + 282 * k; L[5] = rowCount();
  } else {
    // LEVELS and CREDITS: the BACK row sits centred under the content.
    L[3] = 300 * k; L[1] = (sw - L[3]) / 2; L[4] = 52 * k;
    L[2] = sh * 0.80; L[5] = 1;
  }
}

/// Arena card i of n: x, y, w, h into G.
function cardRect(i: number, sw: number, sh: number): void {
  const k = L[0];
  const gap = 28 * k;
  let cw = 470 * k;
  const room = sw * 0.90;
  if (cw * ARENA_COUNT + gap * (ARENA_COUNT - 1) > room) cw = (room - gap * (ARENA_COUNT - 1)) / ARENA_COUNT;
  const total = cw * ARENA_COUNT + gap * (ARENA_COUNT - 1);
  G[0] = (sw - total) / 2 + i * (cw + gap);
  G[2] = cw;
  G[3] = cw * 9 / 16 + 96 * k;
  G[1] = sh * 0.27;
}

function rowRect(i: number, sw: number, sh: number): boolean {
  if (S[0] === MENU_LEVELS) {
    if (i < ARENA_COUNT) { cardRect(i, sw, sh); return true; }
    G[0] = L[1]; G[1] = L[2]; G[2] = L[3]; G[3] = L[4] - 6;
    return true;
  }
  if (S[0] === MENU_SETTINGS) {
    const vi = i - S[6];
    if (vi < 0 || vi >= L[5]) return false;
    G[0] = L[1]; G[1] = L[2] + vi * L[4]; G[2] = L[3]; G[3] = L[4] - 4;
    return true;
  }
  if (S[0] === MENU_ARMORY && i >= PROFILE.TRACKS) {
    // BACK: a centred button under the four tracks.
    G[2] = 300 * L[0]; G[0] = (sw - G[2]) / 2; G[1] = L[2] + i * L[4] + 12 * L[0]; G[3] = 46 * L[0];
    return true;
  }
  if (S[0] === MENU_RECORD) {
    // BACK and RESET PROGRESS side by side.
    G[2] = L[3]; G[3] = L[4] - 6; G[1] = L[2];
    G[0] = sw / 2 + (i === 0 ? -G[2] - 10 * L[0] : 10 * L[0]);
    return true;
  }
  G[0] = L[1]; G[1] = L[2] + i * L[4]; G[2] = L[3]; G[3] = L[4] - 6;
  return true;
}

/// Weapon card w of the armoury strip: x, y, w, h into G.
function armCard(w: number, sw: number, sh: number): void {
  const k = L[0];
  const cw = L[3] / PROFILE.WEAPONS;
  G[0] = L[1] + w * cw + 5 * k; G[1] = sh * 0.20; G[2] = cw - 10 * k; G[3] = 132 * k;
}

function keepVisible(): void {
  if (S[0] !== MENU_SETTINGS) return;
  const fit = L[5] > 0 ? L[5] : 12;
  if (S[1] < S[6]) S[6] = S[1];
  if (S[1] >= S[6] + fit) S[6] = S[1] - fit + 1;
  const maxTop = VN[0] - fit;
  if (S[6] > maxTop) S[6] = maxTop;
  if (S[6] < 0) S[6] = 0;
}

/// Tab i of the strip: x, y, w, h into G.
function tabRect(i: number, sw: number, sh: number): void {
  const n = TN[0];
  const w = L[3] / n;
  G[0] = L[1] + i * w; G[1] = sh * 0.155; G[2] = w; G[3] = 40 * L[0];
}

// ---- update -------------------------------------------------------------------------------------

/// Drive the menu. Returns the action produced this frame (ACT_*). `uiScale`, `sw`, `sh` are
/// the HUD's logical space, so the pointer hit-test matches what is drawn.
export function updateMenu(dt: number, sw: number, sh: number, uiScale: number): number {
  A[0] = ACT_NONE;
  if (S[0] === MENU_NONE) return ACT_NONE;
  S[5] = S[5] + dt;
  layout(sw, sh);
  // Esc / Start opened the pause menu a few lines above this call in main's frame, and the
  // same press is still "pressed" here: without this, pause opened and closed in one frame.
  if (S[16] === 1) {
    S[16] = 0;
    S[13] = getMouseX() / uiScale; S[14] = getMouseY() / uiScale;
    return ACT_NONE;
  }

  // --- a binding is being captured: it owns every key and button until it resolves
  if (B.capturing()) {
    const res = B.capturePoll();
    if (res === 1) MIX.uiSelect();
    else if (res === 2) MIX.uiBack();
    else if (res === 3) MIX.uiToggle();
    return ACT_NONE;
  }

  const inLevels = S[0] === MENU_LEVELS;
  const inSettings = S[0] === MENU_SETTINGS;

  // --- keyboard (menu keys are fixed: a rebound W must not strand the player in a menu)
  if (isKeyPressed(Key.UP) || isKeyPressed(Key.W)) {
    if (inLevels) { if (S[1] >= ARENA_COUNT) { S[1] = ARENA_INDEX; MIX.uiMove(); } }
    else move(-1);
  }
  if (isKeyPressed(Key.DOWN) || isKeyPressed(Key.S)) {
    if (inLevels) { if (S[1] < ARENA_COUNT) { S[1] = ARENA_COUNT; MIX.uiMove(); } }
    else move(1);
  }
  if (isKeyPressed(Key.LEFT) || isKeyPressed(Key.A)) {
    if (inLevels) { if (S[1] > 0 && S[1] < ARENA_COUNT) { S[1] = S[1] - 1; MIX.uiMove(); } }
    else adjust(-1);
  }
  if (isKeyPressed(Key.RIGHT) || isKeyPressed(Key.D)) {
    if (inLevels) { if (S[1] < ARENA_COUNT - 1) { S[1] = S[1] + 1; MIX.uiMove(); } }
    else adjust(1);
  }
  if (inSettings) {
    if (isKeyPressed(Key.Q) || isKeyPressed(Key.PAGE_UP)) setTab(S[4] - 1);
    if (isKeyPressed(Key.E) || isKeyPressed(Key.PAGE_DOWN) || isKeyPressed(Key.TAB)) setTab(S[4] + 1);
    if (isKeyPressed(Key.DELETE) && R_KIND[VIS[S[1]]] === ROW_BIND && S[8] === 0
        && B.rebindable(R_IDX[VIS[S[1]]], false)) {
      B.setKbCode(R_IDX[VIS[S[1]]], -1);
      MIX.uiToggle();
    }
  }
  if (S[0] === MENU_ARMORY) {
    if (isKeyPressed(Key.Q) || isKeyPressed(Key.PAGE_UP)) armWeapon(S[17] - 1);
    if (isKeyPressed(Key.E) || isKeyPressed(Key.PAGE_DOWN) || isKeyPressed(Key.TAB)) armWeapon(S[17] + 1);
    if (S[18] > 0) S[18] = S[18] - dt;
  }
  if (isKeyPressed(Key.ENTER) || isKeyPressed(Key.SPACE)) confirm();
  if (isKeyPressed(Key.ESCAPE)) escape();

  // --- gamepad. D-pad is discrete; the stick needs a repeat timer or one flick scrolls the
  // whole list.
  if (isGamepadAvailable()) {
    let dv = 0, dh = 0;
    if (isGamepadButtonPressed(10)) dv = -1;
    if (isGamepadButtonPressed(11)) dv = 1;
    if (isGamepadButtonPressed(12)) dh = -1;
    if (isGamepadButtonPressed(13)) dh = 1;
    if (S[2] > 0) S[2] = S[2] - dt;
    const ly = getGamepadAxis(1);
    const lx = getGamepadAxis(0);
    if (S[2] <= 0) {
      if (ly < -0.6) { dv = -1; S[2] = 0.18; }
      else if (ly > 0.6) { dv = 1; S[2] = 0.18; }
      else if (lx < -0.6) { dh = -1; S[2] = 0.14; }
      else if (lx > 0.6) { dh = 1; S[2] = 0.14; }
    }
    if (inLevels) {
      if (dv < 0 && S[1] >= ARENA_COUNT) { S[1] = ARENA_INDEX; MIX.uiMove(); }
      if (dv > 0 && S[1] < ARENA_COUNT) { S[1] = ARENA_COUNT; MIX.uiMove(); }
      if (dh < 0 && S[1] > 0 && S[1] < ARENA_COUNT) { S[1] = S[1] - 1; MIX.uiMove(); }
      if (dh > 0 && S[1] < ARENA_COUNT - 1) { S[1] = S[1] + 1; MIX.uiMove(); }
    } else {
      if (dv !== 0) move(dv);
      if (dh !== 0) adjust(dh);
    }
    if (inSettings) {
      if (isGamepadButtonPressed(4)) setTab(S[4] - 1);   // LB
      if (isGamepadButtonPressed(5)) setTab(S[4] + 1);   // RB
    }
    if (S[0] === MENU_ARMORY) {
      if (isGamepadButtonPressed(4)) armWeapon(S[17] - 1);
      if (isGamepadButtonPressed(5)) armWeapon(S[17] + 1);
    }
    if (isGamepadButtonPressed(0)) confirm();            // A
    if (isGamepadButtonPressed(1)) escape();             // B
    // Start resumes, but only out of the pause menu itself.
    if (isGamepadButtonPressed(7) && S[0] === MENU_PAUSE) { A[0] = ACT_RESUME; closeMenu(); }
  }
  if (S[0] === MENU_NONE) return A[0];

  // --- pointer (mouse or a finger): hit-test the same rectangles that are drawn. The pointer
  // only takes the selection when it MOVES, so it does not fight the keys while it rests.
  const mx = getMouseX() / uiScale;
  const my = getMouseY() / uiScale;
  const moved = Math.abs(mx - S[13]) > 0.5 || Math.abs(my - S[14]) > 0.5;
  S[13] = mx; S[14] = my;
  const click = isMouseButtonPressed(0);
  if (moved || click) S[12] = 1;

  if (inSettings) {
    const wheel = getMouseWheel();
    if (wheel !== 0) {
      S[6] = S[6] - (wheel > 0 ? 1 : -1);
      const maxTop = VN[0] - L[5];
      if (S[6] > maxTop) S[6] = maxTop;
      if (S[6] < 0) S[6] = 0;
    }
    if (click) {
      for (let i = 0; i < TN[0]; i++) {
        tabRect(i, sw, sh);
        if (mx >= G[0] && mx <= G[0] + G[2] && my >= G[1] && my <= G[1] + G[3]) {
          if (i !== S[4]) setTab(i);
          return A[0];
        }
      }
    }
  }

  if (S[0] === MENU_ARMORY && click) {
    for (let w = 0; w < PROFILE.WEAPONS; w++) {
      armCard(w, sw, sh);
      if (mx >= G[0] && mx <= G[0] + G[2] && my >= G[1] && my <= G[1] + G[3]) {
        if (w !== S[17]) armWeapon(w);
        return A[0];
      }
    }
  }

  const n = rowCount();
  for (let i = 0; i < n; i++) {
    if (!rowRect(i, sw, sh)) continue;
    if (!(mx >= G[0] && mx <= G[0] + G[2] && my >= G[1] && my <= G[1] + G[3])) continue;
    if ((moved || click) && S[1] !== i) { S[1] = i; S[19] = 0; MIX.uiMove(); }
    if (!click) break;
    if (inSettings) {
      const r = VIS[i];
      const kind = R_KIND[r];
      const valX = G[0] + G[2] * 0.52;
      if (kind === ROW_SLIDER) {
        // Click ON the bar = set the value there, not twenty clicks on an arrow.
        const barX = valX;
        const barW = G[2] * 0.34;
        let t = (mx - barX) / barW;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        let v = R_MIN[r] + t * (R_MAX[r] - R_MIN[r]);
        v = Math.round(v / R_STEP[r]) * R_STEP[r];
        v = Math.round(v * 1000) / 1000;
        SET.set(R_IDX[r], v);
        applyLive(R_IDX[r]);
        MIX.uiTick();
      } else if (kind === ROW_CHOICE) {
        // Left half of the value steps back, right half forward.
        adjust(mx < valX + G[2] * 0.17 ? -1 : 1);
      } else if (kind === ROW_BIND) {
        S[8] = mx > G[0] + G[2] * 0.76 ? 1 : 0;
        confirm();
      } else {
        confirm();
      }
    } else {
      confirm();
    }
    break;
  }
  // A held mouse button drags a slider.
  if (inSettings && !click && isMouseButtonDown(0) && S[12] === 1 && S[1] < VN[0]) {
    const r = VIS[S[1]];
    if (R_KIND[r] === ROW_SLIDER && rowRect(S[1], sw, sh)
        && my >= G[1] && my <= G[1] + G[3] && mx >= G[0] + G[2] * 0.5) {
      let t = (mx - (G[0] + G[2] * 0.52)) / (G[2] * 0.34);
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      let v = R_MIN[r] + t * (R_MAX[r] - R_MIN[r]);
      v = Math.round(v / R_STEP[r]) * R_STEP[r];
      v = Math.round(v * 1000) / 1000;
      if (v !== SET.get(R_IDX[r])) {
        SET.set(R_IDX[r], v);
        applyLive(R_IDX[r]);
        MIX.uiTick();
      }
    }
  }

  return A[0];
}

function escape(): void {
  // On the title there is nothing behind to go back to, and the results screen has to be
  // answered: Escape does nothing on either rather than dumping the player into a dead run.
  if (S[0] === MENU_SETTINGS || S[0] === MENU_LEVELS || S[0] === MENU_CREDITS
      || S[0] === MENU_ARMORY || S[0] === MENU_RECORD) {
    back();
  } else if (S[0] === MENU_PAUSE) {
    MIX.uiBack();
    A[0] = ACT_RESUME;
    closeMenu();
  }
}

// ---- drawing --------------------------------------------------------------------------------------

/// Rows slide in from the left one after another when a screen appears.
function rowIn(i: number): number {
  return UI.easeOut((S[5] - 0.04 - i * 0.028) / 0.24);
}

function drawPlainRow(i: number, label: string, sw: number, sh: number): void {
  if (!rowRect(i, sw, sh)) return;
  const k = L[0];
  const t = rowIn(i);
  const sel = i === S[1];
  const x = G[0] - (1 - t) * 40 * k;
  const a = 255 * t;
  if (sel) {
    UI.spr(A_FADE_R, x - 18 * k, G[1], G[2] + 18 * k, G[3], UI.C_ACCENT, 48 * t);
    drawRect(x - 18 * k, G[1], 4 * k, G[3], UI.col(UI.C_ACCENT, a));
  }
  const fs = (sel ? 32 : 28) * k;
  UI.textS(label, x + (sel ? 10 * k : 0), G[1] + (G[3] - fs) / 2, fs,
           sel ? UI.C_BRIGHT : UI.C_TEXT, sel ? a : a * 0.86);
}

function drawTitle(s: string, sw: number, sh: number, y: number, size: number): void {
  const t = UI.easeOut(S[5] / 0.3);
  const w = UI.textW(s, size);
  UI.textS(s, (sw - w) / 2, y - (1 - t) * 14, size, UI.C_BRIGHT, 255 * t);
  UI.spr(A_FADE_H, (sw - w * 1.5) / 2, y + size * 1.22, w * 1.5, 3, UI.C_ACCENT, 200 * t);
}

function thumb(i: number): number {
  if (i < 0 || i > 7) return 0;
  if (THUMB[i] === -1) {
    const p = 'assets/ui/' + ARENAS[i].id + '.png';
    if (fileExists(p)) {
      const tx = loadTexture(p);
      THUMB[i] = tx.handle > 0 ? tx.handle : 0;
    } else {
      THUMB[i] = 0;
    }
  }
  return THUMB[i];
}

/// An arena's picture into a rectangle (the pictures are 640 x 360).
function drawThumb(i: number, x: number, y: number, w: number, h: number, a: number): void {
  const tx = thumb(i);
  if (tx === 0) { drawRect(x, y, w, h, UI.col(UI.C_PANEL, a)); return; }
  drawTextureProRaw(tx, 0, 0, 640, 360, x, y, w, h, 0, 0, 0, 255, 255, 255, Math.floor(a));
}

function arenaSub(i: number): string {
  if (i === 0) return T(STR.S_ARENA_SUB_0);
  if (i === 1) return T(STR.S_ARENA_SUB_1);
  if (i === 2) return T(STR.S_ARENA_SUB_2);
  if (i === 3) return T(STR.S_ARENA_SUB_3);
  if (i === 4) return T(STR.S_ARENA_SUB_4);
  return '';
}

function timeText(sec: number): string {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return '' + m + ':' + (r < 10 ? '0' : '') + r;
}

/// The strip along the bottom: what the buttons do here, as glyphs for the device in use.
function drawHints(sw: number, sh: number): void {
  if (MOBILE) return;
  const k = L[0];
  const h = 26 * k;
  const y = sh - 54 * k;
  const pad = UI.padGlyphs();
  const a = 210 * UI.easeOut(S[5] / 0.4);
  let x = sw * 0.085;
  const fs = h * 0.62;
  const gap = 26 * k;
  // navigate
  if (pad) { UI.drawPadGlyph(10, x, y, h, a); x = x + h + 6 * k; }
  else {
    UI.drawKbGlyph(Key.UP, x, y, h, a); x = x + UI.kbGlyphW(Key.UP, h) + 4 * k;
    UI.drawKbGlyph(Key.DOWN, x, y, h, a); x = x + UI.kbGlyphW(Key.DOWN, h) + 6 * k;
  }
  UI.textS(T(STR.S_HINT_NAV), x, y + (h - fs) / 2, fs, UI.C_DIM, a);
  x = x + UI.textW(T(STR.S_HINT_NAV), fs) + gap;
  // select
  if (pad) { UI.drawPadGlyph(0, x, y, h, a); x = x + h + 6 * k; }
  else { UI.drawKbGlyph(Key.ENTER, x, y, h, a); x = x + UI.kbGlyphW(Key.ENTER, h) + 6 * k; }
  UI.textS(T(STR.S_HINT_SELECT), x, y + (h - fs) / 2, fs, UI.C_DIM, a);
  x = x + UI.textW(T(STR.S_HINT_SELECT), fs) + gap;
  // back
  if (S[0] !== MENU_MAIN && S[0] !== MENU_RESULTS) {
    if (pad) { UI.drawPadGlyph(1, x, y, h, a); x = x + h + 6 * k; }
    else { UI.drawKbGlyph(Key.ESCAPE, x, y, h, a); x = x + UI.kbGlyphW(Key.ESCAPE, h) + 6 * k; }
    UI.textS(T(STR.S_HINT_BACK), x, y + (h - fs) / 2, fs, UI.C_DIM, a);
    x = x + UI.textW(T(STR.S_HINT_BACK), fs) + gap;
  }
  if (S[0] === MENU_SETTINGS || S[0] === MENU_ARMORY) {
    if (pad) {
      UI.drawPadGlyph(4, x, y, h, a); x = x + UI.padGlyphW(4, h) + 4 * k;
      UI.drawPadGlyph(5, x, y, h, a); x = x + UI.padGlyphW(5, h) + 6 * k;
    } else {
      UI.drawKbGlyph(Key.Q, x, y, h, a); x = x + h + 4 * k;
      UI.drawKbGlyph(Key.E, x, y, h, a); x = x + h + 6 * k;
    }
    UI.textS(T(S[0] === MENU_ARMORY ? STR.S_HINT_WEAPON : STR.S_HINT_TAB), x, y + (h - fs) / 2, fs, UI.C_DIM, a);
    x = x + UI.textW(T(STR.S_HINT_TAB), fs) + gap;
    if (!pad && S[0] === MENU_SETTINGS && TABS_VIS[S[4]] === TAB_BINDS) {
      UI.drawKbGlyph(Key.DELETE, x, y, h, a); x = x + UI.kbGlyphW(Key.DELETE, h) + 6 * k;
      UI.textS(T(STR.S_HINT_CLEAR), x, y + (h - fs) / 2, fs, UI.C_DIM, a);
    }
  }
}

function drawMainOrPause(sw: number, sh: number): void {
  const k = L[0];
  const main = S[0] === MENU_MAIN;
  const t0 = UI.easeOut(S[5] / 0.35);
  // The left third darkens so the rows read over any backdrop; the right stays a picture.
  UI.spr(A_FADE_R, 0, 0, sw * (main ? 0.62 : 0.55), sh, UI.C_BLACK, UI.panelA(main ? 215 : 235));
  if (!main) drawRect(0, 0, sw, sh, UI.col(UI.C_BLACK, 90));

  const x0 = L[1];
  if (main) {
    const ey = sh * 0.15;
    const es = 132 * k;
    UI.spr(A_EMBLEM, x0, ey - (1 - t0) * 10, es, es, UI.C_ACCENT, 255 * t0);
    UI.textS('BLOOM', x0 + es + 26 * k, ey + 2 * k, 62 * k, UI.C_BRIGHT, 255 * t0);
    UI.textS('SHOOTER', x0 + es + 26 * k, ey + 60 * k, 62 * k, UI.C_ACCENT, 255 * t0);
    UI.spr(A_FADE_R, x0, ey + es + 16 * k, 520 * k, 2, UI.C_ACCENT, 190 * t0);
    UI.textS(T(STR.S_TAGLINE), x0, ey + es + 28 * k, 19 * k, UI.C_DIM, 230 * t0);
    drawWallet(x0 + 540 * k, ey + es + 26 * k, k, 230 * t0, false);
  } else {
    UI.textS(T(STR.S_PAUSED), x0, sh * 0.19, 58 * k, UI.C_BRIGHT, 255 * t0);
    UI.spr(A_FADE_R, x0, sh * 0.19 + 76 * k, 420 * k, 2, UI.C_ACCENT, 190 * t0);
    UI.textS(ARENAS[ARENA_INDEX].name + '   ' + T(STR.S_SCORE) + ' ' + SCORE.score(),
             x0, sh * 0.19 + 88 * k, 19 * k, UI.C_DIM, 230 * t0);
  }

  const n = rowCount();
  for (let i = 0; i < n; i++) {
    drawPlainRow(i, T(main ? MAIN_LABELS[i] : PAUSE_LABELS[i]), sw, sh);
  }

  if (main) {
    // The arena PLAY drops you into, with its picture and your best there: both are things
    // to know BEFORE pressing play.
    const cw = 420 * k;
    const ch = cw * 9 / 16;
    const cx = sw - cw - sw * 0.06;
    const cy = sh - ch - 150 * k;
    const ta = UI.easeOut((S[5] - 0.15) / 0.4);
    UI.panel(cx - 10 * k, cy - 10 * k + (1 - ta) * 20, cw + 20 * k, ch + 92 * k, 225 * ta);
    drawThumb(ARENA_INDEX, cx, cy + (1 - ta) * 20, cw, ch, 255 * ta);
    UI.text(ARENAS[ARENA_INDEX].name, cx + 4 * k, cy + ch + 10 * k, 26 * k, UI.C_BRIGHT, 255 * ta);
    UI.text(arenaSub(ARENA_INDEX), cx + 4 * k, cy + ch + 44 * k, 16 * k, UI.C_DIM, 230 * ta);
    const best = SET.bestScore(ARENA_INDEX);
    if (best > 0) {
      UI.textR(T(STR.S_BEST) + '  ' + best, cx + cw - 4 * k, cy + ch + 14 * k, 19 * k, UI.C_ACCENT, 255 * ta);
    }
    UI.textR(T(STR.S_VERSION), sw - sw * 0.06, sh - 46 * k, 14 * k, UI.C_DIM, 150 * ta);
  }
}

/// A choice row that cannot be changed right now, and says why in place of its value: path
/// tracing without ray-query hardware, and the frame-rate limit while vertical sync is on
/// (the engine's limit is a sleep it only takes when the display is not already pacing it).
function rowDead(r: number): boolean {
  if (R_IDX[r] === SET.SET_PT && !isPathTracingSupported()) return true;
  if (R_IDX[r] === SET.SET_FPS_CAP && SET.get(SET.SET_VSYNC) !== 0) return true;
  return false;
}

function choiceText(r: number, v: number): string {
  if (R_OPT[r] === -2) {
    // "2  3456 X 2234": the font is Latin capitals, and a display's own name need not be.
    const m = v >= 0 && v <= R_MAX[r] ? v : getCurrentMonitor();
    return '' + (m + 1) + '  ' + getMonitorWidth(m) + ' X ' + getMonitorHeight(m);
  }
  if (R_OPT[r] < 0) return STR.LANG_NAMES[v];
  if (R_IDX[r] === SET.SET_FPS_CAP && SET.get(SET.SET_VSYNC) !== 0) return T(STR.S_FPS_VSYNC);
  if (R_IDX[r] === SET.SET_PT && !isPathTracingSupported()) return T(STR.S_PT_NA);
  return T(R_OPT[r] + v);
}

function drawSettings(sw: number, sh: number): void {
  const k = L[0];
  drawRect(0, 0, sw, sh, UI.col(UI.C_BLACK, UI.panelA(200)));
  drawTitle(T(STR.S_SETTINGS), sw, sh, sh * 0.06, 44 * k);

  // tab strip
  for (let i = 0; i < TN[0]; i++) {
    tabRect(i, sw, sh);
    const on = i === S[4];
    const label = T(TAB_LABEL[TABS_VIS[i]]);
    let fs = 21 * k;
    const tw = UI.textW(label, fs);
    if (tw > G[2] - 10 * k) fs = fs * (G[2] - 10 * k) / tw;
    if (on) {
      UI.nine(A_PANEL, G[0] + 2, G[1], G[2] - 4, G[3], 12 * k, UI.C_ACCENT, 235);
      UI.textC(label, G[0] + G[2] / 2, G[1] + (G[3] - fs) / 2, fs, UI.C_PANEL, 255);
    } else {
      UI.nine(A_PANEL_LINE, G[0] + 2, G[1], G[2] - 4, G[3], 12 * k, UI.C_LINE, 170);
      UI.textC(label, G[0] + G[2] / 2, G[1] + (G[3] - fs) / 2, fs, UI.C_TEXT, 220);
    }
  }

  const binds = TABS_VIS[S[4]] === TAB_BINDS;
  const n = VN[0];
  const top = L[2];
  const shownRows = n < L[5] ? n : L[5];
  UI.panel(L[1] - 22 * k, top - 14 * k, L[3] + 44 * k, shownRows * L[4] + 24 * k, 150);

  if (binds) {
    // column heads
    const hy = top - 12 * k;
    UI.textC(T(STR.S_KEYBOARD), L[1] + L[3] * 0.62, hy - 26 * k, 14 * k, S[8] === 0 ? UI.C_ACCENT : UI.C_DIM, 235);
    UI.textC(T(STR.S_GAMEPAD), L[1] + L[3] * 0.87, hy - 26 * k, 14 * k, S[8] === 1 ? UI.C_ACCENT : UI.C_DIM, 235);
  }

  for (let i = 0; i < n; i++) {
    if (!rowRect(i, sw, sh)) continue;
    const r = VIS[i];
    const kind = R_KIND[r];
    const sel = i === S[1];
    const t = rowIn(i - S[6]);
    const a = 255 * t;
    const x = G[0] - (1 - t) * 24 * k;
    const y = G[1];
    const h = G[3];
    if (sel) {
      UI.nine(A_PANEL, x - 12 * k, y, G[2] + 24 * k, h, 10 * k, UI.C_ACCENT, 26 * t);
      drawRect(x - 12 * k, y, 4 * k, h, UI.col(UI.C_ACCENT, a));
    }
    const fs = (binds ? 20 : 23) * k;
    const ty = y + (h - fs) / 2;
    UI.text(T(R_LABEL[r]), x + 6 * k, ty, fs, sel ? UI.C_BRIGHT : UI.C_TEXT, sel ? a : a * 0.88);
    if (kind === ROW_ACTION) continue;

    const valX = x + G[2] * 0.52;
    if (kind === ROW_BIND) {
      const act = R_IDX[r];
      const gh = h * 0.82;
      const gy = y + (h - gh) / 2;
      for (let cI = 0; cI < 2; cI++) {
        const pad = cI === 1;
        const cx = x + G[2] * (pad ? 0.87 : 0.62);
        const focus = sel && S[8] === cI;
        if (focus) UI.nine(A_PANEL_LINE, cx - G[2] * 0.11, y + 1, G[2] * 0.22, h - 2, 9 * k, UI.C_ACCENT, 255);
        if (B.capturing() && B.captureAction() === act && B.capturePad() === pad) {
          const blink = 150 + 105 * Math.sin(S[5] * 9);
          UI.textC(T(pad ? STR.S_PRESS_BUTTON : STR.S_PRESS_KEY), cx, ty, fs * 0.8, UI.C_ACCENT, blink);
          continue;
        }
        const ga = B.rebindable(act, pad) ? a : a * 0.55;
        if (pad) {
          const code = B.padCode(act);
          UI.drawPadGlyph(act === B.ACT_PAUSE ? 7 : code, cx - UI.padGlyphW(code, gh) / 2, gy, gh, ga);
        } else {
          const code = B.kbCode(act);
          UI.drawKbGlyph(code, cx - UI.kbGlyphW(code, gh) / 2, gy, gh, ga);
        }
      }
      continue;
    }

    const v = SET.get(R_IDX[r]);
    if (kind === ROW_TOGGLE) {
      // A switch: a track with a knob, and the word, so state never rests on colour alone.
      const on = v !== 0;
      const tw = 54 * k, th = 24 * k;
      const sy = y + (h - th) / 2;
      UI.nine(A_PANEL, valX, sy, tw, th, 8 * k, on ? UI.C_GOOD : UI.C_LINE, on ? a : a * 0.6);
      UI.spr(A_DISC, on ? valX + tw - th + 2 * k : valX + 2 * k, sy + 2 * k, th - 4 * k, th - 4 * k, UI.C_BRIGHT, a);
      UI.text(T(on ? STR.S_ON : STR.S_OFF), valX + tw + 16 * k, ty, fs, on ? UI.C_BRIGHT : UI.C_DIM, a);
    } else if (kind === ROW_CHOICE) {
      const cw = G[2] * 0.34;
      const txt = choiceText(r, v);
      const dead = rowDead(r);
      let cfs = fs;
      const cww = UI.textW(txt, cfs);
      if (cww > cw - 60 * k) cfs = cfs * (cw - 60 * k) / cww;
      if (sel && !dead) {
        UI.spr(A_ARROW_L, valX, y + (h - 20 * k) / 2, 20 * k, 20 * k, UI.C_ACCENT, a);
        UI.spr(A_ARROW_R, valX + cw - 20 * k, y + (h - 20 * k) / 2, 20 * k, 20 * k, UI.C_ACCENT, a);
      }
      UI.textC(txt, valX + cw / 2, y + (h - cfs) / 2 - 5 * k, cfs, dead ? UI.C_DIM : (sel ? UI.C_BRIGHT : UI.C_TEXT), a);
      // which of n: a row of ticks under the word, on the row in focus
      if (!dead && sel) {
        const nOpt = R_MAX[r] + 1;
        const dw = 14 * k, dg = 5 * k;
        const dx0 = valX + cw / 2 - (nOpt * dw + (nOpt - 1) * dg) / 2;
        for (let o = 0; o < nOpt; o++) {
          drawRect(dx0 + o * (dw + dg), y + h - 3 * k, dw, 2 * k,
                   UI.col(o === v ? UI.C_ACCENT : UI.C_LINE, o === v ? a : a * 0.6));
        }
      }
    } else {
      const bw = G[2] * 0.34;
      const tt = (v - R_MIN[r]) / (R_MAX[r] - R_MIN[r]);
      const by = y + h / 2 - 3 * k;
      drawRect(valX, by, bw, 6 * k, UI.col(UI.C_LINE, a * 0.6));
      drawRect(valX, by, bw * tt, 6 * k, UI.col(UI.C_ACCENT, a));
      UI.spr(A_DISC, valX + bw * tt - 9 * k, y + h / 2 - 9 * k, 18 * k, 18 * k, sel ? UI.C_BRIGHT : UI.C_TEXT, a);
      // The number matters: "sensitivity 1.4" is something a player can carry between games.
      let txt = v.toFixed(2);
      if (R_MAX[r] > 5) txt = '' + Math.round(v);
      else if (R_IDX[r] === SET.SET_OUTPUT_SCALE || R_IDX[r] === SET.SET_RENDER_SCALE
               || R_IDX[r] === SET.SET_HUD_SCALE || (R_MAX[r] === 1 && R_MIN[r] === 0)) {
        txt = '' + Math.round(v * 100) + '%';
      }
      UI.text(txt, valX + bw + 18 * k, ty, fs * 0.9, UI.C_DIM, a);
    }
  }

  // more rows above / below
  if (S[6] > 0) UI.sprRot(A_ARROW_R, sw / 2, top - 6 * k, 18 * k, 18 * k, 9 * k, 9 * k, -90, UI.C_ACCENT, 220);
  if (S[6] + L[5] < n) UI.sprRot(A_ARROW_R, sw / 2, top + L[5] * L[4] + 16 * k, 18 * k, 18 * k, 9 * k, 9 * k, 90, UI.C_ACCENT, 220);
}

function drawLevels(sw: number, sh: number): void {
  const k = L[0];
  drawRect(0, 0, sw, sh, UI.col(UI.C_BLACK, UI.panelA(190)));
  drawTitle(T(STR.S_SELECT_ARENA), sw, sh, sh * 0.07, 44 * k);
  for (let i = 0; i < ARENA_COUNT; i++) {
    cardRect(i, sw, sh);
    const sel = i === S[1];
    const t = UI.easeOut((S[5] - 0.05 - i * 0.07) / 0.3);
    const lift = sel ? -10 * k : 0;
    const x = G[0], y = G[1] + lift + (1 - t) * 30, w = G[2], h = G[3];
    const a = 255 * t;
    UI.nine(A_PANEL, x, y, w, h, 14 * k, UI.C_PANEL, UI.panelA(sel ? 240 : 205) * t);
    const ph = w * 9 / 16;
    drawThumb(i, x + 8 * k, y + 8 * k, w - 16 * k, ph - 8 * k, sel ? a : a * 0.72);
    UI.nine(A_PANEL_LINE, x, y, w, h, 14 * k, sel ? UI.C_ACCENT : UI.C_LINE, sel ? a : a * 0.6);
    if (sel) UI.nine(A_PANEL_LINE, x - 3, y - 3, w + 6, h + 6, 15 * k, UI.C_ACCENT, a * 0.45);
    // The name has the card's width to itself (five cards are narrow); the stars sit below it.
    let nfs = 26 * k;
    const nmw = UI.textW(ARENAS[i].name, nfs);
    if (nmw > w - 32 * k) nfs = nfs * (w - 32 * k) / nmw;
    UI.text(ARENAS[i].name, x + 16 * k, y + ph + 10 * k, nfs, sel ? UI.C_BRIGHT : UI.C_TEXT, a);
    UI.text(arenaSub(i), x + 16 * k, y + ph + 44 * k, 15 * k, UI.C_DIM, a);
    const best = SET.bestScore(i);
    UI.text(best > 0 ? T(STR.S_BEST) + '  ' + best : T(STR.S_NO_SCORE),
            x + 16 * k, y + ph + 66 * k, 15 * k, best > 0 ? UI.C_ACCENT : UI.C_DIM, a);
    drawStars(PROFILE.arenaStars(i), x + w - 16 * k - 3 * 24 * k, y + ph + 62 * k, 20 * k, a);
    if (!PROFILE.arenaUnlocked(i)) {
      // Locked: the picture goes dark under a padlock, and the card says what opens it.
      drawRect(x + 8 * k, y + 8 * k, w - 16 * k, ph - 8 * k, UI.col(UI.C_BLACK, 170 * t));
      const ls = 64 * k;
      UI.spr(A_LOCK, x + w / 2 - ls / 2, y + ph / 2 - ls * 0.75, ls, ls, UI.C_BRIGHT, a);
      UI.textCS(fmt(STR.S_NEED_STARS, '' + PROFILE.arenaNeed(i)), x + w / 2, y + ph / 2 + ls * 0.4,
                17 * k, UI.C_ACCENT, a);
    }
    if (i === ARENA_INDEX) {
      const tag = T(STR.S_CURRENT);
      const tw = UI.textW(tag, 14 * k);
      UI.nine(A_PANEL, x + w - tw - 34 * k, y + 16 * k, tw + 20 * k, 26 * k, 8 * k, UI.C_ACCENT, a);
      UI.text(tag, x + w - tw - 24 * k, y + 21 * k, 14 * k, UI.C_PANEL, a);
    }
  }
  drawCentredRow(ARENA_COUNT, T(STR.S_BACK), sw, sh);
  const tot = fmt(STR.S_STARS_TOTAL, '' + PROFILE.totalStars());
  UI.textC(tot, sw / 2, sh * 0.07 + 62 * k, 17 * k, UI.C_DIM, 230 * UI.easeOut((S[5] - 0.2) / 0.3));
}

/// Up to three stars in a row from x: filled ones in the accent colour, the rest hollow.
function drawStars(n: number, x: number, y: number, size: number, a: number): void {
  for (let i = 0; i < 3; i++) {
    UI.spr(A_STAR, x + i * (size + 4), y, size, size, i < n ? UI.C_ACCENT : UI.C_LINE, i < n ? a : a * 0.5);
  }
}

/// The credit balance, right-aligned to rx when `right`, else from x.
function drawWallet(x: number, y: number, k: number, a: number, right: boolean): void {
  const txt = T(STR.S_CREDITS_BAL) + '  ' + PROFILE.credits();
  const fs = 19 * k;
  const w = UI.textW(txt, fs);
  const x0 = right ? x - w - 28 * k : x - w;
  UI.spr(A_DISC, x0 - 22 * k, y + 3 * k, 15 * k, 15 * k, UI.C_ACCENT, a);
  UI.text(txt, x0, y, fs, UI.C_ACCENT, a);
}

function perkName(w: number): string { return T(STR.S_PERK_0 + w); }

function drawArmory(sw: number, sh: number): void {
  const k = L[0];
  drawRect(0, 0, sw, sh, UI.col(UI.C_BLACK, UI.panelA(205)));
  drawTitle(T(STR.S_ARMORY), sw, sh, sh * 0.06, 44 * k);
  const ta = UI.easeOut((S[5] - 0.05) / 0.3);
  drawWallet(L[1] + L[3], sh * 0.06 + 14 * k, k, 255 * ta, false);
  const wsel = S[17];
  const open = weaponOpen(wsel);
  // the weapon strip
  for (let w = 0; w < PROFILE.WEAPONS; w++) {
    armCard(w, sw, sh);
    const sel = w === wsel;
    const wo = weaponOpen(w);
    const t = UI.easeOut((S[5] - 0.05 - w * 0.05) / 0.3);
    const a = 255 * t;
    UI.nine(A_PANEL, G[0], G[1], G[2], G[3], 12 * k, UI.C_PANEL, UI.panelA(sel ? 240 : 195) * t);
    UI.nine(A_PANEL_LINE, G[0], G[1], G[2], G[3], 12 * k, sel ? UI.C_ACCENT : UI.C_LINE, sel ? a : a * 0.6);
    let iw = G[2] - 28 * k;
    let ih = iw * 112 / 300;
    if (ih > G[3] - 50 * k) { ih = G[3] - 50 * k; iw = ih * 300 / 112; }
    UI.spr(A_WPN_RIFLE + w, G[0] + (G[2] - iw) / 2, G[1] + 10 * k, iw, ih,
           wo ? (sel ? UI.C_BRIGHT : UI.C_TEXT) : UI.C_LINE, wo ? a : a * 0.7);
    if (!wo) UI.spr(A_LOCK, G[0] + G[2] / 2 - 15 * k, G[1] + 10 * k + ih / 2 - 15 * k, 30 * k, 30 * k, UI.C_BRIGHT, a);
    // The name is shrunk to its card (SCATTERGUN is the long one; six cards are narrow).
    const wn = T(STR.S_WPN_0 + w);
    let wfs = 20 * k;
    const wnw = UI.textW(wn, wfs);
    if (wnw > G[2] - 14 * k) wfs = wfs * (G[2] - 14 * k) / wnw;
    UI.textC(wn, G[0] + G[2] / 2, G[1] + G[3] - 34 * k + (20 * k - wfs) / 2, wfs,
             sel ? UI.C_BRIGHT : UI.C_TEXT, wo ? a : a * 0.6);
  }
  // what the weapon does now, with everything bought so far
  const sy = sh * 0.20 + 146 * k;
  const line = open
    ? T(STR.S_UPG_0) + ' ' + WPN.damageOf(wsel).toFixed(1) + '      '
      + T(STR.S_UPG_1) + ' ' + WPN.magSize(wsel) + '      '
      + T(STR.S_UPG_2) + ' ' + (WPN.W_RELOAD[wsel] * PROFILE.reloadMul(wsel)).toFixed(2) + ' S'
    : T(STR.S_ARM_LOCKED);
  UI.textC(line, sw / 2, sy, 17 * k, open ? UI.C_DIM : UI.C_ACCENT, 240 * ta);

  for (let i = 0; i < PROFILE.TRACKS; i++) {
    if (!rowRect(i, sw, sh)) continue;
    const t = rowIn(i);
    const a = 255 * t * (open ? 1 : 0.45);
    const sel = i === S[1];
    const x = G[0], y = G[1], w = G[2], h = G[3];
    const lvl = PROFILE.upgLevel(wsel, i);
    const max = PROFILE.upgMax(i);
    const cost = PROFILE.upgCost(wsel, i);
    const flash = sel && S[18] > 0 ? S[18] / 0.6 : 0;
    UI.nine(A_PANEL, x, y, w, h, 10 * k, UI.C_PANEL, UI.panelA(sel ? 235 : 180) * t);
    if (sel) UI.nine(A_PANEL_LINE, x, y, w, h, 10 * k, UI.C_ACCENT, 255 * t);
    if (flash > 0) UI.nine(A_PANEL, x, y, w, h, 10 * k, UI.C_GOOD, 110 * flash);
    const name = i === PROFILE.T_PERK ? perkName(wsel) : T(STR.S_UPG_0 + i);
    const desc = i === PROFILE.T_PERK ? T(STR.S_PERK_D0 + wsel) : T(STR.S_UPG_D0 + i);
    UI.text(name, x + 20 * k, y + 8 * k, 23 * k, sel ? UI.C_BRIGHT : UI.C_TEXT, a);
    let ds = 14 * k;
    const dw = UI.textW(desc, ds);
    if (dw > w * 0.60) ds = ds * w * 0.60 / dw;
    UI.text(desc, x + 20 * k, y + 35 * k, ds, UI.C_DIM, a);
    // level pips
    const pw = 22 * k, pg = 6 * k;
    const px0 = x + w * 0.66;
    for (let q = 0; q < max; q++) {
      drawRect(px0 + q * (pw + pg), y + h / 2 - 4 * k, pw, 8 * k,
               UI.col(q < lvl ? UI.C_GOOD : UI.C_LINE, q < lvl ? a : a * 0.6));
    }
    // price, or that there is nothing left to buy
    if (cost <= 0) {
      UI.textR(T(STR.S_MAXED), x + w - 20 * k, y + (h - 20 * k) / 2, 20 * k, UI.C_GOOD, a);
    } else {
      const can = open && PROFILE.credits() >= cost;
      UI.textR('' + cost, x + w - 20 * k, y + (h - 22 * k) / 2, 22 * k, can ? UI.C_ACCENT : UI.C_DANGER, a);
    }
  }
  drawCentredRow(PROFILE.TRACKS, T(STR.S_BACK), sw, sh);
}

function drawRecord(sw: number, sh: number): void {
  const k = L[0];
  drawRect(0, 0, sw, sh, UI.col(UI.C_BLACK, UI.panelA(205)));
  drawTitle(T(STR.S_RECORD), sw, sh, sh * 0.06, 44 * k);
  const pw = 900 * k < sw * 0.92 ? 900 * k : sw * 0.92;
  const px = (sw - pw) / 2;
  let cy = sh * 0.19;
  const ta = UI.easeOut((S[5] - 0.1) / 0.35);
  const a = 255 * ta;
  const step = 40 * k;
  UI.panel(px, cy, pw, step * 6 + 34 * k, 215 * ta);
  const colW = pw / 2 - 52 * k;
  const lx = px + 30 * k, rx = px + pw / 2 + 22 * k;
  let ry = cy + 16 * k;
  statRow(T(STR.S_ST_RUNS), '' + PROFILE.statRuns(), lx, ry, colW, k, a, false);
  statRow(T(STR.S_ST_WINS), '' + PROFILE.statWins(), rx, ry, colW, k, a, false);
  ry = ry + step;
  statRow(T(STR.S_KILLS), '' + PROFILE.statKills(), lx, ry, colW, k, a, false);
  statRow(T(STR.S_ST_ELITES), '' + PROFILE.statElites(), rx, ry, colW, k, a, false);
  ry = ry + step;
  statRow(T(STR.S_ACCURACY), '' + Math.round(PROFILE.statAccuracy() * 100) + '%', lx, ry, colW, k, a, false);
  statRow(T(STR.S_HEADSHOTS), '' + PROFILE.statCrits(), rx, ry, colW, k, a, false);
  ry = ry + step;
  statRow(T(STR.S_BEST_COMBO), 'x' + PROFILE.statBestCombo().toFixed(2), lx, ry, colW, k, a, false);
  statRow(T(STR.S_ST_OBJECTIVES), '' + PROFILE.statObjectives(), rx, ry, colW, k, a, false);
  ry = ry + step;
  statRow(T(STR.S_ST_TIME), timeText(PROFILE.statSeconds()), lx, ry, colW, k, a, false);
  statRow(T(STR.S_ST_DEATHS), '' + PROFILE.statDeaths(), rx, ry, colW, k, a, false);
  ry = ry + step;
  statRow(T(STR.S_CREDITS_BAL), '' + PROFILE.credits(), lx, ry, colW, k, a, true);
  statRow(T(STR.S_ST_EARNED), '' + PROFILE.statEarned(), rx, ry, colW, k, a, false);
  cy = cy + step * 6 + 34 * k + 14 * k;
  // kills by kind, one line
  let line = '';
  for (let kd = 0; kd < 8; kd++) {
    const c = PROFILE.statKind(kd);
    if (c <= 0) continue;
    if (line.length > 0) line = line + '    ';
    line = line + KIND_NAME[kd] + ' ' + c;
  }
  if (line.length > 0) {
    let fs = 15 * k;
    const lw = UI.textW(line, fs);
    if (lw > pw - 20 * k) fs = fs * (pw - 20 * k) / lw;
    UI.textC(line, sw / 2, cy, fs, UI.C_DIM, a);
  }
  cy = cy + 30 * k;
  // each arena: its stars and best score
  for (let i = 0; i < ARENA_COUNT; i++) {
    const y = cy + i * 34 * k;
    UI.text(ARENAS[i].name, px + 30 * k, y, 19 * k, UI.C_TEXT, a);
    drawStars(PROFILE.arenaStars(i), sw / 2 - 40 * k, y - 1 * k, 21 * k, a);
    const b = SET.bestScore(i);
    UI.textR(b > 0 ? '' + b : '-', px + pw - 30 * k, y, 19 * k, b > 0 ? UI.C_ACCENT : UI.C_DIM, a);
  }
  drawCentredRow(0, T(STR.S_BACK), sw, sh);
  drawCentredRow(1, T(S[19] === 1 ? STR.S_RESET_SURE : STR.S_RESET_PROGRESS), sw, sh);
}

/// A centred button row (BACK under the cards and the credits, the results rows).
function drawCentredRow(i: number, label: string, sw: number, sh: number): void {
  if (!rowRect(i, sw, sh)) return;
  const k = L[0];
  const sel = i === S[1];
  const t = UI.easeOut((S[5] - 0.2) / 0.3);
  if (sel) UI.nine(A_PANEL, G[0], G[1], G[2], G[3], 12 * k, UI.C_ACCENT, 235 * t);
  else UI.nine(A_PANEL_LINE, G[0], G[1], G[2], G[3], 12 * k, UI.C_LINE, 190 * t);
  const fs = 24 * k;
  UI.textC(label, G[0] + G[2] / 2, G[1] + (G[3] - fs) / 2, fs, sel ? UI.C_PANEL : UI.C_TEXT, 255 * t);
}

function drawCredits(sw: number, sh: number): void {
  const k = L[0];
  drawRect(0, 0, sw, sh, UI.col(UI.C_BLACK, UI.panelA(205)));
  drawTitle(T(STR.S_CREDITS), sw, sh, sh * 0.07, 44 * k);
  const heads = [STR.S_CR_ENGINE, STR.S_CR_MODELS, STR.S_CR_SURFACES, STR.S_CR_SOUND, STR.S_CR_MUSIC, STR.S_CR_FONT];
  const vals = [STR.S_CR_ENGINE_V, STR.S_CR_MODELS_V, STR.S_CR_SURFACES_V, STR.S_CR_SOUND_V, STR.S_CR_MUSIC_V, STR.S_CR_FONT_V];
  let y = sh * 0.22;
  const t0 = UI.easeOut((S[5] - 0.05) / 0.3);
  UI.textC(T(STR.S_CR_GAME), sw / 2, y, 26 * k, UI.C_ACCENT, 255 * t0);
  y = y + 58 * k;
  for (let i = 0; i < 6; i++) {
    const t = UI.easeOut((S[5] - 0.1 - i * 0.06) / 0.3);
    UI.textC(T(heads[i]), sw / 2, y + (1 - t) * 12, 15 * k, UI.C_DIM, 235 * t);
    let fs = 21 * k;
    const txt = T(vals[i]);
    const tw = UI.textW(txt, fs);
    if (tw > sw * 0.9) fs = fs * sw * 0.9 / tw;
    UI.textC(txt, sw / 2, y + 22 * k + (1 - t) * 12, fs, UI.C_BRIGHT, 255 * t);
    y = y + 68 * k;
  }
  UI.textC(T(STR.S_CR_LICENSE), sw / 2, y + 6 * k, 15 * k, UI.C_DIM, 220 * UI.easeOut((S[5] - 0.5) / 0.3));
  drawCentredRow(0, T(STR.S_BACK), sw, sh);
}

function statRow(label: string, value: string, x: number, y: number, w: number, k: number,
                 a: number, hot: boolean): void {
  UI.text(label, x, y + 5 * k, 17 * k, UI.C_DIM, a);
  UI.textR(value, x + w, y, 25 * k, hot ? UI.C_ACCENT : UI.C_BRIGHT, a);
  drawRect(x, y + 34 * k, w, 1, UI.col(UI.C_LINE, a * 0.45));
}

function drawResults(sw: number, sh: number): void {
  const k = L[0];
  const won = S[7] === 1;
  drawRect(0, 0, sw, sh, UI.col(UI.C_BLACK, UI.panelA(won ? 150 : 185)));
  if (!won) UI.spr(A_SOFT, -sw * 0.2, -sh * 0.3, sw * 1.4, sh * 1.1, UI.C_DANGER, 26);

  const t0 = UI.easeBack(S[5] / 0.45);
  const head = T(won ? STR.S_ARENA_CLEARED : STR.S_YOU_DIED);
  const hs = 70 * k * (0.7 + 0.3 * t0);
  UI.textCS(head, sw / 2, sh * 0.075, hs, won ? UI.C_GOOD : UI.C_DANGER, 255 * UI.clamp01(S[5] / 0.2));
  const sub = ARENAS[ARENA_INDEX].name + '   ·   '
    + (won ? T(STR.S_DIFF_0 + SET.get(SET.SET_DIFFICULTY))
           : fmt(STR.S_REACHED_WAVE, '' + S[9]) + '   ·   ' + T(STR.S_DIFF_0 + SET.get(SET.SET_DIFFICULTY)));
  UI.textCS(sub, sw / 2, sh * 0.075 + 86 * k, 20 * k, UI.C_TEXT, 230 * UI.easeOut((S[5] - 0.15) / 0.3));

  // Stars (a win only): cleared, accuracy of half or better, under 100 damage taken. Three
  // things a player can aim for on the next run, shown as shapes, filled or hollow.
  let cy = sh * 0.075 + 124 * k;
  if (won) {
    const stars = PROFILE.starsFor(true, SCORE.accuracy(), SCORE.damageTaken());
    const ss = 46 * k;
    for (let i = 0; i < 3; i++) {
      const ts = UI.easeBack((S[5] - 0.45 - i * 0.16) / 0.3);
      const have = i < stars;
      const sz = ss * (have ? ts : 1);
      const sx = sw / 2 + (i - 1) * (ss + 14 * k);
      if (have) UI.spr(A_STAR, sx - sz / 2, cy + ss / 2 - sz / 2, sz, sz, UI.C_ACCENT, 255 * UI.clamp01(ts));
      else UI.spr(A_STAR, sx - ss / 2, cy, ss, ss, UI.C_LINE, 120);
    }
    cy = cy + ss + 16 * k;
  } else {
    cy = cy + 10 * k;
  }

  // the numbers: two columns
  const pw = 860 * k < sw * 0.92 ? 860 * k : sw * 0.92;
  const px = (sw - pw) / 2;
  const ph = 256 * k;
  const ta = UI.easeOut((S[5] - 0.25) / 0.35);
  const a = 255 * ta;
  UI.panel(px, cy, pw, ph, 215 * ta);
  const colW = pw / 2 - 52 * k;
  const lx = px + 30 * k, rx = px + pw / 2 + 22 * k;
  let ry = cy + 20 * k;
  const step = 40 * k;
  const best = SET.bestScore(ARENA_INDEX);
  // The score counts up: the eye follows a number that moves.
  const shown = Math.floor(SCORE.score() * UI.easeOut((S[5] - 0.3) / 0.9));
  statRow(T(STR.S_SCORE), '' + shown, lx, ry, colW, k, a, true);
  statRow(T(STR.S_TIME), timeText(S_TIME[0]), rx, ry, colW, k, a, false);
  ry = ry + step;
  statRow(T(STR.S_BEST), '' + best, lx, ry, colW, k, a, false);
  statRow(T(STR.S_ACCURACY), '' + Math.round(SCORE.accuracy() * 100) + '%', rx, ry, colW, k, a, false);
  ry = ry + step;
  statRow(T(STR.S_KILLS), '' + SCORE.kills(), lx, ry, colW, k, a, false);
  statRow(T(STR.S_HEADSHOTS), '' + SCORE.crits(), rx, ry, colW, k, a, false);
  ry = ry + step;
  statRow(T(STR.S_BEST_COMBO), 'x' + SCORE.comboPeak().toFixed(2), lx, ry, colW, k, a, false);
  statRow(T(STR.S_DAMAGE_TAKEN), '' + SCORE.damageTaken(), rx, ry, colW, k, a, false);
  ry = ry + step;
  // what the run paid, and what is in the bank to spend in the armoury
  statRow(T(STR.S_CREDITS_EARNED), '+' + PROFILE.lastCredits(), lx, ry, colW, k, a, true);
  statRow(T(STR.S_CREDITS_BAL), '' + PROFILE.credits(), rx, ry, colW, k, a, false);
  ry = ry + step + 4 * k;
  // kills by kind, one line
  let line = '';
  for (let kd = 0; kd < 8; kd++) {
    const c = SCORE.killsOfKind(kd);
    if (c <= 0) continue;
    if (line.length > 0) line = line + '    ';
    line = line + KIND_NAME[kd] + ' ' + c;
  }
  if (line.length > 0) {
    let fs = 15 * k;
    const lw = UI.textW(line, fs);
    if (lw > pw - 60 * k) fs = fs * (pw - 60 * k) / lw;
    UI.textC(line, sw / 2, ry, fs, UI.C_DIM, a);
  }
  if (S[15] === 1) {
    const nb = T(STR.S_NEW_BEST);
    const pulse = 0.75 + 0.25 * Math.sin(S[5] * 6);
    const nw = UI.textW(nb, 18 * k);
    UI.nine(A_PANEL, px + pw - nw - 46 * k, cy - 16 * k, nw + 30 * k, 32 * k, 9 * k, UI.C_ACCENT, 255 * ta * pulse);
    UI.text(nb, px + pw - nw - 31 * k, cy - 9 * k, 18 * k, UI.C_PANEL, a);
  }

  for (let i = 0; i < RES_N[0]; i++) {
    const w = RES_ROWS[i];
    let label = T(STR.S_MAIN_MENU);
    if (w === 1) label = T(won ? STR.S_PLAY_AGAIN : STR.S_RETRY);
    else if (w === 2) label = T(STR.S_NEXT_ARENA);
    else if (w === 3) label = T(STR.S_LEVEL_SELECT);
    else if (w === 5) label = T(STR.S_ARMORY);
    drawCentredRow(i, label, sw, sh);
  }
}

export function drawMenu(sw: number, sh: number): void {
  if (S[0] === MENU_NONE) return;
  layout(sw, sh);
  if (S[0] === MENU_MAIN || S[0] === MENU_PAUSE) drawMainOrPause(sw, sh);
  else if (S[0] === MENU_SETTINGS) drawSettings(sw, sh);
  else if (S[0] === MENU_LEVELS) drawLevels(sw, sh);
  else if (S[0] === MENU_CREDITS) drawCredits(sw, sh);
  else if (S[0] === MENU_RESULTS) drawResults(sw, sh);
  else if (S[0] === MENU_ARMORY) drawArmory(sw, sh);
  else if (S[0] === MENU_RECORD) drawRecord(sw, sh);
  drawHints(sw, sh);
}
