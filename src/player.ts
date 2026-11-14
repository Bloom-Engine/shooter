import { Vec3, vec3 } from 'bloom';
import {
  WorldHandle, CharacterHandle, ShapeHandle,
  capsuleShape, createCharacter,
  updateCharacter, getCharacterPosition, getCharacterLinearVelocity,
  setCharacterLinearVelocity, isCharacterGrounded, getCharacterGroundNormal,
  setCharacterPosition, setCharacterShape, compoundShape, raycast, Layer,
} from 'bloom/physics';

// Player character (third-person). Jolt's CharacterVirtual is anchored at the capsule center:
// with halfHeight=0.6 + radius=0.35, the feet sit 0.95 below position.
const HALF_HEIGHT = 0.6;
const RADIUS = 0.32;               // slightly slimmer so player can squeeze between trees
const EYE_OFFSET = 0.65;           // eye above capsule center
// Walking, not running. 6.0 m/s was a RUN speed wearing a walk animation: the
// walk clip is authored at ~2.6 m/s, so covering 6 m/s of ground meant playing it
// at the 2.2x clamp, and even then the stride could not keep up with the floor.
// That is what read as the player "sliding".
//
// Sprint absorbed the difference instead — SPRINT_MUL went 1.5 -> 2.0, so the TOP
// speed is still 9.0 m/s and nothing about escaping a dragoon pounce changed. Only
// the cruise is slower, and now holding shift is the difference between a walk and
// a run, which is what it should always have been.
const MOVE_SPEED = 4.5;
const AIR_SPEED = 4.5;
const ACCEL = 14.0;                // ground horizontal velocity lerp rate
const AIR_ACCEL = 4.0;
const JUMP_IMPULSE = 7.0;
const GRAVITY: Vec3 = { x: 0, y: -20, z: 0 };
// Climb assist: when grounded and pressing INTO A SLOPE, add the upward
// velocity needed to follow the surface, so the character climbs hills smoothly
// instead of grinding into them.
//
// It used to be a flat `0.45 * horizontal speed`, applied on every grounded
// frame the player was moving — on level ground too. At walk speed that is
// 2.0 m/s of lift: enough to leave the floor. The player was therefore airborne
// on most frames of an ordinary walk (measured: `grounded` read false on ~3 of
// every 4 sampled frames), in a permanent ~10 cm hop nobody could see because
// AIR_SPEED and MOVE_SPEED are equal.
//
// Sprint is gated on `grounded`, so sprint was very nearly unreachable — that,
// and not the sprint code, is why holding shift did nothing.
//
// The assist is now derived from the ground normal: to travel at horizontal
// speed h along a surface, the vertical rate required is h * (-(n·dir_h) / n.y).
// That is exactly zero on flat ground (n = +Y), so the player stays planted, and
// it is exactly right on a slope, which is more than the old constant ever was.
const CLIMB_ASSIST_MAX = 6.0;   // m/s — a cap, not a target; steep ground only
// Walkable ground has n.y >= cos(maxSlopeAngle). Below that it is a wall: no
// assist (the slope limit already refuses it) and no dividing by ~zero.
const MIN_GROUND_NY = 0.35;

// SH-032 — sprint + dodge. The enemies (mantis darts, dragoon pounces) were
// more mobile than the player, which is exactly backwards for a power fantasy.
const SPRINT_MUL = 2.0;   // 4.5 -> 9.0 m/s; top speed unchanged from the old 6.0 x 1.5
// SH-048 — crouch. Slower, steadier movement, and (plan 1.6) a shorter capsule: 1.20 m instead of
// 1.84 m, feet in the same place, so a crouched Trooper fits under what a standing one does not
// and bolts aimed at the chest pass over. Standing back up is refused while something is overhead.
// The speed is what the crouch-walk clip can cover with planted feet (0.5 m/s authored, 2.4x).
const CROUCH_MUL = 0.40;  // 4.5 -> 1.8 m/s (the crouch-walk clip covers 0.9 m/s; 2x plays well)
// Aiming or firing squares the body to the camera and plays the strafe set, whose clips walk at
// about 1 m/s. Half speed is what they can carry, and it makes moving while aiming a trade.
const AIM_MUL = 0.5;      // 4.5 -> 2.25 m/s
const CROUCH_HALF_HEIGHT = 0.28;
const CROUCH_DROP = HALF_HEIGHT - CROUCH_HALF_HEIGHT;   // the capsule centre comes down this far
// The dodge is a shoulder roll (plan 1.5): 0.7 s, fast out of the blocks and slowing as the
// Trooper comes back to the feet, about 4.5 m in all - the distance the old 0.25 s slide covered.
const DODGE_SPEED = 10.5;    // m/s at the start of the roll
const DODGE_SPEED_END = 2.5; // m/s as it ends
const DODGE_TIME = 0.7;      // seconds
const DODGE_COOLDOWN = 1.2;
// Invulnerable for this long from the start of a dodge (plan 1.5): claws whiff and bolts pass
// through. Shorter than the roll itself: the recovery at the end can be punished.
const DODGE_IFRAMES = 0.45;

