// Decode a GLB header + JSON chunk and print a compact summary.
// Usage: bun tools/inspect-glb.ts <path.glb>

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: bun inspect-glb.ts <path.glb>'); process.exit(1); }

const buf = readFileSync(path);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const magic = dv.getUint32(0, true);
if (magic !== 0x46546C67) { console.error('not a GLB'); process.exit(1); }
const version = dv.getUint32(4, true);
const total   = dv.getUint32(8, true);
console.log('GLB version', version, 'total', total, 'bytes');

const jsonLen = dv.getUint32(12, true);
const jsonTag = dv.getUint32(16, true);
if (jsonTag !== 0x4E4F534A) { console.error('expected JSON chunk first'); process.exit(1); }
const jsonBytes = new Uint8Array(buf.buffer, buf.byteOffset + 20, jsonLen);
const gltf = JSON.parse(new TextDecoder().decode(jsonBytes));

console.log('scenes:', JSON.stringify(gltf.scenes));
console.log('nodes (' + gltf.nodes.length + '):');
for (let i = 0; i < gltf.nodes.length && i < 8; i++) {
  const n = gltf.nodes[i];
  const bits = [];
  if (n.name) bits.push('"' + n.name + '"');
  if (n.translation) bits.push('T=[' + n.translation.map((v: number) => v.toFixed(2)).join(',') + ']');
  if (n.rotation) bits.push('R=[' + n.rotation.map((v: number) => v.toFixed(2)).join(',') + ']');
  if (n.scale) bits.push('S=[' + n.scale.map((v: number) => v.toFixed(2)).join(',') + ']');
  if (n.mesh !== undefined) bits.push('mesh=' + n.mesh);
  if (n.skin !== undefined) bits.push('skin=' + n.skin);
  if (n.children) bits.push('children=' + n.children.length);
  console.log('  ', i, bits.join(' '));
}
if (gltf.nodes.length > 8) console.log('  … + ' + (gltf.nodes.length - 8) + ' more');
console.log('meshes:', gltf.meshes?.length, 'primitives on mesh 0:', gltf.meshes?.[0]?.primitives?.length);
if (gltf.meshes?.[0]?.primitives?.[0]?.attributes) {
  console.log('  attrs:', Object.keys(gltf.meshes[0].primitives[0].attributes).join(','));
}
console.log('skins:', gltf.skins?.length);
if (gltf.skins?.[0]) {
  const s = gltf.skins[0];
  console.log('  joints:', s.joints?.length, 'skeleton:', s.skeleton, 'ibm accessor:', s.inverseBindMatrices);
}
console.log('animations:', gltf.animations?.length);
if (gltf.animations?.[0]) {
  const a = gltf.animations[0];
  console.log('  anim 0 name:', a.name, 'channels:', a.channels.length, 'samplers:', a.samplers.length);
  console.log('    first channel target:', JSON.stringify(a.channels[0].target), 'sampler:', a.channels[0].sampler);
}
console.log('accessors:', gltf.accessors?.length, 'bufferViews:', gltf.bufferViews?.length);
