// SH-025d — the third-person camera, out of main.ts: the orbit state array,
// the pitch/orbit constants, pad aim assist + mouse look, and the occlusion-
// aware orbit follow (probe fan against static physics + analytic canopy
// cylinders — the canopy is deliberately not physics).
//
// Perry rules (docs/perry-quirks.md + the SH-025a/b/c lessons): top-level
// functions only; CAM stays a const array whose ELEMENTS are written (element
// writes propagate across modules — const-object/array slots are the proven
// pattern, exported `let` reassignment is not); no engine calls at module
// scope; W.* capture at module scope is safe (world-runtime parses the world
// in its own module body, which import order runs first).

import { vec3, getTime } from 'bloom';
import { raycast, Layer } from 'bloom/physics';
import * as W from './world-runtime';
import { playerPosition, isCrouching } from './player';
import { MAX_ENEMIES, enAlive, enX, enZ } from './enemies';
import { aimAssistScale } from './input';
import { nearestAimPoint } from './hitshapes';
import * as SET from './settings';
import * as FEEL from './feel';
import * as WPN from './weapons';

// ---- Third-person orbit camera (see perry-quirks.md) -----------------------
// Array-slot state because Perry 0.5.158 doesn't propagate module-scope
// `let` reassignments across function calls. Element writes on an exported
// const array DO cross modules reliably (director/combat already steer this
// array through the deps object); it is reassignment that gets lost.
//   CAM[0] yaw           CAM[5] tgtX
//   CAM[1] pitch         CAM[6] tgtY
//   CAM[2] camX          CAM[7] tgtZ
//   CAM[3] camY          CAM[8] initialised (0/1)
//   CAM[4] camZ        CAM[9] shoulder side, eased (-1 left .. +1 right)
//                      CAM[10] shoulder side wanted (-1 or +1)
//                      CAM[11] crouch drop of the pivot, eased (m)
export const CAM = [W.SPAWN_YAW, 0.35, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0];
export const TP_PITCH_MIN = -0.25;
export const TP_PITCH_MAX = 1.20;
const TP_ORBIT_DIST = 6.0;
// How close the camera may be shoved before it gives up. It has to be able to
// get properly close, or "zoom in past the obstacle" degrades into "sit inside
// the obstacle" the moment the player backs into a wall.
const TP_ORBIT_MIN = 0.8;
// Radius of the swept volume the camera occupies for occlusion purposes. Roughly
// the player capsule's radius: big enough that a trunk grazing the view pushes
// the camera in, small enough not to zoom for a fence post two metres to the side.
const CAM_PROBE_R = 0.30;
const TP_EYE_HEIGHT = 1.4;
const TP_SMOOTH = 10.0;
export const TP_FOVY = 70;
// Shoulder camera (plan 1.4). The orbit pivots on a point beside the head, not on it, so the
// Trooper stands off-centre and the crosshair has clear ground in front of it. Wider from the hip
// (the camera is 6 m back, so it takes more metres to move the body the same screen distance).
const SHOULDER_HIP = 0.95;
const SHOULDER_AIM = 0.62;
const SHOULDER_SWAP_RATE = 9.0;
const CROUCH_CAM_DROP = 0.45;  // the pivot comes down with a crouched head
const SHOULDER_SKIN = 0.28;   // keep the pivot this far off a wall beside the player

/// Put the camera over the other shoulder. The swap eases across (CAM[9] follows CAM[10]).
export function swapShoulder(): void {
  CAM[10] = CAM[10] > 0 ? -1 : 1;
}
export function resetShoulder(): void {
  CAM[9] = 1; CAM[10] = 1;
}

