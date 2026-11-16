// SH-025c — the player's side of the fight, out of main.ts: weapon + combat
// state, the per-frame weapon transform (SH-027), firing (SH-028/033/042),
// the player projectile pool, ammo pickups, the cannon's area damage, and the
// run lifecycle (startRun/resetRun). The enemy side lives in director.ts.
//
// Perry rules this module follows (docs/perry-quirks.md + the SH-025a/b
// lessons in the repo history): every function is top-level (nested function
// declarations kill the process silently at boot); no exported `let` (module
// state that main must reach is exported const arrays/objects, or crosses via
// setCombatDeps); no engine calls at module scope. Capturing W.* at module
// scope is safe — world-runtime parses the world file in its own module body,
// which import order runs before this one.

import {
  vec3, getTime,
  drawSphere, drawMeshWithMaterial, drawModelRotated, drawModelTransform,
  playSound, playSound3D, playMusic, stopMusic,
} from 'bloom';
import { addPointLight } from 'bloom/scene';
import { raycast, Layer } from 'bloom/physics';
import { playSoundEx } from 'bloom/audio';
import { jointWorld } from 'bloom/models';
import * as W from './world-runtime';
import { resetInputToggles, padIsActive, MOBILE } from './input';
import { GS } from './gamestate';
import {
  DIR, damageEnemy, despawnAllEnemies, WAVE_BREAK_DELAY,
  MAX_EPROJ, eX, eY, eZ, eLife, eKind,
  damagePlayer, makeNoise, shoveEnemy, MAX_HEALS, hpX, hpY, hpZ, hpLife,
} from './director';
import {
  MAX_ENEMIES, enAlive, enX, enY, enZ, enKind, K_ADV_DRAGOON,
  KIND_HEIGHT, KIND_TORSO_R, KIND_LIGHT, LOC_BODY, LOC_HEAD, LOC_WEAK, LOC_MUL,
} from './enemies';
import { rayEnemies, nearestAimPoint, setRaySkip } from './hitshapes';
import { playerPosition } from './player';
import { terrainHeightAt } from './terrain';
import { ENV } from './environment';
import { closeMenu } from './menu';
import * as FEEL from './feel';
import * as VFX from './vfx';
import * as WPN from './weapons';
import * as MIX from './audio-mix';
import * as SET from './settings';
import * as SCORE from './score';
import * as OBJECTIVE from './objective';
import * as TUTOR from './tutor';
import * as SFX from './sfx';

const WHITE = { r: 255, g: 255, b: 255, a: 255 };

// main.ts-owned handles this module steers with, handed across ONCE via
// setCombatDeps() before the frame loop (the director.ts DEPS pattern):
// CAM, physics, TP_PITCH_MIN, TP_PITCH_MAX — camera/physics;
// animPlayer, playerHandJoint, PLAYER_SCALE, PLAYER_MODEL_Y_OFFSET — the
// player model the weapon rides; mdlWeapons, WEAPON_MUZZLE_Z,
// WEAPON_DRAW_SCALE — the weapon models and their ABI columns (declared next
// to the loadModel calls in main so they stay in sync with the art);
// sfxFireRifle, sfxFireBlaster, sfxRicochet, sfxPlayerDie, stingDeath,
// sfxFireByWeapon (W_* order), sfxFireRifleB (the rifle's alternate), sfxExplosion,
// musicMenu, musicCalm, musicCombat — audio handles.
const DEPS: any = { o: null };
// RUN[0] = 1 while a run is live this frame (updateCombat's `playing`).
const RUN = [0];
export function setCombatDeps(deps: any): void { DEPS.o = deps; }

// ---- Weapon + combat state (M4 / M5 / M6 / M7) ----------------------------
export const PLAYER_HP_MAX = 100;
const FIRE_RANGE = 60.0;
const STATIC_MASK = 1 << Layer.NON_MOVING;
// Scratch for rayEnemies / nearestAimPoint results.
const HIT = [0, 0, 0, 0, 0];
const MAG = [0, 0, 0, 0];
const REC = [0, 0];
const NH = [0];              // distance to the nest a ray hit (objective.rayNests)
// How far each weapon's report carries (plan 2.1), metres.
const W_NOISE = [45, 30, 50, 35, 50, 55];

// SH-028/SH-042 — weapon state now lives in src/weapons.ts as a stat TABLE, so
// the chaingun and the cannon are rows rather than branches. What stays here is
// only what the world/projectile code needs.
const BLASTER_PROJ_LIFE = 2.5;
const BLASTER_PROJ_GRAVITY = 9.0;   // m/s^2 — lighter than world gravity for a softer arc

const MUZZLE_FLASH_DUR = 0.08;
// Squared distances (camera to pickup, on the ground plane) inside which a pickup's weapon
// and its crate are drawn: 45 m and 80 m. See the pickup loop in the draw function.
const PICKUP_WEAPON_FAR2 = 45 * 45;
const PICKUP_CRATE_FAR2 = 80 * 80;
// SH-027 — the weapon's world transform for this frame. Computed once and used
// by the draw, the muzzle flash, the tracer AND the shot ray, so what you see
// is what you hit.
let weaponX = 0;
let weaponY = 0;
let weaponZ = 0;
let weaponYaw = 0;
// The drawn weapon's barrel (0-2) and up (3-5) directions, world space: see updateWeaponTransform.
const WB = [0, 0, -1, 0, 1, 0];
let weaponPitch = 0;

// ---- Projectile pool (M7) -------------------------------------------------
// Fixed-size ring buffer. Each slot stores position, velocity, and
// remaining life. pLife = 0 means the slot is free. Projectiles advance
// each frame via segment-raycast so they can't tunnel through walls.
const MAX_PROJ = 16;
const pX  = new Array<number>(MAX_PROJ);
const pY  = new Array<number>(MAX_PROJ);
const pZ  = new Array<number>(MAX_PROJ);
const pVX = new Array<number>(MAX_PROJ);
const pVY = new Array<number>(MAX_PROJ);
const pVZ = new Array<number>(MAX_PROJ);
const pLife = new Array<number>(MAX_PROJ);
// SH-042 — which weapon fired it, and (for the cannon) how charged it was.
// The cannon's shot explodes; the blaster's does not, and the projectile has to
// know which it is when it lands.
const pWeapon = new Array<number>(MAX_PROJ);
const pCharge = new Array<number>(MAX_PROJ);
// Plan 2.8 - the blaster's bolt goes through bodies: how many more it may, and the slot it
// last went through (so it does not hit the same creature again on the way out).
const pPierce = new Array<number>(MAX_PROJ);
const pLast = new Array<number>(MAX_PROJ);
for (let i = 0; i < MAX_PROJ; i++) { pLife[i] = 0; pWeapon[i] = 0; pCharge[i] = 0; pPierce[i] = 0; pLast[i] = -1; }

// ---- Plan 2.7: grenades ---------------------------------------------------------------------
// One kind: a two-second fuse, thrown on an arc, bounces off the world. Up to four in the air.
const MAX_NADE = 4;
const NADE_FUSE = 2.0;
const NADE_SPEED = 15.0;
const NADE_GRAVITY = 18.0;
const NADE_RADIUS = 6.0;
const NADE_DAMAGE = 160;
const gX = new Array<number>(MAX_NADE);
const gY = new Array<number>(MAX_NADE);
const gZ = new Array<number>(MAX_NADE);
const gVX = new Array<number>(MAX_NADE);
const gVY = new Array<number>(MAX_NADE);
const gVZ = new Array<number>(MAX_NADE);
const gFuse = new Array<number>(MAX_NADE);
for (let i = 0; i < MAX_NADE; i++) { gX[i] = 0; gY[i] = 0; gZ[i] = 0; gVX[i] = 0; gVY[i] = 0; gVZ[i] = 0; gFuse[i] = 0; }
// ---- Plan 2.7: the rifle-butt strike ---------------------------------------------------------
const MELEE_TIME = 0.46;      // the whole swing
const MELEE_HIT_AT = 0.15;    // when it connects
const MELEE_REACH = 2.2;
const MELEE_DAMAGE = 45;
// K: 0 throw cooldown   1 melee cooldown   2 melee already landed this swing (0/1)
//    3 the swing's current angle factor (-0.4 wound back .. 1 through), read by the draw
const K = [0, 0, 0, 0];
export function meleeSwing(): number { return K[3]; }
let projNext = 0;


