import { Vec3, vec3 } from 'bloom';
import {
  WorldHandle, CharacterHandle, ShapeHandle,
  capsuleShape, createCharacter,
  updateCharacter, getCharacterPosition, getCharacterLinearVelocity,
  setCharacterLinearVelocity, isCharacterGrounded,
} from 'bloom/physics';

// Player character (third-person). Jolt's CharacterVirtual is anchored at the capsule center:
// with halfHeight=0.6 + radius=0.35, the feet sit 0.95 below position.
const HALF_HEIGHT = 0.6;
const RADIUS = 0.32;               // slightly slimmer so player can squeeze between trees
const EYE_OFFSET = 0.65;           // eye above capsule center
const MOVE_SPEED = 6.0;
const AIR_SPEED = 4.5;
const ACCEL = 14.0;                // ground horizontal velocity lerp rate
const AIR_ACCEL = 4.0;
const JUMP_IMPULSE = 7.0;
const GRAVITY: Vec3 = { x: 0, y: -20, z: 0 };
// Climb assist: when grounded and pressing into a slope, add a
// small upward velocity proportional to horizontal speed so the
// character climbs hills smoothly instead of grinding into them.
const CLIMB_ASSIST = 0.45;

// SH-032 — sprint + dodge. The enemies (mantis darts, dragoon pounces) were
// more mobile than the player, which is exactly backwards for a power fantasy.
const SPRINT_MUL = 1.5;
const DODGE_SPEED = 18.0;    // m/s during the burst
const DODGE_TIME = 0.25;     // seconds
const DODGE_COOLDOWN = 1.2;

let character: CharacterHandle = 0;
let shape: ShapeHandle = 0;

// Mutable state in a flat array — the same reason feel.ts does it.
//   0 dodge time left   1 dodge cooldown   2 dodge dir x   3 dodge dir z
//   4 grounded (0/1)    5 horizontal speed  6 sprinting (0/1)
const P = [0, 0, 0, 0, 0, 0, 0];

export function createPlayer(world: WorldHandle, spawn: Vec3): void {
  shape = capsuleShape(HALF_HEIGHT, RADIUS);
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
export function isSprinting(): boolean { return P[6] !== 0; }
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
): void {
  const grounded = isCharacterGrounded(character);
  const v = getCharacterLinearVelocity(character);

  if (P[1] > 0) P[1] = P[1] - dt;

  // A dodge overrides steering entirely — that is what makes it a commitment
  // and therefore a real decision, rather than just a speed boost you hold.
  if (P[0] > 0) {
    P[0] = P[0] - dt;
    setCharacterLinearVelocity(character,
      vec3(P[2] * DODGE_SPEED, grounded ? 0 : v.y, P[3] * DODGE_SPEED));
    updateCharacter(character, dt, GRAVITY);
    const pv = getCharacterLinearVelocity(character);
    P[4] = grounded ? 1 : 0;
    P[5] = Math.sqrt(pv.x * pv.x + pv.z * pv.z);
    P[6] = 0;
    return;
  }

  const sprinting = sprint && grounded && (moveX !== 0 || moveZ !== 0);
  P[6] = sprinting ? 1 : 0;
  const base = grounded ? MOVE_SPEED : AIR_SPEED;
  const speed = sprinting ? base * SPRINT_MUL : base;
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
  // When grounded and trying to move, give a small upward bias —
  // CharacterVirtual otherwise wedges against slopes because the
  // horizontal velocity hits the slope perpendicularly and can't
  // glide up. The assist is proportional to horizontal speed so
  // it disappears when the player stops.
  else if (grounded) {
    const hspeed = Math.hypot(targetX, targetZ);
    if (hspeed > 0.1) ny = CLIMB_ASSIST * hspeed;
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
  P[0] = 0; P[1] = 0; P[5] = 0; P[6] = 0;
}

export function playerPosition(): Vec3 {
  return getCharacterPosition(character);
}

export function playerEye(): Vec3 {
  const p = getCharacterPosition(character);
  return vec3(p.x, p.y + EYE_OFFSET, p.z);
}

export function playerCapsuleHalfHeight(): number { return HALF_HEIGHT; }
export function playerCapsuleRadius(): number { return RADIUS; }
