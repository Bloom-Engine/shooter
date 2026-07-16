// SH-025d — the player-facing HUD, out of main.ts: the in-run layer
// (crosshair/spread, hit marker, damage vignette + direction arc, HP + dodge,
// score + combo, F5-F9 render-toggle status, weapon/ammo/reload/charge, wave
// banner + report card, unlock banner), the end-of-run overlays, and the run
// summary card they share. Everything here draws in the LOGICAL 2D space main
// establishes (beginMode2DRaw + uiScale on mobile; 1:1 on desktop).
//
// Diagnostics stay in main: the bottom diag bar, the profiler overlay and the
// touch controls all read main's frame-loop state (input, cursorLocked,
// worldStatus, perfOverlayOn) — and the touch controls deliberately draw
// OUTSIDE the scaled camera, in raw pixels.
//
// Perry rules as in the other SH-025 modules: top-level functions only, no
// exported let, no module-scope engine calls.

import { drawRect, drawText, drawCircle, measureText, getTime } from 'bloom';
import { GS } from './gamestate';
import { ARENA_INDEX } from './world-runtime';
import { DIR, wavePlan, countAlive } from './director';
import { PLAYER_HP_MAX } from './combat';
import { dodgeCooldownFrac } from './player';
import { MOBILE } from './input';
import {
  MAX_ENEMIES, KIND_NAME, AI_WINDUP, enAlive, enKind, enAIState,
} from './enemies';
import * as WPN from './weapons';
import * as SCORE from './score';
import * as SET from './settings';

/// SH-043 — telegraph captions. The dragoon's pounce and the tyrant's slam are
/// announced by a ROAR over a rooted wind-up: that roar is the dodge window, and
/// a player who cannot hear it is simply told nothing. The setting has shipped in
/// the menu since SH-038 with no code behind it — this is the code.
///
/// Deliberately only the wind-up states, and only one line: captioning every
/// grunt would train the player to ignore the band. Off by default (SET_CAPTIONS).
function drawTelegraphCaptions(sw: number, sh: number): void {
  if (SET.get(SET.SET_CAPTIONS) === 0) return;
  let kind = -1;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] === 0) continue;
    if (enAIState[i] !== AI_WINDUP) continue;
    kind = enKind[i];
    break;                       // one caption: the first telegraph in flight
  }
  if (kind < 0) return;

  const msg = '[ ' + KIND_NAME[kind] + ' WINDING UP — DODGE ]';
  const s = 20;
  const w = measureText(msg, s);
  const x = (sw - w) / 2;
  const y = sh * 0.72;           // below the crosshair, clear of the HP corner
  drawRect(x - 12, y - 5, w + 24, s + 10, { r: 10, g: 10, b: 14, a: 190 });
  drawText(msg, x, y, s, { r: 255, g: 210, b: 120, a: 255 });
}

/// SH-041 — the run's numbers, shown on both the death and the victory screen.
/// A run with no score attached is a run you can't get better at.
function drawRunSummary(sw: number, y: number): void {
  const cardW = 340;
  const x = (sw - cardW) / 2;
  drawRect(x, y, cardW, 118, { r: 10, g: 10, b: 14, a: 190 });

  const s = SCORE.score();
  const best = SET.bestScore(ARENA_INDEX);
  const isBest = s >= best && s > 0;

  drawText('SCORE', x + 24, y + 12, 17, { r: 190, g: 190, b: 195, a: 220 });
  const st = '' + s;
  const stw = measureText(st, 30);
  drawText(st, x + cardW - 24 - stw, y + 6, 30,
    isBest ? { r: 255, g: 215, b: 110, a: 255 } : { r: 235, g: 235, b: 240, a: 245 });

  drawText('BEST', x + 24, y + 46, 15, { r: 160, g: 160, b: 165, a: 200 });
  const bt = '' + best;
  const btw = measureText(bt, 18);
  drawText(bt, x + cardW - 24 - btw, y + 44, 18, { r: 200, g: 200, b: 205, a: 220 });

  const acc = Math.round(SCORE.accuracy() * 100);
  drawText('KILLS  ' + SCORE.kills() + '    ACCURACY  ' + acc + '%'
           + '    BEST COMBO  x' + SCORE.comboPeak().toFixed(2),
           x + 24, y + 76, 15, { r: 200, g: 200, b: 205, a: 220 });

  if (isBest) {
    const nb = 'NEW BEST';
    drawText(nb, x + 24, y + 96, 15, { r: 255, g: 205, b: 100, a: 245 });
  }
}

