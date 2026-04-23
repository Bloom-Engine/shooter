// Skeletal-animated converter for Unvanquished alien IQEs.
//
// Produces assets/models/enemy_<kind>.glb containing:
//   - a root node with Z-up→Y-up rotation
//   - a skeleton (one node per IQE joint, TRS from rest pose)
//   - a skinned mesh with JOINTS_0 + WEIGHTS_0 attributes
//   - one glTF animation per IQE "animation" block (stand, walk, run,
//     attack, pain, die, ...), with per-joint translation + rotation
//     channels sampled at the IQE framerate
//
// Static version lives in convert-aliens.ts — this file is the more
// ambitious sibling. Uses LINEAR interpolation; glTF slerps rotations
// automatically. Up to 4 joint influences per vertex (glTF limit).
//
// Run with: bun tools/convert-aliens-anim.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, dirname } from 'node:path';

const TEX_MAX = 512;
const IQE_ROOT = 'vendor/unvanquished/pkg/res-players_src.dpkdir/models/players';
const OUT_DIR  = 'assets/models';
const CACHE    = 'tools/.cache';
const MAX_INFLUENCES = 4;

interface AlienSpec { name: string; dir: string }
const ALIENS: AlienSpec[] = [
  { name: 'enemy_dretch',   dir: 'level0' },
  { name: 'enemy_mantis',   dir: 'level1' },
  { name: 'enemy_marauder', dir: 'level2' },
  { name: 'enemy_dragoon',  dir: 'level3' },
  { name: 'enemy_tyrant',   dir: 'level4' },
  { name: 'player_bsuit',   dir: 'human_bsuit' },   // 3rd-person player model
];

// ===========================================================================
// IQE parsing
// ===========================================================================

interface Joint { name: string; parent: number }
interface Pose  { tx: number; ty: number; tz: number; qx: number; qy: number; qz: number; qw: number }
interface Frame { poses: Pose[] }                  // one Pose per joint
interface Anim  { name: string; framerate: number; frames: Frame[] }

interface VertAttr {
  pos: [number, number, number];
  nrm: [number, number, number];
  uv:  [number, number];
  jointIdx: [number, number, number, number];
  weight:   [number, number, number, number];
}

interface SubMesh {
  name: string;
  material: string;
  verts: VertAttr[];
  indices: number[];
}

interface Parsed {
  joints: Joint[];
  rest:   Pose[];            // one per joint
  subs:   SubMesh[];
  anims:  Anim[];
}

