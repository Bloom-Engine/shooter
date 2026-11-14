// Plan 2.3 (SH-057) - locational damage. Where a shot lands on a creature, from shapes that ride
// the creature's LIVE skeleton: a head sphere, a torso capsule, two capsules per arm and per leg,
// and a weak-point sphere on the heavies. Until this module a creature was one physics box, a
// good third larger than the model, and every hit on it was worth the same.
//
// Nothing here is in the physics world. A shot is tested in two steps: this module finds the
// nearest creature shape along the ray, the caller casts the same ray against the static world,
// and whichever is nearer wins. A ray that passes between a creature's legs now passes.
//
// The joints come from `jointWorld`, which is model space as of the slot's last animUpdate, so
// the shapes are lifted into the world with the transform that animUpdate was given
// (enPose*: main records it at the draw). They are one frame old, like everything on screen.
//
// Perry rules: top-level functions, flat arrays, no exported `let`, no engine call at module
// scope. Joint positions are cached per slot per frame (HS_STAMP), so a chaingun burst into a
// pack costs each creature one skeleton read a frame, not one a round.

import { jointWorld } from 'bloom/models';
import {
  MAX_ENEMIES, enAlive, enKind, enAnim, enX, enY, enZ,
  enPoseX, enPoseY, enPoseZ, enPoseYaw, enPosed, enHeading,
  KIND_HS_JOINT, HS_J,
  HSJ_HEAD, HSJ_NECK, HSJ_HIPS, HSJ_ARM_L, HSJ_FARM_L, HSJ_HAND_L,
  HSJ_ARM_R, HSJ_FARM_R, HSJ_HAND_R, HSJ_ULEG_L, HSJ_LEG_L, HSJ_FOOT_L,
  HSJ_ULEG_R, HSJ_LEG_R, HSJ_FOOT_R, HSJ_WEAK,
  KIND_HEAD_OFF_X, KIND_HEAD_OFF_Y, KIND_HEAD_R, KIND_TORSO_R, KIND_ARM_R, KIND_LEG_R,
  KIND_HEIGHT, KIND_WEAK_X, KIND_WEAK_Y, KIND_WEAK_Z, KIND_WEAK_R, KIND_WEAK_FRONT,
  KIND_SHELL, KIND_SCALE, enScale,
  LOC_LIMB, LOC_BODY, LOC_HEAD, LOC_WEAK, LOC_SHELL,
} from './enemies';

// World-space joint positions, HS_J * 3 per slot, valid when HS_STAMP[slot] === HS[0].
const HS_POS = new Array<number>(MAX_ENEMIES * HS_J * 3);
const HS_STAMP = new Array<number>(MAX_ENEMIES);
for (let i = 0; i < MAX_ENEMIES; i++) HS_STAMP[i] = -1;
for (let i = 0; i < MAX_ENEMIES * HS_J * 3; i++) HS_POS[i] = 0;
// 0 frame counter   1 slot the next rays ignore (-1 none): a piercing bolt's last victim
const HS = [0, -1];
// Scratch for the segment tests: [0] t along the ray, [1] squared distance at closest approach.
const SEG = [0, 0];

/// Call once a frame, before any shot is tested: invalidates last frame's joint cache.
export function hitShapesBeginFrame(): void { HS[0] = HS[0] + 1; }

/// Make rayEnemies ignore one slot until told otherwise (-1 = none).
export function setRaySkip(i: number): void { HS[1] = i; }

