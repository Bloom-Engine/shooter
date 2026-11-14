// SH-025d / plan Phase 4 (SH-059) - the player-facing HUD.
//
// Phase 4 redrew all of it with the UI kit (ui.ts): panels and icons from the atlas, colours
// by MEANING through the palette (so the colour-blind palettes re-colour it), every word from
// the string table, every key hint a glyph drawn from the binding table. What it shows:
//
//   centre      crosshair whose gap is the spread, hit / critical / kill markers, reload and
//               charge meters, the "reload" prompt on an empty magazine
//   edges       damage vignette, a wedge per hit pointing at its source, chevrons for
//               creatures about to strike from outside the view
//   top         compass strip with a pip per creature, wave tracker, seen/unseen
//   top left    score, combo, the points of the last kill
//   bottom left health (segments, the regeneration notch, a trailing "just lost" chunk), dodge
//   bottom right weapon silhouette, magazine as pips, reserve, the four weapon slots, grenades
//   lower third subtitles for the sounds that carry information (plan 4.4)
//
// Everything animates off one clock (H[0]); nothing here changes game state except clearing
// GS.capEvent. Draws in the LOGICAL 2D space main establishes. Diagnostics stay in main.
//
// Perry rules as in the other SH-025 modules: top-level functions only, no exported let, no
// module-scope engine calls, state in const arrays.

import { drawRect, drawLine, getTime } from 'bloom';
import { GS } from './gamestate';
import { ARENA_INDEX, ARENAS } from './world-runtime';
import { DIR, wavePlan, countAlive, REGEN_CAP, BOSS, bossHealth } from './director';
import { PLAYER_HP_MAX } from './combat';
import { dodgeCooldownFrac, playerPosition } from './player';
import { MOBILE } from './input';
import { CAM } from './camera';
import {
  MAX_ENEMIES, KIND_NAME, AI_WINDUP, AI_CHARGE, AI_STRIKE_WIND, AI_STRIKE_HIT,
  enAlive, enKind, enAIState, enAware, enX, enZ, enElite,
} from './enemies';
import { OBJ, OBJ_HOLD, OBJ_NESTS, NEST_N, nestX, nestZ, nestHP } from './objective';
import * as W from './world-runtime';
import * as TUTOR from './tutor';
import * as WPN from './weapons';
import * as SCORE from './score';
import * as SET from './settings';
import * as UI from './ui';
import * as B from './binds';
import * as STR from './strings';
import { T, fmt } from './strings';
import { currentMenu, MENU_NONE } from './menu';
import {
  A_VIG, A_ARC, A_CHEV, A_PIP, A_GRENADE, A_CROSS, A_SKULL, A_ROLL, A_BOLT, A_EYE, A_BUTT,
  A_LOCK, A_FADE_H, A_FADE_R, A_PANEL, A_PANEL_LINE, A_RING, A_SOFT, A_EMBLEM,
  A_WPN_RIFLE, A_DISC,
} from './ui-atlas';

// Subtitle ids (GS.capEvent carries one of these from whoever made the sound).
export const CAP_WINDUP = 1;
export const CAP_ROAR = 2;
export const CAP_WAVE = 3;
export const CAP_HEART = 4;
export const CAP_EXPLOSION = 5;
export const CAP_EMPTY = 6;
export const CAP_HEAL = 7;
export const CAP_SILENCE = 8;

//  0 clock at the last frame   1 health shown by the trailing chunk   2 seconds since the
//  magazine count last changed   3 that count   4 wave banner time left   5 the wave it names
//  6 subtitle id   7 subtitle time left   8 creatures aware last frame   9 1 = between waves
//  last frame   10 heartbeat subtitle cooldown   11 weapon last frame   12 seconds since the
//  weapon changed   13 1 = run was won last frame   14 subtitle argument (a kind)   15 seconds
//  the trailing health chunk still holds before draining   16 health last frame
//  17 end-of-run title: seconds since the run ended   18 1 = magazine was empty last frame
const H = [0, 100, 9, 0, 0, 0, 0, 0, 0, 1, 0, 0, 9, 0, 0, 0, 100, 0, 0];

function showCaption(id: number, arg: number, seconds: number): void {
  // A wind-up outranks everything: it is the one the player has to act on.
  if (H[6] === CAP_WINDUP && H[7] > 0.2 && id !== CAP_WINDUP) return;
  H[6] = id; H[7] = seconds; H[14] = arg;
}

function captionText(): string {
  const id = H[6];
  if (id === CAP_WINDUP) return fmt(STR.S_CAP_WINDUP, KIND_NAME[H[14]]);
  if (id === CAP_ROAR) return T(STR.S_CAP_ROAR);
  if (id === CAP_WAVE) return T(STR.S_CAP_WAVE);
  if (id === CAP_HEART) return T(STR.S_CAP_HEART);
  if (id === CAP_EXPLOSION) return T(STR.S_CAP_EXPLOSION);
  if (id === CAP_EMPTY) return T(STR.S_CAP_EMPTY);
  if (id === CAP_HEAL) return T(STR.S_CAP_HEAL);
  if (id === CAP_SILENCE) return T(STR.S_CAP_SILENCE);
  return '';
}

