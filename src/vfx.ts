// SH-033 — combat VFX: particles + decals.
//
// Everything here rides EN-026/EN-027, so the game only ever *spawns*: the
// engine owns the pools, the sim and the GPU upload. A burst is one FFI call,
// not one per particle, which is why we can afford thousands of them.
//
// One particle system per look. That costs one draw call each, and it buys
// each effect its own texture, blend behaviour and pool budget — trying to
// share a pool between smoke and shell casings just means neither gets the
// physics it wants.

import { Model, createMesh, drawMeshWithMaterialInstanced, setMaterialParams } from 'bloom';
import { readFile } from 'bloom/core';
import {
  compileMaterialInstancedBucket,
  createTextureArrayFromFiles, setMaterialTextureArray,
  BUCKET_ADDITIVE, BUCKET_CUTOUT,
} from 'bloom/models';
import {
  createParticleSystem, emitParticles, updateParticles,
  particleInstanceBuffer, clearParticles, particleCount,
  initDecals, setDecalStyle, spawnDecal, updateDecals, clearDecals,
} from 'bloom/vfx';

// Texture-array layer indices. THE ORDER IS AN ABI — it must match the emit
// order in tools/build-vfx-textures.ts.
const PTEX_SMOKE = 0;
const PTEX_SPARK = 1;
const PTEX_DROP  = 2;
const PTEX_FLASH = 3;
const PTEX_DUST  = 4;
const PTEX_SHELL = 5;

export const DECAL_BULLET = 0;
export const DECAL_SCORCH = 1;
export const DECAL_SPLAT  = 2;
export const DECAL_CRATER = 3;

const TEXTURE_ARRAY_ALBEDO = 0;

// Systems, indexed by the SYS_* constants below. Flat arrays per Perry
// convention; `sysMat[i]` is the material that draws pool `sysId[i]`.
export const SYS_SMOKE  = 0;
export const SYS_SPARK  = 1;
export const SYS_BLOOD  = 2;
export const SYS_FLASH  = 3;
export const SYS_DUST   = 4;
export const SYS_SHELL  = 5;
export const SYS_TRACER = 6;
const SYS_COUNT = 7;

const sysId  = new Array<number>(SYS_COUNT);   // engine particle-system handles
const sysMat = new Array<number>(SYS_COUNT);   // material per system

let quadMesh: Model = null as any;
let decalMat = 0;
let decalIB = 0;
let ready = false;

/// One unit quad, centred. The particle shader billboards it against the view
/// and the decal shader orients it to a surface normal, so a single mesh backs
/// every VFX draw in the game.
function makeQuad(): Model {
  // 12 floats/vert: pos(3) nrm(3) col(4) uv(2)
  const v: number[] = [
    -0.5, -0.5, 0,  0, 0, 1,  1, 1, 1, 1,  0, 1,
     0.5, -0.5, 0,  0, 0, 1,  1, 1, 1, 1,  1, 1,
     0.5,  0.5, 0,  0, 0, 1,  1, 1, 1, 1,  1, 0,
    -0.5,  0.5, 0,  0, 0, 1,  1, 1, 1, 1,  0, 0,
  ];
  const i: number[] = [0, 1, 2, 0, 2, 3];
  return createMesh(v, i);
}

/// Compile one additive particle material bound to `layer` of the VFX array.
/// `intensity` pushes the additive result into HDR so bloom catches hot cores;
/// `softFade` is the depth-fade distance that stops a billboard showing a hard
/// seam where it cuts the ground.
function particleMaterial(src: string, arr: number, layer: number,
                          intensity: number, softFade: number): number {
  // readsScene = true: the soft-particle fade samples scene depth.
  const m = compileMaterialInstancedBucket(src, BUCKET_ADDITIVE, true);
  if (m > 0) {
    setMaterialTextureArray(m, TEXTURE_ARRAY_ALBEDO, arr);
    setMaterialParams(m, [layer, intensity, softFade, 0]);
  }
  return m;
}

