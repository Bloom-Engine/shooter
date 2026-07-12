// SH-042 / M1 — real weapon models, converted from the Unvanquished sources.
//
// Replaces the procedural stand-ins from tools/build-weapons.ts (which replaced
// the grey drawCube primitives before that). Those stand-ins did their job:
// they made the muzzle points and the socket real so the gunplay could be
// built. This puts the actual art on the end of it.
//
//   bun tools/convert-weapons.ts
//
// The source is MD3 — specifically `tpweapon.md3` ("third-person weapon"), which
// is the mesh this game wants. Note that `<weapon>_hand.md3` is a TRAP: it
// parses fine and reports zero surfaces, because it is a tag-only attachment
// model carrying no geometry at all. The `_view.md5mesh` files are the
// first-person arms, which a third-person game has no use for.
//
// MD3 is a simple format: a header, then per surface a triangle list, a UV
// list, and one vertex list per animation frame. Weapons are rigid, so frame 0
// is the whole model.
//
// AXES. Quake is X-forward, Y-left, Z-up; the game wants +Z down the barrel,
// +Y up, +X right. So:  x' = -y,  y' = z,  z' = x.
//
// SCALE. Rather than trust Quake's unit-to-metre convention, each weapon is
// normalised to an authored length (below) — which also guarantees the muzzle
// constants in main.ts stay meaningful when the art changes.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resizeMax } from './imgutil';

const SRC  = 'vendor/unvanquished/pkg/res-weapons_src.dpkdir/models/weapons';
const OUT  = 'assets/models';
const CACHE = 'tools/.cache';
const TEX_MAX = 512;

interface Spec {
  /// Output name (must match the loadModel() calls in main.ts).
  out: string;
  /// Source directory under models/weapons/.
  dir: string;
  /// MD3 basename; `_hand` is the third-person model.
  md3: string;
  /// Target length down the barrel, metres. This IS the ABI with main.ts's
  /// WEAPON_MUZZLE_Z table — change one, change the other.
  length: number;
  /// Texture basename override, when the shader name doesn't resolve.
  tex?: string;
}

const WEAPONS: Spec[] = [
  { out: 'weapon_rifle',    dir: 'rifle',    md3: 'tpweapon',              length: 0.92 },
  { out: 'weapon_blaster',  dir: 'blaster',  md3: 'tpweapon',              length: 0.62, tex: 'tpskin' },
  // The chaingun is the odd one out — it ships `chaingun_thirdperson.md3`
  // instead of `tpweapon.md3`.
  { out: 'weapon_chaingun', dir: 'chaingun', md3: 'chaingun_thirdperson',  length: 1.05 },
  { out: 'weapon_cannon',   dir: 'lcannon',  md3: 'tpweapon',              length: 1.00 },
];

// ---- MD3 ---------------------------------------------------------------------

interface Surface {
  name: string;
  shader: string;
  pos: number[];    // xyz, converted axes, unscaled
  nrm: number[];
  uv: number[];
  idx: number[];
}