function parseIqe(text: string): Parsed {
  const joints: Joint[] = [];
  const rest: Pose[] = [];
  const subs: SubMesh[] = [];
  const anims: Anim[] = [];

  // State machine: either we're in the rest-pose preamble, in a mesh,
  // or inside an animation's frame.
  // - pq before any `animation` line: joint rest pose
  // - pq inside a frame: that joint's transform for the frame
  let curSub: SubMesh | null = null;
  let curAnim: Anim | null = null;
  let curFrame: Frame | null = null;
  let curFramerate = 30;
  let subVertIdx = 0;       // sub-mesh-local vertex index for vn/vt/vb padding
  let restJointIdx = 0;     // which joint's pq is next (during preamble)

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.length === 0 || ln.charAt(0) === '#') continue;
    const sp = ln.indexOf(' ');
    if (sp < 0) continue;
    const tag = ln.substring(0, sp);
    const rest_ = ln.substring(sp + 1).trim();

    if (tag === 'joint') {
      // joint "<name>" <parent>
      const mq = rest_.match(/^"([^"]*)"\s+(-?\d+)/);
      if (mq) joints.push({ name: mq[1], parent: parseInt(mq[2], 10) });
    } else if (tag === 'animation') {
      curAnim = { name: rest_.replace(/^"|"$/g, ''), framerate: curFramerate, frames: [] };
      anims.push(curAnim);
      curFrame = null;
    } else if (tag === 'framerate') {
      curFramerate = parseFloat(rest_);
      if (curAnim) curAnim.framerate = curFramerate;
    } else if (tag === 'frame') {
      if (!curAnim) continue;
      curFrame = { poses: [] };
      curAnim.frames.push(curFrame);
    } else if (tag === 'pq') {
      const a = rest_.split(/\s+/);
      const tx = parseFloat(a[0]), ty = parseFloat(a[1]), tz = parseFloat(a[2]);
      const qx = parseFloat(a[3]), qy = parseFloat(a[4]), qz = parseFloat(a[5]), qw = parseFloat(a[6]);
      // Whether this joint is a root is decided by joints[jointIdx].parent.
      // In the preamble `restJointIdx` is the index we're filling. In a frame
      // the index is `curFrame.poses.length` (the pose we're about to push).
      const jointIdx = curFrame ? curFrame.poses.length : restJointIdx;
      const isRoot = jointIdx < joints.length && joints[jointIdx].parent < 0;
      let tout: [number, number, number], qout: [number, number, number, number];
      if (isRoot) {
        const wrapped = x90Prefix(tx, ty, tz, qx, qy, qz, qw);
        tout = wrapped.t; qout = wrapped.q;
      } else {
        tout = [tx, ty, tz]; qout = [qx, qy, qz, qw];
      }
      const p: Pose = { tx: tout[0], ty: tout[1], tz: tout[2],
                        qx: qout[0], qy: qout[1], qz: qout[2], qw: qout[3] };
      if (curFrame) {
        curFrame.poses.push(p);
      } else if (!curAnim) {
        rest[restJointIdx] = p;
        restJointIdx++;
      }
    } else if (tag === 'mesh') {
      curSub = { name: rest_.replace(/^"|"$/g, ''), material: '', verts: [], indices: [] };
      subs.push(curSub);
      subVertIdx = 0;
    } else if (tag === 'material') {
      if (curSub) curSub.material = rest_.replace(/^"|"$/g, '');
    } else if (tag === 'vp') {
      if (!curSub) continue;
      const a = rest_.split(/\s+/);
      const pos = yupVec3(parseFloat(a[0]), parseFloat(a[1]), parseFloat(a[2]));
      curSub.verts.push({
        pos,
        nrm: [0, 1, 0],
        uv:  [0, 0],
        jointIdx: [0, 0, 0, 0],
        weight:   [0, 0, 0, 0],
      });
      subVertIdx++;
    } else if (tag === 'vn') {
      if (!curSub || curSub.verts.length === 0) continue;
      const a = rest_.split(/\s+/);
      const v = curSub.verts[curSub.verts.length - 1];
      v.nrm = yupVec3(parseFloat(a[0]), parseFloat(a[1]), parseFloat(a[2]));
    } else if (tag === 'vt') {
      if (!curSub || curSub.verts.length === 0) continue;
      const a = rest_.split(/\s+/);
      const v = curSub.verts[curSub.verts.length - 1];
      v.uv = [parseFloat(a[0]), 1.0 - parseFloat(a[1])];
    } else if (tag === 'vb') {
      if (!curSub || curSub.verts.length === 0) continue;
      const a = rest_.split(/\s+/);
      // Pairs of (jointIdx, weight). Take the top 4 by weight.
      const pairs: [number, number][] = [];
      for (let k = 0; k + 1 < a.length; k += 2) {
        pairs.push([parseInt(a[k], 10), parseFloat(a[k + 1])]);
      }
      pairs.sort((p, q) => q[1] - p[1]);
      const top = pairs.slice(0, MAX_INFLUENCES);
      // Renormalise — IQE weights sum to ~1.0 already, but after truncation
      // we may have lost mass.
      let sum = 0; for (let k = 0; k < top.length; k++) sum += top[k][1];
      if (sum > 0) for (let k = 0; k < top.length; k++) top[k][1] /= sum;
      const v = curSub.verts[curSub.verts.length - 1];
      for (let k = 0; k < MAX_INFLUENCES; k++) {
        if (k < top.length) {
          v.jointIdx[k] = top[k][0];
          v.weight[k]   = top[k][1];
        } else {
          v.jointIdx[k] = 0;
          v.weight[k]   = 0;
        }
      }
    } else if (tag === 'fm') {
      if (!curSub) continue;
      const a = rest_.split(/\s+/);
      curSub.indices.push(parseInt(a[0], 10), parseInt(a[1], 10), parseInt(a[2], 10));
    }
    // vx, vertexarray: ignored (vx looks like precomputed world-space positions)
  }

  return { joints, rest, subs, anims };
}

