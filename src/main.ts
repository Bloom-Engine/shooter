import {
  initWindow, windowShouldClose, beginDrawing, endDrawing, clearBackground,
  setTargetFPS, getDeltaTime, getFPS, getTime,
  beginMode3D, endMode3D,
  drawCube, drawText, drawRect,
  setAmbientLight, setDirectionalLight, setEnvClearFromHdr,
  getScreenWidth, getScreenHeight,
  vec3,
  isKeyPressed, isKeyDown, Key, Vec3, injectKeyDown, injectKeyUp,
  disableCursor, enableCursor, takeScreenshot,
  endMode2D,
  loadModel, drawModel, drawModelRotated, getModelBounds, loadModelAnimation, updateModelAnimation,
  setModelFoliageWind, setFoliageShadowMotion,
  drawMeshWithMaterial, drawMeshWithMaterialInstanced,
  initAudio, loadSound, playSound, setSoundVolume, playSound3D, setListenerPosition,
  loadMusic, playMusic, stopMusic, updateMusicStream, setMusicVolume,
  fileExists,
  setProfilerEnabled, getProfilerOverlay, getProfilerFrameHistory,
  splatImpulse, setMaterialParams,
  compileMaterialFromFile, loadMaterial,
} from 'bloom';
import {
  // Raw-primitive variant of beginMode2D: the object-taking one isn't worth the
  // risk on a per-frame FFI path (perry-quirks #2), and only this one is
  // exported from bloom/core anyway.
  beginMode2DRaw,
  setVignette, setFilmGrain,
  setEnvIntensity, setAutoExposure, setAutoExposureKey, setFog, setSunShafts, setWind,
  setCloudShadows,
  setTaaEnabled, setRenderScale,
  setPresentMode, setSsgiEnabled, setSsaoEnabled, setSsrEnabled,
  setPathTracing, isPathTracingSupported,
  setShadowsEnabled, setBloomEnabled,
  writeFile,
} from 'bloom/core';
import { addPointLight, enableShadows } from 'bloom/scene';
import {
  createWorld, step as stepPhysics,
  boxShape, heightfieldShape, createBody, MotionType, Layer,
  setLayerCollides,
  setBodyPosition,
} from 'bloom/physics';
import {
  animPlay, animSetLayer, animUpdate,
  findJoint, jointWorld,
  createTextureArrayFromFiles, createTextureArrayFromTexels, setMaterialTextureArray,
  TEXTURE_ARRAY_ALBEDO, TEXTURE_ARRAY_NORMAL, TEXTURE_ARRAY_MR,
  TEX_ARRAY_FORMAT_SRGB, TEX_ARRAY_FORMAT_LINEAR,
  createRagdoll, activateRagdoll, pushRagdoll, updateRagdoll, releaseRagdoll,
} from 'bloom/models';
import { initInput, readInput, drawTouchControls, MOBILE } from './input';
import {
  createPlayer, updatePlayerController, playerPosition,
  playerGrounded, playerSpeed, startDodge, isDodging, dodgeCooldownFrac, isSprinting, isCrouching,
  setPlayerPosition,
} from './player';
import * as W from './world-runtime';
import { ENV, initEnvironment, initGiProxies } from './environment';
import { GS } from './gamestate';
import {
  DIR, initDirector, setDirectorDeps, updateDirector, updateEnemyProjectiles,
  countAlive, WAVE_BREAK_DELAY,
} from './director';
import {
  setCombatDeps, updateWeaponTransform, updateCombat, drawWeapon,
  drawCombatWorld, startRun, resetRun, PLAYER_HP_MAX,
  PICKUP_COUNT, PICKUP_RADIUS, PICKUP_RESPAWN, PICKUP_RIFLE,
  pickupActive, pickupKind, pickupRespawnT, pickupX, pickupY, pickupZ,
} from './combat';
import {
  CAM, TP_PITCH_MIN, TP_PITCH_MAX, TP_FOVY, CAMDBG,
  updateCameraLook, updateCameraOrbit,
} from './camera';
import { drawHud, drawOverlays } from './hud';
import {
  KIND_NAME, mdlAliens,
  ANIM_WALK_IDX, ANIM_ATTACK_IDX, ANIM_DIE_IDX, ANIM_PAIN_IDX, ANIM_DIE_DUR,
  KIND_SPINE_JOINT,
  KIND_SCALE, KIND_Y_OFF, KIND_SPEED, KIND_HP, KIND_MELEE, DRETCH_HIT_FLASH,
  AI_WINDUP, AI_FLINCH,
  BODIES_PER_KIND, MAX_ENEMIES,
  enX, enY, enZ, enHP, enAlive, enKind, enAttackCD, enFlashT,
  enDying, enDeathT, enDeathYaw,
  enAIState, enHeading,
  enAnimClip, enAttackLayer, enRangedCD,
  enRagdoll, enRagActive, enDeathDX, enDeathDY, enDeathDZ, enDeathImp,
  vxLast, vzLast, enBody, enAnim,
} from './enemies';
// --- AAA round: feel, VFX, weapons, audio mix, settings, score ---------------
import * as FEEL from './feel';
import * as VFX from './vfx';
import * as WPN from './weapons';
import * as MIX from './audio-mix';
import * as SET from './settings';
import * as SCORE from './score';
import { initMenus, menuOpen, openPause, openMain, closeMenu, updateMenu, drawMenu, currentMenu, MENU_NONE, applyGraphicsSettings } from './menu';
import {
  bootSplash, bootStage, bootOutro,
  BOOT_AUDIO, BOOT_MUSIC, BOOT_WORLD, BOOT_MESHES, BOOT_TREES, BOOT_TERRAIN,
  BOOT_PLAYER, BOOT_WEAPONS, BOOT_ALIENS, BOOT_VFX, BOOT_WATER, BOOT_GRASS,
  BOOT_PROPS, BOOT_SCENE, BOOT_READY,
} from './boot';
// Terrain comes from the same world file as everything else now; `T` is kept as
// an alias so the height-sampling call sites read the same as they always have.
import * as T from './world-runtime';
import { terrainHeightAt } from './terrain';
import { initNav } from './nav';

// Borderless fullscreen at the monitor's native resolution (the engine
// resizes its swapchain + all render targets on the WM_SIZE this triggers).
// The 1024×640 size is the windowed-mode fallback the engine restores to.
initWindow(1024, 640, 'Bloom Shooter', true);
setTargetFPS(60);
initInput();

// SH-037 — settings must load BEFORE anything reads them (input sensitivity,
// audio volumes, FOV, shake). A missing file is a first run, not an error.
SET.loadSettings();

// ---- CLI overrides for A/B-testing graphics settings -----------------------
// `main --render-scale 0.5|0.75|1` and `main --output-scale 0.5|0.75|1`
// override settings.json for this launch (they land in the live settings
// array, so the video menu shows them — and saving from the pause menu
// persists them). Values are matched against the fixed list instead of
// parsed: string equality on argv is safe (world-runtime does it), numeric
// parsing of FFI strings is not (perry-quirks #5). `--pt off|prog|rt`
// further below starts in that path-tracing mode without F9 taps.
function cliArg(name: string): string {
  const n = process.argv.length;
  for (let i = 0; i < n - 1; i++) {
    if (process.argv[i] === name) return process.argv[i + 1];
  }
  return '';
}
function cliScaleOverride(name: string, idx: number): void {
  const v = cliArg(name);
  if (v === '0.25') SET.set(idx, 0.25);
  else if (v === '0.5' || v === '0.50') SET.set(idx, 0.5);
  else if (v === '0.75') SET.set(idx, 0.75);
  else if (v === '1' || v === '1.0') SET.set(idx, 1.0);
}
cliScaleOverride('--render-scale', SET.SET_RENDER_SCALE);
cliScaleOverride('--output-scale', SET.SET_OUTPUT_SCALE);
// `--pt off|prog|rt` overrides the persisted path-tracing mode for this
// launch. Applied with the rest of the graphics settings below (and
// inert on devices without ray query, same as the menu row).
const cliPt = cliArg('--pt');
if (cliPt === 'off' || cliPt === '0') SET.set(SET.SET_PT, 0);
else if (cliPt === 'prog' || cliPt === '1') SET.set(SET.SET_PT, 1);
else if (cliPt === 'rt' || cliPt === '2') SET.set(SET.SET_PT, 2);
// `--dbg-off shadows|ssgi|ssao|ssr|bloom|taa` disables ONE render pass for
// this launch. The F5-F8 toggles cover the same passes interactively, but
// they cannot be driven from a batch run (PostMessage keys never reach the
// input state), and pass-bisection from a script is exactly how the leaf
// snow-dots (GTAO, engine #95) and the house-interior shadow leak were
// isolated. Debug aid — costs nothing when absent.
const cliDbgOff = cliArg('--dbg-off');

FEEL.setShakeScale(SET.get(SET.SET_SHAKE));
initMenus();

// ---- SH-049: the boot sequence ---------------------------------------------
// Everything below this line until `bootOutro()` is the game LOADING, and until
// now it did that behind a black, frozen window for several seconds. The splash
// runs first (it owns its own loop, so it is the one part of the boot that can
// animate smoothly); then each group of loads announces itself with a
// bootStage() call, which draws a frame of the loading screen. See src/boot.ts.
bootSplash(1.1);

// ---- M8 polish: audio -----------------------------------------------------
bootStage(BOOT_AUDIO);
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
// SH-042 — 7 kinds now. The basilisk and the advanced marauder are UPGRADE
// classes of the mantis (level1) and marauder (level2), and in Unvanquished an
// upgrade class shares its base class's voice. So their vocals map onto the base
// class's files rather than needing two new sets of art.
const SFX_KIND_VOICE = [0, 1, 2, 3, 4, 2, 3];
const sfxAlienDie: any[] = new Array(21);     // 7 kinds x 3 variants
const sfxAlienAttack: any[] = new Array(7);
const sfxAlienPain: any[] = new Array(7);
for (let k = 0; k < 7; k++) {
  const voice = SFX_KIND_VOICE[k];
  for (let v = 0; v < 3; v++) {
    const s = loadSound('assets/sounds/alien' + voice + '_die' + (v + 1) + '.wav');
    setSoundVolume(s, 0.75);
    sfxAlienDie[k * 3 + v] = s;
  }
  const a = loadSound('assets/sounds/alien' + voice + '_attack.wav');
  setSoundVolume(a, 0.55);
  sfxAlienAttack[k] = a;
  const p = loadSound('assets/sounds/alien' + voice + '_pain.wav');
  setSoundVolume(p, 0.40);
  sfxAlienPain[k] = p;
}
// SH-036 — two beds, crossfaded by combat intensity.
//
// `assets/music/` is authored art (see its SUNO-PROMPTS.md) and may not be there:
// the repo ships without it. So every music file is OPTIONAL, and the game falls
// back to the single `game.wav` bed it always had. With no music/ dir at all this
// behaves exactly as it did before — one track, no crossfade — and the moment the
// two stems land, the crossfade has somewhere to go with no code change.
//
// Both beds play SIMULTANEOUSLY from the start, and the crossfade is pure gain.
// Starting the combat bed on demand would cost a stream-open on the frame a wave
// spawns — the worst possible frame — and would start it at bar 0 while the calm
// bed is 40 s in, so the two would be out of phase.
bootStage(BOOT_MUSIC);
// OGG since the repo-weight pass (engine decode_audio handles ogg/mp3/wav by
// extension + sniffing, and the game already shipped ambient.ogg). The WAV
// masters stay in assets/music/src (untracked); tools/encode-music.ts
// re-encodes after tools/music-master.ts.
const musicMenu = loadMusic(
  fileExists('assets/music/music_menu.ogg') ? 'assets/music/music_menu.ogg'
                                            : 'assets/sounds/menu.ogg');

const HAS_STEMS = fileExists('assets/music/music_calm.ogg')
               && fileExists('assets/music/music_combat.ogg');
const musicCalm = loadMusic(HAS_STEMS ? 'assets/music/music_calm.ogg'
                                      : 'assets/sounds/game.ogg');
const musicCombat = loadMusic(HAS_STEMS ? 'assets/music/music_combat.ogg'
                                        : 'assets/sounds/game.ogg');
// Decode verification on the boot log — a bed that failed to decode is a
// handle of 0, and music failing SILENTLY is exactly how a format change
// would otherwise ship broken (post-init engine stderr is dead on Windows).
console.log('[music] menu=' + (musicMenu as any).handle
          + ' calm=' + (musicCalm as any).handle
          + ' combat=' + (musicCombat as any).handle);

setMusicVolume(musicMenu, 0.4);
setMusicVolume(musicCalm, 0.35);
setMusicVolume(musicCombat, 0.0);
playMusic(musicMenu);

/// The three one-shots that land ON TOP of the bed (they do not replace it).
/// Handle 0 = absent, and `playSound(0)` is a no-op in the engine, so a missing
/// stinger is silence rather than a crash.
const stingWaveClear = fileExists('assets/music/sting_wave_clear.ogg')
  ? loadSound('assets/music/sting_wave_clear.ogg') : { handle: 0 };
const stingDeath = fileExists('assets/music/sting_death.ogg')
  ? loadSound('assets/music/sting_death.ogg') : { handle: 0 };
const stingVictory = fileExists('assets/music/sting_victory.ogg')
  ? loadSound('assets/music/sting_victory.ogg') : { handle: 0 };

/// Apply the crossfade. `MIX.musicIntensity()` is the already-smoothed 0..1 the
/// mixer maintains (~2 s, with hysteresis), so this is just gain.
///
/// With no stems both handles point at the SAME file, and summing two gains of a
/// track against itself would make it louder in combat rather than different. So
/// in that case the calm handle carries the whole bed and the combat handle stays
/// silent — the pre-A4 behaviour, exactly.
function applyMusicCrossfade(): void {
  if (!HAS_STEMS) return;
  const i = MIX.musicIntensity();
  // Equal-power, not linear: two linear fades sum to a ~3 dB dip in the middle,
  // which is audible as the music briefly ducking every time a wave starts.
  setMusicVolume(musicCalm, Math.cos(i * Math.PI * 0.5) * 0.35);
  setMusicVolume(musicCombat, Math.sin(i * Math.PI * 0.5) * 0.35);
}

bootStage(BOOT_WORLD);
const physics = createWorld({ gravity: vec3(0, -20, 0) });
// Make NON_MOVING (static) and MOVING (character/dynamic) collide.
setLayerCollides(physics, Layer.NON_MOVING, Layer.MOVING, true);
setLayerCollides(physics, Layer.MOVING, Layer.MOVING, true);

