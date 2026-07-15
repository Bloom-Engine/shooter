// SH-025a — the static world's VISUAL setup, out of main.ts.
//
// Everything here builds what the arena LOOKS like from the world file's
// data: the river water (material + tessellated Gerstner mesh + planar
// reflection probe), the 20k instanced grass, the baked building shell,
// the glass pane, the muzzle-flash material, and the gi_only scene-node
// proxies that let Lumen bounce light off geometry the material path
// renders. The DRAW side of the world still lives in main.ts's frame
// loop — it interleaves with combat visuals and moves with SH-025c.
//
// Perry rules that shape this module (see perry-quirks.md and the CAM
// array note in main.ts):
// - NO engine calls at module scope: imported modules execute before
//   main.ts reaches initWindow(). Everything runs inside init*()
//   functions that main.ts calls at the same boot positions the code
//   occupied when it lived there (the loading bar order is unchanged).
// - NO exported `let` bindings: Perry does not reliably propagate
//   module-scope reassignment across modules. Cross-module state lives
//   as properties of the const ENV object (literal-key access only),
//   written once at init — the same array-slot pattern CAM uses.
import {
  createMesh, createMeshExplicit, genMeshCube,
  compileMaterialInstanced, createInstanceBuffer,
  setMaterialParams, compileMaterialFromFile,
  createPlanarReflection, setMaterialReflectionProbe, setMaterialProbeVisible,
} from 'bloom';
import { readFile } from 'bloom/core';
import {
  createTextureArrayFromFiles, setMaterialTextureArray,
  TEXTURE_ARRAY_ALBEDO, TEXTURE_ARRAY_NORMAL, TEXTURE_ARRAY_MR,
  TEX_ARRAY_FORMAT_SRGB, TEX_ARRAY_FORMAT_LINEAR,
} from 'bloom/models';
import {
  createSceneNode, attachModelToNode, setSceneNodeTrs,
  setSceneNodeGiOnly, setSceneNodeCastShadow, setSceneNodeColor,
} from 'bloom/scene';
import * as W from './world-runtime';
import * as T from './world-runtime';
import { terrainHeightAt } from './terrain';
import { bootStage, BOOT_WATER, BOOT_GRASS, BOOT_PROPS } from './boot';

/// Handles main.ts's frame loop (and later combat/draw modules) read.
/// Written exactly once, inside initEnvironment(). Mesh entries hold the
/// Model OBJECTS the create/draw FFI wrappers exchange, hence `any`.
export const ENV: any = {
  matWater: 0, matWaterMesh: 0, waterProbe: 0,
  WATER_W: 0, WATER_D: 0, WATER_CX: 0, WATER_CZ: 0, WATER_Y: 0,
  matGrass: 0, matGrassMesh: 0, matGrassInstances: 0, GRASS_INSTANCE_COUNT: 0,
  matBuilding: 0, matBuildingMesh: 0,
  matGlass: 0, matGlassMesh: 0,
  matMuzzleFlash: 0, matMuzzleFlashMesh: 0,
};