let character: CharacterHandle = 0;
let shape: ShapeHandle = 0;
let crouchShape: ShapeHandle = 0;
let worldH: WorldHandle = 0;

// Mutable state in a flat array — the same reason feel.ts does it.
//   0 dodge time left   1 dodge cooldown   2 dodge dir x   3 dodge dir z
//   4 grounded (0/1)    5 horizontal speed  6 sprinting (0/1)  7 crouching (0/1)
//   8 i-frame time left 9 capsule is the crouch one (0/1)   10 squared to the camera (0/1)
const P = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export function createPlayer(world: WorldHandle, spawn: Vec3): void {
  worldH = world;
  shape = capsuleShape(HALF_HEIGHT, RADIUS);
  // The crouch capsule hangs below the character's origin so the feet do not move and nothing
  // that reads playerPosition() has to know which capsule is on.
  crouchShape = compoundShape([{
    shape: capsuleShape(CROUCH_HALF_HEIGHT, RADIUS),
    local: { position: vec3(0, -CROUCH_DROP, 0), rotation: { x: 0, y: 0, z: 0, w: 1 } },
  }]);
  character = createCharacter(world, shape, {
    position: spawn,
    mass: 70,
    // 70° instead of 51° — most natural terrain slopes top out
    // around 60° even on hills and the old limit made many parts
    // of the heightmap unwalkable.
    maxSlopeAngleRad: 1.22,
  });
}

export function playerGrounded(): boolean { return P[4] !== 0; }
export function playerSpeed(): number { return P[5]; }
export function isDodging(): boolean { return P[0] > 0; }
/// 0 at the start of a roll, 1 at its end (0 when not rolling).
export function dodgeProgress(): number { return P[0] > 0 ? 1 - P[0] / DODGE_TIME : 0; }
export function dodgeDirX(): number { return P[2]; }
export function dodgeDirZ(): number { return P[3]; }
export function dodgeDuration(): number { return DODGE_TIME; }
/// Main says each frame whether the body is squared to the camera (aiming or firing):
/// movement is then at AIM_MUL.
export function setSquared(on: boolean): void { P[10] = on ? 1 : 0; }
/// True while a dodge's invulnerability window is open. Every source of damage to the player
/// from an enemy asks this first.
export function isInvulnerable(): boolean { return P[8] > 0; }
export function isSprinting(): boolean { return P[6] !== 0; }
export function isCrouching(): boolean { return P[7] !== 0; }
export function dodgeCooldownFrac(): number {
  if (P[1] > 0) return P[1] / DODGE_COOLDOWN;
  return 0;
}

/// Begin a dodge in the given (already-normalised) horizontal direction.
/// Returns false if it is still on cooldown, so the caller knows not to play
/// the sound or spend the FOV kick.
export function startDodge(dirX: number, dirZ: number): boolean {
  if (P[1] > 0 || P[0] > 0) return false;
  const l = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (l < 0.001) return false;
  P[0] = DODGE_TIME;
  P[1] = DODGE_COOLDOWN;
  P[8] = DODGE_IFRAMES;
  P[2] = dirX / l;
  P[3] = dirZ / l;
  return true;
}