/// Load shaders + textures, build the pools. Call once at startup.
/// Returns false if anything failed to compile — the game then simply runs
/// without VFX rather than crashing, which is the right failure mode for a
/// cosmetic system.
export function initVfx(): boolean {
  quadMesh = makeQuad();

  const pArr = createTextureArrayFromFiles([
    'assets/textures/vfx_smoke.png',
    'assets/textures/vfx_spark.png',
    'assets/textures/vfx_droplet.png',
    'assets/textures/vfx_flash.png',
    'assets/textures/vfx_dust.png',
    'assets/textures/vfx_shell.png',
  ]);
  const dArr = createTextureArrayFromFiles([
    'assets/textures/decal_bullet.png',
    'assets/textures/decal_scorch.png',
    'assets/textures/decal_splat.png',
    'assets/textures/decal_crater.png',
  ]);
  if (pArr === 0 || dArr === 0) return false;

  // Read the shader source once; both materials are compiled from the same
  // file with different params, so there is no inline-WGSL copy to drift
  // (SH-005's whole complaint).
  const pSrc = 'assets/materials/particle.wgsl';
  const dSrc = 'assets/materials/decal.wgsl';

  // --- particle materials (one per look) ---
  sysMat[SYS_SMOKE]  = particleMaterialFromFile(pSrc, pArr, PTEX_SMOKE, 0.9, 0.6);
  sysMat[SYS_SPARK]  = particleMaterialFromFile(pSrc, pArr, PTEX_SPARK, 6.0, 0.25);
  sysMat[SYS_BLOOD]  = particleMaterialFromFile(pSrc, pArr, PTEX_DROP,  1.1, 0.3);
  sysMat[SYS_FLASH]  = particleMaterialFromFile(pSrc, pArr, PTEX_FLASH, 9.0, 0.2);
  sysMat[SYS_DUST]   = particleMaterialFromFile(pSrc, pArr, PTEX_DUST,  0.8, 0.5);
  sysMat[SYS_SHELL]  = particleMaterialFromFile(pSrc, pArr, PTEX_SHELL, 1.4, 0.15);
  sysMat[SYS_TRACER] = particleMaterialFromFile(pSrc, pArr, PTEX_SPARK, 8.0, 0.2);
  for (let i = 0; i < SYS_COUNT; i++) {
    if (sysMat[i] === 0) return false;
  }

  // --- pools ---
  // Smoke: slow, buoyant, draggy, grows and thins. Grey-warm at birth so the
  // muzzle plume reads hot for a moment before it goes cold.
  sysId[SYS_SMOKE] = createParticleSystem(768, {
    life: 1.1, lifeVar: 0.35,
    speed: 1.4, speedVar: 0.7, spread: 0.55,
    gravity: 0.9,           // drifts UP: hot gas, not a rock
    drag: 2.2,
    size0: 0.10, size1: 0.55, sizeVar: 0.3,
    color0: [1.0, 0.92, 0.80, 0.55],
    color1: [0.45, 0.45, 0.48, 0.0],
    spin: 0.8, spinVar: 1.4,
    posJitter: 0.04,
  });

  // Sparks: fast, ballistic, short-lived, velocity-stretched into streaks.
  sysId[SYS_SPARK] = createParticleSystem(1024, {
    life: 0.35, lifeVar: 0.2,
    speed: 7.0, speedVar: 4.0, spread: 0.7,
    gravity: -16.0,
    drag: 1.5,
    size0: 0.06, size1: 0.01, sizeVar: 0.5,
    color0: [1.0, 0.85, 0.45, 1.0],
    color1: [1.0, 0.25, 0.05, 0.0],
    stretch: 0.035,         // -> tracer-ish streaks along travel
    posJitter: 0.02,
  });

  // Blood/ichor: heavy droplets, tinted per kind at emit time via the system's
  // colour (see emitBlood).
  sysId[SYS_BLOOD] = createParticleSystem(768, {
    life: 0.7, lifeVar: 0.25,
    speed: 3.2, speedVar: 2.2, spread: 0.9,
    gravity: -14.0,
    drag: 0.6,
    size0: 0.10, size1: 0.05, sizeVar: 0.6,
    color0: [0.55, 0.95, 0.35, 1.0],   // alien green; overridden per kind
    color1: [0.30, 0.55, 0.20, 0.0],
    posJitter: 0.06,
  });

  // Muzzle flash: a couple of big, instantaneous, very hot quads.
  sysId[SYS_FLASH] = createParticleSystem(64, {
    life: 0.05, lifeVar: 0.02,
    speed: 0.4, speedVar: 0.3, spread: 0.5,
    gravity: 0.0, drag: 6.0,
    size0: 0.42, size1: 0.16, sizeVar: 0.25,
    color0: [1.0, 0.93, 0.70, 1.0],
    color1: [1.0, 0.55, 0.15, 0.0],
    spin: 0.0, spinVar: 6.0,
  });

  // Dust: footfalls and impacts on ground. Wide, flat, slow.
  sysId[SYS_DUST] = createParticleSystem(768, {
    life: 0.8, lifeVar: 0.3,
    speed: 1.1, speedVar: 0.6, spread: 1.1,
    gravity: -1.2,
    drag: 3.0,
    size0: 0.12, size1: 0.5, sizeVar: 0.35,
    color0: [0.80, 0.75, 0.62, 0.40],
    color1: [0.75, 0.72, 0.62, 0.0],
    spin: 0.4, spinVar: 1.0,
    posJitter: 0.08,
  });

  // Shell casings: real little objects — they bounce and settle.
  sysId[SYS_SHELL] = createParticleSystem(64, {
    life: 3.0, lifeVar: 0.5,
    speed: 2.6, speedVar: 1.0, spread: 0.35,
    gravity: -20.0,
    drag: 0.15,
    size0: 0.045, size1: 0.045,
    color0: [1.0, 1.0, 1.0, 1.0],
    color1: [1.0, 1.0, 1.0, 1.0],   // no fade: they lie there, then vanish
    spin: 12.0, spinVar: 10.0,
    restitution: 0.35,               // clatter instead of sinking
  });

  // Tracers: one stretched streak per burst, fired along the shot.
  sysId[SYS_TRACER] = createParticleSystem(64, {
    life: 0.09, lifeVar: 0.02,
    speed: 120.0, speedVar: 10.0, spread: 0.01,
    gravity: 0.0, drag: 0.0,
    size0: 0.05, size1: 0.03,
    color0: [1.0, 0.9, 0.6, 1.0],
    color1: [1.0, 0.6, 0.2, 0.0],
    stretch: 0.02,
  });

  for (let i = 0; i < SYS_COUNT; i++) {
    if (sysId[i] === 0) return false;
  }

  // --- decals: one ring, one draw, layer per instance ---
  decalMat = compileMaterialInstancedBucket(readShader(dSrc), BUCKET_CUTOUT);
  if (decalMat === 0) return false;
  setMaterialTextureArray(decalMat, TEXTURE_ARRAY_ALBEDO, dArr);
  // cfg.y = alpha cutoff. 0.35 keeps the soft edges of a blood splat while
  // still discarding the quad's empty corners.
  setMaterialParams(decalMat, [0, 0.35, 0, 0]);
  decalIB = initDecals(192);

  ready = true;
  return true;
}

