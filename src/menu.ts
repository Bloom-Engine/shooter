// SH-038 — front-end: pause, settings, game-over flow.
//
// The game had exactly two states (title, playing) and no way to stop, adjust
// anything, or leave. This is an immediate-mode menu built on the engine's 2D
// draw calls, with ONE focus model shared by mouse, keyboard, gamepad and
// touch — which is the part that actually matters: a settings screen you can't
// reach with a controller is not gamepad support.
//
// (EN-030 proposes a proper retained widget layer in the engine. When it lands
// this file becomes a thin adapter; until then the IM version ships, because a
// pause button is not worth blocking on a UI framework.)

import {
  drawText, drawRect, measureText,
  isKeyPressed, Key,
  isMouseButtonPressed, getMouseX, getMouseY,
  isGamepadAvailable, isGamepadButtonPressed, getGamepadAxis,
} from 'bloom';
import {
  setOutputScale, setRenderScale, setShadowsEnabled,
  setSsaoEnabled, setSsrEnabled, setSsgiEnabled, setBloomEnabled,
  setPathTracing, isPathTracingSupported,
} from 'bloom/core';
import * as SET from './settings';
import * as MIX from './audio-mix';
import * as FEEL from './feel';
import { ARENAS, ARENA_COUNT, ARENA_INDEX, selectArena } from './world-runtime';

export const MENU_NONE     = 0;
export const MENU_PAUSE    = 1;
export const MENU_SETTINGS = 2;
export const MENU_LEVELS   = 3;

// Row kinds.
const ROW_ACTION = 0;
const ROW_SLIDER = 1;
const ROW_TOGGLE = 2;
// Three named states (the path-tracing row: OFF / QUALITY / REALTIME).
const ROW_TRI    = 3;

//   0 current menu   1 selected row   2 stick-repeat cooldown
const S = [MENU_NONE, 0, 0];

// The action a click/confirm produced this frame, read by main.ts.
export const ACT_NONE     = 0;
export const ACT_RESUME   = 1;
export const ACT_RESTART  = 2;
export const ACT_QUIT     = 3;
/// A level was chosen. The choice is already written; the game relaunches into
/// it (the world's colliders/scatters/GI proxies are all built at startup).
export const ACT_LEVEL    = 4;
const A = [ACT_NONE];

// --- row tables --------------------------------------------------------------
// Kept as parallel flat arrays (Perry convention). `settingIdx` is the index
// into settings.ts for slider/toggle rows.
const PAUSE_LABELS = ['RESUME', 'SETTINGS', 'LEVEL SELECT', 'RESTART RUN', 'QUIT'];
const PAUSE_COUNT = 5;

// GRAPHICS rows come first: on a 4K display they are the difference between a
// locked frame rate and a pretty one, and which of those a player wants is not
// something this game gets to decide for them.
//
// DISPLAY RESOLUTION is the swapchain — the one knob that touches the fixed cost
// of the upscale and the final composite. RENDER RESOLUTION is the G-buffer, which
// TSR then reconstructs back up to the display. They cost different things, so
// both are here rather than hidden behind one "quality" number that lies.
const SET_LABELS: string[] = [
  'DISPLAY RESOLUTION', 'RENDER RESOLUTION',
  'SHADOWS', 'AMBIENT OCCLUSION', 'REFLECTIONS', 'GLOBAL ILLUMINATION', 'BLOOM',
  'PATH TRACING',
  'MASTER VOLUME', 'MUSIC VOLUME', 'SFX VOLUME',
  'LOOK SENSITIVITY', 'PAD SENSITIVITY', 'INVERT Y',
  'FIELD OF VIEW', 'CAMERA SHAKE',
  'AIM: HOLD/TOGGLE', 'SPRINT: HOLD/TOGGLE',
  'COLORBLIND CUES', 'TELEGRAPH CAPTIONS',
  'BACK',
];
const SET_KINDS: number[] = [
  ROW_SLIDER, ROW_SLIDER,
  ROW_TOGGLE, ROW_TOGGLE, ROW_TOGGLE, ROW_TOGGLE, ROW_TOGGLE,
  ROW_TRI,
  ROW_SLIDER, ROW_SLIDER, ROW_SLIDER,
  ROW_SLIDER, ROW_SLIDER, ROW_TOGGLE,
  ROW_SLIDER, ROW_SLIDER,
  ROW_TOGGLE, ROW_TOGGLE,
  ROW_TOGGLE, ROW_TOGGLE,
  ROW_ACTION,
];
const SET_IDX: number[] = [
  SET.SET_OUTPUT_SCALE, SET.SET_RENDER_SCALE,
  SET.SET_SHADOWS, SET.SET_SSAO, SET.SET_SSR, SET.SET_SSGI, SET.SET_BLOOM,
  SET.SET_PT,
  SET.SET_MASTER_VOL, SET.SET_MUSIC_VOL, SET.SET_SFX_VOL,
  SET.SET_SENS, SET.SET_PAD_SENS, SET.SET_INVERT_Y,
  SET.SET_FOV, SET.SET_SHAKE,
  SET.SET_AIM_TOGGLE, SET.SET_SPRINT_TOGGLE,
  SET.SET_COLORBLIND, SET.SET_CAPTIONS,
  -1,
];
// min / max / step per row (ignored for toggles and actions).
// The two resolution sliders bottom out at 0.5: below that TSR has too little to
// reconstruct from and the image stops being worth the frames.
const SET_MIN:  number[] = [
  0.5, 0.5,
  0, 0, 0, 0, 0,
  0,
  0, 0, 0,
  0.2, 0.2, 0,
  60, 0,
  0, 0,
  0, 0, 0];
