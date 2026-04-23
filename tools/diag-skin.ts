// Sanity-check a skinned GLB: for each joint, verify that
//   rest_world[j] · IBM[j] ≈ identity
// If this fails, skinning at the bind pose produces deformation.

import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'assets/models/enemy_dretch.glb';
const buf = readFileSync(path);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const jsonLen = dv.getUint32(12, true);
const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf.buffer, buf.byteOffset + 20, jsonLen)));
const binOff = 20 + ((jsonLen + 3) & ~3) + 8;
const binBuf = new Uint8Array(buf.buffer, buf.byteOffset + binOff, buf.byteLength - binOff);
const binDv = new DataView(binBuf.buffer, binBuf.byteOffset, binBuf.byteLength);

const skin = gltf.skins[0];
const jointNodes: number[] = skin.joints;
const ibmAcc = gltf.accessors[skin.inverseBindMatrices];
const ibmBv = gltf.bufferViews[ibmAcc.bufferView];
const ibmOffset = (ibmBv.byteOffset ?? 0) + (ibmAcc.byteOffset ?? 0);

function readMat(off: number): number[] {
  const m = new Array(16);
  for (let i = 0; i < 16; i++) m[i] = binDv.getFloat32(off + i * 4, true);
  return m;
}

// Column-major mat4 mul (out[c][r] = sum_k a[k][r] * b[c][k])
function matMul(a: number[], b: number[]): number[] {
  const r = new Array(16);
  for (let c = 0; c < 4; c++) for (let rw = 0; rw < 4; rw++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k*4+rw] * b[c*4+k];
    r[c*4+rw] = s;
  }
  return r;
}

function matFromTrsQ(t: number[], q: number[]): number[] {
  const [x, y, z, w] = q;
  const xx = x*x, yy = y*y, zz = z*z;
  const xy = x*y, xz = x*z, yz = y*z;
  const wx = w*x, wy = w*y, wz = w*z;
  return [
    1 - 2*(yy+zz),   2*(xy+wz),       2*(xz-wy),      0,
    2*(xy-wz),       1 - 2*(xx+zz),   2*(yz+wx),      0,
    2*(xz+wy),       2*(yz-wx),       1 - 2*(xx+yy),  0,
    t[0], t[1], t[2], 1,
  ];
}

// Build parent map from children lists
const N = gltf.nodes.length;
const parent = new Array<number>(N).fill(-1);
for (let p = 0; p < N; p++) {
  for (const c of gltf.nodes[p].children ?? []) parent[c] = p;
}

function restWorld(nodeIdx: number): number[] {
  const n = gltf.nodes[nodeIdx];
  const t = n.translation ?? [0, 0, 0];
  const r = n.rotation    ?? [0, 0, 0, 1];
  const local = matFromTrsQ(t, r);
  const par = parent[nodeIdx];
  return par < 0 ? local : matMul(restWorld(par), local);
}

function fmt(m: number[]): string {
  return '[' + m.map(v => v.toFixed(3).padStart(7)).join(',') + ']';
}

console.log('Joint count:', jointNodes.length);
let worst = 0;
for (let j = 0; j < Math.min(jointNodes.length, 5); j++) {
  const nodeIdx = jointNodes[j];
  const world = restWorld(nodeIdx);
  const ibm = readMat(ibmOffset + j * 64);
  const prod = matMul(world, ibm);
  // Distance from identity.
  let dev = 0;
  for (let k = 0; k < 16; k++) {
    const expected = [0,5,10,15].includes(k) ? 1 : 0;
    dev = Math.max(dev, Math.abs(prod[k] - expected));
  }
  if (dev > worst) worst = dev;
  console.log(`joint ${j} (${gltf.nodes[nodeIdx].name}): |world·IBM - I|_∞ = ${dev.toExponential(2)}`);
  if (j === 0) {
    console.log('  world row0:', fmt(world.filter((_, i) => i % 4 === 0)));
    console.log('  ibm   row0:', fmt(ibm.filter((_, i) => i % 4 === 0)));
    console.log('  prod  row0:', fmt(prod.filter((_, i) => i % 4 === 0)));
  }
}
// Worst across all joints:
let maxDev = 0;
for (let j = 0; j < jointNodes.length; j++) {
  const world = restWorld(jointNodes[j]);
  const ibm = readMat(ibmOffset + j * 64);
  const prod = matMul(world, ibm);
  for (let k = 0; k < 16; k++) {
    const exp = [0,5,10,15].includes(k) ? 1 : 0;
    const d = Math.abs(prod[k] - exp);
    if (d > maxDev) maxDev = d;
  }
}
console.log(`\nworst deviation across all ${jointNodes.length} joints:`, maxDev.toExponential(2));