function spawnProjectile(x: number, y: number, z: number,
                         vx: number, vy: number, vz: number,
                         weapon: number, charge: number): void {
  pX[projNext] = x; pY[projNext] = y; pZ[projNext] = z;
  pVX[projNext] = vx; pVY[projNext] = vy; pVZ[projNext] = vz;
  pLife[projNext] = BLASTER_PROJ_LIFE;
  pWeapon[projNext] = weapon;
  pCharge[projNext] = charge;
  pPierce[projNext] = WPN.pierceOf(weapon);
  pLast[projNext] = -1;
  projNext = (projNext + 1) % MAX_PROJ;
}

// ---- Ammo pickups (M7) ----------------------------------------------------
// Fixed positions around the arena. Walk within PICKUP_RADIUS to collect;
// respawn after PICKUP_RESPAWN seconds so long runs don't starve for ammo.
// (Collection itself runs in director.ts's update, via the deps main wires.)
export const PICKUP_RIFLE = 0;
const PICKUP_BLASTER = 1;
export const PICKUP_RADIUS = 1.4;
export const PICKUP_RESPAWN = 18.0;
export const pickupKind = W.PICKUP_KIND;      // 0 = rifle, 1 = blaster
export const pickupX    = W.PICKUP_X;
export const pickupY    = W.PICKUP_Y;         // authored floor height
export const pickupZ    = W.PICKUP_Z;
export const PICKUP_COUNT = W.PICKUP_COUNT;
export const pickupActive   = new Array<number>(PICKUP_COUNT);
export const pickupRespawnT = new Array<number>(PICKUP_COUNT);
for (let i = 0; i < PICKUP_COUNT; i++) { pickupActive[i] = 1; pickupRespawnT[i] = 0; }


export function resetRun(): void {
  WPN.resetWeapons();
  // A latched aim/sprint (SH-037 toggle mode) must not survive into the next
  // life — you would respawn already aiming, with nothing held.
  resetInputToggles();
  // Unlocks are persistent progression — they survive a restart, which is the
  // whole point of earning them.
  const mask = SET.unlockMask();
  for (let i = 0; i < WPN.WEAPON_COUNT; i++) {
    if ((mask & (1 << i)) !== 0) WPN.unlock(i);
  }
  GS.playerHP = PLAYER_HP_MAX;
  GS.gameOver = false;
  DIR.gameWon = false;
  GS.muzzleFlashT = 0;
  GS.damageFlashT = 0;
  DIR.waveIdx = 0;
  DIR.waveSpawned = 0;
  DIR.waveBreakTimer = WAVE_BREAK_DELAY;
  DIR.spawnTimer = 0;
  for (let i = 0; i < MAX_PROJ; i++) pLife[i] = 0;
  for (let i = 0; i < MAX_EPROJ; i++) eLife[i] = 0;
  for (let i = 0; i < MAX_NADE; i++) gFuse[i] = 0;
  GS.grenades = 2; GS.sinceHurt = 99; GS.healFlashT = 0; GS.meleeT = -1; GS.hitMarkCrit = 0;
  K[0] = 0; K[1] = 0; K[2] = 0; K[3] = 0;
  WPN.clearRecoil();
  for (let i = 0; i < PICKUP_COUNT; i++) { pickupActive[i] = 1; pickupRespawnT[i] = 0; }
  despawnAllEnemies();
  SCORE.resetScore();
  TUTOR.resetTutor();
  FEEL.resetFeel();
  VFX.resetVfx();     // last run's blood shouldn't greet the new one
  SFX.resetSfx();
  GS.runElapsed = 0;
  SCORE.beginWave(0);
}

/// SH-049 — leave the main menu and drop into the arena. This was inline in the
/// old "press any key" title screen; the main menu's PLAY row calls it now.
///
/// The two selectWeapon() calls look redundant and are not: selecting a second
/// weapon and coming back is what clears any half-finished reload/spool state on
/// the rifle, so the run always starts on a clean, loaded gun.
export function startRun(): void {
  // The main menu is open whenever the game is not running, so leaving it is
  // part of starting. The dormant test harnesses in main start the game by
  // calling this too — without the closeMenu() they would set GS.gameState = 1
  // and then sit there doing nothing, because `playing` is gated on !menuOpen().
  closeMenu();
  GS.gameState = 1;
  stopMusic(DEPS.o.musicMenu);
  playMusic(DEPS.o.musicCalm);
  playMusic(DEPS.o.musicCombat);
  if (DEPS.o.HAS_BOSS_MUSIC) playMusic(DEPS.o.musicBoss);
  WPN.selectWeapon(WPN.W_BLASTER);
  WPN.selectWeapon(WPN.W_RIFLE);
  DIR.waveBreakTimer = WAVE_BREAK_DELAY;   // wave-1 countdown starts fresh
  SCORE.resetScore();
  TUTOR.resetTutor();
  GS.runElapsed = 0;
}

/// SH-042 — the cannon's area damage. Falls off linearly, and it hurts the
/// player too: an AoE weapon you can fire at your own feet for free is not a
/// weapon, it is a button.
function explode(x: number, y: number, z: number, radius: number, dmg: number): void {
  const groundY = terrainHeightAt(x, z);
  VFX.emitExplosion(x, y, z, groundY + 0.02);
  FEEL.addTrauma(0.6);
  FEEL.requestHitstop(0.06);
  FEEL.rumble(0.9, 0.6, 0.3);
  if (!SFX.explosion(x, y, z)) playSound3D(DEPS.o.sfxExplosion, x, y, z);
  GS.capEvent = 5;                 // subtitle: explosion (hud.ts CAP_EXPLOSION)

  makeNoise(60);
  OBJECTIVE.blastNests(x, y, z, radius, dmg);
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] === 0) continue;
    const dx = enX[i] - x;
    const dz = enZ[i] - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > radius) continue;
    // A blast on another storey does not reach through the slab.
    if (Math.abs(enY[i] + KIND_HEIGHT[enKind[i]] * 0.5 - y) > radius * 0.7) continue;
    const falloff = 1 - d / radius;
    const dl = d > 0.001 ? d : 1;
    damageEnemy(i, Math.max(1, Math.floor(dmg * falloff)),
                enX[i], enY[i] + KIND_HEIGHT[enKind[i]] * 0.5, enZ[i],
                dx / dl, 0.4, dz / dl, LOC_BODY);
  }

  const pp = playerPosition();
  const pdx = pp.x - x;
  const pdz = pp.z - z;
  const pd = Math.sqrt(pdx * pdx + pdz * pdz);
  // Only while a run is live (RUN[0], set by updateCombat): a shell still in
  // flight when the arena is cleared, the menu opens or the run resets used to
  // be able to kill the player on a screen that was no longer the game. And the
  // hit is reported like any other (director.damagePlayer). A quarter of the blast's damage
  // at the centre: the numbers were rescaled by ten for the creatures (plan 2.3) and the
  // player's 100 HP was not.
  if (pd < radius && RUN[0] === 1 && !GS.gameOver && Math.abs(pp.y - y) < radius * 0.7) {
    const selfDmg = Math.floor(dmg * 0.25 * (1 - pd / radius) * WPN.selfBlastMul());
    if (selfDmg > 0) damagePlayer(selfDmg, x, z, 0);
  }
}