function parseMd3(buf: Buffer): Surface[] {
  const ident = buf.toString('ascii', 0, 4);
  if (ident !== 'IDP3') throw new Error('not an MD3 (ident ' + ident + ')');

  // Header: ident[4] version[4] name[64] flags[4] numFrames[4] numTags[4]
  //         numSurfaces[4] numSkins[4] ofsFrames[4] ofsTags[4] ofsSurfaces[4]
  const numSurfaces = buf.readInt32LE(84);
  const ofsSurfaces = buf.readInt32LE(100);
  if (numSurfaces === 0) {
    throw new Error('MD3 has no surfaces — this is a tag-only model ' +
                    '(e.g. <weapon>_hand.md3); you want tpweapon.md3');
  }

  const out: Surface[] = [];
  let so = ofsSurfaces;
  for (let s = 0; s < numSurfaces; s++) {
    // Surface: ident[4] name[64] flags[4] numFrames[4] numShaders[4]
    //          numVerts[4] numTriangles[4] ofsTriangles[4] ofsShaders[4]
    //          ofsSt[4] ofsXyzNormals[4] ofsEnd[4]
    const name        = buf.toString('ascii', so + 4, so + 68).replace(/\0.*$/, '');
    const numShaders  = buf.readInt32LE(so + 76);
    const numVerts    = buf.readInt32LE(so + 80);
    const numTris     = buf.readInt32LE(so + 84);
    const ofsTris     = buf.readInt32LE(so + 88);
    const ofsShaders  = buf.readInt32LE(so + 92);
    const ofsSt       = buf.readInt32LE(so + 96);
    const ofsXyz      = buf.readInt32LE(so + 100);
    const ofsEnd      = buf.readInt32LE(so + 104);

    let shader = '';
    if (numShaders > 0) {
      shader = buf.toString('ascii', so + ofsShaders, so + ofsShaders + 64)
                  .replace(/\0.*$/, '');
    }

    const idx: number[] = [];
    for (let t = 0; t < numTris; t++) {
      const o = so + ofsTris + t * 12;
      // MD3 winds the other way round from glTF's front face; swap two indices
      // or every triangle is backface-culled and the gun renders inside-out.
      idx.push(buf.readInt32LE(o), buf.readInt32LE(o + 8), buf.readInt32LE(o + 4));
    }

    const uv: number[] = [];
    for (let v = 0; v < numVerts; v++) {
      const o = so + ofsSt + v * 8;
      uv.push(buf.readFloatLE(o), buf.readFloatLE(o + 4));
    }

    // Frame 0 only — weapons are rigid props here.
    const pos: number[] = [];
    const nrm: number[] = [];
    for (let v = 0; v < numVerts; v++) {
      const o = so + ofsXyz + v * 8;
      const qx = buf.readInt16LE(o)     / 64;
      const qy = buf.readInt16LE(o + 2) / 64;
      const qz = buf.readInt16LE(o + 4) / 64;
      // Axis convert: x' = -y, y' = z, z' = x
      pos.push(-qy, qz, qx);

      // Normal is packed as two spherical angles, one byte each.
      const lat = (buf.readUInt8(o + 7) * 2 * Math.PI) / 255;
      const lng = (buf.readUInt8(o + 6) * 2 * Math.PI) / 255;
      const nx = Math.cos(lat) * Math.sin(lng);
      const ny = Math.sin(lat) * Math.sin(lng);
      const nz = Math.cos(lng);
      nrm.push(-ny, nz, nx);
    }

    out.push({ name, shader, pos, nrm, uv, idx });
    so += ofsEnd;
  }
  return out;
}

// ---- texture -----------------------------------------------------------------

/// The shader name in the MD3 is a game path like `models/weapons/rifle/rifle`.
/// The actual file may be .png/.jpg/.webp — the chaingun ships webp — so try
/// each. ffmpeg (via resizeMax) decodes all of them, which is the other reason
/// SH-044 replaced the macOS-only `sips`.
/// The source set is inconsistent in three separate ways, all of which have to
/// be absorbed here or a weapon silently comes out untextured:
///   - the rifle's shader is a bare game path, the blaster's already carries
///     `.jpg`;
///   - the chaingun's textures are PBR-suffixed (`plastic` -> `plastic_d.webp`);
///   - and the chaingun's MD3 misspells one of its own shaders as `backmetal`
///     when the file on disk is `blackmetal`.
const SHADER_ALIAS: Record<string, string> = { backmetal: 'blackmetal' };