// The gameplay HUD belongs to a RUN — the gate lives here so the call site
// stays a single line. On the main menu it used to draw the health bar, the
// ammo readout and the crosshair over a game that had not started, which was
// exactly the tell that a "title screen" was really just the game with the
// input switched off.
//
// padActive drives the control hint; the dbg* flags + ptSupported/ptMode
// mirror main's F5-F9 render-pass toggles into the status line.
export function drawHud(sw: number, sh: number, padActive: boolean,
                        dbgSsgi: boolean, dbgSsao: boolean,
                        dbgSsr: boolean, dbgShadow: boolean,
                        ptSupported: boolean, ptMode: number): void {
  if (GS.gameState !== 1) return;

  // ---- Crosshair (SH-028) ---------------------------------------------------
  // The gap between the arms IS the current spread. A crosshair that doesn't
  // move while your cone triples is lying to the player about where the bullet
  // is going, and it is the reason spread feels "random" instead of earned.
  {
    const spreadDeg = WPN.spreadRad() * 180 / Math.PI;
    const gap = 4 + spreadDeg * 5.5;
    const arm = 7;
    const crossA = GS.muzzleFlashT > 0 ? 250 : 190;
    const col = { r: 255, g: 255, b: 255, a: crossA };
    const cx = sw / 2;
    const cy = sh / 2;
    drawRect(cx - gap - arm, cy - 1, arm, 2, col);
    drawRect(cx + gap,       cy - 1, arm, 2, col);
    drawRect(cx - 1, cy - gap - arm, 2, arm, col);
    drawRect(cx - 1, cy + gap,       2, arm, col);
    drawCircle(cx, cy, 1.5, col);

    // SH-043 — hit confirmation is a white FLASH + a tick, not a colour change:
    // a colourblind player gets the same information as anyone else.
    if (GS.hitMarkT > 0) {
      const ha = Math.floor((GS.hitMarkT / 0.18) * 255);
      const hc = { r: 255, g: 255, b: 255, a: ha };
      const d = 10;
      drawRect(cx - d, cy - d, 6, 2, hc);
      drawRect(cx + d - 6, cy - d, 6, 2, hc);
      drawRect(cx - d, cy + d - 2, 6, 2, hc);
      drawRect(cx + d - 6, cy + d - 2, 6, 2, hc);
    }
  }

  // Damage vignette — red screen edges when the player takes a hit.
  if (GS.damageFlashT > 0) {
    const fa = Math.floor((GS.damageFlashT / 0.5) * 120);
    drawRect(0, 0, sw, 60, { r: 200, g: 20, b: 20, a: fa });
    drawRect(0, sh - 60, sw, 60, { r: 200, g: 20, b: 20, a: fa });
    drawRect(0, 0, 60, sh, { r: 200, g: 20, b: 20, a: fa });
    drawRect(sw - 60, 0, 60, sh, { r: 200, g: 20, b: 20, a: fa });
  }

  // SH-029/SH-043 — damage direction arc. Encodes WHERE the hit came from as
  // a position (a shape you can see), not just a colour you have to interpret.
  if (GS.lastHitT > 0) {
    const a = Math.floor((GS.lastHitT / 1.4) * 200);
    const r = Math.min(sw, sh) * 0.22;
    const cx = sw / 2;
    const cy = sh / 2;
    // Screen-space: +x right, -y up. The angle is relative to where you face.
    const ax = cx + Math.sin(GS.lastHitAngle) * r;
    const ay = cy - Math.cos(GS.lastHitAngle) * r;
    drawCircle(ax, ay, 9, { r: 235, g: 70, b: 55, a: a });
    drawCircle(ax, ay, 4, { r: 255, g: 220, b: 210, a: a });
  }

  // Player HP bar — bottom-left. Low health pulses, so the state is legible
  // without reading the number.
  const phpW = 220;
  const phpFill = Math.max(0, Math.floor(phpW * (GS.playerHP / PLAYER_HP_MAX)));
  const lowT = GS.playerHP < 25 ? (0.6 + 0.4 * Math.sin(getTime() * 9)) : 1;
  drawRect(10, sh - 68, phpW, 18, { r: 30, g: 10, b: 10, a: 180 });
  drawRect(10, sh - 68, phpFill, 18,
    { r: Math.floor(180 * lowT + 60), g: 60, b: 50, a: 230 });
  drawText('HP ' + GS.playerHP, 18, sh - 65, 14, { r: 240, g: 240, b: 240, a: 255 });

  // Dodge cooldown — a thin bar under HP, so you know when you can commit.
  {
    const cd = dodgeCooldownFrac();
    if (cd > 0) {
      drawRect(10, sh - 46, phpW, 4, { r: 20, g: 20, b: 24, a: 160 });
      drawRect(10, sh - 46, phpW * (1 - cd), 4, { r: 120, g: 190, b: 235, a: 220 });
    }
  }

  // ---- Score + combo (SH-041) -----------------------------------------------
  {
    const st = 'SCORE ' + SCORE.score();
    drawText(st, 14, 44, 22, { r: 245, g: 235, b: 195, a: 235 });
    const cmb = SCORE.combo();
    if (cmb > 1.001) {
      const ct = 'x' + cmb.toFixed(2);
      drawText(ct, 14, 70, 26, { r: 255, g: 200, b: 90, a: 255 });
      // The combo's remaining life, as a draining bar — the pressure made
      // visible is what makes players push forward instead of hiding.
      const cw = 90;
      drawRect(14, 100, cw, 4, { r: 30, g: 25, b: 15, a: 180 });
      drawRect(14, 100, cw * SCORE.comboFrac(), 4, { r: 255, g: 190, b: 70, a: 240 });
    }
  }

  // Render-pass debug status line. Top-left, always on — but there are no
  // function keys on a phone, so it's just clutter over the play area there.
  if (!MOBILE) {
    const dbgLine = 'F5 SSGI ' + (dbgSsgi ? 'ON ' : 'off')
      + '   F6 SSAO ' + (dbgSsao ? 'ON ' : 'off')
      + '   F7 SSR ' + (dbgSsr ? 'ON ' : 'off')
      + '   F8 SHADOW ' + (dbgShadow ? 'ON ' : 'off')
      // The vN suffix is a build tag: bump it with each PT engine drop
      // so a stale main.exe is identifiable at a glance in the HUD.
      + '   F9 PT ' + (!ptSupported ? 'n/a' : (ptMode === 0 ? 'off' : (ptMode === 1 ? 'PROG' : 'RT'))) + ' v11';
    drawRect(6, 6, 760, 30, { r: 0, g: 0, b: 0, a: 170 });
    drawText(dbgLine, 14, 12, 18, { r: 255, g: 240, b: 120, a: 255 });
  }

  // ---- Weapon + ammo + reload + charge (SH-028 / SH-042) --------------------
  {
    const w = WPN.currentWeapon();
    const curAmmo = WPN.currentAmmo();
    // MAGAZINE / RESERVE — the standard readout, and now an honest one: the mag
    // is what you can fire before reloading, the reserve is what a reload costs.
    const res = WPN.currentReserve();
    const wtxt = WPN.WEAPON_NAMES[w] + '  ' + curAmmo + ' / ' + res;
    // On touch the ammo readout sits above the fire button rather than in the
    // corner, where the thumb would cover it.
    const wy = MOBILE ? sh - 210 : sh - 68;
    drawRect(sw - 260, wy, 250, 18, { r: 0, g: 0, b: 0, a: 150 });
    // Empty mags read red — the one piece of info you need at a glance.
    const ammoCol = curAmmo === 0
      ? { r: 235, g: 90, b: 70, a: 255 }
      : { r: 240, g: 230, b: 180, a: 255 };
    const hint = MOBILE ? '' : (padActive ? '   [Y switch  X reload]' : '   [1-4 switch  R reload]');
    drawText(wtxt + hint, sw - 252, wy + 3, 13, ammoCol);

    // Reload progress. A timed reload the player cannot SEE is just an
    // unexplained dead trigger; the bar is what turns it into a decision about
    // when to take cover.
    if (WPN.isReloading()) {
      const rp = WPN.reloadProgress();
      drawRect(sw - 260, wy - 12, 250, 8, { r: 25, g: 25, b: 30, a: 200 });
      drawRect(sw - 260, wy - 12, 250 * rp, 8, { r: 120, g: 200, b: 235, a: 240 });
      const rt = 'RELOADING';
      drawText(rt, sw - 260, wy - 32, 15, { r: 190, g: 225, b: 245, a: 230 });
    }

    // Charge meter (cannon). Turns red-hot at full so you can feel the release
    // point without staring at the bar.
    const chg = WPN.chargeLevel();
    if (chg > 0.01) {
      const full = chg > 0.98;
      const bw = 160;
      const cx = sw / 2 - bw / 2;
      const cy = sh / 2 + 44;
      drawRect(cx, cy, bw, 8, { r: 20, g: 20, b: 24, a: 190 });
      drawRect(cx, cy, bw * chg, 8,
        full ? { r: 255, g: 120, b: 60, a: 255 } : { r: 255, g: 210, b: 110, a: 235 });
    }

    // Chaingun spool — the ramp you have to pay before the first round leaves.
    const spool = WPN.spinup();
    if (spool > 0.01 && spool < 0.99) {
      const bw = 120;
      const cx = sw / 2 - bw / 2;
      const cy = sh / 2 + 60;
      drawRect(cx, cy, bw, 5, { r: 20, g: 20, b: 24, a: 180 });
      drawRect(cx, cy, bw * spool, 5, { r: 200, g: 200, b: 210, a: 220 });
    }
  }

  // Wave HUD — top-center. Shows "WAVE X — enemies K/N" while spawning,
  // or a "NEXT WAVE IN ..." countdown between waves.
  const aliveNow = countAlive();
  if (!GS.gameOver && !DIR.gameWon) {
    if (DIR.waveBreakTimer > 0 && DIR.waveIdx < wavePlan.length) {
      const label = 'WAVE ' + (DIR.waveIdx + 1) + ' IN ' + DIR.waveBreakTimer.toFixed(1) + 's';
      const lw = measureText(label, 22);
      drawText(label, (sw - lw) / 2, 18, 22, { r: 230, g: 220, b: 160, a: 230 });
    } else if (DIR.waveIdx < wavePlan.length) {
      const waveSize = wavePlan[DIR.waveIdx];
      const remaining = (waveSize - DIR.waveSpawned) + aliveNow;
      const label = 'WAVE ' + (DIR.waveIdx + 1) + ' — ' + remaining + ' / ' + waveSize;
      const lw = measureText(label, 20);
      drawText(label, (sw - lw) / 2, 18, 20, { r: 230, g: 220, b: 160, a: 230 });
    }
  }

  // SH-041 — end-of-wave report card. Shows what the wave EARNED, which is what
  // turns "I survived" into "I could have done that better".
  if (GS.waveBonusT > 0) {
    const a = Math.min(1, GS.waveBonusT / 0.6);
    const alpha = Math.floor(a * 235);
    const cardY = sh * 0.28;
    const cardW = 320;
    const cardX = (sw - cardW) / 2;
    drawRect(cardX, cardY, cardW, 118, { r: 12, g: 12, b: 16, a: Math.floor(a * 200) });
    const head = 'WAVE ' + DIR.waveIdx + ' CLEAR';
    const hw = measureText(head, 26);
    drawText(head, (sw - hw) / 2, cardY + 10, 26,
      { r: 235, g: 220, b: 150, a: alpha });
    const acc = Math.round(SCORE.accuracy() * 100);
    drawText('KILLS      ' + SCORE.waveKills(), cardX + 24, cardY + 46, 17,
      { r: 220, g: 220, b: 225, a: alpha });
    drawText('ACCURACY   ' + acc + '%', cardX + 24, cardY + 68, 17,
      { r: 220, g: 220, b: 225, a: alpha });
    drawText('BONUS     +' + GS.waveBonus, cardX + 24, cardY + 90, 17,
      { r: 255, g: 205, b: 100, a: alpha });
  }

  // Unlock banner.
  if (GS.unlockBannerT > 0) {
    const a = Math.floor(Math.min(1, GS.unlockBannerT / 1.0) * 245);
    const msg = 'CHAINGUN UNLOCKED';
    const mw = measureText(msg, 30);
    drawText(msg, (sw - mw) / 2, sh * 0.20, 30, { r: 255, g: 215, b: 120, a: a });
  }

  drawTelegraphCaptions(sw, sh);
}