/// Plan 2.7 - throw a grenade along the camera's aim. False when there is none to throw.
export function throwGrenade(): boolean {
  if (GS.grenades <= 0 || K[0] > 0) return false;
  let slot = -1;
  for (let i = 0; i < MAX_NADE; i++) if (gFuse[i] <= 0) { slot = i; break; }
  if (slot < 0) return false;
  const CAM = DEPS.o.CAM;
  const pp = playerPosition();
  const pitch = -CAM[1];
  const sy = Math.sin(CAM[0]), cy = Math.cos(CAM[0]);
  const cp = Math.cos(pitch);
  const fx = sy * cp, fy = Math.sin(pitch), fz = -cy * cp;
  // From the off hand's side, a little ahead, so it does not start inside the Trooper.
  gX[slot] = pp.x + fx * 0.6 - cy * 0.25;
  gY[slot] = pp.y + 0.55;
  gZ[slot] = pp.z + fz * 0.6 - sy * 0.25;
  gVX[slot] = fx * NADE_SPEED;
  gVY[slot] = fy * NADE_SPEED + 4.5;       // lobbed: it always leaves upward of the aim
  gVZ[slot] = fz * NADE_SPEED;
  gFuse[slot] = NADE_FUSE;
  GS.grenades = GS.grenades - 1;
  GS.throwT = 0.4;
  K[0] = 0.8;
  playSound(DEPS.o.sfxNadeThrow);
  makeNoise(8);
  return true;
}

/// Plan 2.7 - begin a rifle-butt strike. False while one is in progress or cooling down.
export function startMelee(): boolean {
  if (GS.meleeT >= 0 || K[1] > 0) return false;
  GS.meleeT = 0;
  K[2] = 0;
  playSoundEx(DEPS.o.sfxSwing, false, 0.9, 1.25, 0);
  return true;
}

/// Grenade flight and the melee swing: one call a frame from updateCombat.
function updateKit(dt: number, playing: boolean): void {
  if (K[0] > 0) K[0] = K[0] - dt;
  if (K[1] > 0) K[1] = K[1] - dt;
  if (GS.throwT > 0) GS.throwT = GS.throwT - dt;

  // ---- grenades
  for (let i = 0; i < MAX_NADE; i++) {
    if (gFuse[i] <= 0) continue;
    gFuse[i] = gFuse[i] - dt;
    if (gFuse[i] <= 0) {
      gFuse[i] = 0;
      explode(gX[i], gY[i] + 0.1, gZ[i], NADE_RADIUS, NADE_DAMAGE);
      continue;
    }
    gVY[i] = gVY[i] - NADE_GRAVITY * dt;
    const sx = gVX[i] * dt, sy = gVY[i] * dt, sz = gVZ[i] * dt;
    const seg = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (seg < 0.00001) continue;
    const inv = 1 / seg;
    const hit = raycast(DEPS.o.physics, vec3(gX[i], gY[i], gZ[i]),
                        vec3(sx * inv, sy * inv, sz * inv), seg + 0.08, STATIC_MASK);
    if (hit) {
      // Bounce: reflect about the surface, keep a third of the speed into it and most of the
      // speed along it. Slow enough on flat ground and it just lies there until the fuse.
      const n = hit.normal;
      const vn = gVX[i] * n.x + gVY[i] * n.y + gVZ[i] * n.z;
      if (vn < 0) {
        const rest = 0.35;
        gVX[i] = (gVX[i] - (1 + rest) * vn * n.x) * 0.72;
        gVY[i] = (gVY[i] - (1 + rest) * vn * n.y) * 0.72;
        gVZ[i] = (gVZ[i] - (1 + rest) * vn * n.z) * 0.72;
        if (vn < -2.5) playSound3D(DEPS.o.sfxNadeBounce, hit.point.x, hit.point.y, hit.point.z);
        const sp2 = gVX[i] * gVX[i] + gVY[i] * gVY[i] + gVZ[i] * gVZ[i];
        if (sp2 < 1.2 && n.y > 0.6) { gVX[i] = 0; gVY[i] = 0; gVZ[i] = 0; }
      }
      gX[i] = hit.point.x + n.x * 0.09;
      gY[i] = hit.point.y + n.y * 0.09;
      gZ[i] = hit.point.z + n.z * 0.09;
    } else {
      gX[i] = gX[i] + sx; gY[i] = gY[i] + sy; gZ[i] = gZ[i] + sz;
    }
  }

  // ---- the rifle-butt strike
  if (GS.meleeT >= 0) {
    GS.meleeT = GS.meleeT + dt;
    const t = GS.meleeT;
    // The swing: wound back for a tenth of a second, through in the next, then recovering.
    let a = 0;
    if (t < 0.10) a = -0.4 * (t / 0.10);
    else if (t < 0.19) a = -0.4 + 1.4 * ((t - 0.10) / 0.09);
    else a = 1 - (t - 0.19) / (MELEE_TIME - 0.19);
    K[3] = a < -0.4 ? -0.4 : a;
    if (t >= MELEE_HIT_AT && K[2] === 0 && playing) {
      K[2] = 1;
      const CAM = DEPS.o.CAM;
      const pp = playerPosition();
      const fx = Math.sin(CAM[0]), fz = -Math.cos(CAM[0]);
      let landed = 0;
      for (let i = 0; i < MAX_ENEMIES; i++) {
        if (enAlive[i] === 0) continue;
        const k = enKind[i];
        const ex = enX[i] - pp.x, ez = enZ[i] - pp.z;
        const el = Math.sqrt(ex * ex + ez * ez);
        if (el > MELEE_REACH + KIND_TORSO_R[k]) continue;
        if (Math.abs(enY[i] - (pp.y - 0.95)) > 2.0) continue;
        // In front: within about 65 degrees of where the camera looks (anything touching counts).
        if (el > 0.6 && (ex * fx + ez * fz) / el < 0.42) continue;
        const il = el > 0.001 ? 1 / el : 0;
        const dxn = el > 0.001 ? ex * il : fx, dzn = el > 0.001 ? ez * il : fz;
        damageEnemy(i, MELEE_DAMAGE, enX[i] - dxn * KIND_TORSO_R[k],
                    enY[i] + KIND_HEIGHT[k] * 0.6, enZ[i] - dzn * KIND_TORSO_R[k],
                    dxn, 0.1, dzn, LOC_BODY);
        // Whatever survives is knocked back and stunned: lights further and longer.
        shoveEnemy(i, dxn, dzn, KIND_LIGHT[k] === 1 ? 1.3 : 0.4, KIND_LIGHT[k] === 1 ? 0.7 : 0.45);
        landed = landed + 1;
      }
      if (landed > 0) {
        playSound(DEPS.o.sfxMeleeHit);
        FEEL.addTrauma(0.22);
        FEEL.requestHitstop(0.05);
        FEEL.rumble(0.6, 0.5, 0.12);
        makeNoise(10);
      }
    }
    if (t >= MELEE_TIME) { GS.meleeT = -1; K[1] = 0.25; K[3] = 0; }
  } else {
    K[3] = 0;
  }
}