function resolveTexture(dir: string, shader: string, override?: string): string | null {
  let base = override ?? shader.split('/').pop() ?? '';
  base = base.replace(/\.(png|jpg|jpeg|webp|tga)$/i, '');
  if (base.length === 0) return null;
  if (SHADER_ALIAS[base]) base = SHADER_ALIAS[base];

  // `_d` is the diffuse/albedo of a PBR set; try the bare name first so the
  // single-texture weapons keep resolving as before.
  for (const name of [base, base + '_d']) {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'tga']) {
      const p = `${SRC}/${dir}/${name}.${ext}`;
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// ---- GLB ---------------------------------------------------------------------

function f32(arr: number[], v: number) {
  const b = Buffer.alloc(4); b.writeFloatLE(v, 0);
  arr.push(b[0], b[1], b[2], b[3]);
}
function u32(arr: number[], v: number) {
  const b = Buffer.alloc(4); b.writeUInt32LE(v, 0);
  arr.push(b[0], b[1], b[2], b[3]);
}

/// `texPerSurface[i]` is the PNG bytes for surface i, or null for flat metal.
/// Distinct images are de-duplicated (the chaingun's 5 surfaces use 3 textures).
function buildGlb(surfaces: Surface[], texPerSurface: (Uint8Array | null)[], scale: number): Buffer {
  const bin: number[] = [];
  const views: any[] = [];
  const accessors: any[] = [];
  const prims: any[] = [];
  const materials: any[] = [];
  const images: any[] = [];
  const textures: any[] = [];
  const align4 = () => { while (bin.length % 4 !== 0) bin.push(0); };

  // Emit each distinct image once; map its identity to a glTF texture index.
  const texIndex = new Map<Uint8Array, number>();
  const emitTexture = (png: Uint8Array): number => {
    const hit = texIndex.get(png);
    if (hit !== undefined) return hit;
    align4();
    const off = bin.length;
    for (const b of png) bin.push(b);
    align4();
    views.push({ buffer: 0, byteOffset: off, byteLength: png.length });
    images.push({ bufferView: views.length - 1, mimeType: 'image/png' });
    textures.push({ source: images.length - 1, sampler: 0 });
    const idx = textures.length - 1;
    texIndex.set(png, idx);
    return idx;
  };

  for (let si = 0; si < surfaces.length; si++) {
    const s = surfaces[si];
    if (s.idx.length === 0) continue;
    const vcount = s.pos.length / 3;

    align4();
    const posOff = bin.length;
    const pmin = [Infinity, Infinity, Infinity];
    const pmax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < s.pos.length; i++) {
      const v = s.pos[i] * scale;
      const c = i % 3;
      if (v < pmin[c]) pmin[c] = v;
      if (v > pmax[c]) pmax[c] = v;
      f32(bin, v);
    }
    views.push({ buffer: 0, byteOffset: posOff, byteLength: s.pos.length * 4 });
    accessors.push({ bufferView: views.length - 1, componentType: 5126,
                     count: vcount, type: 'VEC3', min: pmin, max: pmax });
    const aPos = accessors.length - 1;

    align4();
    const nrmOff = bin.length;
    for (const v of s.nrm) f32(bin, v);
    views.push({ buffer: 0, byteOffset: nrmOff, byteLength: s.nrm.length * 4 });
    accessors.push({ bufferView: views.length - 1, componentType: 5126,
                     count: vcount, type: 'VEC3' });
    const aNrm = accessors.length - 1;

    align4();
    const uvOff = bin.length;
    for (const v of s.uv) f32(bin, v);
    views.push({ buffer: 0, byteOffset: uvOff, byteLength: s.uv.length * 4 });
    accessors.push({ bufferView: views.length - 1, componentType: 5126,
                     count: vcount, type: 'VEC2' });
    const aUv = accessors.length - 1;

    align4();
    const idxOff = bin.length;
    for (const v of s.idx) u32(bin, v);
    views.push({ buffer: 0, byteOffset: idxOff, byteLength: s.idx.length * 4 });
    accessors.push({ bufferView: views.length - 1, componentType: 5125,
                     count: s.idx.length, type: 'SCALAR' });
    const aIdx = accessors.length - 1;

    const png = texPerSurface[si] ?? null;
    const ti = png ? emitTexture(png) : -1;
    materials.push({
      pbrMetallicRoughness: {
        baseColorTexture: ti >= 0 ? { index: ti } : undefined,
        baseColorFactor: ti >= 0 ? [1, 1, 1, 1] : [0.35, 0.36, 0.38, 1],
        metallicFactor: 0.75,
        roughnessFactor: 0.45,
      },
      doubleSided: false,
    });
    prims.push({
      attributes: { POSITION: aPos, NORMAL: aNrm, TEXCOORD_0: aUv },
      indices: aIdx,
      material: materials.length - 1,
    });
  }

  const gltf: any = {
    asset: { version: '2.0', generator: 'bloom-shooter convert-weapons' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: prims }],
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  if (textures.length > 0) {
    gltf.images = images;
    gltf.textures = textures;
    gltf.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
  }

  const jsonBytes = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binBuf = Buffer.from(Uint8Array.from(bin));
  const binPad = (4 - (binBuf.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + binBuf.length + binPad;

  const outBuf = Buffer.alloc(total);
  let o = 0;
  outBuf.write('glTF', o); o += 4;
  outBuf.writeUInt32LE(2, o); o += 4;
  outBuf.writeUInt32LE(total, o); o += 4;
  outBuf.writeUInt32LE(jsonBytes.length + jsonPad, o); o += 4;
  outBuf.write('JSON', o); o += 4;
  jsonBytes.copy(outBuf, o); o += jsonBytes.length;
  for (let i = 0; i < jsonPad; i++) { outBuf.writeUInt8(0x20, o); o += 1; }
  outBuf.writeUInt32LE(binBuf.length + binPad, o); o += 4;
  outBuf.write('BIN\0', o); o += 4;
  binBuf.copy(outBuf, o); o += binBuf.length;
  for (let i = 0; i < binPad; i++) { outBuf.writeUInt8(0, o); o += 1; }
  return outBuf;
}

// ---- run ---------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

for (const w of WEAPONS) {
  const md3Path = `${SRC}/${w.dir}/${w.md3}.md3`;
  if (!existsSync(md3Path)) { console.warn('[skip]', w.out, '- no', md3Path); continue; }

  console.log(`[${w.out}]`);
  const surfaces = parseMd3(readFileSync(md3Path));
  const tris = surfaces.reduce((a, s) => a + s.idx.length / 3, 0);

  // Normalise to the authored barrel length: measure the model's extent along
  // its own +Z and scale so it matches. Trusting Quake's unit convention would
  // silently desync the muzzle constants in main.ts the moment art changes.
  let zmin = Infinity, zmax = -Infinity;
  for (const s of surfaces) {
    for (let i = 2; i < s.pos.length; i += 3) {
      if (s.pos[i] < zmin) zmin = s.pos[i];
      if (s.pos[i] > zmax) zmax = s.pos[i];
    }
  }
  const raw = Math.max(zmax - zmin, 0.0001);
  const scale = w.length / raw;

  // Re-centre so the grip sits near the origin, which is what the socket
  // expects — the MD3's origin is the Quake hand tag, not the mesh centre.
  for (const s of surfaces) {
    for (let i = 2; i < s.pos.length; i += 3) s.pos[i] -= zmin;
  }

  // One texture per SURFACE — the chaingun's five surfaces use three different
  // materials, and resolving only surface 0 left it untextured.
  const cachedPng = new Map<string, Uint8Array>();
  const texPerSurface: (Uint8Array | null)[] = [];
  for (const s of surfaces) {
    const texSrc = resolveTexture(w.dir, s.shader, w.tex);
    if (!texSrc) {
      console.warn('  no texture for shader', JSON.stringify(s.shader), '- flat metal');
      texPerSurface.push(null);
      continue;
    }
    let png = cachedPng.get(texSrc);
    if (!png) {
      const cache = `${CACHE}/${w.out}_${texSrc.split('/').pop()!.replace(/\.\w+$/, '')}.png`;
      resizeMax(texSrc, cache, TEX_MAX);
      png = readFileSync(cache);
      cachedPng.set(texSrc, png);
      console.log('  texture:', texSrc.split('/').pop());
    }
    texPerSurface.push(png);
  }

  const glb = buildGlb(surfaces, texPerSurface, scale);
  writeFileSync(`${OUT}/${w.out}.glb`, glb);
  console.log(`  ${surfaces.length} surfaces, ${tris} tris, scale ${scale.toFixed(4)}`);
  console.log(`  wrote ${OUT}/${w.out}.glb (${glb.length} bytes)`);
}

console.log('\nMuzzle Z (metres down the barrel) — keep main.ts WEAPON_MUZZLE_Z in sync:');
for (const w of WEAPONS) {
  console.log(`  ${w.out.padEnd(16)} length ${w.length}  -> muzzle ~${(w.length * 0.95).toFixed(2)}`);
}
