// Procedurally generates placeholder prop GLBs for the world system.
//
// Props are now TEXTURED when an Unvanquished tex-tech source exists for
// the intended material. The baseColorTexture is a resized copy of a
// tex-tech `*_d.png`, sampled at REPEAT-wrapped UVs that tile at
// TILE_METRES per revolution so crates don't look painted. Props that
// don't have a matching source texture (bed fabric, tree cones) keep
// solid PBR baseColorFactor materials.
//
// Output files (assets/models/):
//   prop_tree.glb       — cylinder trunk + three stacked green cones (pine)
//   prop_crate.glb      — wooden crate (crate1_d texture)
//   prop_barrel.glb     — metal barrel (metal1a_d texture) + dark bands
//   prop_table.glb      — wooden table (crate1_d for top, dark-wood legs)
//   prop_chair.glb      — wooden chair (crate1_d seat + back, dark legs)
//   prop_bed.glb        — solid-colour base/mattress/blanket/pillow
//   building_wall.glb   — stone wall segment (wall3_d texture)
//   building_floor.glb  — wooden floor tile (floortile2_d texture)
//
// Run with:  bun tools/build-props.ts   (from the shooter repo root)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';

const TEX_MAX = 512;
const TEX_ROOT = 'vendor/unvanquished/pkg/tex-tech_src.dpkdir/textures/shared_tech_src';
const CACHE = 'tools/.cache';

const TILE_METRES = 2.0; // one texture repeat per 2m of world surface

// -----------------------------------------------------------------------------
// Tiny mesh-building library — each vertex is 8 floats: [px,py,pz, nx,ny,nz, u,v]
// -----------------------------------------------------------------------------

interface Part {
  vertices: number[];        // 8 floats per vertex
  indices: number[];
  color: [number, number, number];   // PBR baseColorFactor 0..1
  textureKey: string | null;         // Resolved to texture index if non-null
  roughness: number;
  metallic: number;
}

type Mesh = Part[];

