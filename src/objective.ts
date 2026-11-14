// Plan Phase 6 (SH-060) - objectives: the waves that are not "kill everything".
//
//   HOLD   a ring round the arena's generator. Seconds spent inside it are banked; seconds
//          outside drain slowly. The wave's creature list repeats until the bank is full.
//   NESTS  three nests push up out of the ground and breed the wave's list, repeating, until
//          all three are destroyed. A nest is a target like a creature: bullets, bolts and
//          blasts all hurt it.
//
// The director owns WHEN (it starts an objective with the wave and asks whether it is done);
// combat.ts asks whether a shot hit a nest; hud.ts reads OBJ to say what to do. The sites come
// from the world file (`objective` entities, world-runtime.ts).
//
// Perry rules: top-level functions, state in const arrays / one const object, no engine calls
// at module scope.

import {
  vec3, getTime, drawSphere, drawCylinder, drawMeshWithMaterial, drawModelRotated, playSound3D,
} from 'bloom';
import { addPointLight } from 'bloom/scene';
import * as W from './world-runtime';
import { GS } from './gamestate';
import { ENV } from './environment';
import { terrainHeightAt } from './terrain';
import { playerPosition } from './player';
import * as VFX from './vfx';
import * as SCORE from './score';
import * as PROFILE from './profile';

export const OBJ_NONE = 0;
export const OBJ_HOLD = 1;
export const OBJ_NESTS = 2;

/// type: OBJ_*; prog / need: seconds banked and wanted (hold) or nests destroyed and in all;
/// done: this wave's objective is complete; inside: the player stands in the ring; doneT:
/// seconds since it completed (the HUD's confirmation); mdlNest / hasNest and the two sounds
/// are handed over by main.
export const OBJ: any = {
  type: 0, prog: 0, need: 0, done: false, inside: false, doneT: 99,
  mdlNest: 0, hasNest: 0, sfxHit: 0, sfxBurst: 0,
};

const NEST_HP = 420;
const NEST_SCALE = 1.3;       // the model is 2.6 m across; drawn at this
const NEST_R = 1.55;          // the sphere a shot is tested against
const NEST_CY = 0.95;         // its centre above the ground
const HOLD_DRAIN = 0.35;      // banked seconds lost per second outside the ring
const HOLD_BONUS = 400;
const NEST_BONUS = 150;

export const MAX_NESTS = 4;
export const NEST_N = W.NEST_COUNT < MAX_NESTS ? W.NEST_COUNT : MAX_NESTS;
export const nestX = W.NEST_X;
export const nestZ = W.NEST_Z;
export const nestHP = [0, 0, 0, 0];
const nestY = [0, 0, 0, 0];
const nestRise = [0, 0, 0, 0];      // 0 under the ground .. 1 fully up
const nestFlash = [0, 0, 0, 0];
const nestMax = [1];

export function clearObjective(): void {
  OBJ.type = OBJ_NONE; OBJ.prog = 0; OBJ.need = 0; OBJ.done = false; OBJ.inside = false;
  OBJ.doneT = 99;
  for (let i = 0; i < MAX_NESTS; i++) { nestHP[i] = 0; nestRise[i] = 0; nestFlash[i] = 0; }
}

/// A wave begins. `type` is the world's WAVE_* (same numbers as OBJ_*), `param` the seconds a
/// hold needs, `hpMul` the difficulty's creature-health factor (nests take it too).
export function beginObjective(type: number, param: number, hpMul: number): void {
  clearObjective();
  if (type === OBJ_HOLD && W.HOLD_SITE[4] === 1) {
    OBJ.type = OBJ_HOLD; OBJ.need = param > 1 ? param : 30;
  } else if (type === OBJ_NESTS && NEST_N > 0) {
    OBJ.type = OBJ_NESTS; OBJ.need = NEST_N;
    nestMax[0] = NEST_HP * hpMul;
    for (let i = 0; i < NEST_N; i++) {
      nestHP[i] = nestMax[0];
      nestRise[i] = 0;
      nestY[i] = terrainHeightAt(nestX[i], nestZ[i]);
    }
  } else {
    // A world without the site: the wave is an ordinary one.
    OBJ.done = true;
  }
}

/// Is nest i still standing?
export function nestStanding(i: number): boolean {
  return OBJ.type === OBJ_NESTS && i >= 0 && i < NEST_N && nestHP[i] > 0;
}

export function nestsAlive(): number {
  let n = 0;
  for (let i = 0; i < NEST_N; i++) if (nestHP[i] > 0) n = n + 1;
  return n;
}

