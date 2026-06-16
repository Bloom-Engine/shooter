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
import { encodePng, leafTexture, barkTexture, grassBladeTexture, flowerTexture,
         stoneTexture, woodTexture, metalTexture, floorTexture, heightToNormal } from './png';

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
  alphaMode?: 'MASK';                 // alpha-cutout (foliage cards)
  alphaCutoff?: number;              // threshold for MASK (default 0.5)
  doubleSided?: boolean;             // render both faces (foliage)
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

// Procedurally-generated textures (PNG bytes) — no external source needed.
// Leaf is RGBA with a real alpha channel for alpha-cutout foliage cards.
// Raw RGBA for the solid (non-cutout) materials, kept so we can both encode the
// albedo PNG and derive a tangent-space normal map from it (height = luminance).
const stoneRgba = stoneTexture(512);
const woodRgba  = woodTexture(512);
const metalRgba = metalTexture(256);
const floorRgba = floorTexture(512);
const barkRgba  = barkTexture(256);

const PROC_TEX: Record<string, Uint8Array> = {
  leaf:        encodePng(256, 256, leafTexture(256)),
  bark:        encodePng(256, 256, barkRgba),
  grass_blade: encodePng(256, 256, grassBladeTexture(256)),
  flower:      encodePng(256, 256, flowerTexture(256)),
  // Stone/wood/metal/floor: procedural fallbacks so the building + props are
  // properly textured even when the Unvanquished tex-tech vendor source isn't
  // present (it isn't on this machine — see TEX_ROOT). Without these the wall
  // fell back to a flat solid grey, reading as a plain white box.
  stone: encodePng(512, 512, stoneRgba),
  wood:  encodePng(512, 512, woodRgba),
  metal: encodePng(256, 256, metalRgba),
  floor: encodePng(512, 512, floorRgba),
  // Derived normal maps — give the masonry/planks per-texel relief so they
  // catch the directional sun instead of shading flat. Referenced as a
  // material's normalTexture (NORMAL_FOR), which makes the model loader treat
  // them as linear, mip-variance-baked normal maps.
  stone_n: encodePng(512, 512, heightToNormal(512, 512, stoneRgba, 3.0)),
  wood_n:  encodePng(512, 512, heightToNormal(512, 512, woodRgba, 2.2)),
  metal_n: encodePng(256, 256, heightToNormal(256, 256, metalRgba, 1.0)),
  floor_n: encodePng(512, 512, heightToNormal(512, 512, floorRgba, 1.8)),
  bark_n:  encodePng(256, 256, heightToNormal(256, 256, barkRgba, 2.6)),
};

// Albedo texture key → its normal-map key (solid materials only; the alpha
// cutout cards leaf/grass_blade/flower intentionally get none).
const NORMAL_FOR: Record<string, string> = {
  stone: 'stone_n', wood: 'wood_n', metal: 'metal_n', floor: 'floor_n', bark: 'bark_n',
};

