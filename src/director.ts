// SH-025b — the enemy director, out of main.ts: wave plan + spawning,
// the per-kind AI state machines (Round-9), enemy projectiles, damage
// and death. Player-side combat (firing, the player projectile pool,
// pickups) stays in main.ts until SH-025c.
//
// Perry rules (same as environment.ts, learned the hard way there):
// every function is TOP-LEVEL (nested declarations kill the process
// silently at boot); no exported `let` (cross-module reassignment does
// not propagate) — mutable state lives in the const DIR object,
// literal-key access only; no engine calls at module scope (data-only
// initializers are fine); dependencies main.ts owns (sounds, feel,
// score hooks) arrive once through initDirector and live in DEPS.o.
import {
  vec3, getTime, playSound3D, playSound, getFPS,
} from 'bloom';
import { gamepadRumble } from 'bloom/core';
import { animPlay } from 'bloom/models';
import { createRagdoll, releaseRagdoll } from 'bloom/models';
import { setBodyPosition, raycast, Layer } from 'bloom/physics';
import { GS } from './gamestate';
import * as W from './world-runtime';
import { terrainHeightAt } from './terrain';
import {
  surfaceHeightAt, navGoal, navStairBlocked, SAME_FLOOR_EPS, PLAYER_FEET_OFF,
} from './nav';
import { bootStage, BOOT_ALIENS } from './boot';
import { playerPosition } from './player';
import * as VFX from './vfx';
import * as FEEL from './feel';
import * as SCORE from './score';
import * as MIX from './audio-mix';
import * as SET from './settings';
import * as WPN from './weapons';
import {
  MAX_ENEMIES, BODIES_PER_KIND, KIND_COUNT,
  enAlive, enDying, enX, enY, enZ, enHP, enBody, enKind,
  enAttackCD, enFlashT, enPhase, enAIState, enStateT, enOrbitDir,
  enChargeX, enChargeZ, enSpeedMul, enFlinchLock, enDmgWindow,
  enDmgTimer, enAttackLayer, enStepPhase, vxLast, vzLast,
  enAnimClip, enHeading, enDeathT, enDeathYaw,
  enDeathDX, enDeathDY, enDeathDZ, enDeathImp,
  KIND_HP, KIND_DMG, KIND_CD, KIND_MELEE, KIND_SPEED, KIND_Y_OFF,
  KIND_SCALE, KIND_BLOOD_R, KIND_BLOOD_G, KIND_BLOOD_B,
  KIND_RANGED, RANGED_MIN, RANGED_MAX, RANGED_CD, RANGED_SHOTS,
  RANGED_DMG, RANGED_SPEED, RANGED_SPREAD,
  K_ADV_MARAUDER, K_ADV_DRAGOON, DRETCH_HIT_FLASH,
  enBurst, enBurstT, enRagActive, enRagdoll, enRangedCD,
  FLINCH_LOCKOUT, FLINCH_TIME, STAGGER_FRAC, STAGGER_TIME, STAGGER_WINDOW,
  KIND_HX, KIND_LIGHT, RANGED_WINDUP,
  AI_APPROACH, AI_ORBIT, AI_CHARGE, AI_RECOVER, AI_WINDUP, AI_FLINCH,
  initEnemyPool,
} from './enemies';

/// Mutable director state, const-object slots (the DEPS.o.CAM pattern).
/// Player damage is applied directly to GS.playerHP where it happens (melee
/// in updateDirector, bolts in updateEnemyProjectiles) — there is no
/// accumulate-then-apply step in main.ts.
export const DIR: any = {
  waveIdx: 0,
  waveSpawned: 0,
  waveBreakTimer: 2.5,
  spawnTimer: 0,
  gameWon: false,
  eprojNext: 0,
};

/// main.ts-owned dependencies, handed over once by initDirector.
const DEPS: any = { o: null };

/// SH-051 — scratch for navGoal's [x, z, active] result. One shared array,
/// written every call: allocating a fresh one per enemy per frame is exactly the
/// per-frame garbage the hot paths here avoid, and Perry's object-shorthand
/// return values are not trustworthy anyway (perry-quirks #2).
const NAVOUT = [0, 0, 0];

export function initDirector(phys: any, stagedAliens: number[]): void {
  bootStage(BOOT_ALIENS);
  initEnemyPool(phys, stagedAliens);
}

/// Called once, just before the main loop: some of the handles (the
/// pickup arrays) are declared after the director's boot position, so
/// the hand-over cannot happen inside initDirector.
export function setDirectorDeps(deps: any): void {
  DEPS.o = deps;
}


// Wave director — spawners, wave plan, and kind sequence all come from the
// world file (see enemy_spawner + wave_config entities in arena_02.world.json).
const spawnerX = W.SPAWNER_X;
const spawnerZ = W.SPAWNER_Z;
export const wavePlan = W.WAVE_SIZE;
const WAVE_OFFS = W.WAVE_OFFS;
const WAVE_KINDS = W.WAVE_KIND;
const WAVE_SPAWN_DELAY = 1.2;
export const WAVE_BREAK_DELAY = 2.5;
// Round-2 audit (F11): with one kind per wave and BODIES_PER_KIND=2 pool
// slots, the shipped game never showed more than 2 enemies at once — the
// arena felt empty and the measured pool-max load never occurred in play.
// Waves now mix kinds (see arena_02.world.json), so the concurrency cap
// is the real limit again.
//
// SH-042 asked for 6 -> 8 once skinned VB caching landed, gated on "re-verify
// combat frame time" (acceptance: >= 35 fps at 4K/TSR). Measured 2026-07-15 on
// the dev box rather than assumed, and the result reframes the gate:
//
//   0 enemies alive -> ~28 fps        3 enemies alive -> ~27.5 fps
//
// Enemies cost roughly 0.2 fps EACH. They are not what the frame is spent on —
// the static scene is (4K at 0.75 render scale, the forest, the house, GI/SSR/
// SSAO/shadows). So the bump is safe: 8 concurrent is worth well under 1 fps.
//
// The honest part: the >= 35 fps acceptance FAILS ANYWAY, on the baseline, with
// no enemies on screen at all. That is a rendering-cost problem and it is not
// this constant's to solve — see docs/perf-audit-2026-07.md. Raising this does
// not cause that gap and lowering it would not close it.
const MAX_CONCURRENT = 8;



