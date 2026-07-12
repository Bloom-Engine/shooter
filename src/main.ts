import {
  initWindow, windowShouldClose, beginDrawing, endDrawing, clearBackground,
  setTargetFPS, getDeltaTime, getFPS, getTime,
  beginMode3D, endMode3D,
  drawCube, drawSphere, drawText, drawRect, drawCircle, measureText,
  setAmbientLight, setDirectionalLight, setEnvClearFromHdr,
  getScreenWidth, getScreenHeight,
  vec3,
  isKeyPressed, Key, Vec3, injectKeyDown, injectKeyUp, isAnyInputPressed,
  disableCursor, enableCursor, takeScreenshot,
  endMode2D,
  loadModel, drawModel, drawModelRotated, getModelBounds, loadModelAnimation, updateModelAnimation,
  createMesh, createMeshExplicit, genMeshCube,
  drawMeshWithMaterial,
  compileMaterialInstanced, createInstanceBuffer, drawMeshWithMaterialInstanced,
  initAudio, loadSound, playSound, setSoundVolume, playSound3D, setListenerPosition,
  loadMusic, playMusic, stopMusic, updateMusicStream, setMusicVolume,
  setProfilerEnabled, getProfilerOverlay, getProfilerFrameHistory,
  splatImpulse, setMaterialParams,
  compileMaterialFromFile, loadMaterial,
  createPlanarReflection, setMaterialReflectionProbe, setMaterialProbeVisible,
} from 'bloom';
import {
  // Raw-primitive variant of beginMode2D: the object-taking one isn't worth the
  // risk on a per-frame FFI path (perry-quirks #2), and only this one is
  // exported from bloom/core anyway.
  beginMode2DRaw,
  setVignette, setFilmGrain,
  setEnvIntensity, setAutoExposure, setAutoExposureKey, setFog, setSunShafts, setWind,
  setTaaEnabled, setRenderScale,
  setPresentMode, setSsgiEnabled, setSsaoEnabled, setSsrEnabled,
  setShadowsEnabled, setBloomEnabled, setShadowsAlwaysFresh,
  setManualExposure, gamepadRumble, readFile,
} from 'bloom/core';
import {
  addPointLight, enableShadows,
  createSceneNode, attachModelToNode, setSceneNodeTrs,
  setSceneNodeGiOnly, setSceneNodeCastShadow, setSceneNodeColor,
} from 'bloom/scene';
import {
  createWorld, step as stepPhysics,
  boxShape, heightfieldShape, createBody, MotionType, Layer,
  setLayerCollides, raycast, ALL_LAYERS_MASK, BodyHandle,
  setBodyPosition,
} from 'bloom/physics';
import {
  animPlay, animSetLayer, animUpdate, animFinished, animClipDuration,
  findJoint, jointWorld,
  createTextureArrayFromFiles, setMaterialTextureArray,
  TEXTURE_ARRAY_ALBEDO, TEXTURE_ARRAY_NORMAL, TEXTURE_ARRAY_MR,
  TEX_ARRAY_FORMAT_SRGB, TEX_ARRAY_FORMAT_LINEAR,
} from 'bloom/models';
import { initInput, readInput, drawTouchControls, MOBILE, aimAssistScale } from './input';
import {
  createPlayer, updatePlayerController, playerPosition,
  playerGrounded, playerSpeed, startDodge, isDodging, dodgeCooldownFrac,
} from './player';
import * as W from './world-runtime';
// --- AAA round: feel, VFX, weapons, audio mix, settings, score ---------------
import * as FEEL from './feel';
import * as VFX from './vfx';
import * as WPN from './weapons';
import * as MIX from './audio-mix';
import * as SET from './settings';
import * as SCORE from './score';
import { initMenus, menuOpen, openPause, closeMenu, updateMenu, drawMenu, MENU_NONE } from './menu';
// Terrain comes from the same world file as everything else now; `T` is kept as
// an alias so the height-sampling call sites read the same as they always have.
import * as T from './world-runtime';
import { terrainHeightAt } from './terrain';

// Borderless fullscreen at the monitor's native resolution (the engine
// resizes its swapchain + all render targets on the WM_SIZE this triggers).
// The 1024Ã—640 size is the windowed-mode fallback the engine restores to.
initWindow(1024, 640, 'Bloom Shooter', true);
setTargetFPS(60);
initInput();

// SH-037 â€” settings must load BEFORE anything reads them (input sensitivity,
// audio volumes, FOV, shake). A missing file is a first run, not an error.
SET.loadSettings();
FEEL.setShakeScale(SET.get(SET.SET_SHAKE));
initMenus();

// ---- M8 polish: audio -----------------------------------------------------
initAudio();
const sfxFire = loadSound('assets/sounds/rifle_fire.wav');
const sfxAttack = loadSound('assets/sounds/dretch_attack.wav');
const sfxPickup = loadSound('assets/sounds/pickup.wav');
setSoundVolume(sfxFire, 0.35);
setSoundVolume(sfxAttack, 0.6);
setSoundVolume(sfxPickup, 0.8);
// Round-7 audio (see assets/sounds/SOURCES.md): Sonniss weapon/water
// shots + the aliens' ORIGINAL Unvanquished vocals (same GPL asset
// line as the models). Alien deaths/attacks/pain play positionally via
// playSound3D; the listener follows the camera every frame.
const sfxFireRifle   = loadSound('assets/sounds/rifle_fire2.wav');
const sfxFireBlaster = loadSound('assets/sounds/blaster_fire.wav');
setSoundVolume(sfxFireRifle, 0.40);
setSoundVolume(sfxFireBlaster, 0.45);
const sfxImpactFlesh = loadSound('assets/sounds/impact_flesh.wav');
setSoundVolume(sfxImpactFlesh, 0.45);
const sfxRicochet = [loadSound('assets/sounds/ricochet1.wav'),
                     loadSound('assets/sounds/ricochet2.wav')];
setSoundVolume(sfxRicochet[0], 0.25);
setSoundVolume(sfxRicochet[1], 0.25);
const sfxSplash = loadSound('assets/sounds/splash1.wav');
setSoundVolume(sfxSplash, 0.30);
const sfxPlayerPain = [loadSound('assets/sounds/player_pain1.wav'),
                       loadSound('assets/sounds/player_pain2.wav')];
setSoundVolume(sfxPlayerPain[0], 0.65);
setSoundVolume(sfxPlayerPain[1], 0.65);
const sfxPlayerDie = [loadSound('assets/sounds/player_die1.wav'),
                      loadSound('assets/sounds/player_die2.wav')];
setSoundVolume(sfxPlayerDie[0], 0.8);
setSoundVolume(sfxPlayerDie[1], 0.8);
// Per-kind alien vocals, kind order matches KIND_NAME (0=dretch ..
// 4=tyrant = Unvanquished level0..level4). Flat arrays, index
// kind*3+variant for deaths (Perry convention).
const sfxAlienDie: any[] = new Array(15);
const sfxAlienAttack: any[] = new Array(5);
const sfxAlienPain: any[] = new Array(5);
for (let k = 0; k < 5; k++) {
  for (let v = 0; v < 3; v++) {
    const s = loadSound('assets/sounds/alien' + k + '_die' + (v + 1) + '.wav');
    setSoundVolume(s, 0.75);
    sfxAlienDie[k * 3 + v] = s;
  }
  const a = loadSound('assets/sounds/alien' + k + '_attack.wav');
  setSoundVolume(a, 0.55);
  sfxAlienAttack[k] = a;
  const p = loadSound('assets/sounds/alien' + k + '_pain.wav');
  setSoundVolume(p, 0.40);
  sfxAlienPain[k] = p;
}
// Two tracks from the 2026-07-03 asset drop: menu.wav on the title screen,
// game.wav once play starts (see the gameState transition in the loop).
// The old ambient.ogg loop stays in the repo as a fallback.
const musicMenu = loadMusic('assets/sounds/menu.wav');
const musicAmbient = loadMusic('assets/sounds/game.wav');
setMusicVolume(musicMenu, 0.4);
setMusicVolume(musicAmbient, 0.35);
playMusic(musicMenu);

const physics = createWorld({ gravity: vec3(0, -20, 0) });
// Make NON_MOVING (static) and MOVING (character/dynamic) collide.
setLayerCollides(physics, Layer.NON_MOVING, Layer.MOVING, true);
setLayerCollides(physics, Layer.MOVING, Layer.MOVING, true);

// ---- World: arena_02 (loaded at runtime; see src/world-runtime.ts) --------
// Authored in assets/worlds/arena_02.world.json; flat-array TS module is
// read from assets/worlds/arena_02.world.json at startup. All geometry,
// lighting, spawners, pickups, and the wave plan come from that world data.
// The editor can read/write the same JSON â†’ one source of truth.

const spawnPos: Vec3 = vec3(W.SPAWN_X, W.SPAWN_Y, W.SPAWN_Z);
const spawnYaw = W.SPAWN_YAW;

// Apply environment settings from the world file. Tier-1 visual
// quality work (see docs/visual-quality.md) layers IBL + shadows +
// fog + auto-exposure on top of the existing ambient + sun.
setAmbientLight(
  { r: Math.floor(W.ENV_AMBIENT_R * 255), g: Math.floor(W.ENV_AMBIENT_G * 255),
    b: Math.floor(W.ENV_AMBIENT_B * 255), a: 255 },
  W.ENV_AMBIENT_I);
setDirectionalLight(
  vec3(W.ENV_SUN_DIR_X, W.ENV_SUN_DIR_Y, W.ENV_SUN_DIR_Z),
  { r: Math.floor(W.ENV_SUN_R * 255), g: Math.floor(W.ENV_SUN_G * 255),
    b: Math.floor(W.ENV_SUN_B * 255), a: 255 },
  W.ENV_SUN_I);

// Tier 1.1 â€” load an HDR equirectangular environment. The engine
// convolves it into env_tex (specular) + env_diffuse_tex (ambient
// diffuse) at load time; refractive water + glass automatically
// pick it up via sample_env(). With nothing loaded the env binds
// are 1Ã—1 black and PBR specular is dead.
setEnvClearFromHdr('assets/env/outdoor.hdr');
// Tier 1.2 â€” IBL strength. 1.0 = unit; bump up if the scene reads
// dim against the new HDR sky, pull back if it blows out.
setEnvIntensity(1.0);
// Tier 1.3 â€” three-cascade sun shadows. Adds ~3 ms of GPU work
// but grounds every object visually.
enableShadows();
// Tier 1.4 â€” auto-exposure. The HDR pipeline tonemaps to surface
// sRGB with a fixed exposure if this is off; auto follows scene
// luminance which is the right behaviour outdoors. The engine's
// histogram AE targets the key value below â€” tuned against the
// IBL-fill material lighting: 0.18 washed the stone to white before
// the materials sampled real irradiance, 0.12 went moody-dark after.
setAutoExposure(true);
setAutoExposureKey(0.155);
// Tier 1.5 â€” pale-blue distance haze. r,g,b,density,heightRef,
// heightFalloff. Density 0.012 reads as a soft far-plane haze
// without dimming the foreground.
// Pale-blue distance haze. Density ramps up at ground level and
// clears within ~10 m above, so river dips and tree-base shadows
// pool low fog while ridges stay clear â€” adds depth without
// muddying the whole frame.
// Round-2 (audit F2): heightRef sat exactly at water level (yâ‰ˆ0), so a
// grazing look along the river integrated the densest fog slab for the
// full valley length â€” the visible "milk band" hugged the waterline and
// spilled over the banks. Drop the reference below ground and thin the
// density: low pooling survives, the white sheet does not.
setFog(0.78, 0.84, 0.90, 0.016, -0.6, 6.0);
// Tier 1.7 â€” warm god-rays through the trees. Round-2 retune (audit F3):
// at 0.4/0.96 the 32-tap shaft march added up to ~+0.14 HDR of warm veil
// on every sunward silhouette â€” a big share of the "pale backlit
// treeline". 0.18/0.90 keeps the god-ray read without the wash.
setSunShafts(0.18, 0.90, 1.0, 0.95, 0.7);
// EN-013 â€” global wind UBO. All foliage materials (grass, trees,
// future ferns/clovers) read these values from PerFrame.wind so
// one source of truth drives the whole scene's swing.
//   dirX / dirZ â€” wind direction in the XZ plane (need not be unit)
//   amp         â€” peak displacement at full tip weight (~0.10 m for grass)
//   freq        â€” Hz; ~1 = lazy breeze, ~3 = gusty
setWind(0.85, 0.50, 0.10, 1.6);
// TAA + TSR reconstruction. Setting the scale explicitly opts out of the
// legacy TAA coupling (which would otherwise silently halve the internal
// resolution). 0.5 at 4K output = 1920Ã—1080 internal, reconstructed to
// native by the TSR upscale inside the TAA pass â€” the pixel-bound passes
// (material/G-buffer/GTAO/SSR/SSGI) run at quarter cost while the output
// (and the HUD) stays native-sharp. Measured on the 4K dev box: ~20 fps at
// native internal vs ~45 fps here, with the composite sharpen covering the
// reconstruction softness.
setTaaEnabled(true);
setRenderScale(0.5);
// 2026-07-06 fullscreen-lag investigation: the Lumen SW-GI camera-follow
// bakes (SDF clipmap + WSRC) used to re-run as single full-volume
// dispatches whenever the view moved â€” a 1-2.4 s GPU stall every ~5 s of
// mouse-look on the 760M. The engine now amortizes both (binned + sliced
// clipmap bake into a staging volume, one WSRC cascade per frame), so
// SSGI stays enabled.

// ---- Mobile render budget --------------------------------------------------
// Everything above is tuned for a discrete desktop GPU. A phone is a tile-based
// deferred GPU on a battery: the screen-space passes are the expensive part, and
// they're the ones that scale worst. Cut the three that cost the most per pixel
// and keep the two that carry most of the look (sun shadows and bloom).
//
// Lumen SW-GI is the big one â€” it re-bakes an SDF clipmap as the view moves,
// which is a GPU stall the phone has no headroom to absorb. SSR goes with it.
//
// GTAO stays ON. It was cut with the other two at first, but measured on an
// iPhone 16 Pro it doesn't cost a frame-rate tier: mid-wave the frame sits at
// 25.0 ms either way (the same ~40 fps), and the title screen holds 60. It buys
// back the contact shadows that seat the grass, trees and aliens on the ground
// instead of leaving them looking pasted over it â€” the cheapest of the three
// screen-space passes by some margin, and the one with the best return.
//
// Read that "free" precisely, though: present mode is Fifo on a 120 Hz panel,
// so every frame snaps to a multiple of 8.33 ms and GTAO is being absorbed by
// slack inside a bucket rather than costing nothing. It eats margin. If a
// heavier wave starts tipping frames from the 25 ms bucket into the 33 ms one,
// this is the first thing to put back. (Per-pass GPU timings would settle it,
// but the profiler reports -1 on iOS â€” the Metal backend doesn't get
// TIMESTAMP_QUERY â€” so wall-clock at a fixed point in the wave is the honest
// instrument here.)
//
// Render scale stays at 0.5 (TSR reconstructs to native in the TAA pass), which
// on a 2622x1206 iPhone means a ~1311x603 internal buffer â€” the same
// pixel-bound cost as a 720p desktop frame.
if (MOBILE) {
  setSsgiEnabled(false);
  setSsrEnabled(false);
  setSsaoEnabled(true);
  setShadowsEnabled(true);
  setBloomEnabled(true);
  setTaaEnabled(true);
  setRenderScale(0.5);
  // Sun shafts are a full-screen radial blur â€” pure cost for a pass the player
  // only sees when looking near the sun. Strength 0 is off.
  setSunShafts(0, 0.90, 1.0, 0.95, 0.7);
}

// Static box colliders â€” invisible physics walls that bound the plaza
// and carry the ground plane.
for (let i = 0; i < W.COLLIDER_COUNT; i++) {
  const shape = boxShape(vec3(W.COLLIDER_HALF_X[i], W.COLLIDER_HALF_Y[i], W.COLLIDER_HALF_Z[i]));
  createBody(physics, shape, {
    motionType: MotionType.STATIC,
    position: vec3(W.COLLIDER_X[i], W.COLLIDER_Y[i], W.COLLIDER_Z[i]),
    objectLayer: Layer.NON_MOVING,
    friction: 0.9,
  });
}

// Heightfield terrain collider â€” matches assets/models/terrain_hills.glb.
// Samples in TERRAIN_HEIGHTS are row-major z*width+x; engine's heightfield
// shape takes an origin + scale (cellSize in X/Z, Y=1 since the heights
// are already in world units) and builds a Jolt HeightFieldShape.
{
  const shape = heightfieldShape(
    T.TERRAIN_HEIGHTS, T.TERRAIN_SAMPLE_COUNT,
    vec3(T.TERRAIN_ORIGIN_X, T.TERRAIN_ORIGIN_Y, T.TERRAIN_ORIGIN_Z),
    vec3(T.TERRAIN_CELL_SIZE, 1, T.TERRAIN_CELL_SIZE));
  createBody(physics, shape, {
    motionType: MotionType.STATIC,
    position: vec3(0, 0, 0),
    objectLayer: Layer.NON_MOVING,
    friction: 0.95,
  });
}

// Drawable meshes: each static_mesh entity references a modelRef via
// MESH_MODEL_IDX â†’ UNIQUE_MODELS. Real GLBs are loaded once here and
// drawn via drawModel each frame. Box-placeholder entries (modelRef
// `_gizmo_box.glb`) get a coloured drawCube fallback at draw time,
// tinted by category (0 = generic, 1 = building stone, 2 = terrain
// green, 3 = prop brown).
const MESH_TINT_R = [150, 196, 120, 130];
const MESH_TINT_G = [148, 168,  90,  95];
const MESH_TINT_B = [140, 130,  70,  80];
const meshModelHandles = new Array<number>(W.UNIQUE_MODEL_COUNT);
for (let i = 0; i < W.UNIQUE_MODEL_COUNT; i++) {
  meshModelHandles[i] = W.MODEL_IS_BOX[i] === 1 ? 0 : loadModel(W.UNIQUE_MODELS[i]);
}
// Round-4 (de-cartoonification) â€” the Kenney low-poly gumdrops were the
// single biggest "toy world" signal: flat-shaded solid-colour polyhedra.
// Back to the PUBG-style leaf-card trees (bark-textured tapered trunk +
// alpha-cutout leaf-card canopy). Drawn through the cached-model scene
// shader, which gives them wind sway, backlit leaf transmission and
// dappled cutout shadows for free â€” and they show up in the water's
// planar reflection (cached models render into the probe). Three GLB
// variants (normal / tall-narrow / short-wide) from build-props.ts.
const treeVariants = [
  loadModel('assets/models/prop_tree.glb'),
  loadModel('assets/models/prop_tree2.glb'),
  loadModel('assets/models/prop_tree3.glb'),
];
// All tree GLBs are 4 primitives: trunk + 2 branch stubs + leaf cards.
const TREE_GLB_PARTS = 4;

// The forest, read from the world file. Each tree is an entity (kind
// `prop_tree`), so it can be moved, retinted, deleted, or added in the editor â€”
// it used to be scattered here at startup from a fixed LCG seed, which meant no
// tree had an identity and none of that was expressible. `bun
// tools/bake-forest-to-world.ts` seeded the current 88 from that same scatter.
//
// Copied into flat arrays so the per-frame draw loop stays a single pass over
// numbers (see the Perry conventions in CLAUDE.md).
const FOREST_COUNT = W.FOREST_COUNT;
const FOREST_X = W.FOREST_X;
const FOREST_Y = W.FOREST_Y;
const FOREST_Z = W.FOREST_Z;
const FOREST_VAR = W.FOREST_VAR;
const FOREST_YAW = W.FOREST_YAW;
const FOREST_SCALE = W.FOREST_SCALE;
const FOREST_TINT_R = W.FOREST_TINT_R;
const FOREST_TINT_G = W.FOREST_TINT_G;
const FOREST_TINT_B = W.FOREST_TINT_B;

// Round-9 â€” trunk colliders for the scatter forest. The world-authored
// prop_tree entities carry box colliders from the world file, but these
// 88 trees never got physics bodies â€” the player walked straight through
// them. One slim static box per trunk; the canopy stays shoot-through on
// purpose. Bullets now ricochet off trunks via the existing ALL_LAYERS
// raycast, and the orbit camera's NON_MOVING ray already handles trunks.
for (let i = 0; i < FOREST_COUNT; i++) {
  const tr = 0.26 * FOREST_SCALE[i];   // half-extent â‰ˆ bark radius at the base
  const th = 1.6 * FOREST_SCALE[i];    // half-height â€” trunk only, not canopy
  const trunkShape = boxShape(vec3(tr, th, tr));
  createBody(physics, trunkShape, {
    motionType: MotionType.STATIC,
    position: vec3(FOREST_X[i], FOREST_Y[i] + th, FOREST_Z[i]),
    objectLayer: Layer.NON_MOVING,
    friction: 0.9,
  });
}

let treePropIdx = -1;
let terrainPropIdx = -1;
for (let i = 0; i < W.UNIQUE_MODEL_COUNT; i++) {
  if (W.UNIQUE_MODELS[i] === 'assets/models/prop_tree.glb')     { treePropIdx    = i; }
  if (W.UNIQUE_MODELS[i] === 'assets/models/terrain_hills.glb') { terrainPropIdx = i; }
}

