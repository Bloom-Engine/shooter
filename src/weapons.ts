// SH-028 / SH-042 — weapon mechanics.
//
// Before this: two weapons, an instant `R` that refilled the mag, a raycast
// with zero spread straight down the camera, and "recoil" that slid the gun
// model back 18 cm for one frame. Firing had no arc and no consequence.
//
// The four systems that give a shooter its gunfeel all interact, so they live
// together: spread grows as you hold the trigger and recovers when you stop;
// recoil walks the camera and recovers toward where you were aiming; aiming
// tightens both; reloading takes time you can be punished for.
//
// Every weapon is a ROW in the stat table, not a branch in the code — adding
// the chaingun and the cannon below cost no new logic.

const MAX_WEAPONS = 4;

export const W_RIFLE   = 0;
export const W_BLASTER = 1;
export const W_CHAIN   = 2;   // unlocked by clearing arena_01 (SH-041)
export const W_CANNON  = 3;   // unlocked by clearing arena_02

export const WEAPON_COUNT = MAX_WEAPONS;
export const WEAPON_NAMES = ['RIFLE', 'BLASTER', 'CHAINGUN', 'CANNON'];

// --- stat table (flat arrays, Perry convention) ------------------------------
// Projectile weapons have PROJ_SPEED > 0; the rest are hitscan.
export const W_MAG        = [30,   20,   120,  4];
export const W_FIRE_CD    = [0.10, 0.35, 0.05, 0.9];   // seconds between shots
export const W_DAMAGE     = [1,    2,    1,    8];
export const W_RELOAD     = [1.6,  2.0,  3.2,  2.4];   // seconds
export const W_SPREAD0    = [0.8,  0.0,  2.5,  0.0];   // degrees, base cone
export const W_SPREAD_ADD = [0.25, 0.0,  0.35, 0.0];   // degrees added per shot
export const W_SPREAD_MAX = [3.0,  0.0,  7.0,  0.0];
export const W_SPREAD_REC = [4.0,  0.0,  6.0,  0.0];   // degrees recovered / sec
export const W_KICK       = [0.35, 1.2,  0.22, 3.0];   // degrees of pitch per shot
export const W_KICK_YAW   = [0.12, 0.25, 0.18, 0.4];   // random horizontal wobble
export const W_PROJ_SPEED = [0,    40,   0,    28];    // 0 = hitscan
export const W_AUTO       = [1,    0,    1,    0];     // 1 = hold to fire
export const W_SPINUP     = [0,    0,    0.5,  0];     // chaingun spool time
export const W_CHARGE     = [0,    0,    0,    1.5];   // cannon max charge time
export const W_AOE        = [0,    0,    0,    4.0];   // explosion radius, metres
export const W_PICKUP_AMT = [15,   8,    40,   2];     // ammo per crate

// --- mutable state, one flat array (see feel.ts on why not module `let`s) ----
//   0 current weapon
//   1 fire cooldown
//   2 spread (degrees, current)
//   3 reload timer (0 = not reloading)
//   4 aim blend 0..1
//   5 spinup 0..1
//   6 charge seconds held
//   7 was-firing latch (for the chaingun spool-down)
const S = [0, 0, 0, 0, 0, 0, 0, 0];

// Magazine vs reserve. The old code had ONE number per weapon and `R` simply
// reset it to the magazine size — a free refill, so ammo was never a resource
// and pickups had nothing to give you. Splitting them is what makes a reload a
// cost (it consumes reserve) and a crate a reward (it adds reserve).
const mag = new Array<number>(MAX_WEAPONS);
const reserve = new Array<number>(MAX_WEAPONS);
const unlocked = new Array<number>(MAX_WEAPONS);

// Starting reserve, in magazines.
const START_MAGS = [4, 4, 2, 3];
const MAX_MAGS   = [8, 8, 4, 5];

export function initWeapons(): void {
  for (let i = 0; i < MAX_WEAPONS; i++) {
    mag[i] = W_MAG[i];
    reserve[i] = W_MAG[i] * START_MAGS[i];
    unlocked[i] = i < 2 ? 1 : 0;   // rifle + blaster from the start
  }
  S[0] = W_RIFLE; S[1] = 0; S[2] = W_SPREAD0[W_RIFLE];
  S[3] = 0; S[4] = 0; S[5] = 0; S[6] = 0; S[7] = 0;
}

