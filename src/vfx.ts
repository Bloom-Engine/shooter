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
  BUCKET_ADDITIVE, BUCKET_CUTOUT, BUCKET_TRANSPARENT,
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
const PTEX_CHIP  = 6;   // tools/gen/vfx_flipbook.py (appended: the first six are build-vfx-textures.ts)

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
// Plan 5.3 / 5.6: one look per material and per event.
export const SYS_FIREBALL = 7;    // the explosion flipbook
export const SYS_EMBER    = 8;    // slow sparks that outlive the fireball
export const SYS_CHIP     = 9;    // masonry and rock chips
export const SYS_SPLINTER = 10;   // wood
export const SYS_CLOD     = 11;   // thrown earth
export const SYS_WATER    = 12;   // splash droplets
export const SYS_MIST     = 13;   // splash spray, acid fizz
export const SYS_TRAIL    = 14;   // what a projectile leaves behind it
export const SYS_ICHOR    = 15;   // an enemy bolt's green trail and burst
export const SYS_DSMOKE   = 16;   // the dark smoke an explosion leaves
const SYS_COUNT = 17;

// The alpha-blended pools are unlit, so they are drawn at the scene's own brightness: this is
// their colour multiplier, set once from the arena's time of day (setDaylight, before initVfx).
let DAY_LIT = 1.0;
/// 1 = noon, 0 = night. Call before initVfx.
export function setDaylight(day: number): void { DAY_LIT = 0.16 + 0.84 * day; }

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
                          intensity: number, softFade: number, grid: number): number {
  // readsScene = true: the soft-particle fade samples scene depth.
  // A negative intensity asks for the alpha-blended bucket (see particle.wgsl).
  const m = compileMaterialInstancedBucket(src, intensity < 0 ? BUCKET_TRANSPARENT : BUCKET_ADDITIVE, true);
  if (m > 0) {
    setMaterialTextureArray(m, TEXTURE_ARRAY_ALBEDO, arr);
    setMaterialParams(m, [layer, intensity, softFade, grid]);
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
    'assets/textures/vfx_chip.png',
  ]);
  // The fireball sheet is 2048 square and the rest are 512, so it is an array of its own.
  const xArr = createTextureArrayFromFiles(['assets/textures/vfx_explosion.png']);
  const dArr = createTextureArrayFromFiles([
    'assets/textures/decal_bullet.png',
    'assets/textures/decal_scorch.png',
    'assets/textures/decal_splat.png',
    'assets/textures/decal_crater.png',
  ]);
  if (pArr === 0 || dArr === 0 || xArr === 0) return false;

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
  sysMat[SYS_DUST]   = particleMaterialFromFile(pSrc, pArr, PTEX_DUST,  -DAY_LIT, 0.5);
  sysMat[SYS_SHELL]  = particleMaterialFromFile(pSrc, pArr, PTEX_SHELL, -DAY_LIT, 0.15);
  sysMat[SYS_TRACER] = particleMaterialFromFile(pSrc, pArr, PTEX_SPARK, 8.0, 0.2);
  sysMat[SYS_FIREBALL] = particleMaterial(readShader(pSrc), xArr, 0, 3.8, 0.9, 4);
  sysMat[SYS_EMBER]    = particleMaterialFromFile(pSrc, pArr, PTEX_SPARK, 5.0, 0.25);
  sysMat[SYS_CHIP]     = particleMaterialFromFile(pSrc, pArr, PTEX_CHIP,  -DAY_LIT, 0.1);
  sysMat[SYS_SPLINTER] = particleMaterialFromFile(pSrc, pArr, PTEX_CHIP,  -DAY_LIT, 0.1);
  sysMat[SYS_CLOD]     = particleMaterialFromFile(pSrc, pArr, PTEX_CHIP,  -DAY_LIT, 0.15);
  sysMat[SYS_DSMOKE]   = particleMaterialFromFile(pSrc, pArr, PTEX_SMOKE, -DAY_LIT, 0.8);
  sysMat[SYS_WATER]    = particleMaterialFromFile(pSrc, pArr, PTEX_DROP,  1.3, 0.2);
  sysMat[SYS_MIST]     = particleMaterialFromFile(pSrc, pArr, PTEX_SMOKE, 0.7, 0.5);
  sysMat[SYS_TRAIL]    = particleMaterialFromFile(pSrc, pArr, PTEX_SMOKE, 2.2, 0.3);
  sysMat[SYS_ICHOR]    = particleMaterialFromFile(pSrc, pArr, PTEX_SMOKE, 2.6, 0.3);
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
    color0: [1.0, 0.92, 0.80, 0.34],
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
    size0: 0.14, size1: 0.6, sizeVar: 0.35,
    color0: [0.62, 0.54, 0.42, 0.50],
    color1: [0.62, 0.56, 0.46, 0.0],
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

  // --- plan 5.3 / 5.6 pools ---
  // Fireball: a few big cards, each playing the sixteen-frame sheet once. They barely move:
  // the motion is in the frames.
  sysId[SYS_FIREBALL] = createParticleSystem(48, {
    life: 0.85, lifeVar: 0.2,
    speed: 0.9, speedVar: 0.6, spread: 3.2,
    gravity: 0.8, drag: 2.5,
    size0: 2.2, size1: 4.8, sizeVar: 0.3,
    color0: [1.0, 1.0, 1.0, 1.0],
    color1: [1.0, 0.9, 0.8, 0.0],
    spin: 0.0, spinVar: 0.5,
    posJitter: 0.35,
  });
  // Embers: thrown high, fall slowly, glow for a second and a half.
  sysId[SYS_EMBER] = createParticleSystem(512, {
    life: 1.3, lifeVar: 0.6,
    speed: 9.0, speedVar: 5.0, spread: 3.2,
    gravity: -7.0, drag: 1.1,
    size0: 0.07, size1: 0.02, sizeVar: 0.5,
    color0: [1.0, 0.75, 0.35, 1.0],
    color1: [1.0, 0.2, 0.03, 0.0],
    stretch: 0.02,
    posJitter: 0.2,
  });
  // Chips: pale, angular, ballistic, they bounce once.
  sysId[SYS_CHIP] = createParticleSystem(512, {
    life: 0.9, lifeVar: 0.4,
    speed: 4.5, speedVar: 3.0, spread: 0.9,
    gravity: -18.0, drag: 0.4,
    size0: 0.075, size1: 0.06, sizeVar: 0.7,
    color0: [0.66, 0.62, 0.57, 1.0],
    color1: [0.60, 0.56, 0.52, 0.0],
    spin: 9.0, spinVar: 9.0,
    restitution: 0.3,
    posJitter: 0.03,
  });
  // Splinters: longer, lighter, slower to fall.
  sysId[SYS_SPLINTER] = createParticleSystem(384, {
    life: 0.8, lifeVar: 0.3,
    speed: 3.6, speedVar: 2.4, spread: 0.8,
    gravity: -11.0, drag: 1.2,
    size0: 0.085, size1: 0.07, sizeVar: 0.8,
    color0: [0.78, 0.60, 0.36, 1.0],
    color1: [0.66, 0.50, 0.30, 0.0],
    spin: 7.0, spinVar: 8.0,
    stretch: 0.012,
    posJitter: 0.03,
  });
  // Clods: earth thrown up by a round or a blast.
  sysId[SYS_CLOD] = createParticleSystem(512, {
    life: 0.8, lifeVar: 0.35,
    speed: 4.0, speedVar: 2.8, spread: 0.8,
    gravity: -17.0, drag: 0.5,
    size0: 0.10, size1: 0.07, sizeVar: 0.8,
    color0: [0.26, 0.19, 0.12, 1.0],
    color1: [0.24, 0.18, 0.12, 0.0],
    spin: 5.0, spinVar: 6.0,
    posJitter: 0.05,
  });
  // Water: a crown of droplets, and the spray that hangs after it.
  sysId[SYS_WATER] = createParticleSystem(512, {
    life: 0.65, lifeVar: 0.25,
    speed: 4.2, speedVar: 2.4, spread: 0.6,
    gravity: -15.0, drag: 0.5,
    size0: 0.07, size1: 0.03, sizeVar: 0.6,
    color0: [0.85, 0.93, 1.0, 0.9],
    color1: [0.75, 0.88, 1.0, 0.0],
    stretch: 0.02,
    posJitter: 0.08,
  });
  sysId[SYS_MIST] = createParticleSystem(256, {
    life: 0.7, lifeVar: 0.25,
    speed: 1.2, speedVar: 0.8, spread: 1.0,
    gravity: -0.6, drag: 2.5,
    size0: 0.18, size1: 0.7, sizeVar: 0.3,
    color0: [0.85, 0.92, 1.0, 0.35],
    color1: [0.85, 0.92, 1.0, 0.0],
    spin: 0.3, spinVar: 0.8,
    posJitter: 0.1,
  });
  // Trail: dropped where the projectile is, it stays there and fades.
  sysId[SYS_TRAIL] = createParticleSystem(512, {
    life: 0.32, lifeVar: 0.08,
    speed: 0.15, speedVar: 0.15, spread: 3.2,
    gravity: 0.3, drag: 3.0,
    size0: 0.16, size1: 0.34, sizeVar: 0.25,
    color0: [1.0, 0.72, 0.38, 0.7],
    color1: [0.8, 0.35, 0.15, 0.0],
    spin: 0.5, spinVar: 2.0,
    posJitter: 0.02,
  });
  sysId[SYS_ICHOR] = createParticleSystem(512, {
    life: 0.36, lifeVar: 0.1,
    speed: 0.3, speedVar: 0.3, spread: 3.2,
    gravity: -0.8, drag: 2.5,
    size0: 0.18, size1: 0.36, sizeVar: 0.3,
    color0: [0.55, 1.0, 0.30, 0.75],
    color1: [0.25, 0.7, 0.12, 0.0],
    spin: 0.5, spinVar: 2.0,
    posJitter: 0.03,
  });

  // Dark smoke: what is left standing where something blew up. Alpha-blended, so it can
  // be darker than the sky behind it.
  sysId[SYS_DSMOKE] = createParticleSystem(256, {
    life: 2.6, lifeVar: 0.8,
    speed: 1.6, speedVar: 1.0, spread: 1.2,
    gravity: 0.9, drag: 1.1,
    size0: 0.9, size1: 3.4, sizeVar: 0.35,
    color0: [0.20, 0.18, 0.17, 0.62],
    color1: [0.34, 0.33, 0.33, 0.0],
    spin: 0.25, spinVar: 0.6,
    posJitter: 0.5,
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
  return particleMaterial(readShader(path), arr, layer, intensity, softFade, 0);
}

// ---- emit helpers -----------------------------------------------------------
// Each of these is one FFI call. Call them from gameplay code freely.

/// Rifle/blaster muzzle: flash + smoke + a shell.
export function emitMuzzle(x: number, y: number, z: number,
                           dx: number, dy: number, dz: number,
                           ejectX: number, ejectZ: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_FLASH], x, y, z, dx, dy, dz, 2);
  // Two puffs a shot, not five: nobody could see the smoke until the depth fade was fixed
  // (2026-11-15), and at five a rifle on full auto hid the Trooper's head in a white ball.
  emitParticles(sysId[SYS_SMOKE], x, y, z, dx, dy, dz, 2);
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

