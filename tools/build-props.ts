// Procedurally generates placeholder prop GLBs for the world system.
// Each prop is a small static mesh assembled from primitive shapes (boxes,
// spheres, cylinders) with solid PBR colours — no external textures. They
// replace the drawCube/drawSphere stand-ins previously used for trees,
// building walls, and furniture, and they can be edited or replaced by
// hand-authored GLBs later without touching world JSON or runtime code.
//
// Output files (assets/models/):
//   prop_tree.glb       — cylinder trunk + three stacked green cones (pine)
//   prop_crate.glb      — wooden crate cube
//   prop_barrel.glb     — metal barrel cylinder with dark bands
//   prop_table.glb      — wooden table, square top + 4 legs
//   prop_chair.glb      — wooden chair, seat + back + 4 legs
//   prop_bed.glb        — bed base + pillow + blanket
//   building_wall.glb   — stone-grey wall segment (4m wide × 3m tall)
//   building_floor.glb  — wooden-floor tile (4m × 4m)
//
// Run with:  bun tools/build-props.ts   (from the shooter repo root)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// -----------------------------------------------------------------------------
// Tiny mesh-building library
// -----------------------------------------------------------------------------

interface Part {
  vertices: number[];     // [x, y, z, nx, ny, nz] per vertex
  indices: number[];
  color: [number, number, number];  // PBR baseColorFactor 0..1
  roughness: number;
  metallic: number;
}

type Mesh = Part[];

function pushBox(m: Mesh, cx: number, cy: number, cz: number,
                 hx: number, hy: number, hz: number,
                 color: [number, number, number],
                 roughness = 0.8, metallic = 0.0): void {
  const x0 = cx - hx, x1 = cx + hx;
  const y0 = cy - hy, y1 = cy + hy;
  const z0 = cz - hz, z1 = cz + hz;

  // 6 faces, each with 4 vertices + 2 triangles. Each face gets its own
  // 4 vertices so the normals can point outward (flat shading).
  const faces: {p: number[][]; n: [number, number, number]}[] = [
    // +X
    { p: [[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]], n: [1,0,0] },
    // -X
    { p: [[x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1]], n: [-1,0,0] },
    // +Y (top)
    { p: [[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]], n: [0,1,0] },
    // -Y (bottom)
    { p: [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]], n: [0,-1,0] },
    // +Z
    { p: [[x1,y0,z1],[x0,y0,z1],[x0,y1,z1],[x1,y1,z1]], n: [0,0,1] },
    // -Z
    { p: [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]], n: [0,0,-1] },
  ];

  const verts: number[] = [];
  const indices: number[] = [];
  for (let f = 0; f < 6; f++) {
    const base = f * 4;
    const face = faces[f];
    for (let i = 0; i < 4; i++) {
      verts.push(face.p[i][0], face.p[i][1], face.p[i][2], face.n[0], face.n[1], face.n[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  m.push({ vertices: verts, indices, color, roughness, metallic });
}

// Vertical cylinder along Y axis, centered at (cx, cy, cz). Caps included.
function pushCylinder(m: Mesh, cx: number, cy: number, cz: number,
                      radius: number, halfHeight: number, segments: number,
                      color: [number, number, number],
                      roughness = 0.8, metallic = 0.0): void {
  const verts: number[] = [];
  const indices: number[] = [];
  const y0 = cy - halfHeight, y1 = cy + halfHeight;

  // Side ring — for flat shading, each quad face gets its own 4 verts + 2
  // tris with the face normal.
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const nx = Math.cos((a0 + a1) * 0.5);
    const nz = Math.sin((a0 + a1) * 0.5);
    const b = verts.length / 6;
    verts.push(
      cx + radius * c0, y0, cz + radius * s0, nx, 0, nz,
      cx + radius * c1, y0, cz + radius * s1, nx, 0, nz,
      cx + radius * c1, y1, cz + radius * s1, nx, 0, nz,
      cx + radius * c0, y1, cz + radius * s0, nx, 0, nz,
    );
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  // Caps — fan from centre.
  const topBase = verts.length / 6;
  verts.push(cx, y1, cz, 0, 1, 0);
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    verts.push(cx + radius * Math.cos(a), y1, cz + radius * Math.sin(a), 0, 1, 0);
  }
  for (let s = 0; s < segments; s++) {
    indices.push(topBase, topBase + 1 + s, topBase + 1 + ((s + 1) % segments));
  }
  const botBase = verts.length / 6;
  verts.push(cx, y0, cz, 0, -1, 0);
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    verts.push(cx + radius * Math.cos(a), y0, cz + radius * Math.sin(a), 0, -1, 0);
  }
  for (let s = 0; s < segments; s++) {
    indices.push(botBase, botBase + 1 + ((s + 1) % segments), botBase + 1 + s);
  }

  m.push({ vertices: verts, indices, color, roughness, metallic });
}

// Cone along +Y, base centered at (cx, cy, cz), tip at (cx, cy + height, cz).
function pushCone(m: Mesh, cx: number, cy: number, cz: number,
                  radius: number, height: number, segments: number,
                  color: [number, number, number]): void {
  const verts: number[] = [];
  const indices: number[] = [];
  const tipY = cy + height;

  // Sides — flat-shaded triangles from base ring to tip.
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    const p0 = [cx + radius * Math.cos(a0), cy, cz + radius * Math.sin(a0)];
    const p1 = [cx + radius * Math.cos(a1), cy, cz + radius * Math.sin(a1)];
    const tip = [cx, tipY, cz];
    // Crude face normal = cross(p1-p0, tip-p0) normalised; cone lateral nx
    // is fine for a low-poly placeholder — skip the cross and use the
    // radial+up mix.
    const ax = Math.cos((a0 + a1) * 0.5);
    const az = Math.sin((a0 + a1) * 0.5);
    const nmix = radius / Math.sqrt(radius * radius + height * height);
    const nx = ax * height / Math.sqrt(radius * radius + height * height);
    const ny = nmix;
    const nz = az * height / Math.sqrt(radius * radius + height * height);
    const b = verts.length / 6;
    verts.push(
      p0[0], p0[1], p0[2], nx, ny, nz,
      p1[0], p1[1], p1[2], nx, ny, nz,
      tip[0], tip[1], tip[2], nx, ny, nz,
    );
    indices.push(b, b + 1, b + 2);
  }
  // Bottom disk.
  const diskBase = verts.length / 6;
  verts.push(cx, cy, cz, 0, -1, 0);
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    verts.push(cx + radius * Math.cos(a), cy, cz + radius * Math.sin(a), 0, -1, 0);
  }
  for (let s = 0; s < segments; s++) {
    indices.push(diskBase, diskBase + 1 + ((s + 1) % segments), diskBase + 1 + s);
  }

  m.push({ vertices: verts, indices, color, roughness: 0.95, metallic: 0.0 });
}