// ---- SH-027 / EN-033: where the gun actually is ----------------------------
// The weapon transform is computed ONCE per frame and reused by the draw, the
// muzzle flash, the tracer and the shot ray — so what you see and what you
// hit come from the same number. Previously the shot used a hardcoded
// shoulder offset while the cube was drawn somewhere else entirely.
//
// If the player skeleton exposes a hand joint, the weapon rides it (so it
// follows the walk/attack animation); otherwise it falls back to the fixed
// shoulder offset, which is what the old cube did.
export function updateWeaponTransform(): void {
  const CAM = DEPS.o.CAM;
  const ppW = playerPosition();
  const modelYaw = GS.playerModelYaw;      // the yaw the pose was built with (main sets it)
  const syW = Math.sin(CAM[0]), cyW = Math.cos(CAM[0]);
  // Aim pitch, so the gun points where the camera does.
  const pitch = -CAM[1];

  let baseX = ppW.x + cyW * 0.30 + syW * 0.35;
  let baseY = ppW.y + 0.95;
  let baseZ = ppW.z + syW * 0.30 - cyW * 0.35;

  if (DEPS.o.playerHandJoint >= 0) {
    // Joint transform is model-space; lift it by the same (scale, pos, yaw)
    // we handed animUpdate.
    const jx = jointWorld(DEPS.o.animPlayer, DEPS.o.playerHandJoint, 12);
    const jy = jointWorld(DEPS.o.animPlayer, DEPS.o.playerHandJoint, 13);
    const jz = jointWorld(DEPS.o.animPlayer, DEPS.o.playerHandJoint, 14);
    const cM = Math.cos(modelYaw), sM = Math.sin(modelYaw);
    const rx = jx * cM + jz * sM;
    const rz = -jx * sM + jz * cM;
    baseX = ppW.x + rx * DEPS.o.PLAYER_SCALE;
    baseY = ppW.y + DEPS.o.PLAYER_MODEL_Y_OFFSET + jy * DEPS.o.PLAYER_SCALE;
    baseZ = ppW.z + rz * DEPS.o.PLAYER_SCALE;
  }

  // Barrel direction = camera forward. The muzzle is that far down the
  // barrel from the weapon's origin (build-weapons.ts prints these).
  const cp = Math.cos(pitch);
  const fx = syW * cp;
  const fy = Math.sin(pitch);
  const fz = -cyW * cp;

  // The socket is the trigger hand. Slide the model back along the barrel and up, so the hand
  // is on the pistol grip and the stock reaches the shoulder (weapon up = the barrel's
  // perpendicular in the vertical plane).
  if (DEPS.o.playerHandJoint >= 0) {
    const wH = WPN.currentWeapon();
    const hz = DEPS.o.WEAPON_HAND_Z[wH], hy = DEPS.o.WEAPON_HAND_Y[wH];
    // Barrel and up as DRAWN: the aim, or the hand's own directions through a roll or a death
    // (GS.weaponFree, set by main after the pose is built).
    const kF = GS.weaponFree;
    let dfx = fx + (GS.weaponFwdX - fx) * kF;
    let dfy = fy + (GS.weaponFwdY - fy) * kF;
    let dfz = fz + (GS.weaponFwdZ - fz) * kF;
    const dfl = Math.sqrt(dfx * dfx + dfy * dfy + dfz * dfz);
    if (dfl > 0.0001) { dfx = dfx / dfl; dfy = dfy / dfl; dfz = dfz / dfl; }
    else { dfx = fx; dfy = fy; dfz = fz; }
    let dux = (-syW * fy) + (GS.weaponUpX - (-syW * fy)) * kF;
    let duy = cp + (GS.weaponUpY - cp) * kF;
    let duz = (cyW * fy) + (GS.weaponUpZ - (cyW * fy)) * kF;
    // The rifle-butt strike (plan 2.7) swings the DRAWN weapon across the body about the
    // vertical: wound back to the right, then through to the left. The muzzle and the shot ray
    // keep the true aim (nothing fires during a strike).
    // Switching weapons (plan 2.8, and the swap that was owed since plan 1.1): the new one
    // comes up from pointing at the ground over SWAP_TIME.
    const swp = WPN.swapProgress();
    if (swp > 0) {
      const dip = swp * swp * 1.1;
      dfy = dfy - Math.sin(dip);
      const dl2 = Math.sqrt(dfx * dfx + dfy * dfy + dfz * dfz);
      if (dl2 > 0.0001) { dfx = dfx / dl2; dfy = dfy / dl2; dfz = dfz / dl2; }
    }
    if (K[3] !== 0) {
      const sa = K[3] * 0.95;
      const cs = Math.cos(sa), sn = Math.sin(sa);
      const rx0 = dfx * cs + dfz * sn, rz0 = -dfx * sn + dfz * cs;
      dfx = rx0; dfz = rz0;
      const ux0 = dux * cs + duz * sn, uz0 = -dux * sn + duz * cs;
      dux = ux0; duz = uz0;
    }
    WB[0] = dfx; WB[1] = dfy; WB[2] = dfz; WB[3] = dux; WB[4] = duy; WB[5] = duz;
    baseX = baseX - dfx * hz + dux * hy;
    baseY = baseY - dfy * hz + duy * hy;
    baseZ = baseZ - dfz * hz + duz * hy;
  } else {
    WB[0] = fx; WB[1] = fy; WB[2] = fz; WB[3] = 0; WB[4] = 1; WB[5] = 0;
  }
  weaponX = baseX;
  weaponY = baseY;
  weaponZ = baseZ;
  const mz = DEPS.o.WEAPON_MUZZLE_Z[WPN.currentWeapon()];
  GS.muzzleX = baseX + fx * mz;
  GS.muzzleY = baseY + fy * mz;
  GS.muzzleZ = baseZ + fz * mz;
  weaponYaw = CAM[0];
  weaponPitch = pitch;
}

// ---- Fire (SH-028 / SH-033 / SH-042) ---------------------------------------
// Weapon behaviour is a TABLE (src/weapons.ts): hitscan vs projectile,
// auto vs tap vs charge, spread growth, recoil. This block is the same for
// every weapon; the differences are data. Then the projectile pool advances:
// gravity, and a segment-raycast from old pos to new pos so fast or arcing
// shots can't tunnel through walls (M7).
//
// fireDown/firePressed come from main's input read; forceFire is the
// COMBATSHOT harness's trigger.
/// Hitscan with more than one round (the scattergun's pellets) or a round that passes through
/// bodies (the lance). Each pellet leaves inside the weapon's cone round the aim; each round
/// is tested against the world, the nests and the creatures, and a piercing one starts again
/// from where it struck, skipping the creature it has just been through.
function fireMulti(wpn: number, ox: number, oy: number, oz: number,
                   ax: number, ay: number, az: number, rgX: number, rgZ: number,
                   upX: number, upY: number, upZ: number): void {
  const pellets = WPN.W_PELLETS[wpn];
  const cone = Math.tan(WPN.pelletCone(wpn) * Math.PI / 180);
  let anyHit = false;
  let wallMarks = 0;
  for (let p = 0; p < pellets; p++) {
    let dx = ax, dy = ay, dz = az;
    if (pellets > 1) {
      // a disc of offsets: the first pellet flies true, the rest fill the cone
      const rr = p === 0 ? 0 : Math.sqrt(Math.random()) * cone;
      const ra = Math.random() * Math.PI * 2;
      const sxo = Math.cos(ra) * rr, syo = Math.sin(ra) * rr;
      dx = ax + rgX * sxo + upX * syo;
      dy = ay + upY * syo;
      dz = az + rgZ * sxo + upZ * syo;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx = dx / dl; dy = dy / dl; dz = dz / dl;
    }
    if (p < 3) VFX.emitTracer(ox, oy, oz, dx, dy, dz);
    const hit = raycast(DEPS.o.physics, vec3(ox, oy, oz), vec3(dx, dy, dz), FIRE_RANGE, STATIC_MASK);
    const wallT = hit ? hit.fraction * FIRE_RANGE : FIRE_RANGE;
    let left = WPN.pierceOf(wpn);
    let from = 0;                       // distance already travelled along this round
    let skip = -1;
    let stopped = false;
    while (!stopped) {
      setRaySkip(skip);
      const ei = rayEnemies(ox + dx * from, oy + dy * from, oz + dz * from, dx, dy, dz, wallT - from, 0, HIT);
      setRaySkip(-1);
      const eT = ei >= 0 ? from + HIT[0] : wallT;
      const ni = from === 0 ? OBJECTIVE.rayNests(ox, oy, oz, dx, dy, dz, eT, NH) : -1;
      if (ni >= 0) {
        anyHit = true;
        OBJECTIVE.damageNest(ni, WPN.damageOf(wpn) * WPN.falloffAt(wpn, NH[0]),
                             ox + dx * NH[0], oy + dy * NH[0], oz + dz * NH[0]);
        stopped = true;
      } else if (ei >= 0) {
        anyHit = true;
        const loc = HIT[1];
        let dmg = WPN.damageOf(wpn) * WPN.falloffAt(wpn, eT) * LOC_MUL[loc];
        if (loc === LOC_HEAD) dmg = dmg * WPN.W_HEAD_MUL[wpn];
        if (loc === LOC_HEAD || loc === LOC_WEAK) dmg = dmg * WPN.critMul(wpn);
        damageEnemy(ei, dmg, HIT[2], HIT[3], HIT[4], dx, dy, dz, loc);
        if (left > 0) { left = left - 1; skip = ei; from = eT + 0.05; }
        else stopped = true;
      } else {
        if (hit && wallMarks < 4) {
          wallMarks = wallMarks + 1;
          const n = hit.normal;
          SFX.impact(hit.point.x, hit.point.y, hit.point.z, n.x, n.y, n.z);
        }
        stopped = true;
      }
    }
  }
  if (anyHit) SCORE.noteHit();
}