// The end-of-run overlays + the SH-040 level-change notice. Drawn whether or
// not a run is active (the notice can fire from the main menu's level row).
export function drawOverlays(sw: number, sh: number): void {
  // Game over overlay — now with the run's numbers on it.
  if (GS.gameOver) {
    drawRect(0, 0, sw, sh, { r: 0, g: 0, b: 0, a: 170 });
    const msg = 'YOU DIED';
    const mw = measureText(msg, 56);
    drawText(msg, (sw - mw) / 2, sh * 0.30, 56, { r: 220, g: 60, b: 50, a: 255 });
    drawRunSummary(sw, sh * 0.30 + 76);
    const sub = 'Reached wave ' + (DIR.waveIdx + 1)
      + (MOBILE ? ' — tap R to restart' : ' — press R to restart');
    const sww = measureText(sub, 22);
    drawText(sub, (sw - sww) / 2, sh * 0.30 + 210, 22, { r: 220, g: 220, b: 220, a: 230 });
  }

  // Victory overlay.
  if (DIR.gameWon) {
    drawRect(0, 0, sw, sh, { r: 0, g: 0, b: 0, a: 170 });
    const msg = 'ARENA CLEARED';
    const mw = measureText(msg, 52);
    drawText(msg, (sw - mw) / 2, sh * 0.28, 52, { r: 180, g: 230, b: 180, a: 255 });
    drawRunSummary(sw, sh * 0.28 + 72);
    const sub = 'Survived all ' + wavePlan.length + ' waves'
      + (MOBILE ? ' — tap R to play again' : ' — press R to play again');
    const sww = measureText(sub, 22);
    drawText(sub, (sw - sww) / 2, sh * 0.28 + 206, 22, { r: 220, g: 220, b: 220, a: 230 });
  }

  // SH-040 — level chosen, but it loads on the next launch. Say so plainly
  // rather than letting the player wonder why nothing happened.
  if (GS.levelChangeT > 0) {
    const a = Math.floor(Math.min(1, GS.levelChangeT / 0.5) * 240);
    const msg = 'ARENA SET - RESTART THE GAME TO PLAY IT';
    const mw = measureText(msg, 22);
    drawRect((sw - mw) / 2 - 16, sh * 0.16 - 8, mw + 32, 40,
             { r: 10, g: 10, b: 14, a: Math.floor(a * 0.8) });
    drawText(msg, (sw - mw) / 2, sh * 0.16, 22, { r: 255, g: 215, b: 120, a: a });
  }
}