/// SH-043 / plan 4.4 - subtitles for sounds that carry information: a wind-up roar (the dodge
/// window), the shriek of a creature that has seen you, the howl before a wave, your own
/// heartbeat at low health, an explosion, a dry click, a field dressing, the quiet of a
/// cleared arena. One line at a time, three sizes, an optional dark plate. Off by default.
function updateAndDrawCaptions(sw: number, sh: number, dt: number, k: number): void {
  // -- gather this frame's events (always, so the state is right when the setting flips on)
  let windKind = -1;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] === 0) continue;
    // The rooted wind-ups (pounce, volley) and the heavies' strikes. A Skitter's 0.3 s claw is
    // not captioned: a line that flickers ten times a fight is one the player stops reading.
    const heavyStrike = enAIState[i] === AI_STRIKE_WIND && enKind[i] >= 3;
    if (enAIState[i] !== AI_WINDUP && !heavyStrike) continue;
    windKind = enKind[i];
    break;
  }
  if (windKind >= 0) showCaption(CAP_WINDUP, windKind, 0.35);
  if (DIR.awareCount > 0 && H[8] === 0 && DIR.aliveCount > 0) showCaption(CAP_ROAR, 0, 2.6);
  H[8] = DIR.awareCount;
  const between = DIR.waveBreakTimer > 0 ? 1 : 0;
  if (between === 0 && H[9] === 1 && DIR.waveIdx < wavePlan.length && !DIR.gameWon) {
    showCaption(CAP_WAVE, 0, 3.0);
    H[4] = 2.6; H[5] = DIR.waveIdx + 1;            // and the wave banner
  }
  H[9] = between;
  if (H[10] > 0) H[10] = H[10] - dt;
  if (GS.playerHP > 0 && GS.playerHP < 25 && H[10] <= 0) { showCaption(CAP_HEART, 0, 2.4); H[10] = 9; }
  const emptyNow = WPN.currentAmmo() === 0 && !WPN.isReloading() ? 1 : 0;
  if (emptyNow === 1 && H[18] === 0) showCaption(CAP_EMPTY, 0, 1.8);
  H[18] = emptyNow;
  if (DIR.gameWon && H[13] === 0) showCaption(CAP_SILENCE, 0, 4.0);
  H[13] = DIR.gameWon ? 1 : 0;
  if (GS.capEvent > 0) { showCaption(GS.capEvent, 0, 2.2); GS.capEvent = 0; }

  if (H[7] > 0) H[7] = H[7] - dt;
  if (SET.get(SET.SET_CAPTIONS) === 0 || H[7] <= 0) return;

  const sizes = [18, 24, 32];
  const s = sizes[SET.get(SET.SET_CAPTION_SIZE)] * k;
  const msg = '[ ' + captionText() + ' ]';
  const w = UI.textW(msg, s);
  const x = (sw - w) / 2;
  const y = sh * 0.76;           // below the crosshair, above the bottom corners
  const a = 255 * UI.clamp01(H[7] / 0.25);
  if (SET.get(SET.SET_CAPTION_BG) !== 0) {
    drawRect(x - 16 * k, y - 7 * k, w + 32 * k, s * 1.18 + 14 * k, UI.col(UI.C_BLACK, UI.panelA(200) * a / 255));
    UI.text(msg, x, y, s, H[6] === CAP_WINDUP ? UI.C_ACCENT : UI.C_BRIGHT, a);
  } else {
    UI.textS(msg, x, y, s, H[6] === CAP_WINDUP ? UI.C_ACCENT : UI.C_BRIGHT, a);
  }
}

function wrapPi(a: number): number {
  let r = a;
  while (r > Math.PI) r = r - Math.PI * 2;
  while (r < -Math.PI) r = r + Math.PI * 2;
  return r;
}

/// A diagonal tick of the hit marker: from radius r0 to r1 along (sx, sy).
function tick(cx: number, cy: number, sx: number, sy: number, r0: number, r1: number,
              th: number, c: number, a: number): void {
  drawLine(cx + sx * r0, cy + sy * r0, cx + sx * r1, cy + sy * r1, th, UI.col(c, a));
}

