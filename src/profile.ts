// Plan Phase 6 (SH-060) - the profile: what a player keeps between runs.
//
// settings.json says how the game is set up; profile.json says what has been EARNED: credits,
// weapon upgrades, stars per arena, lifetime numbers, and which hints have been shown. It is a
// separate file so that resetting progress never touches a control scheme, and the other way
// round. (The per-arena best score and the weapon unlock mask stay in settings.json, where
// they have been since SH-041: moving them would orphan every existing file.)
//
// The file carries a version (`v`). Loading an older one fills what it lacks from defaults;
// a missing or damaged file is a first run. One profile, no slots.
//
// Perry rules: parse once at load, serialise by hand, flat arrays, literal keys, no throw.

import { readFile, writeFile, fileExists } from 'bloom/core';
import { bestScore } from './settings';

const PATH = 'profile.json';
const FILE_VERSION = 1;

export const WEAPONS = 4;
// Upgrade tracks, per weapon.
export const T_DAMAGE = 0;
export const T_MAG = 1;
export const T_RELOAD = 2;
export const T_PERK = 3;
export const TRACKS = 4;
const TRACK_MAX = [3, 3, 3, 1];
// What a level costs: tracks by level bought (1st, 2nd, 3rd); the perk has one price.
const COST = [400, 900, 1600];
const PERK_COST = 2500;
const DAMAGE_STEP = 0.10;                 // +10% per level
const RELOAD_STEP = 0.10;                 // -10% per level
const MAG_STEP = [5, 3, 20, 1];           // rounds per level: rifle, blaster, chaingun, cannon

// Stars an arena needs before it opens (the sum over every arena), by arena order.
const ARENA_NEED = [0, 1, 3, 5, 7, 9, 11, 13];
const MAX_ARENAS = 8;

//   0 credits   1 runs   2 wins   3 kills   4 seconds played   5 shots   6 hits
//   7 critical hits   8 best combo   9 deaths   10 hints shown (bit mask)
//   11 1 = the tutorial has been played or skipped   12 elites killed
//   13 credits earned in all   14 objectives completed
const P = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
const KK = [0, 0, 0, 0, 0, 0, 0];
const stars = new Array<number>(MAX_ARENAS);
const upg = new Array<number>(WEAPONS * TRACKS);
// What the last committed run earned, for the results screen: 0 credits, 1 stars, 2 1 = one or
// more of those stars were new.
const LAST = [0, 0, 0];

function defaults(): void {
  for (let i = 0; i < 15; i++) P[i] = 0;
  P[8] = 1;
  for (let i = 0; i < 7; i++) KK[i] = 0;
  for (let i = 0; i < MAX_ARENAS; i++) stars[i] = 0;
  for (let i = 0; i < WEAPONS * TRACKS; i++) upg[i] = 0;
  LAST[0] = 0; LAST[1] = 0; LAST[2] = 0;
}

function num(o: any, key: string, fallback: number): number {
  if (o === null || o === undefined) return fallback;
  const v = o[key];
  if (v === undefined || v === null) return fallback;
  const n = v as number;
  if (n !== n) return fallback;
  return n;
}

