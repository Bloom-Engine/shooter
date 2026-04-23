import { Camera3D, Vec3, vec3, vec3Add, vec3Lerp, clamp } from 'bloom';

// Third-person orbit camera. Mouse controls yaw + pitch of a camera that
// orbits a focal point (typically the player's shoulder/head height).
// The camera smoothly lerps to its target position each frame.

const PITCH_MIN = -0.25;   // barely looking up
const PITCH_MAX = 1.20;    // roughly straight down
const ORBIT_DISTANCE = 6.0;
const EYE_HEIGHT = 1.4;    // focal-point offset above player feet
const SMOOTH = 10.0;        // higher = snappier camera follow
const FOVY = 70;

let yaw = 0;
let pitch = 0.35;          // slightly looking down
let camPos: Vec3 = vec3(0, 0, 0);
let camTarget: Vec3 = vec3(0, 0, 0);
let initialised = false;

export function initCameraTp(startYaw: number): void {
  yaw = startYaw;
  pitch = 0.35;
  initialised = false;
}

export function applyLookTp(dx: number, dy: number): void {
  // Match FP sign convention: mouse right rotates view right (+yaw),
  // mouse down tilts camera down (+pitch).
  yaw = yaw + dx;
  pitch = clamp(pitch + dy, PITCH_MIN, PITCH_MAX);
}

// Horizontal forward — used to drive player movement so it's camera-relative.
export function forwardFlatTp(): Vec3 {
  return vec3(Math.sin(yaw), 0, -Math.cos(yaw));
}
export function rightFlatTp(): Vec3 {
  return vec3(Math.cos(yaw), 0, Math.sin(yaw));
}

export function yawValueTp(): number { return yaw; }
export function pitchValueTp(): number { return pitch; }

// Step the smoothing toward the target orbit position. Call once per frame
// after updating the player position.
export function updateCameraTp(playerPos: Vec3, dt: number): void {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const focalX = playerPos.x;
  const focalY = playerPos.y + EYE_HEIGHT;
  const focalZ = playerPos.z;
  // Orbit: move out backwards from the focal point along -forward,
  // then up by the pitch.
  const wantX = focalX - Math.sin(yaw) * cp * ORBIT_DISTANCE;
  const wantY = focalY + sp * ORBIT_DISTANCE;
  const wantZ = focalZ + Math.cos(yaw) * cp * ORBIT_DISTANCE;
  const want = vec3(wantX, wantY, wantZ);
  const target = vec3(focalX, focalY, focalZ);
  if (!initialised) {
    camPos = want;
    camTarget = target;
    initialised = true;
  } else {
    const t = 1 - Math.exp(-SMOOTH * dt);
    camPos = vec3Lerp(camPos, want, t);
    camTarget = vec3Lerp(camTarget, target, t);
  }
}

export function cameraTp3D(): Camera3D {
  return { position: camPos, target: camTarget, up: vec3(0, 1, 0), fovy: FOVY, projection: 0 };
}

// Ray origin for weapon fire: the camera's current position.
export function cameraPosTp(): Vec3 { return camPos; }
// Unit vector camera→target — use for raycast direction.
export function cameraAimTp(): Vec3 {
  const dx = camTarget.x - camPos.x;
  const dy = camTarget.y - camPos.y;
  const dz = camTarget.z - camPos.z;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
  return len > 0 ? vec3(dx/len, dy/len, dz/len) : vec3(0, 0, -1);
}