// A touch tap on FIRE waiting for the weapon (seconds left), see updateCombat.
const TAP_BUF = [0];

export function updateCombat(dt: number, playing: boolean, cursorLocked: boolean,
                             fireDown: boolean, firePressed: boolean,
                             forceFire: boolean): void {
  const CAM = DEPS.o.CAM;
  RUN[0] = playing ? 1 : 0;
  const combatActive = playing && cursorLocked;
  const wpn = WPN.currentWeapon();
  const isProjectile = WPN.W_PROJ_SPEED[wpn] > 0;

  // Charge weapons fire when the trigger comes UP.
  let chargeShot = -1;
  if (combatActive && WPN.W_CHARGE[wpn] > 0 && !fireDown) {
    chargeShot = WPN.releaseCharge();
  }

  updateKit(dt, playing);
  // Recoil recovery (plan 2.8): between bursts the view comes back by whatever the player has
  // not already pulled back themselves.
  WPN.recoverRecoil(dt, combatActive && fireDown, REC);
  CAM[1] = Math.max(DEPS.o.TP_PITCH_MIN, Math.min(DEPS.o.TP_PITCH_MAX, CAM[1] + REC[0]));
  CAM[0] = CAM[0] - REC[1];

  // On touch a tap on FIRE is often one frame long, and at a phone's frame rate a tap during
  // the weapon's cooldown was simply lost (8 quick taps fired 3 rifle rounds on a Pixel 4a).
  // There a tap is held for 0.25 s and fires as soon as the weapon can, automatic weapons
  // included (desktop is unchanged).
  if (MOBILE && combatActive && firePressed) TAP_BUF[0] = 0.25;
  else if (TAP_BUF[0] > 0) TAP_BUF[0] = TAP_BUF[0] - dt;
  const tapPending = MOBILE && TAP_BUF[0] > 0;
  const autoOk = (WPN.W_AUTO[wpn] !== 0 ? fireDown : firePressed) || tapPending;
  // Nothing fires through a rifle-butt strike.
  const wantFire = combatActive && autoOk && WPN.canFire(fireDown || tapPending) && GS.meleeT < 0;
  if (wantFire) TAP_BUF[0] = 0;
  // forceFire (the COMBATSHOT harness) still goes through canFire, so the shot
  // respects the real cooldown, spread and reload — otherwise the capture would
  // be of a weapon that doesn't exist.
  const harnessFire = forceFire && combatActive && WPN.canFire(true);
  // The trigger pulled on an empty weapon with nothing left to load (otherwise it reloads).
  if (combatActive && firePressed && WPN.isEmpty() && GS.meleeT < 0) SFX.dryFire();

  if (wantFire || chargeShot >= 0 || harnessFire) {
    SCORE.noteShot();
    GS.muzzleFlashT = MUZZLE_FLASH_DUR;

    // Recoil + spread bloom. fireShot spends the ammo and starts the cooldown;
    // a charge shot already did both in releaseCharge().
    const kick = [0, 0];
    if (chargeShot < 0) WPN.fireShot(kick);
    else { kick[0] = WPN.W_KICK[wpn] * (0.4 + chargeShot); kick[1] = 0; }

    // Camera kick — pitch UP, with a little horizontal wobble so full-auto
    // climbs on a wander instead of a rail. Applied to the aim itself (not the
    // shake channel) because recoil is something you must actively fight.
    CAM[1] = Math.max(DEPS.o.TP_PITCH_MIN, Math.min(DEPS.o.TP_PITCH_MAX,
      CAM[1] - kick[0] * Math.PI / 180));
    CAM[0] = CAM[0] + kick[1] * Math.PI / 180;
    WPN.noteKick(kick[0] * Math.PI / 180, kick[1] * Math.PI / 180);
    makeNoise(W_NOISE[wpn]);
    FEEL.addTrauma(0.05 + kick[0] * 0.02);
    FEEL.rumble(0.25 + kick[0] * 0.1, 0.15, 0.05);

    // One sound per weapon; the rifle alternates its two samples.
    // Plan 5.1: three reports per weapon at a varied pitch, the mechanism and the casing
    // (sfx.ts). The old single sample is the fallback for a checkout without the new files.
    const ppS = playerPosition();
    if (!SFX.fireShot(wpn, ppS.x, ppS.y - 0.9, ppS.z)) {
      if (wpn === WPN.W_RIFLE && Math.random() < 0.5) playSound(DEPS.o.sfxFireRifleB);
      else playSound(DEPS.o.sfxFireByWeapon[wpn]);
    }

    // Third-person aiming: the crosshair is at screen centre, so trace the
    // camera-forward line out to a far point, treat that as the aim target, and
    // fire from the muzzle toward it. This keeps tracers and sparks lined up
    // with the gun barrel in the world rather than with the orbit camera.
    const camOriginV = vec3(CAM[2], CAM[3], CAM[4]);
    const adx = CAM[5] - CAM[2], ady = CAM[6] - CAM[3], adz = CAM[7] - CAM[4];
    const alen = Math.sqrt(adx*adx + ady*ady + adz*adz);
    const camFwd = alen > 0 ? vec3(adx/alen, ady/alen, adz/alen) : vec3(0, 0, -1);
    // The target is what the crosshair is ON, not a point 200 m out: with the camera over one
    // shoulder the muzzle and the eye are a metre apart, and aiming both at infinity puts a
    // near shot visibly beside the crosshair. So cast the camera ray (starting just past the
    // player, so nothing between the lens and the Trooper counts) and converge on what it hits.
    const ppA = playerPosition();
    const aimDepth = (ppA.x - camOriginV.x) * camFwd.x + (ppA.y - camOriginV.y) * camFwd.y
                   + (ppA.z - camOriginV.z) * camFwd.z;
    let aimStart = aimDepth + 1.6;
    if (aimStart < 0) aimStart = 0;
    let aimTargetFar = 200;
    const asx = camOriginV.x + camFwd.x * aimStart, asy = camOriginV.y + camFwd.y * aimStart;
    const asz = camOriginV.z + camFwd.z * aimStart;
    const aimHit = raycast(DEPS.o.physics, vec3(asx, asy, asz), camFwd, FIRE_RANGE, STATIC_MASK);
    let aimLen = aimHit ? aimHit.fraction * FIRE_RANGE : FIRE_RANGE;
    // ...or the creature under the crosshair, by its real shapes (plan 2.3), if that is nearer.
    // The creature ray starts at the Trooper's own depth, not 1.6 m past it: something clawing
    // at the player is the first thing they will shoot at, and with real hit shapes (no more
    // man-sized boxes) a shot aimed past it simply missed.
    setRaySkip(-1);
    let aimOnEnemy = false;
    const esD = aimDepth > 0 ? aimDepth : 0;
    if (rayEnemies(camOriginV.x + camFwd.x * esD, camOriginV.y + camFwd.y * esD,
                   camOriginV.z + camFwd.z * esD, camFwd.x, camFwd.y, camFwd.z,
                   aimLen + (aimStart - esD), 0, HIT) >= 0) {
      aimLen = HIT[0] - (aimStart - esD);
      aimOnEnemy = true;
    }
    // ...or a nest (objective.ts), the same way: with the camera over one shoulder, a shot
    // converged on the ground behind a nest passes beside it.
    if (OBJECTIVE.rayNests(camOriginV.x + camFwd.x * esD, camOriginV.y + camFwd.y * esD,
                           camOriginV.z + camFwd.z * esD, camFwd.x, camFwd.y, camFwd.z,
                           aimLen + (aimStart - esD), NH) >= 0) {
      aimLen = NH[0] - (aimStart - esD);
      aimOnEnemy = true;
    }
    if (aimHit || aimLen < FIRE_RANGE) aimTargetFar = aimStart + aimLen;
    const tgtX = camOriginV.x + camFwd.x * aimTargetFar;
    const tgtY = camOriginV.y + camFwd.y * aimTargetFar;
    const tgtZ = camOriginV.z + camFwd.z * aimTargetFar;

    const originX = GS.muzzleX;
    const originY = GS.muzzleY;
    const originZ = GS.muzzleZ;
    const mdx = tgtX - originX, mdy = tgtY - originY, mdz = tgtZ - originZ;
    const mlen = Math.sqrt(mdx*mdx + mdy*mdy + mdz*mdz);
    // Closer than 2 m the convergence angle gets silly (a wall at the muzzle would fire
    // sideways): shoot parallel to the camera instead.
    // ...unless what the crosshair is on is a creature: then the shot goes AT it however close.
    const converge = mlen > 2.0 || (aimOnEnemy && mlen > 0.25);
    let aimX = converge ? mdx / mlen : camFwd.x;
    let aimY = converge ? mdy / mlen : camFwd.y;
    let aimZ = converge ? mdz / mlen : camFwd.z;
    // Plan 2.9 - bullet magnetism, for a pad only: a shot within a degree or two of a
    // creature's head or chest is bent onto it. Wider while aiming down the sights. It never
    // reaches further than the cone, so it rewards being nearly right, not pointing roughly.
    if (padIsActive() && SET.get(SET.SET_AIM_ASSIST) !== 0) {
      const coneDeg = (1.2 + WPN.aimBlend() * 0.9) * SET.get(SET.SET_AIM_ASSIST);
      const mi = nearestAimPoint(originX, originY, originZ, aimX, aimY, aimZ, FIRE_RANGE,
                                 Math.cos(coneDeg * Math.PI / 180), MAG);
      if (mi >= 0) {
        const gx = MAG[0] - originX, gy = MAG[1] - originY, gz = MAG[2] - originZ;
        const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (gl > 0.5) { aimX = gx / gl; aimY = gy / gl; aimZ = gz / gl; }
      }
    }

    // SH-028 — spread. The shot leaves inside a cone that grows as you hold the
    // trigger, so full-auto at range is a choice with a cost.
    const rgX = Math.cos(CAM[0]), rgZ = Math.sin(CAM[0]);
    const upX = -aimY * rgZ, upY = aimZ * rgX - aimX * rgZ, upZ = aimY * rgX;
    const sp = [0, 0, 0];
    WPN.applySpread(aimX, aimY, aimZ, rgX, 0, rgZ, upX, upY, upZ, sp);
    const aim = vec3(sp[0], sp[1], sp[2]);

    // Muzzle VFX: flash, smoke, and a casing thrown out to the right.
    VFX.emitMuzzle(originX, originY, originZ, aim.x, aim.y, aim.z, rgX, rgZ);
    MIX.weaponTailFor(wpn, originX, originY, originZ);

    if (!isProjectile) {
      // Every third round leaves a visible streak — tracing every shot reads as
      // a laser beam, not gunfire.
      if ((SCORE.shotsFired() % 3) === 0) {
        VFX.emitTracer(originX, originY, originZ, aim.x, aim.y, aim.z);
      }
      // Two tests, nearest wins: the static world by physics ray, the creatures by their
      // shapes (hitshapes.ts). The creatures' physics boxes are no longer what a bullet hits.
      // Slice D: a scattergun is ten of these in a cone, a lance one that carries on through.
      if (WPN.W_PELLETS[wpn] > 1 || WPN.pierceOf(wpn) > 0) {
        fireMulti(wpn, originX, originY, originZ, aim.x, aim.y, aim.z, rgX, rgZ, upX, upY, upZ);
      } else {
      const hit = raycast(DEPS.o.physics, vec3(originX, originY, originZ), aim,
                          FIRE_RANGE, STATIC_MASK);
      const wallT = hit ? hit.fraction * FIRE_RANGE : FIRE_RANGE;
      const ei = rayEnemies(originX, originY, originZ, aim.x, aim.y, aim.z, wallT, 0, HIT);
      // ...and a nest, when a nest wave is on (objective.ts), if it is nearer than both.
      const ni = OBJECTIVE.rayNests(originX, originY, originZ, aim.x, aim.y, aim.z,
                                    ei >= 0 ? HIT[0] : wallT, NH);
      if (ni >= 0) {
        SCORE.noteHit();
        OBJECTIVE.damageNest(ni, WPN.damageOf(wpn) * WPN.falloffAt(wpn, NH[0]),
                             originX + aim.x * NH[0], originY + aim.y * NH[0], originZ + aim.z * NH[0]);
      } else if (ei >= 0) {
        // Accuracy counts ENEMIES hit, not rays that landed. Counting a
        // wall as a hit made the stat meaningless — and it is a stat the
        // score now pays a bonus on.
        SCORE.noteHit();
        const loc = HIT[1];
        let dmg = WPN.damageOf(wpn) * WPN.falloffAt(wpn, HIT[0]) * LOC_MUL[loc];
        if (loc === LOC_HEAD) dmg = dmg * WPN.W_HEAD_MUL[wpn];
        if (loc === LOC_HEAD || loc === LOC_WEAK) dmg = dmg * WPN.critMul(wpn);
        damageEnemy(ei, dmg, HIT[2], HIT[3], HIT[4], aim.x, aim.y, aim.z, loc);
      } else if (hit) {
        // World hit — sparks, dust and a bullet hole that stays.
        const n = hit.normal;
        SFX.impact(hit.point.x, hit.point.y, hit.point.z, n.x, n.y, n.z);
      }
      }
    } else {
      const speed = WPN.projSpeedOf(wpn);
      const chg = chargeShot >= 0 ? chargeShot : 0;
      spawnProjectile(originX, originY, originZ,
                      aim.x * speed, aim.y * speed, aim.z * speed,
                      wpn, chg);
    }
  }

  // ---- Projectile update (M7) -------------------------------------------
  // Apply gravity, then segment-raycast from old pos to new pos so fast or
  // arcing shots can't tunnel through walls or enemy colliders.
  for (let i = 0; i < MAX_PROJ; i++) {
    if (pLife[i] <= 0) continue;
    pVY[i] = pVY[i] - BLASTER_PROJ_GRAVITY * dt;
    const ox = pX[i], oy = pY[i], oz = pZ[i];
    const nx = ox + pVX[i] * dt;
    const ny = oy + pVY[i] * dt;
    const nz = oz + pVZ[i] * dt;
    const sx = nx - ox, sy = ny - oy, sz = nz - oz;
    const segLen = Math.sqrt(sx * sx + sy * sy + sz * sz);
    const inv = segLen > 0 ? 1 / segLen : 0;
    const hit = raycast(DEPS.o.physics, vec3(ox, oy, oz),
                        vec3(sx * inv, sy * inv, sz * inv),
                        segLen, STATIC_MASK);
    const wallT = hit ? hit.fraction * segLen : segLen;
    // A bolt is fatter than a bullet: its shapes are widened by 12 cm.
    setRaySkip(pLast[i]);
    const ei = rayEnemies(ox, oy, oz, sx * inv, sy * inv, sz * inv, wallT, 0.12, HIT);
    setRaySkip(-1);
    const pw = pWeapon[i];
    const aoe = WPN.aoeOf(pw);
    const ni = OBJECTIVE.rayNests(ox, oy, oz, sx * inv, sy * inv, sz * inv,
                                  ei >= 0 ? HIT[0] : wallT, NH);
    if (ni >= 0) {
      const nxh = ox + sx * inv * NH[0], nyh = oy + sy * inv * NH[0], nzh = oz + sz * inv * NH[0];
      SCORE.noteHit();
      if (aoe > 0) {
        const chgN = pCharge[i];
        explode(nxh, nyh, nzh, aoe * (0.55 + 0.45 * chgN), WPN.damageOf(pw) * (0.5 + 0.5 * chgN));
      } else {
        OBJECTIVE.damageNest(ni, WPN.damageOf(pw), nxh, nyh, nzh);
      }
      pLife[i] = 0;
    } else if (ei >= 0 || hit) {
      const ix = ei >= 0 ? HIT[2] : hit.point.x;
      const iy = ei >= 0 ? HIT[3] : hit.point.y;
      const iz = ei >= 0 ? HIT[4] : hit.point.z;
      if (aoe > 0) {
        // SH-042 — the lucifer cannon. Charge scales both damage and radius, so
        // a snap shot is a weak poke and a held shot is the room-clearer that
        // justifies the 0.9 s cooldown.
        const chg = pCharge[i];
        const radius = aoe * (0.55 + 0.45 * chg);
        const dmg = WPN.damageOf(pw) * (0.5 + 0.5 * chg);
        explode(ix, iy, iz, radius, dmg);
        SCORE.noteHit();
        pLife[i] = 0;
      } else if (ei >= 0) {
        SCORE.noteHit();
        const loc = HIT[1];
        let dmg = WPN.damageOf(pw) * LOC_MUL[loc];
        if (loc === LOC_HEAD) dmg = dmg * WPN.W_HEAD_MUL[pw];
        damageEnemy(ei, dmg, ix, iy, iz, sx * inv, sy * inv, sz * inv, loc);
        // The blaster's bolt carries on through (plan 2.8), once, and never into the same
        // creature twice.
        if (pPierce[i] > 0) {
          pPierce[i] = pPierce[i] - 1;
          pLast[i] = ei;
          pX[i] = nx; pY[i] = ny; pZ[i] = nz;
          pLife[i] = pLife[i] - dt;
        } else {
          pLife[i] = 0;
        }
      } else {
        const n = hit.normal;
        SFX.impact(ix, iy, iz, n.x, n.y, n.z);
        pLife[i] = 0;
      }
    } else {
      pX[i] = nx; pY[i] = ny; pZ[i] = nz;
      pLife[i] = pLife[i] - dt;
      VFX.emitTrail(0, nx, ny, nz);
    }
  }
}

