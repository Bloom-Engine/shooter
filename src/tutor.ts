// Plan Phase 6 (SH-060) - onboarding: a tutorial beat and contextual hints.
//
// THE TUTORIAL is five prompts before the first wave of the first arena, the first time a
// profile plays: move, fire, reload, dodge, grenade or strike. Each one is answered by DOING
// it, and the wave countdown waits. Nobody is held: a step that is not answered moves on by
// itself after a while, and one key skips the lot. It runs once per profile.
//
// HINTS are single lines shown the first time something happens that the game has not
// explained: health is low, an elite arrives, a hold or a nest wave starts, a new weapon is
// in the bag, the reserve runs dry. Each is shown once per profile (a bit in profile.json).
//
// Both are switched by one setting (GAME > HINTS). Every key shown is drawn from binds.ts.
//
// Perry rules: top-level functions, state in a const array.

import { isKeyPressed, Key, isGamepadAvailable, isGamepadButtonPressed, drawRect } from 'bloom';
import { GS } from './gamestate';
import { playerPosition, isDodging } from './player';
import { MOBILE } from './input';
import * as WPN from './weapons';
import * as SCORE from './score';
import * as SET from './settings';
import * as PROFILE from './profile';
import * as UI from './ui';
import * as B from './binds';
import * as STR from './strings';
import { T } from './strings';
import * as MIX from './audio-mix';
import { ARENA_INDEX } from './world-runtime';
import { A_CHECK, A_PANEL, A_PANEL_LINE, A_FADE_R } from './ui-atlas';

export const HINT_HEAL = 0;
export const HINT_ELITE = 1;
export const HINT_HOLD = 2;
export const HINT_NESTS = 3;
export const HINT_SWAP = 4;
export const HINT_CRATE = 5;
export const HINT_COUNT = 6;

const STEPS = 5;
const STEP_TIMEOUT = 14.0;
const HINT_TIME = 6.5;

//  0 tutorial step (-1 = not running)   1 seconds in this step   2 metres moved this step
//  3 last player x   4 last player z   5 shots fired when the step began
//  6 1 = allowed this run (main clears it under a test harness)   7 hint shown (-1 none)
//  8 hint seconds left   9 seconds since the step was answered (-1 = not yet)
//  10 "training complete" seconds left   11 1 = completing it is written to the profile
//  (not under a test harness)
const U = [-1, 0, 0, 0, 0, 0, 1, -1, 0, -1, 0, 1];

export function setTutorEnabled(on: boolean): void { U[6] = on ? 1 : 0; U[11] = on ? 1 : 0; }
export function tutorialActive(): boolean { return U[0] >= 0; }
export function tutorialStep(): number { return U[0]; }
export function tutorialAnswered(): boolean { return U[0] >= 0 && U[9] >= 0; }

function hintsOn(): boolean { return SET.get(SET.SET_HINTS) !== 0 && U[6] === 1; }

function beginStep(n: number): void {
  const pp = playerPosition();
  U[0] = n; U[1] = 0; U[2] = 0; U[3] = pp.x; U[4] = pp.z; U[5] = SCORE.shotsFired(); U[9] = -1;
}

/// A run begins: decide whether the tutorial plays.
export function resetTutor(): void {
  U[0] = -1; U[7] = -1; U[8] = 0; U[10] = 0;
  if (hintsOn() && ARENA_INDEX === 0 && !PROFILE.tutorialDone()) beginStep(0);
}

function finish(): void {
  U[0] = -1;
  U[10] = 2.5;
  if (U[11] === 1) PROFILE.setTutorialDone();
}

/// Force a tutorial step (the capture harness).
export function debugStep(n: number): void { U[6] = 1; beginStep(n); }
export function debugHint(id: number): void { U[7] = id; U[8] = HINT_TIME; }

/// Show a hint once per profile.
export function hint(id: number): void {
  if (!hintsOn() || U[11] === 0 || U[0] >= 0 || id < 0 || id >= HINT_COUNT) return;
  if (PROFILE.hintSeen(id)) return;
  if (U[8] > 0.5) return;                 // one at a time; this one gets its turn later
  PROFILE.markHint(id);
  U[7] = id; U[8] = HINT_TIME;
  MIX.uiTab();
}