// -----------------------------------------------------------------------------
// Prop definitions
// -----------------------------------------------------------------------------

const BARK: [number, number, number]     = [0.32, 0.22, 0.14];
const LEAF: [number, number, number]     = [0.22, 0.48, 0.20];
const WOOD_LIGHT: [number, number, number] = [0.68, 0.50, 0.32];
const WOOD_DARK:  [number, number, number] = [0.45, 0.30, 0.18];
const METAL:      [number, number, number] = [0.55, 0.55, 0.58];
const METAL_DARK: [number, number, number] = [0.22, 0.22, 0.25];
const STONE:      [number, number, number] = [0.70, 0.68, 0.62];
const FLOOR_WOOD: [number, number, number] = [0.58, 0.42, 0.26];
const FABRIC_RED: [number, number, number] = [0.68, 0.20, 0.18];
const FABRIC_WHITE: [number, number, number] = [0.92, 0.90, 0.85];

function makeTree(): Mesh {
  const m: Mesh = [];
  pushCylinder(m, 0, 1.2, 0, 0.22, 1.2, 8, BARK, 0.95, 0.0);
  pushCone(m, 0, 1.2, 0, 1.1, 1.0, 10, LEAF);
  pushCone(m, 0, 2.0, 0, 0.95, 1.0, 10, LEAF);
  pushCone(m, 0, 2.8, 0, 0.75, 1.0, 10, LEAF);
  return m;
}

function makeCrate(): Mesh {
  const m: Mesh = [];
  const s = 0.5;
  pushBox(m, 0, s, 0, s, s, s, WOOD_LIGHT, 0.9);
  // Thin trim strips on the edges for wood-crate look.
  const t = 0.04;
  pushBox(m, 0, 0.02, 0, s + 0.01, t, s + 0.01, WOOD_DARK, 0.85);
  pushBox(m, 0, 2 * s - 0.02, 0, s + 0.01, t, s + 0.01, WOOD_DARK, 0.85);
  return m;
}

function makeBarrel(): Mesh {
  const m: Mesh = [];
  pushCylinder(m, 0, 0.55, 0, 0.38, 0.55, 14, METAL, 0.55, 0.4);
  // Two dark bands.
  pushCylinder(m, 0, 0.25, 0, 0.395, 0.06, 14, METAL_DARK, 0.7, 0.2);
  pushCylinder(m, 0, 0.85, 0, 0.395, 0.06, 14, METAL_DARK, 0.7, 0.2);
  return m;
}