/// Explosion: the fireball sheet, a white core, embers that outlive it, smoke, thrown earth
/// and chips, a scorch mark. (The light is sfx.ts: a point light has to be re-added every frame.)
export function emitExplosion(x: number, y: number, z: number, groundY: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_FIREBALL], x, y + 0.5, z, 0, 1, 0, 5);
  emitParticles(sysId[SYS_FLASH], x, y + 0.3, z, 0, 0, 0, 4);
  emitParticles(sysId[SYS_SPARK], x, y, z, 0, 0, 0, 30);
  emitParticles(sysId[SYS_EMBER], x, y + 0.3, z, 0, 1, 0, 36);
  emitParticles(sysId[SYS_SMOKE], x, y + 0.6, z, 0, 1, 0, 10);
  emitParticles(sysId[SYS_DSMOKE], x, y + 0.8, z, 0, 1, 0, 14);
  emitParticles(sysId[SYS_DUST],  x, groundY + 0.1, z, 0, 1, 0, 20);
  emitParticles(sysId[SYS_CLOD],  x, groundY + 0.15, z, 0, 1, 0, 26);
  emitParticles(sysId[SYS_CHIP],  x, groundY + 0.15, z, 0, 1, 0, 12);
  setDecalStyle(DECAL_SCORCH, 1, 1, 1, 0.9, 30, 8);
  spawnDecal(x, groundY, z, 0, 1, 0, 2.4, Math.random() * 6.28);
}