// Shortest-arc turn toward a target yaw, clamped to maxStep radians.
// Keeps enemy headings continuous so models wheel around instead of
// snapping 180°.
function turnToward(cur: number, target: number, maxStep: number): number {
  let d = target - cur;
  while (d > Math.PI)  d = d - Math.PI * 2;
  while (d < -Math.PI) d = d + Math.PI * 2;
  if (d >  maxStep) d =  maxStep;
  if (d < -maxStep) d = -maxStep;
  return cur + d;
}

export function countAlive(): number {
  let c = 0;
  for (let i = 0; i < MAX_ENEMIES; i++) if (enAlive[i] > 0) c = c + 1;
  return c;
}

function findDormantSlot(kind: number): number {
  for (let j = 0; j < BODIES_PER_KIND; j++) {
    const i = kind * BODIES_PER_KIND + j;
    // A dying slot still owns the corpse on screen — don't respawn into it
    // or the death anim snaps into a fresh enemy mid-fall.
    if (enAlive[i] === 0 && enDying[i] === 0) return i;
  }
  return -1;
}

function spawnEnemy(): void {
  const kind = WAVE_KINDS[WAVE_OFFS[DIR.waveIdx] + DIR.waveSpawned];
  const slot = findDormantSlot(kind);
  if (slot < 0) return;   // all bodies of this kind busy; retry next tick
  const sp = DIR.waveSpawned % 4;
  enX[slot] = spawnerX[sp];
  enZ[slot] = spawnerZ[sp];
  enY[slot] = terrainHeightAt(enX[slot], enZ[slot]);
  enHP[slot] = KIND_HP[kind];
  enAlive[slot] = 1;
  enAttackCD[slot] = 0;
  enFlashT[slot] = 0;
  enPhase[slot] = Math.random() * Math.PI * 2;
  enAIState[slot] = AI_APPROACH;
  enStateT[slot] = 0.5 + Math.random();          // stagger first specials
  enOrbitDir[slot] = Math.random() < 0.5 ? -1 : 1;
  enChargeX[slot] = 0;
  enChargeZ[slot] = 1;
  enSpeedMul[slot] = 1;
  enFlinchLock[slot] = 0;
  enDmgWindow[slot] = 0;
  enDmgTimer[slot] = 0;
  enAttackLayer[slot] = 0;
  enStepPhase[slot] = 0;
  vxLast[slot] = 0;
  vzLast[slot] = 0;
  // Force the mixer to re-trigger: the slot may still hold the die clip from
  // the previous occupant, and animPlay is (deliberately) a no-op when asked
  // for the clip that is already playing.
  enAnimClip[slot] = -1;
  // Spawners sit at the arena corners — start facing the middle.
  enHeading[slot] = Math.atan2(-enX[slot], enZ[slot]);
  setBodyPosition(enBody[slot],
    vec3(enX[slot], enY[slot] + KIND_Y_OFF[kind], enZ[slot]), true);
  DIR.waveSpawned = DIR.waveSpawned + 1;
}

// SH-042 — ENEMY projectiles. Deliberately a separate pool from the player's:
// they travel slower and they are DODGEABLE, which is the whole design. A
// hitscan ranged enemy would just be an unavoidable damage tax; a slow visible
// bolt is a thing you can sidestep, and that is what makes the new kinds a
// skill check rather than a nuisance.
export const MAX_EPROJ = 24;
export const eX = new Array<number>(MAX_EPROJ);
export const eY = new Array<number>(MAX_EPROJ);
export const eZ = new Array<number>(MAX_EPROJ);
export const eVX = new Array<number>(MAX_EPROJ);
export const eVY = new Array<number>(MAX_EPROJ);
export const eVZ = new Array<number>(MAX_EPROJ);
export const eLife = new Array<number>(MAX_EPROJ);
export const eDmg = new Array<number>(MAX_EPROJ);
export const eKind = new Array<number>(MAX_EPROJ);
for (let i = 0; i < MAX_EPROJ; i++) { eLife[i] = 0; eDmg[i] = 0; eKind[i] = 0; }

function spawnEnemyProjectile(x: number, y: number, z: number,
                              vx: number, vy: number, vz: number,
                              dmg: number, kind: number): void {
  eX[DIR.eprojNext] = x; eY[DIR.eprojNext] = y; eZ[DIR.eprojNext] = z;
  eVX[DIR.eprojNext] = vx; eVY[DIR.eprojNext] = vy; eVZ[DIR.eprojNext] = vz;
  eLife[DIR.eprojNext] = 3.0;
  eDmg[DIR.eprojNext] = dmg;
  eKind[DIR.eprojNext] = kind;
  DIR.eprojNext = (DIR.eprojNext + 1) % MAX_EPROJ;
}

export function despawnAllEnemies(): void {
  for (let i = 0; i < MAX_ENEMIES; i++) {
    // SH-031 — release any live ragdoll before wiping the slot, or its bodies
    // stay in the DEPS.o.physics world forever. A restart is exactly the moment such a
    // leak would go unnoticed.
    if (enRagActive[i] === 1 && enRagdoll[i] > 0) {
      releaseRagdoll(enRagdoll[i]);
      enRagdoll[i] = createRagdoll();
    }
    enRagActive[i] = 0;
    enAlive[i] = 0;
    enHP[i] = 0;
    enAttackCD[i] = 0;
    enFlashT[i] = 0;
    enPhase[i] = Math.random() * Math.PI * 2;
    enAnimClip[i] = -1;
    enAttackLayer[i] = 0;
    enFlinchLock[i] = 0;
    enDmgWindow[i] = 0;
    enDmgTimer[i] = 0;
    enDying[i] = 0;
    enDeathT[i] = 0;
    enDeathYaw[i] = 0;
    enX[i] = 0; enY[i] = -100; enZ[i] = 0;
    setBodyPosition(enBody[i], vec3(0, -100, 0), false);
  }
}