function makeTable(): Mesh {
  const m: Mesh = [];
  // Top
  pushBox(m, 0, 0.76, 0, 0.80, 0.04, 0.50, WOOD_LIGHT, 0.7);
  // Legs
  const L = 0.73, hx = 0.06, hz = 0.06, tx = 0.72, tz = 0.44;
  pushBox(m,  tx, L / 2,  tz, hx, L / 2, hz, WOOD_DARK, 0.8);
  pushBox(m, -tx, L / 2,  tz, hx, L / 2, hz, WOOD_DARK, 0.8);
  pushBox(m,  tx, L / 2, -tz, hx, L / 2, hz, WOOD_DARK, 0.8);
  pushBox(m, -tx, L / 2, -tz, hx, L / 2, hz, WOOD_DARK, 0.8);
  return m;
}

function makeChair(): Mesh {
  const m: Mesh = [];
  // Seat
  pushBox(m, 0, 0.46, 0, 0.22, 0.04, 0.22, WOOD_LIGHT, 0.8);
  // Back
  pushBox(m, 0, 0.80, -0.20, 0.22, 0.30, 0.04, WOOD_LIGHT, 0.8);
  // Legs
  const hx = 0.03, hz = 0.03;
  const tx = 0.19, tz = 0.19;
  pushBox(m,  tx, 0.22,  tz, hx, 0.22, hz, WOOD_DARK, 0.85);
  pushBox(m, -tx, 0.22,  tz, hx, 0.22, hz, WOOD_DARK, 0.85);
  pushBox(m,  tx, 0.22, -tz, hx, 0.22, hz, WOOD_DARK, 0.85);
  pushBox(m, -tx, 0.22, -tz, hx, 0.22, hz, WOOD_DARK, 0.85);
  return m;
}

function makeBed(): Mesh {
  const m: Mesh = [];
  // Base
  pushBox(m, 0, 0.22, 0, 1.0, 0.22, 0.5, WOOD_DARK, 0.9);
  // Mattress
  pushBox(m, 0, 0.52, 0, 0.98, 0.08, 0.48, FABRIC_WHITE, 0.95);
  // Blanket over lower 60%
  pushBox(m, 0, 0.585, 0.10, 0.98, 0.03, 0.37, FABRIC_RED, 0.95);
  // Pillow
  pushBox(m, 0, 0.61, -0.30, 0.30, 0.05, 0.14, FABRIC_WHITE, 0.95);
  return m;
}

function makeBuildingWall(): Mesh {
  // 4 m wide × 3 m tall × 0.2 m thick stone wall segment. Centered so the
  // world JSON can place its origin at the wall's bottom centre.
  const m: Mesh = [];
  pushBox(m, 0, 1.5, 0, 2.0, 1.5, 0.1, STONE, 0.92);
  // Trim along bottom for plinth look.
  pushBox(m, 0, 0.15, 0, 2.05, 0.15, 0.12, [0.50, 0.48, 0.44], 0.95);
  return m;
}

function makeBuildingFloor(): Mesh {
  // 4 m × 4 m × 0.1 m wooden floor tile.
  const m: Mesh = [];
  pushBox(m, 0, -0.05, 0, 2.0, 0.05, 2.0, FLOOR_WOOD, 0.85);
  return m;
}

// -----------------------------------------------------------------------------
// GLB assembly — one primitive per Part, shared buffer, per-part material
// -----------------------------------------------------------------------------

function align4(n: number): number { return (n + 3) & ~3; }

