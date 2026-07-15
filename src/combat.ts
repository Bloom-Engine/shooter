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
  drawCube, drawSphere, drawMeshWithMaterial, drawModelRotated,
  playSound, playSound3D, playMusic, stopMusic,
} from 'bloom';
import { gamepadRumble } from 'bloom/core';
import { addPointLight } from 'bloom/scene';
import { raycast, ALL_LAYERS_MASK } from 'bloom/physics';
import { jointWorld } from 'bloom/models';
import * as W from './world-runtime';
import { GS } from './gamestate';
import {
  DIR, damageEnemy, despawnAllEnemies, WAVE_BREAK_DELAY,
  MAX_EPROJ, eX, eY, eZ, eLife, eKind,
} from './director';
import {
  MAX_ENEMIES, enAlive, enBody, enX, enY, enZ, KIND_HP, K_ADV_DRAGOON,
} from './enemies';
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

const WHITE = { r: 255, g: 255, b: 255, a: 255 };

// main.ts-owned handles this module steers with, handed across ONCE via
// setCombatDeps() before the frame loop (the director.ts DEPS pattern):
// CAM, physics, TP_PITCH_MIN, TP_PITCH_MAX — camera/physics;
// animPlayer, playerHandJoint, PLAYER_SCALE, PLAYER_MODEL_Y_OFFSET — the
// player model the weapon rides; mdlWeapons, WEAPON_MUZZLE_Z,
// WEAPON_DRAW_SCALE — the weapon models and their ABI columns (declared next
// to the loadModel calls in main so they stay in sync with the art);
// sfxFireRifle, sfxFireBlaster, sfxRicochet, sfxPlayerDie, stingDeath,
// musicMenu, musicCalm, musicCombat — audio handles.
const DEPS: any = { o: null };
export function setCombatDeps(deps: any): void { DEPS.o = deps; }

// ---- Weapon + combat state (M4 / M5 / M6 / M7) ----------------------------
export const PLAYER_HP_MAX = 100;
const FIRE_RANGE = 60.0;

// SH-028/SH-042 — weapon state now lives in src/weapons.ts as a stat TABLE, so
// the chaingun and the cannon are rows rather than branches. What stays here is
// only what the world/projectile code needs.
const BLASTER_PROJ_LIFE = 2.5;
const BLASTER_PROJ_GRAVITY = 9.0;   // m/s^2 — lighter than world gravity for a softer arc

const MUZZLE_FLASH_DUR = 0.08;
// SH-027 — the weapon's world transform for this frame. Computed once and used
// by the draw, the muzzle flash, the tracer AND the shot ray, so what you see
// is what you hit.
let weaponX = 0;
let weaponY = 0;
let weaponZ = 0;
let weaponYaw = 0;
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
for (let i = 0; i < MAX_PROJ; i++) { pLife[i] = 0; pWeapon[i] = 0; pCharge[i] = 0; }
let projNext = 0;