// SH-027 — the real weapon model, at the transform computed once per frame in
// updateWeaponTransform(). Called from main inside the player-draw block so
// the draw order is exactly what it was when this code lived there.
// Recoil is a short kick BACK along the barrel; the squared falloff reads
// as a snap rather than a slide.
export function drawWeapon(): void {
  const recoilT = GS.muzzleFlashT > 0 ? GS.muzzleFlashT / MUZZLE_FLASH_DUR : 0;
  const recoilBack = recoilT * recoilT * 0.10;
  const fwx = WB[0], fwy = WB[1], fwz = WB[2];
  const wpnNow = WPN.currentWeapon();
  // SH-027 v2 / EN-039 — the gun now points where the camera points, pitch and
  // all. This used to be drawModelRotated, which takes a single Y rotation: the
  // barrel stayed level while you aimed up or down, and no yaw-only draw can fix
  // that. drawModelTransform takes the whole 4x4.
  //
  // The barrel is local +Z (build-weapons.ts), and the engine's rotation
  // convention puts COLUMN 2 of the model matrix wherever local +Z points —
  // which the old code confirms: it passed θ = π - yaw, and the engine's rotY
  // sends +Z to (sin θ, 0, cos θ) = (sin yaw, 0, -cos yaw), i.e. camera-forward
  // at zero pitch. So: make column 2 the aim vector and build an orthonormal
  // basis around it.
  //
  // (fwx, fwy, fwz) IS that aim vector already — it is what the muzzle, the
  // tracer and the shot ray are computed from, so the gun and the bullet now
  // agree by construction rather than by coincidence.
  //
  // The cross with world-up is safe because the camera pitch is clamped well
  // short of vertical (TP_PITCH_MIN/MAX): the aim can never be parallel to up,
  // so the basis can never collapse.
  const sc = DEPS.o.WEAPON_DRAW_SCALE[wpnNow];
  // X = normalise(cross(worldUp, forward))
  // "Up" is world up while the weapon is aimed and the hand's up when it rides the hand.
  let rx = WB[4] * fwz - WB[5] * fwy;
  let ry = WB[5] * fwx - WB[3] * fwz;
  let rz = WB[3] * fwy - WB[4] * fwx;
  const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (rl > 0.0001) { rx = rx / rl; ry = ry / rl; rz = rz / rl; }
  else { rx = 1; ry = 0; rz = 0; }
  // Y = cross(forward, X) — completes a right-handed basis (X × Y = Z).
  const ux = fwy * rz - fwz * ry;
  const uy = fwz * rx - fwx * rz;
  const uz = fwx * ry - fwy * rx;

  const px = weaponX - fwx * recoilBack;
  const py = weaponY - fwy * recoilBack;
  const pz = weaponZ - fwz * recoilBack;
  // Column-major: [col0 | col1 | col2 | translation].
  const m16 = [
    rx * sc,  ry * sc,  rz * sc,  0,
    ux * sc,  uy * sc,  uz * sc,  0,
    fwx * sc, fwy * sc, fwz * sc, 0,
    px,       py,       pz,       1,
  ];
  drawModelTransform(DEPS.o.mdlWeapons[wpnNow], m16, WHITE);

  // Muzzle flash — additive material at the true muzzle. The particle system
  // now layers smoke and a shell on top of this (SH-033); the flash card
  // stays because it is what makes the HDR spike.
  if (GS.muzzleFlashT > 0 && ENV.matMuzzleFlash > 0) {
    const k = GS.muzzleFlashT / MUZZLE_FLASH_DUR;
    const flashScale = 0.40 + (1 - k) * 0.18;
    const intensity255 = Math.min(255, Math.floor(k * 255));
    drawMeshWithMaterial(ENV.matMuzzleFlash, ENV.matMuzzleFlashMesh,
      vec3(GS.muzzleX, GS.muzzleY, GS.muzzleZ), flashScale,
      { r: 255, g: 200, b: 120, a: intensity255 });
  }
}