// ---- World: arena_02 (loaded at runtime; see src/world-runtime.ts) --------
// Authored in assets/worlds/arena_02.world.json; flat-array TS module is
// read from assets/worlds/arena_02.world.json at startup. All geometry,
// lighting, spawners, pickups, and the wave plan come from that world data.
// The editor can read/write the same JSON → one source of truth.

const spawnPos: Vec3 = vec3(W.SPAWN_X, W.SPAWN_Y, W.SPAWN_Z);

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

// Tier 1.1 — load an HDR equirectangular environment. The engine
// convolves it into env_tex (specular) + env_diffuse_tex (ambient
// diffuse) at load time; refractive water + glass automatically
// pick it up via sample_env(). With nothing loaded the env binds
// are 1×1 black and PBR specular is dead.
setEnvClearFromHdr('assets/env/outdoor.hdr');
// Tier 1.2 — IBL strength. 1.0 = unit; bump up if the scene reads
// dim against the new HDR sky, pull back if it blows out.
setEnvIntensity(1.0);
// Tier 1.3 — three-cascade sun shadows. Adds ~3 ms of GPU work
// but grounds every object visually.
enableShadows();
// Tier 1.4 — auto-exposure. The HDR pipeline tonemaps to surface
// sRGB with a fixed exposure if this is off; auto follows scene
// luminance which is the right behaviour outdoors. The engine's
// histogram AE targets the key value below — tuned against the
// IBL-fill material lighting: 0.18 washed the stone to white before
// the materials sampled real irradiance, 0.12 went moody-dark after.
setAutoExposure(true);
setAutoExposureKey(0.155);
// Tier 1.5 — pale-blue distance haze. r,g,b,density,heightRef,
// heightFalloff. Density 0.012 reads as a soft far-plane haze
// without dimming the foreground.
// Pale-blue distance haze. Density ramps up at ground level and
// clears within ~10 m above, so river dips and tree-base shadows
// pool low fog while ridges stay clear — adds depth without
// muddying the whole frame.
// Round-2 (audit F2): heightRef sat exactly at water level (y≈0), so a
// grazing look along the river integrated the densest fog slab for the
// full valley length — the visible "milk band" hugged the waterline and
// spilled over the banks. Drop the reference below ground and thin the
// density: low pooling survives, the white sheet does not.
setFog(0.78, 0.84, 0.90, 0.016, -0.6, 6.0);
// Tier 1.7 — warm god-rays through the trees. Round-2 retune (audit F3):
// at 0.4/0.96 the 32-tap shaft march added up to ~+0.14 HDR of warm veil
// on every sunward silhouette — a big share of the "pale backlit
// treeline". 0.18/0.90 keeps the god-ray read without the wash.
setSunShafts(0.18, 0.90, 1.0, 0.95, 0.7);
// EN-013 — global wind UBO. All foliage materials (grass, trees,
// future ferns/clovers) read these values from PerFrame.wind so
// one source of truth drives the whole scene's swing.
//   dirX / dirZ — wind direction in the XZ plane (need not be unit)
//   amp         — peak displacement at full tip weight (~0.10 m for grass)
//   freq        — Hz; ~1 = lazy breeze, ~3 = gusty
// One number for the whole scene's wind: the grass sway, the tree bend (EN-041),
// the cloud drift (EN-040) and the leaf-rustle bed (SH-001) all read it.
const WIND_AMP = 0.10;
setWind(0.85, 0.50, WIND_AMP, 1.6);
// EN-040 — opt the world into the cloud deck the sky is already drawing, so a
// shadow crossing the field has a cloud above it. Before this, the sky, the
// grass and the terrain each carried a private noise field: the ground darkened
// under clouds that were not there, drifting ~80x faster than the ones that
// were, and the forest standing in that grass ignored the whole business.
//
// Strength 0.45 = a shadowed surface keeps a bit over half its direct sun. The
// deck drifts downwind of setWind() above, so the clouds travel the way the
// grass is leaning. Deck height and feature scale are deliberately NOT free
// knobs — they set the size of the cloud and of its shadow at the same time.
// Deck at 150 m with 125 m puffs: the two are COUPLED (sky puff size =
// (deck - eye) x scale), so this pair is what keeps the sky reading the way it
// always has while making the shadows arena-scale -- one or two crossing the
// field rather than one blanket over all of it.
setCloudShadows(0.45, 150, 0.008, 6);
// TAA + TSR reconstruction. Setting the scale explicitly opts out of the
// legacy TAA coupling (which would otherwise silently halve the internal
// resolution). 0.75 at 4K output = 2880x1620 internal, reconstructed to
// native by the TSR upscale inside the TAA pass. Re-measured 2026-07-14
// on the 4K dev box after the perf rounds: 0.5 ~46 fps but visibly
// upscale-soft, 0.75 ~30 fps and dramatically sharper, 1.0 ~19 fps
// (stills territory - selectable in the video menu). The PT realtime
// trace grid is budget-capped engine-side, so this scale does not
// multiply the ray cost.
setTaaEnabled(true);
setRenderScale(0.75);
// 2026-07-06 fullscreen-lag investigation: the Lumen SW-GI camera-follow
// bakes (SDF clipmap + WSRC) used to re-run as single full-volume
// dispatches whenever the view moved — a 1-2.4 s GPU stall every ~5 s of
// mouse-look on the 760M. The engine now amortizes both (binned + sliced
// clipmap bake into a staging volume, one WSRC cascade per frame), so
// SSGI stays enabled.

// ---- Mobile render budget --------------------------------------------------
// Everything above is tuned for a discrete desktop GPU. A phone is a tile-based
// deferred GPU on a battery: the screen-space passes are the expensive part, and
// they're the ones that scale worst. Cut the three that cost the most per pixel
// and keep the two that carry most of the look (sun shadows and bloom).
//
// Lumen SW-GI is the big one — it re-bakes an SDF clipmap as the view moves,
// which is a GPU stall the phone has no headroom to absorb. SSR goes with it.
//
// GTAO stays ON. It was cut with the other two at first, but measured on an
// iPhone 16 Pro it doesn't cost a frame-rate tier: mid-wave the frame sits at
// 25.0 ms either way (the same ~40 fps), and the title screen holds 60. It buys
// back the contact shadows that seat the grass, trees and aliens on the ground
// instead of leaving them looking pasted over it — the cheapest of the three
// screen-space passes by some margin, and the one with the best return.
//
// Read that "free" precisely, though: present mode is Fifo on a 120 Hz panel,
// so every frame snaps to a multiple of 8.33 ms and GTAO is being absorbed by
// slack inside a bucket rather than costing nothing. It eats margin. If a
// heavier wave starts tipping frames from the 25 ms bucket into the 33 ms one,
// this is the first thing to put back. (Per-pass GPU timings would settle it,
// but the profiler reports -1 on iOS — the Metal backend doesn't get
// TIMESTAMP_QUERY — so wall-clock at a fixed point in the wave is the honest
// instrument here.)
//
// Render scale stays at 0.5 (TSR reconstructs to native in the TAA pass), which
// on a 2622x1206 iPhone means a ~1311x603 internal buffer — the same
// pixel-bound cost as a 720p desktop frame.
if (MOBILE) {
  setSsgiEnabled(false);
  setSsrEnabled(false);
  setSsaoEnabled(true);
  setShadowsEnabled(true);
  setBloomEnabled(true);
  setTaaEnabled(true);
  setRenderScale(0.5);
  // Sun shafts are a full-screen radial blur — pure cost for a pass the player
  // only sees when looking near the sun. Strength 0 is off.
  setSunShafts(0, 0.90, 1.0, 0.95, 0.7);
}

// The player's graphics choices win over every default above.
//
// This is the last word on purpose: everything before it is what WE think the
// game should look like on this class of hardware, and this line is where the
// person actually looking at the screen overrules us. On a 4K display the two
// resolution sliders are worth more than every other setting combined, and they
// trade sharpness against frame rate in opposite directions — which of those a
// player wants is not something a game gets to decide for them.
//
// (MOBILE keeps its own profile: a phone has no settings screen and no headroom
// to give away.)
if (!MOBILE) applyGraphicsSettings();
// --dbg-off (see the CLI block above) applies after the persisted settings
// so it always wins for the launch it was asked for.
if (cliDbgOff === 'shadows') setShadowsEnabled(false);
else if (cliDbgOff === 'ssgi') setSsgiEnabled(false);
else if (cliDbgOff === 'ssao') setSsaoEnabled(false);
else if (cliDbgOff === 'ssr') setSsrEnabled(false);
else if (cliDbgOff === 'bloom') setBloomEnabled(false);
else if (cliDbgOff === 'taa') setTaaEnabled(false);

// Static box colliders — invisible physics walls that bound the plaza
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

// Heightfield terrain collider — matches assets/models/terrain_hills.glb.
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
// MESH_MODEL_IDX → UNIQUE_MODELS. Real GLBs are loaded once here and
// drawn via drawModel each frame. Box-placeholder entries (modelRef
// `_gizmo_box.glb`) get a coloured drawCube fallback at draw time,
// tinted by category (0 = generic, 1 = building stone, 2 = terrain
// green, 3 = prop brown).
const MESH_TINT_R = [150, 196, 120, 130];
const MESH_TINT_G = [148, 168,  90,  95];
const MESH_TINT_B = [140, 130,  70,  80];
bootStage(BOOT_MESHES);
const meshModelHandles = new Array<number>(W.UNIQUE_MODEL_COUNT);
for (let i = 0; i < W.UNIQUE_MODEL_COUNT; i++) {
  meshModelHandles[i] = W.MODEL_IS_BOX[i] === 1 ? 0 : loadModel(W.UNIQUE_MODELS[i]);
}
// Round-4 (de-cartoonification) — the Kenney low-poly gumdrops were the
// single biggest "toy world" signal: flat-shaded solid-colour polyhedra.
// Back to the PUBG-style leaf-card trees (bark-textured tapered trunk +
// alpha-cutout leaf-card canopy). Drawn through the cached-model scene
// shader, which gives them wind sway, backlit leaf transmission and
// dappled cutout shadows for free — and they show up in the water's
// planar reflection (cached models render into the probe). Three GLB
// variants (normal / tall-narrow / short-wide) from build-props.ts.
// Swaying tree SHADOWS: correct, but a caster that moves every frame cannot reuse
// the cached static shadow depth. Measured on this box (AMD 760M, 4K/TSR):
// see docs/tickets.md SH-013 for the number that decided this.
const FOLIAGE_SHADOW_MOTION = false;

bootStage(BOOT_TREES);
const treeVariants = [
  loadModel('assets/models/prop_tree.glb'),
  loadModel('assets/models/prop_tree2.glb'),
  loadModel('assets/models/prop_tree3.glb'),
];
// SH-013 / EN-041 - the trees are plants, so let the wind bend them.
//
// Until now the engine swayed ALPHA-CUT materials only, which meant the leaf
// cards fluttered and all 88 trunks stood perfectly rigid - a forest of poles
// with twitching hair. The wind is hierarchical now: the trunk leans slowly
// (the motion you read at 30 m), the branches swing at their own rate, and the
// leaves flutter fast at the tips.
for (let i = 0; i < treeVariants.length; i++) setModelFoliageWind(treeVariants[i], 1.0);
// Swaying SHADOWS are a separate, paid-for decision: a caster that moves cannot
// reuse the cached static shadow depth, so all 88 trees would re-render into
// every cascade every frame. Measured before switching on - see docs/tickets.md
// SH-013.
setFoliageShadowMotion(FOLIAGE_SHADOW_MOTION);
// All tree GLBs are 4 primitives: trunk + 2 branch stubs + leaf cards.
const TREE_GLB_PARTS = 4;
// Front-to-back draw order for the forest (see the draw loop). Flat arrays,
// Perry convention — allocated once, rewritten each frame.
const FOREST_D = new Array<number>(W.FOREST_COUNT);
const FOREST_ORD = new Array<number>(W.FOREST_COUNT);

// The forest, read from the world file. Each tree is an entity (kind
// `prop_tree`), so it can be moved, retinted, deleted, or added in the editor —
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

// Hoisted per-tree draw objects. A tree's position and tint never change after
// load, but the draw loop was building a fresh vec3 + tint literal for every
// tree every frame — 176 objects x 60 fps of pure garbage (perf-audit
// finding 11). Built once; the FFI only reads their fields.
const FOREST_POS = new Array<any>(FOREST_COUNT);
const FOREST_TINTO = new Array<any>(FOREST_COUNT);
for (let i = 0; i < FOREST_COUNT; i++) {
  FOREST_POS[i] = vec3(FOREST_X[i], FOREST_Y[i], FOREST_Z[i]);
  FOREST_TINTO[i] = { r: FOREST_TINT_R[i], g: FOREST_TINT_G[i], b: FOREST_TINT_B[i], a: 255 };
}

// Round-9 — trunk colliders for the scatter forest. The world-authored
// prop_tree entities carry box colliders from the world file, but these
// 88 trees never got physics bodies — the player walked straight through
// them. One slim static box per trunk; the canopy stays shoot-through on
// purpose. Bullets now ricochet off trunks via the existing ALL_LAYERS
// raycast, and the orbit camera's NON_MOVING ray already handles trunks.
for (let i = 0; i < FOREST_COUNT; i++) {
  const tr = 0.26 * FOREST_SCALE[i];   // half-extent ≈ bark radius at the base
  const th = 1.6 * FOREST_SCALE[i];    // half-height — trunk only, not canopy
  const trunkShape = boxShape(vec3(tr, th, tr));
  createBody(physics, trunkShape, {
    motionType: MotionType.STATIC,
    position: vec3(FOREST_X[i], FOREST_Y[i] + th, FOREST_Z[i]),
    objectLayer: Layer.NON_MOVING,
    friction: 0.9,
  });
}

// (Camera occlusion — the trunk-only collider problem and the measured canopy
// cylinders — lives in src/camera.ts now, with the orbit follow it feeds.)

let treePropIdx = -1;
let terrainPropIdx = -1;
for (let i = 0; i < W.UNIQUE_MODEL_COUNT; i++) {
  if (W.UNIQUE_MODELS[i] === 'assets/models/prop_tree.glb')     { treePropIdx    = i; }
  if (W.UNIQUE_MODELS[i] === 'assets/models/terrain_hills.glb') { terrainPropIdx = i; }
}

// Same hoist for the static-mesh pass: positions are world data (immutable at
// runtime) and the cube tint depends only on the 4-entry category table.
const MESH_POS = new Array<any>(W.MESH_COUNT);
for (let i = 0; i < W.MESH_COUNT; i++) {
  MESH_POS[i] = vec3(W.MESH_X[i], W.MESH_Y[i], W.MESH_Z[i]);
}
const MESH_COLS = new Array<any>(4);
for (let c = 0; c < 4; c++) {
  MESH_COLS[c] = { r: MESH_TINT_R[c], g: MESH_TINT_G[c], b: MESH_TINT_B[c], a: 255 };
}