export function resetWeapons(): void { initWeapons(); }

export function currentWeapon(): number { return S[0]; }
export function currentAmmo(): number { return mag[S[0]]; }
export function currentReserve(): number { return reserve[S[0]]; }
export function magSize(w: number): number { return W_MAG[w]; }
export function isUnlocked(w: number): boolean { return unlocked[w] === 1; }
export function unlock(w: number): void { if (w >= 0 && w < MAX_WEAPONS) unlocked[w] = 1; }

/// Ammo crates fill the RESERVE, capped so hoarding has a limit.
export function addAmmo(w: number, n: number): void {
  reserve[w] = reserve[w] + n;
  const cap = W_MAG[w] * MAX_MAGS[w];
  if (reserve[w] > cap) reserve[w] = cap;
}

/// True when the weapon is dry in every sense — nothing to fire, nothing to
/// reload with. The HUD needs to say so, or the player just hears clicks.
export function isEmpty(): boolean {
  return mag[S[0]] <= 0 && reserve[S[0]] <= 0;
}

export function isReloading(): boolean { return S[3] > 0; }
/// 0..1 for the HUD's reload bar.
export function reloadProgress(): number {
  const w = S[0];
  if (S[3] <= 0) return 0;
  return 1 - S[3] / W_RELOAD[w];
}

export function aimBlend(): number { return S[4]; }
export function spinup(): number { return S[5]; }
export function chargeLevel(): number {
  const w = S[0];
  if (W_CHARGE[w] <= 0) return 0;
  return Math.min(1, S[6] / W_CHARGE[w]);
}
/// Current cone half-angle in RADIANS, after the aim multiplier.
export function spreadRad(): number {
  const aimMul = 1 - S[4] * 0.6;    // ADS tightens to 40%
  return (S[2] * Math.PI / 180) * aimMul;
}

export function selectWeapon(w: number): void {
  if (w < 0 || w >= MAX_WEAPONS) return;
  if (unlocked[w] !== 1) return;
  if (w === S[0]) return;
  S[0] = w;
  S[2] = W_SPREAD0[w];
  S[3] = 0;      // switching cancels a reload — a real cost, and a real option
  S[5] = 0;
  S[6] = 0;
}

/// Cycle to the next unlocked weapon (the `2`/`GUN` key and the pad's Y).
export function nextWeapon(): void {
  for (let i = 1; i <= MAX_WEAPONS; i++) {
    const w = (S[0] + i) % MAX_WEAPONS;
    if (unlocked[w] === 1) { selectWeapon(w); return; }
  }
}

export function beginReload(): void {
  const w = S[0];
  if (S[3] > 0) return;
  if (mag[w] >= W_MAG[w]) return;   // already full
  if (reserve[w] <= 0) return;      // nothing to load — the click IS the feedback
  S[3] = W_RELOAD[w];
}

/// Interrupt a reload — dodging, switching, dying.
export function cancelReload(): void { S[3] = 0; }

/// Advance cooldowns, spread recovery, aim/spinup blends, reload.
/// `firing` is whether the trigger is held; `aiming` whether ADS is held.
export function updateWeapons(dt: number, firing: boolean, aiming: boolean): void {
  const w = S[0];

  if (S[1] > 0) S[1] = S[1] - dt;

  // Reload completes: move what the reserve can spare into the magazine.
  if (S[3] > 0) {
    S[3] = S[3] - dt;
    if (S[3] <= 0) {
      S[3] = 0;
      const need = W_MAG[w] - mag[w];
      const take = need < reserve[w] ? need : reserve[w];
      mag[w] = mag[w] + take;
      reserve[w] = reserve[w] - take;
    }
  }

  // Spread recovers only while NOT firing — otherwise full-auto would settle
  // into a steady state and never punish holding the trigger.
  if (!firing && S[2] > W_SPREAD0[w]) {
    S[2] = S[2] - W_SPREAD_REC[w] * dt;
    if (S[2] < W_SPREAD0[w]) S[2] = W_SPREAD0[w];
  }

  // Aim blend.
  const aimTarget = aiming ? 1 : 0;
  const ak = 1 - Math.exp(-10.0 * dt);
  S[4] = S[4] + (aimTarget - S[4]) * ak;

  // Chaingun spool: winds up while held, winds down when released.
  if (W_SPINUP[w] > 0) {
    const dir = firing ? 1 : -1;
    S[5] = S[5] + (dir * dt) / W_SPINUP[w];
    if (S[5] < 0) S[5] = 0;
    if (S[5] > 1) S[5] = 1;
  } else {
    S[5] = 0;
  }

  // Charge weapons accumulate while held.
  if (W_CHARGE[w] > 0 && firing && S[3] <= 0 && mag[w] > 0) {
    S[6] = S[6] + dt;
    if (S[6] > W_CHARGE[w]) S[6] = W_CHARGE[w];
  }

  S[7] = firing ? 1 : 0;
}

