// SH-028 / SH-042 — weapon mechanics.
//
// Before this: two weapons, an instant `R` that refilled the mag, a raycast
// with zero spread straight down the camera, and "recoil" that slid the gun
// model back 18 cm for one frame. Firing had no arc and no consequence.
//
// The four systems that give a shooter its gunfeel all interact, so they live
// together: spread grows as you hold the trigger and recovers when you stop;
// recoil walks the camera along an AUTHORED pattern per weapon and comes back
// when the trigger is released (plan 2.8: only what the player has not already
// pulled back themselves); aiming tightens both; reloading takes time you can be
// punished for.
//
// What makes each weapon its own (plan 2.8):
//   RIFLE     the marksman's gun. First round from a settled, aimed rifle goes exactly where
//             the crosshair is, headshots are worth 2.5x, full damage out to 30 m.
//   BLASTER   slow heavy bolts that go THROUGH what they hit (two bodies), no falloff.
//   CHAINGUN  starts wild and tightens as the barrels come up to speed; carrying it spun up
//             slows the walk; damage drops off early.
//   CANNON    charge and release, an explosion that hurts its owner too.
//
// Every weapon is a ROW in the stat table, not a branch in the code — adding
// the chaingun and the cannon below cost no new logic.

const MAX_WEAPONS = 4;

export const W_RIFLE   = 0;
export const W_BLASTER = 1;
export const W_CHAIN   = 2;   // unlocked by clearing the first arena in arenas.json
export const W_CANNON  = 3;   // unlocked by clearing any later arena (director.ts)

export const WEAPON_COUNT = MAX_WEAPONS;
export const WEAPON_NAMES = ['RIFLE', 'BLASTER', 'CHAINGUN', 'CANNON'];

// --- stat table (flat arrays, Perry convention) ------------------------------
// Projectile weapons have PROJ_SPEED > 0; the rest are hitscan.
export const W_MAG        = [30,   20,   120,  4];
export const W_FIRE_CD    = [0.10, 0.35, 0.05, 0.9];   // seconds between shots
export const W_DAMAGE     = [10,   22,   8,    90];    // x10 since plan 2.3 (see enemies.ts KIND_HP)
export const W_RELOAD     = [1.6,  2.0,  3.2,  2.4];   // seconds
export const W_SPREAD0    = [0.8,  0.0,  5.5,  0.0];   // degrees, base cone
export const W_SPREAD_ADD = [0.25, 0.0, -0.22, 0.0];   // degrees added per shot (the chaingun TIGHTENS)
export const W_SPREAD_MAX = [3.0,  0.0,  5.5,  0.0];
export const W_SPREAD_MIN = [0.8,  0.0,  1.6,  0.0];   // floor for a weapon whose cone shrinks
export const W_SPREAD_REC = [4.0,  0.0,  6.0,  0.0];   // degrees recovered / sec
export const W_KICK       = [0.35, 1.2,  0.22, 3.0];   // degrees of pitch per shot
export const W_KICK_YAW   = [0.12, 0.25, 0.18, 0.4];   // random horizontal wobble
export const W_PROJ_SPEED = [0,    40,   0,    28];    // 0 = hitscan
export const W_AUTO       = [1,    0,    1,    0];     // 1 = hold to fire
export const W_SPINUP     = [0,    0,    0.5,  0];     // chaingun spool time
export const W_CHARGE     = [0,    0,    0,    1.5];   // cannon max charge time
export const W_AOE        = [0,    0,    0,    4.0];   // explosion radius, metres
export const W_PICKUP_AMT = [15,   8,    40,   2];     // ammo per crate
// Damage falloff (hitscan only): full to START metres, down to MIN x at END and beyond.
export const W_FALL_START = [30,   0,    14,   0];
export const W_FALL_END   = [55,   0,    38,   0];
export const W_FALL_MIN   = [0.6,  1,    0.4,  1];
export const W_HEAD_MUL   = [1.25, 1.0,  0.75, 1.0];   // on top of the x2 for a head
export const W_PIERCE     = [0,    1,    0,    0];     // extra bodies a bolt passes through
export const W_CARRY_MUL  = [1,    1,    0.6,  1];     // walk speed while this weapon is spun up
// Recoil patterns: degrees of (pitch up, yaw right) for shot n of a burst, PAT_LEN entries per
// weapon; a burst longer than the pattern repeats its last PAT_LOOP entries. The pattern is what
// a player can learn: the rifle climbs, leans right, then swings back left.
const PAT_LEN = 10;
const PAT_LOOP = 4;
const PAT_PITCH = [
  0.42, 0.40, 0.38, 0.34, 0.30, 0.24, 0.20, 0.18, 0.16, 0.16,     // rifle
  1.30, 1.10, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00,     // blaster
  0.26, 0.24, 0.22, 0.20, 0.18, 0.16, 0.15, 0.14, 0.14, 0.14,     // chaingun
  3.00, 3.00, 3.00, 3.00, 3.00, 3.00, 3.00, 3.00, 3.00, 3.00,     // cannon
];
const PAT_YAW = [
  0.00, 0.04, 0.10, 0.16, 0.18, 0.10, -0.06, -0.16, -0.18, -0.08, // rifle
  0.10, -0.12, 0.10, -0.10, 0.10, -0.10, 0.10, -0.10, 0.10, -0.10,// blaster
  0.10, 0.14, 0.06, -0.08, -0.14, -0.10, 0.04, 0.12, 0.08, -0.06, // chaingun
  0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,     // cannon
];
const KICK_JITTER = 0.25;      // fraction of random wobble on top of the pattern
const BURST_RESET = 0.28;      // seconds off the trigger before the pattern starts over
const RECOIL_RECOVER = 9.0;    // fraction of the outstanding kick returned per second