function writeGlb(outPath: string, mesh: Mesh): void {
  // Per-primitive binary slots.
  interface Slot { off: number; len: number }
  interface PrimSlots { idx: Slot; pos: Slot; nrm: Slot }

  const slots: PrimSlots[] = [];
  let binLen = 0;
  for (let i = 0; i < mesh.length; i++) {
    const p = mesh[i];
    const vc = p.vertices.length / 6;
    const idxOff = align4(binLen); binLen = idxOff + align4(p.indices.length * 4);
    const posOff = binLen;          binLen = posOff + vc * 3 * 4;
    const nrmOff = binLen;          binLen = nrmOff + vc * 3 * 4;
    slots.push({
      idx: { off: idxOff, len: p.indices.length * 4 },
      pos: { off: posOff, len: vc * 3 * 4 },
      nrm: { off: nrmOff, len: vc * 3 * 4 },
    });
  }
  binLen = align4(binLen);

  const bin = new Uint8Array(binLen);
  const dv = new DataView(bin.buffer);
  for (let i = 0; i < mesh.length; i++) {
    const p = mesh[i];
    const s = slots[i];
    const vc = p.vertices.length / 6;
    for (let k = 0; k < p.indices.length; k++) dv.setUint32(s.idx.off + k * 4, p.indices[k], true);
    for (let v = 0; v < vc; v++) {
      const vb = v * 6;
      dv.setFloat32(s.pos.off + v * 12,     p.vertices[vb],     true);
      dv.setFloat32(s.pos.off + v * 12 + 4, p.vertices[vb + 1], true);
      dv.setFloat32(s.pos.off + v * 12 + 8, p.vertices[vb + 2], true);
      dv.setFloat32(s.nrm.off + v * 12,     p.vertices[vb + 3], true);
      dv.setFloat32(s.nrm.off + v * 12 + 4, p.vertices[vb + 4], true);
      dv.setFloat32(s.nrm.off + v * 12 + 8, p.vertices[vb + 5], true);
    }
  }

  // glTF JSON.
  interface Accessor { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }
  interface BV { buffer: number; byteOffset: number; byteLength: number; target?: number }

  const bufferViews: BV[] = [];
  const accessors: Accessor[] = [];
  const primitives: { attributes: Record<string, number>; indices: number; material: number; mode: number }[] = [];
  const materials: { name: string; pbrMetallicRoughness: { baseColorFactor: number[]; metallicFactor: number; roughnessFactor: number } }[] = [];

  for (let i = 0; i < mesh.length; i++) {
    const p = mesh[i];
    const s = slots[i];
    const vc = p.vertices.length / 6;
    const ic = p.indices.length;

    const bvIdx = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: s.idx.off, byteLength: ic * 4,     target: 34963 });
    const bvPos = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: s.pos.off, byteLength: vc * 3 * 4, target: 34962 });
    const bvNrm = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: s.nrm.off, byteLength: vc * 3 * 4, target: 34962 });

    const min = [p.vertices[0], p.vertices[1], p.vertices[2]];
    const max = [p.vertices[0], p.vertices[1], p.vertices[2]];
    for (let v = 1; v < vc; v++) {
      const vb = v * 6;
      if (p.vertices[vb]     < min[0]) min[0] = p.vertices[vb];
      if (p.vertices[vb + 1] < min[1]) min[1] = p.vertices[vb + 1];
      if (p.vertices[vb + 2] < min[2]) min[2] = p.vertices[vb + 2];
      if (p.vertices[vb]     > max[0]) max[0] = p.vertices[vb];
      if (p.vertices[vb + 1] > max[1]) max[1] = p.vertices[vb + 1];
      if (p.vertices[vb + 2] > max[2]) max[2] = p.vertices[vb + 2];
    }

    const aIdx = accessors.length; accessors.push({ bufferView: bvIdx, componentType: 5125, count: ic, type: 'SCALAR' });
    const aPos = accessors.length; accessors.push({ bufferView: bvPos, componentType: 5126, count: vc, type: 'VEC3', min, max });
    const aNrm = accessors.length; accessors.push({ bufferView: bvNrm, componentType: 5126, count: vc, type: 'VEC3' });

    const mat = materials.length;
    materials.push({
      name: 'mat_' + i,
      pbrMetallicRoughness: {
        baseColorFactor: [p.color[0], p.color[1], p.color[2], 1.0],
        metallicFactor: p.metallic,
        roughnessFactor: p.roughness,
      },
    });

    primitives.push({
      attributes: { POSITION: aPos, NORMAL: aNrm },
      indices: aIdx,
      material: mat,
      mode: 4,
    });
  }

  const gltf = {
    asset: { version: '2.0', generator: 'shooter-build-props' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes:  [{ mesh: 0, name: 'prop' }],
    meshes: [{ primitives }],
    materials,
    buffers: [{ byteLength: binLen }],
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
  odv.setUint32(0,  0x46546C67, true);
  odv.setUint32(4,  2,          true);
  odv.setUint32(8,  totalLen,   true);
  odv.setUint32(12, jsonPad.length, true);
  odv.setUint32(16, 0x4E4F534A, true); // JSON
  out.set(jsonPad, 20);
  const binOff = 20 + jsonPad.length;
  odv.setUint32(binOff,     bin.length,  true);
  odv.setUint32(binOff + 4, 0x004E4942,  true); // BIN
  out.set(bin, binOff + 8);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out);
  console.log('wrote', outPath, '(' + out.length, 'bytes,', mesh.length, 'parts)');
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

writeGlb('assets/models/prop_tree.glb',      makeTree());
writeGlb('assets/models/prop_crate.glb',     makeCrate());
writeGlb('assets/models/prop_barrel.glb',    makeBarrel());
writeGlb('assets/models/prop_table.glb',     makeTable());
writeGlb('assets/models/prop_chair.glb',     makeChair());
writeGlb('assets/models/prop_bed.glb',       makeBed());
writeGlb('assets/models/building_wall.glb',  makeBuildingWall());
writeGlb('assets/models/building_floor.glb', makeBuildingFloor());