// Round-9 â€” flat obstacle-circle list for enemy steering. Enemies are
// KINEMATIC (steered in XZ, setBodyPosition) so Jolt never resolves their
// contacts â€” they need code-side avoidance. Circles cover every tree trunk:
// the forest entities plus any prop_tree meshes placed as static_mesh.
const OBST_MAX = FOREST_COUNT + W.MESH_COUNT;
const OBST_X = new Array<number>(OBST_MAX);
const OBST_Z = new Array<number>(OBST_MAX);
const OBST_R = new Array<number>(OBST_MAX);
let OBST_COUNT = 0;
for (let i = 0; i < FOREST_COUNT; i++) {
  OBST_X[OBST_COUNT] = FOREST_X[i];
  OBST_Z[OBST_COUNT] = FOREST_Z[i];
  OBST_R[OBST_COUNT] = 0.30 * FOREST_SCALE[i];
  OBST_COUNT = OBST_COUNT + 1;
}
for (let i = 0; i < W.MESH_COUNT; i++) {
  if (W.MESH_MODEL_IDX[i] === treePropIdx && OBST_COUNT < OBST_MAX) {
    OBST_X[OBST_COUNT] = W.MESH_X[i];
    OBST_Z[OBST_COUNT] = W.MESH_Z[i];
    OBST_R[OBST_COUNT] = 0.30 * W.MESH_SCALE[i];
    OBST_COUNT = OBST_COUNT + 1;
  }
}

// Tier 2a â€” terrain colour material. Compile via the file-based
// API for hot-reload, then push the param UBO via setMaterialParams
// directly (loadMaterial's array-length pass-through is unreliable
// under Perry â€” the FFI receives zero count for inline literals).
//   grass_dry rgb  pad   grass_mid rgb  pad   grass_deep rgb pad   dirt rgb pad
//   noise_freq, slope_threshold, ridge_height, pale_strength
const matTerrain = compileMaterialFromFile('assets/materials/terrain.wgsl', 'opaque');

// SH-009 — four splat layers + their normals, as texture ARRAYS. The layer
// order IS the ABI (terrain.wgsl indexes by it); it matches the emit order in
// tools/build-terrain-textures.ts.
//
// NOTE the ordering below: bind the arrays BEFORE setting params. It used to
// matter fatally — set_user_params rebuilt the material's bind group with the
// 1x1 stub array hardcoded, silently unbinding the art (engine EN-014). That is
// fixed, but binding first is still the honest order.
{
  const albedoArr = createTextureArrayFromFiles([
    'assets/textures/terrain_grass_lush_albedo.png',
    'assets/textures/terrain_grass_dry_albedo.png',
    'assets/textures/terrain_dirt_albedo.png',
    'assets/textures/terrain_rock_albedo.png',
  ], TEX_ARRAY_FORMAT_SRGB, 4);
  // Normals MUST be linear — sRGB-decoding an encoded normal corrupts it.
  const normalArr = createTextureArrayFromFiles([
    'assets/textures/terrain_grass_lush_normal.png',
    'assets/textures/terrain_grass_dry_normal.png',
    'assets/textures/terrain_dirt_normal.png',
    'assets/textures/terrain_rock_normal.png',
  ], TEX_ARRAY_FORMAT_LINEAR, 4);
  // SH-010 — the shared detail normal rides the MR slot; nothing else wants it.
  const detailArr = createTextureArrayFromFiles([
    'assets/textures/terrain_detail_normal.png',
  ], TEX_ARRAY_FORMAT_LINEAR, 4);

  if (matTerrain > 0 && albedoArr > 0) {
    setMaterialTextureArray(matTerrain, TEXTURE_ARRAY_ALBEDO, albedoArr);
    setMaterialTextureArray(matTerrain, TEXTURE_ARRAY_NORMAL, normalArr);
    setMaterialTextureArray(matTerrain, TEXTURE_ARRAY_MR, detailArr);
  } else {
    console.log('[terrain] splat textures missing - run: bun tools/build-terrain-textures.ts');
  }
}
const TERRAIN_PARAMS = [
  // Per-layer tint (multiplied into the sampled albedo), so the palette stays
  // tunable without regenerating the art. Kept near 1 — the textures already
  // carry the colour; these only nudge it.
  0.92, 0.96, 0.84,  0.0,   // lush
  0.98, 0.94, 0.80,  0.0,   // dry
  0.95, 0.92, 0.88,  0.0,   // dirt
  0.92, 0.93, 0.95,  0.0,   // rock
  // macro noise freq, slope threshold (cos), ridge height, pale strength
  0.18, 0.72, 4.0,   0.45,
  // river: centre z, half-width, bank fade width, waterline y.
  // Matches the arena_02 river volume (z=12, carve half-width 2.6).
  12.0, 2.4, 1.8,    0.12,
  // macro UV scale (tiles/m), detail UV scale, detail strength, normal strength
  0.35, 6.0, 0.35,   0.85,
];
if (matTerrain > 0) setMaterialParams(matTerrain, TERRAIN_PARAMS);
// Per-mesh collider from userData.collider === 'box'.
for (let i = 0; i < W.MESH_COUNT; i++) {
  if (W.MESH_COLLIDER[i] === 1) {
    const shape = boxShape(vec3(W.MESH_COLLIDER_HX[i], W.MESH_COLLIDER_HY[i], W.MESH_COLLIDER_HZ[i]));
    createBody(physics, shape, {
      motionType: MotionType.STATIC,
      position: vec3(W.MESH_X[i], W.MESH_Y[i], W.MESH_Z[i]),
      objectLayer: Layer.NON_MOVING,
      friction: 0.9,
    });
  }
}
const worldStatus = W.WORLD_NAME + ' (' + W.COLLIDER_COUNT + '+' + W.MESH_COUNT + ' bodies)';


createPlayer(physics, spawnPos);

// ---- Third-person orbit camera (inline; see perry-quirks.md) --------------
// Array-slot state because Perry 0.5.158 doesn't propagate module-scope
// `let` reassignments across function calls. Cross-module array writes
// are even more fragile; keeping everything local to main.ts so the
// compiler has no excuse to lose the writes.
//   CAM[0] yaw           CAM[5] tgtX
//   CAM[1] pitch         CAM[6] tgtY
//   CAM[2] camX          CAM[7] tgtZ
//   CAM[3] camY          CAM[8] initialised (0/1)
//   CAM[4] camZ
const CAM = [spawnYaw, 0.35, 0, 0, 0, 0, 0, 0, 0];
const TP_PITCH_MIN = -0.25;
const TP_PITCH_MAX = 1.20;
const TP_ORBIT_DIST = 6.0;
const TP_EYE_HEIGHT = 1.4;
const TP_SMOOTH = 10.0;
const TP_FOVY = 70;

// ---- Third-person player model (human_bsuit) -----------------------------
// Converted via tools/convert-aliens-anim.ts. Drawn at the physics-character
// position, facing the camera's horizontal yaw so the player always looks
// "away from the camera" (classic 3rd-person over-the-shoulder feel).
const mdlPlayer  = loadModel('assets/models/player_bsuit.glb');
const animPlayer = loadModelAnimation('assets/models/player_bsuit.glb');
// human_bsuit animation indices (IQE declaration order):
//   0 idle, 7 attack, 8 run, 12 walk.
const PLAYER_ANIM_IDLE   = 0;
const PLAYER_ANIM_WALK   = 12;
const PLAYER_ANIM_RUN    = 8;
const PLAYER_ANIM_ATTACK = 7;
const PLAYER_SCALE = 1.0;
const PLAYER_MODEL_Y_OFFSET = -0.95;    // character capsule center -> feet
let playerAnimT = 0;

// SH-027 â€” real weapon models, replacing the two grey drawCube primitives that
// were the most visible placeholder left in the game. Built by
// tools/build-weapons.ts; local +Z is down the barrel and the muzzle distances
// below are the ABI that file prints (keep them in sync).
const mdlWeapons = [
  loadModel('assets/models/weapon_rifle.glb'),
  loadModel('assets/models/weapon_blaster.glb'),
  loadModel('assets/models/weapon_chaingun.glb'),
  loadModel('assets/models/weapon_cannon.glb'),
];
const WEAPON_MUZZLE_Z = [0.62, 0.42, 0.78, 0.70];
const WEAPON_DRAW_SCALE = [1.0, 1.0, 1.0, 1.0];

// EN-033 â€” the hand joint, so the weapon rides the animation instead of
// floating at a fixed offset. -1 means the skeleton has no such joint and the
// fixed-offset fallback below is used (which is what the old cube did).
// The bsuit skeleton carries a purpose-built attachment point — `tag_weapon`,
// a child of hand.R — which is exactly what a socket is for.
//
// Name it EXACTLY. findJoint falls back to a case-insensitive substring match
// when there is no exact hit, and asking for 'hand' matched `IKhand.L` (an IK
// target near the pelvis), which parked the gun inside the character's body and
// read on screen as "the weapon isn't rendering at all". Sockets fail silently
// like that; an exact tag is the whole defence.
const playerHandJoint = findJoint(animPlayer, 'tag_weapon');

// SH-033 â€” VFX. Cosmetic, so a failure here must never take the game down:
// initVfx() returns false and every emit call becomes a no-op.
const vfxOk = VFX.initVfx();
if (!vfxOk) console.log('[vfx] disabled - shaders or textures failed to load');

// Round 2 â€” audio mix (buses, reverb, footsteps, music intensity).
MIX.initAudioMix();

// Weapons: stat table + state.
WPN.initWeapons();
// Unlocks persist across runs (SH-041).
{
  const mask = SET.unlockMask();
  for (let i = 0; i < WPN.WEAPON_COUNT; i++) {
    if ((mask & (1 << i)) !== 0) WPN.unlock(i);
  }
}


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
const matGrass = compileMaterialInstanced(
  readFile('assets/materials/grass_instanced.wgsl'));