// Surface materials (plan 5.3). sfx.ts classifies a hit point; the numbers are shared.
export const MAT_DIRT  = 0;
export const MAT_WOOD  = 1;
export const MAT_STONE = 2;
export const MAT_METAL = 3;
export const MAT_WATER = 4;

/// A round hitting the world, by what it hit. Stone and metal keep the bullet hole and the
/// sparks; earth throws clods and dust and takes a hole; wood throws splinters; water takes
/// nothing and throws a crown.
export function emitImpactMat(mat: number, x: number, y: number, z: number,
                              nx: number, ny: number, nz: number, roll: number): void {
  if (!ready) return;
  if (mat === MAT_WATER) {
    emitParticles(sysId[SYS_WATER], x, y, z, 0, 1, 0, 9);
    emitParticles(sysId[SYS_MIST],  x, y + 0.05, z, 0, 1, 0, 3);
    return;
  }
  if (mat === MAT_DIRT) {
    emitParticles(sysId[SYS_CLOD], x, y, z, nx, ny, nz, 7);
    emitParticles(sysId[SYS_DUST], x, y, z, nx, ny, nz, 5);
  } else if (mat === MAT_WOOD) {
    emitParticles(sysId[SYS_SPLINTER], x, y, z, nx, ny, nz, 9);
    emitParticles(sysId[SYS_DUST], x, y, z, nx, ny, nz, 2);
  } else if (mat === MAT_METAL) {
    emitParticles(sysId[SYS_SPARK], x, y, z, nx, ny, nz, 16);
  } else {
    emitParticles(sysId[SYS_CHIP],  x, y, z, nx, ny, nz, 7);
    emitParticles(sysId[SYS_SPARK], x, y, z, nx, ny, nz, 4);
    emitParticles(sysId[SYS_DUST],  x, y, z, nx, ny, nz, 4);
  }
  setDecalStyle(DECAL_BULLET, 1, 1, 1, 1, 0, 0);
  spawnDecal(x, y, z, nx, ny, nz, 0.16, roll);
}