function drawCrosshair(sw: number, sh: number, k: number): void {
  const cx = sw / 2;
  const cy = sh / 2;
  // SH-028 - the gap between the arms IS the current spread. A crosshair that does not move
  // while the cone triples is lying about where the bullet is going.
  const spreadDeg = WPN.spreadRad() * 180 / Math.PI;
  const gap = (4 + spreadDeg * 5.5) * k;
  const arm = 8 * k;
  const th = 2 * k;
  const a = GS.muzzleFlashT > 0 ? 255 : 205;
  // a dark under-stroke first: the crosshair has to read over snow-bright sky and dusk alike
  const sh2 = UI.col(UI.C_BLACK, 120);
  drawRect(cx - gap - arm - 1, cy - th / 2 - 1, arm + 2, th + 2, sh2);
  drawRect(cx + gap - 1, cy - th / 2 - 1, arm + 2, th + 2, sh2);
  drawRect(cx - th / 2 - 1, cy - gap - arm - 1, th + 2, arm + 2, sh2);
  drawRect(cx - th / 2 - 1, cy + gap - 1, th + 2, arm + 2, sh2);
  const col = UI.col(UI.C_BRIGHT, a);
  drawRect(cx - gap - arm, cy - th / 2, arm, th, col);
  drawRect(cx + gap, cy - th / 2, arm, th, col);
  drawRect(cx - th / 2, cy - gap - arm, th, arm, col);
  drawRect(cx - th / 2, cy + gap, th, arm, col);
  UI.spr(A_DISC, cx - 2 * k, cy - 2 * k, 4 * k, 4 * k, UI.C_BRIGHT, a);

  // SH-043 - hit confirmation is a SHAPE, never only a colour:
  //   a hit       four short diagonal ticks
  //   a critical  the ticks, longer, inside a ring (and its own sound)
  //   a kill      the ticks fly outward and a skull marks the spot
  if (GS.hitMarkT > 0) {
    const crit = GS.hitMarkCrit === 1;
    const life = crit ? 0.28 : 0.18;
    const t = 1 - GS.hitMarkT / life;
    const ha = 255 * (1 - t * t);
    const r0 = (9 + t * 3) * k;
    const r1 = r0 + (crit ? 12 : 8) * k;
    const d = 0.7071;
    const thh = (crit ? 3 : 2.2) * k;
    tick(cx, cy, d, d, r0, r1, thh, UI.C_BRIGHT, ha);
    tick(cx, cy, -d, d, r0, r1, thh, UI.C_BRIGHT, ha);
    tick(cx, cy, d, -d, r0, r1, thh, UI.C_BRIGHT, ha);
    tick(cx, cy, -d, -d, r0, r1, thh, UI.C_BRIGHT, ha);
    if (crit) {
      const rr = (30 + t * 8) * k;
      UI.spr(A_RING, cx - rr, cy - rr, rr * 2, rr * 2, UI.C_ACCENT, ha);
    }
  }
  const kf = SCORE.killFlash();
  if (kf > 0) {
    const t = 1 - kf / 0.5;
    const ka = 255 * (1 - t);
    const r0 = (14 + UI.easeOut(t) * 16) * k;
    const r1 = r0 + 13 * k;
    const d = 0.7071;
    tick(cx, cy, d, d, r0, r1, 3.2 * k, UI.C_DANGER, ka);
    tick(cx, cy, -d, d, r0, r1, 3.2 * k, UI.C_DANGER, ka);
    tick(cx, cy, d, -d, r0, r1, 3.2 * k, UI.C_DANGER, ka);
    tick(cx, cy, -d, -d, r0, r1, 3.2 * k, UI.C_DANGER, ka);
    const ss = 22 * k;
    UI.spr(A_SKULL, cx - ss / 2, cy + 40 * k - UI.easeOut(t) * 6 * k, ss, ss, UI.C_BRIGHT, ka);
  }

  // Under the crosshair, top to bottom: the dodge confirmation, the cannon's charge, the
  // chaingun's spool, the reload meter, and the prompt when the magazine is empty.
  if (DIR.dodgedT > 0) {
    UI.textCS(T(STR.S_DODGED), cx, cy + 34 * k, 17 * k, UI.C_INFO, 235 * UI.clamp01(DIR.dodgedT / 0.3));
  }
  let my = cy + 62 * k;
  const chg = WPN.chargeLevel();
  if (chg > 0.01) {
    // Turns to the accent at full, so the release point can be felt without staring at it.
    const full = chg > 0.98;
    const bw = 170 * k;
    drawRect(cx - bw / 2 - 1, my - 1, bw + 2, 8 * k + 2, UI.col(UI.C_BLACK, 170));
    drawRect(cx - bw / 2, my, bw * chg, 8 * k, UI.col(full ? UI.C_DANGER : UI.C_ACCENT, 250));
    my = my + 16 * k;
  }
  const spool = WPN.spinup();
  if (spool > 0.01 && spool < 0.99) {
    const bw = 130 * k;
    drawRect(cx - bw / 2 - 1, my - 1, bw + 2, 5 * k + 2, UI.col(UI.C_BLACK, 170));
    drawRect(cx - bw / 2, my, bw * spool, 5 * k, UI.col(UI.C_TEXT, 230));
    my = my + 13 * k;
  }
  if (WPN.isReloading()) {
    // A timed reload the player cannot SEE is an unexplained dead trigger.
    const rp = WPN.reloadProgress();
    const bw = 150 * k;
    drawRect(cx - bw / 2 - 1, my - 1, bw + 2, 6 * k + 2, UI.col(UI.C_BLACK, 170));
    drawRect(cx - bw / 2, my, bw * rp, 6 * k, UI.col(UI.C_INFO, 245));
    UI.textCS(T(STR.S_RELOADING), cx, my + 10 * k, 14 * k, UI.C_INFO, 225);
  } else if (WPN.currentAmmo() === 0 && !GS.gameOver) {
    const pulse = 170 + 85 * Math.sin(H[0] * 7);
    if (WPN.currentReserve() > 0) {
      const label = T(STR.S_RELOAD);
      const gh = 26 * k;
      if (MOBILE) UI.textCS(label, cx, my, 17 * k, UI.C_DANGER, pulse);
      else {
        const w = UI.glyphW(B.ACT_RELOAD, gh) + gh * 0.3 + UI.textW(label, gh * 0.62);
        UI.promptL(B.ACT_RELOAD, label, cx - w / 2, my, gh, UI.C_DANGER, pulse);
      }
    } else {
      UI.textCS(T(STR.S_NO_AMMO), cx, my, 17 * k, UI.C_DANGER, pulse);
    }
  }
}

/// What hurt you and what is about to: the vignette, a wedge per hit, chevrons for strikes
/// winding up outside the view.
function drawThreats(sw: number, sh: number, k: number): void {
  const cx = sw / 2, cy = sh / 2;
  // Low health keeps a faint pulsing edge; a hit flashes it.
  let va = 0;
  // (Modest alphas: the post-process pass adds its own red flash on a hit, feel.ts.)
  if (GS.playerHP > 0 && GS.playerHP < 25) va = 34 + 22 * Math.sin(H[0] * 5.5);
  if (GS.damageFlashT > 0) va = va + (GS.damageFlashT / 0.5) * 80;
  if (va > 0) UI.spr(A_VIG, 0, 0, sw, sh, UI.C_DANGER, va > 120 ? 120 : va);
  if (GS.healFlashT > 0) UI.spr(A_VIG, 0, 0, sw, sh, UI.C_GOOD, (GS.healFlashT / 0.6) * 60);

  const R = Math.min(sw, sh) * 0.30;
  // SH-029 - where the hit came from, as a POSITION on a ring round the crosshair.
  if (GS.lastHitT > 0) {
    const t = GS.lastHitT / 1.4;
    const a = 255 * UI.clamp01(t * 1.6);
    const w = 250 * k, h = 94 * k;
    const push = (1 - UI.easeOut((1 - t) * 6)) * 26 * k;      // it lands with a small punch
    UI.sprRot(A_ARC, cx, cy, w, h, w / 2, R + h * 0.6 + push, GS.lastHitAngle * 180 / Math.PI,
              UI.C_DANGER, a);
  }
  // Off-screen threats: a creature that knows where you are and is in (or winding up) an
  // attack, or simply close, outside what the camera shows. The chevron points at it.
  const pp = playerPosition();
  const yaw = CAM[0];
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] === 0 || enAware[i] === 0) continue;
    const dx = enX[i] - pp.x, dz = enZ[i] - pp.z;
    const d2 = dx * dx + dz * dz;
    const st = enAIState[i];
    const striking = st === AI_WINDUP || st === AI_CHARGE || st === AI_STRIKE_WIND || st === AI_STRIKE_HIT;
    if (!striking && d2 > 49) continue;
    if (d2 > 900) continue;
    const rel = wrapPi(Math.atan2(dx, -dz) - yaw);
    if (Math.abs(rel) < 0.85) continue;                        // on screen: the creature is its own warning
    const s = (striking ? 34 : 24) * k;
    const pulse = striking ? 0.7 + 0.3 * Math.sin(H[0] * 14) : 0.75;
    UI.sprRot(A_CHEV, cx, cy, s, s, s / 2, R * 1.12 + s, rel * 180 / Math.PI,
              striking ? UI.C_DANGER : UI.C_ACCENT, 235 * pulse);
  }
}