// ===========================================================================
// Math helpers (4x4 matrices as flat 16-float arrays, column-major per glTF)
// ===========================================================================

function matIdentity(): number[] { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }

// ===========================================================================
// Z-up → Y-up conversion (IQE/Quake convention → glTF convention)
// ===========================================================================
// Vertex and direction convention: (x, y, z) → (x, z, -y). Determinant +1
// so triangle winding is preserved. Apply the SAME conversion to every
// coordinate-carrying field: vertex positions, vertex normals, joint
// translations, joint rotations (as quaternions), and animation keyframes.
// When applied uniformly to rest pose + all anim frames + mesh, the skeletal
// hierarchy and IBMs compose correctly and no armature-level transform is
// needed.

// Y-up conversion used for VERTICES only. Joints & IBMs handled separately
// below: only the root joints get X90 left-multiplied into their local TRS
// (and into every anim keyframe of those roots), which propagates through
// the hierarchy.
function yupVec3(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}
// Left-multiply a TRS by X90 (Z-up → Y-up). X90 = rotation −90° around X.
// X90 as quaternion = (sin(−45°), 0, 0, cos(−45°)) = (−s, 0, 0, s) with s = √½.
// Result of X90 · (T, R) =
//   T' = X90 · T   (rotate the translation vector)
//   R' = X90_q · R (prepend X90 to the rotation quaternion)
const S = Math.SQRT1_2;
const X90_Q: [number, number, number, number] = [-S, 0, 0, S];
function quatMul(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  const qx = aw*bx + ax*bw + ay*bz - az*by;
  const qy = aw*by - ax*bz + ay*bw + az*bx;
  const qz = aw*bz + ax*by - ay*bx + az*bw;
  const qw = aw*bw - ax*bx - ay*by - az*bz;
  // Renormalise — the product of two unit quats should be unit-length,
  // but FP error accumulates and gltf-validator rejects |q| > 1.0 + ε.
  const inv = 1 / Math.sqrt(qx*qx + qy*qy + qz*qz + qw*qw);
  return [qx * inv, qy * inv, qz * inv, qw * inv];
}
function x90Prefix(tx: number, ty: number, tz: number,
                   qx: number, qy: number, qz: number, qw: number):
                   { t: [number, number, number]; q: [number, number, number, number] } {
  return {
    t: yupVec3(tx, ty, tz),
    q: quatMul(X90_Q, [qx, qy, qz, qw]),
  };
}

function matFromTrsQ(t: [number,number,number], q: [number,number,number,number]): number[] {
  const [x, y, z, w] = q;
  const xx = x*x, yy = y*y, zz = z*z;
  const xy = x*y, xz = x*z, yz = y*z;
  const wx = w*x, wy = w*y, wz = w*z;
  // Column-major layout.
  return [
    1 - 2*(yy+zz),   2*(xy+wz),       2*(xz-wy),      0,
    2*(xy-wz),       1 - 2*(xx+zz),   2*(yz+wx),      0,
    2*(xz+wy),       2*(yz-wx),       1 - 2*(xx+yy),  0,
    t[0], t[1], t[2], 1,
  ];
}

function matMul(a: number[], b: number[]): number[] {
  const r = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let rw = 0; rw < 4; rw++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k*4 + rw] * b[c*4 + k];
      r[c*4 + rw] = s;
    }
  }
  return r;
}