export function updatePlayerController(
  dt: number,
  moveX: number, moveZ: number,
  forwardFlat: Vec3, rightFlat: Vec3,
  jumpPressed: boolean,
  sprint: boolean,
  crouch: boolean,
): void {
  const grounded = isCharacterGrounded(character);
  const v = getCharacterLinearVelocity(character);

  if (P[1] > 0) P[1] = P[1] - dt;
  if (P[8] > 0) P[8] = P[8] - dt;

  // A dodge overrides steering entirely — that is what makes it a commitment
  // and therefore a real decision, rather than just a speed boost you hold.
  if (P[0] > 0) {
    P[0] = P[0] - dt;
    const dk = P[0] > 0 ? P[0] / DODGE_TIME : 0;      // 1 -> 0 through the roll
    const dv = DODGE_SPEED_END + (DODGE_SPEED - DODGE_SPEED_END) * dk;
    setCharacterLinearVelocity(character,
      vec3(P[2] * dv, grounded ? 0 : v.y, P[3] * dv));
    updateCharacter(character, dt, GRAVITY);
    const pv = getCharacterLinearVelocity(character);
    P[4] = grounded ? 1 : 0;
    P[5] = Math.sqrt(pv.x * pv.x + pv.z * pv.z);
    P[6] = 0;
    P[7] = 0;
    return;
  }

  // Crouch wins over sprint — you cannot do both, and holding crouch is the more
  // deliberate intent. It applies airborne too (you stay crouched over a lip),
  // but the speed penalty only bites the grounded base like sprint's bonus does.
  let crouching = crouch && grounded;
  // Swap the capsule on the edge. Coming up needs headroom: one ray from the crouched head to
  // where the standing head will be. Blocked means the player stays down, whatever the key says.
  if (crouching && P[9] === 0) {
    setCharacterShape(character, crouchShape);
    P[9] = 1;
  } else if (!crouching && P[9] !== 0) {
    const cp = getCharacterPosition(character);
    const headNow = cp.y - CROUCH_DROP + CROUCH_HALF_HEIGHT + RADIUS;
    const rise = (HALF_HEIGHT + RADIUS) - (CROUCH_HALF_HEIGHT + RADIUS - CROUCH_DROP) + 0.08;
    const roof = raycast(worldH, vec3(cp.x, headNow - 0.1, cp.z), vec3(0, 1, 0), rise + 0.1,
      1 << Layer.NON_MOVING);
    if (roof !== null && grounded) {
      crouching = true;
    } else {
      setCharacterShape(character, shape);
      P[9] = 0;
    }
  }
  const sprinting = !crouching && sprint && grounded && (moveX !== 0 || moveZ !== 0);
  P[6] = sprinting ? 1 : 0;
  P[7] = crouching ? 1 : 0;
  const base = grounded ? MOVE_SPEED : AIR_SPEED;
  const speed = crouching ? base * CROUCH_MUL
              : (sprinting ? base * SPRINT_MUL
              : ((P[10] !== 0 && grounded) ? base * AIM_MUL : base));
  const targetX = (forwardFlat.x * -moveZ + rightFlat.x * moveX) * speed;
  const targetZ = (forwardFlat.z * -moveZ + rightFlat.z * moveX) * speed;

  const accel = grounded ? ACCEL : AIR_ACCEL;
  const t = 1 - Math.exp(-accel * dt);

  // Arena footing: when grounded with no movement input, snap horizontal
  // velocity to zero instead of letting it decay. The decay path only damped
  // ~20%/frame, so gravity projected along any terrain grade kept regenerating
  // a downhill velocity each frame → a steady slide on slopes that should read
  // as flat. Zeroing it plants the player; sloped terrain no longer drifts you.
  const noInput = moveX === 0 && moveZ === 0;
  const nx = grounded && noInput ? 0 : v.x + (targetX - v.x) * t;
  const nz = grounded && noInput ? 0 : v.z + (targetZ - v.z) * t;

  // Don't carry accumulated downward velocity while grounded — that was the
  // gravity component the slide fed on. updateCharacter re-applies gravity this
  // frame to keep ground contact.
  let ny = grounded ? 0 : v.y;
  if (jumpPressed && grounded) ny = JUMP_IMPULSE;
  // Grounded and pressing into a slope: rise at exactly the rate that keeps the
  // character on the surface. CharacterVirtual otherwise wedges against a hill,
  // because the horizontal velocity meets the slope perpendicularly and cannot
  // glide up it. On level ground this contributes nothing at all — see the note
  // on CLIMB_ASSIST_MAX for why that matters so much.
  else if (grounded) {
    const hspeed = Math.hypot(targetX, targetZ);
    if (hspeed > 0.1) {
      const n = getCharacterGroundNormal(character);
      if (n.y > MIN_GROUND_NY) {
        // Unit horizontal heading, then the surface's gradient along it. The
        // normal's horizontal part points DOWNhill, so climbing means the dot
        // product is negative — hence the leading minus.
        const ux = targetX / hspeed;
        const uz = targetZ / hspeed;
        const grade = -(n.x * ux + n.z * uz) / n.y;
        if (grade > 0) {
          const lift = hspeed * grade;
          ny = lift > CLIMB_ASSIST_MAX ? CLIMB_ASSIST_MAX : lift;
        }
      }
    }
  }

  setCharacterLinearVelocity(character, vec3(nx, ny, nz));
  updateCharacter(character, dt, GRAVITY);

  // Cache what the rest of the game asks about every frame (footstep cadence,
  // locomotion blend, landing dip) so nobody re-queries the character
  // controller five times per frame across the FFI.
  const pv = getCharacterLinearVelocity(character);
  P[4] = grounded ? 1 : 0;
  P[5] = Math.sqrt(pv.x * pv.x + pv.z * pv.z);
}

export function resetPlayerMotion(): void {
  P[0] = 0; P[1] = 0; P[5] = 0; P[6] = 0; P[7] = 0; P[8] = 0;
  if (P[9] !== 0) { setCharacterShape(character, shape); P[9] = 0; }
}

export function playerPosition(): Vec3 {
  return getCharacterPosition(character);
}

export function playerEye(): Vec3 {
  const p = getCharacterPosition(character);
  return vec3(p.x, p.y + EYE_OFFSET, p.z);
}

/// SH-051 — teleport, for the STAIRTEST harness. Putting the player on the first
/// floor is the only way to exercise cross-floor AI from a batch run, and the
/// alternative (walking there with injected input) is a flaky path-follow.
export function setPlayerPosition(p: Vec3): void {
  setCharacterPosition(character, p);
}

export function playerCapsuleHalfHeight(): number { return HALF_HEIGHT; }
export function playerCapsuleRadius(): number { return RADIUS; }
