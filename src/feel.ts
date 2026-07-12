// SH-029 — camera and screen feedback.
//
// Before this the game's entire somatic channel was a red edge vignette. No
// shake, no hit-stop, no FOV movement — you could empty a magazine into a
// tyrant and the frame never once acknowledged it. Everything here is game-side
// math over the existing camera and post-pass; no engine support needed.
//
// The organising idea is a single `trauma` scalar (Squirrel Eiserloh's model):
// events ADD trauma, trauma decays on its own, and shake amplitude is trauma²
// so small events stay subtle while big ones bloom. One number means every
// source composes correctly instead of five shake systems fighting each other.

// Perry: module-scope scalars mutated across function calls are the pattern the
// codebase distrusts (see the CAM[] note in main.ts), so all mutable state
// lives in one flat array.
//   0 trauma        1 shakeScale (0..1 accessibility)
//   2 hitstopLeft   3 fovKick        4 fovKickVel
//   5 flinchYaw     6 flinchPitch
//   7 damageFlash   8 lowHealth01
//   9 landDip
const S = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0];

const TRAUMA_DECAY = 1.5;      // per second
const SHAKE_MAX_YAW = 0.021;   // radians at full trauma (~1.2°)
const SHAKE_MAX_PITCH = 0.017;
const SHAKE_FREQ = 22.0;

/// 0 = no shake at all (accessibility), 1 = full. Wire to a settings slider.
export function setShakeScale(s: number): void { S[1] = s < 0 ? 0 : (s > 1 ? 1 : s); }
export function shakeScale(): number { return S[1]; }

/// Add trauma. Values are additive and clamp at 1, so a burst of small hits
/// escalates naturally.
export function addTrauma(amount: number): void {
  const t = S[0] + amount;
  S[0] = t > 1 ? 1 : t;
}

/// Freeze the sim briefly. This is the single cheapest way to make a kill feel
/// like it landed: the frame stops for ~50 ms and the brain reads it as impact.
/// Rate-limited by the caller (see `requestHitstop`).
export function requestHitstop(seconds: number): void {
  if (seconds > S[2]) S[2] = seconds;
}

/// Kick the FOV outward (sprint, dodge) — `k` in degrees, decays back to 0.
export function addFovKick(k: number): void { S[3] = S[3] + k; }

/// A hit from a direction: throw the aim slightly and remember the angle for
/// the HUD's damage arc.
export function flinch(yaw: number, pitch: number): void {
  S[5] = S[5] + yaw;
  S[6] = S[6] + pitch;
}

export function damageFlash(v: number): void { if (v > S[7]) S[7] = v; }
export function setLowHealth(t01: number): void { S[8] = t01; }
export function landDip(v: number): void { if (v > S[9]) S[9] = v; }

/// Consume this frame's hit-stop. Returns the dt the SIMULATION should use:
/// zero (or near) while frozen. Rendering still happens, so the freeze reads as
/// a held frame rather than a stutter.
///
/// Call once per frame, before anything else uses dt.
export function applyHitstop(dt: number): number {
  if (S[2] > 0) {
    S[2] = S[2] - dt;
    if (S[2] < 0) S[2] = 0;
    // Not exactly 0: a fully frozen sim also freezes animation and the muzzle
    // flash, which looks like a hitch rather than a punch. 12% keeps everything
    // creeping.
    return dt * 0.12;
  }
  return dt;
}

/// Advance the decay of every feedback channel. Call once per frame with the
/// REAL dt (not the hit-stopped one) — otherwise a hit-stop would also freeze
/// its own recovery and the shake would hang.
export function updateFeel(dtReal: number): void {
  S[0] = S[0] - TRAUMA_DECAY * dtReal;
  if (S[0] < 0) S[0] = 0;

  // FOV kick: critically-damped-ish spring back to zero.
  S[4] = S[4] - S[3] * 90.0 * dtReal;
  S[4] = S[4] * Math.exp(-9.0 * dtReal);
  S[3] = S[3] + S[4] * dtReal;
  if (Math.abs(S[3]) < 0.01 && Math.abs(S[4]) < 0.01) { S[3] = 0; S[4] = 0; }

  const k = Math.exp(-7.0 * dtReal);
  S[5] = S[5] * k;
  S[6] = S[6] * k;
  S[7] = S[7] - dtReal * 2.2;  if (S[7] < 0) S[7] = 0;
  S[9] = S[9] - dtReal * 4.0;  if (S[9] < 0) S[9] = 0;
}

// Deterministic pseudo-noise: three incommensurate sines. Cheaper than a hash
// and, unlike Math.random(), it is smooth — random per-frame offsets read as
// a jitter/buzz, not a shake.
function noise(t: number, seed: number): number {
  return Math.sin(t * SHAKE_FREQ + seed) * 0.6
       + Math.sin(t * SHAKE_FREQ * 1.7 + seed * 2.3) * 0.3
       + Math.sin(t * SHAKE_FREQ * 2.9 + seed * 5.1) * 0.1;
}

/// Camera yaw offset for this frame (radians). Add to the camera yaw.
export function shakeYaw(time: number): number {
  const tr = S[0] * S[0] * S[1];
  return noise(time, 0.0) * SHAKE_MAX_YAW * tr + S[5];
}

/// Camera pitch offset for this frame (radians).
export function shakePitch(time: number): number {
  const tr = S[0] * S[0] * S[1];
  return noise(time, 11.3) * SHAKE_MAX_PITCH * tr + S[6] - S[9] * 0.05;
}

/// FOV offset in degrees for this frame.
export function fovOffset(): number { return S[3]; }

export function trauma(): number { return S[0]; }
export function damageFlashLevel(): number { return S[7]; }
export function lowHealthLevel(): number { return S[8]; }

/// Reset on a new run so last run's death shake doesn't bleed into the spawn.
export function resetFeel(): void {
  S[0] = 0; S[2] = 0; S[3] = 0; S[4] = 0;
  S[5] = 0; S[6] = 0; S[7] = 0; S[8] = 0; S[9] = 0;
}