// ---- Camera occlusion: the canopy ------------------------------------------
// The trunk box is the ONLY collider a tree has — the canopy is shoot-through
// on purpose — so the orbit camera's raycast could never see the leaves. It
// happily parked the camera inside a wall of foliage, which is the one place a
// third-person camera must never be. The canopy is not physics, so the camera
// tests it analytically (below, in the orbit block).
//
// Leaf-card bounds MEASURED from the GLBs — the last mesh primitive of each
// prop_tree*.glb IS the leaf-card set, and glTF stores each accessor's min/max,
// so these are the asset's own numbers, not a guess. Model units: multiply by
// FOREST_SCALE. Indexed by FOREST_VAR (same order as treeVariants).
// Re-measure if the tree art changes.
// 2026-11: the grown trees of tools/blender/build_tree.py (oak, ash, beech); the builder prints
// these numbers ("CANOPY y0 / y1 / r") for each model.
const CANOPY_Y0 = [2.97, 3.12, 3.36];   // leaves start
const CANOPY_Y1 = [8.51, 9.13, 7.99];   // ...and end
const CANOPY_R  = [3.68, 3.64, 3.09];   // leaf-tip horizontal extent
// How much of that measured radius actually counts as "in the way".
//
// This started at 0.70, on the theory that the bounds reach the outermost leaf
// TIP while the opaque mass is smaller. A screenshot killed that theory: the
// camera dutifully stopped just outside the shrunken cylinder and a leaf card
// filled half the frame, because a leaf tip occludes exactly as well as a leaf
// centre does. The camera has to clear the foliage it can SEE, so the measured
// extent is the right number and 1.0 is the right factor.
//
// Lower it only if the camera turns out to zoom for foliage that was never in
// the way; the cost of that is a leaf in the lens.
const CANOPY_SOLID_FRAC = 1.0;

// Camera occlusion readback for the ANIMDBG harness in main: what the orbit
// was shortened TO, and what it wanted. Written every frame (two numeric
// stores — cheaper than threading the harness flag across the module seam).
export const CAMDBG = { orbit: 0, want: 0 };

// Pad aim assist + look application (SH-039). The gate (cursor captured,
// mouse-settle grace, menu closed) stays at the call site in main — it reads
// main's frame-loop state.
//
// SH-039 — pad aim assist: slow the look stick inside a narrow cone of the
// nearest enemy. Not magnetism; the stick still does all the aiming.
//
// Plan 2.9 adds, for a pad: ROTATIONAL assist (while the player is moving or steering, the view
// follows a creature that is already near the crosshair by a share of its own angular motion,
// the thing a thumb cannot do and a wrist can) and, for every device, a separate look speed
// while aiming down the sights. Bullet magnetism is in combat.ts, at the shot. All three pad
// assists hang off one setting (SET_AIM_ASSIST).
//   AST: 0 slot being followed (-1 none)  1 its yaw from the player last frame  2 its pitch
const AST = [-1, 0, 0];
const ASTP = [0, 0, 0, 0];
const ROT_ASSIST = 0.5;                    // share of the target's angular motion followed
const ROT_CONE_COS = 0.9925;               // 7 degrees
export function updateCameraLook(lookX: number, lookY: number, padActive: boolean,
                                 moving: boolean): void {
  let assist = 1;
  const assistOn = padActive && SET.get(SET.SET_AIM_ASSIST) !== 0;
  if (assistOn) {
    const ppA = playerPosition();
    const cyA = Math.cos(CAM[1]);
    const fxA = Math.sin(CAM[0]) * cyA;
    const fzA = -Math.cos(CAM[0]) * cyA;
    let bestCos = -1;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (enAlive[i] === 0) continue;
      const ex = enX[i] - ppA.x;
      const ez = enZ[i] - ppA.z;
      const el = Math.sqrt(ex * ex + ez * ez);
      if (el < 0.5) continue;
      const c = (ex / el) * fxA + (ez / el) * fzA;
      if (c > bestCos) bestCos = c;
    }
    assist = aimAssistScale(bestCos);

    // Rotational assist, measured from the camera along its real forward (pitch included).
    const cp = Math.cos(-CAM[1]);
    const dX = Math.sin(CAM[0]) * cp, dY = Math.sin(-CAM[1]), dZ = -Math.cos(CAM[0]) * cp;
    const ti = nearestAimPoint(CAM[2], CAM[3], CAM[4], dX, dY, dZ, 45, ROT_CONE_COS, ASTP);
    if (ti >= 0) {
      const vx = ASTP[0] - CAM[2], vy = ASTP[1] - CAM[3], vz = ASTP[2] - CAM[4];
      const yawT = Math.atan2(vx, -vz);
      const pitT = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz));
      const active = moving || lookX !== 0 || lookY !== 0;
      if (ti === AST[0] && active) {
        let dyaw = yawT - AST[1];
        while (dyaw > Math.PI) dyaw = dyaw - Math.PI * 2;
        while (dyaw < -Math.PI) dyaw = dyaw + Math.PI * 2;
        const dpit = pitT - AST[2];
        // A jump this large is a teleport or a new target, not motion to follow.
        if (dyaw < 0.06 && dyaw > -0.06 && dpit < 0.06 && dpit > -0.06) {
          CAM[0] = CAM[0] + dyaw * ROT_ASSIST;
          CAM[1] = CAM[1] - dpit * ROT_ASSIST;
        }
      }
      AST[0] = ti; AST[1] = yawT; AST[2] = pitT;
    } else {
      AST[0] = -1;
    }
  } else {
    AST[0] = -1;
  }
  // Look speed while aiming: the hip speed times SET_ADS_SENS, eased in with the aim itself.
  const ads = 1 + (SET.get(SET.SET_ADS_SENS) - 1) * WPN.aimBlend();
  const lx = lookX * assist * ads;
  const ly = lookY * assist * ads;
  WPN.consumeRecoil(lx, ly);
  CAM[0] = CAM[0] + lx;
  const np = CAM[1] + ly;
  CAM[1] = np < TP_PITCH_MIN ? TP_PITCH_MIN : (np > TP_PITCH_MAX ? TP_PITCH_MAX : np);
}