const SET_MAX:  number[] = [
  1.0, 1.0,
  1, 1, 1, 1, 1,
  2,
  1, 1, 1,
  3.0, 3.0, 1,
  100, 1,
  1, 1,
  1, 1, 0];
const SET_STEP: number[] = [
  0.05, 0.05,
  1, 1, 1, 1, 1,
  1,
  0.05, 0.05, 0.05,
  0.1, 0.1, 1,
  5, 0.1,
  1, 1,
  1, 1, 0];
const SET_COUNT_ROWS = 21;

export function initMenus(): void {
  S[0] = MENU_NONE; S[1] = 0; S[2] = 0;
  A[0] = ACT_NONE;
}

export function menuOpen(): boolean { return S[0] !== MENU_NONE; }
export function currentMenu(): number { return S[0]; }
export function openPause(): void { S[0] = MENU_PAUSE; S[1] = 0; }
export function closeMenu(): void {
  if (S[0] === MENU_SETTINGS) SET.saveSettings();
  S[0] = MENU_NONE;
}

function rowCount(): number {
  if (S[0] === MENU_PAUSE) return PAUSE_COUNT;
  if (S[0] === MENU_LEVELS) return ARENA_COUNT + 1;   // + BACK
  return SET_COUNT_ROWS;
}

/// Adjust the selected row. `dir` is -1 / +1 (left/right or a click on the bar).
function adjust(dir: number): void {
  if (S[0] !== MENU_SETTINGS) return;
  const r = S[1];
  const kind = SET_KINDS[r];
  if (kind === ROW_ACTION) return;
  const idx = SET_IDX[r];
  let v = SET.get(idx);
  if (kind === ROW_TOGGLE) {
    v = v !== 0 ? 0 : 1;
  } else if (kind === ROW_TRI) {
    v = v + dir;
    if (v < SET_MIN[r]) v = SET_MIN[r];
    if (v > SET_MAX[r]) v = SET_MAX[r];
  } else {
    v = v + dir * SET_STEP[r];
    if (v < SET_MIN[r]) v = SET_MIN[r];
    if (v > SET_MAX[r]) v = SET_MAX[r];
    // Kill float dust so the display doesn't read 0.7000000000000001.
    v = Math.round(v * 1000) / 1000;
  }
  SET.set(idx, v);
  applyLive(idx);
  MIX.uiMove();
}

