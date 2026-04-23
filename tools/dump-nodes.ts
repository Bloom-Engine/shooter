// Dump all nodes + scene structure of a GLB for comparison.
import { readFileSync } from 'node:fs';
const path = process.argv[2];
const buf = readFileSync(path);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const jsonLen = dv.getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf.buffer, buf.byteOffset + 20, jsonLen)));
console.log('scene roots:', json.scenes[0].nodes);
for (let i = 0; i < json.nodes.length; i++) {
  const n = json.nodes[i];
  const flags = [];
  if (n.mesh !== undefined) flags.push('MESH#' + n.mesh);
  if (n.skin !== undefined) flags.push('SKIN#' + n.skin);
  if (n.children) flags.push('ch=' + JSON.stringify(n.children));
  console.log(i, (n.name ?? '').padEnd(30), flags.join(' '));
}