export function damageEnemy(i: number, dmg: number,
                     hx: number, hy: number, hz: number,
                     dirX: number, dirY: number, dirZ: number): void {
  const k = enKind[i];
  enHP[i] = enHP[i] - dmg;
  enFlashT[i] = DRETCH_HIT_FLASH;

  const groundY = terrainHeightAt(enX[i], enZ[i]);
  VFX.emitImpactFlesh(hx, hy, hz, dirX, dirY, dirZ,
                      KIND_BLOOD_R[k], KIND_BLOOD_G[k], KIND_BLOOD_B[k],
                      groundY + 0.02, Math.random() * 6.28);
  playSound3D(DEPS.o.sfxImpactFlesh, hx, hy, hz);
  GS.hitMarkT = 0.18;

  if (enHP[i] <= 0) {
    // Death: AI/waves see it gone (enAlive 0), the DEPS.o.physics body leaves play,
    // but the corpse keeps drawing while the die animation runs.
    enAlive[i] = 0;
    enDying[i] = 1;
    enDeathT[i] = 0;
    // Freeze the AI heading — a dragoon killed mid-charge collapses along its
    // charge line rather than snapping around toward the player.
    enDeathYaw[i] = enHeading[i];
    // SH-031 — remember the killing shot so the ragdoll is thrown along it.
    enDeathDX[i] = dirX;
    enDeathDY[i] = dirY;
    enDeathDZ[i] = dirZ;
    enDeathImp[i] = dmg;
    setBodyPosition(enBody[i], vec3(enX[i], -100, enZ[i]), false);
    playSound3D(DEPS.o.sfxAlienDie[k * 3 + (i % 3)], enX[i], enY[i] + 1, enZ[i]);

    VFX.emitDeathBurst(hx, hy, hz,
                       KIND_BLOOD_R[k], KIND_BLOOD_G[k], KIND_BLOOD_B[k],
                       0.6 + KIND_SCALE[k]);
    // SH-029 — hit-stop. The single cheapest way to make a kill land: the frame
    // holds for ~50 ms and the brain reads it as impact. Heavier kinds hold
    // longer, which is most of why killing a tyrant feels different.
    FEEL.requestHitstop(k >= 3 ? 0.09 : 0.05);
    FEEL.addTrauma(0.12 + KIND_SCALE[k] * 0.1);
    gamepadRumble(0.5, 0.4, 0.12);
    SCORE.noteKill(k);
    return;
  }

  // Not dead — should it flinch?
  // Light kinds flinch on any hit (with a lockout so sustained fire cannot
  // stun-lock them). Heavies need enough damage inside a window, so a tyrant
  // shrugs off a rifle but staggers under a cannon: unflinching by default is
  // what makes it frightening.
  const light = KIND_LIGHT[k] === 1;
  if (light) {
    if (enFlinchLock[i] <= 0) {
      enAIState[i] = AI_FLINCH;
      enStateT[i] = FLINCH_TIME;
      enFlinchLock[i] = FLINCH_LOCKOUT;
    }
  } else {
    enDmgWindow[i] = enDmgWindow[i] + dmg;
    enDmgTimer[i] = STAGGER_WINDOW;
    if (enDmgWindow[i] >= KIND_HP[k] * STAGGER_FRAC && enFlinchLock[i] <= 0) {
      enAIState[i] = AI_FLINCH;
      enStateT[i] = STAGGER_TIME;
      enFlinchLock[i] = FLINCH_LOCKOUT * 2;
      enDmgWindow[i] = 0;
      playSound3D(DEPS.o.sfxAlienPain[k], enX[i], enY[i] + 1, enZ[i]);
    }
  }
  if ((i & 3) === 0) {
    playSound3D(DEPS.o.sfxAlienPain[k], enX[i], enY[i] + 1, enZ[i]);
  }
}