// Round-4 â€” deterministic value noise over world XZ, used for the
// large-scale "moisture" patches that vary grass colour/height (and
// loosely match the terrain shader's macro patches). Pure math, no
// state â€” Perry-safe.
function hashCell(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function moistureNoise(x: number, z: number): number {
  const fx = Math.floor(x), fz = Math.floor(z);
  const tx = x - fx, tz = z - fz;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hashCell(fx, fz),     b = hashCell(fx + 1, fz);
  const c = hashCell(fx, fz + 1), d = hashCell(fx + 1, fz + 1);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

export function initEnvironment(): void {
  // ---- Phase 9 water â€” real shader-based river ----------------------------
  // Replaces the ~1800-cube tessellated river from earlier with a proper
  // WGSL material: three Gerstner waves for vertex displacement, per-vertex
  // normal from the wave derivatives, Fresnel-blended refraction (sampling
  // the SceneColor snapshot) and sky reflection (from the engine's env
  // cubemap), plus foam on high-slope crests. Single drawMeshWithMaterial
  // call; Phase 4b handles the snapshot + translucent pass automatically.
  
  // SH-005: the inline WGSL fallbacks are gone. They existed so a binary-only
  // build could run with no assets on disk, and they cost more than they bought:
  // the water copy silently drifted to a 2-vec4 params layout that misread the
  // real 3-vec4 WATER_PARAMS, so engaging the "fallback" shipped WRONG water, and
  // the grass copy had to be hand-patched twice during EN-022. The game already
  // loads its world, textures and models from disk; shaders are no different.
  // One source of truth, no drift possible.
  bootStage(BOOT_WATER);
  const matWater = compileMaterialFromFile('assets/materials/water.wgsl', 'refractive');
  // Tier 4 layout: absorption coefficient (red dies fastest, blue
  // slowest), deep-water colour (greenish-teal), then knobs:
  //   foam, rim, sky_lod, micro_strength.
  // Round-3 recalibration: the river bed sits only ~0.3 m down, so the
  // old 0.55/m absorption left the water reading as hazy grass â€”
  // exaggerate it (games do) so a shallow column still shifts teal.
  // Rim 0.25 â†’ 0.10 and sky_lod 2.0 â†’ 0.6 both fight the milky wash:
  // less white shoreline paint, sharper sky/cloud reflection.
  // Round-9: micro_strength 0.18 â†’ 0.26 â€” the shader's micro detail is now
  // flow-advected noise streaks (see water.wgsl) and carries most of the
  // "moving river" read, so it gets a little more normal weight.
  const WATER_PARAMS = [
    2.20, 0.90, 0.60,   0.0,    // absorption per metre
    0.05, 0.18, 0.28,   0.0,    // deep_tint
    0.50, 0.10,         0.6,   0.26,    // foam / rim / sky_lod / micro_strength
  ];
  if (matWater > 0) setMaterialParams(matWater, WATER_PARAMS);
  
  // ---- Water plane mesh â€” tessellated for Gerstner displacement ----------
  // One flat XZ plane covering the whole river footprint in arena_02.
  // Drawn at origin with scale 1, so the mesh's native dimensions are the
  // visible river size. Subdivide finely enough that the longest
  // Gerstner wave (~5 m wavelength) shows smooth wave peaks.
  // Round-2 audit (F11): these used to be hardcoded here while the world
  // file authored six overlapping zig-zag volumes the runtime ignored â€”
  // two sources of truth that had already drifted. The world file now
  // carries the one real river volume and the runtime reads it.
  const WATER_W  = W.WATER_COUNT > 0 ? W.WATER_SX[0] : 80;   // metres along X
  const WATER_D  = W.WATER_COUNT > 0 ? W.WATER_SZ[0] : 5;    // metres along Z
  const WATER_CX = W.WATER_COUNT > 0 ? W.WATER_CX[0] : 0;    // world X centre
  const WATER_CZ = W.WATER_COUNT > 0 ? W.WATER_CZ[0] : 12;   // world Z centre
  const WATER_Y  = W.WATER_COUNT > 0 ? W.WATER_CY[0] + 0.05 : 0.05;
  const WATER_COLS = 80;
  const WATER_ROWS = 10;
  const _wvc = (WATER_COLS + 1) * (WATER_ROWS + 1);
  const _wic = WATER_COLS * WATER_ROWS * 2 * 3;
  const WATER_VERTS = new Array<number>(_wvc * 12);
  const WATER_INDS  = new Array<number>(_wic);
  {
    let vi = 0;
    for (let r = 0; r <= WATER_ROWS; r++) {
      for (let c = 0; c <= WATER_COLS; c++) {
        const u = c / WATER_COLS;
        const vv = r / WATER_ROWS;
        // World-space positions â€” mesh has its own real extent.
        WATER_VERTS[vi++] = -WATER_W * 0.5 + u * WATER_W;
        WATER_VERTS[vi++] = 0;
        WATER_VERTS[vi++] = -WATER_D * 0.5 + vv * WATER_D;
        WATER_VERTS[vi++] = 0; WATER_VERTS[vi++] = 1; WATER_VERTS[vi++] = 0;
        WATER_VERTS[vi++] = 1; WATER_VERTS[vi++] = 1; WATER_VERTS[vi++] = 1; WATER_VERTS[vi++] = 1;
        WATER_VERTS[vi++] = u; WATER_VERTS[vi++] = vv;
      }
    }
    let ii = 0;
    const nc = WATER_COLS + 1;
    for (let r = 0; r < WATER_ROWS; r++) {
      for (let c = 0; c < WATER_COLS; c++) {
        const tl = r * nc + c;
        const tr = tl + 1;
        const bl = tl + nc;
        const br = bl + 1;
        // CCW-from-above so default backface culling doesn't cull them.
        WATER_INDS[ii++] = tl; WATER_INDS[ii++] = br; WATER_INDS[ii++] = bl;
        WATER_INDS[ii++] = tl; WATER_INDS[ii++] = tr; WATER_INDS[ii++] = br;
      }
    }
  }
  const matWaterMesh = createMeshExplicit(WATER_VERTS, _wvc, WATER_INDS, _wic);
  
  // Round-3 â€” planar reflection probe (EN-011). Mirror-renders the
  // cached-model world across the water plane into an HDR RT each frame;
  // water.wgsl blends it over the analytic sky by probe alpha, so trees /
  // house / banks actually appear in the river. Materials linked to a
  // probe are excluded from their own reflection automatically.
  const waterProbe = matWater > 0 ? createPlanarReflection(WATER_Y, 0, 1, 0, 512) : 0;
  if (waterProbe > 0) setMaterialReflectionProbe(matWater, waterProbe);
  
  // ---- SH-021 instanced grass â€” canonical blade Ã— N instances -------------
  // Replaces the Tier-2b 5 000-blade baked-mesh path. One canonical
  // 6-vert cross-quad blade is uploaded once; per-frame draw is a
  // single drawMeshWithMaterialInstanced call against a 20 000-entry
  // instance buffer (pos / rot_y / scale / tint). Wind sway uses the
  // global PerFrame.wind UBO (EN-013); cascade sun shadows come
  // through sample_sun_shadow (EN-016). Both are folded into the
  // material so SH-011 (grass shading polish) ships in the same pass.
  //
  // The WGSL is READ FROM DISK (SH-005). It used to be duplicated inline as a
  // binary-only fallback, and the copy had to be hand-patched during EN-022 --
  // the drift was not hypothetical. compileMaterialInstanced takes a source
  // string, so reading the file costs one call and removes the second copy.
  bootStage(BOOT_GRASS);
  const matGrass = compileMaterialInstanced(
    readFile('assets/materials/grass_instanced.wgsl'));
  const GRASS_PARAMS = [
    // base hue rgb, transmission strength.
    //
    // SH-050 — RE-TUNED AGAINST THE GROUND, which is now a photoscan rather than
    // two colour stops. Measured, mean albedo:
    //   ground (forrest_ground_01)  RGB 0.568 0.529 0.365 — saturation 0.36, RED-dominant
    //   blade tip, old base         RGB 0.286 0.467 0.137 — saturation 0.71, GREEN-dominant
    // Twice the saturation of the ground it grows out of, 40% darker, and biased
    // the opposite way down the spectrum. Against flat colour stops that passed;
    // against a photograph of real ground it is a neon spike stuck in soil, and it
    // became the most cartoonish thing left in the frame the moment the terrain
    // got real.
    //
    // The old base also quietly broke the palette rule the terrain generator
    // states in its own header — "green channel stays close to red" — with
    // r 0.30 vs g 0.42. This obeys it: r ≈ g, blue low but present, which is the
    // olive the round-4 de-cartoonification pass was after. Grass still reads
    // greener than soil; it no longer reads as a different art style.
    // Target tip ≈ RGB 0.42 0.50 0.26 (saturation 0.48) — in the ground's family.
    0.44, 0.45, 0.38,  0.40,
  ];
  if (matGrass > 0) setMaterialParams(matGrass, GRASS_PARAMS);
  // Blades are sub-pixel in the 512Â² water probe but cost the full 20k-
  // instance vertex + raster pass there â€” skip grass in reflections.
  if (matGrass > 0) setMaterialProbeVisible(matGrass, false);
  
  // Canonical blade mesh â€” Round-4: two-segment tapered blades with a
  // bow, instead of the old single hard triangle (which read as plastic
  // spikes). Per crossed plane: 2 root verts â†’ 2 narrower mid verts â†’
  // 1 tip vert, bowing along the plane normal so the per-instance yaw
  // randomises bow direction across the field. 10 verts Ã— 12 floats
  // (pos.3 normal.3 color.4 uv.2); 36 indices = 12 triangles (front +
  // back of 3 quads/tips per plane). color.r is the tip weight (0 at
  // root â†’ 1 at tip) which the vertex shader uses for wind sway and
  // the fragment shader for the rootâ†’tip colour gradient.
  // SH-050 — BLADE SIZE. Round-9 widened these (0.045/0.026 -> 0.062/0.038)
  // because needle-thin cards fell below a pixel a few metres out and the field
  // read as gritty speckle. That fix was real, but it paid for it in the near
  // field: a 12.4 cm-wide, 55 cm-tall blade is a leaf, not a blade of grass, and
  // at ~7 per m² you could count them. That is what "cartoonish" was.
  //
  // The anti-grit constraint is still respected — it is just no longer paid for
  // by the blades you are standing next to. The vertex shader ALREADY widens
  // blades with camera distance (`wide = 1 + fade * 1.6`, ramping 9 m -> 42 m),
  // which is what actually keeps the far field above a pixel. Round-9 widened
  // the base mesh — every blade at every distance — to fix a problem that only
  // exists past ~9 m, where the distance ramp had it covered.
  //
  // So: narrow the mesh, and let the ramp (widened below to compensate) hold the
  // far field. 3.6 cm at the root is still ~5x a real blade, deliberately — it
  // is the floor set by the 0.5-render-scale TSR path (SH-045's output-scale
  // knob), where a 2 cm blade at 20 m lands under one internal pixel and the
  // speckle comes back.
  const GB_W0 = 0.018;   // root half-width (was 0.062)
  const GB_W1 = 0.010;   // mid half-width  (was 0.038)
  const GB_H1 = 0.16;    // mid height      (was 0.26)
  const GB_H2 = 0.34;    // tip height      (was 0.55) — ~22-45 cm after per-blade
                         //                   scale: meadow, not waist-high reeds
  const GB_B1 = 0.020;   // bow at mid
  const GB_B2 = 0.065;   // bow at tip
  const GRASS_BLADE_VERTS: number[] = [
    // Plane 1 (XY plane, normal +Z, bows toward +Z)
    -GB_W0, 0,     0,      0, 0, 1,   0,    0, 1, 1,   0,   0,
     GB_W0, 0,     0,      0, 0, 1,   0,    0, 1, 1,   1,   0,
    -GB_W1, GB_H1, GB_B1,  0, 0, 1,   0.55, 0, 1, 1,   0,   0.55,
     GB_W1, GB_H1, GB_B1,  0, 0, 1,   0.55, 0, 1, 1,   1,   0.55,
     0,     GB_H2, GB_B2,  0, 0, 1,   1,    0, 1, 1,   0.5, 1,
    // Plane 2 (YZ plane, normal +X, bows toward +X)
     0,     0,     -GB_W0,   1, 0, 0,   0,    0, 1, 1,   0,   0,
     0,     0,      GB_W0,   1, 0, 0,   0,    0, 1, 1,   1,   0,
     GB_B1, GB_H1, -GB_W1,   1, 0, 0,   0.55, 0, 1, 1,   0,   0.55,
     GB_B1, GB_H1,  GB_W1,   1, 0, 0,   0.55, 0, 1, 1,   1,   0.55,
     GB_B2, GB_H2,  0,       1, 0, 0,   1,    0, 1, 1,   0.5, 1,
  ];
  const GRASS_BLADE_INDS: number[] = [
    // Plane 1: root quad + tip tri, front (CCW from +Z) then back.
    0, 1, 3,   0, 3, 2,   2, 3, 4,
    0, 3, 1,   0, 2, 3,   2, 4, 3,
    // Plane 2: same topology at base 5.
    5, 6, 8,   5, 8, 7,   7, 8, 9,
    5, 8, 6,   5, 7, 8,   7, 9, 8,
  ];
  const matGrassMesh = createMeshExplicit(GRASS_BLADE_VERTS, 10, GRASS_BLADE_INDS, 36);
  
  
  // Per-instance buffer â€” 20 000 blades Ã— 9 floats (pos.xyz, rot_y,
  // scale, tint.rgba). Same RNG / heightmap / rejection logic as the
  // old baked-mesh path; deterministic given the seed so screenshot
  // diffs stay stable.
  // SH-011 - density LOD, measured. 20k -> 40k costs ONE fps (34 -> 33): the
  // engine's grass-tile culling (aeb3228) already throws away everything off-screen,
  // so near-field density is close to free and the field finally reads as grass
  // rather than as tufts on a green carpet.
  //
  // The ticket asked for player-following density RINGS. That does not work here:
  // the rings follow the camera but these instances are STATIC, so a ring would mean
  // re-scattering and re-uploading 20k x 9 floats every frame -- which the perf audit
  // would flag the same day. Raising the uniform density gets the same look for a
  // one-off cost.
  //
  // SH-050 — 40k -> 120k. The old note said "70k was measured: still 33 fps, but
  // no denser to look at. Past ~40k the scatter saturates against its keep-outs."
  // The fps half of that still holds and the look half no longer does — it was
  // measured with blades 3.4x WIDER than they are now. At that width the field
  // saturated visually long before the scatter did: fat blades overlap, so extra
  // instances hid behind the ones in front. Narrow blades stop hiding each other,
  // and 40k of them is bare ground with stubble on it.
  //
  // "The scatter saturates" was not measured, and it is wrong: the loop gets
  // COUNT_MAX*3 attempts and only rejects on keep-outs (water + building, a small
  // fraction of a 76 m square), so it places what it is asked for. The boot log
  // below prints the placed count — check it rather than assuming. Measured at
  // 120000: it places 120000/120000.
  //
  // The FPS half of the old note DOES hold, re-measured for this change with the
  // FPSPROBE harness (title screen, 240-frame wall-clock window, same build):
  //   40k  -> 26.64 fps
  //   120k -> 26.21 fps
  // 0.4 fps for 3x the blades. The engine's grass-tile culling (aeb3228) throws
  // away everything off-screen before it costs anything, so what is on screen —
  // not what is scattered — sets the price.
  const GRASS_INSTANCE_COUNT_MAX = 120000;
  const GRASS_INSTANCE_FLOATS    = 9;
  const GRASS_INSTANCES = new Array<number>(GRASS_INSTANCE_COUNT_MAX * GRASS_INSTANCE_FLOATS);
  let GRASS_INSTANCE_COUNT = 0;
  {
    // Round-9b â€” the clump lattice is rotated 37Â° off the world axes so
    // tuft rows can't line up with the view/river/arena edges.
    const CLUMP_C = Math.cos(0.65);
    const CLUMP_S = Math.sin(0.65);
    let seed = 0x12345 | 0;
    let wi = 0;
    for (let attempt = 0; attempt < GRASS_INSTANCE_COUNT_MAX * 3 && GRASS_INSTANCE_COUNT < GRASS_INSTANCE_COUNT_MAX; attempt++) {
      seed = ((seed * 1103515245) + 12345) & 0x7fffffff;
      const r1 = seed / 0x7fffffff;
      seed = ((seed * 1103515245) + 12345) & 0x7fffffff;
      const r2 = seed / 0x7fffffff;
      seed = ((seed * 1103515245) + 12345) & 0x7fffffff;
      const r3 = seed / 0x7fffffff;
      seed = ((seed * 1103515245) + 12345) & 0x7fffffff;
      const r4 = seed / 0x7fffffff;
      seed = ((seed * 1103515245) + 12345) & 0x7fffffff;
      const r5 = seed / 0x7fffffff;
      seed = ((seed * 1103515245) + 12345) & 0x7fffffff;
      const r6 = seed / 0x7fffffff;
      let px = -38 + r1 * 76;
      let pz = -38 + r2 * 76;
      // Round-4 â€” clumping: pull each blade toward a per-1.7 m-cell anchor
      // so the field reads as natural tufts instead of an even lawn. Pull
      // FIRST, then reject on the pulled position.
      // Round-9b â€” de-grid the tufts. The anchors were one per AXIS-ALIGNED
      // cell, jittered across only the middle 60% of it â€” at grazing angles
      // the tufts read as straight rows of stumps. Now the cell lookup runs
      // in the rotated frame, anchors jitter across the FULL cell (with two
      // decorrelated hashes), and ~22% of blades stay loose between tufts
      // so the lattice never shows through.
      const qx = px * CLUMP_C - pz * CLUMP_S;
      const qz = px * CLUMP_S + pz * CLUMP_C;
      const cellX = Math.floor(qx / 1.7), cellZ = Math.floor(qz / 1.7);
      const aqx = (cellX + hashCell(cellX, cellZ)) * 1.7;
      const aqz = (cellZ + hashCell(cellX + 137, cellZ - 91)) * 1.7;
      const ax =  aqx * CLUMP_C + aqz * CLUMP_S;
      const az = -aqx * CLUMP_S + aqz * CLUMP_C;
      const pull = r6 < 0.22 ? 0.12 : 0.65;
      px = px + (ax - px) * pull;
      pz = pz + (az - pz) * pull;
      // No grass on the water or inside the building. Same world-derived shapes
      // the forest uses, with a tighter margin: a blade may grow right up to the
      // waterline, a tree may not.
      if (W.keepOut(px, pz, 0.75)) continue;
      // Bilinear heightmap sample.
      const u = (px - T.TERRAIN_ORIGIN_X) / T.TERRAIN_CELL_SIZE;
      const v = (pz - T.TERRAIN_ORIGIN_Z) / T.TERRAIN_CELL_SIZE;
      let py = 0;
      if (u >= 0 && v >= 0 && u < T.TERRAIN_SAMPLE_COUNT - 1 && v < T.TERRAIN_SAMPLE_COUNT - 1) {
        const ixc = Math.floor(u), iz = Math.floor(v);
        const fx = u - ixc, fz = v - iz;
        const h00 = T.TERRAIN_HEIGHTS[iz * T.TERRAIN_SAMPLE_COUNT + ixc];
        const h10 = T.TERRAIN_HEIGHTS[iz * T.TERRAIN_SAMPLE_COUNT + ixc + 1];
        const h01 = T.TERRAIN_HEIGHTS[(iz + 1) * T.TERRAIN_SAMPLE_COUNT + ixc];
        const h11 = T.TERRAIN_HEIGHTS[(iz + 1) * T.TERRAIN_SAMPLE_COUNT + ixc + 1];
        py = (h00 * (1 - fx) + h10 * fx) * (1 - fz) +
             (h01 * (1 - fx) + h11 * fx) * fz;
      }
      // Round-4 â€” moisture patches (~12 m wavelength): low-moisture areas
      // go dry olive-yellow and slightly shorter, lush areas stay deep
      // green and tall. Plus per-blade jitter on top.
      const moist = moistureNoise(px * 0.085, pz * 0.085);
      const dry   = Math.max(0, Math.min(1, (0.55 - moist) * 3.0));
      // Round-9: jitter 0.16 â†’ 0.10 â€” per-blade hue speckle was a big part
      // of the gritty read; the moisture patches carry the large-scale
      // variation on their own.
      const jit   = (r5 - 0.5) * 0.10;
      GRASS_INSTANCES[wi++] = px;
      GRASS_INSTANCES[wi++] = py;
      GRASS_INSTANCES[wi++] = pz;
      GRASS_INSTANCES[wi++] = r3 * 6.2832;                          // rot_y radians
      GRASS_INSTANCES[wi++] = (0.85 + r4 * 0.40) * (1.05 - dry * 0.30);  // scale
      GRASS_INSTANCES[wi++] = 0.85 + dry * 0.60 + jit;              // tint r
      GRASS_INSTANCES[wi++] = 1.03 + dry * 0.02 + jit * 0.5;        // tint g
      GRASS_INSTANCES[wi++] = 0.95 - dry * 0.40 + jit * 0.3;        // tint b
      GRASS_INSTANCES[wi++] = 1.0;
      GRASS_INSTANCE_COUNT++;
    }
  }
  // EN-001 â€” pass instanceCount explicitly (Perry's `.length` reports
  // the literal-init size, not how many were written).
  const matGrassInstances = matGrass > 0
    ? createInstanceBuffer(GRASS_INSTANCES, GRASS_INSTANCE_COUNT)
    : 0;
  // SH-050 — how many blades actually got PLACED, vs asked for. The claim that
  // "past ~40k the scatter saturates against its keep-outs" was never measured;
  // this is the number that settles it. A placed count well under the max means
  // the rejection loop really is the limit and raising the max buys nothing; a
  // count that matches means the density is exactly what was asked for.
  console.log('[grass] placed ' + GRASS_INSTANCE_COUNT + ' / ' + GRASS_INSTANCE_COUNT_MAX + ' blades');
  
  // ---- Building stone material â€” bake all box-placeholder building
  // entries into a single static mesh, drawn once per frame against
  // a noise + horizontal-band material. Replaces the flat-beige
  // drawCube path for category-1 (building) entities.
  bootStage(BOOT_PROPS);
  const matBuilding = compileMaterialFromFile('assets/materials/building.wgsl', 'opaque');
  const BUILDING_PARAMS = [
    // SH-050 — base rgb is now a TINT on the concrete scan, not the wall colour.
    // The photoscan carries the colour; the old 0.72/0.66/0.55 sandstone
    // multiplied into it would darken the house by a third. Pushed WARM
    // (r > g > b) because concrete_wall_008 scans grey-green and the arena's
    // palette — and this building's own history — is warm sandstone. This tint
    // is what keeps a concrete wall from turning the plaza cold.
    // w = macro tone-variation strength (breaks up the 2 m tile).
    1.10, 1.02, 0.90,                   0.55,
    // band rgb (darker mortar line)    band tightness (higher = sharper)
    0.40, 0.34, 0.28,                   1.4,
    // noise_freq, band_period (m), WALL scan size (m), SLAB scan size (m).
    // The last two are real-world extents from Poly Haven's `dimensions` —
    // both sources are 2.0 m across — so each slice tiles at 1:1 physical
    // scale. They were dead fields before ("roof_dim, unused").
    0.50, 3.0,                          2.0,   2.0,
    // normal-map strength, reserved x3.
    1.0,  0.0, 0.0, 0.0,
  ];
  if (matBuilding > 0) setMaterialParams(matBuilding, BUILDING_PARAMS);

  // SH-050 — the building's photoscan slices. ORDER IS THE ABI: building.wgsl
  // indexes SLICE_WALL = 0, SLICE_SLAB = 1, and tools/build-building-textures.ts
  // emits them in that order.
  //
  // Bound BEFORE any further setMaterialParams on this material, matching the
  // order main.ts uses for terrain: engine EN-014 once had set_user_params
  // rebuild the bind group with the 1x1 stub array hardcoded, silently
  // unbinding the art. That is fixed, but binding first is still the honest
  // order.
  if (matBuilding > 0) {
    const bldgAlbedo = createTextureArrayFromFiles([
      'assets/textures/building_wall_albedo.png',
      'assets/textures/building_slab_albedo.png',
    ], TEX_ARRAY_FORMAT_SRGB, 4);
    // Normals and roughness MUST be linear — sRGB-decoding an encoded normal
    // corrupts it, and roughness is a measurement, not a colour.
    const bldgNormal = createTextureArrayFromFiles([
      'assets/textures/building_wall_normal.png',
      'assets/textures/building_slab_normal.png',
    ], TEX_ARRAY_FORMAT_LINEAR, 4);
    const bldgRough = createTextureArrayFromFiles([
      'assets/textures/building_wall_rough.png',
      'assets/textures/building_slab_rough.png',
    ], TEX_ARRAY_FORMAT_LINEAR, 4);
    if (bldgAlbedo > 0) {
      setMaterialTextureArray(matBuilding, TEXTURE_ARRAY_ALBEDO, bldgAlbedo);
      setMaterialTextureArray(matBuilding, TEXTURE_ARRAY_NORMAL, bldgNormal);
      // The MR slot is free here — unlike terrain, whose splat map lives in it.
      setMaterialTextureArray(matBuilding, TEXTURE_ARRAY_MR, bldgRough);
    } else {
      console.log('[building] textures missing - run: bun tools/build-building-textures.ts');
    }
  }
  
  // Count the building boxes first so we can size the arrays.
  let _bldgCount = 0;
  for (let i = 0; i < W.MESH_COUNT; i++) {
    const mi = W.MESH_MODEL_IDX[i];
    if (W.MODEL_IS_BOX[mi] === 1 && W.MESH_CATEGORY[i] === 1) _bldgCount++;
  }
  const _bvc = _bldgCount * 24;     // 24 verts per cube (4 per face Ã— 6 faces)
  const _bic = _bldgCount * 36;     // 36 indices per cube (2 tris Ã— 6 faces)
  const BUILDING_VERTS = new Array<number>(_bvc * 12);
  const BUILDING_INDS  = new Array<number>(_bic);
  {
    let vi = 0, ii = 0, vbase = 0;
    for (let i = 0; i < W.MESH_COUNT; i++) {
      const mi = W.MESH_MODEL_IDX[i];
      if (W.MODEL_IS_BOX[mi] !== 1 || W.MESH_CATEGORY[i] !== 1) continue;
      const cx = W.MESH_X[i], cy = W.MESH_Y[i], cz = W.MESH_Z[i];
      const hx = W.MESH_COLLIDER_HX[i];
      const hy = W.MESH_COLLIDER_HY[i];
      const hz = W.MESH_COLLIDER_HZ[i];
      const xn = cx - hx, xp = cx + hx;
      const yn = cy - hy, yp = cy + hy;
      const zn = cz - hz, zp = cz + hz;
      // Six faces, 4 verts each. Vertex layout: pos(3) normal(3)
      // color(4) uv(2) â€” colors all white, UVs unused (material
      // samples world XY/XZ/YZ).
      //
      // WINDING MATTERS: every quad below is CCW seen from OUTSIDE the box.
      // The four side faces used to be wound CW-from-outside, and because the
      // vertex NORMALS were still correct the lighting looked fine — but the
      // exterior wall quads were backface-culled (facades read as hollow from
      // the north/east) and the shadow pass never wrote wall depth, so the
      // house cast NO shadow and the sun's tree-dapple leaked straight onto
      // interior surfaces as if the masonry were glass. If you touch these,
      // re-check with the house-v2 north-side capture: solid facade + a
      // ground shadow pool NW of the house.
      // +X face (normal +X)
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0;
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1;
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1;
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0;
      // -X face
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0;
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1;
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1;
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0;
      // +Y face (top)
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0;
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0;
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1;
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1;
      // -Y face (bottom)
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0;
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0;
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1;
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1;
      // +Z face
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0;
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1;
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1;
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0;
      // -Z face
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0;
      BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1;
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1;
      BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0;
  
      // 36 indices: 6 faces Ã— 2 tris Ã— 3, CCW from outside.
      BUILDING_INDS[ii++] = vbase +  0; BUILDING_INDS[ii++] = vbase +  1; BUILDING_INDS[ii++] = vbase +  2;
      BUILDING_INDS[ii++] = vbase +  0; BUILDING_INDS[ii++] = vbase +  2; BUILDING_INDS[ii++] = vbase +  3;
      BUILDING_INDS[ii++] = vbase +  4; BUILDING_INDS[ii++] = vbase +  5; BUILDING_INDS[ii++] = vbase +  6;
      BUILDING_INDS[ii++] = vbase +  4; BUILDING_INDS[ii++] = vbase +  6; BUILDING_INDS[ii++] = vbase +  7;
      BUILDING_INDS[ii++] = vbase +  8; BUILDING_INDS[ii++] = vbase +  9; BUILDING_INDS[ii++] = vbase + 10;
      BUILDING_INDS[ii++] = vbase +  8; BUILDING_INDS[ii++] = vbase + 10; BUILDING_INDS[ii++] = vbase + 11;
      BUILDING_INDS[ii++] = vbase + 12; BUILDING_INDS[ii++] = vbase + 13; BUILDING_INDS[ii++] = vbase + 14;
      BUILDING_INDS[ii++] = vbase + 12; BUILDING_INDS[ii++] = vbase + 14; BUILDING_INDS[ii++] = vbase + 15;
      BUILDING_INDS[ii++] = vbase + 16; BUILDING_INDS[ii++] = vbase + 17; BUILDING_INDS[ii++] = vbase + 18;
      BUILDING_INDS[ii++] = vbase + 16; BUILDING_INDS[ii++] = vbase + 18; BUILDING_INDS[ii++] = vbase + 19;
      BUILDING_INDS[ii++] = vbase + 20; BUILDING_INDS[ii++] = vbase + 21; BUILDING_INDS[ii++] = vbase + 22;
      BUILDING_INDS[ii++] = vbase + 20; BUILDING_INDS[ii++] = vbase + 22; BUILDING_INDS[ii++] = vbase + 23;
      vbase += 24;
    }
  }
  const matBuildingMesh = createMeshExplicit(BUILDING_VERTS, _bvc, BUILDING_INDS, _bic);
  
  // ---- Phase 10 glass â€” second material consumer, proves the ABI works -----
  // Second material using the Phase 4b refractive path (scene-colour snapshot
  // at group 4). No Gerstner waves; flat normal, heavier Fresnel so edges
  // reflect the sky and the centre of the pane stays clearest. House v2 puts
  // the panes in the south upper-floor window openings (drawn from main's
  // world pass), sized to match the h_s_f1 openings the house generator
  // emits. Phase 10's acceptance criterion: no engine change between
  // Phase 9 and 10 â€” only TypeScript.

  const matGlass = compileMaterialFromFile(
    'assets/materials/glass.wgsl', 'refractive');

  // Glass pane mesh â€” a single quad on the XY plane, normal +Z, sized to the
  // f1 window openings (1.8m Ã— 1.4m, sill-relative: pane origin is the sill).
  // Subdivided 1Ã—1 (two triangles) because glass has no per-vertex
  // displacement; the shader runs entirely in fs_main.
  const GLASS_W = 1.8;   // metres along X â€” window opening width
  const GLASS_H = 1.4;   // metres along Y â€” window opening height
  const GLASS_VERTS: number[] = [
    // pos(3)         normal(3)   color(4)     uv(2)
    -GLASS_W*0.5, 0,        0,  0,0,1,  1,1,1,1,  0,0,
     GLASS_W*0.5, 0,        0,  0,0,1,  1,1,1,1,  1,0,
     GLASS_W*0.5, GLASS_H,  0,  0,0,1,  1,1,1,1,  1,1,
    -GLASS_W*0.5, GLASS_H,  0,  0,0,1,  1,1,1,1,  0,1,
  ];
  // CCW from +Z so the pane is front-facing when viewed from outside.
  const GLASS_INDS: number[] = [0, 1, 2, 0, 2, 3];
  const matGlassMesh = createMesh(GLASS_VERTS, GLASS_INDS);
  
  // ---- Muzzle flash â€” additive-bucket material (Bucket::Additive) ----------
  // First consumer of the additive blend path. Fragment fakes a
  // volumetric warm flash inside a unit cube via radial falloff from
  // local-space centre. Per-draw tint alpha carries the flash intensity.
  const matMuzzleFlash = compileMaterialFromFile(
    'assets/materials/muzzle_flash.wgsl', 'additive',
  );
  const matMuzzleFlashMesh = genMeshCube(1, 1, 1);

  // Publish the handles the rest of the game reads (ENV doc above).
  ENV.matWater = matWater;
  ENV.matWaterMesh = matWaterMesh;
  ENV.waterProbe = waterProbe;
  ENV.WATER_W = WATER_W;
  ENV.WATER_D = WATER_D;
  ENV.WATER_CX = WATER_CX;
  ENV.WATER_CZ = WATER_CZ;
  ENV.WATER_Y = WATER_Y;
  ENV.matGrass = matGrass;
  ENV.matGrassMesh = matGrassMesh;
  ENV.matGrassInstances = matGrassInstances;
  ENV.GRASS_INSTANCE_COUNT = GRASS_INSTANCE_COUNT;
  ENV.matBuilding = matBuilding;
  ENV.matBuildingMesh = matBuildingMesh;
  ENV.matGlass = matGlass;
  ENV.matGlassMesh = matGlassMesh;
  ENV.matMuzzleFlash = matMuzzleFlash;
  ENV.matMuzzleFlashMesh = matMuzzleFlashMesh;
}

/// gi_only scene-node proxies (see the block comment inside). Model
/// handles come as parameters — the model/forest loading still lives in
/// main.ts, and parameters avoid Perry's cross-module-state hazards.
export function initGiProxies(
  meshModelHandles: any[],
  treeVariants: any[],
  terrainPropIdx: number,
  treeGlbParts: number,
): void {
  // ---- GI proxies ------------------------------------------------------------
  // The world renders through the material system, which Lumen's inputs
  // (BLAS/TLAS, mesh cards, SDF clipmap) never see â€” so SSGI had no
  // off-screen geometry to bounce from. Register invisible scene-node
  // duplicates of the big static geometry, flagged gi_only: they feed the
  // GI stack but are skipped by the main render, reflections, and the sun
  // shadow pass (the material path casts those shadows itself). Node
  // colour approximates each material's mid albedo so bounce carries the
  // right hue.
  {
    // Terrain instance(s) from the world's static-mesh list.
    // loadModel/createMeshExplicit return Model OBJECTS â€” the scene attach
    // FFI wants the raw .handle number.
    for (let i = 0; i < W.MESH_COUNT; i++) {
      const mi = W.MESH_MODEL_IDX[i];
      if (mi === terrainPropIdx && W.MODEL_IS_BOX[mi] !== 1) {
        const n = createSceneNode();
        attachModelToNode(n, (meshModelHandles[mi] as any).handle, 0);
        setSceneNodeTrs(n, W.MESH_X[i], W.MESH_Y[i], W.MESH_Z[i], 0, W.MESH_SCALE[i]);
        setSceneNodeColor(n, 84, 116, 51);          // â‰ˆ grass_mid albedo
        setSceneNodeCastShadow(n, false);
        setSceneNodeGiOnly(n, true);
      }
    }
    // The generated building shell (drawn at origin, scale 1).
    if (ENV.matBuildingMesh.handle > 0) {
      const n = createSceneNode();
      attachModelToNode(n, ENV.matBuildingMesh.handle, 0);
      setSceneNodeTrs(n, 0, 0, 0, 0, 1);
      setSceneNodeColor(n, 214, 208, 196);          // plaster base
      setSceneNodeCastShadow(n, false);
      setSceneNodeGiOnly(n, true);
    }
    // Forest trees â€” every primitive of every placed tree. glTF materials
    // ride along through attachModelToNode, so trunks bounce brown and
    // canopies green without per-node colour overrides. (GI proxies are
    // unrotated â€” close enough for bounce lighting.)
    for (let i = 0; i < W.FOREST_COUNT; i++) {
      const v = treeVariants[W.FOREST_VAR[i]];
      for (let mIdx = 0; mIdx < treeGlbParts; mIdx++) {
        const n = createSceneNode();
        attachModelToNode(n, (v as any).handle, mIdx);
        setSceneNodeTrs(n, W.FOREST_X[i], W.FOREST_Y[i], W.FOREST_Z[i], 0, W.FOREST_SCALE[i]);
        setSceneNodeCastShadow(n, false);
        setSceneNodeGiOnly(n, true);
      }
    }
  }
}
