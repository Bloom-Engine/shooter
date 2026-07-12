// SH-041 — score, combo, and the end-of-wave report.
//
// The old loop was win-or-die-then-restart with no numbers attached, which is
// a tech demo's loop. Score pressure is the cheapest replayability system an
// arena shooter can have: it gives the player a reason to fight *well* rather
// than merely survive, and a reason to come back.
//
// The combo multiplier is the load-bearing part — it rewards aggression by
// decaying if you hide, so the optimal play is forward.

import { setBestScore, bestScore } from './settings';

// Points per kind (dretch .. tyrant), scaled by the combo multiplier.
const KIND_POINTS = [10, 15, 25, 60, 200];

const COMBO_WINDOW = 4.0;   // seconds without a kill before the combo drops
const COMBO_STEP   = 0.25;  // each kill adds this to the multiplier
const COMBO_MAX    = 5.0;

//   0 score        1 combo multiplier   2 combo timer
//   3 kills        4 shotsFired         5 shotsHit
//   6 waveStart    7 comboPeak          8 waveKills
const S = [0, 1, 0, 0, 0, 0, 0, 1, 0];

export function resetScore(): void {
  S[0] = 0; S[1] = 1; S[2] = 0; S[3] = 0; S[4] = 0; S[5] = 0;
  S[6] = 0; S[7] = 1; S[8] = 0;
}

export function score(): number { return Math.floor(S[0]); }
export function combo(): number { return S[1]; }
export function comboFrac(): number { return S[2] / COMBO_WINDOW; }
export function kills(): number { return S[3]; }
export function shotsFired(): number { return S[4]; }
export function shotsHit(): number { return S[5]; }
export function accuracy(): number {
  return S[4] > 0 ? S[5] / S[4] : 0;
}
export function waveKills(): number { return S[8]; }
export function comboPeak(): number { return S[7]; }

export function noteShot(): void { S[4] = S[4] + 1; }
export function noteHit(): void { S[5] = S[5] + 1; }

/// A kill: bank the points at the current multiplier, then raise it.
export function noteKill(kind: number): number {
  const base = kind >= 0 && kind < 5 ? KIND_POINTS[kind] : 10;
  const gained = base * S[1];
  S[0] = S[0] + gained;
  S[3] = S[3] + 1;
  S[8] = S[8] + 1;
  S[1] = Math.min(COMBO_MAX, S[1] + COMBO_STEP);
  if (S[1] > S[7]) S[7] = S[1];
  S[2] = COMBO_WINDOW;
  return Math.floor(gained);
}

/// Combo decays if you stop killing. This is what makes the multiplier a
/// pressure rather than a free ratchet.
export function updateScore(dt: number): void {
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