/// The per-kind AI + the wave director — one call per frame. dtReal is
/// the unscaled frame dt (hit-stop scales dt; the music must not stall).
export function updateDirector(dt: number, dtReal: number, playing: boolean): void {
  // ---- Enemy AI + wave director (M5 / M6, Round-9 rework) ---------------
  // Old behaviour was a straight beeline + melee — every kind identical.
  // Now each kind runs its own steering flavour + state machine:
  //   dretch   — skittering swarm: full speed but weaving hard around the
  //              direct line, so packs wash around the player.
  //   mantis   — circler: orbits at ~7 m, darts in for one hit, backs off.
  //   marauder — flanker: approaches on a wide curve toward your side.
  //   dragoon  — pouncer: rooted 0.65 s telegraph (roar), then a locked-
  //              direction 3.4× charge you can sidestep.
  //   tyrant   — bulldozer: momentum builds in a straight line but the
  //              turn rate is capped, so dodging works and it has to
  //              wheel around after an overrun.
  // Shared: pairwise separation (no model-pile), trunk-circle avoidance
  // (enemies are kinematic — Jolt won't resolve their contacts), terrain
  // following, and a turn-rate-limited heading the draw code renders.
  if (playing) {
    const pp = playerPosition();
    const tAI = getTime();
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (enAlive[i] === 0) continue;
      const k = enKind[i];
      const dx = pp.x - enX[i];
      const dz = pp.z - enZ[i];
      const dist = Math.sqrt(dx * dx + dz * dz);
      const invD = dist > 0.001 ? 1 / dist : 0;
      const toPX = dx * invD;                    // unit vector to the player
      const toPZ = dz * invD;

      // SH-051 — the VERTICAL half of "where is the player", which this AI did
      // not have. `dist` above is XZ only: it is the right number for steering
      // (you walk around a building in plan), and it was also being used as the
      // melee range, where it is catastrophically wrong. An enemy on the ground
      // floor directly beneath a player on the first floor has dist ~= 0, so it
      // clawed them through the ceiling from 3.7 m below. That is the whole
      // "I die without them being physically near me" report.
      //
      // Feet-to-feet: playerPosition() is the capsule CENTRE (see
      // PLAYER_FEET_OFF), and an enemy's Y is its feet. Mixing them silently
      // hands out 0.95 m of extra reach.
      const pFeetY = pp.y - PLAYER_FEET_OFF;
      const dyFeet = pFeetY - enY[i];
      const sameFloor = Math.abs(dyFeet) <= SAME_FLOOR_EPS;
      if (enStateT[i] > 0) enStateT[i] = enStateT[i] - dt;
      if (enFlinchLock[i] > 0) enFlinchLock[i] = enFlinchLock[i] - dt;
      // Damage window for the heavies' stagger meter.
      if (enDmgTimer[i] > 0) {
        enDmgTimer[i] = enDmgTimer[i] - dt;
        if (enDmgTimer[i] <= 0) enDmgWindow[i] = 0;
      }

      // Steering output: desired velocity (m/s) + what to face.
      let vx = 0;
      let vz = 0;
      let faceX = toPX;
      let faceZ = toPZ;

      // SH-051 — cross-floor routing. When the player is on another storey, the
      // player's XZ position is the WRONG thing to walk at: it is through a
      // ceiling. Walk at the staircase instead, and let the per-kind AI resume
      // once we are on the same floor. Evaluated per frame from position alone
      // (no latched waypoint), so an enemy cannot get stuck holding a target it
      // has already walked past.
      if (!sameFloor) navGoal(enX[i], enY[i], enZ[i], pFeetY, NAVOUT);
      else NAVOUT[2] = 0;
      const navving = NAVOUT[2] === 1;

      // SH-030 — a flinching enemy is rooted. This is the whole point: it is
      // the reward for landing shots, and the window in which you can push.
      if (enAIState[i] === AI_FLINCH) {
        if (enStateT[i] <= 0) {
          enAIState[i] = AI_APPROACH;
          enStateT[i] = 0;
        }
        // No steering this frame — fall through to the shared tail below with
        // vx = vz = 0.
      } else if (navving) {
        // SH-051 — TRAVELLING. A plain seek to the stair waypoint, deliberately
        // bypassing the per-kind state machine: orbiting, darting and pounce
        // telegraphs are all about fighting the player, and this enemy cannot
        // reach the player yet. Running the dretch's weave up a 2.8 m-wide
        // staircase would just walk it off the side.
        const gx = NAVOUT[0] - enX[i];
        const gz = NAVOUT[1] - enZ[i];
        const gl = Math.sqrt(gx * gx + gz * gz);
        const gi = gl > 0.001 ? 1 / gl : 0;
        vx = gx * gi * KIND_SPEED[k];
        vz = gz * gi * KIND_SPEED[k];
        faceX = gx * gi;
        faceZ = gz * gi;
      } else if (k === 0) {
        // DRETCH — weave amplitude fades out inside 6 m so the final
        // lunge still connects; i*2.399 desyncs pack members.
        const weave = Math.sin(tAI * 3.0 + i * 2.399) * 0.85
                    * Math.min(1, Math.max(0, (dist - 2.5) / 4));
        const cw = Math.cos(weave), sw = Math.sin(weave);
        if (dist > KIND_MELEE[k] * 0.85) {
          vx = (toPX * cw - toPZ * sw) * KIND_SPEED[k] * 1.15;
          vz = (toPX * sw + toPZ * cw) * KIND_SPEED[k] * 1.15;
        }
      } else if (k === 1) {
        // MANTIS — approach → orbit → dart → back off.
        if (enAIState[i] === AI_APPROACH) {
          if (dist < 9) {
            enAIState[i] = AI_ORBIT;
            enStateT[i] = 1.2 + Math.random() * 1.4;
          } else {
            vx = toPX * KIND_SPEED[k];
            vz = toPZ * KIND_SPEED[k];
          }
        } else if (enAIState[i] === AI_ORBIT) {
          // Tangential motion + gentle spring toward the 7 m ring.
          const inward = Math.max(-1, Math.min(1, (dist - 7) * 0.3));
          vx = (-toPZ * enOrbitDir[i] + toPX * inward) * KIND_SPEED[k] * 0.9;
          vz = ( toPX * enOrbitDir[i] + toPZ * inward) * KIND_SPEED[k] * 0.9;
          if (dist > 14) enAIState[i] = AI_APPROACH;
          else if (enStateT[i] <= 0) {
            enAIState[i] = AI_CHARGE;              // dart in
            enStateT[i] = 1.1;
            enChargeX[i] = toPX;
            enChargeZ[i] = toPZ;
          }
        } else if (enAIState[i] === AI_CHARGE) {
          // Mostly locked, slight homing so it isn't trivially cheesed.
          const hx = enChargeX[i] * 0.8 + toPX * 0.2;
          const hz = enChargeZ[i] * 0.8 + toPZ * 0.2;
          const hl = Math.sqrt(hx * hx + hz * hz);
          enChargeX[i] = hx / hl;
          enChargeZ[i] = hz / hl;
          vx = enChargeX[i] * KIND_SPEED[k] * 1.85;
          vz = enChargeZ[i] * KIND_SPEED[k] * 1.85;
          faceX = enChargeX[i]; faceZ = enChargeZ[i];
          if (enStateT[i] <= 0) { enAIState[i] = AI_RECOVER; enStateT[i] = 0.8; }
        } else {
          // AI_RECOVER — back away facing the player, then re-approach.
          vx = (-toPX + -toPZ * enOrbitDir[i] * 0.5) * KIND_SPEED[k] * 0.8;
          vz = (-toPZ +  toPX * enOrbitDir[i] * 0.5) * KIND_SPEED[k] * 0.8;
          if (enStateT[i] <= 0) enAIState[i] = AI_APPROACH;
        }
      } else if (k === 2) {
        // MARAUDER — flank: aim beside the player, the offset shrinking
        // as it closes, so it comes in on a curve toward your side.
        const m = Math.min(6, Math.max(0, dist - 3) * 0.5);
        const aimX = pp.x - toPZ * enOrbitDir[i] * m - enX[i];
        const aimZ = pp.z + toPX * enOrbitDir[i] * m - enZ[i];
        const al = Math.sqrt(aimX * aimX + aimZ * aimZ);
        if (dist > KIND_MELEE[k] * 0.85 && al > 0.001) {
          vx = (aimX / al) * KIND_SPEED[k];
          vz = (aimZ / al) * KIND_SPEED[k];
        }
      } else if (k === 3) {
        // DRAGOON — pounce with a rooted, audible telegraph.
        if (enAIState[i] === AI_APPROACH) {
          if (dist > KIND_MELEE[k] * 0.9) {
            vx = toPX * KIND_SPEED[k];
            vz = toPZ * KIND_SPEED[k];
          }
          if (dist < 12 && dist > 4.5 && enStateT[i] <= 0) {
            enAIState[i] = AI_WINDUP;
            enStateT[i] = 0.65;
            playSound3D(DEPS.o.sfxAlienAttack[k], enX[i], enY[i] + 1, enZ[i]);  // roar
          }
        } else if (enAIState[i] === AI_WINDUP) {
          // Rooted — the player's dodge window.
          if (enStateT[i] <= 0) {
            enAIState[i] = AI_CHARGE;
            enStateT[i] = 1.2;
            enChargeX[i] = toPX;
            enChargeZ[i] = toPZ;
          }
        } else if (enAIState[i] === AI_CHARGE) {
          vx = enChargeX[i] * KIND_SPEED[k] * 3.4;   // fully locked — dodgeable
          vz = enChargeZ[i] * KIND_SPEED[k] * 3.4;
          faceX = enChargeX[i]; faceZ = enChargeZ[i];
          if (dist <= KIND_MELEE[k] || enStateT[i] <= 0) {
            enAIState[i] = AI_RECOVER;
            enStateT[i] = 1.4;
          }
        } else {
          // AI_RECOVER — winded: creep, then re-arm the pounce.
          if (dist > KIND_MELEE[k] * 0.9) {
            vx = toPX * KIND_SPEED[k] * 0.6;
            vz = toPZ * KIND_SPEED[k] * 0.6;
          }
          if (enStateT[i] <= 0) {
            enAIState[i] = AI_APPROACH;
            enStateT[i] = 1.5 + Math.random();       // pounce cooldown
          }
        }
      } else if (k === 4) {
        // TYRANT — heading-locked momentum. Speed builds only while the
        // player sits near its nose; hard turns bleed it off, so a
        // sidestep leaves 3+ tons wheeling around for another pass.
        const tgtYaw = Math.atan2(toPX, -toPZ);
        enHeading[i] = turnToward(enHeading[i], tgtYaw, 1.5 * dt);
        let err = tgtYaw - enHeading[i];
        while (err > Math.PI)  err = err - Math.PI * 2;
        while (err < -Math.PI) err = err + Math.PI * 2;
        const aligned = Math.cos(err);
        const accel = aligned > 0.8 ? 0.55 : -1.4;
        enSpeedMul[i] = Math.max(0.7, Math.min(2.6, enSpeedMul[i] + accel * dt));
        const hdX = Math.sin(enHeading[i]);
        const hdZ = -Math.cos(enHeading[i]);
        if (dist > KIND_MELEE[k] * 0.8 || aligned < 0.5) {
          vx = hdX * KIND_SPEED[k] * enSpeedMul[i];
          vz = hdZ * KIND_SPEED[k] * enSpeedMul[i];
        }
        faceX = hdX; faceZ = hdZ;
      } else {
        // SH-042 — RANGED (adv marauder, adv dragoon).
        //
        // Hold a band and shoot from it. Closer than MIN it backs off, further
        // than MAX it closes, and inside the band it strafes — so it is always
        // moving laterally, which is what makes it hard to hit without leading
        // and what stops the fight from becoming a staring contest.
        //
        // The volley is TELEGRAPHED: a rooted wind-up first (the attack clip
        // plays, the thing stops moving), then the rounds. Without that, ranged
        // damage arrives with no tell and reads as unfair rather than as
        // something you failed to dodge.
        const lo = RANGED_MIN[k];
        const hi = RANGED_MAX[k];
        const spd = KIND_SPEED[k];

        if (enRangedCD[i] > 0) enRangedCD[i] = enRangedCD[i] - dt;

        if (enAIState[i] === AI_WINDUP) {
          // Rooted telegraph — the dodge window.
          if (enStateT[i] <= 0) {
            enAIState[i] = AI_CHARGE;                 // reuse as "firing"
            enBurst[i] = RANGED_SHOTS[k];
            enBurstT[i] = 0;
          }
        } else if (enAIState[i] === AI_CHARGE) {
          // Firing the volley — still rooted, so the burst has a cost.
          enBurstT[i] = enBurstT[i] - dt;
          if (enBurstT[i] <= 0 && enBurst[i] > 0) {
            enBurst[i] = enBurst[i] - 1;
            enBurstT[i] = 0.14;

            const muzY = enY[i] + KIND_Y_OFF[k] * 0.8;
            const tx = pp.x - enX[i];
            const ty = (pp.y + 0.9) - muzY;
            const tz = pp.z - enZ[i];
            const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
            const sp = RANGED_SPREAD[k];
            const jx = (Math.random() * 2 - 1) * sp;
            const jy = (Math.random() * 2 - 1) * sp;
            const jz = (Math.random() * 2 - 1) * sp;
            const vsp = RANGED_SPEED[k];
            spawnEnemyProjectile(
              enX[i], muzY, enZ[i],
              (tx / tl + jx) * vsp, (ty / tl + jy) * vsp, (tz / tl + jz) * vsp,
              RANGED_DMG[k], k);
            playSound3D(DEPS.o.sfxAlienAttack[k], enX[i], muzY, enZ[i]);
            VFX.emitMuzzle(enX[i], muzY, enZ[i], tx / tl, ty / tl, tz / tl, 0, 0);
          }
          if (enBurst[i] <= 0) {
            enAIState[i] = AI_RECOVER;
            enStateT[i] = 0.5;
            enRangedCD[i] = RANGED_CD[k];
          }
        } else {
          // Reposition: hold the band, strafing.
          let radial = 0;
          if (dist > hi) radial = 1;          // too far — close
          else if (dist < lo) radial = -1;    // too close — back off
          const tangX = -toPZ * enOrbitDir[i];
          const tangZ =  toPX * enOrbitDir[i];
          vx = (toPX * radial + tangX * 0.85) * spd;
          vz = (toPZ * radial + tangZ * 0.85) * spd;

          if (enStateT[i] <= 0) {
            // Occasionally reverse the strafe so it is not a predictable circle.
            enOrbitDir[i] = -enOrbitDir[i];
            enStateT[i] = 1.5 + Math.random() * 2.0;
          }
          // In the band, with a clear-ish line and off cooldown -> telegraph.
          if (enRangedCD[i] <= 0 && dist >= lo * 0.8 && dist <= hi * 1.15) {
            enAIState[i] = AI_WINDUP;
            enStateT[i] = RANGED_WINDUP[k];
            playSound3D(DEPS.o.sfxAlienPain[k], enX[i], enY[i] + 1, enZ[i]);   // hiss/tell
          }
        }
      }

      // Separation — pack members shoulder each other apart instead of
      // stacking into one model pile.
      for (let j = 0; j < MAX_ENEMIES; j++) {
        if (j === i || enAlive[j] === 0) continue;
        const sx = enX[i] - enX[j];
        const sz = enZ[i] - enZ[j];
        const sd2 = sx * sx + sz * sz;
        const minS = (KIND_HX[k] + KIND_HX[enKind[j]]) * 0.7;
        if (sd2 < minS * minS && sd2 > 0.0001) {
          const sd = Math.sqrt(sd2);
          const push = ((minS - sd) / minS) * 3.0;
          vx = vx + (sx / sd) * push;
          vz = vz + (sz / sd) * push;
        }
      }

      // Integrate, then slide the tentative position out of any trunk
      // circle — projection keeps the tangential component, so enemies
      // skim around trees instead of head-butting them.
      let nx = enX[i] + vx * dt;
      let nz = enZ[i] + vz * dt;
      const bodyR = KIND_HX[k] * 0.55;
      for (let o = 0; o < GS.OBST_COUNT; o++) {
        const odx = nx - DEPS.o.OBST_X[o];
        const odz = nz - DEPS.o.OBST_Z[o];
        const minD = DEPS.o.OBST_R[o] + bodyR;
        const od2 = odx * odx + odz * odz;
        if (od2 < minD * minD && od2 > 0.000001) {
          const od = Math.sqrt(od2);
          nx = DEPS.o.OBST_X[o] + (odx / od) * minD;
          nz = DEPS.o.OBST_Z[o] + (odz / od) * minD;
        }
      }
      // SH-051 — the stairs' solid mass, which the obstacle circles above cannot
      // represent. They are 2D: a staircase is a wall from the high side and a
      // ramp from the low side, and only the walker's HEIGHT says which. Circles
      // had to pick one for everybody, and picking "wall" is what fenced enemies
      // out of the stairwell for good.
      //
      // Blocked head-on, walk AROUND. Axis-sliding is not enough and the
      // STAIRTEST harness proved it: an enemy that came into the house behind
      // the staircase wants to go due east to the bottom tread, its desired
      // velocity has no sideways component to slide on, so X-only and Z-only
      // both resolve to "don't move" and it presses into the wedge forever
      // (parked at -13.7, the stair's west face, for the whole run).
      //
      // So: when blocked, try the two perpendiculars and take the free one that
      // ends nearer the goal. The staircase is a convex box, and greedily
      // rounding a convex obstacle terminates — which is the whole reason this
      // is enough without a path graph. `d1 <= d2` breaks ties the same way
      // every frame, so it cannot dither on the centre line.
      if (navStairBlocked(nx, nz, enY[i])) {
        const spd = Math.sqrt(vx * vx + vz * vz);
        let moved = false;
        if (spd > 0.001) {
          const t1x = enX[i] + (-vz) * dt, t1z = enZ[i] + (vx) * dt;   // +90
          const t2x = enX[i] + (vz) * dt,  t2z = enZ[i] + (-vx) * dt;  // -90
          const f1 = !navStairBlocked(t1x, t1z, enY[i]);
          const f2 = !navStairBlocked(t2x, t2z, enY[i]);
          const gx2 = navving ? NAVOUT[0] : pp.x;
          const gz2 = navving ? NAVOUT[1] : pp.z;
          const d1 = (gx2 - t1x) * (gx2 - t1x) + (gz2 - t1z) * (gz2 - t1z);
          const d2 = (gx2 - t2x) * (gx2 - t2x) + (gz2 - t2z) * (gz2 - t2z);
          if (f1 && (!f2 || d1 <= d2)) { nx = t1x; nz = t1z; moved = true; }
          else if (f2) { nx = t2x; nz = t2z; moved = true; }
        }
        if (!moved) { nx = enX[i]; nz = enZ[i]; }
      }
      // Record the realised velocity BEFORE the obstacle projection is
      // forgotten — the draw pass matches animation playback to it.
      vxLast[i] = vx;
      vzLast[i] = vz;
      enX[i] = nx;
      enZ[i] = nz;
      // Follow the walkable surface — enemies are steered in XZ, so
      // their Y must track it or they walk into hills.
      //
      // SH-051 — this was `terrainHeightAt(nx, nz)`, which is why an enemy could
      // never be upstairs: the heightfield has no idea the house exists, so the
      // AI was permanently at ground level no matter what it stood on.
      // surfaceHeightAt adds the building's floors and treads, gated on how far
      // the enemy can step UP from where it already is (STEP_UP) — that gate is
      // what makes a 0.31 m tread climbable and a 3.7 m slab solid ceiling.
      enY[i] = surfaceHeightAt(nx, nz, enY[i]);
      setBodyPosition(enBody[i],
        vec3(nx, enY[i] + KIND_Y_OFF[k], nz), true);

      // Turn-rate-limited facing (tyrant already steered its own).
      if (k !== 4) {
        const wantYaw = Math.atan2(faceX, -faceZ);
        enHeading[i] = turnToward(enHeading[i], wantYaw, 7.0 * dt);
      }

      // Melee — hit-and-run kinds break off after connecting. Ranged kinds do
      // NOT melee: if they did, the right answer to them would be to walk up and
      // hug them, which is exactly the play they exist to punish.
      // SH-051 — `sameFloor` is the fix for the through-the-ceiling kill. Melee
      // needs the player within arm's reach in ALL THREE axes; `dist` only ever
      // knew about two. A claw that lands on someone standing on the floor above
      // is not a difficulty setting, it is a bug.
      if (KIND_RANGED[k] === 0 && sameFloor &&
          dist <= KIND_MELEE[k] && enAttackCD[i] <= 0 &&
          enAIState[i] !== AI_WINDUP && enAIState[i] !== AI_FLINCH) {
        GS.playerHP = GS.playerHP - KIND_DMG[k];
        GS.damageFlashT = 0.5;
        enAttackCD[i] = KIND_CD[k];
        // SH-029 — being hit is now unmistakable with your eyes on the
        // crosshair: the camera flinches AWAY from the attacker, the screen
        // flashes, and the music ducks so you hear the hit land.
        const hitYaw = Math.atan2(toPX, -toPZ);
        let rel = hitYaw - DEPS.o.CAM[0];
        while (rel > Math.PI) rel = rel - Math.PI * 2;
        while (rel < -Math.PI) rel = rel + Math.PI * 2;
        GS.lastHitAngle = rel;
        GS.lastHitT = 1.4;
        FEEL.addTrauma(0.30 + KIND_DMG[k] * 0.006);
        FEEL.flinch(-Math.sign(rel) * 0.035, -0.02);
        FEEL.damageFlash(1);
        MIX.duckMusicOnDamage();
        gamepadRumble(0.55, 0.35, 0.18);
        // Per-kind bite/claw at the attacker's position.
        playSound3D(DEPS.o.sfxAlienAttack[k], enX[i], enY[i] + 1, enZ[i]);
        if (k === 1) { enAIState[i] = AI_RECOVER; enStateT[i] = 1.3; }
        if (k === 3) { enAIState[i] = AI_RECOVER; enStateT[i] = 1.4; }
        if (GS.playerHP <= 0) {
          GS.playerHP = 0;
          if (!GS.gameOver) {
            playSound(DEPS.o.sfxPlayerDie[i & 1]);
            FEEL.addTrauma(1.0);
            SCORE.commitRun(W.ARENA_INDEX);
            SET.saveSettings();     // persist the best score immediately
            playSound(DEPS.o.stingDeath);  // SH-036
          }
          GS.gameOver = true;
        } else {
          playSound(DEPS.o.sfxPlayerPain[i & 1]);
        }
      }
      if (enAttackCD[i] > 0) enAttackCD[i] = enAttackCD[i] - dt;
      if (enFlashT[i]   > 0) enFlashT[i]   = enFlashT[i]   - dt;
      enPhase[i] = enPhase[i] + dt;   // seconds into current animation

      // SH-003 — the tyrant's footfalls. You should hear (and faintly feel) the
      // big one coming before you see it: the trauma is distance-scaled, so it
      // telegraphs through walls without ever being loud enough to annoy.
      if (k === 4) {
        const spd = Math.sqrt(vx * vx + vz * vz);
        enStepPhase[i] = enStepPhase[i] + spd * dt;
        if (enStepPhase[i] > 2.2) {
          enStepPhase[i] = 0;
          MIX.tyrantStep(enX[i], enY[i], enZ[i]);
          if (dist < 15) FEEL.addTrauma(0.05 * (1 - dist / 15));
          VFX.emitFootDust(enX[i], enY[i] + 0.05, enZ[i], 3);
        }
      }
    }

    // Pickups — proximity collect, respawn after delay. The crate refills the
    // weapon it is for; the amount is a column of the weapon table now.
    for (let i = 0; i < DEPS.o.PICKUP_COUNT; i++) {
      if (DEPS.o.pickupActive[i] === 0) {
        DEPS.o.pickupRespawnT[i] = DEPS.o.pickupRespawnT[i] - dt;
        if (DEPS.o.pickupRespawnT[i] <= 0) DEPS.o.pickupActive[i] = 1;
        continue;
      }
      const pdx = pp.x - DEPS.o.pickupX[i];
      const pdz = pp.z - DEPS.o.pickupZ[i];
      // Same-floor gate: the house stacks pickups on three levels now, and an
      // XZ-only radius let the ground floor hoover up the roof cache.
      const pdy = pp.y - DEPS.o.pickupY[i];
      if (pdx * pdx + pdz * pdz < DEPS.o.PICKUP_RADIUS * DEPS.o.PICKUP_RADIUS
          && pdy > -2.0 && pdy < 2.0) {
        const w = DEPS.o.pickupKind[i] === DEPS.o.PICKUP_RIFLE ? WPN.W_RIFLE : WPN.W_BLASTER;
        WPN.addAmmo(w, WPN.W_PICKUP_AMT[w]);
        // Ammo you can't use is no reward: top up whatever else you carry too.
        for (let q = 2; q < WPN.WEAPON_COUNT; q++) {
          if (WPN.isUnlocked(q)) WPN.addAmmo(q, Math.floor(WPN.W_PICKUP_AMT[q] * 0.5));
        }
        DEPS.o.pickupActive[i] = 0;
        DEPS.o.pickupRespawnT[i] = DEPS.o.PICKUP_RESPAWN;
        playSound(DEPS.o.sfxPickup);
      }
    }

    // Wave director
    const alive = countAlive();
    MIX.updateMusicIntensity(dtReal, alive, DIR.waveBreakTimer <= 0);
    if (DIR.waveIdx < wavePlan.length) {
      if (DIR.waveBreakTimer > 0) {
        DIR.waveBreakTimer = DIR.waveBreakTimer - dt;
        if (DIR.waveBreakTimer <= 0) SCORE.beginWave(GS.runElapsed);
      } else {
        const waveSize = wavePlan[DIR.waveIdx];
        if (DIR.waveSpawned < waveSize && alive < MAX_CONCURRENT) {
          DIR.spawnTimer = DIR.spawnTimer - dt;
          if (DIR.spawnTimer <= 0) {
            spawnEnemy();
            DIR.spawnTimer = WAVE_SPAWN_DELAY;
          }
        }
        if (DIR.waveSpawned >= waveSize && alive === 0) {
          // SH-041 — bank the wave: a time bonus for clearing fast, an accuracy
          // bonus for clearing cleanly. Shown on the report card.
          GS.waveBonus = SCORE.endWave(GS.runElapsed);
          GS.waveBonusT = 4.0;
          DIR.waveIdx = DIR.waveIdx + 1;
          DIR.waveSpawned = 0;
          DIR.waveBreakTimer = WAVE_BREAK_DELAY;
          if (DIR.waveIdx >= wavePlan.length) {
            DIR.gameWon = true;
            // SH-036 — the run is over; the victory sting replaces the wave-clear
            // one rather than stacking on top of it.
            playSound(DEPS.o.stingVictory);
            // Clearing the arena unlocks the next weapon and persists it.
            const nextUnlock = WPN.W_CHAIN;
            if (!WPN.isUnlocked(nextUnlock)) {
              WPN.unlock(nextUnlock);
              SET.setUnlockMask(SET.unlockMask() | (1 << nextUnlock));
              GS.unlockBannerT = 5.0;
            }
            SCORE.commitRun(W.ARENA_INDEX);
            SET.saveSettings();
          } else {
            // SH-036 — a wave died and another is coming. The sting lands over the
            // bed while the mixer is already crossfading combat -> calm.
            playSound(DEPS.o.stingWaveClear);
          }
        }
      }
    }
  }
}