function resolveTexture(key: string): Uint8Array {
  if (PROC_TEX[key]) return PROC_TEX[key];
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

// Append a double-sided alpha-cutout leaf card (a textured quad) to shared
// vertex/index arrays. `yaw` rotates the card's facing around Y; `tilt` lifts
// the facing toward the sky. Double-sided = front quad (normal n) + back quad
// (normal -n, reversed winding) so the leaves read from any viewing side.
function addLeafCard(verts: number[], indices: number[],
                     cx: number, cy: number, cz: number,
                     w: number, h: number, yaw: number, tilt: number): void {
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  let nx = Math.sin(yaw) * ct, ny = st, nz = Math.cos(yaw) * ct;
  // right = normalize(cross(worldUp, n)); up = normalize(cross(n, right)).
  let rx = nz, ry = 0, rz = -nx;
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  let ux = ny * rz - nz * ry, uy = nz * rx - nx * rz, uz = nx * ry - ny * rx;
  const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  const hw = w * 0.5, hh = h * 0.5;
  const corner = (sx: number, sy: number, u: number, v: number) => [
    cx + rx * hw * sx + ux * hh * sy,
    cy + ry * hw * sx + uy * hh * sy,
    cz + rz * hw * sx + uz * hh * sy,
    u, v,
  ];
  const cs = [corner(-1, -1, 0, 0), corner(1, -1, 1, 0), corner(1, 1, 1, 1), corner(-1, 1, 0, 1)];
  const b0 = verts.length / 8;
  for (const c of cs) verts.push(c[0], c[1], c[2], nx, ny, nz, c[3], c[4]);
  indices.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
  const b1 = verts.length / 8;
  for (const c of cs) verts.push(c[0], c[1], c[2], -nx, -ny, -nz, c[3], c[4]);
  indices.push(b1, b1 + 2, b1 + 1, b1, b1 + 3, b1 + 2);
}

// PUBG-style tree: a bark-textured trunk + a canopy built from a cloud of
// alpha-cutout leaf cards (instead of solid green cones). The leaf texture has
// a real alpha channel; the GLB material is alphaMode=MASK so the engine's
// fragment shader discards the gaps → see-through, leafy foliage that casts
// and receives shadows through the normal drawModel path.
function makeTree(): Mesh {
  const m: Mesh = [];
  // Trunk: two stacked bark cylinders, narrower toward the top (slight taper).
  pushCylinder(m, 0, 0.9, 0, 0.26, 0.9, 9, [1, 1, 1], 0.95, 0.0, 'bark');
  pushCylinder(m, 0, 2.1, 0, 0.17, 0.5, 9, [1, 1, 1], 0.95, 0.0, 'bark');

  // Deterministic pseudo-random so the GLB is reproducible.
  let seed = 90187;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  const fv: number[] = [], fi: number[] = [];
  const CANOPY_Y = 3.0, CANOPY_R = 1.7;
  // Three stacked rings (skirt → middle → crown) plus a top cap, so the canopy
  // reads as a full rounded dome from every angle. Each ring's cards face
  // outward, tilted progressively more skyward toward the crown.
  const rings = [
    { count: 16, y: 2.2, r: 1.15, tilt: 0.02, size: 1.9 },
    { count: 18, y: 2.8, r: 1.05, tilt: 0.20, size: 2.0 },
    { count: 16, y: 3.4, r: 0.85, tilt: 0.45, size: 1.8 },
    { count: 10, y: 4.0, r: 0.55, tilt: 0.70, size: 1.5 },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const yaw = (i / ring.count) * Math.PI * 2 + (rnd() - 0.5) * 0.8;
      const r = CANOPY_R * ring.r * (0.7 + rnd() * 0.5);
      const cy = ring.y + (rnd() - 0.5) * 0.7;
      const cx = Math.sin(yaw) * r * 0.7;
      const cz = Math.cos(yaw) * r * 0.7;
      const size = ring.size * (0.7 + rnd() * 0.7);   // wide size variation
      addLeafCard(fv, fi, cx, cy, cz, size, size, yaw, ring.tilt + rnd() * 0.35);
    }
  }
  // Near-horizontal cards capping the very top (fills the top-down view).
  for (let i = 0; i < 8; i++) {
    addLeafCard(fv, fi, (rnd() - 0.5) * 1.4, CANOPY_Y + 1.25 + rnd() * 0.45,
                (rnd() - 0.5) * 1.4, 1.7, 1.7, rnd() * Math.PI * 2, 1.15);
  }
  // Irregular outliers — clumps sticking out past the dome so the silhouette
  // is ragged + natural, not a clean sphere/box.
  for (let i = 0; i < 9; i++) {
    const yaw = rnd() * Math.PI * 2;
    const r = CANOPY_R * (1.0 + rnd() * 0.5);
    addLeafCard(fv, fi, Math.sin(yaw) * r, CANOPY_Y + (rnd() - 0.3) * 2.2,
                Math.cos(yaw) * r, 1.1 + rnd() * 0.9, 1.1 + rnd() * 0.9,
                yaw, rnd() * 0.7);
  }
  m.push({
    vertices: fv, indices: fi, color: [1, 1, 1], textureKey: 'leaf',
    roughness: 0.9, metallic: 0.0, alphaMode: 'MASK', alphaCutoff: 0.5,
  });
  return m;
}