/// An objective's mark on the bearing strip, with its distance under it when it is in view.
function objPip(cx: number, y: number, k: number, ppr: number, span: number, yaw: number,
                ox: number, oz: number, px: number, pz: number): void {
  const rel = wrapPi(Math.atan2(ox - px, -(oz - pz)) - yaw);
  let r = rel;
  if (r > span) r = span;
  if (r < -span) r = -span;
  const s = 16 * k;
  const x = cx + r * ppr;
  UI.sprRot(A_DISC, x, y + 15 * k, s, s, s / 2, s / 2, 45, UI.C_INFO, r !== rel ? 150 : 255);
  UI.sprRot(A_RING, x, y + 15 * k, s * 1.5, s * 1.5, s * 0.75, s * 0.75, 0, UI.C_INFO, r !== rel ? 110 : 220);
  if (r === rel) {
    const d = Math.sqrt((ox - px) * (ox - px) + (oz - pz) * (oz - pz));
    UI.textCS('' + Math.round(d) + ' M', x, y + 58 * k, 13 * k, UI.C_INFO, 235);
  }
}

/// Top centre: bearing strip, wave tracker, seen/unseen.
function drawTop(sw: number, sh: number, k: number): void {
  const cx = sw / 2;
  let y = 22 * k;
  if (SET.get(SET.SET_COMPASS) !== 0) {
    const half = 270 * k;
    const span = Math.PI / 3;                 // the strip shows 60 degrees either side
    const ppr = half / span;
    const yaw = CAM[0];
    UI.spr(A_FADE_H, cx - half, y, half * 2, 30 * k, UI.C_BLACK, UI.panelA(130));
    // ticks every 15 degrees; letters on the four cardinals (north is -Z, as the world is built)
    for (let i = 0; i < 24; i++) {
      const b = i * Math.PI / 12;
      const rel = wrapPi(b - yaw);
      if (Math.abs(rel) > span) continue;
      const x = cx + rel * ppr;
      const fade = 1 - Math.abs(rel) / span;
      if (i % 6 === 0) {
        const letter = i === 0 ? 'N' : (i === 6 ? 'E' : (i === 12 ? 'S' : 'W'));
        UI.textC(letter, x, y + 3 * k, 19 * k, i === 0 ? UI.C_ACCENT : UI.C_BRIGHT, 255 * fade);
      } else {
        const big = i % 3 === 0;
        drawRect(x - 1, y + (big ? 8 : 12) * k, 2, (big ? 14 : 7) * k, UI.col(UI.C_TEXT, (big ? 200 : 130) * fade));
      }
    }
    drawRect(cx - 1, y + 30 * k, 2, 7 * k, UI.col(UI.C_BRIGHT, 230));
    // a pip per creature under the strip: at its bearing, or pinned to the end it is beyond
    const pp = playerPosition();
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (enAlive[i] === 0) continue;
      const rel = wrapPi(Math.atan2(enX[i] - pp.x, -(enZ[i] - pp.z)) - yaw);
      let r = rel;
      if (r > span) r = span;
      if (r < -span) r = -span;
      const aware = enAware[i] === 1;
      const elite = enElite[i] === 1;
      const s = (elite ? 18 : (aware ? 13 : 9)) * k;
      const out = r !== rel;
      UI.sprRot(A_CHEV, cx + r * ppr, y + (elite ? 41 : 39) * k, s, s, s / 2, s / 2, out ? (rel > 0 ? 90 : -90) : 180,
                elite ? UI.C_ACCENT : (aware ? UI.C_DANGER : UI.C_DIM), out ? 170 : 235);
    }
    // ...and the objective: the ring, or each nest still standing, as a diamond ON the strip.
    if (OBJ.type === OBJ_HOLD && !OBJ.done) objPip(cx, y, k, ppr, span, yaw, W.HOLD_SITE[0], W.HOLD_SITE[2], pp.x, pp.z);
    if (OBJ.type === OBJ_NESTS) {
      for (let i = 0; i < NEST_N; i++) {
        if (nestHP[i] > 0) objPip(cx, y, k, ppr, span, yaw, nestX[i], nestZ[i], pp.x, pp.z);
      }
    }
    y = y + 56 * k;
  }

  if (GS.gameOver || DIR.gameWon) return;
  // Wave tracker: which wave, as pips; then either the countdown or what is left of it.
  const nW = wavePlan.length;
  const pipW = 26 * k, pipG = 6 * k;
  const px0 = cx - (nW * pipW + (nW - 1) * pipG) / 2;
  for (let i = 0; i < nW; i++) {
    const done = i < DIR.waveIdx;
    const cur = i === DIR.waveIdx && DIR.waveBreakTimer <= 0;
    drawRect(px0 + i * (pipW + pipG), y, pipW, 5 * k,
             UI.col(done ? UI.C_GOOD : (cur ? UI.C_ACCENT : UI.C_LINE), done || cur ? 240 : 150));
  }
  y = y + 11 * k;
  if (DIR.waveIdx >= nW) return;
  if (DIR.waveBreakTimer > 0) {
    // The tutorial holds the first countdown: a frozen number would only puzzle.
    if (!TUTOR.tutorialActive()) UI.textCS(fmt(STR.S_WAVE_IN, DIR.waveBreakTimer.toFixed(1)), cx, y, 20 * k, UI.C_ACCENT, 240);
    return;
  }
  const size = wavePlan[DIR.waveIdx];
  const left = (size - DIR.waveSpawned) + countAlive();
  const bw = 210 * k;
  if (OBJ.type === OBJ_HOLD || OBJ.type === OBJ_NESTS) {
    // An objective wave says what to DO, and how far along it is, in place of a head count.
    const hold = OBJ.type === OBJ_HOLD;
    const frac = OBJ.need > 0 ? OBJ.prog / OBJ.need : 1;
    let label = fmt(STR.S_WAVE_N, '' + (DIR.waveIdx + 1)) + '   ';
    if (OBJ.done) label = label + T(STR.S_OBJ_MOPUP) + '   ' + countAlive();
    else if (hold) label = label + T(OBJ.inside ? STR.S_OBJ_HOLDING : STR.S_OBJ_HOLD) + '   ' + Math.floor(frac * 100) + '%';
    else label = label + T(STR.S_OBJ_NESTS) + '   ' + Math.floor(OBJ.prog) + ' / ' + Math.floor(OBJ.need);
    const col = OBJ.done ? UI.C_GOOD : (hold && !OBJ.inside ? UI.C_ACCENT : UI.C_INFO);
    UI.textCS(label, cx, y, 20 * k, col, 245);
    y = y + 28 * k;
    drawRect(cx - bw / 2 - 1, y - 1, bw + 2, 5 * k + 2, UI.col(UI.C_BLACK, 150));
    drawRect(cx - bw / 2, y, bw * UI.clamp01(frac), 5 * k, UI.col(OBJ.done ? UI.C_GOOD : UI.C_INFO, 240));
    y = y + 12 * k;
  } else {
    const label = fmt(STR.S_WAVE_N, '' + (DIR.waveIdx + 1)) + '   ' + left + ' ' + T(STR.S_REMAINING);
    UI.textCS(label, cx, y, 20 * k, UI.C_BRIGHT, 240);
    y = y + 28 * k;
    drawRect(cx - bw / 2 - 1, y - 1, bw + 2, 4 * k + 2, UI.col(UI.C_BLACK, 150));
    drawRect(cx - bw / 2, y, bw * (left / Math.max(1, size)), 4 * k, UI.col(UI.C_ACCENT, 235));
    y = y + 11 * k;
  }
  if (DIR.eliteCount > 0) {
    UI.textCS(fmt(STR.S_ELITE_N, '' + DIR.eliteCount), cx, y, 15 * k, UI.C_ACCENT, 240);
    y = y + 20 * k;
  }
  // Plan 2.1 - whether anything knows where you are: an eye (open, or struck out) and the
  // word, so it rests on neither colour nor icon alone.
  if (DIR.aliveCount > 0) {
    const seen = DIR.awareCount > 0;
    const tag = seen ? fmt(STR.S_HUNTED, '' + DIR.awareCount) : T(STR.S_UNSEEN);
    const fs = 15 * k;
    const tw = UI.textW(tag, fs);
    const ic = 18 * k;
    const x0 = cx - (tw + ic + 6 * k) / 2;
    UI.spr(A_EYE, x0, y + 1 * k, ic, ic, seen ? UI.C_DANGER : UI.C_INFO, 235);
    if (!seen) drawLine(x0 + 2 * k, y + ic, x0 + ic - 2 * k, y + 2 * k, 2 * k, UI.col(UI.C_INFO, 235));
    UI.textS(tag, x0 + ic + 6 * k, y + 2 * k, fs, seen ? UI.C_DANGER : UI.C_INFO, 235);
  }
}