/// Some settings must take effect the instant they move, or the slider is a
/// guess: you cannot tune volume or shake by reading a number.
function applyLive(idx: number): void {
  if (idx === SET.SET_MASTER_VOL || idx === SET.SET_MUSIC_VOL || idx === SET.SET_SFX_VOL) {
    MIX.applyVolumes();
  } else if (idx === SET.SET_SHAKE) {
    FEEL.setShakeScale(SET.get(SET.SET_SHAKE));
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
  } else if (idx === SET.SET_PT) {
    // No-op on devices without hardware ray query — the row reads N/A
    // there and the value is inert (fallback matrix, PT-5).
    if (isPathTracingSupported()) setPathTracing(SET.get(SET.SET_PT));
  }
}

/// Push every graphics setting into the engine. Called at boot, after settings
/// load, so what the player chose last time is what they get this time — a
/// settings screen that does not survive a restart is a lie.
export function applyGraphicsSettings(): void {
  setOutputScale(SET.get(SET.SET_OUTPUT_SCALE));
  setRenderScale(SET.get(SET.SET_RENDER_SCALE));
  setShadowsEnabled(SET.get(SET.SET_SHADOWS) !== 0);
  setSsaoEnabled(SET.get(SET.SET_SSAO) !== 0);
  setSsrEnabled(SET.get(SET.SET_SSR) !== 0);
  setSsgiEnabled(SET.get(SET.SET_SSGI) !== 0);
  setBloomEnabled(SET.get(SET.SET_BLOOM) !== 0);
  if (isPathTracingSupported()) setPathTracing(SET.get(SET.SET_PT));
}

function confirm(): void {
  if (S[0] === MENU_PAUSE) {
    MIX.uiSelect();
    if (S[1] === 0) { A[0] = ACT_RESUME; closeMenu(); }
    else if (S[1] === 1) { S[0] = MENU_SETTINGS; S[1] = 0; }
    else if (S[1] === 2) { S[0] = MENU_LEVELS; S[1] = 0; }
    else if (S[1] === 3) { A[0] = ACT_RESTART; closeMenu(); }
    else if (S[1] === 4) { A[0] = ACT_QUIT; }
    return;
  }
  if (S[0] === MENU_LEVELS) {
    MIX.uiSelect();
    if (S[1] >= ARENA_COUNT) { S[0] = MENU_PAUSE; S[1] = 0; return; }
    // Picking a level writes the choice and asks the game to restart into it.
    // A mid-run swap would mean tearing down every collider, scatter and GI
    // proxy the world built at startup — see selectArena().
    selectArena(ARENAS[S[1]].id);
    A[0] = ACT_LEVEL;
    return;
  }
  if (S[0] === MENU_SETTINGS) {
    if (SET_KINDS[S[1]] === ROW_ACTION) {
      MIX.uiSelect();
      SET.saveSettings();
      S[0] = MENU_PAUSE;
      S[1] = 0;
    } else if (SET_KINDS[S[1]] === ROW_TOGGLE) {
      adjust(1);
    } else if (SET_KINDS[S[1]] === ROW_TRI) {
      // Confirm/click cycles through the three states (wrapping);
      // left/right arrows still step and clamp like a slider.
      const idx = SET_IDX[S[1]];
      SET.set(idx, (SET.get(idx) + 1) % 3);
      applyLive(idx);
      MIX.uiMove();
    }
  }
}

function move(dir: number): void {
  const n = rowCount();
  S[1] = (S[1] + dir + n) % n;
  MIX.uiMove();
}