/// The n-th live nest (wrapping), or -1: where the next creature climbs out.
export function pickNest(n: number): number {
  const alive = nestsAlive();
  if (alive <= 0) return -1;
  let want = n % alive;
  for (let i = 0; i < NEST_N; i++) {
    if (nestHP[i] <= 0) continue;
    if (want === 0) return i;
    want = want - 1;
  }
  return -1;
}

function complete(bonus: number): void {
  OBJ.done = true;
  OBJ.doneT = 0;
  SCORE.addPoints(bonus);
  PROFILE.noteObjective();
}

export function updateObjective(dt: number): void {
  OBJ.doneT = OBJ.doneT + dt;
  if (OBJ.type === OBJ_HOLD) {
    const pp = playerPosition();
    const dx = pp.x - W.HOLD_SITE[0], dz = pp.z - W.HOLD_SITE[2];
    OBJ.inside = dx * dx + dz * dz < W.HOLD_SITE[3] * W.HOLD_SITE[3]
      && Math.abs(pp.y - W.HOLD_SITE[1]) < 4.0;
    if (OBJ.done) return;
    if (OBJ.inside) OBJ.prog = OBJ.prog + dt;
    else OBJ.prog = OBJ.prog - HOLD_DRAIN * dt;
    if (OBJ.prog < 0) OBJ.prog = 0;
    if (OBJ.prog >= OBJ.need) { OBJ.prog = OBJ.need; complete(HOLD_BONUS); }
  } else if (OBJ.type === OBJ_NESTS) {
    for (let i = 0; i < NEST_N; i++) {
      if (nestFlash[i] > 0) nestFlash[i] = nestFlash[i] - dt;
      if (nestHP[i] > 0 && nestRise[i] < 1) {
        nestRise[i] = nestRise[i] + dt / 1.6;
        if (nestRise[i] > 1) nestRise[i] = 1;
      }
    }
    OBJ.prog = NEST_N - nestsAlive();
  }
}

/// Does the ray (unit direction) hit a live nest within maxT? Returns its index and writes the
/// distance to out[0], or -1.
export function rayNests(ox: number, oy: number, oz: number,
                         dx: number, dy: number, dz: number, maxT: number, out: number[]): number {
  if (OBJ.type !== OBJ_NESTS) return -1;
  let best = -1;
  let bestT = maxT;
  for (let i = 0; i < NEST_N; i++) {
    if (nestHP[i] <= 0) continue;
    const r = NEST_R * (0.4 + 0.6 * nestRise[i]);
    const cx = nestX[i] - ox, cy = nestY[i] + NEST_CY * nestRise[i] - oy, cz = nestZ[i] - oz;
    const along = cx * dx + cy * dy + cz * dz;
    if (along < 0) continue;
    const d2 = cx * cx + cy * cy + cz * cz - along * along;
    if (d2 > r * r) continue;
    const t = along - Math.sqrt(r * r - d2);
    if (t >= 0 && t < bestT) { bestT = t; best = i; }
  }
  if (best >= 0) out[0] = bestT;
  return best;
}

export function damageNest(i: number, dmg: number, hx: number, hy: number, hz: number): void {
  if (i < 0 || i >= NEST_N || nestHP[i] <= 0 || OBJ.type !== OBJ_NESTS) return;
  nestHP[i] = nestHP[i] - dmg;
  nestFlash[i] = 0.12;
  GS.hitMarkT = 0.18;
  GS.hitMarkCrit = 0;
  VFX.emitImpactFlesh(hx, hy, hz, 0, 1, 0, 150, 210, 60, nestY[i] + 0.02, Math.random() * 6.28);
  if (OBJ.sfxHit !== 0) playSound3D(OBJ.sfxHit, hx, hy, hz);
  if (nestHP[i] > 0) return;
  nestHP[i] = 0;
  const y = nestY[i] + NEST_CY;
  VFX.emitDeathBurst(nestX[i], y, nestZ[i], 150, 210, 60, 2.2);
  VFX.emitExplosion(nestX[i], y, nestZ[i], nestY[i] + 0.02);
  if (OBJ.sfxBurst !== 0) playSound3D(OBJ.sfxBurst, nestX[i], y, nestZ[i]);
  SCORE.addPoints(NEST_BONUS);
  OBJ.prog = NEST_N - nestsAlive();
  if (nestsAlive() === 0 && !OBJ.done) complete(HOLD_BONUS);
}

/// A blast at (x, y, z): every nest inside the radius takes its share.
export function blastNests(x: number, y: number, z: number, radius: number, dmg: number): void {
  if (OBJ.type !== OBJ_NESTS) return;
  for (let i = 0; i < NEST_N; i++) {
    if (nestHP[i] <= 0) continue;
    const dx = nestX[i] - x, dz = nestZ[i] - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > radius + NEST_R) continue;
    const fall = 1 - Math.max(0, d - NEST_R) / radius;
    damageNest(i, Math.max(1, Math.floor(dmg * fall)), nestX[i], nestY[i] + NEST_CY, nestZ[i]);
  }
}