/// A creature coming up out of the ground: a ring of thrown earth and a dust column.
export function emitSpawn(x: number, y: number, z: number, scale: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_CLOD], x, y + 0.1, z, 0, 1, 0, Math.floor(14 * scale));
  emitParticles(sysId[SYS_DUST], x, y + 0.15, z, 0, 1, 0, Math.floor(10 * scale));
  emitParticles(sysId[SYS_SMOKE], x, y + 0.3, z, 0, 1, 0, 3);
}

/// One frame of a projectile's trail. `kind` 0 = the player's (hot), 1 = a creature's (ichor).
export function emitTrail(kind: number, x: number, y: number, z: number): void {
  if (!ready) return;
  emitParticles(sysId[kind === 1 ? SYS_ICHOR : SYS_TRAIL], x, y, z, 0, 0, 0, 1);
}

/// A creature's bolt landing: a green burst and a fizz.
export function emitAcid(x: number, y: number, z: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_ICHOR], x, y, z, 0, 1, 0, 8);
  emitParticles(sysId[SYS_MIST],  x, y + 0.05, z, 0, 1, 0, 3);
  emitParticles(sysId[SYS_BLOOD], x, y, z, 0, 1, 0, 6);
}

/// The boss's slam: a ring of earth and dust at `r` metres, sixteen points round.
export function emitShockRing(x: number, y: number, z: number, r: number): void {
  if (!ready) return;
  for (let i = 0; i < 16; i++) {
    const a = i * 0.3927;
    const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
    emitParticles(sysId[SYS_CLOD], cx, y + 0.1, cz, Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4, 4);
    emitParticles(sysId[SYS_DUST], cx, y + 0.1, cz, Math.cos(a), 0.4, Math.sin(a), 3);
  }
}

/// Footfall / landing puff.
export function emitFootDust(x: number, y: number, z: number, amount: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_DUST], x, y, z, 0, 1, 0, amount);
}

/// Water splash at an impact point.
export function emitSplash(x: number, y: number, z: number): void {
  if (!ready) return;
  emitParticles(sysId[SYS_WATER], x, y, z, 0, 1, 0, 8);
  emitParticles(sysId[SYS_MIST],  x, y + 0.05, z, 0, 1, 0, 2);
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