function pushBox(m: Mesh, cx: number, cy: number, cz: number,
                 hx: number, hy: number, hz: number,
                 color: [number, number, number],
                 roughness = 0.8, metallic = 0.0,
                 textureKey: string | null = null): void {
  const x0 = cx - hx, x1 = cx + hx;
  const y0 = cy - hy, y1 = cy + hy;
  const z0 = cz - hz, z1 = cz + hz;
  const tu = (2 * hx) / TILE_METRES;
  const tv = (2 * hy) / TILE_METRES;
  const tw = (2 * hz) / TILE_METRES;

  // 6 faces — each gets its own 4 verts with outward-facing normal + UVs.
  // UV axes per face match the in-plane world axes so a texture tiles
  // continuously across adjacent faces of the same material.
  const faces: { p: number[][]; n: [number, number, number]; uv: [number, number][] }[] = [
    { p: [[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]], n: [1,0,0],  uv: [[0,0],[tw,0],[tw,tv],[0,tv]] },
    { p: [[x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1]], n: [-1,0,0], uv: [[0,0],[tw,0],[tw,tv],[0,tv]] },
    { p: [[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]], n: [0,1,0],  uv: [[0,0],[tu,0],[tu,tw],[0,tw]] },
    { p: [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]], n: [0,-1,0], uv: [[0,0],[tu,0],[tu,tw],[0,tw]] },
    { p: [[x1,y0,z1],[x0,y0,z1],[x0,y1,z1],[x1,y1,z1]], n: [0,0,1],  uv: [[0,0],[tu,0],[tu,tv],[0,tv]] },
    { p: [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]], n: [0,0,-1], uv: [[0,0],[tu,0],[tu,tv],[0,tv]] },
  ];

  const verts: number[] = [];
  const indices: number[] = [];
  for (let f = 0; f < 6; f++) {
    const base = f * 4;
    const face = faces[f];
    for (let i = 0; i < 4; i++) {
      verts.push(
        face.p[i][0], face.p[i][1], face.p[i][2],
        face.n[0],     face.n[1],    face.n[2],
        face.uv[i][0], face.uv[i][1],
      );
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  m.push({ vertices: verts, indices, color, textureKey, roughness, metallic });
}

function pushCylinder(m: Mesh, cx: number, cy: number, cz: number,
                      radius: number, halfHeight: number, segments: number,
                      color: [number, number, number],
                      roughness = 0.8, metallic = 0.0,
                      textureKey: string | null = null): void {
  const verts: number[] = [];
  const indices: number[] = [];
  const y0 = cy - halfHeight, y1 = cy + halfHeight;
  const tv = (2 * halfHeight) / TILE_METRES;

  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const nx = Math.cos((a0 + a1) * 0.5);
    const nz = Math.sin((a0 + a1) * 0.5);
    const u0 = (s / segments) * (2 * Math.PI * radius) / TILE_METRES;
    const u1 = ((s + 1) / segments) * (2 * Math.PI * radius) / TILE_METRES;
    const b = verts.length / 8;
    verts.push(
      cx + radius * c0, y0, cz + radius * s0, nx, 0, nz, u0, 0,
      cx + radius * c1, y0, cz + radius * s1, nx, 0, nz, u1, 0,
      cx + radius * c1, y1, cz + radius * s1, nx, 0, nz, u1, tv,
      cx + radius * c0, y1, cz + radius * s0, nx, 0, nz, u0, tv,
    );
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  // Caps — flat shaded with planar UVs.
  const topBase = verts.length / 8;
  verts.push(cx, y1, cz, 0, 1, 0, 0.5, 0.5);
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    verts.push(cx + radius * Math.cos(a), y1, cz + radius * Math.sin(a),
               0, 1, 0, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
  }
  for (let s = 0; s < segments; s++) {
    indices.push(topBase, topBase + 1 + s, topBase + 1 + ((s + 1) % segments));
  }
  const botBase = verts.length / 8;
  verts.push(cx, y0, cz, 0, -1, 0, 0.5, 0.5);
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    verts.push(cx + radius * Math.cos(a), y0, cz + radius * Math.sin(a),
               0, -1, 0, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
  }
  for (let s = 0; s < segments; s++) {
    indices.push(botBase, botBase + 1 + ((s + 1) % segments), botBase + 1 + s);
  }
  m.push({ vertices: verts, indices, color, textureKey, roughness, metallic });
}

function pushCone(m: Mesh, cx: number, cy: number, cz: number,
                  radius: number, height: number, segments: number,
                  color: [number, number, number]): void {
  const verts: number[] = [];
  const indices: number[] = [];
  const tipY = cy + height;
  const slant = Math.sqrt(radius * radius + height * height);

  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    const p0 = [cx + radius * Math.cos(a0), cy, cz + radius * Math.sin(a0)];
    const p1 = [cx + radius * Math.cos(a1), cy, cz + radius * Math.sin(a1)];
    const tip = [cx, tipY, cz];
    const ax = Math.cos((a0 + a1) * 0.5);
    const az = Math.sin((a0 + a1) * 0.5);
    const nx = ax * height / slant;
    const ny = radius / slant;
    const nz = az * height / slant;
    const u0 = s / segments;
    const u1 = (s + 1) / segments;
    const b = verts.length / 8;
    verts.push(
      p0[0], p0[1], p0[2], nx, ny, nz, u0, 0,
      p1[0], p1[1], p1[2], nx, ny, nz, u1, 0,
      tip[0], tip[1], tip[2], nx, ny, nz, (u0 + u1) * 0.5, 1,
    );
    indices.push(b, b + 1, b + 2);
  }
  // Bottom disk.
  const diskBase = verts.length / 8;
  verts.push(cx, cy, cz, 0, -1, 0, 0.5, 0.5);
  for (let s = 0; s < segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    verts.push(cx + radius * Math.cos(a), cy, cz + radius * Math.sin(a),
               0, -1, 0, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
  }
  for (let s = 0; s < segments; s++) {
    indices.push(diskBase, diskBase + 1 + ((s + 1) % segments), diskBase + 1 + s);
  }
  m.push({ vertices: verts, indices, color, textureKey: null, roughness: 0.95, metallic: 0.0 });
}

// -----------------------------------------------------------------------------
// Texture loading
// -----------------------------------------------------------------------------

interface TextureSpec { key: string; srcPath: string }
const TEX_SPECS: Record<string, TextureSpec> = {
  wood:      { key: 'wood',      srcPath: TEX_ROOT + '/crate1_d.png' },
  stone:     { key: 'stone',     srcPath: TEX_ROOT + '/wall3_d.png' },
  metal:     { key: 'metal',     srcPath: TEX_ROOT + '/metal1a_d.png' },
  floor:     { key: 'floor',     srcPath: TEX_ROOT + '/floortile2_d.png' },
};

function resolveTexture(key: string): Uint8Array {
  const spec = TEX_SPECS[key];
  if (!spec) throw new Error('unknown texture key: ' + key);
  if (!existsSync(spec.srcPath)) {
    console.warn(`texture source missing: ${spec.srcPath} — falling back to solid colour`);
    return new Uint8Array();
  }
  mkdirSync(CACHE, { recursive: true });
  const cache = CACHE + '/prop_tex_' + key + '.png';
  execSync(`sips --resampleHeightWidthMax ${TEX_MAX} "${spec.srcPath}" --out "${cache}"`,
           { stdio: 'pipe' });
  return new Uint8Array(readFileSync(cache));
}

// -----------------------------------------------------------------------------
// Prop definitions
// -----------------------------------------------------------------------------

const BARK: [number, number, number]        = [0.32, 0.22, 0.14];
const LEAF: [number, number, number]        = [0.22, 0.48, 0.20];
const WOOD_LIGHT: [number, number, number]  = [0.85, 0.75, 0.60];
const WOOD_DARK:  [number, number, number]  = [0.45, 0.30, 0.18];
const METAL:      [number, number, number]  = [0.90, 0.88, 0.85];
const METAL_DARK: [number, number, number]  = [0.22, 0.22, 0.25];
const STONE:      [number, number, number]  = [0.85, 0.82, 0.76];
const FLOOR_WOOD: [number, number, number]  = [0.80, 0.65, 0.48];
const FABRIC_RED: [number, number, number]  = [0.68, 0.20, 0.18];
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
  pushBox(m, 0, s, 0, s, s, s, WOOD_LIGHT, 0.9, 0.0, 'wood');
  return m;
}