const GRASS_PARAMS = [
  // base hue rgb (Round-4: slightly desaturated), transmission strength
  0.30, 0.42, 0.20,  0.40,
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
// Round-9 anti-grit: wider blades (0.045/0.026 â†’ 0.062/0.038) â€” the old
// needle-thin cards fell below a pixel a few metres out and the field
// read as gritty speckle rather than foliage.
const GB_W0 = 0.062;   // root half-width
const GB_W1 = 0.038;   // mid half-width
const GB_H1 = 0.26;    // mid height
const GB_H2 = 0.55;    // tip height
const GB_B1 = 0.028;   // bow at mid
const GB_B2 = 0.090;   // bow at tip
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

// Per-instance buffer â€” 20 000 blades Ã— 9 floats (pos.xyz, rot_y,
// scale, tint.rgba). Same RNG / heightmap / rejection logic as the
// old baked-mesh path; deterministic given the seed so screenshot
// diffs stay stable.
const GRASS_INSTANCE_COUNT_MAX = 20000;
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

// ---- Building stone material â€” bake all box-placeholder building
// entries into a single static mesh, drawn once per frame against
// a noise + horizontal-band material. Replaces the flat-beige
// drawCube path for category-1 (building) entities.
const matBuilding = compileMaterialFromFile('assets/materials/building.wgsl', 'opaque');
const BUILDING_PARAMS = [
  // base rgb (warm sandstone)        noise mix
  0.72, 0.66, 0.55,                   0.55,
  // band rgb (darker mortar line)    band tightness (higher = sharper)
  0.40, 0.34, 0.28,                   1.4,
  // noise_freq, band_period (m), unused, unused
  0.50, 3.0,                          0.0,   0.0,
];
if (matBuilding > 0) setMaterialParams(matBuilding, BUILDING_PARAMS);

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
    // +X face (normal +X)
    BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0;
    BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0;
    BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1;
    BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1;
    // -X face
    BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0;
    BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0;
    BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1;
    BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1;
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
    BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0;
    BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1;
    BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zp; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1;
    // -Z face
    BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0;
    BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yn; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0;
    BUILDING_VERTS[vi++] = xp; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1;
    BUILDING_VERTS[vi++] = xn; BUILDING_VERTS[vi++] = yp; BUILDING_VERTS[vi++] = zn; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = -1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 1; BUILDING_VERTS[vi++] = 0; BUILDING_VERTS[vi++] = 1;

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
// reflect the sky and the centre of the pane stays clearest. Placed in the
// south-wall door opening of the h1 house (gap at x=-22..-20, y=0..2.4,
// z=-10) so the player can see the interior refracted through it on the
// approach. Phase 10's acceptance criterion: no engine change between
// Phase 9 and 10 â€” only TypeScript.

const matGlass = compileMaterialFromFile(
  'assets/materials/glass.wgsl', 'refractive');

// Glass pane mesh â€” a single 2m Ã— 2.4m quad on the XY plane, normal +Z.
// Subdivided 1Ã—1 (two triangles) because glass has no per-vertex
// displacement; the shader runs entirely in fs_main.
const GLASS_W = 2.0;   // metres along X â€” door opening width
const GLASS_H = 2.4;   // metres along Y â€” door opening height
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

// ---- Unvanquished aliens (5 kinds, M3 model + M5 AI + M6 pool) ------------
// Each kind has its own GLB model and stat line. Kinds and models line up
// with the Unvanquished alien classes:
//   0 = dretch   â€” small, fast, low HP, moderate damage
//   1 = mantis   â€” quick, medium HP
//   2 = marauder â€” medium all-round
//   3 = dragoon  â€” heavier, slower, hits hard
//   4 = tyrant   â€” boss tier; rare, big, tanky
const KIND_COUNT = 5;
const KIND_NAME  = ['DRETCH', 'MANTIS', 'MARAUDER', 'DRAGOON', 'TYRANT'];
const mdlAliens  = [
  loadModel('assets/models/enemy_dretch.glb'),
  loadModel('assets/models/enemy_mantis.glb'),
  loadModel('assets/models/enemy_marauder.glb'),
  loadModel('assets/models/enemy_dragoon.glb'),
  loadModel('assets/models/enemy_tyrant.glb'),
];
// One animation handle PER KIND is enough for a single-clip sampler, because
// the caller passes the time explicitly on every call. It is NOT enough for the
// mixer (EN-028): the mixer owns the clock, the crossfade and the layer
// weights, and that state lives on the handle â€” so two dretches sharing one
// handle would advance the same clock twice a frame (double-speed animation)
// and share each other's flinches.
//
// So: one handle per enemy SLOT. The GLB is parsed once more per slot at
// startup, which is a few MB and a few ms, in exchange for every enemy having
// its own independent animation state.
const ALIEN_GLB = [
  'assets/models/enemy_dretch.glb',
  'assets/models/enemy_mantis.glb',
  'assets/models/enemy_marauder.glb',
  'assets/models/enemy_dragoon.glb',
  'assets/models/enemy_tyrant.glb',
];
// Per-kind handle, kept only for the load-time joint lookups below.
const animAliens = [
  loadModelAnimation(ALIEN_GLB[0]),
  loadModelAnimation(ALIEN_GLB[1]),
  loadModelAnimation(ALIEN_GLB[2]),
  loadModelAnimation(ALIEN_GLB[3]),
  loadModelAnimation(ALIEN_GLB[4]),
];
// Animation indices â€” IQE declaration order. Dretch (and most others):
// 0 stand, 1 attack, 4 die, 14 run, 20 walk. We map gameplay -> anim idx.
// Per-kind animation indices, in kind order [dretch, mantis, marauder,
// dragoon, tyrant]. The GLBs do NOT share one layout â€” the old flat
// [14,...]/[1,...] tables played run_right on the dragoon, pain2 on the
// tyrant, and stand1 as the mantis "attack". Verified against each GLB's
// animation list (tools/inspect-glb.ts).
const ANIM_WALK_IDX   = [14, 18, 14, 12, 15];   // 'run'
const ANIM_ATTACK_IDX = [ 1,  4,  1,  6,  1];   // 'attack'
const ANIM_DIE_IDX    = [ 4,  7,  4,  7,  5];   // 'die'
// SH-030 â€” pain clips, for the flinch state. The IQE sources carry them and the
// converter extracts every clip; indices verified per GLB with
// tools/inspect-glb.ts. Falls back to the attack clip's neighbour if a kind
// turns out not to have one, which is harmless (a short twitch).
const ANIM_PAIN_IDX   = [ 2,  5,  2,  8,  3];
// EN-028 upper-body mask root, so an alien can bite WHILE closing instead of
// stopping to bite. -1 = no such joint, and the attack stays full-body (i.e.
// exactly today's behaviour) rather than breaking.
const KIND_SPINE_JOINT = new Array<number>(KIND_COUNT);
const KIND_IDLE_IDX    = [ 0,  0,  0,  0,  0];
// Die-anim durations (max keyframe time per GLB). The engine WRAPS anim
// time (t % duration), so death playback clamps just short of these to
// freeze on the final collapsed pose instead of re-looping the fall.
const ANIM_DIE_DUR    = [1.55, 1.567, 0.883, 1.8, 2.567];
// Procedural motion parameters (cheap substitute for skeletal animation).
// Each enemy has a phase accumulator â€” sinusoids on top give a bob + side-
// sway while walking, and a forward-lunge while attacking.
const WALK_BOB_Y = 0.12;       // metres
const WALK_BOB_RATE = 9.0;     // rad/s
const WALK_TILT = 0.06;        // unused; kept for future side-sway
const ATTACK_LUNGE_AMP = 0.25; // m forward during attack
// Per-kind tuning. Collider half-extents are generous (taller than the visual
// model) so horizontal aim at any range connects.
// Round-6 rescale â€” the GLBs have wildly different native sizes (engine
// getModelBounds rest-pose heights: dretch 0.74, mantis 2.54, marauder
// 4.63, dragoon 14.99, tyrant 5.27 m), and the old uniform-ish scales
// made the later kinds monstrous (dragoon 36 m!). Scales now target
// world heights â‰ˆ 0.65 / 1.4 / 1.8 / 2.1 / 3.0 m. Colliders unchanged
// (they were deliberately generous).
const KIND_SCALE = [0.88, 0.55, 0.39, 0.14, 0.57];
const KIND_HX    = [1.0, 0.9, 1.2, 1.4, 1.8];
const KIND_HY    = [1.0, 1.0, 1.2, 1.5, 2.0];
const KIND_HZ    = [1.1, 1.0, 1.3, 1.6, 2.0];
const KIND_Y_OFF = [1.0, 1.0, 1.2, 1.5, 2.0];
const KIND_SPEED = [3.0, 4.5, 3.5, 2.5, 2.2];
const KIND_HP    = [3,   4,   6,   10,  20];
const KIND_DMG   = [12,  10,  16,  22,  35];
const KIND_CD    = [0.9, 0.7, 0.9, 1.1, 1.3];
const KIND_MELEE = [2.0, 2.0, 2.3, 2.6, 3.0];
const DRETCH_HIT_FLASH = 0.18;
const WHITE = { r: 255, g: 255, b: 255, a: 255 };
// Ichor colour per kind â€” drives the blood decal tint (SH-033).
const KIND_BLOOD_R = [0.55, 0.50, 0.62, 0.70, 0.45];
const KIND_BLOOD_G = [0.95, 0.85, 0.55, 0.35, 0.90];
const KIND_BLOOD_B = [0.35, 0.95, 0.85, 0.75, 0.30];

// Resolve the spine joint per kind, once, at load. findJoint parses a STRING â€”
// which is fine here (load time) and forbidden per-frame (perry-quirks #5).
for (let k = 0; k < KIND_COUNT; k++) {
  KIND_SPINE_JOINT[k] = findJoint(animAliens[k], 'spine');
}

// Enemy pool â€” each slot is permanently tied to one kind because Jolt body
// shapes can't be swapped in-place. BODIES_PER_KIND dormant bodies per kind
// give us a fixed pool of MAX_ENEMIES = KIND_COUNT * BODIES_PER_KIND.
const BODIES_PER_KIND = 2;
const MAX_ENEMIES = KIND_COUNT * BODIES_PER_KIND;
const enX = new Array<number>(MAX_ENEMIES);
const enY = new Array<number>(MAX_ENEMIES);
const enZ = new Array<number>(MAX_ENEMIES);
const enHP = new Array<number>(MAX_ENEMIES);
const enAlive = new Array<number>(MAX_ENEMIES);
const enKind  = new Array<number>(MAX_ENEMIES);
const enAttackCD = new Array<number>(MAX_ENEMIES);
const enFlashT = new Array<number>(MAX_ENEMIES);
const enPhase = new Array<number>(MAX_ENEMIES);        // walk-cycle phase accumulator
// Death playback: corpse keeps drawing at its last position while the die
// animation plays (then sinks), independent of enAlive so wave logic and
// AI treat the enemy as gone immediately.
const enDying    = new Array<number>(MAX_ENEMIES);     // 1 = death anim in progress
const enDeathT   = new Array<number>(MAX_ENEMIES);     // seconds since the kill
const enDeathYaw = new Array<number>(MAX_ENEMIES);     // facing frozen at death
// Round-9 AI overhaul â€” per-enemy steering state (flat arrays, Perry
// convention). Each kind runs its own little state machine in the AI
// block; these carry it between frames.
const AI_APPROACH = 0;   // close on the player (kind-specific flavour)
const AI_ORBIT    = 1;   // mantis: circle-strafe at ring distance
const AI_WINDUP   = 2;   // dragoon: rooted pounce telegraph
const AI_CHARGE   = 3;   // mantis dart / dragoon pounce â€” locked direction
const AI_RECOVER  = 4;   // post-attack back-off / cooldown creep
// SH-030 â€” being shot now interrupts the enemy. Light kinds flinch outright;
// heavies only stagger once enough damage lands inside a window, so a tyrant
// stays menacing instead of being stun-locked by a rifle.
const AI_FLINCH   = 5;
const FLINCH_TIME    = 0.25;
const FLINCH_LOCKOUT = 0.60;   // min gap between flinches â€” no stun-lock
const STAGGER_WINDOW = 1.0;
const STAGGER_FRAC   = 0.15;   // % of max HP inside the window to stagger
const STAGGER_TIME   = 0.60;
// Which kinds flinch on any hit (light) vs need the stagger meter (heavy).
const KIND_LIGHT = [1, 1, 1, 0, 0];
const enAIState  = new Array<number>(MAX_ENEMIES);
const enStateT   = new Array<number>(MAX_ENEMIES);   // seconds left in state
const enOrbitDir = new Array<number>(MAX_ENEMIES);   // Â±1 â€” circle/flank side
const enChargeX  = new Array<number>(MAX_ENEMIES);   // locked charge direction
const enChargeZ  = new Array<number>(MAX_ENEMIES);
const enHeading  = new Array<number>(MAX_ENEMIES);   // smoothed facing yaw
const enSpeedMul = new Array<number>(MAX_ENEMIES);   // tyrant momentum
// SH-030 â€” flinch / stagger bookkeeping.
const enFlinchLock = new Array<number>(MAX_ENEMIES);  // s until it can flinch again
const enDmgWindow  = new Array<number>(MAX_ENEMIES);  // damage inside STAGGER_WINDOW
const enDmgTimer   = new Array<number>(MAX_ENEMIES);
// SH-034 â€” the clip currently requested on the base track, so animPlay is only
// called on a real change (it is idempotent, but this keeps the intent clear).
const enAnimClip   = new Array<number>(MAX_ENEMIES);
// Upper-body attack layer weight, blended in/out rather than snapped.
const enAttackLayer = new Array<number>(MAX_ENEMIES);
// Tyrant footstep cadence.
const enStepPhase  = new Array<number>(MAX_ENEMIES);
// Last frame's steering velocity, so the draw pass can match animation playback
// rate to actual ground speed (SH-034 â€” the foot-slide fix).
const vxLast = new Array<number>(MAX_ENEMIES);
const vzLast = new Array<number>(MAX_ENEMIES);
const enBody: BodyHandle[] = new Array<BodyHandle>(MAX_ENEMIES);
// EN-028 â€” one animation handle per SLOT, so every enemy owns its own mixer
// clock, crossfade and attack-layer weight (see the note at ALIEN_GLB).
const enAnim = new Array<number>(MAX_ENEMIES);
for (let k = 0; k < KIND_COUNT; k++) {
  const shape = boxShape(vec3(KIND_HX[k], KIND_HY[k], KIND_HZ[k]));
  for (let j = 0; j < BODIES_PER_KIND; j++) {
    const i = k * BODIES_PER_KIND + j;
    enAnim[i] = loadModelAnimation(ALIEN_GLB[k]);
    enX[i] = 0; enY[i] = -100; enZ[i] = 0;
    enHP[i] = 0; enAlive[i] = 0; enAttackCD[i] = 0; enFlashT[i] = 0;
    enPhase[i] = Math.random() * Math.PI * 2;   // stagger the bob phases
    enKind[i] = k;
    // Explicit init â€” Perry arrays don't default-fill, and findDormantSlot
    // compares enDying with === 0.
    enDying[i] = 0;
    enDeathT[i] = 0;
    enDeathYaw[i] = 0;
    enAIState[i] = AI_APPROACH;
    enStateT[i] = 0;
    enOrbitDir[i] = (i & 1) === 0 ? 1 : -1;
    enChargeX[i] = 0;
    enChargeZ[i] = 1;
    enHeading[i] = 0;
    enSpeedMul[i] = 1;
    enFlinchLock[i] = 0;
    enDmgWindow[i] = 0;
    enDmgTimer[i] = 0;
    enAnimClip[i] = -1;
    enAttackLayer[i] = 0;
    enStepPhase[i] = 0;
    vxLast[i] = 0;
    vzLast[i] = 0;
    enBody[i] = createBody(physics, shape, {
      motionType: MotionType.KINEMATIC,
      position: vec3(0, -100, 0),
      objectLayer: Layer.MOVING,
    });
  }
}

// Wave director â€” spawners, wave plan, and kind sequence all come from the
// world file (see enemy_spawner + wave_config entities in arena_02.world.json).
const spawnerX = W.SPAWNER_X;
const spawnerZ = W.SPAWNER_Z;
const wavePlan = W.WAVE_SIZE;
const WAVE_OFFS = W.WAVE_OFFS;
const WAVE_KINDS = W.WAVE_KIND;
const WAVE_SPAWN_DELAY = 1.2;
const WAVE_BREAK_DELAY = 2.5;
// Round-2 audit (F11): with one kind per wave and BODIES_PER_KIND=2 pool
// slots, the shipped game never showed more than 2 enemies at once â€” the
// arena felt empty and the measured pool-max load never occurred in play.
// Waves now mix kinds (see arena_02.world.json), so the concurrency cap
// is the real limit again.
const MAX_CONCURRENT = 6;

let waveIdx = 0;
let waveSpawned = 0;
let waveBreakTimer = WAVE_BREAK_DELAY;
let spawnTimer = 0;
let gameWon = false;


// Shortest-arc turn toward a target yaw, clamped to maxStep radians.
// Keeps enemy headings continuous so models wheel around instead of
// snapping 180Â°.
function turnToward(cur: number, target: number, maxStep: number): number {
  let d = target - cur;
  while (d > Math.PI)  d = d - Math.PI * 2;
  while (d < -Math.PI) d = d + Math.PI * 2;
  if (d >  maxStep) d =  maxStep;
  if (d < -maxStep) d = -maxStep;
  return cur + d;
}

function countAlive(): number {
  let c = 0;
  for (let i = 0; i < MAX_ENEMIES; i++) if (enAlive[i] > 0) c = c + 1;
  return c;
}

function findDormantSlot(kind: number): number {
  for (let j = 0; j < BODIES_PER_KIND; j++) {
    const i = kind * BODIES_PER_KIND + j;
    // A dying slot still owns the corpse on screen â€” don't respawn into it
    // or the death anim snaps into a fresh enemy mid-fall.
    if (enAlive[i] === 0 && enDying[i] === 0) return i;
  }
  return -1;
}

function spawnEnemy(): void {
  const kind = WAVE_KINDS[WAVE_OFFS[waveIdx] + waveSpawned];
  const slot = findDormantSlot(kind);
  if (slot < 0) return;   // all bodies of this kind busy; retry next tick
  const sp = waveSpawned % 4;
  enX[slot] = spawnerX[sp];
  enZ[slot] = spawnerZ[sp];
  enY[slot] = terrainHeightAt(enX[slot], enZ[slot]);
  enHP[slot] = KIND_HP[kind];
  enAlive[slot] = 1;
  enAttackCD[slot] = 0;
  enFlashT[slot] = 0;
  enPhase[slot] = Math.random() * Math.PI * 2;
  enAIState[slot] = AI_APPROACH;
  enStateT[slot] = 0.5 + Math.random();          // stagger first specials
  enOrbitDir[slot] = Math.random() < 0.5 ? -1 : 1;
  enChargeX[slot] = 0;
  enChargeZ[slot] = 1;
  enSpeedMul[slot] = 1;
  enFlinchLock[slot] = 0;
  enDmgWindow[slot] = 0;
  enDmgTimer[slot] = 0;
  enAttackLayer[slot] = 0;
  enStepPhase[slot] = 0;
  vxLast[slot] = 0;
  vzLast[slot] = 0;
  // Force the mixer to re-trigger: the slot may still hold the die clip from
  // the previous occupant, and animPlay is (deliberately) a no-op when asked
  // for the clip that is already playing.
  enAnimClip[slot] = -1;
  // Spawners sit at the arena corners â€” start facing the middle.
  enHeading[slot] = Math.atan2(-enX[slot], enZ[slot]);
  setBodyPosition(enBody[slot],
    vec3(enX[slot], enY[slot] + KIND_Y_OFF[kind], enZ[slot]), true);
  waveSpawned = waveSpawned + 1;
}

// ---- Weapon + combat state (M4 / M5 / M6 / M7) ----------------------------
const PLAYER_HP_MAX = 100;
const FIRE_RANGE = 60.0;

// SH-028/SH-042 â€” weapon state now lives in src/weapons.ts as a stat TABLE, so
// the chaingun and the cannon are rows rather than branches. What stays here is
// only what the world/projectile code needs.
const WEAPON_RIFLE = WPN.W_RIFLE;
const WEAPON_BLASTER = WPN.W_BLASTER;
const BLASTER_PROJ_LIFE = 2.5;
const BLASTER_PROJ_GRAVITY = 9.0;   // m/s^2 â€” lighter than world gravity for a softer arc

let playerHP = PLAYER_HP_MAX;
let gameOver = false;
// 0 = title screen (menu.wav, world rendering as the backdrop, no waves /
// no firing / no movement), 1 = playing. Any input starts the game.
let gameState = 0;
const MUZZLE_FLASH_DUR = 0.08;
let muzzleFlashT = 0;
let damageFlashT = 0;
// SH-029/SH-043 â€” where the last hit came from, relative to the camera. Drives
// the HUD's damage arc, which is what makes damage direction readable WITHOUT
// relying on colour (the colourblind-safe path).
let lastHitAngle = 0;
let lastHitT = 0;
// SH-041 â€” end-of-wave report card + unlock banner.
let waveBonus = 0;
let waveBonusT = 0;
let unlockBannerT = 0;
// SH-027 â€” the weapon's world transform for this frame. Computed once and used
// by the draw, the muzzle flash, the tracer AND the shot ray, so what you see
// is what you hit.
let weaponX = 0;
let weaponY = 0;
let weaponZ = 0;
let weaponYaw = 0;
let weaponPitch = 0;
let muzzleX = 0;
let muzzleY = 0;
let muzzleZ = 0;
// SH-043 â€” hit marker. A white tick + a sound, so a colourblind player gets
// the same confirmation everyone else does (the enemy's red tint alone does
// not survive a red-green deficiency).
let hitMarkT = 0;
// SH-040 — seconds left on the "restart to load the new arena" notice.
let levelChangeT = 0;
// Phase 7 / Round-3 â€” seconds until the next wading splat may fire.
// Splatting every moving frame overwhelmed the field's 3.2%/frame decay
// (steady state ~19Ã— over max â€” a stuck white smear); one splat per
// 0.15 s at lower strength holds it near 1.0 instead.
let splatCooldown = 0;
// Round-7 â€” wading splash SFX cadence (slower than the visual splats
// or it reads as a drum loop).
let splashSoundCD = 0;
let shotsFired = 0;
let shotsHit = 0;

// ---- Projectile pool (M7) -------------------------------------------------
// Fixed-size ring buffer. Each slot stores position, velocity, and
// remaining life. pLife = 0 means the slot is free. Projectiles advance
// each frame via segment-raycast so they can't tunnel through walls.
const MAX_PROJ = 16;
const pX  = new Array<number>(MAX_PROJ);
const pY  = new Array<number>(MAX_PROJ);
const pZ  = new Array<number>(MAX_PROJ);
const pVX = new Array<number>(MAX_PROJ);
const pVY = new Array<number>(MAX_PROJ);
const pVZ = new Array<number>(MAX_PROJ);
const pLife = new Array<number>(MAX_PROJ);
// SH-042 â€” which weapon fired it, and (for the cannon) how charged it was.
// The cannon's shot explodes; the blaster's does not, and the projectile has to
// know which it is when it lands.
const pWeapon = new Array<number>(MAX_PROJ);
const pCharge = new Array<number>(MAX_PROJ);
for (let i = 0; i < MAX_PROJ; i++) { pLife[i] = 0; pWeapon[i] = 0; pCharge[i] = 0; }
let projNext = 0;

function spawnProjectile(x: number, y: number, z: number,
                         vx: number, vy: number, vz: number,
                         weapon: number, charge: number): void {
  pX[projNext] = x; pY[projNext] = y; pZ[projNext] = z;
  pVX[projNext] = vx; pVY[projNext] = vy; pVZ[projNext] = vz;
  pLife[projNext] = BLASTER_PROJ_LIFE;
  pWeapon[projNext] = weapon;
  pCharge[projNext] = charge;
  projNext = (projNext + 1) % MAX_PROJ;
}

// ---- Ammo pickups (M7) ----------------------------------------------------
// Fixed positions around the arena. Walk within PICKUP_RADIUS to collect;
// respawn after PICKUP_RESPAWN seconds so long runs don't starve for ammo.
const PICKUP_RIFLE = 0;
const PICKUP_BLASTER = 1;
const PICKUP_RIFLE_AMT = 15;
const PICKUP_BLASTER_AMT = 8;
const PICKUP_RADIUS = 1.4;
const PICKUP_RESPAWN = 18.0;
const pickupKind = W.PICKUP_KIND;      // 0 = rifle, 1 = blaster
const pickupX    = W.PICKUP_X;
const pickupZ    = W.PICKUP_Z;
const PICKUP_COUNT = W.PICKUP_COUNT;
const pickupActive   = new Array<number>(PICKUP_COUNT);
const pickupRespawnT = new Array<number>(PICKUP_COUNT);
for (let i = 0; i < PICKUP_COUNT; i++) { pickupActive[i] = 1; pickupRespawnT[i] = 0; }

function despawnAllEnemies(): void {
  for (let i = 0; i < MAX_ENEMIES; i++) {
    enAlive[i] = 0;
    enHP[i] = 0;
    enAttackCD[i] = 0;
    enFlashT[i] = 0;
    enPhase[i] = Math.random() * Math.PI * 2;
    enAnimClip[i] = -1;
    enAttackLayer[i] = 0;
    enFlinchLock[i] = 0;
    enDmgWindow[i] = 0;
    enDmgTimer[i] = 0;
    enDying[i] = 0;
    enDeathT[i] = 0;
    enDeathYaw[i] = 0;
    enX[i] = 0; enY[i] = -100; enZ[i] = 0;
    setBodyPosition(enBody[i], vec3(0, -100, 0), false);
  }
}

function resetRun(): void {
  WPN.resetWeapons();
  // Unlocks are persistent progression â€” they survive a restart, which is the
  // whole point of earning them.
  const mask = SET.unlockMask();
  for (let i = 0; i < WPN.WEAPON_COUNT; i++) {
    if ((mask & (1 << i)) !== 0) WPN.unlock(i);
  }
  playerHP = PLAYER_HP_MAX;
  gameOver = false;
  gameWon = false;
  muzzleFlashT = 0;
  damageFlashT = 0;
  waveIdx = 0;
  waveSpawned = 0;
  waveBreakTimer = WAVE_BREAK_DELAY;
  spawnTimer = 0;
  for (let i = 0; i < MAX_PROJ; i++) pLife[i] = 0;
  for (let i = 0; i < PICKUP_COUNT; i++) { pickupActive[i] = 1; pickupRespawnT[i] = 0; }
  despawnAllEnemies();
  SCORE.resetScore();
  FEEL.resetFeel();
  VFX.resetVfx();     // last run's blood shouldn't greet the new one
  runElapsed = 0;
  SCORE.beginWave(0);
}
// Seconds since the run began â€” drives the wave clock and the score bonuses.
let runElapsed = 0;

/// SH-030 / SH-033 / SH-041 â€” everything that happens when an enemy is hit.
///
/// One function because these all have to agree: the flinch rules decide
/// whether the AI is interrupted, the VFX decide what you see, the score
/// decides what you earn, and death has to freeze the heading before the
/// corpse animation starts. Splitting them apart is how they drift.
function damageEnemy(i: number, dmg: number,
                     hx: number, hy: number, hz: number,
                     dirX: number, dirY: number, dirZ: number): void {
  const k = enKind[i];
  enHP[i] = enHP[i] - dmg;
  enFlashT[i] = DRETCH_HIT_FLASH;

  const groundY = terrainHeightAt(enX[i], enZ[i]);
  VFX.emitImpactFlesh(hx, hy, hz, dirX, dirY, dirZ,
                      KIND_BLOOD_R[k], KIND_BLOOD_G[k], KIND_BLOOD_B[k],
                      groundY + 0.02, Math.random() * 6.28);
  playSound3D(sfxImpactFlesh, hx, hy, hz);
  hitMarkT = 0.18;

  if (enHP[i] <= 0) {
    // Death: AI/waves see it gone (enAlive 0), the physics body leaves play,
    // but the corpse keeps drawing while the die animation runs.
    enAlive[i] = 0;
    enDying[i] = 1;
    enDeathT[i] = 0;
    // Freeze the AI heading â€” a dragoon killed mid-charge collapses along its
    // charge line rather than snapping around toward the player.
    enDeathYaw[i] = enHeading[i];
    setBodyPosition(enBody[i], vec3(enX[i], -100, enZ[i]), false);
    playSound3D(sfxAlienDie[k * 3 + (i % 3)], enX[i], enY[i] + 1, enZ[i]);

    VFX.emitDeathBurst(hx, hy, hz,
                       KIND_BLOOD_R[k], KIND_BLOOD_G[k], KIND_BLOOD_B[k],
                       0.6 + KIND_SCALE[k]);
    // SH-029 â€” hit-stop. The single cheapest way to make a kill land: the frame
    // holds for ~50 ms and the brain reads it as impact. Heavier kinds hold
    // longer, which is most of why killing a tyrant feels different.
    FEEL.requestHitstop(k >= 3 ? 0.09 : 0.05);
    FEEL.addTrauma(0.12 + KIND_SCALE[k] * 0.1);
    gamepadRumble(0.5, 0.4, 0.12);
    SCORE.noteKill(k);
    return;
  }

  // Not dead â€” should it flinch?
  // Light kinds flinch on any hit (with a lockout so sustained fire cannot
  // stun-lock them). Heavies need enough damage inside a window, so a tyrant
  // shrugs off a rifle but staggers under a cannon: unflinching by default is
  // what makes it frightening.
  const light = KIND_LIGHT[k] === 1;
  if (light) {
    if (enFlinchLock[i] <= 0) {
      enAIState[i] = AI_FLINCH;
      enStateT[i] = FLINCH_TIME;
      enFlinchLock[i] = FLINCH_LOCKOUT;
    }
  } else {
    enDmgWindow[i] = enDmgWindow[i] + dmg;
    enDmgTimer[i] = STAGGER_WINDOW;
    if (enDmgWindow[i] >= KIND_HP[k] * STAGGER_FRAC && enFlinchLock[i] <= 0) {
      enAIState[i] = AI_FLINCH;
      enStateT[i] = STAGGER_TIME;
      enFlinchLock[i] = FLINCH_LOCKOUT * 2;
      enDmgWindow[i] = 0;
      playSound3D(sfxAlienPain[k], enX[i], enY[i] + 1, enZ[i]);
    }
  }
  if ((i & 3) === 0) {
    playSound3D(sfxAlienPain[k], enX[i], enY[i] + 1, enZ[i]);
  }
}

/// SH-042 â€” the cannon's area damage. Falls off linearly, and it hurts the
/// player too: an AoE weapon you can fire at your own feet for free is not a
/// weapon, it is a button.
function explode(x: number, y: number, z: number, radius: number, dmg: number): void {
  const groundY = terrainHeightAt(x, z);
  VFX.emitExplosion(x, y, z, groundY + 0.02);
  FEEL.addTrauma(0.6);
  FEEL.requestHitstop(0.06);
  gamepadRumble(0.9, 0.6, 0.3);
  playSound3D(sfxFireBlaster, x, y, z);

  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] === 0) continue;
    const dx = enX[i] - x;
    const dz = enZ[i] - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > radius) continue;
    const falloff = 1 - d / radius;
    const dl = d > 0.001 ? d : 1;
    damageEnemy(i, Math.max(1, Math.floor(dmg * falloff)),
                enX[i], enY[i] + 0.8, enZ[i], dx / dl, 0.4, dz / dl);
  }

  const pp = playerPosition();
  const pdx = pp.x - x;
  const pdz = pp.z - z;
  const pd = Math.sqrt(pdx * pdx + pdz * pdz);
  if (pd < radius && !gameOver) {
    const selfDmg = Math.floor(dmg * 2.5 * (1 - pd / radius));
    if (selfDmg > 0) {
      playerHP = playerHP - selfDmg;
      FEEL.damageFlash(1);
      damageFlashT = 0.5;
      MIX.duckMusicOnDamage();
      if (playerHP <= 0) {
        playerHP = 0;
        gameOver = true;
        playSound(sfxPlayerDie[0]);
        SCORE.commitRun(0);
        SET.saveSettings();
      }
    }
  }
}

/// SH-041 â€” the run's numbers, shown on both the death and the victory screen.
/// A run with no score attached is a run you can't get better at.
function drawRunSummary(sw: number, y: number): void {
  const cardW = 340;
  const x = (sw - cardW) / 2;
  drawRect(x, y, cardW, 118, { r: 10, g: 10, b: 14, a: 190 });

  const s = SCORE.score();
  const best = SET.bestScore(0);
  const isBest = s >= best && s > 0;

  drawText('SCORE', x + 24, y + 12, 17, { r: 190, g: 190, b: 195, a: 220 });
  const st = '' + s;
  const stw = measureText(st, 30);
  drawText(st, x + cardW - 24 - stw, y + 6, 30,
    isBest ? { r: 255, g: 215, b: 110, a: 255 } : { r: 235, g: 235, b: 240, a: 245 });

  drawText('BEST', x + 24, y + 46, 15, { r: 160, g: 160, b: 165, a: 200 });
  const bt = '' + best;
  const btw = measureText(bt, 18);
  drawText(bt, x + cardW - 24 - btw, y + 44, 18, { r: 200, g: 200, b: 205, a: 220 });

  const acc = Math.round(SCORE.accuracy() * 100);
  drawText('KILLS  ' + SCORE.kills() + '    ACCURACY  ' + acc + '%'
           + '    BEST COMBO  x' + SCORE.comboPeak().toFixed(2),
           x + 24, y + 76, 15, { r: 200, g: 200, b: 205, a: 220 });

  if (isBest) {
    const nb = 'NEW BEST';
    drawText(nb, x + 24, y + 96, 15, { r: 255, g: 205, b: 100, a: 245 });
  }
}

// Impact sparks â€” fixed ring buffer to avoid array growth in the hot loop.
const SPARK_MAX = 16;
const sparkX  = new Array<number>(SPARK_MAX);
const sparkY  = new Array<number>(SPARK_MAX);
const sparkZ  = new Array<number>(SPARK_MAX);
const sparkT  = new Array<number>(SPARK_MAX);   // seconds of life remaining; 0 = slot free
for (let i = 0; i < SPARK_MAX; i++) sparkT[i] = 0;
let sparkNext = 0;