// Smooth orbit camera follow after the physics step.
// Inline orbit-camera follow with wall-aware distance.
export function updateCameraOrbit(dt: number, phys: any): void {
  const pp0 = playerPosition();
  // SH-029 — shake/flinch are applied to the camera basis, NOT to CAM[0]/[1]
  // themselves. Writing them back into the player's aim would mean recoil
  // permanently walked your crosshair and shake would fight your mouse.
  const tShake = getTime();
  const ya = CAM[0] + FEEL.shakeYaw(tShake);
  const pi = CAM[1] + FEEL.shakePitch(tShake);
  const cpi = Math.cos(pi), spi = Math.sin(pi);
  // Shoulder pivot: step sideways from the head along the camera's right vector. A wall beside
  // the player shortens the step (never the orbit), so the offset survives a pull-in and the
  // pivot cannot end up behind the wall.
  CAM[9] = CAM[9] + (CAM[10] - CAM[9]) * (1 - Math.exp(-SHOULDER_SWAP_RATE * dt));
  const aimT0 = WPN.aimBlend();
  CAM[11] = CAM[11] + ((isCrouching() ? CROUCH_CAM_DROP : 0) - CAM[11]) * (1 - Math.exp(-8 * dt));
  const hX = pp0.x, hY = pp0.y + TP_EYE_HEIGHT - CAM[11], hZ = pp0.z;
  let side = (SHOULDER_HIP + (SHOULDER_AIM - SHOULDER_HIP) * aimT0) * CAM[9];
  const sideSign = side < 0 ? -1 : 1;
  const sideLen = side * sideSign;
  const rgtX = Math.cos(ya) * sideSign, rgtZ = Math.sin(ya) * sideSign;
  if (sideLen > 0.02) {
    const sHit = raycast(phys, vec3(hX, hY, hZ), vec3(rgtX, 0, rgtZ),
      sideLen + SHOULDER_SKIN, 1 << Layer.NON_MOVING);
    if (sHit !== null) {
      const room = sHit.fraction * (sideLen + SHOULDER_SKIN) - SHOULDER_SKIN;
      side = (room > 0 ? room : 0) * sideSign;
    }
  }
  const sideAbs = side * sideSign;
  const fX = hX + rgtX * sideAbs;
  const fY = hY;
  const fZ = hZ + rgtZ * sideAbs;
  // Direction from focus to ideal camera position.
  const dxRaw = -Math.sin(ya) * cpi;
  const dyRaw =  Math.sin(pi);
  const dzRaw =  Math.cos(ya) * cpi;
  // Raycast from the focus point outward toward the orbit
  // direction. If anything (wall, tree trunk, terrain) is closer
  // than TP_ORBIT_DIST, shorten the orbit so the camera zooms
  // in instead of clipping through geometry. Leave a small skin
  // so we don't kiss the wall exactly.
  // Round-2 audit (F11): STATIC geometry only. Enemy bodies are in the
  // MOVING layer; letting them shorten the orbit pulled the camera
  // inside the mob whenever the player got surrounded — near-plane
  // clipping filled the screen with polygon soup. Enemies briefly
  // occluding the camera reads far better than being inside them.
  // SH-028 — shoulder aim pulls the camera in from 6.0 m to 2.6 m. The
  // wall-aware raycast below still applies, so aiming into a corner behaves.
  const aimT = aimT0;
  const wantDist = TP_ORBIT_DIST + (2.6 - TP_ORBIT_DIST) * aimT;
  let blockDist = wantDist;

  // (a) Static geometry, as a PROBE FAN rather than one hairline ray. The
  // camera is a volume, not a point: a single centre ray slips past a trunk or
  // a wall corner that then fills a third of the screen. Jolt has no shape
  // cast exposed, so sweep a cylinder of radius CAM_PROBE_R the honest way —
  // four rays offset perpendicular to the orbit direction, plus the centre.
  // Cheap: five raycasts against static bodies only.
  //
  // The orbit direction never points straight up (pitch is clamped well below
  // vertical), so (-dz, 0, dx) is always a safe perpendicular.
  const perpL = Math.sqrt(dxRaw * dxRaw + dzRaw * dzRaw);
  const uX = -dzRaw / perpL, uY = 0, uZ = dxRaw / perpL;      // right, level
  const vX = uY * dzRaw - uZ * dyRaw;                          // u x d = up-ish
  const vY = uZ * dxRaw - uX * dzRaw;
  const vZ = uX * dyRaw - uY * dxRaw;
  for (let p = 0; p < 5; p++) {
    let oX = fX, oY = fY, oZ = fZ;
    if (p === 1) { oX += uX * CAM_PROBE_R; oY += uY * CAM_PROBE_R; oZ += uZ * CAM_PROBE_R; }
    if (p === 2) { oX -= uX * CAM_PROBE_R; oY -= uY * CAM_PROBE_R; oZ -= uZ * CAM_PROBE_R; }
    if (p === 3) { oX += vX * CAM_PROBE_R; oY += vY * CAM_PROBE_R; oZ += vZ * CAM_PROBE_R; }
    if (p === 4) { oX -= vX * CAM_PROBE_R; oY -= vY * CAM_PROBE_R; oZ -= vZ * CAM_PROBE_R; }
    const hit = raycast(phys, vec3(oX, oY, oZ),
      vec3(dxRaw, dyRaw, dzRaw), wantDist, 1 << Layer.NON_MOVING);
    if (hit !== null) {
      const d = hit.fraction * wantDist;
      if (d < blockDist) blockDist = d;
    }
  }

  // (b) Tree canopies, which are not in the physics world at all (the leaves
  // are deliberately shoot-through, so a raycast sails straight through them
  // and the camera ends up inside a bush). Ray vs. the canopy cylinder,
  // analytically. The cheap XZ reject drops ~85 of the 88 trees before any
  // real work, so this is a handful of multiplies per frame.
  for (let i = 0; i < W.FOREST_COUNT; i++) {
    const s = W.FOREST_SCALE[i];
    const vI = W.FOREST_VAR[i];
    const cr = CANOPY_R[vI] * s * CANOPY_SOLID_FRAC;
    const cx = W.FOREST_X[i] - fX;
    const cz = W.FOREST_Z[i] - fZ;
    const reach = blockDist + cr;
    if (cx * cx + cz * cz > reach * reach) continue;          // far: cannot block

    // Interval of the ray inside the canopy's XZ circle.
    const a = dxRaw * dxRaw + dzRaw * dzRaw;
    if (a < 1e-6) continue;                                    // ray is vertical
    const b = -2 * (cx * dxRaw + cz * dzRaw);
    const c = cx * cx + cz * cz - cr * cr;
    const disc = b * b - 4 * a * c;
    if (disc <= 0) continue;                                   // misses the circle
    const sq = Math.sqrt(disc);
    let ta = (-b - sq) / (2 * a);
    let tb = (-b + sq) / (2 * a);
    if (ta < 0) ta = 0;
    if (tb > blockDist) tb = blockDist;
    if (ta > tb) continue;

    // ...and of the ray inside the canopy's height band. y(t) is linear, so
    // both intervals are ranges and the block starts where they overlap.
    const y0 = W.FOREST_Y[i] + CANOPY_Y0[vI] * s;
    const y1 = W.FOREST_Y[i] + CANOPY_Y1[vI] * s;
    let tEnter = ta;
    let tExit = tb;
    if (Math.abs(dyRaw) < 1e-6) {
      if (fY < y0 || fY > y1) continue;                        // passes above/below
    } else {
      const tA = (y0 - fY) / dyRaw;
      const tB = (y1 - fY) / dyRaw;
      const tLo = tA < tB ? tA : tB;
      const tHi = tA < tB ? tB : tA;
      if (tLo > tEnter) tEnter = tLo;
      if (tHi < tExit) tExit = tHi;
      if (tEnter > tExit) continue;                            // never in the band
    }
    if (tEnter < blockDist) blockDist = tEnter;
  }

  // Leave a small skin so the camera does not kiss the surface it stopped at.
  let orbitDist = wantDist;
  if (blockDist < wantDist) {
    orbitDist = Math.max(TP_ORBIT_MIN, blockDist - 0.25);
  }
  CAMDBG.orbit = orbitDist;
  CAMDBG.want = wantDist;
  const wX = fX + dxRaw * orbitDist;
  const wY = fY + dyRaw * orbitDist;
  const wZ = fZ + dzRaw * orbitDist;
  if (CAM[8] === 0) {
    CAM[2] = wX; CAM[3] = wY; CAM[4] = wZ;
    CAM[5] = fX; CAM[6] = fY; CAM[7] = fZ;
    CAM[8] = 1;
  } else {
    // Snap inward fast (zoom-in is responsive) but lerp outward
    // smoothly so the camera doesn't suddenly fly back when the
    // player rounds a corner.
    const desired = vec3(wX, wY, wZ);
    const curDist = Math.hypot(CAM[2] - fX, CAM[3] - fY, CAM[4] - fZ);
    const tIn  = 1 - Math.exp(-TP_SMOOTH * 2.5 * dt);
    const tOut = 1 - Math.exp(-TP_SMOOTH * dt);
    const t = orbitDist < curDist ? tIn : tOut;
    CAM[2] = CAM[2] + (desired.x - CAM[2]) * t;
    CAM[3] = CAM[3] + (desired.y - CAM[3]) * t;
    CAM[4] = CAM[4] + (desired.z - CAM[4]) * t;
    const tF = 1 - Math.exp(-TP_SMOOTH * dt);
    CAM[5] = CAM[5] + (fX - CAM[5]) * tF;
    CAM[6] = CAM[6] + (fY - CAM[6]) * tF;
    CAM[7] = CAM[7] + (fZ - CAM[7]) * tF;
  }
}