function makeBarrel(): Mesh {
  const m: Mesh = [];
  pushCylinder(m, 0, 0.55, 0, 0.38, 0.55, 14, METAL, 0.55, 0.4, 'metal');
  pushCylinder(m, 0, 0.25, 0, 0.395, 0.06, 14, METAL_DARK, 0.7, 0.2);
  pushCylinder(m, 0, 0.85, 0, 0.395, 0.06, 14, METAL_DARK, 0.7, 0.2);
  return m;
}

function makeTable(): Mesh {
  const m: Mesh = [];
  pushBox(m, 0, 0.76, 0, 0.80, 0.04, 0.50, WOOD_LIGHT, 0.7, 0.0, 'wood');
  const L = 0.73, hx = 0.06, hz = 0.06, tx = 0.72, tz = 0.44;
  pushBox(m,  tx, L / 2,  tz, hx, L / 2, hz, WOOD_DARK, 0.85);
  pushBox(m, -tx, L / 2,  tz, hx, L / 2, hz, WOOD_DARK, 0.85);
  pushBox(m,  tx, L / 2, -tz, hx, L / 2, hz, WOOD_DARK, 0.85);
  pushBox(m, -tx, L / 2, -tz, hx, L / 2, hz, WOOD_DARK, 0.85);
  return m;
}

function makeChair(): Mesh {
  const m: Mesh = [];
  pushBox(m, 0, 0.46, 0, 0.22, 0.04, 0.22, WOOD_LIGHT, 0.8, 0.0, 'wood');
  pushBox(m, 0, 0.80, -0.20, 0.22, 0.30, 0.04, WOOD_LIGHT, 0.8, 0.0, 'wood');
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
  pushBox(m, 0, 0.22, 0, 1.0, 0.22, 0.5, WOOD_DARK, 0.9, 0.0, 'wood');
  pushBox(m, 0, 0.52, 0, 0.98, 0.08, 0.48, FABRIC_WHITE, 0.95);
  pushBox(m, 0, 0.585, 0.10, 0.98, 0.03, 0.37, FABRIC_RED, 0.95);
  pushBox(m, 0, 0.61, -0.30, 0.30, 0.05, 0.14, FABRIC_WHITE, 0.95);
  return m;
}