/// Can we fire *right now*? Charge weapons answer false while the trigger is
/// still held — they fire on RELEASE (see `releaseCharge`).
export function canFire(firing: boolean): boolean {
  const w = S[0];
  if (S[3] > 0) return false;          // reloading
  if (S[1] > 0) return false;          // cooldown
  if (mag[w] <= 0) return false;
  if (W_CHARGE[w] > 0) return false;   // charge weapons fire on release
  if (W_SPINUP[w] > 0 && S[5] < 1) return false;  // still spooling
  if (!firing) return false;
  return true;
}

/// For charge weapons: the trigger was released — should we fire, and at what
/// charge (0..1)? Returns -1 if there is nothing to fire.
export function releaseCharge(): number {
  const w = S[0];
  if (W_CHARGE[w] <= 0) return -1;
  if (S[6] <= 0) return -1;
  const lvl = Math.min(1, S[6] / W_CHARGE[w]);
  S[6] = 0;
  if (S[3] > 0 || mag[w] <= 0) return -1;
  S[1] = W_FIRE_CD[w];
  mag[w] = mag[w] - 1;
  return lvl;
}

/// Commit a shot: spend ammo, start the cooldown, bloom the spread.
/// Returns the pitch/yaw camera kick to apply (caller feeds it to the camera).
/// `kickOut[0]` = pitch degrees, `kickOut[1]` = yaw degrees.
export function fireShot(kickOut: number[]): void {
  const w = S[0];
  mag[w] = mag[w] - 1;
  S[1] = W_FIRE_CD[w];

  S[2] = S[2] + W_SPREAD_ADD[w];
  if (S[2] > W_SPREAD_MAX[w]) S[2] = W_SPREAD_MAX[w];

  // Kick is reduced while aiming — bracing the weapon is the whole point of ADS.
  const aimMul = 1 - S[4] * 0.45;
  kickOut[0] = W_KICK[w] * aimMul;
  kickOut[1] = (Math.random() * 2 - 1) * W_KICK_YAW[w] * aimMul;
}

/// Auto-reload when the mag runs dry, so the player is never stuck holding a
/// dead trigger wondering what happened.
export function autoReloadIfEmpty(): void {
  const w = S[0];
  if (mag[w] <= 0 && S[3] <= 0) beginReload();
}

/// Perturb a unit direction inside the current spread cone. `f`/`r`/`u` are
/// the camera's forward/right/up.
export function applySpread(
  fx: number, fy: number, fz: number,
  rx: number, ry: number, rz: number,
  ux: number, uy: number, uz: number,
  out: number[],
): void {
  const s = spreadRad();
  if (s <= 0.0001) { out[0] = fx; out[1] = fy; out[2] = fz; return; }
  // Uniform inside the cone: sqrt() on the radius, or shots cluster at the
  // centre and the cone reads tighter than it is.
  const a = Math.random() * Math.PI * 2;
  const t = Math.sqrt(Math.random()) * s;
  const st = Math.sin(t);
  const ct = Math.cos(t);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  out[0] = fx * ct + (rx * ca + ux * sa) * st;
  out[1] = fy * ct + (ry * ca + uy * sa) * st;
  out[2] = fz * ct + (rz * ca + uz * sa) * st;
  const l = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
  if (l > 0.0001) { out[0] /= l; out[1] /= l; out[2] /= l; }
}