export function updateTutor(dt: number, playing: boolean): void {
  if (U[8] > 0) U[8] = U[8] - dt;
  if (U[10] > 0) U[10] = U[10] - dt;
  if (!playing) return;

  if (U[0] < 0) {
    // Hints the tutor can see for itself (the director raises the rest).
    if (GS.playerHP > 0 && GS.playerHP < 40) hint(HINT_HEAL);
    if (WPN.currentReserve() === 0 && WPN.currentAmmo() < WPN.magSize(WPN.currentWeapon()) * 0.5) hint(HINT_CRATE);
    if (GS.runElapsed > 4 && GS.runElapsed < 6 && (WPN.isUnlocked(WPN.W_CHAIN) || WPN.isUnlocked(WPN.W_CANNON))) hint(HINT_SWAP);
    return;
  }

  // -- the tutorial
  let skip = isKeyPressed(Key.BACKSPACE);
  if (isGamepadAvailable() && isGamepadButtonPressed(6)) skip = true;
  if (skip) { MIX.uiBack(); finish(); return; }

  U[1] = U[1] + dt;
  const pp = playerPosition();
  const mx = pp.x - U[3], mz = pp.z - U[4];
  U[2] = U[2] + Math.sqrt(mx * mx + mz * mz);
  U[3] = pp.x; U[4] = pp.z;

  if (U[9] < 0) {
    let done = false;
    const s = U[0];
    if (s === 0) done = U[2] > 5.0;
    else if (s === 1) done = SCORE.shotsFired() - U[5] >= 3;
    else if (s === 2) done = WPN.isReloading();
    else if (s === 3) done = isDodging();
    else if (s === 4) done = GS.throwT > 0 || GS.meleeT >= 0;
    if (done) { U[9] = 0; MIX.uiToggle(); }
    else if (U[1] > STEP_TIMEOUT) U[9] = 0.3;
  } else {
    // Answered: the tick shows for a moment, then the next prompt.
    U[9] = U[9] + dt;
    if (U[9] > 0.7) {
      if (U[0] + 1 >= STEPS) finish();
      else beginStep(U[0] + 1);
    }
  }
}

/// Glyphs for the actions of step `s`, left to right from x; returns the x after them.
function stepGlyphs(s: number, x: number, y: number, h: number, a: number): number {
  if (MOBILE) return x;
  const g = 6;
  let acts = [B.ACT_FWD, -1, -1, -1];
  if (s === 0 && !UI.padGlyphs()) acts = [B.ACT_FWD, B.ACT_LEFT, B.ACT_BACK, B.ACT_RIGHT];
  else if (s === 1) acts = [B.ACT_AIM, B.ACT_FIRE, -1, -1];
  else if (s === 2) acts = [B.ACT_RELOAD, -1, -1, -1];
  else if (s === 3) acts = [B.ACT_DODGE, -1, -1, -1];
  else if (s === 4) acts = [B.ACT_GRENADE, B.ACT_MELEE, -1, -1];
  for (let i = 0; i < 4; i++) {
    if (acts[i] < 0) continue;
    UI.drawGlyph(acts[i], x, y, h, a);
    x = x + UI.glyphW(acts[i], h) + g;
  }
  return x + 8;
}

function stepGlyphsW(s: number, h: number): number {
  if (MOBILE) return 0;
  let acts = [B.ACT_FWD, -1, -1, -1];
  if (s === 0 && !UI.padGlyphs()) acts = [B.ACT_FWD, B.ACT_LEFT, B.ACT_BACK, B.ACT_RIGHT];
  else if (s === 1) acts = [B.ACT_AIM, B.ACT_FIRE, -1, -1];
  else if (s === 2) acts = [B.ACT_RELOAD, -1, -1, -1];
  else if (s === 3) acts = [B.ACT_DODGE, -1, -1, -1];
  else if (s === 4) acts = [B.ACT_GRENADE, B.ACT_MELEE, -1, -1];
  let w = 8;
  for (let i = 0; i < 4; i++) if (acts[i] >= 0) w = w + UI.glyphW(acts[i], h) + 6;
  return w;
}