// Round-9 — flat obstacle-circle list for enemy steering. Enemies are
// KINEMATIC (steered in XZ, setBodyPosition) so Jolt never resolves their
// contacts — they need code-side avoidance. Circles cover every tree trunk
// (forest entities plus prop_tree static meshes) and, since house v2, the
// GROUND-FLOOR building walls: a row of circles along each wall piece that
// actually blocks a walker. The door and window openings get no circles, so
// enemies funnel through the doors instead of clipping through masonry.
// The +256 is the wall-circle budget (~1 per metre of ground-floor wall).
const OBST_MAX = FOREST_COUNT + W.MESH_COUNT + 256;
const OBST_X = new Array<number>(OBST_MAX);
const OBST_Z = new Array<number>(OBST_MAX);
const OBST_R = new Array<number>(OBST_MAX);
for (let i = 0; i < FOREST_COUNT; i++) {
  OBST_X[GS.OBST_COUNT] = FOREST_X[i];
  OBST_Z[GS.OBST_COUNT] = FOREST_Z[i];
  OBST_R[GS.OBST_COUNT] = 0.30 * FOREST_SCALE[i];
  GS.OBST_COUNT = GS.OBST_COUNT + 1;
}
for (let i = 0; i < W.MESH_COUNT; i++) {
  if (W.MESH_MODEL_IDX[i] === treePropIdx && GS.OBST_COUNT < OBST_MAX) {
    OBST_X[GS.OBST_COUNT] = W.MESH_X[i];
    OBST_Z[GS.OBST_COUNT] = W.MESH_Z[i];
    OBST_R[GS.OBST_COUNT] = 0.30 * W.MESH_SCALE[i];
    GS.OBST_COUNT = GS.OBST_COUNT + 1;
  }
}
// House v2 walls. A building box blocks a ground walker when it starts at
// (or in) the floor and reaches above knee height — that selects the solid
// wall strips, window sills and stair-adjacent pieces, and skips door
// lintels, upper floors, slabs and the roof.
for (let i = 0; i < W.MESH_COUNT; i++) {
  const mi = W.MESH_MODEL_IDX[i];
  if (W.MODEL_IS_BOX[mi] !== 1 || W.MESH_CATEGORY[i] !== 1) continue;
  // SH-051 — a STAIR is not a wall. This filter cannot tell them apart on shape:
  // a step is a thin box rising from the floor past knee height, which is
  // exactly the wall test below, and 9 of the 12 steps in each flight matched
  // it. So the staircase was ringed with 0.7 m repulsion circles and enemies
  // were physically fenced out of the one route upstairs — the "they don't go
  // up stairs" half of SH-051, and the reason it was never a pathing problem.
  // (The old comment here claimed the filter deliberately kept "stair-adjacent
  // pieces"; it was keeping the stairs themselves.) Climbability is not a
  // property of one box, so it is authored: world-runtime reads the `stair` tag.
  if (W.MESH_IS_STAIR[i] === 1) continue;
  const hy = W.MESH_COLLIDER_HY[i];
  const yLo = W.MESH_Y[i] - hy;
  const yHi = W.MESH_Y[i] + hy;
  if (yLo > 0.7 || yHi < 1.2) continue;          // not a ground-level blocker
  const hx = W.MESH_COLLIDER_HX[i];
  const hz = W.MESH_COLLIDER_HZ[i];
  const thin = Math.min(hx, hz);
  if (thin > 0.6) continue;                      // slab/floor plate, not a wall
  const long = Math.max(hx, hz);
  const alongX = hx >= hz;
  // NB the 0.55 here is NOT a body allowance — director.ts adds bodyR on top, so
  // a wall repels to thin + 0.55 + bodyR (~1.3 m for the big kinds). It is
  // padding to cover the ~1 m circle spacing below, which would otherwise leave
  // gaps a walker could slip through.
  //
  // SH-051 measured the alternative (r = thin + 0.15 with 0.4 m spacing, which
  // seals the wall just as well and inflates it far less) and REVERTED it: it
  // did not fix stair-mounting, which is what it was for, and re-tuning every
  // enemy-vs-wall interaction in the game is not a free change to make on the
  // way past. Kept here as a note for whoever does the pathfinding work — this
  // padding is a real part of why the stair approach is so tight.
  const r = thin + 0.55;
  // One circle per ~metre of wall, clamped so even a short piece gets one.
  const n = Math.max(1, Math.floor(long / 0.5));
  for (let s = 0; s < n && GS.OBST_COUNT < OBST_MAX; s++) {
    const t = n === 1 ? 0 : -long + (2 * long * s) / (n - 1);
    OBST_X[GS.OBST_COUNT] = W.MESH_X[i] + (alongX ? t : 0);
    OBST_Z[GS.OBST_COUNT] = W.MESH_Z[i] + (alongX ? 0 : t);
    OBST_R[GS.OBST_COUNT] = r;
    GS.OBST_COUNT = GS.OBST_COUNT + 1;
  }
}

// SH-051 — obstacle budget, printed because overflowing it fails SILENTLY (the
// loop just stops adding, leaving a wall with a hole in it). If count == max,
// raise OBST_MAX; do not shrug.
console.log('[obst] ' + GS.OBST_COUNT + ' / ' + OBST_MAX + ' circles'
  + (GS.OBST_COUNT >= OBST_MAX ? '  *** CAP HIT — walls may be unsealed ***' : ''));

// House bounds, derived from the building boxes — the reverb zone and any
// other "near the house" logic reads these instead of hardcoding a footprint
// (the old hardcoded reverb centre (0,-14) wasn't even where the house IS).
let BLDG_CX = 0, BLDG_CZ = 0, BLDG_HX = 0, BLDG_HZ = 0;
{
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  let anyB = false;
  for (let i = 0; i < W.MESH_COUNT; i++) {
    const mi = W.MESH_MODEL_IDX[i];
    if (W.MODEL_IS_BOX[mi] !== 1 || W.MESH_CATEGORY[i] !== 1) continue;
    anyB = true;
    if (W.MESH_X[i] - W.MESH_COLLIDER_HX[i] < bx0) bx0 = W.MESH_X[i] - W.MESH_COLLIDER_HX[i];
    if (W.MESH_X[i] + W.MESH_COLLIDER_HX[i] > bx1) bx1 = W.MESH_X[i] + W.MESH_COLLIDER_HX[i];
    if (W.MESH_Z[i] - W.MESH_COLLIDER_HZ[i] < bz0) bz0 = W.MESH_Z[i] - W.MESH_COLLIDER_HZ[i];
    if (W.MESH_Z[i] + W.MESH_COLLIDER_HZ[i] > bz1) bz1 = W.MESH_Z[i] + W.MESH_COLLIDER_HZ[i];
  }
  if (anyB) {
    BLDG_CX = (bx0 + bx1) * 0.5;
    BLDG_CZ = (bz0 + bz1) * 0.5;
    BLDG_HX = (bx1 - bx0) * 0.5;
    BLDG_HZ = (bz1 - bz0) * 0.5;
  }
}

// Tier 2a — terrain colour material. Compile via the file-based
// API for hot-reload, then push the param UBO via setMaterialParams
// directly (loadMaterial's array-length pass-through is unreliable
// under Perry — the FFI receives zero count for inline literals).
//   grass_dry rgb  pad   grass_mid rgb  pad   grass_deep rgb pad   dirt rgb pad
//   noise_freq, slope_threshold, ridge_height, pale_strength
bootStage(BOOT_TERRAIN);
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
  // The four albedo/normal pairs. The world file may name them (PLAN §D — the
  // editor's paint tool writes `terrain.layers`), in which case ITS order is the
  // ABI and the splat channels line up with it. A world with no layers — which
  // is both shipped arenas — falls back to the built-in set, and the terrain
  // looks exactly as it did before any of this existed.
  //
  // The normal map is found by convention: <name>_albedo.png -> <name>_normal.png.
  // A layer whose normal is missing gets a flat one; the array just needs the
  // slice to exist.
  const authored = W.TERRAIN_SPLAT_COUNT > 0;
  const albedoPaths = new Array<string>(4);
  const normalPaths = new Array<string>(5);
  const fallback = [
    'assets/textures/terrain_grass_lush_albedo.png',
    'assets/textures/terrain_grass_dry_albedo.png',
    'assets/textures/terrain_dirt_albedo.png',
    'assets/textures/terrain_rock_albedo.png',
  ];
  for (let i = 0; i < 4; i++) {
    const p = (authored && i < W.TERRAIN_SPLAT_COUNT) ? W.TERRAIN_SPLAT_TEX[i] : fallback[i];
    albedoPaths[i] = p;
    normalPaths[i] = replaceSuffix(p, '_albedo.png', '_normal.png');
  }
  // SH-010's detail normal rides slice 4 of the normal array. It used to occupy
  // the MR slot, which the splat map now needs — there are only three (EN-014).
  normalPaths[4] = 'assets/textures/terrain_detail_normal.png';

  const albedoArr = createTextureArrayFromFiles(albedoPaths, TEX_ARRAY_FORMAT_SRGB, 4);
  // Normals MUST be linear — sRGB-decoding an encoded normal corrupts it.
  const normalArr = createTextureArrayFromFiles(normalPaths, TEX_ARRAY_FORMAT_LINEAR, 4);

  // The splat map: one RGBA8 texel per terrain cell, built once at load from the
  // painted weights. Linear, no mips — it is data, not a picture, and a mip
  // chain would bleed one layer's coverage into its neighbour's at distance.
  const splatArr = createTextureArrayFromTexels(
    W.TERRAIN_SPLAT_DATA, W.TERRAIN_SPLAT_TEXELS,
    W.TERRAIN_SPLAT_W, W.TERRAIN_SPLAT_H, 1,
    TEX_ARRAY_FORMAT_LINEAR, 1,
  );

  if (matTerrain > 0 && albedoArr > 0) {
    setMaterialTextureArray(matTerrain, TEXTURE_ARRAY_ALBEDO, albedoArr);
    setMaterialTextureArray(matTerrain, TEXTURE_ARRAY_NORMAL, normalArr);
    setMaterialTextureArray(matTerrain, TEXTURE_ARRAY_MR, splatArr);
  } else {
    console.log('[terrain] splat textures missing - run: bun tools/build-terrain-textures.ts');
  }
}

/// Swap a filename suffix. Perry-safe: no regex, no split.
function replaceSuffix(s: string, from: string, to: string): string {
  if (!s.endsWith(from)) return s;
  return s.substring(0, s.length - from.length) + to;
}
const TERRAIN_PARAMS = [
  // Per-layer tint (multiplied into the sampled albedo), so the palette stays
  // tunable without regenerating the art. Kept near 1 — the textures already
  // carry the colour; these only nudge it. Keep them OLIVE, not emerald: the
  // round-4 de-cartoonification pass exists because saturated greens read as a
  // plastic lawn, and a tint is the easiest place to walk back into that.
  //
  // The 4th component is NOT a tint — it is the layer's SOURCE SCAN SIZE IN
  // METRES (Poly Haven `dimensions`), which terrain.wgsl turns into that
  // layer's UV scale so every scan tiles at 1:1 physical size. It was 0.0 when
  // the field was unused; a 0 now would divide by zero (the shader clamps, and
  // you would get one texel smeared over the arena). If you swap a layer's
  // texture, put its real size here.
  0.92, 0.96, 0.84,  2.0,    // lush — forrest_ground_01,     2.0 m
  0.98, 0.94, 0.80,  2.0,    // dry  — withered_grass,        2.0 m
  1.00, 0.94, 0.82,  1.3,    // dirt — brown_mud_dry,         1.3 m (warmed to brown)
  0.88, 0.90, 0.96,  1.83,   // rock — cliff_side,            1.83 m (cooled — the
                             //        scan is a warm orange sandstone)
  // macro noise freq, slope threshold (cos), ridge height, pale strength
  0.18, 0.72, 4.0,   0.45,
  // river: centre z, half-width, bank fade width, waterline y.
  // Matches the arena_02 river volume (z=12, carve half-width 2.6).
  // SH-050 — bank fade 1.8 -> 3.0: the brown mud now has to READ as a bank, and
  // a 1.8 m fade put the whole grass->mud transition inside a stride.
  12.0, 2.4, 3.0,    0.12,
  // global tiling multiplier, detail UV scale, detail strength, normal strength
  //
  // 1.0 = every layer at its true physical size. This replaces the old 0.35
  // "tiles/metre", which tiled all four layers on one 2.86 m period regardless
  // of what they were scanned at.
  //
  // Detail strength 0.35 -> 0.22: the detail normal was a CONSTANT (a flat
  // no-op) until SH-050 fixed the fbm that generates it, so 0.35 was tuned
  // against a texture that did nothing. Now that it has relief, and the layers
  // under it carry measured normals of their own, the old value double-counts
  // the grit.
  1.0, 6.0, 0.22,   0.85,
  // Splat UV: u = p.x * su + ou, v = p.z * sv + ov. Filled in below — it depends
  // on the world's terrain grid, so it cannot be a literal here.
  0.0, 0.0, 0.0, 0.0,
];
{
  // Map world XZ to the splat texture. Weights are authored per grid POINT, so
  // point (x,z) is texel centre ((x+0.5)/W, (z+0.5)/W) — hence the half-texel in
  // the offset. Get this wrong and the paint lands half a cell off the ground it
  // was painted on, which reads as "the brush is inaccurate" rather than as a
  // bug in a UV.
  const n = W.TERRAIN_SPLAT_W;
  const su = 1.0 / (W.TERRAIN_CELL_SIZE * n);
  const sv = 1.0 / (W.TERRAIN_CELL_SIZE * n);
  const ou = 0.5 / n - W.TERRAIN_ORIGIN_X * su;
  const ov = 0.5 / n - W.TERRAIN_ORIGIN_Z * sv;
  // Index 28, not 24: the four per-layer tints are 16 floats, so the vec4s land
  // at 0/4/8/12 (tints), 16 (knobs), 20 (river), 24 (scales), 28 (splat_uv).
  // Writing to 24 silently overwrites the detail-normal scales and leaves
  // splat_uv zero — which reads as "the splat map is empty", not as "the params
  // are off by one vec4".
  const SPLAT_UV = 28;
  TERRAIN_PARAMS[SPLAT_UV + 0] = su;
  TERRAIN_PARAMS[SPLAT_UV + 1] = ou;
  TERRAIN_PARAMS[SPLAT_UV + 2] = sv;
  TERRAIN_PARAMS[SPLAT_UV + 3] = ov;
}
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