function spawnSpark(p: Vec3): void {
  sparkX[sparkNext] = p.x;
  sparkY[sparkNext] = p.y;
  sparkZ[sparkNext] = p.z;
  sparkT[sparkNext] = 0.35;
  sparkNext = (sparkNext + 1) % SPARK_MAX;
}

let cursorLocked = true;
let screenshotSeq = 0;
let perfOverlayOn = false;
// ---- Render-pass debug toggles --------------------------------------------
// Live F5-F8 toggles for the screen-space effects, with an always-on status
// line top-left. Isolates any visual artifact to one pass in a single run
// (this is how the 2026-07 shadow/SSAO bugs were tracked down â€” see
// docs/shadow-cascade-and-ssao-fixes.md). Kept as a standing debug aid.
let dbgSsgi = true;
let dbgSsao = true;
let dbgSsr = true;
let dbgShadow = true;
disableCursor();

// ---- M8 polish: post-FX ---------------------------------------------------
// Called once at startup â€” these are cheap, always-on stylistic passes.
setVignette(0.4, 0.55);    // darken frame edges
setFilmGrain(0.018);       // barely-there noise â€” 0.05+ reads as heavy speckle
                           // over sky/shadow areas (phase-0 calibration).

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
  if (matBuildingMesh.handle > 0) {
    const n = createSceneNode();
    attachModelToNode(n, matBuildingMesh.handle, 0);
    setSceneNodeTrs(n, 0, 0, 0, 0, 1);
    setSceneNodeColor(n, 214, 208, 196);          // plaster base
    setSceneNodeCastShadow(n, false);
    setSceneNodeGiOnly(n, true);
  }
  // Forest trees â€” every primitive of every placed tree. glTF materials
  // ride along through attachModelToNode, so trunks bounce brown and
  // canopies green without per-node colour overrides. (GI proxies are
  // unrotated â€” close enough for bounce lighting.)
  for (let i = 0; i < FOREST_COUNT; i++) {
    const v = treeVariants[FOREST_VAR[i]];
    for (let mIdx = 0; mIdx < TREE_GLB_PARTS; mIdx++) {
      const n = createSceneNode();
      attachModelToNode(n, (v as any).handle, mIdx);
      setSceneNodeTrs(n, FOREST_X[i], FOREST_Y[i], FOREST_Z[i], 0, FOREST_SCALE[i]);
      setSceneNodeCastShadow(n, false);
      setSceneNodeGiOnly(n, true);
    }
  }
}


// ---- Self-test harness ----------------------------------------------------
// When SELFTEST is true the game auto-fires a shot on frame 30, screenshots
// the scene on frame 60, and exits on frame 90. Used while investigating the
// engine's deferred-render green-screen bug â€” kept dormant for future debug.
const SELFTEST = false;
let testFrame = 0;

// ---- WATERTEST harness (temporary diagnostic) -------------------------------
// Auto-starts a run, holds the camera on the river (the yaw the river spans
// along) and wades the player up/down the band at spawn so an external
// capture script can verify the water look + footstep wake without real
// input. Wading stops after 20 s of uptime so wake decay can be captured
// too. Same dormancy contract as SELFTEST/PERFTEST: MUST be false in
// shipped builds.
const WATERTEST = false;
// Wall-clock anchor for the scripted walk â€” getTime() at frame 20 already
// includes several seconds of asset loading, so timings are relative to
// the moment the harness starts the run.
let waterTestT0 = -1;

// ---- AITEST harness (temporary diagnostic) ----------------------------------
// Round-9 AI verification: auto-starts the run, keeps the player alive and
// stationary, and logs each live enemy's kind / AI state / distance once a
// second so an external batch run can confirm the per-kind state machines
// (dretch weave, mantis orbitâ†’dartâ†’recover, dragoon windupâ†’charge) actually
// cycle. Same dormancy contract as SELFTEST/WATERTEST/PERFTEST: MUST be
// false in shipped builds.
const AITEST = false;

// ---- COMBATSHOT harness -----------------------------------------------------
// Drives a REAL fight and screenshots it, because the AAA-round systems (VFX,
// decals, recoil, hit-stop, flinch, HUD) can only be judged in combat and the
// game takes the whole screen while it runs. Auto-starts the run, spawns a
// couple of enemies in front of the player, holds the trigger, and captures at
// a few points. Same dormancy contract as the other harnesses: MUST be false in
// shipped builds.
const COMBATSHOT = false;

// ---- PERFTEST harness (temporary diagnostic) --------------------------------
// Bisects the fullscreen slowdown: measures wall-clock FPS over 120-frame
// windows on the title screen (full world renders as the backdrop), toggling
// one pipeline feature per stage. Stage 0 is the shipped config under Fifo
// vsync; every later stage runs Mailbox (uncapped) so the vsync cap can't
// mask differences. The final stage re-enables the shipped config with the
// engine profiler on and dumps the per-pass CPU/GPU table. Prints PERF /
// PERFPASS lines to stdout â€” run batch with output redirected. Flip to false
// (or delete) when the investigation closes.
const PERFTEST = false;
// Mode 0 â€” staged feature bisect on the title screen (deterministic backdrop).
// Mode 1 â€” gameplay timeline: injects a keypress to start the run, keeps the
// player alive, and logs fps / worst-frame / alive-enemy count per 60-frame
// window; the profiler turns on for the final third to get a combat per-pass
// table.
const PERF_MODE = 1;
// false = stay on the title screen (stationary world backdrop â€” used for
// external flicker captures); true = auto-start the run at frame 20.
const PERF_START_GAME = false;
const PERF_SETTLE = 30;    // frames to let a config change settle
const PERF_MEASURE = 120;  // frames per measurement window
const PERF_STAGES = 11;
let perfStage = 0;
let perfStageFrame = 0;
let perfT0 = 0;
let perfDone = false;
let perfDtMax = 0;
let perfWindows = 0;
// Phase brackets for spike attribution (mode 1). A frame is split into:
// begin (loop-around + beginDrawing), A (music/input/physics), B (game
// logic up to the 3D pass), C (3D draws + anim updates), D (2D HUD),
// E (endDrawing = submit/present). On a dt spike the previous frame's
// phase times get dumped.
let perfTTop = 0;
let perfTA = 0;
let perfTB = 0;
let perfTC = 0;
let perfTD = 0;
let perfPrevEnd = 0;
let perfMsBegin = 0;
let perfMsA = 0;
let perfMsB = 0;
let perfMsC = 0;
let perfMsD = 0;
let perfMsE = 0;
let perfPrevAlive = 0;

// Scripted kill for mode 1 â€” mirrors the rifle-kill death path exactly so
// death-triggered work (first die-anim playback, body teleport, sound) can
// be correlated with frame spikes deterministically.
function perfKillOne(): void {
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] > 0) {
      enAlive[i] = 0;
      enDying[i] = 1;
      enDeathT[i] = 0;
      enDeathYaw[i] = 0;
      setBodyPosition(enBody[i], vec3(enX[i], -100, enZ[i]), false);
      playSound(sfxAttack);
      console.log('PERFKILL t=' + getTime().toFixed(2)
        + ' slot=' + i + ' kind=' + enKind[i]);
      return;
    }
  }
}

function perfDumpProfiler(): void {
  const rows = getProfilerOverlay();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const gpuStr = r.gpuUs < 0 ? '-1' : r.gpuUs.toFixed(1);
    console.log('PERFPASS ' + r.label
      + ' cpu_us=' + r.cpuUs.toFixed(1) + ' gpu_us=' + gpuStr);
  }
  const hist = getProfilerFrameHistory();
  let cpuSum = 0;
  let gpuSum = 0;
  let cpuMax = 0;
  let gpuMax = 0;
  for (let i = 0; i < hist.length; i++) {
    cpuSum = cpuSum + hist[i].cpuUs;
    gpuSum = gpuSum + hist[i].gpuUs;
    if (hist[i].cpuUs > cpuMax) cpuMax = hist[i].cpuUs;
    if (hist[i].gpuUs > gpuMax) gpuMax = hist[i].gpuUs;
  }
  if (hist.length > 0) {
    console.log('PERFHIST frames=' + hist.length
      + ' cpu_avg_us=' + (cpuSum / hist.length).toFixed(1)
      + ' cpu_max_us=' + cpuMax.toFixed(1)
      + ' gpu_avg_us=' + (gpuSum / hist.length).toFixed(1)
      + ' gpu_max_us=' + gpuMax.toFixed(1));
  }
  console.log('PERF done');
}

function perfStageName(s: number): string {
  if (s === 0) return 'baseline-fifo-rs0.5';
  if (s === 1) return 'mailbox-rs0.5';
  if (s === 2) return 'mailbox-no-ssgi';
  if (s === 3) return 'mailbox-no-ssao';
  if (s === 4) return 'mailbox-no-ssr';
  if (s === 5) return 'mailbox-no-shadows';
  if (s === 6) return 'mailbox-no-bloom';
  if (s === 7) return 'mailbox-rs0.25';
  if (s === 8) return 'mailbox-rs1.0';
  if (s === 9) return 'mailbox-all-off';
  return 'mailbox-profiler-on';
}

function perfStageApply(s: number): void {
  // Restore the shipped config first so each stage isolates one change.
  setSsgiEnabled(true);
  setSsaoEnabled(true);
  setSsrEnabled(true);
  setShadowsEnabled(true);
  setBloomEnabled(true);
  setRenderScale(0.5);
  setProfilerEnabled(false);
  if (s === 0) { setPresentMode(0); return; }
  setPresentMode(1);
  if (s === 2) setSsgiEnabled(false);
  if (s === 3) setSsaoEnabled(false);
  if (s === 4) setSsrEnabled(false);
  if (s === 5) setShadowsEnabled(false);
  if (s === 6) setBloomEnabled(false);
  if (s === 7) setRenderScale(0.25);
  if (s === 8) setRenderScale(1.0);
  if (s === 9) {
    setSsgiEnabled(false);
    setSsaoEnabled(false);
    setSsrEnabled(false);
    setShadowsEnabled(false);
    setBloomEnabled(false);
  }
  if (s === 10) setProfilerEnabled(true);
}