/// Drive the menu. Returns the action produced this frame (ACT_*).
/// `uiScale`, `sw`, `sh` are the HUD's logical space, so the mouse hit-test
/// matches what is drawn.
export function updateMenu(dt: number, sw: number, sh: number, uiScale: number): number {
  A[0] = ACT_NONE;
  if (S[0] === MENU_NONE) return ACT_NONE;

  // --- keyboard
  if (isKeyPressed(Key.UP) || isKeyPressed(Key.W)) move(-1);
  if (isKeyPressed(Key.DOWN) || isKeyPressed(Key.S)) move(1);
  if (isKeyPressed(Key.LEFT) || isKeyPressed(Key.A)) adjust(-1);
  if (isKeyPressed(Key.RIGHT) || isKeyPressed(Key.D)) adjust(1);
  if (isKeyPressed(Key.ENTER) || isKeyPressed(Key.SPACE)) confirm();
  if (isKeyPressed(Key.ESCAPE)) {
    if (S[0] === MENU_SETTINGS) { SET.saveSettings(); S[0] = MENU_PAUSE; S[1] = 0; }
    else if (S[0] === MENU_LEVELS) { S[0] = MENU_PAUSE; S[1] = 0; }
    else { A[0] = ACT_RESUME; closeMenu(); }
  }

  // --- gamepad. D-pad is discrete; the stick needs a repeat timer or one flick
  // scrolls the whole list.
  if (isGamepadAvailable()) {
    if (isGamepadButtonPressed(10)) move(-1);   // dpad up
    if (isGamepadButtonPressed(11)) move(1);    // dpad down
    if (isGamepadButtonPressed(12)) adjust(-1); // dpad left
    if (isGamepadButtonPressed(13)) adjust(1);  // dpad right
    if (isGamepadButtonPressed(0)) confirm();   // A
    if (isGamepadButtonPressed(1)) {            // B = back
      if (S[0] === MENU_SETTINGS) { SET.saveSettings(); S[0] = MENU_PAUSE; S[1] = 0; }
      else { A[0] = ACT_RESUME; closeMenu(); }
    }
    if (isGamepadButtonPressed(7)) { A[0] = ACT_RESUME; closeMenu(); }  // Start

    if (S[2] > 0) S[2] = S[2] - dt;
    const ly = getGamepadAxis(1);
    const lx = getGamepadAxis(0);
    if (S[2] <= 0) {
      if (ly < -0.6) { move(-1); S[2] = 0.18; }
      else if (ly > 0.6) { move(1); S[2] = 0.18; }
      else if (lx < -0.6) { adjust(-1); S[2] = 0.12; }
      else if (lx > 0.6) { adjust(1); S[2] = 0.12; }
    }
  }

  // --- mouse / touch: hit-test the same rows we draw.
  const mx = getMouseX() / uiScale;
  const my = getMouseY() / uiScale;
  const geo = layout(sw, sh);
  const x0 = geo[0], y0 = geo[1], rowW = geo[2], rowH = geo[3];
  const n = rowCount();
  for (let i = 0; i < n; i++) {
    const ry = y0 + i * rowH;
    if (mx >= x0 && mx <= x0 + rowW && my >= ry && my <= ry + rowH - 4) {
      if (S[1] !== i) { S[1] = i; }
      if (isMouseButtonPressed(0)) {
        if (S[0] === MENU_SETTINGS && SET_KINDS[i] === ROW_SLIDER) {
          // Click ON the bar = set the value at that position. Far better than
          // making the player click a tiny arrow twenty times.
          const barX = x0 + rowW * 0.55;
          const barW = rowW * 0.40;
          let t = (mx - barX) / barW;
          if (t < 0) t = 0;
          if (t > 1) t = 1;
          let v = SET_MIN[i] + t * (SET_MAX[i] - SET_MIN[i]);
          v = Math.round(v / SET_STEP[i]) * SET_STEP[i];
          v = Math.round(v * 1000) / 1000;
          SET.set(SET_IDX[i], v);
          applyLive(SET_IDX[i]);
          MIX.uiMove();
        } else {
          confirm();
        }
      }
    }
  }

  return A[0];
}

/// x, y, rowWidth, rowHeight of the row list.
function layout(sw: number, sh: number): number[] {
  const rowW = sw * 0.5;
  const rowH = 46;
  const n = rowCount();
  const x0 = (sw - rowW) / 2;
  const y0 = sh * 0.5 - (n * rowH) / 2 + 20;
  return [x0, y0, rowW, rowH];
}