// (The third-person orbit camera — the CAM array-slot state, pitch/orbit
// constants, aim assist and the occlusion-aware follow — is src/camera.ts,
// SH-025d. CAM is imported above; element writes cross modules reliably.)

// ---- Third-person player model (human_bsuit) -----------------------------
// Converted via tools/convert-aliens-anim.ts. Drawn at the physics-character
// position, facing the camera's horizontal yaw so the player always looks
// "away from the camera" (classic 3rd-person over-the-shoulder feel).
bootStage(BOOT_PLAYER);
const mdlPlayer  = loadModel('assets/models/player_bsuit.glb');
const animPlayer = loadModelAnimation('assets/models/player_bsuit.glb');
// human_bsuit animation indices (IQE declaration order):
//   0 idle, 7 attack, 8 run, 12 walk.
// The ground speed each locomotion clip was AUTHORED to travel at. The playback
// rate is (actual speed / this), which is what plants the feet — get these wrong
// and the character skates.
const ANIM_WALK_SPEED = 2.6;
const ANIM_RUN_SPEED  = 6.5;

const PLAYER_ANIM_IDLE   = 0;
const PLAYER_ANIM_WALK   = 12;
const PLAYER_ANIM_RUN    = 8;
const PLAYER_ANIM_ATTACK = 7;
// SH-048 — crouch clips (bsuit indices). Because the body turns to face its
// movement direction (SH-047), the character always crouch-walks "forward"
// relative to itself, so the single crouch_forward clip covers every heading —
// the directional crouch_left/right/back clips (20/21/19) are not needed.
const PLAYER_ANIM_CROUCH     = 17;   // crouch idle
const PLAYER_ANIM_CROUCH_FWD = 18;   // crouch walk
// Authored ground speed of the crouch_forward clip, for foot-planting (see the
// note on ANIM_WALK_SPEED). A guess until measured; tune if the feet slide.
const ANIM_CROUCH_SPEED = 1.6;
const PLAYER_SCALE = 1.0;
const PLAYER_MODEL_Y_OFFSET = -0.95;    // character capsule center -> feet
let playerAnimT = 0;

// SH-047 — the body turns to face where it is MOVING, relative to the camera's
// forward. Strafing left (A) faces the body 90° left, A+W faces it 45°, and
// releasing turns it back to forward. This is the natural "face the movement
// direction" model — the requested angles fall straight out of the input, since
// WASD already quantises the movement vector to those directions.
//
// Smoothed, not snapped: `playerFaceOffset` is the current facing offset (in
// radians, relative to camera-forward) and it eases toward the input each frame,
// so a turn and a release both READ as the body repositioning rather than
// popping. The offset is kept relative to the camera, not as an absolute world
// yaw, so looking around does not drag the body with it.
//
// The AIM/weapon still points along the camera (see combat.ts) — only the body
// turns. When aiming down sights the body snaps back to forward, because at that
// point you are pointing the gun, not walking somewhere.
let playerFaceOffset = 0;
const PLAYER_TURN_RATE = 14;   // higher = snappier reposition

// SH-027 — real weapon models, replacing the two grey drawCube primitives that
// were the most visible placeholder left in the game. Built by
// tools/build-weapons.ts; local +Z is down the barrel and the muzzle distances
// below are the ABI that file prints (keep them in sync).
bootStage(BOOT_WEAPONS);
const mdlWeapons = [
  loadModel('assets/models/weapon_rifle.glb'),
  loadModel('assets/models/weapon_blaster.glb'),
  loadModel('assets/models/weapon_chaingun.glb'),
  loadModel('assets/models/weapon_cannon.glb'),
];
// Muzzle distance down the barrel, metres. These pair with the `length` column
// in tools/convert-weapons.ts, which normalises each model to that length
// precisely so these constants survive an art change.
const WEAPON_MUZZLE_Z = [0.87, 0.59, 1.00, 0.95];
const WEAPON_DRAW_SCALE = [1.0, 1.0, 1.0, 1.0];

// EN-033 — the hand joint, so the weapon rides the animation instead of
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
// ANIMDBG only — a joint that swings hard in any gait, so "is the pose actually
// moving?" is a number and not an opinion.
const dbgAnkle = findJoint(animPlayer, 'ankle.R');

// SH-033 — VFX. Cosmetic, so a failure here must never take the game down:
// initVfx() returns false and every emit call becomes a no-op.
bootStage(BOOT_VFX);
const vfxOk = VFX.initVfx();
if (!vfxOk) console.log('[vfx] disabled - shaders or textures failed to load');

// Round 2 — audio mix (buses, reverb, footsteps, music intensity).
MIX.initAudioMix();
// SH-001 — put the leaf-rustle bed on the actual forest. The centroids come from
// the tree positions in the world file, so moving the forest in the editor moves
// the sound with it.
MIX.initWindAmbience(W.FOREST_X, W.FOREST_Z, W.FOREST_COUNT, WIND_AMP);

// Weapons: stat table + state.
WPN.initWeapons();
// Unlocks persist across runs (SH-041).
{
  const mask = SET.unlockMask();
  for (let i = 0; i < WPN.WEAPON_COUNT; i++) {
    if ((mask & (1 << i)) !== 0) WPN.unlock(i);
  }
}


initEnvironment();

// SH-051 — build the vertical-navigation tables (walkable building boxes + the
// stair flights) from the world data. Must run before the director's first
// update; it makes no engine calls, but it reads world-runtime, so it lives
// here at an explicit boot position rather than at some module's import time.
initNav();

// ---- Enemies (SH-025: kinds, stats, pool state → src/enemies.ts) ----------
const WHITE = { r: 255, g: 255, b: 255, a: 255 };
initDirector(physics);

// ---- Combat (SH-025c: weapon/fire/projectiles/pickups → src/combat.ts) ----
// Phase 7 / Round-3 — seconds until the next wading splat may fire.
// Splatting every moving frame overwhelmed the field's 3.2%/frame decay
// (steady state ~19× over max — a stuck white smear); one splat per
// 0.15 s at lower strength holds it near 1.0 instead.
let splatCooldown = 0;

// (drawRunSummary — the SH-041 score card — is src/hud.ts now, with the
// overlays that draw it.)

// (The old impact-spark ring buffer that lived here is gone: nothing had
// called spawnSpark since SH-033 — VFX.emitImpactHard IS the impact spark
// now — yet its decay and draw loops still ran every frame.)

let cursorLocked = true;
let screenshotSeq = 0;
let perfOverlayOn = false;
// ---- Render-pass debug toggles --------------------------------------------
// Live F5-F8 toggles for the screen-space effects, with an always-on status
// line top-left. Isolates any visual artifact to one pass in a single run
// (this is how the 2026-07 shadow/SSAO bugs were tracked down — see
// docs/shadow-cascade-and-ssao-fixes.md). Kept as a standing debug aid.
let dbgSsgi = true;
let dbgSsao = true;
// F9 cycles path tracing: 0 off -> 1 progressive -> 2 realtime -> 0.
// Progressive accumulates while the camera is still (stand still and the
// image converges); realtime is the denoised gameplay mode. No-op on
// devices without hardware ray query.
// PT state lives in the settings array (SET_PT) — the menu row, the F9
// debug cycle, the --pt CLI flag and the HUD all read/write one value.
// applyGraphicsSettings() pushed the persisted mode at boot.
const ptSupported = isPathTracingSupported();
let dbgSsr = true;
let dbgShadow = true;

// ---- M8 polish: post-FX ---------------------------------------------------
// Called once at startup — these are cheap, always-on stylistic passes.
setVignette(0.4, 0.55);    // darken frame edges
setFilmGrain(0.018);       // barely-there noise — 0.05+ reads as heavy speckle
                           // over sky/shadow areas (phase-0 calibration).

bootStage(BOOT_SCENE);
initGiProxies(meshModelHandles, treeVariants, terrainPropIdx, TREE_GLB_PARTS);


// ---- Self-test harness ----------------------------------------------------
// When SELFTEST is true the game auto-fires a shot on frame 30, screenshots
// the scene on frame 60, and exits on frame 90. Used while investigating the
// engine's deferred-render green-screen bug — kept dormant for future debug.
const SELFTEST = false;
// FACETEST (SH-047) — see the input-override block. dbgFaceDir: 0=D(right,90°),
// 1=A(left,90°), 2=W+D(45°). MUST be false in shipped builds.
const FACETEST = false;
const dbgFaceDir = 0;
// KEYPROBE — verify the engine's Windows Shift/Ctrl fix reaches isKeyDown().
// Latches whether each modifier was EVER seen down and writes it to a file, so a
// synthetic hardware keypress (SendInput, scancode path) can confirm the real
// wndproc→map_keycode path — which injectKeyDown bypasses. MUST be false.
const KEYPROBE = false;
// 0 lshift-ever  1 rshift-ever  2 lctrl-ever
const KP = [0, 0, 0];
// LOCOPROBE (SH-048) — verify sprint AND crouch through the REAL keys. Auto-
// starts, forces a strafe so the player is always moving, reads the actual
// Shift/C keys (does NOT override them), and logs speed + clip so a synthetic
// Shift / C hold shows the tier change. MUST be false in shipped builds.
const LOCOPROBE = false;
let locoLog = '';
let testFrame = 0;

// ---- WATERTEST harness (temporary diagnostic) -------------------------------
// Auto-starts a run, holds the camera on the river (the yaw the river spans
// along) and wades the player up/down the band at spawn so an external
// capture script can verify the water look + footstep wake without real
// input. Wading stops after 20 s of uptime so wake decay can be captured
// too. Same dormancy contract as SELFTEST/PERFTEST: MUST be false in
// shipped builds.
const WATERTEST = false;
// Wall-clock anchor for the scripted walk — getTime() at frame 20 already
// includes several seconds of asset loading, so timings are relative to
// the moment the harness starts the run.
let waterTestT0 = -1;

// ---- AITEST harness (temporary diagnostic) ----------------------------------
// Round-9 AI verification: auto-starts the run, keeps the player alive and
// stationary, and logs each live enemy's kind / AI state / distance once a
// second so an external batch run can confirm the per-kind state machines
// (dretch weave, mantis orbit→dart→recover, dragoon windup→charge) actually
// cycle. Same dormancy contract as SELFTEST/WATERTEST/PERFTEST: MUST be
// false in shipped builds.
const AITEST = false;
let aitestDone = false;

// ---- ANIMDBG harness (temporary diagnostic) ---------------------------------
// The walk clip looks dead and sprint looks dead. Rather than guess which of the
// three links is broken (input -> controller -> clip select -> mixer), drive a
// scripted 3 s walk / 3 s sprint cycle and print, side by side:
//   rep_spd   what playerSpeed() REPORTS
//   real_spd  what the world actually did (position delta / dt)
//   ankleAmp  how far the ankle joint MOVED in the pose this window
// If rep_spd is 0 while real_spd is 4.5, the accessor is lying (the Perry
// small-numeric-fn miscompile, EN-050/051). If they agree and ankleAmp is ~0,
// the mixer never advances the clip. Each answer accuses a different file.
//
// It was the mixer (engine models.rs anim_play — a re-requested clip restarted
// its own fade forever and pinned cur_time at 0), and `grounded` reading false
// on 3 of every 4 walking frames, which is what made sprint unreachable. Both
// fixed; the harness stays because the next locomotion bug will want it.
//
// `orbit=` also reports the camera occlusion distance (want vs. actual), which
// is how the canopy zoom was verified.
//
// MUST be false in shipped builds: it suppresses every enemy wave.
// ---- MENUTEST harness (temporary diagnostic) --------------------------------
// SH-049 verification. Drives the front-end through the REAL input path
// (injectKeyDown — OS-synthesised keys do not reach this game) and records what
// the menu actually did:
//
//   MAIN --down,down--> SETTINGS row --enter--> SETTINGS
//        --escape--> back to MAIN (NOT into an unstarted game)
//        --enter on PLAY--> gameState 1, HUD on, cursor captured
//
// The back-target (menu.ts S[3]) and PLAY are the two things a screenshot cannot
// tell you, and a green compile REALLY cannot: cross-module refs in this codebase
// fail at RUNTIME, one identifier at a time. Writes a file, because console.log
// from this game does not survive a redirect on Windows. Dormancy contract as
// ever: MUST be false in shipped builds.
const MENUTEST = false;
let menuTestLog = '';
let menuTestDone = false;

// ---- INDOORCAM harness (temporary diagnostic) -------------------------------
// Pins the camera inside the house ground floor (overriding the orbit) so an
// interior frame can be captured / pass-bisected from a batch run — this plus
// --dbg-off is how the interior shadow-leak stipple was isolated to the
// shadow pass. Starts a run at frame 20 like the other harnesses. Same
// dormancy contract: MUST be false in shipped builds.
const INDOORCAM = false;
const ANIMDBG = false;
// Sub-mode of ANIMDBG: walk into the tree behind the camera and then stand
// still, so an external window capture (tools/shot-window.ps1 — takeScreenshot()
// still writes no file on Windows) gets a stationary, occluded frame to shoot.
const CAMHOLD = false;
let animDbgDone = false;
let dbgSprint = 0;
// (Camera occlusion readback — orbit shortened-to vs. wanted — is CAMDBG,
// exported by src/camera.ts and written every frame.)
// 0 prevX  1 prevZ  2 have-prev  3 measured speed  4 ankle min  5 ankle max
const AD = [0, 0, 0, 0, 1e9, -1e9];

// ---- COMBATSHOT harness -----------------------------------------------------
// Drives a REAL fight and screenshots it, because the AAA-round systems (VFX,
// decals, recoil, hit-stop, flinch, HUD) can only be judged in combat and the
// game takes the whole screen while it runs. Auto-starts the run, spawns a
// couple of enemies in front of the player, holds the trigger, and captures at
// a few points. Same dormancy contract as the other harnesses: MUST be false in
// shipped builds.
const COMBATSHOT = false;