/// Read slot i's shape joints into HS_POS (once a frame at most).
function refresh(i: number): void {
  if (HS_STAMP[i] === HS[0]) return;
  HS_STAMP[i] = HS[0];
  const k = enKind[i];
  const base = i * HS_J * 3;
  const h = enAnim[i];
  // Before the slot has been posed this life (the frame it spawns) there is no skeleton to ask:
  // stand a plain upright figure at its position instead.
  const posed = enPosed[i] === 1;
  const px = posed ? enPoseX[i] : enX[i];
  const py = posed ? enPoseY[i] : enY[i];
  const pz = posed ? enPoseZ[i] : enZ[i];
  const yaw = posed ? enPoseYaw[i] : Math.PI / 2 - enHeading[i];
  const cM = Math.cos(yaw), sM = Math.sin(yaw);
  const sc = enScale(i);
  for (let j = 0; j < HS_J; j++) {
    const jn = KIND_HS_JOINT[k * HS_J + j];
    let mx = 0, my = KIND_HEIGHT[k] * 0.55, mz = 0;
    if (jn >= 0 && posed) {
      mx = jointWorld(h, jn, 12);
      my = jointWorld(h, jn, 13);
      mz = jointWorld(h, jn, 14);
    } else if (j === HSJ_HEAD) {
      my = KIND_HEIGHT[k] * 0.9;
    } else if (j === HSJ_NECK) {
      my = KIND_HEIGHT[k] * 0.8;
    } else if (j >= HSJ_ULEG_L && j <= HSJ_FOOT_R) {
      my = KIND_HEIGHT[k] * 0.25;
    }
    // Offsets in the model's own axes (X forward, Y up, Z right) for the head and the weak point.
    if (j === HSJ_HEAD) { mx = mx + KIND_HEAD_OFF_X[k]; my = my + KIND_HEAD_OFF_Y[k]; }
    if (j === HSJ_WEAK) { mx = mx + KIND_WEAK_X[k]; my = my + KIND_WEAK_Y[k]; }
    HS_POS[base + j * 3]     = px + (mx * cM + mz * sM) * sc;
    HS_POS[base + j * 3 + 1] = py + my * sc;
    HS_POS[base + j * 3 + 2] = pz + (-mx * sM + mz * cM) * sc;
  }
}

/// Closest approach of the ray (o + d t, 0 <= t <= maxT, d unit) to the segment a..b.
/// Writes SEG[0] = t on the ray, SEG[1] = squared distance there.
function raySeg(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
                maxT: number,
                ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const wx = ox - ax, wy = oy - ay, wz = oz - az;
  const b = dx * ux + dy * uy + dz * uz;
  const c = ux * ux + uy * uy + uz * uz;
  const d = dx * wx + dy * wy + dz * wz;
  const e = ux * wx + uy * wy + uz * wz;
  const den = c - b * b;          // (a = d.d = 1)
  let s = 0;                      // parameter on the segment, 0..1
  if (c > 0.000001) {
    if (den > 0.000001) s = (e - b * d) / den;
    else s = e / c;
    if (s < 0) s = 0;
    if (s > 1) s = 1;
  }
  let t = b * s - d;              // the ray's closest point to that point of the segment
  if (t < 0) t = 0;
  if (t > maxT) t = maxT;
  // and the segment's closest point to THAT, so a clamped end is still measured honestly
  if (c > 0.000001) {
    s = (e + b * t) / c;
    if (s < 0) s = 0;
    if (s > 1) s = 1;
  }
  const qx = ax + ux * s - (ox + dx * t);
  const qy = ay + uy * s - (oy + dy * t);
  const qz = az + uz * s - (oz + dz * t);
  SEG[0] = t;
  SEG[1] = qx * qx + qy * qy + qz * qz;
}

// Per-call best, kept in module scratch so the capsule helper can update it.
//   0 best t   1 best location   2 found (0/1)
const BEST = [0, 0, 0];

function tryCapsule(i: number, ja: number, jb: number, r: number, loc: number,
                    ox: number, oy: number, oz: number,
                    dx: number, dy: number, dz: number, maxT: number): void {
  const base = i * HS_J * 3;
  const a = base + ja * 3, b = base + jb * 3;
  raySeg(ox, oy, oz, dx, dy, dz, maxT,
         HS_POS[a], HS_POS[a + 1], HS_POS[a + 2], HS_POS[b], HS_POS[b + 1], HS_POS[b + 2]);
  if (SEG[1] > r * r) return;
  // Entry point: back off from the closest approach by the half-chord.
  let t = SEG[0] - Math.sqrt(r * r - SEG[1]);
  if (t < 0) t = 0;
  if (BEST[2] === 0 || t < BEST[0]) { BEST[0] = t; BEST[1] = loc; BEST[2] = 1; }
}