function makeBuildingWall(): Mesh {
  const m: Mesh = [];
  pushBox(m, 0, 1.5, 0, 2.0, 1.5, 0.1, STONE, 0.92, 0.0, 'stone');
  pushBox(m, 0, 0.15, 0, 2.05, 0.15, 0.12, [0.50, 0.48, 0.44], 0.95);
  return m;
}

function makeBuildingFloor(): Mesh {
  const m: Mesh = [];
  pushBox(m, 0, -0.05, 0, 2.0, 0.05, 2.0, FLOOR_WOOD, 0.85, 0.0, 'floor');
  return m;
}

// -----------------------------------------------------------------------------
// GLB assembly
// -----------------------------------------------------------------------------

function align4(n: number): number { return (n + 3) & ~3; }

function writeGlb(outPath: string, mesh: Mesh): void {
  // Gather unique textures used by this mesh so we only embed + reference
  // each one once.
  const texKeys: string[] = [];
  for (const p of mesh) {
    if (p.textureKey && texKeys.indexOf(p.textureKey) < 0) texKeys.push(p.textureKey);
  }
  const texBytes: Uint8Array[] = texKeys.map(k => resolveTexture(k));

  interface Slot { off: number; len: number }
  interface PrimSlots { idx: Slot; pos: Slot; nrm: Slot; uv: Slot }

  const slots: PrimSlots[] = [];
  let binLen = 0;
  for (const p of mesh) {
    const vc = p.vertices.length / 8;
    const idxOff = align4(binLen); binLen = idxOff + align4(p.indices.length * 4);
    const posOff = binLen;          binLen = posOff + vc * 3 * 4;
    const nrmOff = binLen;          binLen = nrmOff + vc * 3 * 4;
    const uvOff  = binLen;          binLen = uvOff  + vc * 2 * 4;
    slots.push({
      idx: { off: idxOff, len: p.indices.length * 4 },
      pos: { off: posOff, len: vc * 3 * 4 },
      nrm: { off: nrmOff, len: vc * 3 * 4 },
      uv:  { off: uvOff,  len: vc * 2 * 4 },
    });
  }
  const imgSlots: Slot[] = [];
  for (const b of texBytes) {
    const off = align4(binLen);
    binLen = off + b.length;
    imgSlots.push({ off, len: b.length });
  }
  binLen = align4(binLen);

  const bin = new Uint8Array(binLen);
  const dv = new DataView(bin.buffer);
  for (let i = 0; i < mesh.length; i++) {
    const p = mesh[i];
    const s = slots[i];
    const vc = p.vertices.length / 8;
    for (let k = 0; k < p.indices.length; k++) dv.setUint32(s.idx.off + k * 4, p.indices[k], true);
    for (let v = 0; v < vc; v++) {
      const vb = v * 8;
      dv.setFloat32(s.pos.off + v * 12,     p.vertices[vb],     true);
      dv.setFloat32(s.pos.off + v * 12 + 4, p.vertices[vb + 1], true);
      dv.setFloat32(s.pos.off + v * 12 + 8, p.vertices[vb + 2], true);
      dv.setFloat32(s.nrm.off + v * 12,     p.vertices[vb + 3], true);
      dv.setFloat32(s.nrm.off + v * 12 + 4, p.vertices[vb + 4], true);
      dv.setFloat32(s.nrm.off + v * 12 + 8, p.vertices[vb + 5], true);
      dv.setFloat32(s.uv.off  + v * 8,      p.vertices[vb + 6], true);
      dv.setFloat32(s.uv.off  + v * 8 + 4,  p.vertices[vb + 7], true);
    }
  }
  for (let i = 0; i < texBytes.length; i++) bin.set(texBytes[i], imgSlots[i].off);

  interface Accessor { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }
  interface BV { buffer: number; byteOffset: number; byteLength: number; target?: number }

  const bufferViews: BV[] = [];
  const accessors: Accessor[] = [];
  const primitives: { attributes: Record<string, number>; indices: number; material: number; mode: number }[] = [];
  const materials: {
    name: string;
    pbrMetallicRoughness: {
      baseColorFactor: number[];
      baseColorTexture?: { index: number };
      metallicFactor: number;
      roughnessFactor: number;
    };
  }[] = [];

  for (let i = 0; i < mesh.length; i++) {
    const p = mesh[i];
    const s = slots[i];
    const vc = p.vertices.length / 8;
    const ic = p.indices.length;

    const bvIdx = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: s.idx.off, byteLength: ic * 4,     target: 34963 });
    const bvPos = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: s.pos.off, byteLength: vc * 3 * 4, target: 34962 });
    const bvNrm = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: s.nrm.off, byteLength: vc * 3 * 4, target: 34962 });
    const bvUv  = bufferViews.length; bufferViews.push({ buffer: 0, byteOffset: s.uv.off,  byteLength: vc * 2 * 4, target: 34962 });

    const min = [p.vertices[0], p.vertices[1], p.vertices[2]];
    const max = [p.vertices[0], p.vertices[1], p.vertices[2]];
    for (let v = 1; v < vc; v++) {
      const vb = v * 8;
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
    const aUv  = accessors.length; accessors.push({ bufferView: bvUv,  componentType: 5126, count: vc, type: 'VEC2' });

    const mat = materials.length;
    const pbr: any = {
      baseColorFactor: [p.color[0], p.color[1], p.color[2], 1.0],
      metallicFactor: p.metallic,
      roughnessFactor: p.roughness,
    };
    if (p.textureKey) {
      const ti = texKeys.indexOf(p.textureKey);
      if (ti >= 0 && texBytes[ti].length > 0) {
        pbr.baseColorTexture = { index: ti };
        // With a texture in play the factor just tints it; lighten so the
        // material isn't overly dark.
        pbr.baseColorFactor = [1.0, 1.0, 1.0, 1.0];
      }
    }
    materials.push({ name: 'mat_' + i, pbrMetallicRoughness: pbr });

    primitives.push({
      attributes: { POSITION: aPos, NORMAL: aNrm, TEXCOORD_0: aUv },
      indices: aIdx,
      material: mat,
      mode: 4,
    });
  }

  // Texture image bufferViews.
  const imageBv: number[] = [];
  for (let i = 0; i < texBytes.length; i++) {
    if (texBytes[i].length === 0) { imageBv.push(-1); continue; }
    const bv = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: imgSlots[i].off, byteLength: imgSlots[i].len });
    imageBv.push(bv);
  }

  const gltf: any = {
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
  if (texBytes.length > 0) {
    gltf.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    gltf.textures = texBytes.map((_, i) => ({ source: i, sampler: 0 }));
    gltf.images = texBytes
      .map((_, i) => imageBv[i] >= 0 ? { bufferView: imageBv[i], mimeType: 'image/png' } : null)
      .filter(x => x !== null);
  }

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
  odv.setUint32(16, 0x4E4F534A, true);
  out.set(jsonPad, 20);
  const binOff = 20 + jsonPad.length;
  odv.setUint32(binOff,     bin.length,  true);
  odv.setUint32(binOff + 4, 0x004E4942,  true);
  out.set(bin, binOff + 8);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out);
  console.log('wrote', outPath, '(' + out.length, 'bytes,', mesh.length, 'parts,', texBytes.filter(b => b.length > 0).length, 'textures)');
}

writeGlb('assets/models/prop_tree.glb',      makeTree());
writeGlb('assets/models/prop_crate.glb',     makeCrate());
writeGlb('assets/models/prop_barrel.glb',    makeBarrel());
writeGlb('assets/models/prop_table.glb',     makeTable());
writeGlb('assets/models/prop_chair.glb',     makeChair());
writeGlb('assets/models/prop_bed.glb',       makeBed());
writeGlb('assets/models/building_wall.glb',  makeBuildingWall());
writeGlb('assets/models/building_floor.glb', makeBuildingFloor());