// ---- STAIRTEST harness (temporary diagnostic) -------------------------------
// SH-051's acceptance test, and the only honest one: it asks whether enemies
// ACTUALLY CLIMB, which no screenshot can answer (a still of an alien on a
// staircase and a still of one clipped through it look identical).
//
// Teleports the player onto the FIRST FLOOR (y 3.90 + the capsule's 0.95 centre
// offset), holds them there, and every second prints how many living enemies
// are above the ground floor and the highest Y any of them has reached.
//
// Reading it:
//   hpMin=100         -> nothing reached the player. The melee gate holds.
//   hpMin<100         -> melee is landing through the ceiling (the reported bug).
//   above=0 forever   -> nothing climbed.
//   above>0, maxY~3.9 -> they made it up flight 0. THAT is the climb pass.
//   maxY drifting up with above=0 -> floating, not climbing.
//
// WHAT IT MEASURED (2026-07-15), and the A/B is the point — a probe that cannot
// fail proves nothing, so the gate was removed to check this one can:
//   sameFloor gate ON  -> hpMin=100   (no hit, ever)
//   sameFloor gate OFF -> hpMin=76    (24 damage, from enemies 3.7 m BELOW)
// That is the whole "I die without them being physically near me" report,
// reproduced on demand and then fixed.
//
// Climb status: NOT PASSING. Enemies route from under the player to the stair
// FOOT (~10 m of correct navigation) and then hover at x~-10.9 without
// mounting. See SH-051 in docs/tickets.md — the approach gap is 0.5 m and the
// wall's obstacle circles repel to ~1.3 m, so the first climbable tread is
// unreachable. Fixing it needs real pathfinding, not another nudge.
//
// The player is held at full HP so the run cannot end mid-measurement.
// MUST be false in shipped builds.
const STAIRTEST = false;
let stairTestT = 0;
/// Lowest HP the director left before the harness topped it back up. 100 means
/// nothing ever landed a hit; anything less is damage taken through the floor.
let stairTestHpMin = 100;

// ---- FPSPROBE harness (temporary diagnostic) --------------------------------
// One number, for A/B-ing a change that might cost frames: wall-clock FPS over
// a fixed window on the TITLE SCREEN, which renders the whole world as its
// backdrop from a fixed camera (pos 0,1,20 — see the title path) and so is
// deterministic between runs in a way gameplay is not.
//
// PERFTEST already measures fps, but it is a staged ELEVEN-config bisect with a
// profiler dump; this is for "did that one change cost anything", where the
// answer has to be comparable across two builds and nothing else may vary.
//
// Wall clock over a frame window, NOT getFPS() sampled once: a single sample
// off the smoothed counter is noise, and the round-2 audit found the profiler's
// own averages go stale. Prints one FPSPROBE line to stdout — run batch with
// output redirected. Same dormancy contract as SELFTEST/PERFTEST: MUST be false
// in shipped builds.
const FPSPROBE = false;
const FPSPROBE_SETTLE = 240;   // frames to let boot + TAA + the GI clipmap settle
const FPSPROBE_MEASURE = 240;  // frames in the measured window
let fpsProbeT0 = 0;
let fpsProbeDone = false;

// ---- PERFTEST harness (temporary diagnostic) --------------------------------
// Bisects the fullscreen slowdown: measures wall-clock FPS over 120-frame
// windows on the title screen (full world renders as the backdrop), toggling
// one pipeline feature per stage. Stage 0 is the shipped config under Fifo
// vsync; every later stage runs Mailbox (uncapped) so the vsync cap can't
// mask differences. The final stage re-enables the shipped config with the
// engine profiler on and dumps the per-pass CPU/GPU table. Prints PERF /
// PERFPASS lines to stdout — run batch with output redirected. Flip to false
// (or delete) when the investigation closes.
const PERFTEST = false;
// Mode 0 — staged feature bisect on the title screen (deterministic backdrop).
// Mode 1 — gameplay timeline: injects a keypress to start the run, keeps the
// player alive, and logs fps / worst-frame / alive-enemy count per 60-frame
// window; the profiler turns on for the final third to get a combat per-pass
// table.
const PERF_MODE = 1;
// false = stay on the title screen (stationary world backdrop — used for
// external flicker captures); true = auto-start the run at frame 20.
const PERF_START_GAME = true;
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

