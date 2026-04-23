import { Vec3, vec3 } from 'bloom';
import {
  WorldHandle, CharacterHandle, ShapeHandle,
  capsuleShape, createCharacter,
  updateCharacter, getCharacterPosition, getCharacterLinearVelocity,
  setCharacterLinearVelocity, isCharacterGrounded,
} from 'bloom/physics';

// FPS character. Jolt's CharacterVirtual is anchored at the capsule center:
// with halfHeight=0.6 + radius=0.35, the feet sit 0.95 below position.
const HALF_HEIGHT = 0.6;
const RADIUS = 0.35;
const EYE_OFFSET = 0.65;           // eye above capsule center
const MOVE_SPEED = 6.0;
const AIR_SPEED = 4.5;
const ACCEL = 14.0;                // ground horizontal velocity lerp rate
const AIR_ACCEL = 4.0;
const JUMP_IMPULSE = 7.0;
const GRAVITY: Vec3 = { x: 0, y: -20, z: 0 };

let character: CharacterHandle = 0;
let shape: ShapeHandle = 0;

export function createPlayer(world: WorldHandle, spawn: Vec3): void {
  shape = capsuleShape(HALF_HEIGHT, RADIUS);
  character = createCharacter(world, shape, {
    position: spawn,
    mass: 70,
    maxSlopeAngleRad: 0.9,
  });
}

export function updatePlayerController(
  dt: number,
  moveX: number, moveZ: number,
  forwardFlat: Vec3, rightFlat: Vec3,
  jumpPressed: boolean,
): void {
  const grounded = isCharacterGrounded(character);
  const v = getCharacterLinearVelocity(character);

  const speed = grounded ? MOVE_SPEED : AIR_SPEED;
  const targetX = (forwardFlat.x * -moveZ + rightFlat.x * moveX) * speed;
  const targetZ = (forwardFlat.z * -moveZ + rightFlat.z * moveX) * speed;

  const accel = grounded ? ACCEL : AIR_ACCEL;
  const t = 1 - Math.exp(-accel * dt);
  const nx = v.x + (targetX - v.x) * t;
  const nz = v.z + (targetZ - v.z) * t;

  let ny = v.y;
  if (jumpPressed && grounded) ny = JUMP_IMPULSE;

  setCharacterLinearVelocity(character, vec3(nx, ny, nz));
  updateCharacter(character, dt, GRAVITY);
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