/// Drawn by the HUD, in its logical space. `k` is the HUD's size factor.
export function drawTutor(sw: number, sh: number, k: number): void {
  const cx = sw / 2;
  if (U[0] >= 0) {
    const s = U[0];
    const tin = UI.easeOut(U[1] / 0.25);
    const answered = U[9] >= 0;
    const a = 255 * tin;
    const gh = 40 * k;
    const fs = 30 * k;
    const label = T(STR.S_TUT_0 + s);
    const gw = stepGlyphsW(s, gh);
    const lw = UI.textW(label, fs);
    const w = Math.max(gw + lw + 60 * k, 420 * k);
    const h = 118 * k;
    const x = cx - w / 2;
    const y = sh * 0.60 + (1 - tin) * 18 * k;
    UI.panel(x, y, w, h, 220 * tin);
    UI.nine(A_PANEL_LINE, x, y, w, h, 12 * k, answered ? UI.C_GOOD : UI.C_ACCENT, a * 0.9);
    UI.text(T(STR.S_TUT_TITLE) + '   ' + (s + 1) + ' / ' + STEPS, x + 22 * k, y + 12 * k, 15 * k, UI.C_DIM, a);
    // five pips: done, current, to come
    for (let i = 0; i < STEPS; i++) {
      drawRect(x + w - 22 * k - (STEPS - i) * 20 * k, y + 18 * k, 15 * k, 4 * k,
               UI.col(i < s || (i === s && answered) ? UI.C_GOOD : (i === s ? UI.C_ACCENT : UI.C_LINE), a));
    }
    const rowY = y + 46 * k;
    let gx = cx - (gw + lw) / 2;
    gx = stepGlyphs(s, gx, rowY, gh, a);
    UI.text(label, gx, rowY + (gh - fs) / 2, fs, answered ? UI.C_GOOD : UI.C_BRIGHT, a);
    if (answered) UI.spr(A_CHECK, gx + lw + 12 * k, rowY + 4 * k, 32 * k, 32 * k, UI.C_GOOD, a);
    if (!MOBILE) {
      const sk = T(STR.S_TUT_SKIP);
      const sf = 14 * k;
      const sh2 = 22 * k;
      const skw = UI.textW(sk, sf);
      const pad = UI.padGlyphs();
      const kw = pad ? UI.padGlyphW(6, sh2) : UI.kbGlyphW(Key.BACKSPACE, sh2);
      const sx = cx - (kw + 6 * k + skw) / 2;
      if (pad) UI.drawPadGlyph(6, sx, y + h + 8 * k, sh2, a * 0.8);
      else UI.drawKbGlyph(Key.BACKSPACE, sx, y + h + 8 * k, sh2, a * 0.8);
      UI.textS(sk, sx + kw + 6 * k, y + h + 8 * k + (sh2 - sf) / 2, sf, UI.C_DIM, a * 0.9);
    }
    return;
  }
  if (U[10] > 0) {
    const a = 255 * UI.clamp01(U[10] / 0.5);
    UI.textCS(T(STR.S_TUT_DONE), cx, sh * 0.62, 28 * k, UI.C_GOOD, a);
  }
  if (U[7] >= 0 && U[8] > 0) {
    const tin = UI.easeOut((HINT_TIME - U[8]) / 0.3);
    const a = 255 * tin * UI.clamp01(U[8] / 0.5);
    const fs = 19 * k;
    const msg = T(STR.S_TIP_0 + U[7]);
    const tw = UI.textW(msg, fs);
    const w = tw + 64 * k;
    const h = 62 * k;
    const x = 36 * k - (1 - tin) * 40 * k;
    const y = sh * 0.40;
    UI.nine(A_PANEL, x, y, w, h, 12 * k, UI.C_PANEL, UI.panelA(215) * a / 255);
    drawRect(x, y + 6 * k, 4 * k, h - 12 * k, UI.col(UI.C_INFO, a));
    UI.text(T(STR.S_TIP_HEAD), x + 20 * k, y + 8 * k, 13 * k, UI.C_INFO, a);
    UI.text(msg, x + 20 * k, y + 28 * k, fs, UI.C_BRIGHT, a);
  }
}