export function drawMenu(sw: number, sh: number): void {
  if (S[0] === MENU_NONE) return;

  // Dim the world behind. This is the whole reason the sim is frozen and not
  // merely hidden — the player should still see the fight they paused.
  drawRect(0, 0, sw, sh, { r: 0, g: 0, b: 0, a: 170 });

  const geo = layout(sw, sh);
  const x0 = geo[0], y0 = geo[1], rowW = geo[2], rowH = geo[3];
  const n = rowCount();

  let title = 'PAUSED';
  if (S[0] === MENU_SETTINGS) title = 'SETTINGS';
  if (S[0] === MENU_LEVELS)   title = 'SELECT ARENA';
  const ts = 44;
  const tw = measureText(title, ts);
  // Anchored to the TOP OF THE LIST, not to a fixed offset from screen centre. The
  // list is centred, so it grows upward as rows are added — and the graphics rows
  // pushed it straight through a title that was nailed to `sh * 0.5 - 200`.
  drawText(title, (sw - tw) / 2, y0 - 70, ts, { r: 255, g: 240, b: 210, a: 255 });

  for (let i = 0; i < n; i++) {
    const ry = y0 + i * rowH;
    const sel = i === S[1];
    if (sel) {
      drawRect(x0 - 10, ry - 2, rowW + 20, rowH - 4, { r: 255, g: 210, b: 120, a: 40 });
    }
    const col = sel
      ? { r: 255, g: 225, b: 150, a: 255 }
      : { r: 200, g: 200, b: 205, a: 220 };

    let label = '';
    if (S[0] === MENU_PAUSE) {
      label = PAUSE_LABELS[i];
    } else if (S[0] === MENU_LEVELS) {
      label = i < ARENA_COUNT ? ARENAS[i].name : 'BACK';
    } else {
      label = SET_LABELS[i];
    }
    drawText(label, x0, ry + 8, 24, col);

    if (S[0] === MENU_LEVELS && i < ARENA_COUNT) {
      // Mark the arena you are actually in, and show its best score — the two
      // things you want to know before picking.
      const isCur = i === ARENA_INDEX;
      const best = SET.bestScore(i);
      const info = (isCur ? 'CURRENT   ' : '') + (best > 0 ? 'BEST ' + best : '');
      if (info.length > 0) {
        const iw = measureText(info, 16);
        drawText(info, x0 + rowW - iw, ry + 12, 16,
          { r: 180, g: 175, b: 160, a: 200 });
      }
      continue;
    }

    if (S[0] !== MENU_SETTINGS) continue;
    const kind = SET_KINDS[i];
    if (kind === ROW_ACTION) continue;

    const v = SET.get(SET_IDX[i]);
    const barX = x0 + rowW * 0.55;
    const barW = rowW * 0.40;

    if (kind === ROW_TOGGLE) {
      const on = v !== 0;
      drawText(on ? 'ON' : 'OFF', barX, ry + 8, 24,
        on ? { r: 150, g: 235, b: 150, a: 255 } : { r: 150, g: 150, b: 155, a: 200 });
    } else if (kind === ROW_TRI) {
      // Path tracing. QUALITY = progressive (converges standing still,
      // for screenshots); REALTIME = denoised gameplay mode. On a GPU
      // without ray query the row is inert and says why.
      if (!isPathTracingSupported()) {
        drawText('N/A (NO RAY TRACING)', barX, ry + 8, 20,
          { r: 140, g: 140, b: 145, a: 180 });
      } else if (v === 0) {
        drawText('OFF', barX, ry + 8, 24, { r: 150, g: 150, b: 155, a: 200 });
      } else if (v === 1) {
        drawText('QUALITY (STILLS)', barX, ry + 8, 24, { r: 235, g: 210, b: 140, a: 255 });
      } else {
        drawText('REALTIME', barX, ry + 8, 24, { r: 150, g: 235, b: 150, a: 255 });
      }
    } else {
      const t = (v - SET_MIN[i]) / (SET_MAX[i] - SET_MIN[i]);
      drawRect(barX, ry + 16, barW, 8, { r: 70, g: 70, b: 76, a: 220 });
      drawRect(barX, ry + 16, barW * t, 8, { r: 255, g: 200, b: 110, a: 255 });
      // The number matters: "sensitivity 1.4" is something a player can carry
      // between sessions and between games.
      const txt = SET_MAX[i] > 5 ? '' + Math.round(v) : v.toFixed(2);
      drawText(txt, barX + barW + 12, ry + 8, 20, { r: 190, g: 190, b: 195, a: 220 });
    }
  }

  const hint = 'ARROWS / STICK  •  ENTER or A: SELECT  •  ESC or B: BACK';
  const hs = 16;
  const hw = measureText(hint, hs);
  drawText(hint, (sw - hw) / 2, y0 + n * rowH + 26, hs,
    { r: 160, g: 160, b: 165, a: 180 });
}
