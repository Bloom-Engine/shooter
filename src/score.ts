// SH-041 — score, combo, and the end-of-wave report.
//
// The old loop was win-or-die-then-restart with no numbers attached, which is
// a tech demo's loop. Score pressure is the cheapest replayability system an
// arena shooter can have: it gives the player a reason to fight *well* rather
// than merely survive, and a reason to come back.
//
// The combo multiplier is the load-bearing part — it rewards aggression by
// decaying if you hide, so the optimal play is forward.

import { setBestScore, bestScore, get, SET_DIFFICULTY } from './settings';

// Points per kind, in enemies.ts kind order (skitter, stalker, ravager,
// bruiser, colossus, spitter, bombard), scaled by the combo
// multiplier. The two SH-042 upgrade kinds are RANGED and tougher than their
// base classes — they pay ~1.5x. (This table sat at 5 entries for a while,
// so both adv kinds fell to the 10-point fallback: less than a mantis.)
const KIND_POINTS = [10, 15, 25, 60, 200, 40, 90, 1500];   // the last is the boss

const COMBO_WINDOW = 4.0;   // seconds without a kill before the combo drops
const COMBO_STEP   = 0.25;  // each kill adds this to the multiplier
const COMBO_MAX    = 5.0;

//   0 score        1 combo multiplier   2 combo timer
//   3 kills        4 shotsFired         5 shotsHit
//   6 waveStart    7 comboPeak          8 waveKills
//   9 critical hits  10 damage taken  11 kill-marker timer  12 points of the last kill
//   13 its pop-up timer  14 kind of the last kill
const S = [0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
// Kills per kind, for the results screen.
const KK = [0, 0, 0, 0, 0, 0, 0, 0];

// Plan 4.3 - difficulty. One place for the three multipliers, so the settings row, the
// director and the score agree: easy is forgiving and pays less, hard the reverse.
//                      easy  normal hard
const DIFF_DAMAGE   = [0.6,  1.0,   1.5];    // damage the player takes
const DIFF_HEALTH   = [0.8,  1.0,   1.3];    // creature health
const DIFF_SCORE    = [0.7,  1.0,   1.4];    // points per kill
function diff(): number {
  const d = get(SET_DIFFICULTY);
  if (d === 0) return 0;
  if (d === 2) return 2;
  return 1;
}
export function diffDamageMul(): number { return DIFF_DAMAGE[diff()]; }
export function diffHealthMul(): number { return DIFF_HEALTH[diff()]; }

export function crits(): number { return S[9]; }
export function damageTaken(): number { return Math.round(S[10]); }
export function killFlash(): number { return S[11]; }
export function lastGain(): number { return S[12]; }
export function lastGainT(): number { return S[13]; }
export function killsOfKind(k: number): number { return k >= 0 && k < 8 ? KK[k] : 0; }
export function noteCrit(): void { S[9] = S[9] + 1; }
export function noteDamage(d: number): void { S[10] = S[10] + d; }

export function resetScore(): void {
  S[0] = 0; S[1] = 1; S[2] = 0; S[3] = 0; S[4] = 0; S[5] = 0;
  S[6] = 0; S[7] = 1; S[8] = 0;
  S[9] = 0; S[10] = 0; S[11] = 0; S[12] = 0; S[13] = 0; S[14] = 0;
  for (let i = 0; i < 8; i++) KK[i] = 0;
}

export function score(): number { return Math.floor(S[0]); }
export function combo(): number { return S[1]; }
export function comboFrac(): number { return S[2] / COMBO_WINDOW; }
export function kills(): number { return S[3]; }
export function shotsFired(): number { return S[4]; }
export function shotsHit(): number { return S[5]; }
export function accuracy(): number {
  if (S[4] > 0) return S[5] / S[4];
  return 0;
}
export function waveKills(): number { return S[8]; }
export function comboPeak(): number { return S[7]; }

export function noteShot(): void { S[4] = S[4] + 1; }
export function noteHit(): void { S[5] = S[5] + 1; }

/// A kill: bank the points at the current multiplier, then raise it.
export function noteKill(kind: number): number { return noteKillMul(kind, 1); }

/// The same with a multiplier on the points (an elite pays ELITE_SCORE times its kind).
export function noteKillMul(kind: number, mul: number): number {
  const base = kind >= 0 && kind < 8 ? KIND_POINTS[kind] : 10;
  const gained = base * mul * S[1] * DIFF_SCORE[diff()];
  if (kind >= 0 && kind < 8) KK[kind] = KK[kind] + 1;
  S[11] = 0.5; S[12] = Math.floor(gained); S[13] = 1.1; S[14] = kind;
  S[0] = S[0] + gained;
  S[3] = S[3] + 1;
  S[8] = S[8] + 1;
  S[1] = Math.min(COMBO_MAX, S[1] + COMBO_STEP);
  if (S[1] > S[7]) S[7] = S[1];
  S[2] = COMBO_WINDOW;
  return Math.floor(gained);
}

/// Points that are not a kill (an objective completed, a nest destroyed): scaled by the
/// difficulty, shown by the same pop-up, and they do not touch the combo.
export function addPoints(n: number): void {
  const gained = Math.floor(n * DIFF_SCORE[diff()]);
  S[0] = S[0] + gained;
  S[12] = gained; S[13] = 1.4;
}

/// Combo decays if you stop killing. This is what makes the multiplier a
/// pressure rather than a free ratchet.
export function updateScore(dt: number): void {
  if (S[11] > 0) S[11] = S[11] - dt;
  if (S[13] > 0) S[13] = S[13] - dt;
  if (S[2] > 0) {
    S[2] = S[2] - dt;
    if (S[2] <= 0) {
      S[2] = 0;
      S[1] = 1;
    }
  }
}

export function beginWave(elapsed: number): void {
  S[6] = elapsed;
  S[8] = 0;
}

/// Seconds the current wave has been running.
export function waveTime(elapsed: number): number { return elapsed - S[6]; }

/// Bank the wave: a time bonus for clearing fast, an accuracy bonus for
/// clearing cleanly.
export function endWave(elapsed: number): number {
  const t = elapsed - S[6];
  const timeBonus = Math.max(0, Math.floor(500 - t * 10));
  const accBonus = Math.floor(accuracy() * 300);
  S[0] = S[0] + timeBonus + accBonus;
  return timeBonus + accBonus;
}

/// Persist the run. Returns true if it was a new best for this arena.
export function commitRun(arena: number): boolean {
  const s = score();
  const prev = bestScore(arena);
  if (s > prev) {
    setBestScore(arena, s);
    return true;
  }
  return false;
}