export function loadProfile(): void {
  defaults();
  if (!fileExists(PATH)) {
    // No profile yet. Someone who played before Phase 6 has best scores in settings.json: an
    // arena they scored in counts as one star, so nothing they could reach is locked again.
    for (let i = 0; i < MAX_ARENAS; i++) if (bestScore(i) > 0) stars[i] = 1;
    return;
  }
  let text = readFile(PATH);
  if (text === null || text === undefined || text.length < 2) return;
  // The same vetting as settings.ts: JSON.parse on a damaged file aborts the process.
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
  if (text.charCodeAt(0) !== 0x7b || text.charCodeAt(text.length - 1) !== 0x7d) return;
  const o: any = JSON.parse(text);
  if (o === null || o === undefined) return;

  P[0] = num(o, 'credits', 0);
  const st: any = o['stats'];
  P[1] = num(st, 'runs', 0);
  P[2] = num(st, 'wins', 0);
  P[3] = num(st, 'kills', 0);
  P[4] = num(st, 'seconds', 0);
  P[5] = num(st, 'shots', 0);
  P[6] = num(st, 'hits', 0);
  P[7] = num(st, 'crits', 0);
  P[8] = num(st, 'bestCombo', 1);
  P[9] = num(st, 'deaths', 0);
  P[12] = num(st, 'elites', 0);
  P[13] = num(st, 'earned', 0);
  P[14] = num(st, 'objectives', 0);
  for (let i = 0; i < 7; i++) KK[i] = num(st, 'kind' + i, 0);
  P[10] = num(o, 'hints', 0);
  P[11] = num(o, 'tutorial', 0);
  const sr: any = o['stars'];
  for (let i = 0; i < MAX_ARENAS; i++) {
    let s = Math.floor(num(sr, 'a' + i, 0));
    if (!(s >= 0)) s = 0;
    if (s > 3) s = 3;
    stars[i] = s;
  }
  const up: any = o['upgrades'];
  for (let w = 0; w < WEAPONS; w++) {
    for (let t = 0; t < TRACKS; t++) {
      let l = Math.floor(num(up, 'w' + w + 't' + t, 0));
      if (!(l >= 0)) l = 0;
      if (l > TRACK_MAX[t]) l = TRACK_MAX[t];
      upg[w * TRACKS + t] = l;
    }
  }
  if (!(P[0] >= 0)) P[0] = 0;
}

export function saveProfile(): void {
  let s = '{\n  "v": ' + FILE_VERSION + ',\n  "credits": ' + Math.floor(P[0])
        + ',\n  "hints": ' + P[10] + ',\n  "tutorial": ' + P[11] + ',\n';
  s = s + '  "stats": { "runs": ' + P[1] + ', "wins": ' + P[2] + ', "kills": ' + P[3]
        + ', "seconds": ' + Math.floor(P[4]) + ', "shots": ' + P[5] + ', "hits": ' + P[6]
        + ', "crits": ' + P[7] + ', "bestCombo": ' + P[8] + ', "deaths": ' + P[9]
        + ', "elites": ' + P[12] + ', "earned": ' + Math.floor(P[13]) + ', "objectives": ' + P[14];
  for (let i = 0; i < 7; i++) s = s + ', "kind' + i + '": ' + KK[i];
  s = s + ' },\n  "stars": { ';
  for (let i = 0; i < MAX_ARENAS; i++) s = s + (i > 0 ? ', ' : '') + '"a' + i + '": ' + stars[i];
  s = s + ' },\n  "upgrades": { ';
  for (let w = 0; w < WEAPONS; w++) {
    for (let t = 0; t < TRACKS; t++) {
      s = s + (w + t > 0 ? ', ' : '') + '"w' + w + 't' + t + '": ' + upg[w * TRACKS + t];
    }
  }
  s = s + ' }\n}\n';
  writeFile(PATH, s);
}

/// Wipe what was earned (the settings file is not touched).
export function resetProfile(): void {
  defaults();
  saveProfile();
}

// ---- credits and upgrades ---------------------------------------------------------------
export function credits(): number { return Math.floor(P[0]); }
export function upgLevel(w: number, t: number): number { return upg[w * TRACKS + t]; }
export function upgMax(t: number): number { return TRACK_MAX[t]; }
/// What the next level of a track costs; 0 when there is none left to buy.
export function upgCost(w: number, t: number): number {
  const l = upg[w * TRACKS + t];
  if (l >= TRACK_MAX[t]) return 0;
  return t === T_PERK ? PERK_COST : COST[l];
}
export function buyUpgrade(w: number, t: number): boolean {
  const c = upgCost(w, t);
  if (c <= 0 || P[0] < c) return false;
  P[0] = P[0] - c;
  upg[w * TRACKS + t] = upg[w * TRACKS + t] + 1;
  saveProfile();
  return true;
}
export function damageMul(w: number): number { return 1 + DAMAGE_STEP * upg[w * TRACKS + T_DAMAGE]; }
export function reloadMul(w: number): number { return 1 - RELOAD_STEP * upg[w * TRACKS + T_RELOAD]; }
export function magBonus(w: number): number { return MAG_STEP[w] * upg[w * TRACKS + T_MAG]; }
export function hasPerk(w: number): boolean { return upg[w * TRACKS + T_PERK] > 0; }

