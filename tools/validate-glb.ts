// Validate a GLB against the Khronos glTF 2.0 schema and print issues.
// Usage: bun tools/validate-glb.ts <path.glb>

import { readFileSync } from 'node:fs';
import { validateBytes } from 'gltf-validator';

const path = process.argv[2];
if (!path) { console.error('usage: bun validate-glb.ts <path.glb>'); process.exit(1); }

const bytes = new Uint8Array(readFileSync(path));
const report = await validateBytes(bytes);
const issues = report.issues;
console.log('severity totals:',
  'errors=' + issues.numErrors,
  'warnings=' + issues.numWarnings,
  'infos=' + issues.numInfos,
  'hints=' + issues.numHints);
const messages = issues.messages ?? [];
for (const m of messages.slice(0, 60)) {
  const sev = ['E', 'W', 'I', 'H'][m.severity] ?? '?';
  console.log(`[${sev}] ${m.code} @ ${m.pointer ?? ''}  —  ${m.message}`);
}
if (messages.length > 60) console.log(`… + ${messages.length - 60} more`);