// The combat layer of the 3D pass: muzzle flare light, pickups, both
// projectile kinds. Called from main after the enemy draws, where the pickup/
// projectile/bolt draws sat — point lights accumulate anywhere inside the
// pass (the enemy-bolt lights below always ran this late), so the muzzle
// light moving here from the top of the pass changes nothing.
export function drawCombatWorld(): void {
  // Muzzle flare point light — sits just past the barrel tip (the REAL muzzle,
  // SH-027) so the warm splash of light hits the gun body and the floor in
  // front of the player when firing.
  if (GS.muzzleFlashT > 0) {
    const k = GS.muzzleFlashT / MUZZLE_FLASH_DUR;
    addPointLight(GS.muzzleX, GS.muzzleY, GS.muzzleZ, 6, 1.0, 0.85, 0.5, 4.0 * k);
  }
  // Pickups (plan 2.8): an ammo crate on the floor with the weapon it feeds turning slowly
  // above it. Until 2026-11 these were bobbing coloured cubes. The weapon rides the AUTHORED
  // height (pickups once drew at an absolute y, which parked the house's upstairs pickup on
  // the ground floor); the crate sits 0.85 m under it, on the floor it was authored above.
  OBJECTIVE.drawObjective();
  const tNow = getTime();
  for (let i = 0; i < PICKUP_COUNT; i++) {
    if (pickupActive[i] === 0) continue;
    const isRifleKind = pickupKind[i] === PICKUP_RIFLE;
    const wM = isRifleKind ? WPN.W_RIFLE : WPN.W_BLASTER;
    const bob = pickupY[i] + 0.12 + Math.sin(tNow * 2.0 + i) * 0.06;
    // The crate is 24,000 triangles and the weapon 30,000 to 40,000, and a turning model is
    // redrawn into every shadow map each frame. Across the arena the glow card is all that can
    // be seen of a pickup, so the models are only drawn near the camera (SH-066).
    const pdx = pickupX[i] - DEPS.o.CAM[2], pdz = pickupZ[i] - DEPS.o.CAM[4];
    const pd2 = pdx * pdx + pdz * pdz;
    if (DEPS.o.hasCrate === 1 && pd2 < PICKUP_CRATE_FAR2) {
      drawModelRotated(DEPS.o.mdlCrate, vec3(pickupX[i], pickupY[i] - 0.85, pickupZ[i]),
                       0.55, (i * 37) % 360, WHITE);
    }
    // Turning about the vertical, barrel tipped up a little, centred on its own middle
    // (weapon models have their rear at z = 0 and the muzzle at WEAPON_MUZZLE_Z).
    const ang = tNow * 1.1 + i * 1.7;
    const tilt = 0.30;
    const fwx = Math.sin(ang) * Math.cos(tilt), fwy = Math.sin(tilt), fwz = Math.cos(ang) * Math.cos(tilt);
    const rx = Math.cos(ang), rz = -Math.sin(ang);
    const ux = fwy * rz, uy = fwz * rx - fwx * rz, uz = -fwy * rx;
    const sc = DEPS.o.WEAPON_DRAW_SCALE[wM];
    const half = DEPS.o.WEAPON_MUZZLE_Z[wM] * 0.5;
    const m16 = [
      rx * sc,  0,        rz * sc,  0,
      ux * sc,  uy * sc,  uz * sc,  0,
      fwx * sc, fwy * sc, fwz * sc, 0,
      pickupX[i] - fwx * half, bob - fwy * half, pickupZ[i] - fwz * half, 1,
    ];
    if (pd2 < PICKUP_WEAPON_FAR2) drawModelTransform(DEPS.o.mdlWeapons[wM], m16, WHITE);
    // A soft glow so it reads across the arena - the ADDITIVE card, which composites after
    // the path tracer and never touches the G-buffer (an alpha sphere there drew as a black
    // ball in the PT modes).
    if (ENV.matMuzzleFlash > 0) {
      drawMeshWithMaterial(ENV.matMuzzleFlash, ENV.matMuzzleFlashMesh,
        vec3(pickupX[i], bob, pickupZ[i]), 0.6,
        isRifleKind ? { r: 240, g: 200, b: 80, a: 130 } : { r: 120, g: 220, b: 240, a: 130 });
    }
  }
  // Field dressings (plan 2.7): a small green-lit case where the creature fell. It blinks
  // through its last five seconds.
  for (let i = 0; i < MAX_HEALS; i++) {
    if (hpLife[i] <= 0) continue;
    if (hpLife[i] < 5 && Math.floor(hpLife[i] * 5) % 2 === 0) continue;
    const hdx = hpX[i] - DEPS.o.CAM[2], hdz = hpZ[i] - DEPS.o.CAM[4];
    if (DEPS.o.hasCrate === 1 && hdx * hdx + hdz * hdz < PICKUP_CRATE_FAR2) {
      drawModelRotated(DEPS.o.mdlCrate, vec3(hpX[i], hpY[i], hpZ[i]), 0.34, (i * 53) % 360,
                       { r: 120, g: 255, b: 150, a: 255 });
    }
    if (ENV.matMuzzleFlash > 0) {
      drawMeshWithMaterial(ENV.matMuzzleFlash, ENV.matMuzzleFlashMesh,
        vec3(hpX[i], hpY[i] + 0.5, hpZ[i]), 0.6 + Math.sin(tNow * 4 + i) * 0.08,
        { r: 90, g: 255, b: 130, a: 235 });
    }
    addPointLight(hpX[i], hpY[i] + 0.5, hpZ[i], 3.5, 0.3, 1.0, 0.45, 1.4);
  }
  // Grenades in flight: a dark ball with a light that blinks faster as the fuse runs down.
  for (let i = 0; i < MAX_NADE; i++) {
    if (gFuse[i] <= 0) continue;
    drawSphere(vec3(gX[i], gY[i], gZ[i]), 0.07, { r: 40, g: 46, b: 38, a: 255 });
    const rate = 4 + (NADE_FUSE - gFuse[i]) * 7;
    if (Math.sin(tNow * rate * 3.14) > 0) {
      if (ENV.matMuzzleFlash > 0) {
        drawMeshWithMaterial(ENV.matMuzzleFlash, ENV.matMuzzleFlashMesh,
          vec3(gX[i], gY[i] + 0.06, gZ[i]), 0.16, { r: 255, g: 70, b: 50, a: 255 });
      }
      addPointLight(gX[i], gY[i] + 0.1, gZ[i], 2.5, 1.0, 0.25, 0.15, 1.2);
    }
  }
  // Blaster projectiles — additive cyan plasma using the muzzle-
  // flash mesh + material, tinted cool. The radial-falloff in the
  // shader already produces the soft glow shape.
  for (let i = 0; i < MAX_PROJ; i++) {
    if (pLife[i] > 0) {
      if (ENV.matMuzzleFlash > 0) {
        drawMeshWithMaterial(ENV.matMuzzleFlash, ENV.matMuzzleFlashMesh,
          vec3(pX[i], pY[i], pZ[i]), 0.30,
          { r: 110, g: 200, b: 255, a: 255 });
      } else {
        drawSphere(vec3(pX[i], pY[i], pZ[i]), 0.16,
          { r: 140, g: 220, b: 255, a: 255 });
      }
    }
  }
  // SH-042 — enemy bolts. Hot acid-green / violet so they read as INCOMING at a
  // glance and stay distinct from the player's cool-cyan blaster plasma: in a
  // crowded frame you have to be able to tell whose shot is whose.
  for (let i = 0; i < MAX_EPROJ; i++) {
    if (eLife[i] <= 0) continue;
    const adv = eKind[i] === K_ADV_DRAGOON;
    if (ENV.matMuzzleFlash > 0) {
      const col = adv
        ? { r: 200, g: 120, b: 255, a: 255 }    // dragoon barb — violet
        : { r: 150, g: 255, b: 120, a: 255 };   // marauder zap — acid green
      drawMeshWithMaterial(ENV.matMuzzleFlash, ENV.matMuzzleFlashMesh,
        vec3(eX[i], eY[i], eZ[i]), adv ? 0.34 : 0.24, col);
    }
    addPointLight(eX[i], eY[i], eZ[i], 4,
      adv ? 0.7 : 0.5, adv ? 0.4 : 1.0, adv ? 1.0 : 0.4, 1.6);
  }
}
