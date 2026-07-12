// SH-027 — weapon models.
//
// The game drew both weapons as grey `drawCube` primitives, which was the most
// visible placeholder left in it. The right long-term answer is the Unvanquished
// weapon art (`res-weapons_src.dpkdir`), and `tools/convert-aliens-anim.ts`
// already knows how to read that format — but the vendor submodule is a large
// clone I shouldn't pull unasked (docs/ASSET-TODO.md D1/M1).
//
// So these are built here: real GLBs, silhouettes that read at a glance, and —
// the part that actually matters for gameplay — a documented muzzle point per
// weapon, so flashes, tracers and shell ejection originate from the barrel
// instead of from the middle of a cube. Swapping in the Unvanquished meshes
// later changes these files and nothing else.
//
//   bun tools/build-weapons.ts

import { writeFileSync, mkdirSync } from 'fs';

// ---- tiny GLB writer --------------------------------------------------------
// Same shape as the other converters in this directory: build one interleaved
// vertex buffer + index buffer, wrap it in a minimal glTF, emit a binary .glb.

interface Prim {
  pos: number[];      // xyz per vertex
  nrm: number[];
  idx: number[];
  color: [number, number, number];
  metallic: number;
  roughness: number;
}

function box(
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  color: [number, number, number], metallic: number, roughness: number,
): Prim {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  // 6 faces x 4 verts, so normals stay flat per face (a shared-vertex cube
  // gets smeared normals and reads like a rounded lump).
  const faces: number[][][] = [
    [[1, 0, 0], [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  for (const f of faces) {
    const n = f[0] as number[];
    const corners = f[1] as number[][];
    const base = pos.length / 3;
    for (const c of corners) {
      pos.push(cx + c[0] * hx, cy + c[1] * hy, cz + c[2] * hz);
      nrm.push(n[0], n[1], n[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos, nrm, idx, color, metallic, roughness };
}

/// Cylinder along Z — barrels, magazines, the cannon's coil.
function cyl(
  cx: number, cy: number, cz: number,
  r: number, halfLen: number, seg: number,
  color: [number, number, number], metallic: number, roughness: number,
): Prim {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const x0 = Math.cos(a0), y0 = Math.sin(a0);
    const x1 = Math.cos(a1), y1 = Math.sin(a1);
    const base = pos.length / 3;
    pos.push(cx + x0 * r, cy + y0 * r, cz - halfLen);
    pos.push(cx + x1 * r, cy + y1 * r, cz - halfLen);
    pos.push(cx + x1 * r, cy + y1 * r, cz + halfLen);
    pos.push(cx + x0 * r, cy + y0 * r, cz + halfLen);
    nrm.push(x0, y0, 0, x1, y1, 0, x1, y1, 0, x0, y0, 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos, nrm, idx, color, metallic, roughness };
}

function writeGlb(path: string, prims: Prim[]): void {
  // Merge into one buffer; one glTF mesh primitive per Prim so each keeps its
  // own material.
  const bin: number[] = [];
  const views: any[] = [];
  const accessors: any[] = [];
  const meshPrims: any[] = [];
  const materials: any[] = [];

  const align4 = () => { while (bin.length % 4 !== 0) bin.push(0); };

  for (let pi = 0; pi < prims.length; pi++) {
    const p = prims[pi];
    const vcount = p.pos.length / 3;

    // positions
    align4();
    const posOff = bin.length;
    const pmin = [Infinity, Infinity, Infinity];
    const pmax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.pos.length; i++) {
      const v = p.pos[i];
      const c = i % 3;
      if (v < pmin[c]) pmin[c] = v;
      if (v > pmax[c]) pmax[c] = v;
      pushF32(bin, v);
    }
    views.push({ buffer: 0, byteOffset: posOff, byteLength: p.pos.length * 4 });
    accessors.push({
      bufferView: views.length - 1, componentType: 5126, count: vcount,
      type: 'VEC3', min: pmin, max: pmax,
    });
    const posAcc = accessors.length - 1;

    // normals
    align4();
    const nrmOff = bin.length;
    for (const v of p.nrm) pushF32(bin, v);
    views.push({ buffer: 0, byteOffset: nrmOff, byteLength: p.nrm.length * 4 });
    accessors.push({
      bufferView: views.length - 1, componentType: 5126, count: vcount, type: 'VEC3',
    });
    const nrmAcc = accessors.length - 1;

    // indices
    align4();
    const idxOff = bin.length;
    for (const v of p.idx) pushU16(bin, v);
    align4();
    views.push({ buffer: 0, byteOffset: idxOff, byteLength: p.idx.length * 2 });
    accessors.push({
      bufferView: views.length - 1, componentType: 5123, count: p.idx.length, type: 'SCALAR',
    });
    const idxAcc = accessors.length - 1;

    materials.push({
      pbrMetallicRoughness: {
        baseColorFactor: [p.color[0], p.color[1], p.color[2], 1],
        metallicFactor: p.metallic,
        roughnessFactor: p.roughness,
      },
    });
    meshPrims.push({
      attributes: { POSITION: posAcc, NORMAL: nrmAcc },
      indices: idxAcc,
      material: materials.length - 1,
    });
  }

  const gltf = {
    asset: { version: '2.0', generator: 'bloom-shooter build-weapons' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: meshPrims }],
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonBytes = Buffer.from(jsonStr, 'utf8');
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binBuf = Buffer.from(Uint8Array.from(bin));
  const binPad = (4 - (binBuf.length % 4)) % 4;

  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + binBuf.length + binPad;
  const out = Buffer.alloc(total);
  let o = 0;
  out.write('glTF', o); o += 4;
  out.writeUInt32LE(2, o); o += 4;
  out.writeUInt32LE(total, o); o += 4;
  out.writeUInt32LE(jsonBytes.length + jsonPad, o); o += 4;
  out.write('JSON', o); o += 4;
  jsonBytes.copy(out, o); o += jsonBytes.length;
  for (let i = 0; i < jsonPad; i++) { out.writeUInt8(0x20, o); o += 1; }
  out.writeUInt32LE(binBuf.length + binPad, o); o += 4;
  out.write('BIN\0', o); o += 4;
  binBuf.copy(out, o); o += binBuf.length;
  for (let i = 0; i < binPad; i++) { out.writeUInt8(0, o); o += 1; }

  writeFileSync(path, out);
  const tris = prims.reduce((a, p) => a + p.idx.length / 3, 0);
  console.log(`wrote ${path} (${prims.length} prims, ${tris} tris)`);
}

function pushF32(arr: number[], v: number): void {
  const b = Buffer.alloc(4);
  b.writeFloatLE(v, 0);
  arr.push(b[0], b[1], b[2], b[3]);
}
function pushU16(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >> 8) & 0xff);
}

// ---- the weapons ------------------------------------------------------------
//
// Local axes: +Z is DOWN THE BARREL, +Y up, +X right. The game places the model
// with that convention and reads the muzzle from the constants below.
//
// Muzzle points (metres, local space) — these are the ABI. src/main.ts uses
// them to spawn flash / tracer / ejection.
//   rifle    (0.00, 0.00, 0.62)
//   blaster  (0.00, 0.00, 0.42)
//   chaingun (0.00, 0.00, 0.78)
//   cannon   (0.00, 0.00, 0.70)

const GUNMETAL: [number, number, number] = [0.16, 0.17, 0.19];
const DARK: [number, number, number] = [0.09, 0.09, 0.10];
const BRASS: [number, number, number] = [0.55, 0.42, 0.16];
const ENERGY: [number, number, number] = [0.20, 0.55, 0.85];
const HOT: [number, number, number] = [0.85, 0.35, 0.12];

mkdirSync('assets/models', { recursive: true });

// Rifle — boxy receiver, long barrel, magazine, stock.
writeGlb('assets/models/weapon_rifle.glb', [
  box(0, 0, 0.05, 0.045, 0.06, 0.22, GUNMETAL, 0.8, 0.35),      // receiver
  cyl(0, 0.015, 0.42, 0.016, 0.20, 10, DARK, 0.9, 0.25),        // barrel
  box(0, -0.09, 0.02, 0.025, 0.055, 0.05, DARK, 0.3, 0.6),      // magazine
  box(0, -0.02, -0.20, 0.03, 0.045, 0.10, DARK, 0.2, 0.7),      // stock
  box(0, 0.075, 0.10, 0.012, 0.012, 0.14, DARK, 0.6, 0.4),      // rail/sight
]);

// Blaster — compact, energy cell, glowing emitter.
writeGlb('assets/models/weapon_blaster.glb', [
  box(0, 0, 0.02, 0.04, 0.055, 0.14, GUNMETAL, 0.7, 0.4),
  cyl(0, 0.01, 0.28, 0.022, 0.13, 10, DARK, 0.85, 0.3),
  cyl(0, 0.01, 0.40, 0.030, 0.02, 10, ENERGY, 0.1, 0.2),        // emitter ring
  box(0, -0.07, -0.01, 0.022, 0.05, 0.045, ENERGY, 0.1, 0.3),   // cell
  box(0, -0.02, -0.12, 0.028, 0.04, 0.06, DARK, 0.2, 0.7),      // grip housing
]);

// Chaingun — fat, multi-barrel, brass feed.
writeGlb('assets/models/weapon_chaingun.glb', [
  box(0, 0, 0.02, 0.065, 0.075, 0.22, GUNMETAL, 0.8, 0.4),
  cyl(0.028, 0.028, 0.50, 0.015, 0.26, 8, DARK, 0.9, 0.25),
  cyl(-0.028, 0.028, 0.50, 0.015, 0.26, 8, DARK, 0.9, 0.25),
  cyl(0.028, -0.028, 0.50, 0.015, 0.26, 8, DARK, 0.9, 0.25),
  cyl(-0.028, -0.028, 0.50, 0.015, 0.26, 8, DARK, 0.9, 0.25),
  cyl(0, 0, 0.30, 0.050, 0.06, 12, GUNMETAL, 0.85, 0.3),        // rotor hub
  box(0.07, -0.03, -0.02, 0.02, 0.05, 0.10, BRASS, 0.7, 0.4),   // ammo feed
]);

// Lucifer cannon — heavy, coiled, hot core.
writeGlb('assets/models/weapon_cannon.glb', [
  box(0, 0, 0.00, 0.06, 0.07, 0.24, GUNMETAL, 0.75, 0.45),
  cyl(0, 0.01, 0.42, 0.045, 0.24, 12, DARK, 0.85, 0.3),         // muzzle tube
  cyl(0, 0.01, 0.26, 0.058, 0.03, 12, HOT, 0.2, 0.35),          // coil 1
  cyl(0, 0.01, 0.40, 0.058, 0.03, 12, HOT, 0.2, 0.35),          // coil 2
  cyl(0, 0.01, 0.54, 0.058, 0.03, 12, HOT, 0.2, 0.35),          // coil 3
  box(0, -0.085, -0.04, 0.035, 0.05, 0.08, DARK, 0.3, 0.6),     // grip
  box(0, 0.075, -0.06, 0.02, 0.02, 0.10, DARK, 0.6, 0.4),       // sight
]);

console.log('\nMuzzle points (local Z is down-barrel) — keep in sync with src/main.ts:');
console.log('  rifle    z = 0.62');
console.log('  blaster  z = 0.42');
console.log('  chaingun z = 0.78');
console.log('  cannon   z = 0.70');