/// The nearest creature shape the ray o + d t (d unit, 0 <= t <= maxT) passes through.
/// Returns the slot, or -1. out[0] = t, out[1] = location (LOC_*), out[2..4] = the hit point.
/// `inflate` widens every shape by that many metres (the blaster's fat bolt, the pad's magnetism).
export function rayEnemies(ox: number, oy: number, oz: number,
                           dx: number, dy: number, dz: number,
                           maxT: number, inflate: number, out: number[]): number {
  let hitI = -1;
  let hitT = maxT;
  let hitLoc = LOC_BODY;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] === 0 || i === HS[1]) continue;
    const k = enKind[i];
    // Broad phase: the ray against a sphere round the whole creature.
    const hh = KIND_HEIGHT[k] * 0.5;
    const cx = enX[i] - ox, cy = enY[i] + hh - oy, cz = enZ[i] - oz;
    let tc = cx * dx + cy * dy + cz * dz;
    if (tc < 0) tc = 0;
    if (tc > maxT) tc = maxT;
    const ex = cx - dx * tc, ey = cy - dy * tc, ez = cz - dz * tc;
    const br = hh + 1.2 + inflate;
    if (ex * ex + ey * ey + ez * ez > br * br) continue;

    refresh(i);
    BEST[2] = 0;
    const rA = KIND_ARM_R[k] + inflate, rL = KIND_LEG_R[k] + inflate;
    tryCapsule(i, HSJ_HIPS, HSJ_NECK, KIND_TORSO_R[k] + inflate, LOC_BODY, ox, oy, oz, dx, dy, dz, hitT);
    tryCapsule(i, HSJ_HEAD, HSJ_HEAD, KIND_HEAD_R[k] + inflate, LOC_HEAD, ox, oy, oz, dx, dy, dz, hitT);
    tryCapsule(i, HSJ_ARM_L, HSJ_FARM_L, rA, LOC_LIMB, ox, oy, oz, dx, dy, dz, hitT);
    tryCapsule(i, HSJ_FARM_L, HSJ_HAND_L, rA, LOC_LIMB, ox, oy, oz, dx, dy, dz, hitT);
    tryCapsule(i, HSJ_ARM_R, HSJ_FARM_R, rA, LOC_LIMB, ox, oy, oz, dx, dy, dz, hitT);
    tryCapsule(i, HSJ_FARM_R, HSJ_HAND_R, rA, LOC_LIMB, ox, oy, oz, dx, dy, dz, hitT);
    tryCapsule(i, HSJ_ULEG_L, HSJ_LEG_L, rL, LOC_LIMB, ox, oy, oz, dx, dy, dz, hitT);
    tryCapsule(i, HSJ_LEG_L, HSJ_FOOT_L, rL, LOC_LIMB, ox, oy, oz, dx, dy, dz, hitT);
    tryCapsule(i, HSJ_ULEG_R, HSJ_LEG_R, rL, LOC_LIMB, ox, oy, oz, dx, dy, dz, hitT);
    tryCapsule(i, HSJ_LEG_R, HSJ_FOOT_R, rL, LOC_LIMB, ox, oy, oz, dx, dy, dz, hitT);
    if (BEST[2] === 0) continue;
    let loc = BEST[1];
    const tHit = BEST[0];
    // The heavies carry their heads tucked into the torso's bulk (the Colossus's head joint is
    // inside its 0.74 m chest capsule), so "nearest shape" would never say head. A ray that
    // passes through the head sphere is a head shot unless a limb is in the way.
    if (loc === LOC_BODY) {
      const hb = i * HS_J * 3 + HSJ_HEAD * 3;
      const hr = KIND_HEAD_R[k] + inflate;
      raySeg(ox, oy, oz, dx, dy, dz, hitT, HS_POS[hb], HS_POS[hb + 1], HS_POS[hb + 2],
             HS_POS[hb], HS_POS[hb + 1], HS_POS[hb + 2]);
      if (SEG[1] <= hr * hr) loc = LOC_HEAD;
    }

    // Which way the creature faces, for the weak point and the shell: heading h -> forward
    // (sin h, -cos h), the same convention the director steers with.
    const fwX = Math.sin(enHeading[i]), fwZ = -Math.cos(enHeading[i]);
    const intoFront = dx * fwX + dz * fwZ;     // < 0: the shot travels against its facing
    // The weak point overrides the torso (it sits in or on it). It does not override a limb in
    // the way: an arm across the belly is cover.
    if (KIND_WEAK_R[k] > 0 && loc === LOC_BODY
        && (KIND_WEAK_FRONT[k] === 0 || intoFront < -0.2)) {
      const wb = i * HS_J * 3 + HSJ_WEAK * 3;
      const wr = KIND_WEAK_R[k] + inflate;
      // mirrored pair when the offset has a sideways part (the Bombard's two tube clusters)
      const sideX = Math.cos(enHeading[i]) * KIND_WEAK_Z[k];
      const sideZ = Math.sin(enHeading[i]) * KIND_WEAK_Z[k];
      const nSide = KIND_WEAK_Z[k] !== 0 ? 2 : 1;
      for (let sgn = 0; sgn < nSide; sgn++) {
        const m = nSide === 1 ? 0 : (sgn === 0 ? 1 : -1);
        const wx = HS_POS[wb] + sideX * m, wy = HS_POS[wb + 1], wz = HS_POS[wb + 2] + sideZ * m;
        raySeg(ox, oy, oz, dx, dy, dz, hitT, wx, wy, wz, wx, wy, wz);
        if (SEG[1] <= wr * wr) loc = LOC_WEAK;
      }
    }
    if (loc === LOC_BODY && KIND_SHELL[k] === 1 && intoFront > 0.3) loc = LOC_SHELL;

    if (tHit < hitT) { hitT = tHit; hitI = i; hitLoc = loc; }
  }
  if (hitI >= 0) {
    out[0] = hitT;
    out[1] = hitLoc;
    out[2] = ox + dx * hitT;
    out[3] = oy + dy * hitT;
    out[4] = oz + dz * hitT;
  }
  return hitI;
}