// Scattered ground grass tuft: a few crossed alpha-cutout blade cards rooted at
// the ground (card bottom at y=0). alphaMode MASK → the engine discards the gaps
// and, because the material is alpha-cutout, the foliage wind-sway + backlit
// translucency in the scene shader both apply (it sways in the breeze).
function makeGrassTuft(): Mesh {
  const fv: number[] = [], fi: number[] = [];
  let seed = 24681;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    const yaw = (i / blades) * Math.PI + (rnd() - 0.5) * 0.7;
    const h = 0.42 + rnd() * 0.34;
    const w = 0.55 + rnd() * 0.35;
    const ox = (rnd() - 0.5) * 0.28, oz = (rnd() - 0.5) * 0.28;
    addLeafCard(fv, fi, ox, h * 0.5, oz, w, h, yaw, (rnd() - 0.5) * 0.15);
  }
  return [{
    vertices: fv, indices: fi, color: [1, 1, 1], textureKey: 'grass_blade',
    roughness: 0.95, metallic: 0.0, alphaMode: 'MASK', alphaCutoff: 0.4,
  }];
}

// Wildflower clump: a couple of crossed alpha-cutout flower cards, rooted at
// the ground. Same foliage path as the grass tufts (sways in the wind).
function makeFlowerTuft(): Mesh {
  const fv: number[] = [], fi: number[] = [];
  let seed = 51237;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 3; i++) {
    const yaw = (i / 3) * Math.PI + (rnd() - 0.5) * 0.6;
    const h = 0.34 + rnd() * 0.22;
    const w = 0.40 + rnd() * 0.20;
    const ox = (rnd() - 0.5) * 0.2, oz = (rnd() - 0.5) * 0.2;
    addLeafCard(fv, fi, ox, h * 0.5, oz, w, h, yaw, 0.0);
  }
  return [{
    vertices: fv, indices: fi, color: [1, 1, 1], textureKey: 'flower',
    roughness: 0.95, metallic: 0.0, alphaMode: 'MASK', alphaCutoff: 0.4,
  }];
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

