import { Camera3D, Vec3, vec3, clamp } from 'bloom';

// First-person camera. Stores yaw/pitch accumulator and derives a Camera3D
// each frame from the player's eye position.

const PITCH_MIN = -1.45;
const PITCH_MAX = 1.45;
const FOVY = 70;

let yaw = 0;
let pitch = 0;

export function initCameraFp(startYaw: number): void {
  yaw = startYaw;
  pitch = 0;
}

export function applyLook(lookX: number, lookY: number): void {
  // Mouse right (+lookX) should rotate view right (+yaw).
  // Mouse down (+lookY on screen) should rotate view down (-pitch).
  yaw = yaw + lookX;
  pitch = pitch - lookY;
  pitch = clamp(pitch, PITCH_MIN, PITCH_MAX);
}

// Forward vector in world space. -Z is the default "forward" at yaw=0.
export function forward(): Vec3 {
  const cp = Math.cos(pitch);
  return vec3(Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

// Horizontal-only forward (for walking direction, ignoring pitch).
export function forwardFlat(): Vec3 {
  return vec3(Math.sin(yaw), 0, -Math.cos(yaw));
}

// Horizontal right vector.
export function rightFlat(): Vec3 {
  return vec3(Math.cos(yaw), 0, Math.sin(yaw));
}

export function yawValue(): number { return yaw; }
export function pitchValue(): number { return pitch; }

export function makeCamera3D(eye: Vec3): Camera3D {
  const f = forward();
  return {
    position: eye,
    target: vec3(eye.x + f.x, eye.y + f.y, eye.z + f.z),
    up: vec3(0, 1, 0),
    fovy: FOVY,
    projection: 0,
  };
}