/// Bullet magnetism and the pad's aim assists (plan 2.9): the creature whose head or chest is
/// nearest the aim line, inside a cone of cos >= minCos. Returns the slot or -1 and writes the
/// point to aim at in out[0..2] (head when the line is nearer the head, else mid-torso) and the
/// cosine in out[3].
export function nearestAimPoint(ox: number, oy: number, oz: number,
                                dx: number, dy: number, dz: number,
                                maxDist: number, minCos: number, out: number[]): number {
  let best = -1;
  let bestCos = minCos;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] === 0) continue;
    const k = enKind[i];
    const cx = enX[i] - ox, cy = enY[i] + KIND_HEIGHT[k] * 0.6 - oy, cz = enZ[i] - oz;
    const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (cl < 1.0 || cl > maxDist) continue;
    // cheap reject on the whole-body direction, widened by the creature's angular size
    const roughCos = (cx * dx + cy * dy + cz * dz) / cl;
    if (roughCos < minCos - KIND_HEIGHT[k] / cl) continue;
    refresh(i);
    const base = i * HS_J * 3;
    for (let p = 0; p < 2; p++) {
      let tx = HS_POS[base + HSJ_HEAD * 3], ty = HS_POS[base + HSJ_HEAD * 3 + 1], tz = HS_POS[base + HSJ_HEAD * 3 + 2];
      if (p === 1) {
        tx = (HS_POS[base + HSJ_HIPS * 3] + HS_POS[base + HSJ_NECK * 3]) * 0.5;
        ty = (HS_POS[base + HSJ_HIPS * 3 + 1] + HS_POS[base + HSJ_NECK * 3 + 1]) * 0.5;
        tz = (HS_POS[base + HSJ_HIPS * 3 + 2] + HS_POS[base + HSJ_NECK * 3 + 2]) * 0.5;
      }
      const vx = tx - ox, vy = ty - oy, vz = tz - oz;
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (vl < 0.5) continue;
      const c = (vx * dx + vy * dy + vz * dz) / vl;
      if (c > bestCos) { bestCos = c; best = i; out[0] = tx; out[1] = ty; out[2] = tz; out[3] = c; }
    }
  }
  return best;
}

/// World position of one shape joint of a live slot (HSJ_*), for effects and the debug view.
export function shapeJoint(i: number, j: number, out: number[]): void {
  refresh(i);
  const b = i * HS_J * 3 + j * 3;
  out[0] = HS_POS[b]; out[1] = HS_POS[b + 1]; out[2] = HS_POS[b + 2];
}