// Bake the whole house — every "building"-tagged box collider in the world —
// into ONE stone-textured mesh whose vertices are already in world space, so
// the runtime draws it with a single drawModel at the origin (scale 1) instead
// of dozens of flat-coloured drawCube placeholders. The boxes stay as invisible
// physics colliders (created separately in main.ts); this only replaces their
// look. pushBox tiles the stone at TILE_METRES (2 m), so block size is uniform
// across walls of any dimension.
function makeHouse(worldPath: string): Mesh {
  const world = JSON.parse(readFileSync(worldPath, 'utf8'));
  const m: Mesh = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
  for (const e of world.entities) {
    const ud = e.userData || {};
    const tags: string[] = e.tags || [];
    if (ud.kind !== 'static_mesh' || ud.collider !== 'box') continue;
    if (tags.indexOf('building') < 0) continue;
    const p = e.transform.position;
    const he = String(ud.halfExtents).split(',').map((t: string) => parseFloat(t.trim()));
    pushBox(m, p[0], p[1], p[2], he[0], he[1], he[2], STONE, 0.92, 0.0, 'stone');
    // Track footprint from the tall perimeter walls only (he.y > 1) so the
    // roof spans the building, not the low entrance steps that stick out.
    if (he[1] > 1.0) {
      minX = Math.min(minX, p[0] - he[0]); maxX = Math.max(maxX, p[0] + he[0]);
      minZ = Math.min(minZ, p[2] - he[2]); maxZ = Math.max(maxZ, p[2] + he[2]);
      maxY = Math.max(maxY, p[1] + he[1]);
    }
  }
  // Cap the open enclosure with a flat wooden-plank roof + a small overhang and
  // a stone fascia band just under the eaves, so it reads as a finished house.
  if (maxY > -Infinity) {
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const hx = (maxX - minX) / 2 + 0.35, hz = (maxZ - minZ) / 2 + 0.35;
    pushBox(m, cx, maxY + 0.02, cz, hx - 0.34, 0.10, hz - 0.34,
            [0.42, 0.46, 0.50], 0.9, 0.0, 'stone');        // stone fascia just below eaves
    pushBox(m, cx, maxY + 0.18, cz, hx, 0.12, hz,
            [0.34, 0.24, 0.17], 0.85, 0.0, 'wood');         // wooden roof deck + overhang
  }
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
  // Pull in the normal-map variant of every base texture that has one, so it
  // gets embedded + indexed alongside the albedo (referenced via normalTexture).
  for (const k of [...texKeys]) {
    const nk = NORMAL_FOR[k];
    if (nk && texKeys.indexOf(nk) < 0) texKeys.push(nk);
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
    let normalTexIdx = -1;
    if (p.textureKey) {
      const ti = texKeys.indexOf(p.textureKey);
      if (ti >= 0 && texBytes[ti].length > 0) {
        pbr.baseColorTexture = { index: ti };
        // With a texture in play the factor just tints it; lighten so the
        // material isn't overly dark.
        pbr.baseColorFactor = [1.0, 1.0, 1.0, 1.0];
      }
      const nk = NORMAL_FOR[p.textureKey];
      if (nk) {
        const ni = texKeys.indexOf(nk);
        if (ni >= 0 && texBytes[ni].length > 0) normalTexIdx = ni;
      }
    }
    const matObj: any = { name: 'mat_' + i, pbrMetallicRoughness: pbr };
    if (normalTexIdx >= 0) matObj.normalTexture = { index: normalTexIdx, scale: 1.0 };
    if (p.alphaMode === 'MASK') {
      matObj.alphaMode = 'MASK';
      matObj.alphaCutoff = p.alphaCutoff ?? 0.5;
    }
    if (p.doubleSided) matObj.doubleSided = true;
    materials.push(matObj);

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

// The tree is fully procedural (leaf + bark textures generated here), so it
// always regenerates. The remaining props bake Unvanquished tex-tech sources
// (vendor/, gitignored) via macOS `sips`; only regenerate those when the source
// tree is present, so a tree-only rebuild on a fresh/Windows checkout doesn't
// strip the committed textures from the other props.
// All props build unconditionally now: stone/wood/metal/floor have procedural
// PROC_TEX fallbacks (see resolveTexture), so the building + furniture are
// fully textured even without the Unvanquished tex-tech vendor source. (They
// previously fell back to a flat solid grey — the "white box" building.)
writeGlb('assets/models/prop_tree.glb',      makeTree());
writeGlb('assets/models/prop_grasstuft.glb', makeGrassTuft());
writeGlb('assets/models/prop_flower.glb',    makeFlowerTuft());
writeGlb('assets/models/prop_crate.glb',     makeCrate());
writeGlb('assets/models/prop_barrel.glb',    makeBarrel());
writeGlb('assets/models/prop_table.glb',     makeTable());
writeGlb('assets/models/prop_chair.glb',     makeChair());
writeGlb('assets/models/prop_bed.glb',       makeBed());
writeGlb('assets/models/building_wall.glb',  makeBuildingWall());
writeGlb('assets/models/building_floor.glb', makeBuildingFloor());
writeGlb('assets/models/house.glb',          makeHouse('assets/worlds/arena_02.world.json'));