function drawScore(sw: number, sh: number, k: number): void {
  const x = 36 * k;
  let y = 30 * k;
  UI.textS(T(STR.S_SCORE), x, y, 14 * k, UI.C_DIM, 230);
  UI.textS('' + SCORE.score(), x, y + 14 * k, 34 * k, UI.C_BRIGHT, 250);
  // the points of the last kill, rising off the total
  const gt = SCORE.lastGainT();
  if (gt > 0) {
    const t = 1 - gt / 1.1;
    const w = UI.textW('' + SCORE.score(), 34 * k);
    UI.textS('+' + SCORE.lastGain(), x + w + 14 * k, y + 24 * k - UI.easeOut(t) * 18 * k, 20 * k,
             UI.C_ACCENT, 255 * (1 - t * t));
  }
  y = y + 58 * k;
  const cmb = SCORE.combo();
  if (cmb > 1.001) {
    UI.spr(A_BOLT, x - 4 * k, y, 26 * k, 26 * k, UI.C_ACCENT, 250);
    UI.textS('x' + cmb.toFixed(2), x + 24 * k, y - 1 * k, 26 * k, UI.C_ACCENT, 255);
    // The combo's remaining life, draining: pressure made visible is what makes a player
    // push forward instead of hiding.
    const cw = 120 * k;
    drawRect(x, y + 32 * k, cw, 4 * k, UI.col(UI.C_BLACK, 170));
    drawRect(x, y + 32 * k, cw * SCORE.comboFrac(), 4 * k, UI.col(UI.C_ACCENT, 245));
  }
}

function drawHealth(sw: number, sh: number, dt: number, k: number): void {
  const w = 330 * k, h = 78 * k;
  const x = 36 * k;
  const y = sh - 36 * k - h;
  const hp = GS.playerHP;
  // The chunk just lost stays lit for a moment, then drains: you see what a blow cost.
  if (hp < H[16] - 0.01) H[15] = 0.55;
  H[16] = hp;
  if (hp > H[1]) H[1] = hp;
  if (H[15] > 0) H[15] = H[15] - dt;
  else if (H[1] > hp) { H[1] = H[1] - 55 * dt; if (H[1] < hp) H[1] = hp; }

  const low = hp < 25 && hp > 0;
  UI.panel(x, y, w, h, 185);
  if (low) UI.nine(A_PANEL_LINE, x, y, w, h, 14 * k, UI.C_DANGER, 150 + 100 * Math.sin(H[0] * 9));
  const ic = 30 * k;
  UI.spr(A_CROSS, x + 14 * k, y + 13 * k, ic, ic, low ? UI.C_DANGER : UI.C_BRIGHT, 245);
  UI.textR('' + Math.ceil(hp), x + w - 16 * k, y + 8 * k, 32 * k, low ? UI.C_DANGER : UI.C_BRIGHT, 255);

  const bx = x + 56 * k, by = y + 20 * k, bw = w - 56 * k - 86 * k, bh = 16 * k;
  drawRect(bx, by, bw, bh, UI.col(UI.C_BLACK, 200));
  const f = Math.max(0, hp / PLAYER_HP_MAX);
  const g = Math.max(0, H[1] / PLAYER_HP_MAX);
  if (g > f) drawRect(bx + bw * f, by, bw * (g - f), bh, UI.col(UI.C_BRIGHT, 220));
  drawRect(bx, by, bw * f, bh, UI.col(low ? UI.C_DANGER : UI.C_GOOD, 245));
  if (GS.healFlashT > 0) drawRect(bx, by, bw * f, bh, UI.col(UI.C_BRIGHT, (GS.healFlashT / 0.6) * 190));
  // ten segments
  for (let i = 1; i < 10; i++) drawRect(bx + bw * i / 10 - 1, by, 2, bh, UI.col(UI.C_PANEL, 230));
  // The notch health regenerates to on its own (plan 2.7); past it only a dressing helps.
  const nx = bx + bw * REGEN_CAP / PLAYER_HP_MAX;
  drawRect(nx - 1, by - 4 * k, 2, bh + 8 * k, UI.col(UI.C_BRIGHT, 200));

  // Dodge: the roll icon and its cooldown, so you know when you can commit.
  const cd = dodgeCooldownFrac();
  const dy = y + h - 28 * k;
  const ready = cd <= 0;
  UI.spr(A_ROLL, x + 16 * k, dy, 22 * k, 22 * k, ready ? UI.C_INFO : UI.C_DIM, ready ? 245 : 170);
  drawRect(bx, dy + 8 * k, bw, 5 * k, UI.col(UI.C_BLACK, 190));
  drawRect(bx, dy + 8 * k, bw * (1 - cd), 5 * k, UI.col(ready ? UI.C_INFO : UI.C_DIM, 235));
  if (!MOBILE) UI.drawGlyph(B.ACT_DODGE, x + w - 16 * k - UI.glyphW(B.ACT_DODGE, 22 * k), dy, 22 * k, ready ? 220 : 120);
}