const WHITE = { r: 255, g: 255, b: 255, a: 255 };

/// The world-space part: the ring and its beacon, the nests. Called inside the 3D pass.
export function drawObjective(): void {
  const t = getTime();
  if (OBJ.type === OBJ_HOLD && ENV.matMuzzleFlash > 0) {
    const cx = W.HOLD_SITE[0], cz = W.HOLD_SITE[2], r = W.HOLD_SITE[3];
    const frac = OBJ.need > 0 ? OBJ.prog / OBJ.need : 1;
    // A ring of marker stakes: a dark post with a lamp on top, every 30 degrees. Solid
    // geometry, because the additive glow card (its shader is one warm colour, and faint in
    // daylight) cannot carry this on its own; the card rides on each lamp for dusk. The lamps
    // turn green clockwise from north as the seconds are banked.
    const N = 12;
    const pulse = 0.75 + 0.25 * Math.sin(t * 4.0);
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2;
      const x = cx + Math.sin(a) * r, z = cz - Math.cos(a) * r;
      if (W.keepOutBuilding(x, z, 0.3)) continue;        // no stake inside a wall
      const y = terrainHeightAt(x, z);
      const filled = OBJ.done || i / N < frac;
      const col = filled ? { r: 70, g: 255, b: 120, a: 255 }
        : (OBJ.inside ? { r: 255, g: 225, b: 110, a: 255 } : { r: 255, g: 120, b: 30, a: 255 });
      drawCylinder(vec3(x, y, z), 0.045, 0.06, 1.45, { r: 38, g: 40, b: 44, a: 255 });
      drawSphere(vec3(x, y + 1.55, z), 0.17, col);
      drawMeshWithMaterial(ENV.matMuzzleFlash, ENV.matMuzzleFlashMesh, vec3(x, y + 1.55, z),
                           0.9, { r: 255, g: 255, b: 255, a: Math.floor((filled ? 110 : 200) * pulse) });
    }
    // A column over the site, so it is found from across the arena.
    if (!OBJ.done) {
      for (let j = 0; j < 6; j++) {
        drawMeshWithMaterial(ENV.matMuzzleFlash, ENV.matMuzzleFlashMesh,
          vec3(cx, W.HOLD_SITE[1] + 2.6 + j * 1.5, cz), 0.5 - j * 0.05,
          { r: 255, g: 190, b: 90, a: Math.floor((150 - j * 18) * pulse) });
      }
    }
    addPointLight(cx, W.HOLD_SITE[1] + 2.2, cz, r + 2,
                  OBJ.inside || OBJ.done ? 0.4 : 1.0, OBJ.inside || OBJ.done ? 1.0 : 0.6,
                  OBJ.inside || OBJ.done ? 0.5 : 0.25, 2.2 * pulse);
  } else if (OBJ.type === OBJ_NESTS) {
    for (let i = 0; i < NEST_N; i++) {
      if (nestHP[i] <= 0) continue;
      const k = nestRise[i];
      const hurt = 1 - nestHP[i] / nestMax[0];
      const throb = 1 + 0.04 * Math.sin(t * 5.0 + i * 2.1) * (1 + hurt);
      const y = nestY[i] - (1 - k) * 1.9;
      const f = nestFlash[i] > 0 ? 1 : 0;
      const tint = f === 1 ? { r: 255, g: 120, b: 100, a: 255 }
        : { r: 255, g: Math.floor(255 - hurt * 70), b: Math.floor(255 - hurt * 90), a: 255 };
      if (OBJ.hasNest === 1) {
        drawModelRotated(OBJ.mdlNest, vec3(nestX[i], y, nestZ[i]), throb * NEST_SCALE, (i * 97) % 360, tint);
      } else {
        drawSphere(vec3(nestX[i], y + NEST_CY, nestZ[i]), NEST_R * throb, { r: 90, g: 60, b: 40, a: 255 });
      }
      const g = 0.6 + 0.4 * Math.sin(t * 3.0 + i);
      if (ENV.matMuzzleFlash > 0) {
        drawMeshWithMaterial(ENV.matMuzzleFlash, ENV.matMuzzleFlashMesh,
          vec3(nestX[i], y + 2.1, nestZ[i]), 0.42, { r: 190, g: 255, b: 90, a: Math.floor(150 * g * k) });
      }
      addPointLight(nestX[i], y + 2.0, nestZ[i], 7, 0.55, 1.0, 0.25, 3.4 * g * k);
    }
  }
}