/// Enemy bolt flight + player hits — one call per frame.
export function updateEnemyProjectiles(dt: number, playing: boolean): void {
  // ---- SH-042: enemy projectiles ----------------------------------------
  // Segment-raycast like the player's, so a fast bolt can't tunnel a wall — and
  // so it can be BLOCKED by the world, which is what turns the building and the
  // treeline into cover.
  // One position read for the whole pool — this used to be an FFI call PER
  // BOLT, up to 24 a frame, for a value that cannot change mid-loop.
  const ppE = playerPosition();
  for (let i = 0; i < MAX_EPROJ; i++) {
    if (eLife[i] <= 0) continue;
    eVY[i] = eVY[i] - 3.0 * dt;            // slight droop: it reads as a lob
    const ox = eX[i], oy = eY[i], oz = eZ[i];
    const nx2 = ox + eVX[i] * dt;
    const ny2 = oy + eVY[i] * dt;
    const nz2 = oz + eVZ[i] * dt;
    const sx2 = nx2 - ox, sy2 = ny2 - oy, sz2 = nz2 - oz;
    const seg = Math.sqrt(sx2 * sx2 + sy2 * sy2 + sz2 * sz2);
    const inv2 = seg > 0 ? 1 / seg : 0;

    // Does it reach the player this step? Point-segment distance against the
    // capsule, which is cheaper and fairer than raycasting at a moving target.
    const rx = ppE.x - ox, ry = (ppE.y + 0.2) - oy, rz = ppE.z - oz;
    const t = Math.max(0, Math.min(seg, rx * sx2 * inv2 + ry * sy2 * inv2 + rz * sz2 * inv2));
    const cxp = ox + sx2 * inv2 * t, cyp = oy + sy2 * inv2 * t, czp = oz + sz2 * inv2 * t;
    const dxp = ppE.x - cxp, dyp = (ppE.y + 0.2) - cyp, dzp = ppE.z - czp;
    const hitPlayer = (dxp * dxp + dyp * dyp + dzp * dzp) < 0.55 * 0.55;

    if (hitPlayer && playing) {
      GS.playerHP = GS.playerHP - eDmg[i];
      GS.damageFlashT = 0.5;
      FEEL.addTrauma(0.25);
      FEEL.damageFlash(1);
      MIX.duckMusicOnDamage();
      gamepadRumble(0.45, 0.3, 0.15);
      playSound3D(DEPS.o.sfxImpactFlesh, cxp, cyp, czp);
      VFX.emitImpactHard(cxp, cyp, czp, -sx2 * inv2, -sy2 * inv2, -sz2 * inv2,
                         Math.random() * 6.28);
      // Where did it come from? Same arc the melee hits drive.
      const ang = Math.atan2(-sx2 * inv2, sz2 * inv2);
      let rel2 = ang - DEPS.o.CAM[0];
      while (rel2 > Math.PI) rel2 = rel2 - Math.PI * 2;
      while (rel2 < -Math.PI) rel2 = rel2 + Math.PI * 2;
      GS.lastHitAngle = rel2;
      GS.lastHitT = 1.4;
      if (GS.playerHP <= 0) {
        GS.playerHP = 0;
        if (!GS.gameOver) {
          playSound(DEPS.o.sfxPlayerDie[0]);
          FEEL.addTrauma(1.0);
          SCORE.commitRun(W.ARENA_INDEX);
          SET.saveSettings();
          playSound(DEPS.o.stingDeath);    // SH-036
        }
        GS.gameOver = true;
      } else {
        playSound(DEPS.o.sfxPlayerPain[i & 1]);
      }
      eLife[i] = 0;
      continue;
    }

    const hitW = raycast(DEPS.o.physics, vec3(ox, oy, oz),
                         vec3(sx2 * inv2, sy2 * inv2, sz2 * inv2),
                         seg, 1 << Layer.NON_MOVING);
    if (hitW) {
      const nw = hitW.normal;
      VFX.emitImpactHard(hitW.point.x, hitW.point.y, hitW.point.z,
                         nw.x, nw.y, nw.z, Math.random() * 6.28);
      eLife[i] = 0;
      continue;
    }

    eX[i] = nx2; eY[i] = ny2; eZ[i] = nz2;
    eLife[i] = eLife[i] - dt;
  }

}