function drawWeapon(sw: number, sh: number, dt: number, k: number): void {
  const w = WPN.currentWeapon();
  const cur = WPN.currentAmmo();
  const res = WPN.currentReserve();
  const mag = WPN.magSize(w);
  if (w !== H[11]) { H[11] = w; H[12] = 0; H[3] = cur; }
  if (cur !== H[3]) { H[3] = cur; H[2] = 0; }
  H[2] = H[2] + dt;
  H[12] = H[12] + dt;

  const pw = 348 * k, ph = 124 * k;
  // On touch the block sits in the gap between the stick's half and the button cluster.
  const x = MOBILE ? (sw - pw) / 2 + 60 * k : sw - 36 * k - pw;
  const y = sh - (MOBILE ? 14 : 36) * k - ph;
  const swapT = UI.easeOut(H[12] / 0.22);
  const empty = cur === 0;

  UI.panel(x, y, pw, ph, 185);
  if (empty && !WPN.isReloading()) UI.nine(A_PANEL_LINE, x, y, pw, ph, 14 * k, UI.C_DANGER, 150 + 100 * Math.sin(H[0] * 9));

  // silhouette (the atlas holds the four in weapon order), sliding in on a swap
  const sw2 = 176 * k, sh3 = 66 * k;
  UI.spr(A_WPN_RIFLE + w, x + 12 * k - (1 - swapT) * 22 * k, y + 12 * k, sw2, sh3, UI.C_BRIGHT, 235 * swapT);
  UI.text(T(STR.S_WPN_0 + w), x + 16 * k, y + ph - 44 * k, 15 * k, UI.C_DIM, 235);

  // MAGAZINE / reserve: the magazine is what you can fire before reloading, the reserve what
  // a reload draws on. The count punches when it changes.
  const punch = 1 + 0.22 * (1 - UI.clamp01(H[2] / 0.12));
  const fs = 46 * k * punch;
  const rx = x + pw - 16 * k;
  const rfs = 20 * k;
  const rtxt = '/ ' + res;
  const rw = UI.textW(rtxt, rfs);
  UI.textR('' + cur, rx - rw - 8 * k, y + 14 * k - (fs - 46 * k) * 0.5, fs, empty ? UI.C_DANGER : UI.C_BRIGHT, 255);
  UI.text(rtxt, rx - rw, y + 40 * k, rfs, res === 0 ? UI.C_DANGER : UI.C_DIM, 240);

  // the magazine as pips (one pip is several rounds on a 120-round belt)
  const per = Math.ceil(mag / 30);
  const n = Math.ceil(mag / per);
  const rowW = pw - 32 * k;
  const gapP = n > 12 ? 2 * k : 5 * k;
  let pipW = (rowW - gapP * (n - 1)) / n;
  if (pipW > 22 * k) pipW = 22 * k;
  const pipH = 17 * k;
  const py = y + ph - 24 * k;
  const full = Math.ceil(cur / per);
  const reloading = WPN.isReloading();
  const fillTo = reloading ? Math.floor(WPN.reloadProgress() * n) : full;
  for (let i = 0; i < n; i++) {
    const px = x + 16 * k + i * (pipW + gapP);
    if (i < fillTo) UI.spr(A_PIP, px, py, pipW, pipH, reloading ? UI.C_INFO : UI.C_ACCENT, 245);
    else UI.spr(A_PIP, px, py, pipW, pipH, UI.C_LINE, 110);
  }

  // The four weapon slots above the block: which you hold, which you own, which are locked.
  const NS = WPN.WEAPON_COUNT;
  const slW = 50 * k, slH = 28 * k, slG = 5 * k;
  const sy = y - slH - 8 * k;
  for (let i = 0; i < NS; i++) {
    const sx = x + pw - (NS - i) * slW - (NS - 1 - i) * slG;
    const own = WPN.isUnlocked(i);
    const on = i === w;
    UI.nine(A_PANEL, sx, sy, slW, slH, 9 * k, on ? UI.C_ACCENT : UI.C_PANEL, UI.panelA(on ? 235 : 160));
    if (own) UI.spr(A_WPN_RIFLE + i, sx + 6 * k, sy + 5 * k, slW - 12 * k, slH - 10 * k, on ? UI.C_PANEL : UI.C_TEXT, on ? 255 : 190);
    else UI.spr(A_LOCK, sx + (slW - 18 * k) / 2, sy + 6 * k, 18 * k, 18 * k, UI.C_DIM, 170);
  }

  // Grenades and the two prompts, to the left of the slots: icons and glyphs, no sentence.
  const gy = sy + 2 * k;
  const gh = 26 * k;
  let gx = x + pw - NS * slW - (NS - 1) * slG - 18 * k;
  if (!MOBILE) {
    // strike
    gx = gx - UI.glyphW(B.ACT_MELEE, gh);
    UI.drawGlyph(B.ACT_MELEE, gx, gy, gh, 215);
    gx = gx - 26 * k;
    UI.spr(A_BUTT, gx, gy + 2 * k, 22 * k, 22 * k, UI.C_TEXT, 215);
    gx = gx - 20 * k;
    // grenade key
    gx = gx - UI.glyphW(B.ACT_GRENADE, gh);
    UI.drawGlyph(B.ACT_GRENADE, gx, gy, gh, GS.grenades > 0 ? 215 : 110);
    gx = gx - 8 * k;
  }
  for (let g = GS.grenadeMax - 1; g >= 0; g--) {
    gx = gx - 20 * k;
    const have = g < GS.grenades;
    UI.spr(A_GRENADE, gx, gy + 1 * k, 22 * k, 22 * k, have ? UI.C_ACCENT : UI.C_LINE, have ? 245 : 120);
  }
  // reload / swap prompts to the left of the block on desktop, dimmed unless they matter
  if (!MOBILE) {
    const hy = y + ph - 26 * k;
    const hh = 22 * k;
    let hx = x - 16 * k;
    hx = UI.promptR(B.ACT_SWAP, T(STR.S_SWAP), hx, hy, hh, UI.C_DIM, 190) - 18 * k;
    UI.promptR(B.ACT_RELOAD, T(STR.S_RELOAD), hx, hy, hh, cur < mag ? UI.C_TEXT : UI.C_DIM, cur < mag ? 235 : 150);
  }
}