// Scripted kill for mode 1 — mirrors the rifle-kill death path exactly so
// death-triggered work (first die-anim playback, body teleport, sound) can
// be correlated with frame spikes deterministically.
function perfKillOne(): void {
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] > 0) {
      enAlive[i] = 0;
      enDying[i] = 1;
      enDeathT[i] = 0;
      enDeathYaw[i] = enHeading[i];
      // SH-031 ragdoll fields — the death anim reads these into native
      // f64 params, so a scripted kill must set them like a real shot.
      enDeathDX[i] = 0;
      enDeathDY[i] = 0.3;
      enDeathDZ[i] = -1;
      enDeathImp[i] = 40;
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


// ---- Boot complete ---------------------------------------------------------
// Everything is loaded. Hold the full bar long enough to read, fade to black,
// and come up on the main menu over the live arena. The cursor is FREE here —
// it is a menu, not a game; PLAY takes it back (see ACT_PLAY below).
bootStage(BOOT_READY);
bootOutro();
openMain();
enableCursor();
cursorLocked = false;

// SH-025b — hand the director the handles it steers with (compiler-
// verified list; see DEPS in director.ts). The pickup state comes from
// combat.ts now; main just wires the two modules together here.
setDirectorDeps({
  CAM, physics,
  TP_FOVY,
  PICKUP_COUNT, PICKUP_RADIUS, PICKUP_RESPAWN, PICKUP_RIFLE,
  sfxImpactFlesh, sfxPickup, stingDeath, stingVictory, stingWaveClear,
  OBST_X, OBST_Z, OBST_R,
  sfxAlienAttack, sfxAlienDie, sfxAlienPain, sfxPlayerPain, sfxPlayerDie,
  pickupActive, pickupKind, pickupRespawnT, pickupX, pickupY, pickupZ,
});

// SH-025c — same pattern for the combat module: camera + physics handles,
// the player model the weapon rides, the weapon models + their ABI columns,
// and the audio handles combat plays. Once, before the loop.
setCombatDeps({
  CAM, physics, TP_PITCH_MIN, TP_PITCH_MAX,
  animPlayer, playerHandJoint, PLAYER_SCALE, PLAYER_MODEL_Y_OFFSET,
  mdlWeapons, WEAPON_MUZZLE_Z, WEAPON_DRAW_SCALE,
  sfxFireRifle, sfxFireBlaster, sfxRicochet, sfxPlayerDie, stingDeath,
  musicMenu, musicCalm, musicCombat,
});

while (!windowShouldClose() && !aitestDone && !animDbgDone) {
  beginDrawing();
  if (PERFTEST) {
    const nowTop = getTime();
    perfMsBegin = perfPrevEnd > 0 ? (nowTop - perfPrevEnd) * 1000 : 0;
    perfTTop = nowTop;
  }
  const dtRaw = getDeltaTime();
  // A stalled frame — SDF-clipmap re-bake, window drag, driver hiccup — can hand
  // back 300 ms+ here, and one explicit-Euler step that big teleports the sim:
  // a charging dragoon (8.5 m/s) crosses ~2.6 m in a single step, clean over a
  // wall's ~1.3 m repulsion ring and into the house. Cap the step at 100 ms so
  // below 10 fps the world slows down instead of tunnelling.
  const dtReal = dtRaw > 0.1 ? 0.1 : dtRaw;
  // SH-029 — hit-stop. `dt` is what the SIMULATION sees, so a kill briefly
  // freezes the world; `dtReal` keeps driving the feedback decay, the menus and
  // the camera, or a hit-stop would freeze its own recovery.
  const dt = menuOpen() ? 0 : FEEL.applyHitstop(dtReal);
  FEEL.updateFeel(dtReal);
  if (GS.gameState === 1 && !GS.gameOver && !DIR.gameWon && !menuOpen()) GS.runElapsed = GS.runElapsed + dt;
  // iOS reports the screen in *pixels*, where macOS reports points (engine
  // EN-024). On a 3x iPhone that makes every hardcoded HUD offset below come
  // out a third of its intended size — an unreadable 13px status line on a
  // 2622px-wide screen. Rather than rescale forty draw calls, lay the HUD out
  // in a fixed ~1000-unit-wide logical space and let the 2D camera scale the
  // whole pass (see the beginMode2DRaw below). sw/sh are that logical space;
  // swPx/shPx stay the real pixels, which is what touch coordinates arrive in.
  const swPx = getScreenWidth();
  const shPx = getScreenHeight();
  const uiScale = MOBILE ? swPx / 1000 : 1;
  const sw = swPx / uiScale;
  const sh = shPx / uiScale;
  // Both beds must be pumped every frame while they are playing, or the one that
  // is currently silent starves and its buffer runs dry — so the moment the
  // crossfade brings it up, it comes in late and out of phase with the other.
  if (GS.gameState === 0) {
    updateMusicStream(musicMenu);
  } else {
    updateMusicStream(musicCalm);
    if (HAS_STEMS) updateMusicStream(musicCombat);
    applyMusicCrossfade();
  }

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
  // Render-pass debug toggles. F5 SSGI, F6 SSAO, F7 SSR, F8 shadows — flip
  // each off to see which pass owns a visual artifact. Status line in the HUD.
  if (isKeyPressed(Key.F5)) { dbgSsgi = !dbgSsgi; setSsgiEnabled(dbgSsgi); }
  if (isKeyPressed(Key.F6)) { dbgSsao = !dbgSsao; setSsaoEnabled(dbgSsao); }
  if (isKeyPressed(Key.F7)) { dbgSsr = !dbgSsr; setSsrEnabled(dbgSsr); }
  if (isKeyPressed(Key.F8)) { dbgShadow = !dbgShadow; setShadowsEnabled(dbgShadow); }
  if (isKeyPressed(Key.F9) && ptSupported) {
    const ptNext = (SET.get(SET.SET_PT) + 1) % 3;
    SET.set(SET.SET_PT, ptNext);
    setPathTracing(ptNext);
  }

  const input = readInput(dtReal);
  testFrame = testFrame + 1;

  // STAIRTEST driver — see the harness block above the loop.
  if (STAIRTEST) {
    if (testFrame === 20 && GS.gameState === 0) { startRun(); cursorLocked = true; }
    if (testFrame > 24) {
      // Pin the player to the first floor, mid-slab. Re-applied every frame:
      // gravity would otherwise walk them straight back down the stairs they
      // are standing next to, and the point is to hold a cross-floor state.
      // Read the HP the director left behind BEFORE topping it up. Logging it
      // after the reset (the first cut of this harness did) reports 100 forever
      // and measures nothing — the probe has to be able to fail.
      const hpLeft = GS.playerHP;
      if (hpLeft < stairTestHpMin) stairTestHpMin = hpLeft;
      setPlayerPosition(vec3(-20.0, 3.90 + 0.95, -13.0));
      GS.playerHP = 100;
      // Put the enemies where the BUG REPORT put them: already inside the
      // house, on the ground floor, directly under the player. Spawning them
      // outside instead tests the game's lack of pathfinding (they press on the
      // exterior wall hunting for a door), which is a real but SEPARATE gap and
      // not what "they don't go up stairs" is about. One-shot, at frame 90.
      if (testFrame === 90) {
        for (let i = 0; i < MAX_ENEMIES; i++) {
          if (enAlive[i] === 0) continue;
          enX[i] = -20.0 + (i % 3) * 1.2;
          enY[i] = 0.20;
          enZ[i] = -13.0 + (i % 2) * 1.2;
        }
      }
      stairTestT = stairTestT + dtReal;
      if (stairTestT >= 1.0) {
        stairTestT = 0;
        let alive = 0, above = 0, maxY = -99, nearest = 999;
        const ppS = playerPosition();
        for (let i = 0; i < MAX_ENEMIES; i++) {
          if (enAlive[i] === 0) continue;
          alive = alive + 1;
          if (enY[i] > 2.0) above = above + 1;
          if (enY[i] > maxY) maxY = enY[i];
          const ddx = ppS.x - enX[i], ddy = (ppS.y - 0.95) - enY[i], ddz = ppS.z - enZ[i];
          const d3 = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
          if (d3 < nearest) nearest = d3;
        }
        // Where the nearest one actually IS. "Stuck at 8 m" is not a diagnosis;
        // stuck at the east wall vs stuck at the stair foot are different bugs.
        let ni = -1; let nd = 1e9;
        for (let i = 0; i < MAX_ENEMIES; i++) {
          if (enAlive[i] === 0) continue;
          const ddx = ppS.x - enX[i], ddz = ppS.z - enZ[i];
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < nd) { nd = d2; ni = i; }
        }
        const npos = ni >= 0
          ? enX[ni].toFixed(1) + ',' + enY[ni].toFixed(2) + ',' + enZ[ni].toFixed(1)
          : 'none';
        console.log('STAIRTEST alive=' + alive + ' above=' + above
          + ' maxEnemyY=' + maxY.toFixed(2)
          + ' nearest3D=' + nearest.toFixed(1)
          + ' nearestPos=' + npos
          + ' hpMin=' + stairTestHpMin);
      }
    }
  }

  // FPSPROBE stage driver — one wall-clock window on the title screen, printed
  // once. See the harness block above the loop.
  if (FPSPROBE && !fpsProbeDone) {
    if (testFrame === FPSPROBE_SETTLE) fpsProbeT0 = getTime();
    if (testFrame === FPSPROBE_SETTLE + FPSPROBE_MEASURE) {
      const wall = getTime() - fpsProbeT0;
      console.log('FPSPROBE fps=' + (FPSPROBE_MEASURE / wall).toFixed(2)
        + ' ms=' + (1000 * wall / FPSPROBE_MEASURE).toFixed(2)
        + ' grass=' + ENV.GRASS_INSTANCE_COUNT);
      fpsProbeDone = true;
    }
  }

  // KEYPROBE — latch each modifier ever-down and dump it (see the flag above).
  if (KEYPROBE) {
    if (isKeyDown(Key.LEFT_SHIFT)) KP[0] = 1;
    if (isKeyDown(Key.RIGHT_SHIFT)) KP[1] = 1;
    if (isKeyDown(Key.LEFT_CONTROL)) KP[2] = 1;
    if ((testFrame % 20) === 0) {
      writeFile('tools/.testout/keyprobe.txt',
        'lshift_ever=' + KP[0] + ' rshift_ever=' + KP[1]
        + ' lctrl_ever=' + KP[2]
        + ' lshift_now=' + (isKeyDown(Key.LEFT_SHIFT) ? 1 : 0) + '\n');
    }
  }

  // ---- SH-038: pause + menus -------------------------------------------
  // Esc / Start opens the pause menu mid-fight; the sim freezes (dt = 0 above)
  // but the world keeps rendering behind the dim, so you can see what you
  // paused. Audio keeps running deliberately — a silent pause is jarring.
  if (input.pausePressed && GS.gameState === 1 && !GS.gameOver && !DIR.gameWon) {
    if (menuOpen()) {
      closeMenu();
      if (cursorLocked) disableCursor();
    } else {
      openPause();
      enableCursor();
    }
  }
  // MENUTEST — see the harness block above. Injects into the engine's own key
  // state, so updateMenu() reads it exactly as it reads a real player.
  if (MENUTEST && !menuTestDone) {
    const f = testFrame;
    if (f === 40) menuTestLog = menuTestLog + 'boot: menu=' + currentMenu() + ' (want 4=MAIN) gameState=' + GS.gameState + '\n';
    // Row 0 PLAY -> row 2 SETTINGS.
    if (f === 45) injectKeyDown(Key.DOWN);
    if (f === 47) injectKeyUp(Key.DOWN);
    if (f === 52) injectKeyDown(Key.DOWN);
    if (f === 54) injectKeyUp(Key.DOWN);
    if (f === 60) injectKeyDown(Key.ENTER);
    if (f === 62) injectKeyUp(Key.ENTER);
    if (f === 70) menuTestLog = menuTestLog + 'after ENTER on SETTINGS row: menu=' + currentMenu() + ' (want 2=SETTINGS)\n';
    // ESC must go BACK to MAIN — not close the menu, and not kill the process.
    if (f === 80) injectKeyDown(Key.ESCAPE);
    if (f === 82) injectKeyUp(Key.ESCAPE);
    if (f === 90) menuTestLog = menuTestLog + 'after ESC in settings: menu=' + currentMenu() + ' (want 4=MAIN, alive=yes)\n';
    // back() resets the selection to row 0 = PLAY.
    if (f === 100) injectKeyDown(Key.ENTER);
    if (f === 102) injectKeyUp(Key.ENTER);
    if (f === 115) {
      menuTestLog = menuTestLog + 'after ENTER on PLAY: menu=' + currentMenu()
        + ' (want 0=NONE) gameState=' + GS.gameState + ' (want 1)'
        + ' cursorLocked=' + (cursorLocked ? 1 : 0) + ' (want 1)\n';
      writeFile('tools/.testout/menutest.txt', menuTestLog);
      menuTestDone = true;
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
    } else if (act === 5) {               // ACT_PLAY — start the run
      startRun();
      cursorLocked = true;
      disableCursor();
    } else if (act === 4) {               // ACT_LEVEL — chosen, needs a relaunch
      // The whole world (colliders, heightfield, 20k grass instances, 267 GI
      // proxies, the forest's trunk bodies) is built once at startup, so
      // swapping levels in place means tearing all of it down. Until EN-032's
      // async load makes that seamless, be honest: the choice is saved and the
      // next launch is in it.
      GS.levelChangeT = 4.0;
    }
  }

  // PERFTEST stage driver — see the harness block above the loop.
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
    if (PERF_START_GAME && testFrame === 20 && GS.gameState === 0) {
      startRun();
      DIR.waveBreakTimer = WAVE_BREAK_DELAY;
    }
    GS.playerHP = PLAYER_HP_MAX;
    GS.gameOver = false;
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
        + ' alive=' + perfAliveNow + ' wave=' + DIR.waveIdx);
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
    // takeScreenshot works on Windows) — 4 consecutive frames at 6
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
        + ' wave=' + DIR.waveIdx);
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
  // LOCOPROBE (SH-048) — force a strafe and log the locomotion tier from the
  // REAL keys (Shift / C are left untouched, so a synthetic hold changes them).
  // Logs LAST frame's player state, which is what a 15-frame cadence wants.
  if (LOCOPROBE) {
    if (testFrame === 20 && GS.gameState === 0) startRun();
    GS.playerHP = 100; DIR.waveBreakTimer = 9999;
    CAM[0] = 0; CAM[1] = 0.30;
    input.moveX = 1;                 // strafe +X, stays on the plaza a while
    if (GS.gameState === 1 && (testFrame % 15) === 0) {
      const shift = isKeyDown(Key.LEFT_SHIFT) ? 1 : 0;
      const ckey = isKeyDown(Key.C) ? 1 : 0;
      locoLog = locoLog + 'f=' + testFrame
        + ' shiftKey=' + shift + ' cKey=' + ckey
        + ' spd=' + playerSpeed().toFixed(2)
        + ' sprint=' + (isSprinting() ? 1 : 0)
        + ' crouch=' + (isCrouching() ? 1 : 0) + '\n';
      writeFile('tools/.testout/locoprobe.txt', locoLog);
    }
  }
  // FACETEST (SH-047) — verify the body turns to face its movement direction.
  // Auto-starts, pins the camera at yaw 0 (camera looks -Z, so strafe-right D is
  // world +X = screen-right), and holds one strafe so a capture shows the body
  // facing the way it moves. Change dbgFaceDir to test A / W+D. MUST be false.
  if (FACETEST) {
    if (testFrame === 20 && GS.gameState === 0) startRun();
    GS.playerHP = 100; DIR.waveBreakTimer = 9999;   // no enemies to shove it
    CAM[0] = 0; CAM[1] = 0.30;
    input.moveX = dbgFaceDir === 0 ? 1 : (dbgFaceDir === 1 ? -1 : 1);
    input.moveZ = dbgFaceDir === 2 ? -1 : 0;         // dir 2 = W+D (45°)
  }
  // Watertest: start the run, aim down the river, wade back and forth
  // along it (direction swaps every ~1.2 s; the river spans X so the
  // camera-forward walk stays inside the band). See harness block above.
  if (WATERTEST) {
    if (testFrame === 20 && GS.gameState === 0) {
      startRun();
    }
    // Round-6 verification: waves ENABLED so enemy size/facing/shadows can
    // be judged in the captures. (Re-suppress with DIR.waveBreakTimer = 9999
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
    GS.playerHP = PLAYER_HP_MAX;
    GS.gameOver = false;
    // Face -Z: spawn is (0, 20), the river band is z 9.5..14.5, so the
    // river lies dead ahead and the camera looks across it at the far
    // bank. moveZ = -1 is forward (same convention as SELFTEST).
    CAM[0] = 0;
    CAM[1] = 0.42;
    input.moveX = 0;
    input.moveZ = 0;
    if (GS.gameState === 1) {
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
  // ANIMDBG — scripted walk/sprint cycle. See the harness block above.
  if (ANIMDBG) {
    if (testFrame === 20 && GS.gameState === 0) startRun();
    GS.playerHP = PLAYER_HP_MAX;
    GS.gameOver = false;
    DIR.waveBreakTimer = 9999;      // no enemies: this walk must not be shoved
    // Yaw the camera onto the tree at (5.3, 25.9) — nearest to the (0, 20)
    // spawn — so the ORBIT (which trails behind the player) sweeps into its
    // canopy and back out as the scripted walk moves down that axis. Walking
    // "forward" here walks away from the tree, so the occlusion builds and
    // releases without any hand-steering.
    CAM[0] = -0.735;
    CAM[1] = 0.35;
    if (GS.gameState === 1) {
      const tA = getTime();
      const seg = Math.floor(tA / 3);
      // 3 s walk fwd, 3 s sprint fwd, 3 s walk back, 3 s sprint back — so the
      // player stays near spawn instead of walking into the far wall (a wall
      // would zero the speed and the probe would read that as the bug).
      dbgSprint = (seg % 2) === 1 ? 1 : 0;
      input.moveX = 0;
      input.moveZ = (seg % 4) < 2 ? -1 : 1;
      input.sprintDown = dbgSprint !== 0;
      // CAMHOLD: walk INTO the tree behind the camera, then stand still, so an
      // external window capture has a stationary, strongly-occluded frame to
      // shoot. moveZ = +1 is "backward" = toward the tree at this yaw.
      if (CAMHOLD) {
        dbgSprint = 0;
        input.sprintDown = false;
        input.moveZ = testFrame < 42 ? 1 : 0;
      }
      input.aimDown = false;    // both cancel sprint — see wantSprint below
      input.fireDown = false;
      if (testFrame > 1200) animDbgDone = true;
    }
  }
  // AITEST — see the harness block above WATERTEST.
  if (AITEST) {
    if (testFrame === 20 && GS.gameState === 0) {
      startRun();
    }
    GS.playerHP = PLAYER_HP_MAX;   // immortal observer
    GS.gameOver = false;
    CAM[0] = 0;
    CAM[1] = 0.55;              // high-ish pitch — survey the field
    input.moveX = 0;
    input.moveZ = 0;
    if (GS.gameState === 1 && (testFrame % 60) === 0) {
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
  // Only apply mouse look when cursor is captured — avoids jumpy yaw/pitch
  // when the user is moving the mouse outside the window. The first ~10
  // frames after window creation often report giant mouse deltas (system
  // cursor settling into the captured state), which can fling the camera
  // to a useless angle before the player even sees the scene.
  if (cursorLocked && testFrame > 10 && !menuOpen()) {
    // SH-039 pad aim assist + look application — camera.ts.
    updateCameraLook(input.lookX, input.lookY, input.padActive);
  }

  const playing = GS.gameState === 1 && !GS.gameOver && !DIR.gameWon && !menuOpen();

  // Restart on R when the run has ended (died or won); otherwise R reloads.
  // Reload is TIMED now (SH-028) — you can be punished for it.
  if (input.reloadPressed) {
    if (GS.gameOver || DIR.gameWon) resetRun();
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

  // SH-032 — dodge. Commits the player for 0.25 s, so it is a decision, not a
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
    // Sprint cancels aiming and is cancelled by firing — you cannot run and
    // shoot accurately, which is what makes sprint a real trade.
    const wantSprint = input.sprintDown && !input.aimDown && !input.fireDown;
    updatePlayerController(dt, input.moveX, input.moveZ, fwd, rgt, input.jump,
      wantSprint, input.crouchDown);
    if (wantSprint && playerSpeed() > 6.5) FEEL.addFovKick(6 * dt * 4);
  }
  stepPhysics(physics, dt);
  // The one authoritative player-position read per frame. Everything below the
  // physics step aliases this — four always-on sites used to re-cross the FFI
  // for a value that cannot change between here and endDrawing.
  const ppFrame = playerPosition();

  // SH-028 — weapon timers (cooldown, reload, spread recovery, aim/spool).
  {
    const wasReloading = WPN.isReloading();
    WPN.updateWeapons(dt, playing && input.fireDown, playing && input.aimDown);
    if (wasReloading && !WPN.isReloading()) MIX.reloadEnd();
    if (playing) WPN.autoReloadIfEmpty();
  }
  SCORE.updateScore(dt);
  if (PERFTEST) perfTA = getTime();

  // Phase 7 — footstep / water-entry splats. When the player is
  // inside the river band, submit an impulse at their XZ every
  // frame they're moving. The compute pass decays these over ~2s
  // so the water shader can render persistent ripples.
  {
    const pp = ppFrame;
    const inRiver = pp.z > ENV.WATER_CZ - ENV.WATER_D * 0.5 &&
                    pp.z < ENV.WATER_CZ + ENV.WATER_D * 0.5 &&
                    Math.abs(pp.x) < ENV.WATER_W * 0.5;
    const moving = Math.abs(input.moveX) + Math.abs(input.moveZ) > 0.1;
    splatCooldown -= dt;
    if (inRiver && moving && splatCooldown <= 0) {
      splatImpulse(pp.x, pp.z, 1.0, 0.4);
      splatCooldown = 0.15;
    }

    // SH-003 — footsteps. Distance-accumulated, so the cadence follows sprint
    // and walk for free. Firing a step also kicks dust (SH-033), which is the
    // pairing that sells a footfall: you hear it AND the ground reacts.
    if (playing) {
      const surface = inRiver ? 2 : 0;
      const stepped = MIX.updateFootsteps(
        playerSpeed() * dt, surface, playerGrounded(), pp.x, pp.y - 0.9, pp.z);
      if (stepped && !inRiver) {
        VFX.emitFootDust(pp.x, pp.y - 0.92, pp.z, playerSpeed() > 7 ? 3 : 1);
      }
      if (stepped && inRiver) VFX.emitSplash(pp.x, ENV.WATER_Y, pp.z);
    }

    // SH-035 — reverb zone. `enclosure` rises as the player nears the building
    // footprint, so a firefight by the walls sounds like a firefight by the
    // walls. Ramped, not switched (a hard cut clicks on any tail in flight).
    // The footprint comes from the world's building boxes (BLDG_* above) —
    // the old hardcoded centre (0,-14) was 21 m east of the actual house, so
    // the room reverb had never once fired inside the room.
    const bdx = Math.abs(pp.x - BLDG_CX);
    const bdz = Math.abs(pp.z - BLDG_CZ);
    const near = Math.max(bdx / (BLDG_HX + 3), bdz / (BLDG_HZ + 3));
    const enclosure = near < 1 ? (1 - near) : 0;
    MIX.updateReverbZone(dtReal, enclosure);
    MIX.updateWindAmbience(dtReal, pp.x, pp.z, WIND_AMP);
  }

  // Smooth orbit camera follow after the physics step: occlusion-aware
  // (probe fan vs. static bodies + analytic canopy cylinders) - camera.ts.
  updateCameraOrbit(dt, physics);
  // INDOORCAM — see the harness block above. Overrides the orbit with a fixed
  // interior viewpoint: NW corner of the ground floor looking across at the
  // stairs + south door.
  if (INDOORCAM) {
    if (testFrame === 20 && GS.gameState === 0) { startRun(); cursorLocked = true; }
    DIR.waveBreakTimer = 9999;
    CAM[2] = -30.0; CAM[3] = 1.9; CAM[4] = -18.5;
    CAM[5] = -14.0; CAM[6] = 1.2; CAM[7] = -7.0;
  }
  playerAnimT = playerAnimT + dt;

  // SH-027 / EN-033: where the gun actually is — computed ONCE per frame and
  // reused by the draw, the muzzle flash, the tracer and the shot ray (all in
  // combat.ts now), so what you see and what you hit come from the same number.
  updateWeaponTransform();

  updateDirector(dt, dtReal, playing);

  // testFrame is incremented above the input block so the mouse-settle
  // grace period uses the same counter.
  let forceFire = false;
  if (COMBATSHOT) {
    if (testFrame === 20 && GS.gameState === 0) {
      startRun();
      // startRun() bypasses the menu's ACT_PLAY handler, and that handler is
      // the only place that sets cursorLocked — without this the fire path
      // (gated on cursorLocked) never triggers and the harness silently
      // captures a fight with no shots. Broken since SH-049 put a real menu
      // in front of the game.
      cursorLocked = true;
      SCORE.resetScore();
      GS.runElapsed = 0;
    }
    GS.playerHP = PLAYER_HP_MAX;          // immortal — we want the fight, not a death
    GS.gameOver = false;
    DIR.waveBreakTimer = 9999;             // suppress the director; we place our own
    CAM[1] = 0.30;
    // Two enemies dead ahead, respawned if killed, so there's always something
    // to shoot at and to bleed on the ground.
    if (testFrame === 30 || (testFrame > 30 && (testFrame % 240) === 0)) {
      // The two NEW kinds (adv marauder, adv dragoon) — the ranged ones.
      // Melee kinds, close in, so they die fast and we can watch them fall.
      for (let s = 0; s < 2; s++) {
        const slot = (1 + s) * BODIES_PER_KIND;    // mantis, marauder
        const k = enKind[slot];
        enX[slot] = -3 + s * 6;
        enZ[slot] = 15;                            // close, in front of the player
        enY[slot] = terrainHeightAt(enX[slot], enZ[slot]);
        enHP[slot] = KIND_HP[k];                   // killable — we want corpses
        enAlive[slot] = 1;
        enDying[slot] = 0;
        enAnimClip[slot] = -1;
        enAttackCD[slot] = 0;                      // let them SHOOT — that's the point
        enRangedCD[slot] = 0.5;
        enHeading[slot] = Math.PI;
        setBodyPosition(enBody[slot],
          vec3(enX[slot], enY[slot] + KIND_Y_OFF[k], enZ[slot]), true);
      }
    }
    // Face them and hold the trigger. Keep the reserve topped up so the capture
    // isn't three-quarters reload animation.
    if (testFrame > 35) {
      CAM[0] = 0;
      CAM[1] = 0.38;              // see the corpses land
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
    DIR.waveBreakTimer = 9999;
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

  // Fire + player projectile update (SH-028/033/042, M7) — combat.ts. The
  // COMBATSHOT harness's forceFire goes through the same path.
  updateCombat(dt, playing, cursorLocked, input.fireDown, input.firePressed, forceFire);
  updateEnemyProjectiles(dt, playing);
  if (GS.muzzleFlashT > 0) GS.muzzleFlashT = GS.muzzleFlashT - dt;
  if (GS.damageFlashT > 0) GS.damageFlashT = GS.damageFlashT - dt;
  if (GS.lastHitT > 0) GS.lastHitT = GS.lastHitT - dtReal;
  if (GS.hitMarkT > 0) GS.hitMarkT = GS.hitMarkT - dtReal;
  if (GS.levelChangeT > 0) GS.levelChangeT = GS.levelChangeT - dtReal;
  if (GS.waveBonusT > 0) GS.waveBonusT = GS.waveBonusT - dtReal;
  if (GS.unlockBannerT > 0) GS.unlockBannerT = GS.unlockBannerT - dtReal;
  // SH-029 — low-health grading. Ramps in below 25 HP.
  FEEL.setLowHealth(GS.playerHP < 25 ? (1 - GS.playerHP / 25) : 0);
  MIX.duckForLowHealth(GS.playerHP > 0 && GS.playerHP < 15);

  // The HDR sky pass overrides the clear colour, but leave this in
  // as a fallback when the HDR file is missing.
  clearBackground({ r: Math.floor(W.ENV_SKY_R * 255),
                    g: Math.floor(W.ENV_SKY_G * 255),
                    b: Math.floor(W.ENV_SKY_B * 255), a: 255 });
  // Sun + ambient MUST be re-set every frame: the engine's begin_frame
  // resets the whole lighting block to defaults (immediate-mode convention,
  // renderer begin_frame — verified the hard way in the visual-overhaul
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

  // Round-7 — keep the audio listener on the camera so playSound3D
  // (alien deaths/attacks, impacts, ricochets) pans and attenuates
  // correctly.
  {
    const lfx = CAM[5] - CAM[2], lfy = CAM[6] - CAM[3], lfz = CAM[7] - CAM[4];
    const ll = Math.sqrt(lfx * lfx + lfy * lfy + lfz * lfz);
    if (ll > 0.0001) {
      setListenerPosition(CAM[2], CAM[3], CAM[4], lfx / ll, lfy / ll, lfz / ll);
    }
  }
  // SH-045/SH-029 — the camera's FOV is the player's SETTING plus the transient
  // kick, and until now it was neither: `fovy` was the bare TP_FOVY constant, so
  //   - the FIELD OF VIEW slider moved a number nothing read (a settings row that
  //     adjusts, displays and persists, and changes nothing, is a lie), and
  //   - FEEL.addFovKick() — spent on every sprint and every dodge — accumulated
  //     into fovOffset() that no one ever asked for, so the punch that is supposed
  //     to sell speed has never once been visible.
  // One expression fixes both. TP_FOVY stays as the default the setting is seeded
  // with, not as the value the camera uses.
  if (PERFTEST) perfTB = getTime();   // phase B ends here: sim done, 3D pass begins
  beginMode3D({
    position: vec3(CAM[2], CAM[3], CAM[4]),
    target:   vec3(CAM[5], CAM[6], CAM[7]),
    up: vec3(0, 1, 0),
    fovy: SET.get(SET.SET_FOV) + FEEL.fovOffset(),
    projection: 0,
  });

  // (The muzzle flare point light lives in combat.ts's drawCombatWorld now,
  // later in this same pass — point lights accumulate anywhere inside it.)

  // ---- World: static meshes + water + lights (all from the world file) -----
  // (The old "ground plate" drawCube of COLLIDER[0] is gone: the merged
  // world removed the plaza-floor collider, so index 0 is now the NORTH
  // BOUNDARY WALL — the draw was painting an 80×8 m grey slab across the
  // arena edge. The terrain mesh extends to ±140 m and fully carries the
  // ground; the boundary colliders stay invisible physics.)

  // Phase 9 — real river. Single drawMeshWithMaterial replaces the old
  // 1800-cube tessellated grid. Shader handles Gerstner-wave
  // displacement, per-vertex normal, Fresnel-blended refraction (from
  // the scene-colour snapshot), sky reflection, and foam on crests.
  if (ENV.matWater > 0) {
    drawMeshWithMaterial(ENV.matWater, ENV.matWaterMesh,
      vec3(ENV.WATER_CX, ENV.WATER_Y, ENV.WATER_CZ), 1.0,
      { r: 255, g: 255, b: 255, a: 255 });
  }
  // Phase 10 — glass. Three panes in the house's south upper-floor windows
  // (visible on the approach from spawn, out of the way of ground-floor
  // fights). The pane used to float in the middle of the ground floor at
  // (-21, 0, -10) — nowhere near an opening. Positions pair with the h_s_f1
  // window openings the house generator emits; the pane sits a hair outside
  // the outer wall face (z = -5.32) so it cannot z-fight the masonry.
  if (ENV.matGlass > 0) {
    drawMeshWithMaterial(ENV.matGlass, ENV.matGlassMesh,
      vec3(-28, 4.6, -5.32), 1.0, { r: 255, g: 255, b: 255, a: 255 });
    drawMeshWithMaterial(ENV.matGlass, ENV.matGlassMesh,
      vec3(-21, 4.6, -5.32), 1.0, { r: 255, g: 255, b: 255, a: 255 });
    drawMeshWithMaterial(ENV.matGlass, ENV.matGlassMesh,
      vec3(-14, 4.6, -5.32), 1.0, { r: 255, g: 255, b: 255, a: 255 });
  }
  // SH-021 — instanced grass. One drawMeshWithMaterialInstanced
  // covers all 20 000 blades; the canonical 6-vert mesh is drawn N
  // times against the per-instance pos/rot/scale/tint buffer. Wind
  // sway reads frame.wind (EN-013); cascade shadows come through
  // sample_sun_shadow (EN-016) — both folded into the material.
  if (ENV.matGrass > 0 && ENV.matGrassInstances > 0) {
    drawMeshWithMaterialInstanced(ENV.matGrass, ENV.matGrassMesh, 0,
      ENV.matGrassInstances, ENV.GRASS_INSTANCE_COUNT);
  }
  // Building stone — single drawMeshWithMaterial covers all
  // category-1 boxes; the noise + horizontal-band material in
  // the fragment turns them from flat beige into something that
  // reads as plastered stone.
  if (ENV.matBuilding > 0) {
    drawMeshWithMaterial(ENV.matBuilding, ENV.matBuildingMesh,
      vec3(0, 0, 0), 1.0,
      { r: 255, g: 255, b: 255, a: 255 });
  }
  // Forest scatter — ~120 leaf-card trees pre-placed at startup.
  // Cached-model path: the scene shader gives alpha-cutout foliage
  // wind sway + backlit transmission, the cutout shadow pipeline
  // gives dappled shadows, and the planar probe reflects them in
  // the river. Per-tree yaw + subtle whole-model hue jitter keep
  // the three variants from reading as copy-paste.
  //
  // DRAWN FRONT-TO-BACK. This is worth 5 ms and it is not obvious why.
  //
  // The canopies are alpha-CUTOUT, and a shader with `discard` cannot early-Z
  // *write* — so the GPU shades every leaf fragment before it knows whether the
  // pixel survives. It can still early-Z *test*, though. Draw the near trees first
  // and their depth is already in the buffer when the far ones come through, so the
  // far leaves get rejected before they ever run the 5-target MRT fragment shader.
  // Draw them in world order (as we did) and the rejection never happens: the
  // canopies overlap several deep and every layer pays in full.
  //
  // 88 elements, insertion sort, once a frame — the cost is nothing and the win is
  // most of main_hdr_pass.
  for (let i = 0; i < FOREST_COUNT; i++) {
    const dx = FOREST_X[i] - CAM[2];
    const dz = FOREST_Z[i] - CAM[4];
    FOREST_D[i] = dx * dx + dz * dz;
    FOREST_ORD[i] = i;
  }
  for (let a = 1; a < FOREST_COUNT; a++) {
    const key = FOREST_ORD[a];
    const kd = FOREST_D[key];
    let b = a - 1;
    while (b >= 0 && FOREST_D[FOREST_ORD[b]] > kd) {
      FOREST_ORD[b + 1] = FOREST_ORD[b];
      b--;
    }
    FOREST_ORD[b + 1] = key;
  }
  for (let n = 0; n < FOREST_COUNT; n++) {
    const i = FOREST_ORD[n];
    drawModelRotated(treeVariants[FOREST_VAR[i]], FOREST_POS[i],
                     FOREST_SCALE[i], FOREST_YAW[i], FOREST_TINTO[i]);
  }
  // Static meshes — either drawModel for real GLBs, or coloured drawCube
  // for placeholder _gizmo_box.glb entries. MESH_CATEGORY drives the cube
  // tint (0 generic / 1 building / 2 terrain / 3 prop).
  for (let i = 0; i < W.MESH_COUNT; i++) {
    const mi = W.MESH_MODEL_IDX[i];
    // Buildings (category 1) are rendered through the baked ENV.matBuilding
    // mesh below — skip them here to avoid a coplanar double-draw. This
    // must cover BOTH the placeholder boxes AND real GLBs: the textured
    // building_floor.glb used to slip through to the drawModel branch
    // and z-fight with the material shell — its window-slat texture
    // rows flickered through the plaster whenever the TAA jitter
    // flipped the per-pixel depth winner (the long-hunted "gray lines"
    // flicker on the building).
    if (W.MESH_CATEGORY[i] === 1 && ENV.matBuilding > 0) continue;
    if (W.MODEL_IS_BOX[mi] === 1) {
      drawCube(MESH_POS[i],
               W.MESH_COLLIDER_HX[i] * 2, W.MESH_COLLIDER_HY[i] * 2, W.MESH_COLLIDER_HZ[i] * 2,
               MESH_COLS[W.MESH_CATEGORY[i]]);
    } else if (mi === terrainPropIdx && matTerrain > 0) {
      // Tier 2a — terrain via the colour-variation material. The
      // material runs in the opaque pass; passes Lambert against
      // PerView's directional sun + ambient, then writes both
      // albedo and hdr.
      drawMeshWithMaterial(matTerrain, meshModelHandles[mi] as any,
                MESH_POS[i], W.MESH_SCALE[i], WHITE);
    } else if (mi === treePropIdx) {
      // World-authored trees — variant + yaw + scale jitter from a
      // stable index hash so the same world always lays out the same.
      const v = treeVariants[i % 3];
      const scaleJitter = 0.85 + ((i * 17) & 31) / 100.0;  // 0.85 .. 1.16
      const sc = W.MESH_SCALE[i] * scaleJitter * 1.15;
      const yawDeg = ((i * 47) % 360);
      drawModelRotated(v, MESH_POS[i], sc, yawDeg, WHITE);
    } else {
      drawModel(meshModelHandles[mi], MESH_POS[i], W.MESH_SCALE[i], WHITE);
    }
  }
  // (Water rendering moved up — Phase 9 drawMeshWithMaterial replaces
  // the old cube-grid loop that used to live here.)
  // Point lights from the world file — static scene lights.
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
    const pp = ppFrame;
    const camYaw = CAM[0];
    // Face the camera's horizontal forward direction so the character
    // always looks "away from the camera" (over-the-shoulder feel) and
    // walks the way it looks. Camera forward at camYaw is
    // (sin camYaw, -cos camYaw).
    //
    // SIGN QUIRK, pinned down via debug-pillar screenshots at three camera
    // yaws: the skinned path (updateModelAnimation → set_joint_matrices_
    // scaled) applies rotY INVERTED — rendered facing = -rotY + π/2 for
    // this model (the π/2 is the bsuit's rest offset). Three builds
    // confirmed it: +π/2 → correct at yaw 0 but counter-rotates when
    // orbiting; 0 → 90° off; -π/2 → faces the camera. Solving
    // -rotY + π/2 = camYaw gives rotY = π/2 - camYaw. If the engine's
    // joint-matrix yaw sign ever gets fixed, flip this back to
    // camYaw + π/2 (and re-check the enemies' faceYaw too — they go
    // through the same path). The bsuit's only "attack" animation is a
    // melee swing — a ranged shooter shouldn't use it; keep the walk/idle
    // pose and fake recoil + muzzle flash on the weapon.
    //
    // SH-047 — turn the BODY to face its movement direction (see playerFaceOffset).
    // Offset relative to camera-forward: atan2(moveX, -moveZ) gives 0 for W,
    // ±90° for A/D, ±45° for the W diagonals — exactly the requested angles,
    // because that IS the movement direction. Guarded on `moving`: with no input
    // the target is 0 (forward), which also dodges atan2(0, -0) = π (idle would
    // otherwise face backward). Aiming down sights forces forward — you are
    // pointing the gun, not walking. `playing` gates it so the menu backdrop and
    // the death pose don't spin.
    let faceTarget = 0;
    if (playing && !input.aimDown && (input.moveX !== 0 || input.moveZ !== 0)) {
      faceTarget = Math.atan2(input.moveX, -input.moveZ);
    }
    // Ease along the SHORTEST arc, so S+A -> S+D turns the near way, not 270°.
    let dOff = faceTarget - playerFaceOffset;
    while (dOff > Math.PI) dOff = dOff - Math.PI * 2;
    while (dOff < -Math.PI) dOff = dOff + Math.PI * 2;
    playerFaceOffset = playerFaceOffset + dOff * (1 - Math.exp(-PLAYER_TURN_RATE * dt));

    // Rendered facing = camYaw + offset (the sign quirk above inverts rotY, so
    // the offset is SUBTRACTED here to add it to the rendered facing).
    const modelYaw = Math.PI / 2 - camYaw - playerFaceOffset;

    // SH-034 / EN-028 — locomotion through the mixer instead of hard clip swaps.
    // animPlay is idempotent, so we state the clip we want every frame and the
    // engine crossfades if it changed.
    //
    // The clip is chosen by what the player is DOING, not by crossing a speed
    // threshold. The old code switched to the run clip only above 7.0 m/s — but
    // the walk speed is 6.0, so normal movement ALWAYS played the walk clip, and
    // to cover 6 m/s of ground with a 2.6 m/s stride it ran at the 2.2x clamp.
    // That is the "sliding": a walk cycle at double speed whose stride still
    // cannot keep up with the floor. Sprint (9.0 m/s target, ~7.4 actual) only
    // just cleared 7.0, so the run clip flickered in and out at the boundary.
    //
    // Now: sprinting runs, moving walks, standing idles. No threshold to sit on.
    const spd = playerSpeed();
    const sprinting = isSprinting();
    const crouching = isCrouching();
    // Crouch is its own locomotion tier: crouch-walk when moving, crouch-idle
    // when still. Otherwise the usual sprint/walk/idle ladder.
    const moving = spd > 0.4;
    const wantClip = crouching
      ? (moving ? PLAYER_ANIM_CROUCH_FWD : PLAYER_ANIM_CROUCH)
      : (moving ? (sprinting ? PLAYER_ANIM_RUN : PLAYER_ANIM_WALK)
                : PLAYER_ANIM_IDLE);

    // Playback rate = actual speed / the speed the clip was authored to travel
    // at. That is what plants the feet: the stride then covers exactly the ground
    // the character does. Clamp generously — outside this the cycle stops reading
    // as a gait at all — but the clamp should never be REACHED in normal play. If
    // it is, the movement speed and the clip no longer belong together, and the
    // fix is the speed constant, not a wider clamp.
    const authored = wantClip === PLAYER_ANIM_RUN ? ANIM_RUN_SPEED
                   : wantClip === PLAYER_ANIM_WALK ? ANIM_WALK_SPEED
                   : wantClip === PLAYER_ANIM_CROUCH_FWD ? ANIM_CROUCH_SPEED
                   : 1;
    // Idle poses (standing idle, crouch idle) play at 1×; the moving clips scale.
    const rate = (wantClip === PLAYER_ANIM_IDLE || wantClip === PLAYER_ANIM_CROUCH)
      ? 1
      : Math.max(0.5, Math.min(1.8, spd / authored));
    animPlay(animPlayer, wantClip, 0.15, rate, true);
    animUpdate(animPlayer, dt, PLAYER_SCALE,
      pp.x, pp.y + PLAYER_MODEL_Y_OFFSET, pp.z, modelYaw);
    drawModel(mdlPlayer, vec3(pp.x, pp.y + PLAYER_MODEL_Y_OFFSET, pp.z),
              PLAYER_SCALE, WHITE);

    // ANIMDBG readback — must run AFTER animUpdate, or the joint query reads
    // last frame's pose and the amplitude is a frame late.
    if (ANIMDBG) {
      if (AD[2] !== 0 && dtReal > 0) {
        const mdx = pp.x - AD[0];
        const mdz = pp.z - AD[1];
        AD[3] = Math.sqrt(mdx * mdx + mdz * mdz) / dtReal;
      }
      AD[0] = pp.x;
      AD[1] = pp.z;
      AD[2] = 1;
      const ay = jointWorld(animPlayer, dbgAnkle, 13);
      if (ay < AD[4]) AD[4] = ay;
      if (ay > AD[5]) AD[5] = ay;
      if ((testFrame % 30) === 0) {
        // Compute into locals, then print: a call nested inside a log
        // concatenation has given a different answer than the same call
        // assigned first (see docs/perry-quirks.md).
        const repSpd = playerSpeed();
        const realSpd = AD[3];
        const spr = isSprinting() ? 1 : 0;
        const gnd = playerGrounded() ? 1 : 0;
        const amp = AD[5] - AD[4];
        console.log('ANIMDBG f=' + testFrame
          + ' want_sprint=' + dbgSprint
          + ' rep_spd=' + repSpd.toFixed(2)
          + ' real_spd=' + realSpd.toFixed(2)
          + ' sprinting=' + spr
          + ' grounded=' + gnd
          + ' clip=' + wantClip
          + ' rate=' + rate.toFixed(2)
          + ' ankleAmp=' + amp.toFixed(4)
          + ' orbit=' + CAMDBG.orbit.toFixed(2) + '/' + CAMDBG.want.toFixed(2)
          + ' px=' + pp.x.toFixed(1) + ' pz=' + pp.z.toFixed(1));
        AD[4] = 1e9;
        AD[5] = -1e9;
      }
    }

    // SH-027 — the real weapon model + muzzle flash card, at the transform
    // computed once in updateWeaponTransform(). Lives in combat.ts; called
    // here so the draw order is exactly what it was.
    drawWeapon();
  }
  // Per-enemy: drive the skinned skeleton via updateModelAnimation (picks
  // attack vs walk anim), then drawModel renders with the pose from the
  // joint matrices set by the update. Both calls use the same position so
  // non-skinned fallbacks still sit in the right place.
  const ppAim = ppFrame;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] === 0) continue;
    const k = enKind[i];
    const dxA = ppAim.x - enX[i];
    const dzA = ppAim.z - enZ[i];
    const distA = Math.hypot(dxA, dzA);
    // Round-9: render the AI's turn-rate-limited heading rather than
    // hard-facing the player — circling mantises and charging dragoons face
    // where they're actually going. Windup counts as attacking so the dragoon's
    // pounce telegraph reads on the model.
    const attacking = distA <= KIND_MELEE[k] || enAIState[i] === AI_WINDUP;
    const flinching = enAIState[i] === AI_FLINCH;

    // SH-030 / SH-034 — the base track is locomotion; the attack rides on an
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

    // Speed-matched playback — the fix that kills foot-sliding. The old code
    // played the walk clip at a fixed rate no matter how fast the thing was
    // actually moving, so a charging dragoon's feet skated.
    const spdE = Math.hypot(vxLast[i], vzLast[i]);
    const authoredE = KIND_SPEED[k];
    const rateE = flinching ? 1.0
      : Math.max(0.4, Math.min(2.5, spdE / (authoredE > 0.01 ? authoredE : 1)));

    // animPlay is idempotent, so stating the clip we want every frame is the
    // intended use — it only crossfades when that actually changed.
    animPlay(enAnim[i], baseClip, flinching ? 0.06 : 0.15, rateE, !flinching);
    enAnimClip[i] = baseClip;
    // Same engine quirk as the player model: the skinned path applies rotY
    // INVERTED, so pass π/2 − yaw or the aliens strafe sideways-on.
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
  // SH-031 / EN-025 - death is now ANIMATION -> RAGDOLL.
  //
  // The handoff point is the whole design. Going straight to physics on the
  // frame of death throws away the authored "mortal blow" - the recoil that
  // tells you what killed it - and the corpse just goes limp like a dropped
  // coat. Playing the clip out in FULL and then switching is worse still: the
  // body snaps from a canned final pose into a physical one, and you see the
  // seam.
  //
  // So: play the first ~0.22 s of the die clip (the blow lands, the thing
  // reels), then hand the CURRENT pose to the ragdoll and let go. The bodies are
  // seeded from that exact pose, so there is nothing to blend - physics simply
  // continues the motion the animator started.
  const RAG_HANDOFF = 0.22;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enDying[i] !== 1) continue;
    enDeathT[i] = enDeathT[i] + dt;
    const k = enKind[i];

    if (enRagActive[i] === 0) {
      // --- still animating the blow
      if (enAnimClip[i] !== ANIM_DIE_IDX[k]) {
        animPlay(enAnim[i], ANIM_DIE_IDX[k], 0.06, 1.0, false);
        enAnimClip[i] = ANIM_DIE_IDX[k];
        animSetLayer(enAnim[i], -1, 0, -1, 1, false);   // drop the attack layer
      }
      const yaw = Math.PI / 2 - enDeathYaw[i];
      animUpdate(enAnim[i], dt, KIND_SCALE[k], enX[i], enY[i], enZ[i], yaw);
      drawModel(mdlAliens[k], vec3(enX[i], enY[i], enZ[i]), KIND_SCALE[k], WHITE);

      if (enDeathT[i] >= RAG_HANDOFF && enRagdoll[i] > 0) {
        // The transform passed here MUST be the one we just drew with: it is the
        // bridge between model space and world space, and the engine freezes it.
        const ok = activateRagdoll(enRagdoll[i], enAnim[i], physics,
                                   KIND_SCALE[k], enX[i], enY[i], enZ[i], yaw);
        if (ok) {
          enRagActive[i] = 1;
          // Throw it along the killing shot. Scaled by damage, so a rifle round
          // nudges and a cannon hit launches - and divided by the thing's own
          // heft, because a tyrant should not fly like a dretch.
          const heft = 1 + KIND_HP[k] * 0.35;
          const imp = (2.0 + enDeathImp[i] * 1.6) / heft;
          pushRagdoll(enRagdoll[i], enDeathDX[i], enDeathDY[i] * 0.4 + 0.35,
                      enDeathDZ[i], imp * 40);
        } else {
          enRagActive[i] = 2;   // no skeleton to simulate - use the old corpse
        }
      }
    } else if (enRagActive[i] === 1) {
      // --- physics owns the pose now. No animUpdate: the ragdoll writes the
      // joint matrices directly.
      const age = updateRagdoll(enRagdoll[i], enAnim[i], dt);
      drawModel(mdlAliens[k], vec3(enX[i], enY[i], enZ[i]), KIND_SCALE[k], WHITE);
      // Settle, then free. Releasing matters: a pooled ragdoll that is never
      // released leaks bodies into the physics world - a slow, invisible death.
      if (age > 8.0) {
        releaseRagdoll(enRagdoll[i]);
        enRagdoll[i] = createRagdoll();      // fresh slot for the next occupant
        enRagActive[i] = 0;
        enDying[i] = 0;
        enAnimClip[i] = -1;
      }
    } else {
      // --- fallback: no skeleton, so the old clamp-and-sink corpse.
      const dur = ANIM_DIE_DUR[k];
      const sink = enDeathT[i] > dur + 0.6 ? (enDeathT[i] - dur - 0.6) * 0.9 : 0;
      animUpdate(enAnim[i], dt, KIND_SCALE[k],
        enX[i], enY[i] - sink, enZ[i], Math.PI / 2 - enDeathYaw[i]);
      drawModel(mdlAliens[k], vec3(enX[i], enY[i] - sink, enZ[i]), KIND_SCALE[k], WHITE);
      if (enDeathT[i] > dur + 2.0) {
        enDying[i] = 0;
        enRagActive[i] = 0;
        enAnimClip[i] = -1;
      }
    }
  }
  // Combat layer of the pass — muzzle flare light, pickups, player plasma,
  // enemy bolts (combat.ts).
  drawCombatWorld();

  // SH-033 — particles + decals. One update + one instanced draw per system,
  // last in the 3D pass so the additive particles composite over everything and
  // the depth-tested decals have a full depth buffer to fade against.
  VFX.updateAndDrawVfx(dtReal);

  endMode3D();
  if (PERFTEST) perfTC = getTime();

  // Everything from here to endMode2D() is laid out in the logical HUD space
  // established above. On desktop uiScale is 1 and this is a no-op.
  if (MOBILE) beginMode2DRaw(0, 0, 0, 0, 0, uiScale);

  // The in-run HUD - crosshair/spread, hit marker, damage vignette + arc,
  // HP + dodge, score + combo, render-toggle status, ammo/reload/charge,
  // wave banner + report card, unlock banner - hud.ts (gated on a run inside).
  drawHud(sw, sh, input.padActive, dbgSsgi, dbgSsao, dbgSsr, dbgShadow,
          ptSupported, SET.get(SET.SET_PT));

  // (The title screen used to live here: a wordmark and "press any key". It is
  // now the MAIN MENU — same live-world backdrop, but with somewhere to go. It
  // is drawn by drawMenu() with every other menu, and starts the run through
  // ACT_PLAY -> startRun() rather than by swallowing a keypress.)

  // End-of-run overlays + the SH-040 level-change notice - hud.ts.
  drawOverlays(sw, sh);

  // SH-038 — the pause / settings menu draws LAST so it sits over the HUD.
  drawMenu(sw, sh);

  // Diagnostic HUD — helps verify input is reaching the game. The desktop
  // version is a full-width bar along the bottom, which on a phone lands
  // directly under the thumbs; show just the frame rate up in the corner
  // instead, which is what's actually worth watching on device.
  if (MOBILE) {
    drawText('FPS ' + Math.floor(getFPS()), 14, 12, 20,
             { r: 200, g: 210, b: 230, a: 200 });
  }
  // Diag-bar strings are built inside the gate — MOBILE was paying the
  // per-frame concatenation for two lines it never drew.
  if (!MOBILE) {
    const pp = ppFrame;
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
    drawRect(0, sh - 44, sw, 44, { r: 0, g: 0, b: 0, a: 150 });
    drawText(diag1, 10, sh - 40, 13, { r: 200, g: 210, b: 230, a: 220 });
    drawText(diag2, 10, sh - 20, 13, { r: 180, g: 200, b: 220, a: 220 });
  }

  // Phase 8 — profiler overlay (F3). Lists every engine pass with
  // CPU and GPU (µs) averaged over the profiler's 120-frame rolling
  // window, sorted by CPU time descending.
  if (perfOverlayOn) {
    const rows = getProfilerOverlay();
    const rowH = 16;
    const ox = sw - 360;
    // Phase 8 — frame-time histogram on top of the pass list so it
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
    drawText('pass                    cpu µs    gpu µs',
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

  // The touch controls are drawn *outside* the scaled camera, in raw pixels —
  // they have to land on exactly the coordinates input.ts hit-tests, and it
  // reads touches in the pixel space the platform delivers them in.
  drawTouchControls();

  // (There used to be an `if (isKeyPressed(Key.ESCAPE)) break;` here — a
  // dev-quit binding that predates the pause menu. It was UNCONDITIONAL, so it
  // fired on every ESC no matter what was on screen: Escape out of the settings
  // screen and the process died; press Escape to pause and the game quit instead.
  // ESC now means "pause" in a run and "back" in a menu (menu.ts), and QUIT is a
  // row in both menus — which is where quitting a real game belongs.)
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














