// 4x4 inverse via cofactor expansion (generic; works for any invertible mat).
function matInverse(m: number[]): number[] {
  const inv = new Array<number>(16);
  inv[0]  =  m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
  inv[4]  = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
  inv[8]  =  m[4]*m[9]*m[15]  - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
  inv[12] = -m[4]*m[9]*m[14]  + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
  inv[1]  = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
  inv[5]  =  m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
  inv[9]  = -m[0]*m[9]*m[15]  + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
  inv[13] =  m[0]*m[9]*m[14]  - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
  inv[2]  =  m[1]*m[6]*m[15]  - m[1]*m[7]*m[14]  - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7]  - m[13]*m[3]*m[6];
  inv[6]  = -m[0]*m[6]*m[15]  + m[0]*m[7]*m[14]  + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7]  + m[12]*m[3]*m[6];
  inv[10] =  m[0]*m[5]*m[15]  - m[0]*m[7]*m[13]  - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7]  - m[12]*m[3]*m[5];
  inv[14] = -m[0]*m[5]*m[14]  + m[0]*m[6]*m[13]  + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6]  + m[12]*m[2]*m[5];
  inv[3]  = -m[1]*m[6]*m[11]  + m[1]*m[7]*m[10]  + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7]   + m[9]*m[3]*m[6];
  inv[7]  =  m[0]*m[6]*m[11]  - m[0]*m[7]*m[10]  - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7]   - m[8]*m[3]*m[6];
  inv[11] = -m[0]*m[5]*m[11]  + m[0]*m[7]*m[9]   + m[4]*m[1]*m[11] - m[4]*m[3]*m[9]  - m[8]*m[1]*m[7]   + m[8]*m[3]*m[5];
  inv[15] =  m[0]*m[5]*m[10]  - m[0]*m[6]*m[9]   - m[4]*m[1]*m[10] + m[4]*m[2]*m[9]  + m[8]*m[1]*m[6]   - m[8]*m[2]*m[5];
  const det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
  if (det === 0) return matIdentity();
  const d = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= d;
  return inv;
}

// ===========================================================================
// GLB writer with skin + animations
// ===========================================================================

function align4(n: number): number { return (n + 3) & ~3; }

function resizeTexture(src: string, cachePath: string): Uint8Array {
  mkdirSync(dirname(cachePath), { recursive: true });
  execSync(`sips --resampleHeightWidthMax ${TEX_MAX} "${src}" --out "${cachePath}"`,
           { stdio: 'pipe' });
  return new Uint8Array(readFileSync(cachePath));
}