// --- mutable state, one flat array (see feel.ts on why not module `let`s) ----
//   0 current weapon
//   1 fire cooldown
//   2 spread (degrees, current)
//   3 reload timer (0 = not reloading)
//   4 aim blend 0..1
//   5 spinup 0..1
//   6 charge seconds held
//   7 was-firing latch (for the chaingun spool-down)
//   8 shots in the current burst (indexes the recoil pattern)
//   9 seconds since the last shot
//  10 recoil still owed back to the camera, pitch (radians, positive = it kicked up)
//  11 the same for yaw (radians, positive = it kicked right)
//  12 seconds left of the draw after a weapon switch
const S = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// Magazine vs reserve. The old code had ONE number per weapon and `R` simply
// reset it to the magazine size — a free refill, so ammo was never a resource
// and pickups had nothing to give you. Splitting them is what makes a reload a
// cost (it consumes reserve) and a crate a reward (it adds reserve).
const mag = new Array<number>(MAX_WEAPONS);
const reserve = new Array<number>(MAX_WEAPONS);
const unlocked = new Array<number>(MAX_WEAPONS);

// Starting reserve, in magazines.
/// Seconds a freshly selected weapon needs before it can fire.
export const SWAP_TIME = 0.35;
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
  S[8] = 0; S[9] = 9; S[10] = 0; S[11] = 0; S[12] = 0;
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
  // The rifle's first round: settled (no bloom left) and fully aimed, it has no cone at all.
  if (S[0] === W_RIFLE && S[4] > 0.9 && S[2] <= W_SPREAD0[W_RIFLE] + 0.001 && S[8] === 0) return 0;
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
  S[8] = 0;
  // The draw time: the new weapon cannot fire while it comes up (plan 2.8 handling).
  S[12] = SWAP_TIME;
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
  if (S[12] > 0) S[12] = S[12] - dt;

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
  // into a steady state and never punish holding the trigger. (For the chaingun
  // "recovery" runs the other way: its cone opens back up as the barrels slow.)
  if (!firing && S[2] > W_SPREAD0[w]) {
    S[2] = S[2] - W_SPREAD_REC[w] * dt;
    if (S[2] < W_SPREAD0[w]) S[2] = W_SPREAD0[w];
  }
  if (!firing && S[2] < W_SPREAD0[w]) {
    S[2] = S[2] + W_SPREAD_REC[w] * dt;
    if (S[2] > W_SPREAD0[w]) S[2] = W_SPREAD0[w];
  }
  S[9] = S[9] + dt;
  if (S[9] > BURST_RESET) S[8] = 0;

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
  if (S[12] > 0) return false;         // still drawing it
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
  if (S[3] > 0 || S[12] > 0 || mag[w] <= 0) return -1;
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
  if (S[2] < W_SPREAD_MIN[w]) S[2] = W_SPREAD_MIN[w];

  // The pattern step for this round of the burst, plus a little wobble so it is a tendency to
  // learn and not a rail. Kick is reduced while aiming: bracing the weapon is the point of ADS.
  let n = S[8];
  if (n >= PAT_LEN) n = PAT_LEN - PAT_LOOP + ((n - PAT_LEN) % PAT_LOOP);
  S[8] = S[8] + 1;
  S[9] = 0;
  const aimMul = 1 - S[4] * 0.45;
  const jit = (Math.random() * 2 - 1) * KICK_JITTER;
  kickOut[0] = PAT_PITCH[w * PAT_LEN + n] * (1 + jit * 0.5) * aimMul;
  kickOut[1] = (PAT_YAW[w * PAT_LEN + n] + jit * W_KICK_YAW[w]) * aimMul;
}