// compileMaterialInstancedBucket takes source, not a path (there is no
// from-file instanced variant), so the WGSL is read from disk once at startup.
// Reading it rather than inlining it is deliberate: the inline-copy pattern is
// exactly what SH-005 exists to kill, and it has already shipped wrong water
// once.
function readShader(path: string): string {
  return readFile(path);
}

function particleMaterialFromFile(path: string, arr: number, layer: number,
                                  intensity: number, softFade: number): number {
  return particleMaterial(readShader(path), arr, layer, intensity, softFade);
}

// ---- emit helpers -----------------------------------------------------------
// Each of these is one FFI call. Call them from gameplay code freely.

/// Rifle/blaster muzzle: flash + smoke + a shell.
export function emitMuzzle(x: number, y: number, z: number,
                           dx: number, dy: number, dz: number,
                           ejectX: number, ejectZ: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_FLASH], x, y, z, dx, dy, dz, 2);
  emitParticles(sysId[SYS_SMOKE], x, y, z, dx, dy, dz, 5);
  // Casing flies right and slightly back, not down the barrel.
  emitParticles(sysId[SYS_SHELL], x, y, z, ejectX, 0.6, ejectZ, 1);
}

/// A tracer streak down the shot line.
export function emitTracer(x: number, y: number, z: number,
                           dx: number, dy: number, dz: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_TRACER], x, y, z, dx, dy, dz, 1);
}

/// Bullet hitting hard surface: sparks + a puff of dust along the normal,
/// plus a bullet-hole decal.
export function emitImpactHard(x: number, y: number, z: number,
                               nx: number, ny: number, nz: number,
                               roll: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_SPARK], x, y, z, nx, ny, nz, 10);
  emitParticles(sysId[SYS_DUST],  x, y, z, nx, ny, nz, 4);
  setDecalStyle(DECAL_BULLET, 1, 1, 1, 1, 0, 0);   // permanent (ring recycles)
  spawnDecal(x, y, z, nx, ny, nz, 0.16, roll);
}