// ---- stars and arenas ---------------------------------------------------------------------
export function arenaStars(a: number): number { return a >= 0 && a < MAX_ARENAS ? stars[a] : 0; }
export function totalStars(): number {
  let n = 0;
  for (let i = 0; i < MAX_ARENAS; i++) n = n + stars[i];
  return n;
}
export function arenaNeed(a: number): number { return a >= 0 && a < MAX_ARENAS ? ARENA_NEED[a] : 99; }
export function arenaUnlocked(a: number): boolean { return totalStars() >= arenaNeed(a); }

// ---- hints ----------------------------------------------------------------------------------
export function hintSeen(bit: number): boolean { return (Math.floor(P[10]) & (1 << bit)) !== 0; }
export function markHint(bit: number): void { P[10] = Math.floor(P[10]) | (1 << bit); }
export function tutorialDone(): boolean { return P[11] !== 0; }
export function setTutorialDone(): void { P[11] = 1; saveProfile(); }

// ---- lifetime numbers ---------------------------------------------------------------------
export function statRuns(): number { return P[1]; }
export function statWins(): number { return P[2]; }
export function statKills(): number { return P[3]; }
export function statSeconds(): number { return P[4]; }
export function statAccuracy(): number { return P[5] > 0 ? P[6] / P[5] : 0; }
export function statCrits(): number { return P[7]; }
export function statBestCombo(): number { return P[8]; }
export function statDeaths(): number { return P[9]; }
export function statElites(): number { return P[12]; }
export function statEarned(): number { return Math.floor(P[13]); }
export function statObjectives(): number { return P[14]; }
export function statKind(k: number): number { return k >= 0 && k < 7 ? KK[k] : 0; }
export function noteElite(): void { P[12] = P[12] + 1; }
export function noteObjective(): void { P[14] = P[14] + 1; }

export function lastCredits(): number { return LAST[0]; }
export function lastStars(): number { return LAST[1]; }
export function lastNewStars(): boolean { return LAST[2] === 1; }

/// The stars a won run is worth: clearing it, hitting with half the shots or better, and
/// taking less than `DAMAGE_STAR` damage. (The results screen draws the same three.)
export const DAMAGE_STAR = 220;
export function starsFor(won: boolean, accuracy: number, damageTaken: number): number {
  if (!won) return 0;
  return 1 + (accuracy >= 0.5 ? 1 : 0) + (damageTaken < DAMAGE_STAR ? 1 : 0);
}

/// Bank a finished run: lifetime numbers, stars, and the credits it earned. A tenth of the
/// score, 150 for a win, and 200 for each star this arena did not have before.
export function commitRun(arena: number, won: boolean, score: number, kills: number,
                          seconds: number, shots: number, hits: number, crits: number,
                          comboPeak: number, accuracy: number, damageTaken: number,
                          k0: number, k1: number, k2: number, k3: number, k4: number,
                          k5: number, k6: number): void {
  P[1] = P[1] + 1;
  if (won) P[2] = P[2] + 1; else P[9] = P[9] + 1;
  P[3] = P[3] + kills;
  P[4] = P[4] + seconds;
  P[5] = P[5] + shots;
  P[6] = P[6] + hits;
  P[7] = P[7] + crits;
  if (comboPeak > P[8]) P[8] = comboPeak;
  KK[0] = KK[0] + k0; KK[1] = KK[1] + k1; KK[2] = KK[2] + k2; KK[3] = KK[3] + k3;
  KK[4] = KK[4] + k4; KK[5] = KK[5] + k5; KK[6] = KK[6] + k6;
  const st = starsFor(won, accuracy, damageTaken);
  let fresh = 0;
  if (arena >= 0 && arena < MAX_ARENAS && st > stars[arena]) {
    fresh = st - stars[arena];
    stars[arena] = st;
  }
  const earned = Math.floor(score / 10) + (won ? 150 : 0) + fresh * 200;
  P[0] = P[0] + earned;
  P[13] = P[13] + earned;
  LAST[0] = earned; LAST[1] = st; LAST[2] = fresh > 0 ? 1 : 0;
  saveProfile();
}