/// The boss's name, health and phase, along the bottom, while one is alive.
function drawBoss(sw: number, sh: number, k: number): void {
  if (BOSS[0] === 0) return;
  const f = bossHealth();
  if (f <= 0) return;
  const w = 620 * k < sw * 0.5 ? 620 * k : sw * 0.5;
  const x = (sw - w) / 2;
  const y = sh - 108 * k;
  const h = 14 * k;
  UI.textCS(KIND_NAME[7], sw / 2, y - 30 * k, 22 * k, UI.C_BRIGHT, 245);
  drawRect(x - 2, y - 2, w + 4, h + 4, UI.col(UI.C_BLACK, 190));
  drawRect(x, y, w * f, h, UI.col(BOSS[0] >= 3 ? UI.C_DANGER : UI.C_ACCENT, 245));
  // the two thresholds where it changes: marks ON the bar, so the next one can be seen coming
  drawRect(x + w * 0.33 - 1, y - 3, 2, h + 6, UI.col(UI.C_BRIGHT, 220));
  drawRect(x + w * 0.66 - 1, y - 3, 2, h + 6, UI.col(UI.C_BRIGHT, 220));
  if (BOSS[6] > 0) {
    UI.textCS(fmt(STR.S_BOSS_PHASE, '' + BOSS[0]), sw / 2, y - 62 * k, 26 * k, UI.C_DANGER, 255 * UI.clamp01(BOSS[6] / 0.6));
  }
}

/// Wave start, wave cleared, weapon unlocked: the three things announced mid-screen.
function drawBanners(sw: number, sh: number, dt: number, k: number): void {
  const cx = sw / 2;
  if (H[4] > 0) {
    H[4] = H[4] - dt;
    const life = 2.6;
    const t = 1 - H[4] / life;
    const tin = UI.easeOut(t / 0.12);
    const tout = UI.clamp01(H[4] / 0.4);
    const a = 255 * tin * tout;
    const y = sh * 0.24;
    const bandW = sw * 0.62 * tin;
    UI.spr(A_FADE_H, cx - bandW / 2, y - 10 * k, bandW, 92 * k, UI.C_BLACK, UI.panelA(150) * tin * tout);
    UI.spr(A_FADE_H, cx - bandW / 2, y - 12 * k, bandW, 2, UI.C_ACCENT, a);
    UI.spr(A_FADE_H, cx - bandW / 2, y + 82 * k, bandW, 2, UI.C_ACCENT, a);
    const txt = fmt(STR.S_WAVE_N, '' + H[5]);
    UI.textCS(txt, cx + (1 - tin) * 60 * k, y, 58 * k, UI.C_BRIGHT, a);
    const wty = H[5] >= 1 && H[5] <= wavePlan.length ? W.WAVE_TYPE[H[5] - 1] : 0;
    const bossWave = W.ARENA_INDEX === 4 && H[5] === wavePlan.length;
    const what = bossWave ? STR.S_OBJ_BOSS : (wty === W.WAVE_HOLD && W.HOLD_SITE[4] === 1 ? STR.S_OBJ_HOLD_LONG
      : (wty === W.WAVE_NESTS && NEST_N > 0 ? STR.S_OBJ_NESTS_LONG : STR.S_OBJECTIVE));
    UI.textCS(T(what), cx - (1 - tin) * 60 * k, y + 58 * k, 17 * k, UI.C_ACCENT, a);
  }

  // SH-041 - the end-of-wave card: what the wave EARNED, which is what turns "I survived"
  // into "I could have done that better".
  if (GS.waveBonusT > 0 && !DIR.gameWon) {
    const tin = UI.easeBack(UI.clamp01((4.0 - GS.waveBonusT) / 0.3));
    const a = 255 * UI.clamp01(GS.waveBonusT / 0.5);
    const w = 420 * k, h = 150 * k;
    const x = cx - w / 2;
    const y = sh * 0.23 + (1 - tin) * 26 * k;
    UI.panel(x, y, w, h, 215 * a / 255);
    UI.textC(fmt(STR.S_WAVE_CLEAR, '' + DIR.waveIdx), cx, y + 12 * k, 27 * k, UI.C_GOOD, a);
    drawRect(x + 24 * k, y + 50 * k, w - 48 * k, 1, UI.col(UI.C_LINE, a * 0.6));
    const acc = Math.round(SCORE.accuracy() * 100);
    UI.text(T(STR.S_KILLS), x + 28 * k, y + 60 * k, 17 * k, UI.C_DIM, a);
    UI.textR('' + SCORE.waveKills(), x + w - 28 * k, y + 58 * k, 20 * k, UI.C_BRIGHT, a);
    UI.text(T(STR.S_ACCURACY), x + 28 * k, y + 86 * k, 17 * k, UI.C_DIM, a);
    UI.textR('' + acc + '%', x + w - 28 * k, y + 84 * k, 20 * k, UI.C_BRIGHT, a);
    UI.text(T(STR.S_BONUS), x + 28 * k, y + 112 * k, 17 * k, UI.C_DIM, a);
    UI.textR('+' + GS.waveBonus, x + w - 28 * k, y + 110 * k, 20 * k, UI.C_ACCENT, a);
  }

  if (GS.unlockBannerT > 0 && currentMenu() === MENU_NONE) {
    const a = 255 * UI.clamp01(GS.unlockBannerT / 1.0);
    const y = sh * 0.17;
    const w = 300 * k, h = 112 * k;
    UI.spr(A_SOFT, cx - w, y - h * 0.6, w * 2, h * 2.2, UI.C_ACCENT, a * 0.22);
    UI.spr(A_WPN_RIFLE + GS.unlockBannerWeapon, cx - w / 2, y, w, h, UI.C_ACCENT, a);
    UI.textCS(fmt(STR.S_UNLOCKED, T(STR.S_WPN_0 + GS.unlockBannerWeapon)), cx, y + h + 6 * k, 30 * k, UI.C_BRIGHT, a);
  }
}