function spawnProjectile(x: number, y: number, z: number,
                         vx: number, vy: number, vz: number,
                         weapon: number, charge: number): void {
  pX[projNext] = x; pY[projNext] = y; pZ[projNext] = z;
  pVX[projNext] = vx; pVY[projNext] = vy; pVZ[projNext] = vz;
  pLife[projNext] = BLASTER_PROJ_LIFE;
  pWeapon[projNext] = weapon;
  pCharge[projNext] = charge;
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
export const pickupZ    = W.PICKUP_Z;
export const PICKUP_COUNT = W.PICKUP_COUNT;
export const pickupActive   = new Array<number>(PICKUP_COUNT);
export const pickupRespawnT = new Array<number>(PICKUP_COUNT);
for (let i = 0; i < PICKUP_COUNT; i++) { pickupActive[i] = 1; pickupRespawnT[i] = 0; }


export function resetRun(): void {
  WPN.resetWeapons();
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
  for (let i = 0; i < PICKUP_COUNT; i++) { pickupActive[i] = 1; pickupRespawnT[i] = 0; }
  despawnAllEnemies();
  SCORE.resetScore();
  FEEL.resetFeel();
  VFX.resetVfx();     // last run's blood shouldn't greet the new one
  GS.runElapsed = 0;
  SCORE.beginWave(0);
}

/// SH-046 — leave the main menu and drop into the arena. This was inline in the
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
  WPN.selectWeapon(WPN.W_BLASTER);
  WPN.selectWeapon(WPN.W_RIFLE);
  DIR.waveBreakTimer = WAVE_BREAK_DELAY;   // wave-1 countdown starts fresh
  SCORE.resetScore();
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
  gamepadRumble(0.9, 0.6, 0.3);
  playSound3D(DEPS.o.sfxFireBlaster, x, y, z);

  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] === 0) continue;
    const dx = enX[i] - x;
    const dz = enZ[i] - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > radius) continue;
    const falloff = 1 - d / radius;
    const dl = d > 0.001 ? d : 1;
    damageEnemy(i, Math.max(1, Math.floor(dmg * falloff)),
                enX[i], enY[i] + 0.8, enZ[i], dx / dl, 0.4, dz / dl);
  }

  const pp = playerPosition();
  const pdx = pp.x - x;
  const pdz = pp.z - z;
  const pd = Math.sqrt(pdx * pdx + pdz * pdz);
  if (pd < radius && !GS.gameOver) {
    const selfDmg = Math.floor(dmg * 2.5 * (1 - pd / radius));
    if (selfDmg > 0) {
      GS.playerHP = GS.playerHP - selfDmg;
      FEEL.damageFlash(1);
      GS.damageFlashT = 0.5;
      MIX.duckMusicOnDamage();
      if (GS.playerHP <= 0) {
        GS.playerHP = 0;
        GS.gameOver = true;
        playSound(DEPS.o.sfxPlayerDie[0]);
        playSound(DEPS.o.stingDeath);   // SH-036
        SCORE.commitRun(0);
        SET.saveSettings();
      }
    }
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
  const modelYaw = Math.PI / 2 - CAM[0];   // engine applies skinned rotY inverted
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

  weaponX = baseX;
  weaponY = baseY;
  weaponZ = baseZ;

  // Barrel direction = camera forward. The muzzle is that far down the
  // barrel from the weapon's origin (build-weapons.ts prints these).
  const cp = Math.cos(pitch);
  const fx = syW * cp;
  const fy = Math.sin(pitch);
  const fz = -cyW * cp;
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
export function updateCombat(dt: number, playing: boolean, cursorLocked: boolean,
                             fireDown: boolean, firePressed: boolean,
                             forceFire: boolean): void {
  const CAM = DEPS.o.CAM;
  const combatActive = playing && cursorLocked;
  const wpn = WPN.currentWeapon();
  const isProjectile = WPN.W_PROJ_SPEED[wpn] > 0;

  // Charge weapons fire when the trigger comes UP.
  let chargeShot = -1;
  if (combatActive && WPN.W_CHARGE[wpn] > 0 && !fireDown) {
    chargeShot = WPN.releaseCharge();
  }

  const autoOk = WPN.W_AUTO[wpn] !== 0 ? fireDown : firePressed;
  const wantFire = combatActive && autoOk && WPN.canFire(fireDown);
  // forceFire (the COMBATSHOT harness) still goes through canFire, so the shot
  // respects the real cooldown, spread and reload — otherwise the capture would
  // be of a weapon that doesn't exist.
  const harnessFire = forceFire && combatActive && WPN.canFire(true);

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
    FEEL.addTrauma(0.05 + kick[0] * 0.02);
    gamepadRumble(0.25 + kick[0] * 0.1, 0.15, 0.05);

    playSound(wpn === WPN.W_BLASTER ? DEPS.o.sfxFireBlaster : DEPS.o.sfxFireRifle);

    // Third-person aiming: the crosshair is at screen centre, so trace the
    // camera-forward line out to a far point, treat that as the aim target, and
    // fire from the muzzle toward it. This keeps tracers and sparks lined up
    // with the gun barrel in the world rather than with the orbit camera.
    const camOriginV = vec3(CAM[2], CAM[3], CAM[4]);
    const adx = CAM[5] - CAM[2], ady = CAM[6] - CAM[3], adz = CAM[7] - CAM[4];
    const alen = Math.sqrt(adx*adx + ady*ady + adz*adz);
    const camFwd = alen > 0 ? vec3(adx/alen, ady/alen, adz/alen) : vec3(0, 0, -1);
    const aimTargetFar = 200;
    const tgtX = camOriginV.x + camFwd.x * aimTargetFar;
    const tgtY = camOriginV.y + camFwd.y * aimTargetFar;
    const tgtZ = camOriginV.z + camFwd.z * aimTargetFar;

    const originX = GS.muzzleX;
    const originY = GS.muzzleY;
    const originZ = GS.muzzleZ;
    const mdx = tgtX - originX, mdy = tgtY - originY, mdz = tgtZ - originZ;
    const mlen = Math.sqrt(mdx*mdx + mdy*mdy + mdz*mdz);
    const aimX = mlen > 0 ? mdx / mlen : camFwd.x;
    const aimY = mlen > 0 ? mdy / mlen : camFwd.y;
    const aimZ = mlen > 0 ? mdz / mlen : camFwd.z;

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
      const hit = raycast(DEPS.o.physics, vec3(originX, originY, originZ), aim,
                          FIRE_RANGE, ALL_LAYERS_MASK);
      if (hit) {
        let struckEnemy = false;
        for (let i = 0; i < MAX_ENEMIES; i++) {
          if (enAlive[i] > 0 && hit.body === enBody[i]) {
            struckEnemy = true;
            // Accuracy counts ENEMIES hit, not rays that landed. Counting a
            // wall as a hit made the stat meaningless — and it is a stat the
            // score now pays a bonus on.
            SCORE.noteHit();
            damageEnemy(i, WPN.W_DAMAGE[wpn], hit.point.x, hit.point.y, hit.point.z,
                        aim.x, aim.y, aim.z);
            break;
          }
        }
        if (!struckEnemy) {
          // World hit — sparks, dust and a bullet hole that stays.
          const n = hit.normal;
          VFX.emitImpactHard(hit.point.x, hit.point.y, hit.point.z,
                             n.x, n.y, n.z, Math.random() * 6.28);
          playSound3D(DEPS.o.sfxRicochet[SCORE.shotsFired() & 1],
                      hit.point.x, hit.point.y, hit.point.z);
        }
      }
    } else {
      const speed = WPN.W_PROJ_SPEED[wpn];
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
                        segLen, ALL_LAYERS_MASK);
    if (hit) {
      const pw = pWeapon[i];
      const aoe = WPN.W_AOE[pw];
      if (aoe > 0) {
        // SH-042 — the lucifer cannon. Charge scales both damage and radius, so
        // a snap shot is a weak poke and a held shot is the room-clearer that
        // justifies the 0.9 s cooldown.
        const chg = pCharge[i];
        const radius = aoe * (0.55 + 0.45 * chg);
        const dmg = WPN.W_DAMAGE[pw] * (0.5 + 0.5 * chg);
        explode(hit.point.x, hit.point.y, hit.point.z, radius, dmg);
        SCORE.noteHit();
      } else {
        let struck = false;
        for (let j = 0; j < MAX_ENEMIES; j++) {
          if (enAlive[j] > 0 && hit.body === enBody[j]) {
            struck = true;
            SCORE.noteHit();
            const dl = segLen > 0 ? 1 / segLen : 0;
            damageEnemy(j, WPN.W_DAMAGE[pw],
                        hit.point.x, hit.point.y, hit.point.z,
                        sx * dl, sy * dl, sz * dl);
            break;
          }
        }
        if (!struck) {
          const n = hit.normal;
          VFX.emitImpactHard(hit.point.x, hit.point.y, hit.point.z,
                             n.x, n.y, n.z, Math.random() * 6.28);
        }
      }
      pLife[i] = 0;
    } else {
      pX[i] = nx; pY[i] = ny; pZ[i] = nz;
      pLife[i] = pLife[i] - dt;
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
  const cpW = Math.cos(weaponPitch);
  const fwx = Math.sin(weaponYaw) * cpW;
  const fwy = Math.sin(weaponPitch);
  const fwz = -Math.cos(weaponYaw) * cpW;
  const wpnNow = WPN.currentWeapon();
  // drawModelRotated takes DEGREES (see docs/round-4 notes) and gives us the
  // cached-model path, which the immediate path would not.
  //
  // The barrel is local +Z (build-weapons.ts), but camera-forward at yaw 0 is
  // -Z, so a naive `yaw` points the gun backwards. Rotating +Z onto
  // (sin yaw, 0, -cos yaw) needs θ = π - yaw.
  //
  // Only yaw is expressible here: drawModelRotated has no pitch, so the gun
  // cannot tilt with the aim. Fine in third person at normal engagement
  // angles; a full-transform immediate draw is EN-039.
  const yawDeg = ((Math.PI - weaponYaw) * 180 / Math.PI);
  drawModelRotated(
    DEPS.o.mdlWeapons[wpnNow],
    vec3(weaponX - fwx * recoilBack,
         weaponY - fwy * recoilBack,
         weaponZ - fwz * recoilBack),
    DEPS.o.WEAPON_DRAW_SCALE[wpnNow], yawDeg, WHITE);

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
  // Pickups — bobbing cubes, color-coded per kind.
  const tNow = getTime();
  for (let i = 0; i < PICKUP_COUNT; i++) {
    if (pickupActive[i] === 0) continue;
    const bob = 0.8 + Math.sin(tNow * 3.0 + i) * 0.15;
    const isRifleKind = pickupKind[i] === PICKUP_RIFLE;
    const col = isRifleKind
      ? { r: 240, g: 200, b: 80,  a: 255 }    // gold = rifle
      : { r: 120, g: 220, b: 240, a: 255 };   // cyan = blaster
    drawCube(vec3(pickupX[i], bob, pickupZ[i]), 0.4, 0.4, 0.4, col);
    // Glow sphere around the cube for visibility.
    drawSphere(vec3(pickupX[i], bob, pickupZ[i]), 0.55,
      { r: col.r, g: col.g, b: col.b, a: 60 });
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