while (!windowShouldClose()) {
  beginDrawing();
  if (PERFTEST) {
    const nowTop = getTime();
    perfMsBegin = perfPrevEnd > 0 ? (nowTop - perfPrevEnd) * 1000 : 0;
    perfTTop = nowTop;
  }
  const dtReal = getDeltaTime();
  // SH-029 â€” hit-stop. `dt` is what the SIMULATION sees, so a kill briefly
  // freezes the world; `dtReal` keeps driving the feedback decay, the menus and
  // the camera, or a hit-stop would freeze its own recovery.
  const dt = menuOpen() ? 0 : FEEL.applyHitstop(dtReal);
  FEEL.updateFeel(dtReal);
  if (gameState === 1 && !gameOver && !gameWon && !menuOpen()) runElapsed = runElapsed + dt;
  // iOS reports the screen in *pixels*, where macOS reports points (engine
  // EN-024). On a 3x iPhone that makes every hardcoded HUD offset below come
  // out a third of its intended size â€” an unreadable 13px status line on a
  // 2622px-wide screen. Rather than rescale forty draw calls, lay the HUD out
  // in a fixed ~1000-unit-wide logical space and let the 2D camera scale the
  // whole pass (see the beginMode2DRaw below). sw/sh are that logical space;
  // swPx/shPx stay the real pixels, which is what touch coordinates arrive in.
  const swPx = getScreenWidth();
  const shPx = getScreenHeight();
  const uiScale = MOBILE ? swPx / 1000 : 1;
  const sw = swPx / uiScale;
  const sh = shPx / uiScale;
  updateMusicStream(gameState === 0 ? musicMenu : musicAmbient);

  // Tab toggles cursor capture so you can free the mouse to screenshot etc.
  if (isKeyPressed(Key.TAB)) {
    cursorLocked = !cursorLocked;
    if (cursorLocked) disableCursor();
    else enableCursor();
  }
  // F12 takes a screenshot (sequential filenames)
  if (isKeyPressed(Key.F12)) {
    screenshotSeq = screenshotSeq + 1;
    takeScreenshot('shooter_' + screenshotSeq + '.png');
  }
  // F3 toggles the Phase 8 profiler overlay.
  if (isKeyPressed(Key.F3)) {
    perfOverlayOn = !perfOverlayOn;
    setProfilerEnabled(perfOverlayOn);
  }
  // Render-pass debug toggles. F5 SSGI, F6 SSAO, F7 SSR, F8 shadows â€” flip
  // each off to see which pass owns a visual artifact. Status line in the HUD.
  if (isKeyPressed(Key.F5)) { dbgSsgi = !dbgSsgi; setSsgiEnabled(dbgSsgi); }
  if (isKeyPressed(Key.F6)) { dbgSsao = !dbgSsao; setSsaoEnabled(dbgSsao); }
  if (isKeyPressed(Key.F7)) { dbgSsr = !dbgSsr; setSsrEnabled(dbgSsr); }
  if (isKeyPressed(Key.F8)) { dbgShadow = !dbgShadow; setShadowsEnabled(dbgShadow); }

  const input = readInput(dtReal);
  testFrame = testFrame + 1;

  // ---- SH-038: pause + menus -------------------------------------------
  // Esc / Start opens the pause menu mid-fight; the sim freezes (dt = 0 above)
  // but the world keeps rendering behind the dim, so you can see what you
  // paused. Audio keeps running deliberately â€” a silent pause is jarring.
  if (input.pausePressed && gameState === 1 && !gameOver && !gameWon) {
    if (menuOpen()) {
      closeMenu();
      if (cursorLocked) disableCursor();
    } else {
      openPause();
      enableCursor();
    }
  }
  if (menuOpen()) {
    const act = updateMenu(dtReal, sw, sh, uiScale);
    if (act === 1) {                      // ACT_RESUME
      if (cursorLocked) disableCursor();
    } else if (act === 2) {               // ACT_RESTART
      resetRun();
      if (cursorLocked) disableCursor();
    } else if (act === 3) {               // ACT_QUIT
      break;
    } else if (act === 4) {               // ACT_LEVEL — chosen, needs a relaunch
      // The whole world (colliders, heightfield, 20k grass instances, 267 GI
      // proxies, the forest's trunk bodies) is built once at startup, so
      // swapping levels in place means tearing all of it down. Until EN-032's
      // async load makes that seamless, be honest: the choice is saved and the
      // next launch is in it.
      levelChangeT = 4.0;
    }
  }

  // PERFTEST stage driver â€” see the harness block above the loop.
  if (PERFTEST && !perfDone && PERF_MODE === 0) {
    if (perfStageFrame === 0) perfStageApply(perfStage);
    perfStageFrame = perfStageFrame + 1;
    if (perfStageFrame === PERF_SETTLE) perfT0 = getTime();
    if (perfStageFrame === PERF_SETTLE + PERF_MEASURE) {
      const wall = getTime() - perfT0;
      const fps = PERF_MEASURE / wall;
      const msf = 1000 * wall / PERF_MEASURE;
      console.log('PERF ' + perfStageName(perfStage)
        + ' fps=' + fps.toFixed(1) + ' ms=' + msf.toFixed(2));
      if (perfStage === PERF_STAGES - 1) {
        perfDumpProfiler();
        perfDone = true;
      } else {
        perfStage = perfStage + 1;
        perfStageFrame = 0;
      }
    }
  }
  if (PERFTEST && !perfDone && PERF_MODE === 1) {
    // Start the run once the mouse-settle guard has passed (mirrors the
    // title-screen input handler), then hold the player immortal so the
    // timeline never hits the game-over overlay.
    if (PERF_START_GAME && testFrame === 20 && gameState === 0) {
      gameState = 1;
      stopMusic(musicMenu);
      playMusic(musicAmbient);
      waveBreakTimer = WAVE_BREAK_DELAY;
    }
    playerHP = PLAYER_HP_MAX;
    gameOver = false;
    // Spike attribution: dt covers the previous frame, so dump the phase
    // brackets recorded during it (plus this frame's beginDrawing time).
    if (dt > 0.1 && perfPrevEnd > 0) {
      console.log('PERFSPIKE t=' + getTime().toFixed(2)
        + ' dt_ms=' + (dt * 1000).toFixed(1)
        + ' begin_ms=' + perfMsBegin.toFixed(1)
        + ' A_ms=' + perfMsA.toFixed(1)
        + ' B_ms=' + perfMsB.toFixed(1)
        + ' C_ms=' + perfMsC.toFixed(1)
        + ' D_ms=' + perfMsD.toFixed(1)
        + ' E_ms=' + perfMsE.toFixed(1)
        + ' alive=' + countAlive());
    }
    const perfAliveNow = countAlive();
    if (perfAliveNow !== perfPrevAlive) {
      console.log('PERFALIVE t=' + getTime().toFixed(2)
        + ' alive=' + perfAliveNow + ' wave=' + waveIdx);
      perfPrevAlive = perfAliveNow;
    }
    // Warm the death-thud sound early so later kill hitches can't be the
    // audio path; then kill one enemy every 3 windows to march the waves
    // forward and correlate deaths with spikes.
    if (perfStageFrame === 30 && perfWindows === 8) playSound(sfxAttack);
    if (perfStageFrame === 30 && perfWindows >= 12 && perfWindows % 3 === 0) {
      perfKillOne();
    }
    // In-engine flicker arbitration: swapchain screenshots (now that
    // takeScreenshot works on Windows) â€” 4 consecutive frames at 6
    // sample points. Consecutive-frame diffs catch real frame-to-frame
    // change; cross-window diffs catch slower state alternation. The
    // desktop-capture path (DWM) is bypassed entirely.
    //
    // ...except takeScreenshot() does NOT work on Windows: the TS call never
    // reaches the native FFI (engine EN-038), so this block has been quietly
    // capturing nothing the whole time. Left in place — it is correct the day
    // EN-038 is fixed — but use tools/shot-window.ps1 until then.
    if (perfWindows >= 6 && perfWindows <= 21 && perfWindows % 3 === 0
        && perfStageFrame >= 10 && perfStageFrame < 14) {
      takeScreenshot('tools/.testout/eng_w' + perfWindows
        + '_f' + perfStageFrame + '.png');
    }
    if (perfWindows === 25 && perfStageFrame === 1) setProfilerEnabled(true);
    perfStageFrame = perfStageFrame + 1;
    if (perfStageFrame === 1) { perfT0 = getTime(); perfDtMax = 0; }
    if (perfStageFrame > 1 && dt > perfDtMax) perfDtMax = dt;
    if (perfStageFrame === 61) {
      const wall = getTime() - perfT0;
      console.log('PERFT t=' + getTime().toFixed(1)
        + ' fps=' + (60 / wall).toFixed(1)
        + ' avg_ms=' + (1000 * wall / 60).toFixed(2)
        + ' max_ms=' + (perfDtMax * 1000).toFixed(1)
        + ' alive=' + countAlive()
        + ' wave=' + waveIdx);
      perfStageFrame = 0;
      perfWindows = perfWindows + 1;
      if (perfWindows === 35) {
        perfDumpProfiler();
        perfDone = true;
      }
    }
  }
  // Selftest: drive the player forward so screenshots can verify
  // walk direction. Runs before the player controller update so
  // the override actually reaches updatePlayerController.
  if (SELFTEST && testFrame >= 20) input.moveZ = -1;
  // Watertest: start the run, aim down the river, wade back and forth
  // along it (direction swaps every ~1.2 s; the river spans X so the
  // camera-forward walk stays inside the band). See harness block above.
  if (WATERTEST) {
    if (testFrame === 20 && gameState === 0) {
      gameState = 1;
      stopMusic(musicMenu);
      playMusic(musicAmbient);
    }
    // Round-6 verification: waves ENABLED so enemy size/facing/shadows can
    // be judged in the captures. (Re-suppress with waveBreakTimer = 9999
    // when a run needs an unshoved scripted walk.)
    if (testFrame === 30) {
      for (let k = 0; k < 5; k++) {
        const bb = getModelBounds(mdlAliens[k]);
        console.log('BOUNDS ' + KIND_NAME[k]
          + ' h=' + (bb.max.y - bb.min.y).toFixed(2)
          + ' w=' + (bb.max.x - bb.min.x).toFixed(2)
          + ' d=' + (bb.max.z - bb.min.z).toFixed(2)
          + ' scaled_h=' + ((bb.max.y - bb.min.y) * KIND_SCALE[k]).toFixed(2));
      }
    }
    playerHP = PLAYER_HP_MAX;
    gameOver = false;
    // Face -Z: spawn is (0, 20), the river band is z 9.5..14.5, so the
    // river lies dead ahead and the camera looks across it at the far
    // bank. moveZ = -1 is forward (same convention as SELFTEST).
    CAM[0] = 0;
    CAM[1] = 0.42;
    input.moveX = 0;
    input.moveZ = 0;
    if (gameState === 1) {
      if (waterTestT0 < 0) waterTestT0 = getTime();
      const tw = getTime() - waterTestT0;
      // Shadow check: stay ON GRASS at spawn (the water shader receives
      // no sun shadow, so a wading player can't show one). Restore the
      // walk below for water-look captures.
      // if (tw < 1.3) {
      //   input.moveZ = -1;                     // walk into the river (~8 m)
      // } else if (tw < 20) {
      //   input.moveX = Math.sin(tw * 2.6) > 0 ? 1 : -1;  // strafe along the band
      // }
      if (tw < 0) { input.moveZ = 0; }        // keep tw referenced
      if ((testFrame % 120) === 0) console.log('WATERTEST fps=' + getFPS());
    }
  }
  // AITEST â€” see the harness block above WATERTEST.
  if (AITEST) {
    if (testFrame === 20 && gameState === 0) {
      gameState = 1;
      stopMusic(musicMenu);
      playMusic(musicAmbient);
    }
    playerHP = PLAYER_HP_MAX;   // immortal observer
    gameOver = false;
    CAM[0] = 0;
    CAM[1] = 0.55;              // high-ish pitch â€” survey the field
    input.moveX = 0;
    input.moveZ = 0;
    if (gameState === 1 && (testFrame % 60) === 0) {
      const ppT = playerPosition();
      let line = 'AITEST f=' + testFrame;
      for (let i = 0; i < MAX_ENEMIES; i++) {
        if (enAlive[i] === 0) continue;
        const dT = Math.hypot(ppT.x - enX[i], ppT.z - enZ[i]);
        line = line + ' [' + i + ':k' + enKind[i] + ' st' + enAIState[i]
             + ' d' + dT.toFixed(1)
             + ' x' + enX[i].toFixed(1) + ' z' + enZ[i].toFixed(1) + ']';
      }
      console.log(line);
    }
  }
  // Only apply mouse look when cursor is captured â€” avoids jumpy yaw/pitch
  // when the user is moving the mouse outside the window. The first ~10
  // frames after window creation often report giant mouse deltas (system
  // cursor settling into the captured state), which can fling the camera
  // to a useless angle before the player even sees the scene.
  if (cursorLocked && testFrame > 10 && !menuOpen()) {
    // SH-039 â€” pad aim assist: slow the look stick inside a narrow cone of the
    // nearest enemy. Not magnetism; the stick still does all the aiming.
    let assist = 1;
    if (input.padActive) {
      const ppA = playerPosition();
      const cyA = Math.cos(CAM[1]);
      const fxA = Math.sin(CAM[0]) * cyA;
      const fzA = -Math.cos(CAM[0]) * cyA;
      let bestCos = -1;
      for (let i = 0; i < MAX_ENEMIES; i++) {
        if (enAlive[i] === 0) continue;
        const ex = enX[i] - ppA.x;
        const ez = enZ[i] - ppA.z;
        const el = Math.sqrt(ex * ex + ez * ez);
        if (el < 0.5) continue;
        const c = (ex / el) * fxA + (ez / el) * fzA;
        if (c > bestCos) bestCos = c;
      }
      assist = aimAssistScale(bestCos);
    }
    CAM[0] = CAM[0] + input.lookX * assist;
    const np = CAM[1] + input.lookY * assist;
    CAM[1] = np < TP_PITCH_MIN ? TP_PITCH_MIN : (np > TP_PITCH_MAX ? TP_PITCH_MAX : np);
  }

  const playing = gameState === 1 && !gameOver && !gameWon && !menuOpen();

  // Restart on R when the run has ended (died or won); otherwise R reloads.
  // Reload is TIMED now (SH-028) â€” you can be punished for it.
  if (input.reloadPressed) {
    if (gameOver || gameWon) resetRun();
    else if (playing && !WPN.isReloading()) {
      const before = WPN.isReloading();
      WPN.beginReload();
      if (!before && WPN.isReloading()) MIX.reloadStart();
    }
  }
  // Weapon selection. Number keys pick directly; the touch/pad button cycles.
  if (isKeyPressed(Key.ONE))   WPN.selectWeapon(WPN.W_RIFLE);
  if (isKeyPressed(Key.TWO))   WPN.selectWeapon(WPN.W_BLASTER);
  if (isKeyPressed(Key.THREE)) WPN.selectWeapon(WPN.W_CHAIN);
  if (isKeyPressed(Key.FOUR))  WPN.selectWeapon(WPN.W_CANNON);
  if (input.swapWeapon) WPN.nextWeapon();

  // SH-032 â€” dodge. Commits the player for 0.25 s, so it is a decision, not a
  // free extra speed. Direction is the movement input, or straight back if the
  // stick is centred (a panic dodge should always do *something*).
  if (playing && input.dodgePressed) {
    const yawD = CAM[0];
    const fwdD = vec3(Math.sin(yawD), 0, -Math.cos(yawD));
    const rgtD = vec3(Math.cos(yawD), 0, Math.sin(yawD));
    let ddx = fwdD.x * -input.moveZ + rgtD.x * input.moveX;
    let ddz = fwdD.z * -input.moveZ + rgtD.z * input.moveX;
    if (Math.abs(ddx) + Math.abs(ddz) < 0.05) { ddx = -fwdD.x; ddz = -fwdD.z; }
    if (startDodge(ddx, ddz)) {
      WPN.cancelReload();
      FEEL.addFovKick(4);
      FEEL.addTrauma(0.10);
    }
  }

  // Freeze player movement while dead, paused, or after victory; physics steps.
  if (playing) {
    const yawNow = CAM[0];
    const fwd = vec3(Math.sin(yawNow), 0, -Math.cos(yawNow));
    const rgt = vec3(Math.cos(yawNow), 0, Math.sin(yawNow));
    // Sprint cancels aiming and is cancelled by firing â€” you cannot run and
    // shoot accurately, which is what makes sprint a real trade.
    const wantSprint = input.sprintDown && !input.aimDown && !input.fireDown;
    updatePlayerController(dt, input.moveX, input.moveZ, fwd, rgt, input.jump, wantSprint);
    if (wantSprint && playerSpeed() > 6.5) FEEL.addFovKick(6 * dt * 4);
  }
  stepPhysics(physics, dt);

  // SH-028 â€” weapon timers (cooldown, reload, spread recovery, aim/spool).
  {
    const wasReloading = WPN.isReloading();
    WPN.updateWeapons(dt, playing && input.fireDown, playing && input.aimDown);
    if (wasReloading && !WPN.isReloading()) MIX.reloadEnd();
    if (playing) WPN.autoReloadIfEmpty();
  }
  SCORE.updateScore(dt);
  if (PERFTEST) perfTA = getTime();

  // Phase 7 â€” footstep / water-entry splats. When the player is
  // inside the river band, submit an impulse at their XZ every
  // frame they're moving. The compute pass decays these over ~2s
  // so the water shader can render persistent ripples.
  {
    const pp = playerPosition();
    const inRiver = pp.z > WATER_CZ - WATER_D * 0.5 &&
                    pp.z < WATER_CZ + WATER_D * 0.5 &&
                    Math.abs(pp.x) < WATER_W * 0.5;
    const moving = Math.abs(input.moveX) + Math.abs(input.moveZ) > 0.1;
    splatCooldown -= dt;
    if (inRiver && moving && splatCooldown <= 0) {
      splatImpulse(pp.x, pp.z, 1.0, 0.4);
      splatCooldown = 0.15;
    }

    // SH-003 â€” footsteps. Distance-accumulated, so the cadence follows sprint
    // and walk for free. Firing a step also kicks dust (SH-033), which is the
    // pairing that sells a footfall: you hear it AND the ground reacts.
    if (playing) {
      const surface = inRiver ? 2 : 0;
      const stepped = MIX.updateFootsteps(
        playerSpeed() * dt, surface, playerGrounded(), pp.x, pp.y - 0.9, pp.z);
      if (stepped && !inRiver) {
        VFX.emitFootDust(pp.x, pp.y - 0.92, pp.z, playerSpeed() > 7 ? 3 : 1);
      }
      if (stepped && inRiver) VFX.emitSplash(pp.x, WATER_Y, pp.z);
    }

    // SH-035 â€” reverb zone. `enclosure` rises as the player nears the building
    // footprint, so a firefight by the walls sounds like a firefight by the
    // walls. Ramped, not switched (a hard cut clicks on any tail in flight).
    const bdx = Math.abs(pp.x - 0);
    const bdz = Math.abs(pp.z - (-14));
    const near = Math.max(bdx / 12, bdz / 10);
    const enclosure = near < 1 ? (1 - near) : 0;
    MIX.updateReverbZone(dtReal, enclosure);
  }

  // Smooth orbit camera follow after physics step.
  // Inline orbit-camera follow with wall-aware distance.
  {
    const pp0 = playerPosition();
    // SH-029 â€” shake/flinch are applied to the camera basis, NOT to CAM[0]/[1]
    // themselves. Writing them back into the player's aim would mean recoil
    // permanently walked your crosshair and shake would fight your mouse.
    const tShake = getTime();
    const ya = CAM[0] + FEEL.shakeYaw(tShake);
    const pi = CAM[1] + FEEL.shakePitch(tShake);
    const cpi = Math.cos(pi), spi = Math.sin(pi);
    const fX = pp0.x;
    const fY = pp0.y + TP_EYE_HEIGHT;
    const fZ = pp0.z;
    // Direction from focus to ideal camera position.
    const dxRaw = -Math.sin(ya) * cpi;
    const dyRaw =  Math.sin(pi);
    const dzRaw =  Math.cos(ya) * cpi;
    // Raycast from the focus point outward toward the orbit
    // direction. If anything (wall, tree trunk, terrain) is closer
    // than TP_ORBIT_DIST, shorten the orbit so the camera zooms
    // in instead of clipping through geometry. Leave a small skin
    // so we don't kiss the wall exactly.
    // Round-2 audit (F11): STATIC geometry only. Enemy bodies are in the
    // MOVING layer; letting them shorten the orbit pulled the camera
    // inside the mob whenever the player got surrounded â€” near-plane
    // clipping filled the screen with polygon soup. Enemies briefly
    // occluding the camera reads far better than being inside them.
    // SH-028 â€” shoulder aim pulls the camera in from 6.0 m to 2.6 m. The
    // wall-aware raycast below still applies, so aiming into a corner behaves.
    const aimT = WPN.aimBlend();
    const wantDist = TP_ORBIT_DIST + (2.6 - TP_ORBIT_DIST) * aimT;
    let orbitDist = wantDist;
    const hit = raycast(physics,
      vec3(fX, fY, fZ),
      vec3(dxRaw, dyRaw, dzRaw),
      wantDist, 1 << Layer.NON_MOVING);
    if (hit !== null) {
      orbitDist = Math.max(0.8, hit.fraction * wantDist - 0.25);
    }
    const wX = fX + dxRaw * orbitDist;
    const wY = fY + dyRaw * orbitDist;
    const wZ = fZ + dzRaw * orbitDist;
    if (CAM[8] === 0) {
      CAM[2] = wX; CAM[3] = wY; CAM[4] = wZ;
      CAM[5] = fX; CAM[6] = fY; CAM[7] = fZ;
      CAM[8] = 1;
    } else {
      // Snap inward fast (zoom-in is responsive) but lerp outward
      // smoothly so the camera doesn't suddenly fly back when the
      // player rounds a corner.
      const desired = vec3(wX, wY, wZ);
      const curDist = Math.hypot(CAM[2] - fX, CAM[3] - fY, CAM[4] - fZ);
      const tIn  = 1 - Math.exp(-TP_SMOOTH * 2.5 * dt);
      const tOut = 1 - Math.exp(-TP_SMOOTH * dt);
      const t = orbitDist < curDist ? tIn : tOut;
      CAM[2] = CAM[2] + (desired.x - CAM[2]) * t;
      CAM[3] = CAM[3] + (desired.y - CAM[3]) * t;
      CAM[4] = CAM[4] + (desired.z - CAM[4]) * t;
      const tF = 1 - Math.exp(-TP_SMOOTH * dt);
      CAM[5] = CAM[5] + (fX - CAM[5]) * tF;
      CAM[6] = CAM[6] + (fY - CAM[6]) * tF;
      CAM[7] = CAM[7] + (fZ - CAM[7]) * tF;
    }
  }
  playerAnimT = playerAnimT + dt;

  // ---- SH-027 / EN-033: where the gun actually is ------------------------
  // The weapon transform is computed ONCE per frame and reused by the draw, the
  // muzzle flash, the tracer and the shot ray â€” so what you see and what you
  // hit come from the same number. Previously the shot used a hardcoded
  // shoulder offset while the cube was drawn somewhere else entirely.
  //
  // If the player skeleton exposes a hand joint, the weapon rides it (so it
  // follows the walk/attack animation); otherwise it falls back to the fixed
  // shoulder offset, which is what the old cube did.
  {
    const ppW = playerPosition();
    const modelYaw = Math.PI / 2 - CAM[0];   // engine applies skinned rotY inverted
    const syW = Math.sin(CAM[0]), cyW = Math.cos(CAM[0]);
    // Aim pitch, so the gun points where the camera does.
    const pitch = -CAM[1];

    let baseX = ppW.x + cyW * 0.30 + syW * 0.35;
    let baseY = ppW.y + 0.95;
    let baseZ = ppW.z + syW * 0.30 - cyW * 0.35;

    if (playerHandJoint >= 0) {
      // Joint transform is model-space; lift it by the same (scale, pos, yaw)
      // we handed animUpdate.
      const jx = jointWorld(animPlayer, playerHandJoint, 12);
      const jy = jointWorld(animPlayer, playerHandJoint, 13);
      const jz = jointWorld(animPlayer, playerHandJoint, 14);
      const cM = Math.cos(modelYaw), sM = Math.sin(modelYaw);
      const rx = jx * cM + jz * sM;
      const rz = -jx * sM + jz * cM;
      baseX = ppW.x + rx * PLAYER_SCALE;
      baseY = ppW.y + PLAYER_MODEL_Y_OFFSET + jy * PLAYER_SCALE;
      baseZ = ppW.z + rz * PLAYER_SCALE;
    }

    weaponX = baseX;
    weaponY = baseY;
    weaponZ = baseZ;

    // Barrel direction = camera forward. The muzzle is that far down the
    // barrel from the weapon's origin (build-weapons.ts prints these).
    const cp = Math.cos(pitch);
    const fx = syW * cp;
    const fy = Math.sin(pitch);
    const fz = -cyW * cp;
    const mz = WEAPON_MUZZLE_Z[WPN.currentWeapon()];
    muzzleX = baseX + fx * mz;
    muzzleY = baseY + fy * mz;
    muzzleZ = baseZ + fz * mz;
    weaponYaw = CAM[0];
    weaponPitch = pitch;
  }

  // ---- Enemy AI + wave director (M5 / M6, Round-9 rework) ---------------
  // Old behaviour was a straight beeline + melee â€” every kind identical.
  // Now each kind runs its own steering flavour + state machine:
  //   dretch   â€” skittering swarm: full speed but weaving hard around the
  //              direct line, so packs wash around the player.
  //   mantis   â€” circler: orbits at ~7 m, darts in for one hit, backs off.
  //   marauder â€” flanker: approaches on a wide curve toward your side.
  //   dragoon  â€” pouncer: rooted 0.65 s telegraph (roar), then a locked-
  //              direction 3.4Ã— charge you can sidestep.
  //   tyrant   â€” bulldozer: momentum builds in a straight line but the
  //              turn rate is capped, so dodging works and it has to
  //              wheel around after an overrun.
  // Shared: pairwise separation (no model-pile), trunk-circle avoidance
  // (enemies are kinematic â€” Jolt won't resolve their contacts), terrain
  // following, and a turn-rate-limited heading the draw code renders.
  if (playing) {
    const pp = playerPosition();
    const tAI = getTime();
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (enAlive[i] === 0) continue;
      const k = enKind[i];
      const dx = pp.x - enX[i];
      const dz = pp.z - enZ[i];
      const dist = Math.sqrt(dx * dx + dz * dz);
      const invD = dist > 0.001 ? 1 / dist : 0;
      const toPX = dx * invD;                    // unit vector to the player
      const toPZ = dz * invD;
      if (enStateT[i] > 0) enStateT[i] = enStateT[i] - dt;
      if (enFlinchLock[i] > 0) enFlinchLock[i] = enFlinchLock[i] - dt;
      // Damage window for the heavies' stagger meter.
      if (enDmgTimer[i] > 0) {
        enDmgTimer[i] = enDmgTimer[i] - dt;
        if (enDmgTimer[i] <= 0) enDmgWindow[i] = 0;
      }

      // Steering output: desired velocity (m/s) + what to face.
      let vx = 0;
      let vz = 0;
      let faceX = toPX;
      let faceZ = toPZ;

      // SH-030 â€” a flinching enemy is rooted. This is the whole point: it is
      // the reward for landing shots, and the window in which you can push.
      if (enAIState[i] === AI_FLINCH) {
        if (enStateT[i] <= 0) {
          enAIState[i] = AI_APPROACH;
          enStateT[i] = 0;
        }
        // No steering this frame â€” fall through to the shared tail below with
        // vx = vz = 0.
      } else if (k === 0) {
        // DRETCH â€” weave amplitude fades out inside 6 m so the final
        // lunge still connects; i*2.399 desyncs pack members.
        const weave = Math.sin(tAI * 3.0 + i * 2.399) * 0.85
                    * Math.min(1, Math.max(0, (dist - 2.5) / 4));
        const cw = Math.cos(weave), sw = Math.sin(weave);
        if (dist > KIND_MELEE[k] * 0.85) {
          vx = (toPX * cw - toPZ * sw) * KIND_SPEED[k] * 1.15;
          vz = (toPX * sw + toPZ * cw) * KIND_SPEED[k] * 1.15;
        }
      } else if (k === 1) {
        // MANTIS â€” approach â†’ orbit â†’ dart â†’ back off.
        if (enAIState[i] === AI_APPROACH) {
          if (dist < 9) {
            enAIState[i] = AI_ORBIT;
            enStateT[i] = 1.2 + Math.random() * 1.4;
          } else {
            vx = toPX * KIND_SPEED[k];
            vz = toPZ * KIND_SPEED[k];
          }
        } else if (enAIState[i] === AI_ORBIT) {
          // Tangential motion + gentle spring toward the 7 m ring.
          const inward = Math.max(-1, Math.min(1, (dist - 7) * 0.3));
          vx = (-toPZ * enOrbitDir[i] + toPX * inward) * KIND_SPEED[k] * 0.9;
          vz = ( toPX * enOrbitDir[i] + toPZ * inward) * KIND_SPEED[k] * 0.9;
          if (dist > 14) enAIState[i] = AI_APPROACH;
          else if (enStateT[i] <= 0) {
            enAIState[i] = AI_CHARGE;              // dart in
            enStateT[i] = 1.1;
            enChargeX[i] = toPX;
            enChargeZ[i] = toPZ;
          }
        } else if (enAIState[i] === AI_CHARGE) {
          // Mostly locked, slight homing so it isn't trivially cheesed.
          const hx = enChargeX[i] * 0.8 + toPX * 0.2;
          const hz = enChargeZ[i] * 0.8 + toPZ * 0.2;
          const hl = Math.sqrt(hx * hx + hz * hz);
          enChargeX[i] = hx / hl;
          enChargeZ[i] = hz / hl;
          vx = enChargeX[i] * KIND_SPEED[k] * 1.85;
          vz = enChargeZ[i] * KIND_SPEED[k] * 1.85;
          faceX = enChargeX[i]; faceZ = enChargeZ[i];
          if (enStateT[i] <= 0) { enAIState[i] = AI_RECOVER; enStateT[i] = 0.8; }
        } else {
          // AI_RECOVER â€” back away facing the player, then re-approach.
          vx = (-toPX + -toPZ * enOrbitDir[i] * 0.5) * KIND_SPEED[k] * 0.8;
          vz = (-toPZ +  toPX * enOrbitDir[i] * 0.5) * KIND_SPEED[k] * 0.8;
          if (enStateT[i] <= 0) enAIState[i] = AI_APPROACH;
        }
      } else if (k === 2) {
        // MARAUDER â€” flank: aim beside the player, the offset shrinking
        // as it closes, so it comes in on a curve toward your side.
        const m = Math.min(6, Math.max(0, dist - 3) * 0.5);
        const aimX = pp.x - toPZ * enOrbitDir[i] * m - enX[i];
        const aimZ = pp.z + toPX * enOrbitDir[i] * m - enZ[i];
        const al = Math.sqrt(aimX * aimX + aimZ * aimZ);
        if (dist > KIND_MELEE[k] * 0.85 && al > 0.001) {
          vx = (aimX / al) * KIND_SPEED[k];
          vz = (aimZ / al) * KIND_SPEED[k];
        }
      } else if (k === 3) {
        // DRAGOON â€” pounce with a rooted, audible telegraph.
        if (enAIState[i] === AI_APPROACH) {
          if (dist > KIND_MELEE[k] * 0.9) {
            vx = toPX * KIND_SPEED[k];
            vz = toPZ * KIND_SPEED[k];
          }
          if (dist < 12 && dist > 4.5 && enStateT[i] <= 0) {
            enAIState[i] = AI_WINDUP;
            enStateT[i] = 0.65;
            playSound3D(sfxAlienAttack[k], enX[i], enY[i] + 1, enZ[i]);  // roar
          }
        } else if (enAIState[i] === AI_WINDUP) {
          // Rooted â€” the player's dodge window.
          if (enStateT[i] <= 0) {
            enAIState[i] = AI_CHARGE;
            enStateT[i] = 1.2;
            enChargeX[i] = toPX;
            enChargeZ[i] = toPZ;
          }
        } else if (enAIState[i] === AI_CHARGE) {
          vx = enChargeX[i] * KIND_SPEED[k] * 3.4;   // fully locked â€” dodgeable
          vz = enChargeZ[i] * KIND_SPEED[k] * 3.4;
          faceX = enChargeX[i]; faceZ = enChargeZ[i];
          if (dist <= KIND_MELEE[k] || enStateT[i] <= 0) {
            enAIState[i] = AI_RECOVER;
            enStateT[i] = 1.4;
          }
        } else {
          // AI_RECOVER â€” winded: creep, then re-arm the pounce.
          if (dist > KIND_MELEE[k] * 0.9) {
            vx = toPX * KIND_SPEED[k] * 0.6;
            vz = toPZ * KIND_SPEED[k] * 0.6;
          }
          if (enStateT[i] <= 0) {
            enAIState[i] = AI_APPROACH;
            enStateT[i] = 1.5 + Math.random();       // pounce cooldown
          }
        }
      } else {
        // TYRANT â€” heading-locked momentum. Speed builds only while the
        // player sits near its nose; hard turns bleed it off, so a
        // sidestep leaves 3+ tons wheeling around for another pass.
        const tgtYaw = Math.atan2(toPX, -toPZ);
        enHeading[i] = turnToward(enHeading[i], tgtYaw, 1.5 * dt);
        let err = tgtYaw - enHeading[i];
        while (err > Math.PI)  err = err - Math.PI * 2;
        while (err < -Math.PI) err = err + Math.PI * 2;
        const aligned = Math.cos(err);
        const accel = aligned > 0.8 ? 0.55 : -1.4;
        enSpeedMul[i] = Math.max(0.7, Math.min(2.6, enSpeedMul[i] + accel * dt));
        const hdX = Math.sin(enHeading[i]);
        const hdZ = -Math.cos(enHeading[i]);
        if (dist > KIND_MELEE[k] * 0.8 || aligned < 0.5) {
          vx = hdX * KIND_SPEED[k] * enSpeedMul[i];
          vz = hdZ * KIND_SPEED[k] * enSpeedMul[i];
        }
        faceX = hdX; faceZ = hdZ;
      }

      // Separation â€” pack members shoulder each other apart instead of
      // stacking into one model pile.
      for (let j = 0; j < MAX_ENEMIES; j++) {
        if (j === i || enAlive[j] === 0) continue;
        const sx = enX[i] - enX[j];
        const sz = enZ[i] - enZ[j];
        const sd2 = sx * sx + sz * sz;
        const minS = (KIND_HX[k] + KIND_HX[enKind[j]]) * 0.7;
        if (sd2 < minS * minS && sd2 > 0.0001) {
          const sd = Math.sqrt(sd2);
          const push = ((minS - sd) / minS) * 3.0;
          vx = vx + (sx / sd) * push;
          vz = vz + (sz / sd) * push;
        }
      }

      // Integrate, then slide the tentative position out of any trunk
      // circle â€” projection keeps the tangential component, so enemies
      // skim around trees instead of head-butting them.
      let nx = enX[i] + vx * dt;
      let nz = enZ[i] + vz * dt;
      const bodyR = KIND_HX[k] * 0.55;
      for (let o = 0; o < OBST_COUNT; o++) {
        const odx = nx - OBST_X[o];
        const odz = nz - OBST_Z[o];
        const minD = OBST_R[o] + bodyR;
        const od2 = odx * odx + odz * odz;
        if (od2 < minD * minD && od2 > 0.000001) {
          const od = Math.sqrt(od2);
          nx = OBST_X[o] + (odx / od) * minD;
          nz = OBST_Z[o] + (odz / od) * minD;
        }
      }
      // Record the realised velocity BEFORE the obstacle projection is
      // forgotten â€” the draw pass matches animation playback to it.
      vxLast[i] = vx;
      vzLast[i] = vz;
      enX[i] = nx;
      enZ[i] = nz;
      // Follow the terrain surface â€” enemies are steered in XZ, so
      // their Y must track the heightfield or they walk into hills.
      enY[i] = terrainHeightAt(nx, nz);
      setBodyPosition(enBody[i],
        vec3(nx, enY[i] + KIND_Y_OFF[k], nz), true);

      // Turn-rate-limited facing (tyrant already steered its own).
      if (k !== 4) {
        const wantYaw = Math.atan2(faceX, -faceZ);
        enHeading[i] = turnToward(enHeading[i], wantYaw, 7.0 * dt);
      }

      // Melee â€” hit-and-run kinds break off after connecting.
      if (dist <= KIND_MELEE[k] && enAttackCD[i] <= 0 &&
          enAIState[i] !== AI_WINDUP && enAIState[i] !== AI_FLINCH) {
        playerHP = playerHP - KIND_DMG[k];
        damageFlashT = 0.5;
        enAttackCD[i] = KIND_CD[k];
        // SH-029 â€” being hit is now unmistakable with your eyes on the
        // crosshair: the camera flinches AWAY from the attacker, the screen
        // flashes, and the music ducks so you hear the hit land.
        const hitYaw = Math.atan2(toPX, -toPZ);
        let rel = hitYaw - CAM[0];
        while (rel > Math.PI) rel = rel - Math.PI * 2;
        while (rel < -Math.PI) rel = rel + Math.PI * 2;
        lastHitAngle = rel;
        lastHitT = 1.4;
        FEEL.addTrauma(0.30 + KIND_DMG[k] * 0.006);
        FEEL.flinch(-Math.sign(rel) * 0.035, -0.02);
        FEEL.damageFlash(1);
        MIX.duckMusicOnDamage();
        gamepadRumble(0.55, 0.35, 0.18);
        // Per-kind bite/claw at the attacker's position.
        playSound3D(sfxAlienAttack[k], enX[i], enY[i] + 1, enZ[i]);
        if (k === 1) { enAIState[i] = AI_RECOVER; enStateT[i] = 1.3; }
        if (k === 3) { enAIState[i] = AI_RECOVER; enStateT[i] = 1.4; }
        if (playerHP <= 0) {
          playerHP = 0;
          if (!gameOver) {
            playSound(sfxPlayerDie[i & 1]);
            FEEL.addTrauma(1.0);
            SCORE.commitRun(0);
            SET.saveSettings();     // persist the best score immediately
          }
          gameOver = true;
        } else {
          playSound(sfxPlayerPain[i & 1]);
        }
      }
      if (enAttackCD[i] > 0) enAttackCD[i] = enAttackCD[i] - dt;
      if (enFlashT[i]   > 0) enFlashT[i]   = enFlashT[i]   - dt;
      enPhase[i] = enPhase[i] + dt;   // seconds into current animation

      // SH-003 â€” the tyrant's footfalls. You should hear (and faintly feel) the
      // big one coming before you see it: the trauma is distance-scaled, so it
      // telegraphs through walls without ever being loud enough to annoy.
      if (k === 4) {
        const spd = Math.sqrt(vx * vx + vz * vz);
        enStepPhase[i] = enStepPhase[i] + spd * dt;
        if (enStepPhase[i] > 2.2) {
          enStepPhase[i] = 0;
          MIX.tyrantStep(enX[i], enY[i], enZ[i]);
          if (dist < 15) FEEL.addTrauma(0.05 * (1 - dist / 15));
          VFX.emitFootDust(enX[i], enY[i] + 0.05, enZ[i], 3);
        }
      }
    }

    // Pickups â€” proximity collect, respawn after delay. The crate refills the
    // weapon it is for; the amount is a column of the weapon table now.
    for (let i = 0; i < PICKUP_COUNT; i++) {
      if (pickupActive[i] === 0) {
        pickupRespawnT[i] = pickupRespawnT[i] - dt;
        if (pickupRespawnT[i] <= 0) pickupActive[i] = 1;
        continue;
      }
      const pdx = pp.x - pickupX[i];
      const pdz = pp.z - pickupZ[i];
      if (pdx * pdx + pdz * pdz < PICKUP_RADIUS * PICKUP_RADIUS) {
        const w = pickupKind[i] === PICKUP_RIFLE ? WPN.W_RIFLE : WPN.W_BLASTER;
        WPN.addAmmo(w, WPN.W_PICKUP_AMT[w]);
        // Ammo you can't use is no reward: top up whatever else you carry too.
        for (let q = 2; q < WPN.WEAPON_COUNT; q++) {
          if (WPN.isUnlocked(q)) WPN.addAmmo(q, Math.floor(WPN.W_PICKUP_AMT[q] * 0.5));
        }
        pickupActive[i] = 0;
        pickupRespawnT[i] = PICKUP_RESPAWN;
        playSound(sfxPickup);
      }
    }

    // Wave director
    const alive = countAlive();
    MIX.updateMusicIntensity(dtReal, alive, waveBreakTimer <= 0);
    if (waveIdx < wavePlan.length) {
      if (waveBreakTimer > 0) {
        waveBreakTimer = waveBreakTimer - dt;
        if (waveBreakTimer <= 0) SCORE.beginWave(runElapsed);
      } else {
        const waveSize = wavePlan[waveIdx];
        if (waveSpawned < waveSize && alive < MAX_CONCURRENT) {
          spawnTimer = spawnTimer - dt;
          if (spawnTimer <= 0) {
            spawnEnemy();
            spawnTimer = WAVE_SPAWN_DELAY;
          }
        }
        if (waveSpawned >= waveSize && alive === 0) {
          // SH-041 â€” bank the wave: a time bonus for clearing fast, an accuracy
          // bonus for clearing cleanly. Shown on the report card.
          waveBonus = SCORE.endWave(runElapsed);
          waveBonusT = 4.0;
          waveIdx = waveIdx + 1;
          waveSpawned = 0;
          waveBreakTimer = WAVE_BREAK_DELAY;
          if (waveIdx >= wavePlan.length) {
            gameWon = true;
            // Clearing the arena unlocks the next weapon and persists it.
            const nextUnlock = WPN.W_CHAIN;
            if (!WPN.isUnlocked(nextUnlock)) {
              WPN.unlock(nextUnlock);
              SET.setUnlockMask(SET.unlockMask() | (1 << nextUnlock));
              unlockBannerT = 5.0;
            }
            SCORE.commitRun(0);
            SET.saveSettings();
          }
        }
      }
    }
  }

  // testFrame is incremented above the input block so the mouse-settle
  // grace period uses the same counter.
  let forceFire = false;
  if (COMBATSHOT) {
    if (testFrame === 20 && gameState === 0) {
      gameState = 1;
      stopMusic(musicMenu);
      playMusic(musicAmbient);
      SCORE.resetScore();
      runElapsed = 0;
    }
    playerHP = PLAYER_HP_MAX;          // immortal â€” we want the fight, not a death
    gameOver = false;
    waveBreakTimer = 9999;             // suppress the director; we place our own
    CAM[1] = 0.30;
    // Two enemies dead ahead, respawned if killed, so there's always something
    // to shoot at and to bleed on the ground.
    if (testFrame === 30 || (testFrame > 30 && (testFrame % 240) === 0)) {
      for (let s = 0; s < 2; s++) {
        const slot = s * BODIES_PER_KIND;          // dretch, mantis
        const k = enKind[slot];
        enX[slot] = -3 + s * 6;
        enZ[slot] = 14;
        enY[slot] = terrainHeightAt(enX[slot], enZ[slot]);
        enHP[slot] = KIND_HP[k] * 6;               // tanky, so the fight lasts
        enAlive[slot] = 1;
        enDying[slot] = 0;
        enAnimClip[slot] = -1;
        enAttackCD[slot] = 999;                    // don't let them hit back
        enHeading[slot] = Math.PI;
        setBodyPosition(enBody[slot],
          vec3(enX[slot], enY[slot] + KIND_Y_OFF[k], enZ[slot]), true);
      }
    }
    // Face them and hold the trigger. Keep the reserve topped up so the capture
    // isn't three-quarters reload animation.
    if (testFrame > 35) {
      CAM[0] = 0;
      CAM[1] = 0.62;              // above the canopy, looking down at the fight
      forceFire = true;
      WPN.addAmmo(WPN.currentWeapon(), 3);
    }
    if ((testFrame % 40) === 0 && testFrame > 40) {
      console.log('VFX f=' + testFrame
        + ' ready=' + (VFX.vfxReady() ? 1 : 0)
        + ' smoke=' + VFX.debugCount(VFX.SYS_SMOKE)
        + ' spark=' + VFX.debugCount(VFX.SYS_SPARK)
        + ' blood=' + VFX.debugCount(VFX.SYS_BLOOD)
        + ' flash=' + VFX.debugCount(VFX.SYS_FLASH)
        + ' shell=' + VFX.debugCount(VFX.SYS_SHELL)
        + ' decals=' + VFX.debugDecals()
        + ' mats=' + VFX.debugMats());
    }
    if (testFrame === 260) {
      console.log('COMBATSHOT done  score=' + SCORE.score()
        + ' kills=' + SCORE.kills()
        + ' shots=' + SCORE.shotsFired()
        + ' hits=' + SCORE.shotsHit()
        + ' fps=' + getFPS().toFixed(1));
      break;
    }
  }
  if (SELFTEST) {
    waveBreakTimer = 9999;
    if (testFrame < 5) { CAM[0] = 0; CAM[1] = 0.35; CAM[8] = 0; }
    if (testFrame === 5) {
      // Manually spawn ONE dretch off to the side, stays idle.
      enX[0] = -6; enY[0] = 0; enZ[0] = -6;
      enHP[0] = 3; enAlive[0] = 1; enAttackCD[0] = 999;
      setBodyPosition(enBody[0], vec3(-6, KIND_Y_OFF[0], -6), true);
    }
    if (testFrame === 30)  { screenshotSeq++; takeScreenshot('shooter_selftest_' + screenshotSeq + '_t0_5s.png'); }
    if (testFrame === 180) { screenshotSeq++; takeScreenshot('shooter_selftest_' + screenshotSeq + '_t3_0s.png'); }
    if (testFrame === 185) { break; }
  }

  // ---- Fire (SH-028 / SH-033 / SH-042) ----------------------------------
  // Weapon behaviour is a TABLE now (src/weapons.ts): hitscan vs projectile,
  // auto vs tap vs charge, spread growth, recoil. This block is the same for
  // every weapon; the differences are data.
  const combatActive = playing && cursorLocked;
  const wpn = WPN.currentWeapon();
  const isProjectile = WPN.W_PROJ_SPEED[wpn] > 0;

  // Charge weapons fire when the trigger comes UP.
  let chargeShot = -1;
  if (combatActive && WPN.W_CHARGE[wpn] > 0 && !input.fireDown) {
    chargeShot = WPN.releaseCharge();
  }

  const autoOk = WPN.W_AUTO[wpn] !== 0 ? input.fireDown : input.firePressed;
  const wantFire = combatActive && autoOk && WPN.canFire(input.fireDown);
  // forceFire (the COMBATSHOT harness) still goes through canFire, so the shot
  // respects the real cooldown, spread and reload â€” otherwise the capture would
  // be of a weapon that doesn't exist.
  const harnessFire = forceFire && combatActive && WPN.canFire(true);

  if (wantFire || chargeShot >= 0 || harnessFire) {
    SCORE.noteShot();
    muzzleFlashT = MUZZLE_FLASH_DUR;

    // Recoil + spread bloom. fireShot spends the ammo and starts the cooldown;
    // a charge shot already did both in releaseCharge().
    const kick = [0, 0];
    if (chargeShot < 0) WPN.fireShot(kick);
    else { kick[0] = WPN.W_KICK[wpn] * (0.4 + chargeShot); kick[1] = 0; }

    // Camera kick â€” pitch UP, with a little horizontal wobble so full-auto
    // climbs on a wander instead of a rail. Applied to the aim itself (not the
    // shake channel) because recoil is something you must actively fight.
    CAM[1] = Math.max(TP_PITCH_MIN, Math.min(TP_PITCH_MAX,
      CAM[1] - kick[0] * Math.PI / 180));
    CAM[0] = CAM[0] + kick[1] * Math.PI / 180;
    FEEL.addTrauma(0.05 + kick[0] * 0.02);
    gamepadRumble(0.25 + kick[0] * 0.1, 0.15, 0.05);

    playSound(wpn === WPN.W_BLASTER ? sfxFireBlaster : sfxFireRifle);

    // Third-person aiming: the crosshair is at screen centre, so trace the
    // camera-forward line out to a far point, treat that as the aim target, and
    // fire from the muzzle toward it. This keeps tracers and sparks lined up
    // with the gun barrel in the world rather than with the orbit camera.
    const camOriginV = vec3(CAM[2], CAM[3], CAM[4]);
    const adx = CAM[5] - CAM[2], ady = CAM[6] - CAM[3], adz = CAM[7] - CAM[4];
    const alen = Math.sqrt(adx*adx + ady*ady + adz*adz);
    const camFwd = alen > 0 ? vec3(adx/alen, ady/alen, adz/alen) : vec3(0, 0, -1);
    const aimTargetFar = 200;
    const tgtX = camOriginV.x + camFwd.x * aimTargetFar;
    const tgtY = camOriginV.y + camFwd.y * aimTargetFar;
    const tgtZ = camOriginV.z + camFwd.z * aimTargetFar;

    const originX = muzzleX;
    const originY = muzzleY;
    const originZ = muzzleZ;
    const mdx = tgtX - originX, mdy = tgtY - originY, mdz = tgtZ - originZ;
    const mlen = Math.sqrt(mdx*mdx + mdy*mdy + mdz*mdz);
    const aimX = mlen > 0 ? mdx / mlen : camFwd.x;
    const aimY = mlen > 0 ? mdy / mlen : camFwd.y;
    const aimZ = mlen > 0 ? mdz / mlen : camFwd.z;

    // SH-028 â€” spread. The shot leaves inside a cone that grows as you hold the
    // trigger, so full-auto at range is a choice with a cost.
    const rgX = Math.cos(CAM[0]), rgZ = Math.sin(CAM[0]);
    const upX = -aimY * rgZ, upY = aimZ * rgX - aimX * rgZ, upZ = aimY * rgX;
    const sp = [0, 0, 0];
    WPN.applySpread(aimX, aimY, aimZ, rgX, 0, rgZ, upX, upY, upZ, sp);
    const aim = vec3(sp[0], sp[1], sp[2]);

    // Muzzle VFX: flash, smoke, and a casing thrown out to the right.
    VFX.emitMuzzle(originX, originY, originZ, aim.x, aim.y, aim.z, rgX, rgZ);
    MIX.weaponTailFor(wpn, originX, originY, originZ);

    if (!isProjectile) {
      // Every third round leaves a visible streak â€” tracing every shot reads as
      // a laser beam, not gunfire.
      if ((SCORE.shotsFired() % 3) === 0) {
        VFX.emitTracer(originX, originY, originZ, aim.x, aim.y, aim.z);
      }
      const hit = raycast(physics, vec3(originX, originY, originZ), aim,
                          FIRE_RANGE, ALL_LAYERS_MASK);
      if (hit) {
        let struckEnemy = false;
        for (let i = 0; i < MAX_ENEMIES; i++) {
          if (enAlive[i] > 0 && hit.body === enBody[i]) {
            struckEnemy = true;
            // Accuracy counts ENEMIES hit, not rays that landed. Counting a
            // wall as a hit made the stat meaningless — and it is a stat the
            // score now pays a bonus on.
            SCORE.noteHit();
            damageEnemy(i, WPN.W_DAMAGE[wpn], hit.point.x, hit.point.y, hit.point.z,
                        aim.x, aim.y, aim.z);
            break;
          }
        }
        if (!struckEnemy) {
          // World hit â€” sparks, dust and a bullet hole that stays.
          const n = hit.normal;
          VFX.emitImpactHard(hit.point.x, hit.point.y, hit.point.z,
                             n.x, n.y, n.z, Math.random() * 6.28);
          playSound3D(sfxRicochet[SCORE.shotsFired() & 1],
                      hit.point.x, hit.point.y, hit.point.z);
        }
      }
    } else {
      const speed = WPN.W_PROJ_SPEED[wpn];
      const chg = chargeShot >= 0 ? chargeShot : 0;
      spawnProjectile(originX, originY, originZ,
                      aim.x * speed, aim.y * speed, aim.z * speed,
                      wpn, chg);
    }
  }

  // ---- Projectile update (M7) -------------------------------------------
  // Apply gravity, then segment-raycast from old pos to new pos so fast or
  // arcing shots can't tunnel through walls or enemy colliders.
  for (let i = 0; i < MAX_PROJ; i++) {
    if (pLife[i] <= 0) continue;
    pVY[i] = pVY[i] - BLASTER_PROJ_GRAVITY * dt;
    const ox = pX[i], oy = pY[i], oz = pZ[i];
    const nx = ox + pVX[i] * dt;
    const ny = oy + pVY[i] * dt;
    const nz = oz + pVZ[i] * dt;
    const sx = nx - ox, sy = ny - oy, sz = nz - oz;
    const segLen = Math.sqrt(sx * sx + sy * sy + sz * sz);
    const inv = segLen > 0 ? 1 / segLen : 0;
    const hit = raycast(physics, vec3(ox, oy, oz),
                        vec3(sx * inv, sy * inv, sz * inv),
                        segLen, ALL_LAYERS_MASK);
    if (hit) {
      const pw = pWeapon[i];
      const aoe = WPN.W_AOE[pw];
      if (aoe > 0) {
        // SH-042 â€” the lucifer cannon. Charge scales both damage and radius, so
        // a snap shot is a weak poke and a held shot is the room-clearer that
        // justifies the 0.9 s cooldown.
        const chg = pCharge[i];
        const radius = aoe * (0.55 + 0.45 * chg);
        const dmg = WPN.W_DAMAGE[pw] * (0.5 + 0.5 * chg);
        explode(hit.point.x, hit.point.y, hit.point.z, radius, dmg);
        SCORE.noteHit();
      } else {
        let struck = false;
        for (let j = 0; j < MAX_ENEMIES; j++) {
          if (enAlive[j] > 0 && hit.body === enBody[j]) {
            struck = true;
            SCORE.noteHit();
            const dl = segLen > 0 ? 1 / segLen : 0;
            damageEnemy(j, WPN.W_DAMAGE[pw],
                        hit.point.x, hit.point.y, hit.point.z,
                        sx * dl, sy * dl, sz * dl);
            break;
          }
        }
        if (!struck) {
          const n = hit.normal;
          VFX.emitImpactHard(hit.point.x, hit.point.y, hit.point.z,
                             n.x, n.y, n.z, Math.random() * 6.28);
        }
      }
      pLife[i] = 0;
    } else {
      pX[i] = nx; pY[i] = ny; pZ[i] = nz;
      pLife[i] = pLife[i] - dt;
    }
  }
  if (muzzleFlashT > 0) muzzleFlashT = muzzleFlashT - dt;
  if (damageFlashT > 0) damageFlashT = damageFlashT - dt;
  if (lastHitT > 0) lastHitT = lastHitT - dtReal;
  if (hitMarkT > 0) hitMarkT = hitMarkT - dtReal;
  if (levelChangeT > 0) levelChangeT = levelChangeT - dtReal;
  if (waveBonusT > 0) waveBonusT = waveBonusT - dtReal;
  if (unlockBannerT > 0) unlockBannerT = unlockBannerT - dtReal;
  for (let i = 0; i < SPARK_MAX; i++) {
    if (sparkT[i] > 0) sparkT[i] = sparkT[i] - dt;
  }
  // SH-029 â€” low-health grading. Ramps in below 25 HP.
  FEEL.setLowHealth(playerHP < 25 ? (1 - playerHP / 25) : 0);
  MIX.duckForLowHealth(playerHP > 0 && playerHP < 15);

  // The HDR sky pass overrides the clear colour, but leave this in
  // as a fallback when the HDR file is missing.
  clearBackground({ r: Math.floor(W.ENV_SKY_R * 255),
                    g: Math.floor(W.ENV_SKY_G * 255),
                    b: Math.floor(W.ENV_SKY_B * 255), a: 255 });
  // Sun + ambient MUST be re-set every frame: the engine's begin_frame
  // resets the whole lighting block to defaults (immediate-mode convention,
  // renderer begin_frame â€” verified the hard way in the visual-overhaul
  // branch). Values come from the world data, so the editor stays the
  // single source of truth.
  setAmbientLight(
    { r: Math.floor(W.ENV_AMBIENT_R * 255), g: Math.floor(W.ENV_AMBIENT_G * 255),
      b: Math.floor(W.ENV_AMBIENT_B * 255), a: 255 },
    W.ENV_AMBIENT_I);
  setDirectionalLight(
    vec3(W.ENV_SUN_DIR_X, W.ENV_SUN_DIR_Y, W.ENV_SUN_DIR_Z),
    { r: Math.floor(W.ENV_SUN_R * 255), g: Math.floor(W.ENV_SUN_G * 255),
      b: Math.floor(W.ENV_SUN_B * 255), a: 255 },
    W.ENV_SUN_I);

  if (PERFTEST) perfTB = getTime();
  // Round-7 â€” keep the audio listener on the camera so playSound3D
  // (alien deaths/attacks, impacts, ricochets) pans and attenuates
  // correctly.
  {
    const lfx = CAM[5] - CAM[2], lfy = CAM[6] - CAM[3], lfz = CAM[7] - CAM[4];
    const ll = Math.sqrt(lfx * lfx + lfy * lfy + lfz * lfz);
    if (ll > 0.0001) {
      setListenerPosition(CAM[2], CAM[3], CAM[4], lfx / ll, lfy / ll, lfz / ll);
    }
  }
  beginMode3D({
    position: vec3(CAM[2], CAM[3], CAM[4]),
    target:   vec3(CAM[5], CAM[6], CAM[7]),
    up: vec3(0, 1, 0),
    fovy: TP_FOVY,
    projection: 0,
  });

  // Muzzle flare point light â€” sits just past the barrel tip so
  // the warm splash of light hits the gun body and the floor in
  // front of the player when firing.
  if (muzzleFlashT > 0) {
    // Now sits at the REAL muzzle (SH-027), so the warm splash lands on the
    // barrel and the ground in front of it instead of near the player's hip.
    const k = muzzleFlashT / MUZZLE_FLASH_DUR;
    addPointLight(muzzleX, muzzleY, muzzleZ, 6, 1.0, 0.85, 0.5, 4.0 * k);
  }

  // ---- World: static meshes + water + lights (all from the world file) -----
  // (The old "ground plate" drawCube of COLLIDER[0] is gone: the merged
  // world removed the plaza-floor collider, so index 0 is now the NORTH
  // BOUNDARY WALL â€” the draw was painting an 80Ã—8 m grey slab across the
  // arena edge. The terrain mesh extends to Â±140 m and fully carries the
  // ground; the boundary colliders stay invisible physics.)

  // Phase 9 â€” real river. Single drawMeshWithMaterial replaces the old
  // 1800-cube tessellated grid. Shader handles Gerstner-wave
  // displacement, per-vertex normal, Fresnel-blended refraction (from
  // the scene-colour snapshot), sky reflection, and foam on crests.
  if (matWater > 0) {
    drawMeshWithMaterial(matWater, matWaterMesh,
      vec3(WATER_CX, WATER_Y, WATER_CZ), 1.0,
      { r: 255, g: 255, b: 255, a: 255 });
  }
  // Phase 10 â€” glass pane in the south-wall door opening of house h1.
  // Second consumer of the material ABI, proves the infrastructure
  // works for a different shader without any engine change.
  if (matGlass > 0) {
    drawMeshWithMaterial(matGlass, matGlassMesh,
      vec3(-21, 0, -10), 1.0,
      { r: 255, g: 255, b: 255, a: 255 });
  }
  // SH-021 â€” instanced grass. One drawMeshWithMaterialInstanced
  // covers all 20 000 blades; the canonical 6-vert mesh is drawn N
  // times against the per-instance pos/rot/scale/tint buffer. Wind
  // sway reads frame.wind (EN-013); cascade shadows come through
  // sample_sun_shadow (EN-016) â€” both folded into the material.
  if (matGrass > 0 && matGrassInstances > 0) {
    drawMeshWithMaterialInstanced(matGrass, matGrassMesh, 0,
      matGrassInstances, GRASS_INSTANCE_COUNT);
  }
  // Building stone â€” single drawMeshWithMaterial covers all
  // category-1 boxes; the noise + horizontal-band material in
  // the fragment turns them from flat beige into something that
  // reads as plastered stone.
  if (matBuilding > 0) {
    drawMeshWithMaterial(matBuilding, matBuildingMesh,
      vec3(0, 0, 0), 1.0,
      { r: 255, g: 255, b: 255, a: 255 });
  }
  // Forest scatter â€” ~120 leaf-card trees pre-placed at startup.
  // Cached-model path: the scene shader gives alpha-cutout foliage
  // wind sway + backlit transmission, the cutout shadow pipeline
  // gives dappled shadows, and the planar probe reflects them in
  // the river. Per-tree yaw + subtle whole-model hue jitter keep
  // the three variants from reading as copy-paste.
  for (let i = 0; i < FOREST_COUNT; i++) {
    const pos = vec3(FOREST_X[i], FOREST_Y[i], FOREST_Z[i]);
    const v = treeVariants[FOREST_VAR[i]];
    const tint = { r: FOREST_TINT_R[i], g: FOREST_TINT_G[i], b: FOREST_TINT_B[i], a: 255 };
    drawModelRotated(v, pos, FOREST_SCALE[i], FOREST_YAW[i], tint);
  }
  // Static meshes â€” either drawModel for real GLBs, or coloured drawCube
  // for placeholder _gizmo_box.glb entries. MESH_CATEGORY drives the cube
  // tint (0 generic / 1 building / 2 terrain / 3 prop).
  for (let i = 0; i < W.MESH_COUNT; i++) {
    const mi = W.MESH_MODEL_IDX[i];
    // Buildings (category 1) are rendered through the baked matBuilding
    // mesh below â€” skip them here to avoid a coplanar double-draw. This
    // must cover BOTH the placeholder boxes AND real GLBs: the textured
    // building_floor.glb used to slip through to the drawModel branch
    // and z-fight with the material shell â€” its window-slat texture
    // rows flickered through the plaster whenever the TAA jitter
    // flipped the per-pixel depth winner (the long-hunted "gray lines"
    // flicker on the building).
    if (W.MESH_CATEGORY[i] === 1 && matBuilding > 0) continue;
    if (W.MODEL_IS_BOX[mi] === 1) {
      const c = W.MESH_CATEGORY[i];
      const col = { r: MESH_TINT_R[c], g: MESH_TINT_G[c], b: MESH_TINT_B[c], a: 255 };
      drawCube(vec3(W.MESH_X[i], W.MESH_Y[i], W.MESH_Z[i]),
               W.MESH_COLLIDER_HX[i] * 2, W.MESH_COLLIDER_HY[i] * 2, W.MESH_COLLIDER_HZ[i] * 2,
               col);
    } else if (mi === terrainPropIdx && matTerrain > 0) {
      // Tier 2a â€” terrain via the colour-variation material. The
      // material runs in the opaque pass; passes Lambert against
      // PerView's directional sun + ambient, then writes both
      // albedo and hdr.
      drawMeshWithMaterial(matTerrain, meshModelHandles[mi] as any,
                vec3(W.MESH_X[i], W.MESH_Y[i], W.MESH_Z[i]),
                W.MESH_SCALE[i], WHITE);
    } else if (mi === treePropIdx) {
      // World-authored trees â€” variant + yaw + scale jitter from a
      // stable index hash so the same world always lays out the same.
      const v = treeVariants[i % 3];
      const scaleJitter = 0.85 + ((i * 17) & 31) / 100.0;  // 0.85 .. 1.16
      const sc = W.MESH_SCALE[i] * scaleJitter * 1.15;
      const pos = vec3(W.MESH_X[i], W.MESH_Y[i], W.MESH_Z[i]);
      const yawDeg = ((i * 47) % 360);
      drawModelRotated(v, pos, sc, yawDeg, WHITE);
    } else {
      drawModel(meshModelHandles[mi],
                vec3(W.MESH_X[i], W.MESH_Y[i], W.MESH_Z[i]),
                W.MESH_SCALE[i], WHITE);
    }
  }
  // (Water rendering moved up â€” Phase 9 drawMeshWithMaterial replaces
  // the old cube-grid loop that used to live here.)
  // Point lights from the world file â€” static scene lights.
  for (let i = 0; i < W.LIGHT_COUNT; i++) {
    addPointLight(W.LIGHT_X[i], W.LIGHT_Y[i], W.LIGHT_Z[i],
                  W.LIGHT_RANGE[i],
                  W.LIGHT_R[i], W.LIGHT_G[i], W.LIGHT_B[i],
                  W.LIGHT_INT[i]);
  }

  // Player: skinned + animated. Face the camera's horizontal yaw (so the
  // character always looks "away from the camera"). Walk if input is
  // nonzero, idle otherwise. A debug sphere at the capsule centre is
  // always drawn as a fallback so the player's position is visible even
  // if the skinned model fails to render.
  {
    const pp = playerPosition();
    const moving = input.moveX !== 0 || input.moveZ !== 0;
    const camYaw = CAM[0];
    // Face the camera's horizontal forward direction so the character
    // always looks "away from the camera" (over-the-shoulder feel) and
    // walks the way it looks. Camera forward at camYaw is
    // (sin camYaw, -cos camYaw).
    //
    // SIGN QUIRK, pinned down via debug-pillar screenshots at three camera
    // yaws: the skinned path (updateModelAnimation â†’ set_joint_matrices_
    // scaled) applies rotY INVERTED â€” rendered facing = -rotY + Ï€/2 for
    // this model (the Ï€/2 is the bsuit's rest offset). Three builds
    // confirmed it: +Ï€/2 â†’ correct at yaw 0 but counter-rotates when
    // orbiting; 0 â†’ 90Â° off; -Ï€/2 â†’ faces the camera. Solving
    // -rotY + Ï€/2 = camYaw gives rotY = Ï€/2 - camYaw. If the engine's
    // joint-matrix yaw sign ever gets fixed, flip this back to
    // camYaw + Ï€/2 (and re-check the enemies' faceYaw too â€” they go
    // through the same path). The bsuit's only "attack" animation is a
    // melee swing â€” a ranged shooter shouldn't use it; keep the walk/idle
    // pose and fake recoil + muzzle flash on the weapon.
    const modelYaw = Math.PI / 2 - camYaw;

    // SH-034 / EN-028 â€” locomotion through the mixer instead of hard clip
    // swaps. animPlay is idempotent, so we simply state the clip we want every
    // frame and the engine crossfades if that changed. The run clip finally
    // gets used (it was loaded and never played), and the playback RATE is
    // driven by actual speed, which is what kills the foot-sliding.
    const spd = playerSpeed();
    const runIsh = spd > 7.0;
    const wantClip = spd > 0.4
      ? (runIsh ? PLAYER_ANIM_RUN : PLAYER_ANIM_WALK)
      : PLAYER_ANIM_IDLE;
    // Authored stride speeds: walk ~2.6 m/s, run ~6.5 m/s. Scaling playback by
    // (actual / authored) makes the feet land where the ground is.
    const authored = wantClip === PLAYER_ANIM_RUN ? 6.5
                   : (wantClip === PLAYER_ANIM_WALK ? 2.6 : 1);
    const rate = wantClip === PLAYER_ANIM_IDLE
      ? 1
      : Math.max(0.35, Math.min(2.2, spd / authored));
    animPlay(animPlayer, wantClip, 0.15, rate, true);
    animUpdate(animPlayer, dt, PLAYER_SCALE,
      pp.x, pp.y + PLAYER_MODEL_Y_OFFSET, pp.z, modelYaw);
    drawModel(mdlPlayer, vec3(pp.x, pp.y + PLAYER_MODEL_Y_OFFSET, pp.z),
              PLAYER_SCALE, WHITE);

    // SH-027 â€” the real weapon model, at the transform computed once above.
    // Recoil is a short kick BACK along the barrel; the squared falloff reads
    // as a snap rather than a slide.
    const recoilT = muzzleFlashT > 0 ? muzzleFlashT / MUZZLE_FLASH_DUR : 0;
    const recoilBack = recoilT * recoilT * 0.10;
    const cpW = Math.cos(weaponPitch);
    const fwx = Math.sin(weaponYaw) * cpW;
    const fwy = Math.sin(weaponPitch);
    const fwz = -Math.cos(weaponYaw) * cpW;
    const wpnNow = WPN.currentWeapon();
    // drawModelRotated takes DEGREES (see docs/round-4 notes) and gives us the
    // cached-model path, which the immediate path would not.
    //
    // The barrel is local +Z (build-weapons.ts), but camera-forward at yaw 0 is
    // -Z, so a naive `yaw` points the gun backwards. Rotating +Z onto
    // (sin yaw, 0, -cos yaw) needs θ = π - yaw.
    //
    // Only yaw is expressible here: drawModelRotated has no pitch, so the gun
    // cannot tilt with the aim. Fine in third person at normal engagement
    // angles; a full-transform immediate draw is EN-039.
    const yawDeg = ((Math.PI - weaponYaw) * 180 / Math.PI);
    drawModelRotated(
      mdlWeapons[wpnNow],
      vec3(weaponX - fwx * recoilBack,
           weaponY - fwy * recoilBack,
           weaponZ - fwz * recoilBack),
      WEAPON_DRAW_SCALE[wpnNow], yawDeg, WHITE);

    // Muzzle flash â€” additive material at the true muzzle. The particle system
    // now layers smoke and a shell on top of this (SH-033); the flash card
    // stays because it is what makes the HDR spike.
    if (muzzleFlashT > 0 && matMuzzleFlash > 0) {
      const k = muzzleFlashT / MUZZLE_FLASH_DUR;
      const flashScale = 0.40 + (1 - k) * 0.18;
      const intensity255 = Math.min(255, Math.floor(k * 255));
      drawMeshWithMaterial(matMuzzleFlash, matMuzzleFlashMesh,
        vec3(muzzleX, muzzleY, muzzleZ), flashScale,
        { r: 255, g: 200, b: 120, a: intensity255 });
    }
  }
  // Per-enemy: drive the skinned skeleton via updateModelAnimation (picks
  // attack vs walk anim), then drawModel renders with the pose from the
  // joint matrices set by the update. Both calls use the same position so
  // non-skinned fallbacks still sit in the right place.
  const ppAim = playerPosition();
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] === 0) continue;
    const k = enKind[i];
    const dxA = ppAim.x - enX[i];
    const dzA = ppAim.z - enZ[i];
    const distA = Math.hypot(dxA, dzA);
    // Round-9: render the AI's turn-rate-limited heading rather than
    // hard-facing the player â€” circling mantises and charging dragoons face
    // where they're actually going. Windup counts as attacking so the dragoon's
    // pounce telegraph reads on the model.
    const attacking = distA <= KIND_MELEE[k] || enAIState[i] === AI_WINDUP;
    const flinching = enAIState[i] === AI_FLINCH;

    // SH-030 / SH-034 â€” the base track is locomotion; the attack rides on an
    // UPPER-BODY layer over it (EN-028 masks), so an alien bites while still
    // closing instead of stopping dead to bite. Getting shot interrupts with
    // the pain clip, which is the reward for landing a hit.
    let baseClip = ANIM_WALK_IDX[k];
    if (flinching) baseClip = ANIM_PAIN_IDX[k];
    else if (attacking && KIND_SPINE_JOINT[k] < 0) baseClip = ANIM_ATTACK_IDX[k];

    // Attack layer: blended in/out rather than snapped, so the bite doesn't pop.
    if (KIND_SPINE_JOINT[k] >= 0) {
      const want = attacking && !flinching ? 1 : 0;
      const kL = 1 - Math.exp(-12 * dt);
      enAttackLayer[i] = enAttackLayer[i] + (want - enAttackLayer[i]) * kL;
      animSetLayer(enAnim[i], ANIM_ATTACK_IDX[k], enAttackLayer[i],
                   KIND_SPINE_JOINT[k], 1.0, true);
    }

    // Speed-matched playback â€” the fix that kills foot-sliding. The old code
    // played the walk clip at a fixed rate no matter how fast the thing was
    // actually moving, so a charging dragoon's feet skated.
    const spdE = Math.hypot(vxLast[i], vzLast[i]);
    const authoredE = KIND_SPEED[k];
    const rateE = flinching ? 1.0
      : Math.max(0.4, Math.min(2.5, spdE / (authoredE > 0.01 ? authoredE : 1)));

    // animPlay is idempotent, so stating the clip we want every frame is the
    // intended use â€” it only crossfades when that actually changed.
    animPlay(enAnim[i], baseClip, flinching ? 0.06 : 0.15, rateE, !flinching);
    enAnimClip[i] = baseClip;
    // Same engine quirk as the player model: the skinned path applies rotY
    // INVERTED, so pass Ï€/2 âˆ’ yaw or the aliens strafe sideways-on.
    animUpdate(enAnim[i], dt, KIND_SCALE[k],
      enX[i], enY[i], enZ[i], Math.PI / 2 - enHeading[i]);

    const f = enFlashT[i] > 0 ? enFlashT[i] / DRETCH_HIT_FLASH : 0;
    const tint = f > 0
      ? { r: 255,
          g: Math.floor(255 * (1 - f)),
          b: Math.floor(255 * (1 - f)),
          a: 255 }
      : WHITE;
    drawModel(mdlAliens[k], vec3(enX[i], enY[i], enZ[i]), KIND_SCALE[k], tint);
  }
  // Dying enemies: play the death animation once, frozen on its final
  // collapsed pose (the engine wraps anim time, so playback clamps just
  // short of the real clip duration), then sink the corpse into the
  // ground and free the slot. Replaces the old teleport-to-y=-100
  // despawn that made kills feel like the enemy just vanished.
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enDying[i] !== 1) continue;
    enDeathT[i] = enDeathT[i] + dt;
    const k = enKind[i];
    const dur = ANIM_DIE_DUR[k];
    const sink = enDeathT[i] > dur + 0.6 ? (enDeathT[i] - dur - 0.6) * 0.9 : 0;
    // Now that each slot owns its animation handle, death is just a NON-LOOPING
    // clip on the mixer: it plays once and clamps on the final collapsed pose,
    // instead of the old trick of clamping the time just short of the duration
    // to stop the engine wrapping it back to a standing start.
    if (enAnimClip[i] !== ANIM_DIE_IDX[k]) {
      animPlay(enAnim[i], ANIM_DIE_IDX[k], 0.08, 1.0, false);
      enAnimClip[i] = ANIM_DIE_IDX[k];
      animSetLayer(enAnim[i], -1, 0, -1, 1, false);   // drop any attack layer
    }
    animUpdate(enAnim[i], dt, KIND_SCALE[k],
      enX[i], enY[i] - sink, enZ[i], Math.PI / 2 - enDeathYaw[i]);
    drawModel(mdlAliens[k], vec3(enX[i], enY[i] - sink, enZ[i]), KIND_SCALE[k], WHITE);
    if (enDeathT[i] > dur + 2.0) {
      enDying[i] = 0;
      enAnimClip[i] = -1;    // so the next enemy in this slot re-triggers
    }
  }
  // Pickups â€” bobbing cubes, color-coded per kind.
  const tNow = getTime();
  for (let i = 0; i < PICKUP_COUNT; i++) {
    if (pickupActive[i] === 0) continue;
    const bob = 0.8 + Math.sin(tNow * 3.0 + i) * 0.15;
    const isRifleKind = pickupKind[i] === PICKUP_RIFLE;
    const col = isRifleKind
      ? { r: 240, g: 200, b: 80,  a: 255 }    // gold = rifle
      : { r: 120, g: 220, b: 240, a: 255 };   // cyan = blaster
    drawCube(vec3(pickupX[i], bob, pickupZ[i]), 0.4, 0.4, 0.4, col);
    // Glow sphere around the cube for visibility.
    drawSphere(vec3(pickupX[i], bob, pickupZ[i]), 0.55,
      { r: col.r, g: col.g, b: col.b, a: 60 });
  }
  // Impact sparks â€” small yellow puffs that fade over 0.35s.
  for (let i = 0; i < SPARK_MAX; i++) {
    if (sparkT[i] > 0) {
      const t = sparkT[i] / 0.35;
      const a = Math.min(255, Math.floor(t * 255));
      if (matMuzzleFlash > 0) {
        // Same additive material as the muzzle flash â€” radial warm
        // burst with HDR intensity scaled by per-draw alpha.
        drawMeshWithMaterial(matMuzzleFlash, matMuzzleFlashMesh,
          vec3(sparkX[i], sparkY[i], sparkZ[i]), 0.45 * t + 0.10,
          { r: 255, g: 230, b: 140, a });
      } else {
        drawSphere(vec3(sparkX[i], sparkY[i], sparkZ[i]), 0.25 * t + 0.05,
          { r: 255, g: 240, b: 140, a });
      }
    }
  }
  // Blaster projectiles â€” additive cyan plasma using the muzzle-
  // flash mesh + material, tinted cool. The radial-falloff in the
  // shader already produces the soft glow shape.
  for (let i = 0; i < MAX_PROJ; i++) {
    if (pLife[i] > 0) {
      if (matMuzzleFlash > 0) {
        drawMeshWithMaterial(matMuzzleFlash, matMuzzleFlashMesh,
          vec3(pX[i], pY[i], pZ[i]), 0.30,
          { r: 110, g: 200, b: 255, a: 255 });
      } else {
        drawSphere(vec3(pX[i], pY[i], pZ[i]), 0.16,
          { r: 140, g: 220, b: 255, a: 255 });
      }
    }
  }
  // SH-033 â€” particles + decals. One update + one instanced draw per system,
  // last in the 3D pass so the additive particles composite over everything and
  // the depth-tested decals have a full depth buffer to fade against.
  VFX.updateAndDrawVfx(dtReal);

  endMode3D();
  if (PERFTEST) perfTC = getTime();

  // Everything from here to endMode2D() is laid out in the logical HUD space
  // established above. On desktop uiScale is 1 and this is a no-op.
  if (MOBILE) beginMode2DRaw(0, 0, 0, 0, 0, uiScale);

  // ---- Crosshair (SH-028) -------------------------------------------------
  // The gap between the arms IS the current spread. A crosshair that doesn't
  // move while your cone triples is lying to the player about where the bullet
  // is going, and it is the reason spread feels "random" instead of earned.
  {
    const spreadDeg = WPN.spreadRad() * 180 / Math.PI;
    const gap = 4 + spreadDeg * 5.5;
    const arm = 7;
    const crossA = muzzleFlashT > 0 ? 250 : 190;
    const col = { r: 255, g: 255, b: 255, a: crossA };
    const cx = sw / 2;
    const cy = sh / 2;
    drawRect(cx - gap - arm, cy - 1, arm, 2, col);
    drawRect(cx + gap,       cy - 1, arm, 2, col);
    drawRect(cx - 1, cy - gap - arm, 2, arm, col);
    drawRect(cx - 1, cy + gap,       2, arm, col);
    drawCircle(cx, cy, 1.5, col);

    // SH-043 â€” hit confirmation is a white FLASH + a tick, not a colour change:
    // a colourblind player gets the same information as anyone else.
    if (hitMarkT > 0) {
      const ha = Math.floor((hitMarkT / 0.18) * 255);
      const hc = { r: 255, g: 255, b: 255, a: ha };
      const d = 10;
      drawRect(cx - d, cy - d, 6, 2, hc);
      drawRect(cx + d - 6, cy - d, 6, 2, hc);
      drawRect(cx - d, cy + d - 2, 6, 2, hc);
      drawRect(cx + d - 6, cy + d - 2, 6, 2, hc);
    }
  }

  // Damage vignette â€” red screen edges when the player takes a hit.
  if (damageFlashT > 0) {
    const fa = Math.floor((damageFlashT / 0.5) * 120);
    drawRect(0, 0, sw, 60, { r: 200, g: 20, b: 20, a: fa });
    drawRect(0, sh - 60, sw, 60, { r: 200, g: 20, b: 20, a: fa });
    drawRect(0, 0, 60, sh, { r: 200, g: 20, b: 20, a: fa });
    drawRect(sw - 60, 0, 60, sh, { r: 200, g: 20, b: 20, a: fa });
  }

  // SH-029/SH-043 â€” damage direction arc. Encodes WHERE the hit came from as
  // a position (a shape you can see), not just a colour you have to interpret.
  if (lastHitT > 0) {
    const a = Math.floor((lastHitT / 1.4) * 200);
    const r = Math.min(sw, sh) * 0.22;
    const cx = sw / 2;
    const cy = sh / 2;
    // Screen-space: +x right, -y up. The angle is relative to where you face.
    const ax = cx + Math.sin(lastHitAngle) * r;
    const ay = cy - Math.cos(lastHitAngle) * r;
    drawCircle(ax, ay, 9, { r: 235, g: 70, b: 55, a: a });
    drawCircle(ax, ay, 4, { r: 255, g: 220, b: 210, a: a });
  }

  // Player HP bar â€” bottom-left. Low health pulses, so the state is legible
  // without reading the number.
  const phpW = 220;
  const phpFill = Math.max(0, Math.floor(phpW * (playerHP / PLAYER_HP_MAX)));
  const lowT = playerHP < 25 ? (0.6 + 0.4 * Math.sin(getTime() * 9)) : 1;
  drawRect(10, sh - 68, phpW, 18, { r: 30, g: 10, b: 10, a: 180 });
  drawRect(10, sh - 68, phpFill, 18,
    { r: Math.floor(180 * lowT + 60), g: 60, b: 50, a: 230 });
  drawText('HP ' + playerHP, 18, sh - 65, 14, { r: 240, g: 240, b: 240, a: 255 });

  // Dodge cooldown â€” a thin bar under HP, so you know when you can commit.
  {
    const cd = dodgeCooldownFrac();
    if (cd > 0) {
      drawRect(10, sh - 46, phpW, 4, { r: 20, g: 20, b: 24, a: 160 });
      drawRect(10, sh - 46, phpW * (1 - cd), 4, { r: 120, g: 190, b: 235, a: 220 });
    }
  }

  // ---- Score + combo (SH-041) ---------------------------------------------
  if (gameState === 1) {
    const st = 'SCORE ' + SCORE.score();
    drawText(st, 14, 44, 22, { r: 245, g: 235, b: 195, a: 235 });
    const cmb = SCORE.combo();
    if (cmb > 1.001) {
      const ct = 'x' + cmb.toFixed(2);
      drawText(ct, 14, 70, 26, { r: 255, g: 200, b: 90, a: 255 });
      // The combo's remaining life, as a draining bar â€” the pressure made
      // visible is what makes players push forward instead of hiding.
      const cw = 90;
      drawRect(14, 100, cw, 4, { r: 30, g: 25, b: 15, a: 180 });
      drawRect(14, 100, cw * SCORE.comboFrac(), 4, { r: 255, g: 190, b: 70, a: 240 });
    }
  }

  // Render-pass debug status line. Top-left, always on â€” but there are no
  // function keys on a phone, so it's just clutter over the play area there.
  if (!MOBILE) {
    const dbgLine = 'F5 SSGI ' + (dbgSsgi ? 'ON ' : 'off')
      + '   F6 SSAO ' + (dbgSsao ? 'ON ' : 'off')
      + '   F7 SSR ' + (dbgSsr ? 'ON ' : 'off')
      + '   F8 SHADOW ' + (dbgShadow ? 'ON ' : 'off');
    drawRect(6, 6, 620, 30, { r: 0, g: 0, b: 0, a: 170 });
    drawText(dbgLine, 14, 12, 18, { r: 255, g: 240, b: 120, a: 255 });
  }

  // ---- Weapon + ammo + reload + charge (SH-028 / SH-042) ------------------
  {
    const w = WPN.currentWeapon();
    const curAmmo = WPN.currentAmmo();
    // MAGAZINE / RESERVE — the standard readout, and now an honest one: the mag
    // is what you can fire before reloading, the reserve is what a reload costs.
    const res = WPN.currentReserve();
    const wtxt = WPN.WEAPON_NAMES[w] + '  ' + curAmmo + ' / ' + res;
    // On touch the ammo readout sits above the fire button rather than in the
    // corner, where the thumb would cover it.
    const wy = MOBILE ? sh - 210 : sh - 68;
    drawRect(sw - 260, wy, 250, 18, { r: 0, g: 0, b: 0, a: 150 });
    // Empty mags read red â€” the one piece of info you need at a glance.
    const ammoCol = curAmmo === 0
      ? { r: 235, g: 90, b: 70, a: 255 }
      : { r: 240, g: 230, b: 180, a: 255 };
    const pad = input.padActive;
    const hint = MOBILE ? '' : (pad ? '   [Y switch  X reload]' : '   [1-4 switch  R reload]');
    drawText(wtxt + hint, sw - 252, wy + 3, 13, ammoCol);

    // Reload progress. A timed reload the player cannot SEE is just an
    // unexplained dead trigger; the bar is what turns it into a decision about
    // when to take cover.
    if (WPN.isReloading()) {
      const rp = WPN.reloadProgress();
      drawRect(sw - 260, wy - 12, 250, 8, { r: 25, g: 25, b: 30, a: 200 });
      drawRect(sw - 260, wy - 12, 250 * rp, 8, { r: 120, g: 200, b: 235, a: 240 });
      const rt = 'RELOADING';
      drawText(rt, sw - 260, wy - 32, 15, { r: 190, g: 225, b: 245, a: 230 });
    }

    // Charge meter (cannon). Turns red-hot at full so you can feel the release
    // point without staring at the bar.
    const chg = WPN.chargeLevel();
    if (chg > 0.01) {
      const full = chg > 0.98;
      const bw = 160;
      const cx = sw / 2 - bw / 2;
      const cy = sh / 2 + 44;
      drawRect(cx, cy, bw, 8, { r: 20, g: 20, b: 24, a: 190 });
      drawRect(cx, cy, bw * chg, 8,
        full ? { r: 255, g: 120, b: 60, a: 255 } : { r: 255, g: 210, b: 110, a: 235 });
    }

    // Chaingun spool â€” the ramp you have to pay before the first round leaves.
    const spool = WPN.spinup();
    if (spool > 0.01 && spool < 0.99) {
      const bw = 120;
      const cx = sw / 2 - bw / 2;
      const cy = sh / 2 + 60;
      drawRect(cx, cy, bw, 5, { r: 20, g: 20, b: 24, a: 180 });
      drawRect(cx, cy, bw * spool, 5, { r: 200, g: 200, b: 210, a: 220 });
    }
  }

  // Wave HUD â€” top-center. Shows "WAVE X â€” enemies K/N" while spawning,
  // or a "NEXT WAVE IN ..." countdown between waves.
  const aliveNow = countAlive();
  if (gameState === 1 && !gameOver && !gameWon) {
    if (waveBreakTimer > 0 && waveIdx < wavePlan.length) {
      const label = 'WAVE ' + (waveIdx + 1) + ' IN ' + waveBreakTimer.toFixed(1) + 's';
      const lw = measureText(label, 22);
      drawText(label, (sw - lw) / 2, 18, 22, { r: 230, g: 220, b: 160, a: 230 });
    } else if (waveIdx < wavePlan.length) {
      const waveSize = wavePlan[waveIdx];
      const remaining = (waveSize - waveSpawned) + aliveNow;
      const label = 'WAVE ' + (waveIdx + 1) + ' â€” ' + remaining + ' / ' + waveSize;
      const lw = measureText(label, 20);
      drawText(label, (sw - lw) / 2, 18, 20, { r: 230, g: 220, b: 160, a: 230 });
    }
  }

  // SH-041 â€” end-of-wave report card. Shows what the wave EARNED, which is what
  // turns "I survived" into "I could have done that better".
  if (waveBonusT > 0 && gameState === 1) {
    const a = Math.min(1, waveBonusT / 0.6);
    const alpha = Math.floor(a * 235);
    const cardY = sh * 0.28;
    const cardW = 320;
    const cardX = (sw - cardW) / 2;
    drawRect(cardX, cardY, cardW, 118, { r: 12, g: 12, b: 16, a: Math.floor(a * 200) });
    const head = 'WAVE ' + waveIdx + ' CLEAR';
    const hw = measureText(head, 26);
    drawText(head, (sw - hw) / 2, cardY + 10, 26,
      { r: 235, g: 220, b: 150, a: alpha });
    const acc = Math.round(SCORE.accuracy() * 100);
    drawText('KILLS      ' + SCORE.waveKills(), cardX + 24, cardY + 46, 17,
      { r: 220, g: 220, b: 225, a: alpha });
    drawText('ACCURACY   ' + acc + '%', cardX + 24, cardY + 68, 17,
      { r: 220, g: 220, b: 225, a: alpha });
    drawText('BONUS     +' + waveBonus, cardX + 24, cardY + 90, 17,
      { r: 255, g: 205, b: 100, a: alpha });
  }

  // Unlock banner.
  if (unlockBannerT > 0) {
    const a = Math.floor(Math.min(1, unlockBannerT / 1.0) * 245);
    const msg = 'CHAINGUN UNLOCKED';
    const mw = measureText(msg, 30);
    drawText(msg, (sw - mw) / 2, sh * 0.20, 30, { r: 255, g: 215, b: 120, a: a });
  }

  // Title screen â€” the live world renders as the backdrop, menu.wav plays,
  // waves/firing/movement are gated off. Any input starts the run.
  if (gameState === 0) {
    // Round-2 audit: measureText is exact in the current engine (verified
    // measure â‰¡ draw advance down to the binary) â€” the old 0.58 hand
    // estimate was itself the source of the visible off-centering.
    const title = 'BLOOM SHOOTER';
    const tw = measureText(title, 54);
    drawText(title, (sw - tw) / 2, 170, 54, { r: 236, g: 226, b: 178, a: 255 });
    // Which arena you are about to drop into (SH-040) — pick a different one
    // from the pause menu.
    const an = W.ARENAS[W.ARENA_INDEX].name;
    const anw = measureText(an, 20);
    drawText(an, (sw - anw) / 2, 232, 20, { r: 200, g: 190, b: 150, a: 210 });

    const sub = MOBILE ? 'tap to start' : 'press any key';
    const subw = measureText(sub, 22);
    const pulse = Math.floor(175 + Math.sin(getTime() * 3.0) * 70);
    drawText(sub, (sw - subw) / 2, 268, 22, { r: 225, g: 225, b: 225, a: pulse });
    if (isAnyInputPressed()) {
      gameState = 1;
      stopMusic(musicMenu);
      playMusic(musicAmbient);
      // Swallow the starting press so it isn't also read as a shot.
      WPN.selectWeapon(WPN.W_BLASTER);
      WPN.selectWeapon(WPN.W_RIFLE);
      waveBreakTimer = WAVE_BREAK_DELAY;   // wave-1 countdown starts fresh
      SCORE.resetScore();
      runElapsed = 0;
    }
  }

  // Game over overlay â€” now with the run's numbers on it.
  if (gameOver) {
    drawRect(0, 0, sw, sh, { r: 0, g: 0, b: 0, a: 170 });
    const msg = 'YOU DIED';
    const mw = measureText(msg, 56);
    drawText(msg, (sw - mw) / 2, sh * 0.30, 56, { r: 220, g: 60, b: 50, a: 255 });
    drawRunSummary(sw, sh * 0.30 + 76);
    const sub = 'Reached wave ' + (waveIdx + 1)
      + (MOBILE ? ' â€” tap R to restart' : ' â€” press R to restart');
    const sww = measureText(sub, 22);
    drawText(sub, (sw - sww) / 2, sh * 0.30 + 210, 22, { r: 220, g: 220, b: 220, a: 230 });
  }

  // Victory overlay.
  if (gameWon) {
    drawRect(0, 0, sw, sh, { r: 0, g: 0, b: 0, a: 170 });
    const msg = 'ARENA CLEARED';
    const mw = measureText(msg, 52);
    drawText(msg, (sw - mw) / 2, sh * 0.28, 52, { r: 180, g: 230, b: 180, a: 255 });
    drawRunSummary(sw, sh * 0.28 + 72);
    const sub = 'Survived all ' + wavePlan.length + ' waves'
      + (MOBILE ? ' â€” tap R to play again' : ' â€” press R to play again');
    const sww = measureText(sub, 22);
    drawText(sub, (sw - sww) / 2, sh * 0.28 + 206, 22, { r: 220, g: 220, b: 220, a: 230 });
  }

  // SH-040 — level chosen, but it loads on the next launch. Say so plainly
  // rather than letting the player wonder why nothing happened.
  if (levelChangeT > 0) {
    const a = Math.floor(Math.min(1, levelChangeT / 0.5) * 240);
    const msg = 'ARENA SET - RESTART THE GAME TO PLAY IT';
    const mw = measureText(msg, 22);
    drawRect((sw - mw) / 2 - 16, sh * 0.16 - 8, mw + 32, 40,
             { r: 10, g: 10, b: 14, a: Math.floor(a * 0.8) });
    drawText(msg, (sw - mw) / 2, sh * 0.16, 22, { r: 255, g: 215, b: 120, a: a });
  }

  // SH-038 — the pause / settings menu draws LAST so it sits over the HUD.
  drawMenu(sw, sh);

  // Diagnostic HUD â€” helps verify input is reaching the game. The desktop
  // version is a full-width bar along the bottom, which on a phone lands
  // directly under the thumbs; show just the frame rate up in the corner
  // instead, which is what's actually worth watching on device.
  if (MOBILE) {
    drawText('FPS ' + Math.floor(getFPS()), 14, 12, 20,
             { r: 200, g: 210, b: 230, a: 200 });
  }
  const pp = playerPosition();
  const diag1 = 'FPS ' + Math.floor(getFPS())
    + '  world: ' + worldStatus
    + '  WASD:' + input.moveX.toFixed(1) + ',' + input.moveZ.toFixed(1)
    + '  jump:' + (input.jump ? '1' : '0')
    + '  fire:' + (input.fireDown ? '1' : '0')
    + '  mouse:' + (cursorLocked ? 'locked (Tab to free)' : 'free (Tab to lock)');
  const diag2 = 'pos ' + pp.x.toFixed(1) + ',' + pp.y.toFixed(1) + ',' + pp.z.toFixed(1)
    + '  yaw ' + CAM[0].toFixed(2) + '  pitch ' + CAM[1].toFixed(2)
    + '  cam ' + CAM[2].toFixed(1) + ',' + CAM[3].toFixed(1) + ',' + CAM[4].toFixed(1)
    + '  shots ' + SCORE.shotsHit() + '/' + SCORE.shotsFired();

  if (!MOBILE) {
    drawRect(0, sh - 44, sw, 44, { r: 0, g: 0, b: 0, a: 150 });
    drawText(diag1, 10, sh - 40, 13, { r: 200, g: 210, b: 230, a: 220 });
    drawText(diag2, 10, sh - 20, 13, { r: 180, g: 200, b: 220, a: 220 });
  }

  // Phase 8 â€” profiler overlay (F3). Lists every engine pass with
  // CPU and GPU (Âµs) averaged over the profiler's 120-frame rolling
  // window, sorted by CPU time descending.
  if (perfOverlayOn) {
    const rows = getProfilerOverlay();
    const rowH = 16;
    const ox = sw - 360;
    // Phase 8 â€” frame-time histogram on top of the pass list so it
    // stays visible regardless of how many passes are running. Each
    // bar is one frame; height = total CPU+GPU time scaled to a
    // 16.7 ms (60 fps) reference. Bars over full height = dropped
    // frames (drawn red).
    const hist = getProfilerFrameHistory();
    const histY = 60;
    const histH = 56;
    const barW = 2;
    const histW = Math.min(hist.length * barW, 360 - 16);
    const refMs = 16.667;
    drawRect(ox - 8, histY - 8, 360, histH + 32, { r: 0, g: 0, b: 0, a: 180 });
    drawText('frame total ms (cpu+gpu, scale = 60 fps)',
             ox, histY, 12, { r: 220, g: 220, b: 255, a: 230 });
    drawRect(ox, histY + 18 + histH - 1, histW, 1,
             { r: 100, g: 200, b: 100, a: 180 });
    for (let i = 0; i < hist.length && i * barW < histW; i++) {
      const totalMs = (hist[i].cpuUs + hist[i].gpuUs) / 1000;
      const h = Math.max(1, Math.min(histH, Math.floor(totalMs / refMs * histH)));
      const overBudget = totalMs > refMs;
      const col = overBudget
        ? { r: 230, g: 100, b:  90, a: 220 }
        : { r:  90, g: 180, b: 230, a: 200 };
      drawRect(ox + i * barW, histY + 18 + histH - h, barW - 1, h, col);
    }

    // Per-pass table below the histogram.
    const oy = histY + histH + 36;
    drawRect(ox - 8, oy - 8, 360, rowH * (rows.length + 2) + 12,
             { r: 0, g: 0, b: 0, a: 180 });
    drawText('pass                    cpu Âµs    gpu Âµs',
             ox, oy, 13, { r: 220, g: 220, b: 255, a: 255 });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const gpuStr = r.gpuUs < 0 ? '     -' : r.gpuUs.toFixed(1);
      const line = r.label.padEnd(22, ' ') + r.cpuUs.toFixed(1).padStart(9, ' ') +
                   '  ' + gpuStr.padStart(8, ' ');
      drawText(line, ox, oy + rowH * (i + 1), 13,
               { r: 200, g: 210, b: 230, a: 230 });
    }
  }

  if (MOBILE) endMode2D();

  // The touch controls are drawn *outside* the scaled camera, in raw pixels â€”
  // they have to land on exactly the coordinates input.ts hit-tests, and it
  // reads touches in the pixel space the platform delivers them in.
  drawTouchControls();

  if (isKeyPressed(Key.ESCAPE)) break;
  if (PERFTEST) perfTD = getTime();
  endDrawing();
  if (PERFTEST) {
    perfPrevEnd = getTime();
    perfMsA = (perfTA - perfTTop) * 1000;
    perfMsB = (perfTB - perfTA) * 1000;
    perfMsC = (perfTC - perfTB) * 1000;
    perfMsD = (perfTD - perfTC) * 1000;
    perfMsE = (perfPrevEnd - perfTD) * 1000;
  }
  if (PERFTEST && perfDone) break;
}