function buildGlb(p: Parsed, mats: { material: string; imgBytes: Uint8Array }[]): Uint8Array {
  const J = p.joints.length;

  // 1. Compute per-joint world matrices at rest pose. All TRS values in p
  //    have already been converted to glTF Y-up by the parser (via yupVec3
  //    / x90Prefix), so IBMs are just plain inverses of the world matrices.
  const localMats = p.rest.map(rp =>
    matFromTrsQ([rp.tx, rp.ty, rp.tz], [rp.qx, rp.qy, rp.qz, rp.qw]));
  const worldMats: number[][] = new Array(J);
  for (let j = 0; j < J; j++) {
    const parent = p.joints[j].parent;
    worldMats[j] = parent < 0 ? localMats[j] : matMul(worldMats[parent], localMats[j]);
  }
  const ibms = worldMats.map(matInverse);

  // 2. Binary layout: per-sub-mesh accessors, then IBMs, then anim input/output buffers, then images.
  //    Everything 4-byte aligned.
  interface Slot { off: number; len: number }
  interface SubSlots { idx: Slot; pos: Slot; nrm: Slot; uv: Slot; jnt: Slot; wt: Slot; material: number }

  const subSlots: SubSlots[] = [];
  let binLen = 0;
  for (let i = 0; i < p.subs.length; i++) {
    const s = p.subs[i];
    const vc = s.verts.length;
    const ic = s.indices.length;
    const idxOff = align4(binLen);    binLen = idxOff + align4(ic * 2);
    const posOff = binLen;             binLen = posOff + vc * 3 * 4;
    const nrmOff = binLen;             binLen = nrmOff + vc * 3 * 4;
    const uvOff  = binLen;             binLen = uvOff  + vc * 2 * 4;
    const jntOff = binLen;             binLen = jntOff + vc * 4 * 2;     // u16 × 4
    const wtOff  = binLen;             binLen = wtOff  + vc * 4 * 4;     // f32 × 4
    const matIdx = mats.findIndex(m => m.material === s.material);
    subSlots.push({
      idx: { off: idxOff, len: ic * 2 },
      pos: { off: posOff, len: vc * 3 * 4 },
      nrm: { off: nrmOff, len: vc * 3 * 4 },
      uv:  { off: uvOff,  len: vc * 2 * 4 },
      jnt: { off: jntOff, len: vc * 4 * 2 },
      wt:  { off: wtOff,  len: vc * 4 * 4 },
      material: matIdx,
    });
  }
  // IBMs: one Mat4 per joint.
  const ibmOff = align4(binLen);
  binLen = ibmOff + J * 16 * 4;

  // Animations: per anim, per joint, we emit translation + rotation channels.
  // Shared per-anim time buffer (VEC3 input), per-joint translation VEC3 and rotation VEC4 output buffers.
  interface AnimSlots {
    timeOff: number; timeLen: number; timeCount: number;
    // Per-joint translation + rotation output offsets.
    tOff: number[]; tLen: number[];
    rOff: number[]; rLen: number[];
  }
  const animSlots: AnimSlots[] = [];
  for (let ai = 0; ai < p.anims.length; ai++) {
    const a = p.anims[ai];
    const frames = a.frames.length;
    const timeOff = align4(binLen); binLen = timeOff + frames * 4;
    const tOff: number[] = new Array(J);
    const tLen: number[] = new Array(J);
    const rOff: number[] = new Array(J);
    const rLen: number[] = new Array(J);
    for (let j = 0; j < J; j++) {
      tOff[j] = align4(binLen); binLen = tOff[j] + frames * 3 * 4;
      tLen[j] = frames * 3 * 4;
      rOff[j] = align4(binLen); binLen = rOff[j] + frames * 4 * 4;
      rLen[j] = frames * 4 * 4;
    }
    animSlots.push({ timeOff, timeLen: frames * 4, timeCount: frames, tOff, tLen, rOff, rLen });
  }

  // Images trailing.
  const imgSlots: Slot[] = [];
  for (let i = 0; i < mats.length; i++) {
    const off = align4(binLen);
    binLen = off + mats[i].imgBytes.length;
    imgSlots.push({ off, len: mats[i].imgBytes.length });
  }
  binLen = align4(binLen);

  // 3. Fill binary.
  const bin = new Uint8Array(binLen);
  const dv  = new DataView(bin.buffer);
  for (let i = 0; i < p.subs.length; i++) {
    const s = p.subs[i];
    const ss = subSlots[i];
    for (let k = 0; k < s.indices.length; k++) dv.setUint16(ss.idx.off + k * 2, s.indices[k], true);
    for (let k = 0; k < s.verts.length; k++) {
      const v = s.verts[k];
      dv.setFloat32(ss.pos.off + k * 12 + 0, v.pos[0], true);
      dv.setFloat32(ss.pos.off + k * 12 + 4, v.pos[1], true);
      dv.setFloat32(ss.pos.off + k * 12 + 8, v.pos[2], true);
      dv.setFloat32(ss.nrm.off + k * 12 + 0, v.nrm[0], true);
      dv.setFloat32(ss.nrm.off + k * 12 + 4, v.nrm[1], true);
      dv.setFloat32(ss.nrm.off + k * 12 + 8, v.nrm[2], true);
      dv.setFloat32(ss.uv.off  + k * 8  + 0, v.uv[0],  true);
      dv.setFloat32(ss.uv.off  + k * 8  + 4, v.uv[1],  true);
      for (let q = 0; q < 4; q++) {
        dv.setUint16 (ss.jnt.off + k * 8  + q * 2, v.jointIdx[q], true);
        dv.setFloat32(ss.wt.off  + k * 16 + q * 4, v.weight[q],   true);
      }
    }
  }
  for (let j = 0; j < J; j++) {
    for (let k = 0; k < 16; k++) dv.setFloat32(ibmOff + j * 64 + k * 4, ibms[j][k], true);
  }
  for (let ai = 0; ai < p.anims.length; ai++) {
    const a = p.anims[ai];
    const sl = animSlots[ai];
    const dtf = 1 / a.framerate;
    for (let f = 0; f < a.frames.length; f++) {
      dv.setFloat32(sl.timeOff + f * 4, f * dtf, true);
    }
    for (let j = 0; j < J; j++) {
      for (let f = 0; f < a.frames.length; f++) {
        const pose = a.frames[f].poses[j] ?? p.rest[j];
        dv.setFloat32(sl.tOff[j] + f * 12 + 0, pose.tx, true);
        dv.setFloat32(sl.tOff[j] + f * 12 + 4, pose.ty, true);
        dv.setFloat32(sl.tOff[j] + f * 12 + 8, pose.tz, true);
        dv.setFloat32(sl.rOff[j] + f * 16 + 0, pose.qx, true);
        dv.setFloat32(sl.rOff[j] + f * 16 + 4, pose.qy, true);
        dv.setFloat32(sl.rOff[j] + f * 16 + 8, pose.qz, true);
        dv.setFloat32(sl.rOff[j] + f * 16 + 12, pose.qw, true);
      }
    }
  }
  for (let i = 0; i < mats.length; i++) bin.set(mats[i].imgBytes, imgSlots[i].off);

  // 4. Build JSON graph.
  const bufferViews: { buffer: number; byteOffset: number; byteLength: number; target?: number }[] = [];
  const accessors:   { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[] = [];
  const primitives:  { attributes: Record<string, number>; indices: number; material: number; mode: number }[] = [];

  for (let i = 0; i < p.subs.length; i++) {
    const s = p.subs[i];
    const ss = subSlots[i];
    const vc = s.verts.length;
    const ic = s.indices.length;
    const mins = [s.verts[0].pos[0], s.verts[0].pos[1], s.verts[0].pos[2]];
    const maxs = [s.verts[0].pos[0], s.verts[0].pos[1], s.verts[0].pos[2]];
    for (let k = 1; k < vc; k++) {
      const p0 = s.verts[k].pos;
      if (p0[0] < mins[0]) mins[0] = p0[0]; if (p0[0] > maxs[0]) maxs[0] = p0[0];
      if (p0[1] < mins[1]) mins[1] = p0[1]; if (p0[1] > maxs[1]) maxs[1] = p0[1];
      if (p0[2] < mins[2]) mins[2] = p0[2]; if (p0[2] > maxs[2]) maxs[2] = p0[2];
    }
    const bvIdx = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: ss.idx.off, byteLength: ic * 2,     target: 34963 });
    const bvPos = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: ss.pos.off, byteLength: vc * 3 * 4, target: 34962 });
    const bvNrm = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: ss.nrm.off, byteLength: vc * 3 * 4, target: 34962 });
    const bvUv  = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: ss.uv.off,  byteLength: vc * 2 * 4, target: 34962 });
    const bvJnt = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: ss.jnt.off, byteLength: vc * 4 * 2, target: 34962 });
    const bvWt  = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: ss.wt.off,  byteLength: vc * 4 * 4, target: 34962 });
    const aIdx  = accessors.length; accessors.push({ bufferView: bvIdx, componentType: 5123, count: ic, type: 'SCALAR' });
    const aPos  = accessors.length; accessors.push({ bufferView: bvPos, componentType: 5126, count: vc, type: 'VEC3', min: mins, max: maxs });
    const aNrm  = accessors.length; accessors.push({ bufferView: bvNrm, componentType: 5126, count: vc, type: 'VEC3' });
    const aUv   = accessors.length; accessors.push({ bufferView: bvUv,  componentType: 5126, count: vc, type: 'VEC2' });
    const aJnt  = accessors.length; accessors.push({ bufferView: bvJnt, componentType: 5123, count: vc, type: 'VEC4' });    // u16
    const aWt   = accessors.length; accessors.push({ bufferView: bvWt,  componentType: 5126, count: vc, type: 'VEC4' });
    primitives.push({
      attributes: { POSITION: aPos, NORMAL: aNrm, TEXCOORD_0: aUv, JOINTS_0: aJnt, WEIGHTS_0: aWt },
      indices: aIdx,
      material: ss.material,
      mode: 4,
    });
  }

  // IBM accessor
  const bvIbm = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: ibmOff, byteLength: J * 64 });
  const aIbm  = accessors.length;   accessors.push({ bufferView: bvIbm, componentType: 5126, count: J, type: 'MAT4' });

  // Animation channels/samplers, one per (anim, joint, channel).
  interface Sampler { input: number; output: number; interpolation: string }
  interface Channel { sampler: number; target: { node: number; path: string } }
  const animsJson: { name: string; channels: Channel[]; samplers: Sampler[] }[] = [];

  // Node indices: 0..J-1 = joints (jointIdx j -> node j). J = mesh node.
  // We don't wrap everything under an armature node because bloom's skeleton
  // walker ignores node transforms above the skin's joint list (the Z-up →
  // Y-up rotation is baked into the IBMs instead, up above).
  const MESH_NODE = J;
  for (let ai = 0; ai < p.anims.length; ai++) {
    const a = p.anims[ai];
    const sl = animSlots[ai];
    const samplers: Sampler[] = [];
    const channels: Channel[] = [];
    const bvTime = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: sl.timeOff, byteLength: sl.timeLen });
    const aTime = accessors.length;
    accessors.push({ bufferView: bvTime, componentType: 5126, count: sl.timeCount, type: 'SCALAR', min: [0], max: [(sl.timeCount - 1) / a.framerate] });
    for (let j = 0; j < J; j++) {
      const bvT = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: sl.tOff[j], byteLength: sl.tLen[j] });
      const bvR = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: sl.rOff[j], byteLength: sl.rLen[j] });
      const aT  = accessors.length;   accessors.push({ bufferView: bvT, componentType: 5126, count: sl.timeCount, type: 'VEC3' });
      const aR  = accessors.length;   accessors.push({ bufferView: bvR, componentType: 5126, count: sl.timeCount, type: 'VEC4' });
      const sT  = samplers.length;    samplers.push({ input: aTime, output: aT, interpolation: 'LINEAR' });
      const sR  = samplers.length;    samplers.push({ input: aTime, output: aR, interpolation: 'LINEAR' });
      channels.push({ sampler: sT, target: { node: j, path: 'translation' } });
      channels.push({ sampler: sR, target: { node: j, path: 'rotation' } });
    }
    animsJson.push({ name: a.name, channels, samplers });
  }

  const imageBv: number[] = [];
  for (let i = 0; i < mats.length; i++) {
    const bv = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: imgSlots[i].off, byteLength: imgSlots[i].len });
    imageBv.push(bv);
  }

  // Node list. Node 0 is the armature root — it rotates -90° around X to
  // convert IQE Z-up to glTF Y-up, and its children are the top-level
  // IQE joints (joints with parent = -1). Joints 1..J are the skeleton.
  // The mesh node (J+1) is top-level in the scene because glTF skinned
  // meshes MUST NOT have parent transforms; the armature rotation feeds
  // into the joint world matrices via the skeleton hierarchy instead.
  // Flat node layout: joints 0..J-1 (with the IQE parent-relative rest TRS
  // from pq), plus the mesh node J. No armature wrapper — bloom wouldn't
  // honour its transform anyway.
  const skeletonRootNodes: number[] = [];
  const jointChildren: number[][] = new Array(J);
  for (let j = 0; j < J; j++) jointChildren[j] = [];
  for (let j = 0; j < J; j++) {
    const parent = p.joints[j].parent;
    if (parent < 0) skeletonRootNodes.push(j);
    else jointChildren[parent].push(j);
  }
  const nodes: { name?: string; translation?: number[]; rotation?: number[]; children?: number[]; mesh?: number; skin?: number }[] = [];
  for (let j = 0; j < J; j++) {
    const rp = p.rest[j];
    nodes.push({
      name: p.joints[j].name,
      translation: [rp.tx, rp.ty, rp.tz],
      rotation:    [rp.qx, rp.qy, rp.qz, rp.qw],
      children: jointChildren[j].length > 0 ? jointChildren[j] : undefined,
    });
  }
  nodes.push({ name: 'mesh', mesh: 0, skin: 0 });

  const gltf = {
    asset:  { version: '2.0', generator: 'shooter-convert-aliens-anim' },
    scene:  0,
    scenes: [{ nodes: [...skeletonRootNodes, MESH_NODE] }],
    nodes,
    meshes:    [{ primitives }],
    skins:     [{ joints: Array.from({ length: J }, (_, j) => j),
                  inverseBindMatrices: aIbm }],
    materials: mats.map((m, i) => ({
      name: basename(m.material),
      pbrMetallicRoughness: {
        baseColorTexture: { index: i },
        metallicFactor: 0.0,
        roughnessFactor: 0.9,
      },
    })),
    textures: mats.map((_, i) => ({ source: i, sampler: 0 })),
    images:   mats.map((_, i) => ({ bufferView: imageBv[i], mimeType: 'image/png' })),
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    animations: animsJson,
    buffers:  [{ byteLength: binLen }],
    bufferViews,
    accessors,
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = new Uint8Array(align4(jsonBytes.length));
  jsonPad.set(jsonBytes);
  for (let i = jsonBytes.length; i < jsonPad.length; i++) jsonPad[i] = 0x20;

  const totalLen = 12 + 8 + jsonPad.length + 8 + bin.length;
  const out = new Uint8Array(totalLen);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, 0x46546C67, true);
  odv.setUint32(4, 2,          true);
  odv.setUint32(8, totalLen,   true);
  odv.setUint32(12, jsonPad.length, true);
  odv.setUint32(16, 0x4E4F534A, true);
  out.set(jsonPad, 20);
  const binChunkOff = 20 + jsonPad.length;
  odv.setUint32(binChunkOff,     bin.length,  true);
  odv.setUint32(binChunkOff + 4, 0x004E4942,  true);
  out.set(bin, binChunkOff + 8);
  return out;
}