// The gameplay HUD belongs to a RUN - the gate lives here so the call site stays a single
// line. padActive picks the glyph set; the dbg* flags + ptSupported/ptMode mirror main's F5-F9
// render-pass toggles into the developer status line.
export function drawHud(sw: number, sh: number, padActive: boolean,
                        dbgSsgi: boolean, dbgSsao: boolean,
                        dbgSsr: boolean, dbgShadow: boolean,
                        ptSupported: boolean, ptMode: number): void {
  const now = getTime();
  let dt = now - H[0];
  H[0] = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;
  UI.setPadGlyphs(padActive);
  if (GS.gameState !== 1) return;
  // Sizes are authored for the desktop's 1080-unit-tall space; a phone's logical space is
  // about 460 tall, so everything is drawn smaller there (and laid out round the thumbs).
  const k = MOBILE ? 0.62 : 1;
  // A paused run keeps its HUD; the end of one clears the screen for the results.
  const ended = GS.gameOver || DIR.gameWon;

  drawThreats(sw, sh, k);
  if (!ended) drawCrosshair(sw, sh, k);
  if (!ended) {
    drawTop(sw, sh, k);
    drawScore(sw, sh, k);
    drawHealth(sw, sh, dt, k);
    drawWeapon(sw, sh, dt, k);
  }
  drawBanners(sw, sh, dt, k);
  if (!ended) drawBoss(sw, sh, k);
  if (!ended && currentMenu() === MENU_NONE) TUTOR.drawTutor(sw, sh, k);

  // Render-pass debug status line (F1): no function keys on a phone, so not there.
  if (!MOBILE && GS.debugHud) {
    const dbgLine = 'F5 SSGI ' + (dbgSsgi ? 'ON ' : 'off')
      + '   F6 SSAO ' + (dbgSsao ? 'ON ' : 'off')
      + '   F7 SSR ' + (dbgSsr ? 'ON ' : 'off')
      + '   F8 SHADOW ' + (dbgShadow ? 'ON ' : 'off')
      // The vN suffix is a build tag: bump it with each PT engine drop
      // so a stale main.exe is identifiable at a glance in the HUD.
      + '   F9 PT ' + (!ptSupported ? 'n/a' : (ptMode === 0 ? 'off' : (ptMode === 1 ? 'PROG' : 'RT'))) + ' v11';
    drawRect(6, 130, 760, 30, { r: 0, g: 0, b: 0, a: 170 });
    UI.text(dbgLine, 14, 136, 18, UI.C_ACCENT, 255);
  }

  updateAndDrawCaptions(sw, sh, dt, k);
}

// The moment a run ends, before the results screen takes over (main opens it a couple of
// seconds later, so a death is watched, not cut away from): the verdict fades up over a
// darkening picture.
export function drawOverlays(sw: number, sh: number): void {
  const ended = GS.gameOver || DIR.gameWon;
  if (!ended) { H[17] = 0; return; }
  if (currentMenu() !== MENU_NONE) return;
  H[17] = H[17] + 0.016;
  const k = MOBILE ? 0.62 : 1;
  const t = UI.clamp01(H[17] / 1.2);
  drawRect(0, 0, sw, sh, UI.col(UI.C_BLACK, 120 * t));
  const won = DIR.gameWon;
  const msg = T(won ? STR.S_ARENA_CLEARED : STR.S_YOU_DIED);
  const s = 70 * k * (0.86 + 0.14 * UI.easeOut(t));
  UI.textCS(msg, sw / 2, sh * 0.36, s, won ? UI.C_GOOD : UI.C_DANGER, 255 * t);
  UI.spr(A_FADE_H, sw * 0.2, sh * 0.36 + s * 1.3, sw * 0.6, 3, won ? UI.C_GOOD : UI.C_DANGER, 220 * t);
}

/// The arena-change cover / notice. Its own call, AFTER drawMenu(), because the LOADING cover
/// has to hide the menu the choice was made in.
export function drawArenaNotice(sw: number, sh: number): void {
  // SH-040 - an arena was chosen. Normally the game relaunches into it behind a full-screen
  // LOADING cover (mode 1). Where the OS does not let an app relaunch itself (mode 2) say
  // what to do, plainly.
  const k = MOBILE ? 0.62 : 1;
  if (GS.levelChangeT > 0 && GS.levelChangeMode === 1) {
    drawRect(0, 0, sw, sh, { r: 6, g: 7, b: 10, a: 255 });
    const es = 150 * k;
    UI.spr(A_EMBLEM, (sw - es) / 2, sh * 0.30, es, es, UI.C_ACCENT, 255);
    UI.textC(fmt(STR.S_LOADING, ARENAS[GS.levelChangeArena].name), sw / 2, sh * 0.30 + es + 30 * k, 34 * k, UI.C_BRIGHT, 255);
  } else if (GS.levelChangeT > 0) {
    const a = 255 * UI.clamp01(GS.levelChangeT / 0.5);
    const msg = GS.levelChangeMode === 3
      ? fmt(STR.S_ALREADY_LOADED, ARENAS[GS.levelChangeArena].name)
      : T(STR.S_REOPEN);
    const fs = 22 * k;
    const mw = UI.textW(msg, fs);
    UI.panel((sw - mw) / 2 - 24 * k, sh * 0.12 - 12 * k, mw + 48 * k, fs + 30 * k, 225 * a / 255);
    UI.textC(msg, sw / 2, sh * 0.12, fs, UI.C_ACCENT, a);
  }
}