/// Bullet hitting an alien: a spray of ichor along the shot, plus a splat on
/// the ground beneath.
///
/// The particles keep one ichor colour while the DECAL takes the per-kind
/// tint. Particle colour is a property of the pool, so tinting per hit would
/// retro-recolour every droplet already in the air; the splat is per-instance
/// and can vary freely. In motion you read the colour off the splat anyway.
export function emitImpactFlesh(x: number, y: number, z: number,
                                dx: number, dy: number, dz: number,
                                r: number, g: number, b: number,
                                groundY: number, roll: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_BLOOD], x, y, z, dx, dy, dz, 12);
  setDecalStyle(DECAL_SPLAT, r, g, b, 0.85, 22, 6);   // fades over its last 6 s
  spawnDecal(x, groundY, z, 0, 1, 0, 0.5 + Math.random() * 0.35, roll);
}

/// Kill burst — bigger version of the above, no decal (the impact already
/// placed one).
export function emitDeathBurst(x: number, y: number, z: number,
                               r: number, g: number, b: number,
                               scale: number): void {
  if (!ready) return;
  const n = Math.floor(18 * scale);
  emitParticles(sysId[SYS_BLOOD], x, y, z, 0, 0, 0, n);
  emitParticles(sysId[SYS_SMOKE], x, y, z, 0, 1, 0, 3);
}

/// Explosion (lucifer cannon): flash core, fireball smoke, dirt, scorch mark.
export function emitExplosion(x: number, y: number, z: number, groundY: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_FLASH], x, y, z, 0, 0, 0, 6);
  emitParticles(sysId[SYS_SPARK], x, y, z, 0, 0, 0, 40);
  emitParticles(sysId[SYS_SMOKE], x, y, z, 0, 1, 0, 24);
  emitParticles(sysId[SYS_DUST],  x, groundY + 0.1, z, 0, 1, 0, 20);
  setDecalStyle(DECAL_SCORCH, 1, 1, 1, 0.9, 30, 8);
  spawnDecal(x, groundY, z, 0, 1, 0, 2.4, Math.random() * 6.28);
}

/// Footfall / landing puff.
export function emitFootDust(x: number, y: number, z: number, amount: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_DUST], x, y, z, 0, 1, 0, amount);
}

/// Water splash at an impact point.
export function emitSplash(x: number, y: number, z: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_BLOOD], x, y, z, 0, 1, 0, 6);
}

// ---- frame -----------------------------------------------------------------

/// Step every pool and draw it. One update + one draw per system; decals are
/// one more of each. Call once per frame inside the 3D pass.
export function updateAndDrawVfx(dt: number): void {
  if (!ready) return;
  for (let i = 0; i < SYS_COUNT; i++) {
    const live = updateParticles(sysId[i], dt);
    if (live > 0) {
      drawMeshWithMaterialInstanced(
        sysMat[i], quadMesh, 0, particleInstanceBuffer(sysId[i]), live);
    }
  }
  const dLive = updateDecals(dt);
  lastDecalLive = dLive;
  if (dLive > 0) {
    drawMeshWithMaterialInstanced(decalMat, quadMesh, 0, decalIB, dLive);
  }
}

/// Wipe every pool — used on run restart so last run's blood doesn't persist
/// into the new one.
export function resetVfx(): void {
  if (!ready) return;
  for (let i = 0; i < SYS_COUNT; i++) clearParticles(sysId[i]);
  clearDecals();
}

export function vfxReady(): boolean { return ready; }

// ---- diagnostics ------------------------------------------------------------
// Live counts, so a "the VFX aren't showing" bug can be split into "the sim
// isn't running" vs "the draw isn't landing" without guessing.
export function debugCount(sys: number): number {
  if (!ready) return -1;
  return particleCount(sysId[sys]);
}
export function debugDecals(): number { return lastDecalLive; }
/// Comma-joined material handles + the decal handle: a 0 anywhere means that
/// material failed to compile and its draw is silently doing nothing.
export function debugMats(): string {
  let s = '';
  for (let i = 0; i < SYS_COUNT; i++) {
    if (i > 0) s = s + '|';
    s = s + sysMat[i];
  }
  return s + '|d' + decalMat + '|ib' + decalIB + '|q' + (quadMesh === null ? 0 : 1);
}
let lastDecalLive = 0;