// ===========================================================================
// Main
// ===========================================================================

function resolveTexture(iqeDir: string, material: string): string {
  const base = basename(material);
  const candidate = iqeDir + '/' + base + '.png';
  if (existsSync(candidate)) return candidate;
  throw new Error('texture not found for ' + material);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE,   { recursive: true });

for (let i = 0; i < ALIENS.length; i++) {
  const a = ALIENS[i];
  const iqePath = IQE_ROOT + '/' + a.dir + '/' + a.dir + '.iqe';
  if (!existsSync(iqePath)) { console.warn('[skip]', a.name); continue; }

  console.log('[' + a.name + ']');
  const parsed = parseIqe(readFileSync(iqePath, 'utf8'));
  console.log('  joints:', parsed.joints.length,
              ' subs:', parsed.subs.length,
              ' anims:', parsed.anims.length);

  const iqeDir = dirname(iqePath);
  const mats: { material: string; imgBytes: Uint8Array }[] = [];
  for (let s = 0; s < parsed.subs.length; s++) {
    const sub = parsed.subs[s];
    if (mats.some(m => m.material === sub.material)) continue;
    const texSrc = resolveTexture(iqeDir, sub.material);
    const cachePath = CACHE + '/' + a.name + '_' + basename(sub.material) + '.png';
    mats.push({ material: sub.material, imgBytes: resizeTexture(texSrc, cachePath) });
  }

  const glb = buildGlb(parsed, mats);
  const outPath = OUT_DIR + '/' + a.name + '.glb';
  writeFileSync(outPath, glb);
  console.log('  wrote', outPath, '(' + glb.length, 'bytes)');
}