/// The camera was kicked by this much (radians: pitch up, yaw right). It is owed back.
export function noteKick(pitchRad: number, yawRad: number): void {
  S[10] = S[10] + pitchRad;
  S[11] = S[11] + yawRad;
}

/// The player moved the view (radians; lookY > 0 = down, lookX > 0 = right). Whatever part of
/// that fights the recoil is theirs: it comes off what the recovery would hand back, so pulling
/// down through a burst does not end with the crosshair below where it started.
export function consumeRecoil(lookX: number, lookY: number): void {
  if (lookY > 0 && S[10] > 0) { S[10] = S[10] - lookY; if (S[10] < 0) S[10] = 0; }
  if (lookX < 0 && S[11] > 0) { S[11] = S[11] + lookX; if (S[11] < 0) S[11] = 0; }
  if (lookX > 0 && S[11] < 0) { S[11] = S[11] + lookX; if (S[11] > 0) S[11] = 0; }
}

/// Recoil recovery for this frame: how far to bring the camera back (out[0] pitch DOWN,
/// out[1] yaw LEFT, radians). Only between bursts.
export function recoverRecoil(dt: number, firing: boolean, out: number[]): void {
  out[0] = 0; out[1] = 0;
  if (firing || S[9] < 0.10) return;
  const k = 1 - Math.exp(-RECOIL_RECOVER * dt);
  out[0] = S[10] * k;
  out[1] = S[11] * k;
  S[10] = S[10] - out[0];
  S[11] = S[11] - out[1];
  if (S[10] < 0.0002 && S[10] > -0.0002) S[10] = 0;
  if (S[11] < 0.0002 && S[11] > -0.0002) S[11] = 0;
}

export function clearRecoil(): void { S[10] = 0; S[11] = 0; S[8] = 0; }

/// Damage multiplier at `dist` metres for the current weapon (hitscan falloff, plan 2.8).
export function falloffAt(w: number, dist: number): number {
  if (W_FALL_END[w] <= 0) return 1;
  if (dist <= W_FALL_START[w]) return 1;
  if (dist >= W_FALL_END[w]) return W_FALL_MIN[w];
  const u = (dist - W_FALL_START[w]) / (W_FALL_END[w] - W_FALL_START[w]);
  return 1 + (W_FALL_MIN[w] - 1) * u;
}

/// Walk-speed multiplier the held weapon imposes right now (the spun-up chaingun).
export function carryMul(): number {
  const w = S[0];
  if (W_CARRY_MUL[w] >= 1) return 1;
  return 1 + (W_CARRY_MUL[w] - 1) * S[5];
}

/// 1 just after a weapon switch, falling to 0 as the new weapon comes up.
export function swapProgress(): number {
  return S[12] > 0 ? S[12] / SWAP_TIME : 0;
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

