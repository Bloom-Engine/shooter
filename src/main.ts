import {
  initWindow, windowShouldClose, closeWindow, runGame, restartApp,
  beginDrawing, endDrawing, clearBackground,
  setTargetFPS, getDeltaTime, getFPS, getTime,
  beginMode3D, endMode3D,
  drawCube, drawRect,
  setAmbientLight, setDirectionalLight, setEnvClearFromHdr,
  getScreenWidth, getScreenHeight,
  vec3,
  isKeyPressed, isKeyDown, Key, Vec3, injectKeyDown, injectKeyUp,
  disableCursor, enableCursor, takeScreenshot,
  endMode2D,
  loadModel, setProceduralSky, setSunDirection, drawModel, drawModelRotated, drawSphere, getModelBounds, loadModelAnimation, updateModelAnimation,
  stageModels, stageModelsSync, commitModel,
  setModelFoliageWind, setFoliageShadowMotion,
  drawMeshWithMaterial, drawMeshWithMaterialInstanced,
  initAudio, loadSound, playSound, setSoundVolume, playSound3D, setListenerPosition,
  loadMusic, playMusic, stopMusic, updateMusicStream, setMusicVolume,
  fileExists,
  setProfilerEnabled, getProfilerOverlay, getProfilerFrameHistory,
  splatImpulse, setMaterialParams,
  compileMaterialFromFile, loadMaterial,
} from 'bloom';
import { drawText, measureText } from './ui-text';
import {
  // Raw-primitive variant of beginMode2D: the object-taking one isn't worth the
  // risk on a per-frame FFI path (perry-quirks #2), and only this one is
  // exported from bloom/core anyway.
  beginMode2DRaw,
  setVignette, setFilmGrain,
  setEnvIntensity, setAutoExposure, setAutoExposureKey, setFog, setSunShafts, setWind,
  setCloudShadows, setTonemap, setColorSaturation, setDepthOfField, setMotionBlurEnabled,
  setAutoResolution,
  setTaaEnabled, setRenderScale, setCasStrength,
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
  animPlay, animSetLayer, animUpdate, animSetJointRotation, animSetIK, animSetIKPole,
  animSetBlend, animClipDuration,
  findJoint, jointWorld,
  createTextureArrayFromFiles, createTextureArrayFromTexels, setMaterialTextureArray,
  TEXTURE_ARRAY_ALBEDO, TEXTURE_ARRAY_NORMAL, TEXTURE_ARRAY_MR,
  TEX_ARRAY_FORMAT_SRGB, TEX_ARRAY_FORMAT_LINEAR,
  createRagdoll, activateRagdoll, pushRagdoll, updateRagdoll, releaseRagdoll,
} from 'bloom/models';
import { initInput, readInput, drawTouchControls, MOBILE, ANDROID, WEB } from './input';
import {
  createPlayer, updatePlayerController, playerPosition,
  playerGrounded, playerSpeed, startDodge, isDodging, dodgeCooldownFrac, isSprinting, isCrouching,
  dodgeDirX, dodgeDirZ, dodgeDuration, setSquared,
  setPlayerPosition, setCarryMul, vaultProgress, isVaulting, VD,
} from './player';
import * as W from './world-runtime';
import { ENV, initEnvironment, initGiProxies } from './environment';
import { initFlora, drawFlora } from './flora';
import { GS } from './gamestate';
import * as PROFILE from './profile';
import * as TUTOR from './tutor';
import { OBJ, nestStanding } from './objective';
import {
  DIR, initDirector, setDirectorDeps, updateDirector, updateEnemyProjectiles,
  countAlive, WAVE_BREAK_DELAY, despawnAllEnemies, hpX, hpY, hpZ, hpLife, wavePlan, BOSS, bossHealth,
} from './director';
import {
  setCombatDeps, updateWeaponTransform, updateCombat, drawWeapon,
  drawCombatWorld, startRun, resetRun, PLAYER_HP_MAX,
  throwGrenade, startMelee, meleeSwing,
  PICKUP_COUNT, PICKUP_RADIUS, PICKUP_RESPAWN, PICKUP_RIFLE,
  pickupActive, pickupKind, pickupRespawnT, pickupX, pickupY, pickupZ,
} from './combat';
import {
  CAM, TP_PITCH_MIN, TP_PITCH_MAX, TP_FOVY, CAMDBG,
  updateCameraLook, updateCameraOrbit, swapShoulder,
} from './camera';
import { drawHud, drawOverlays, drawArenaNotice } from './hud';
import { hitShapesBeginFrame, shapeJoint, rayEnemies } from './hitshapes';
import {
  // KIND_COUNT + ALIEN_GLB re-added by the EN-055 merge: the boot-time
  // stageModels batch needs the kind GLB paths (a green Perry compile would
  // NOT have caught their absence — ReferenceError at boot).
  KIND_COUNT, KIND_NAME, mdlAliens, ALIEN_GLB,
  ANIM_WALK_IDX, ANIM_ATTACK_IDX, ANIM_DIE_IDX, ANIM_PAIN_IDX, ANIM_DIE_DUR,
  KIND_SPINE_JOINT, KIND_TINTO,
  KIND_SCALE, KIND_Y_OFF, KIND_SPEED, KIND_HP, KIND_MELEE, DRETCH_HIT_FLASH,
  enScale, enElite,
  AI_WINDUP, AI_FLINCH, AI_STRIKE_WIND, AI_STRIKE_HIT, AI_STRIKE_REC,
  KIND_POOL, KIND_SLOT0, MAX_ENEMIES,
  STRIKE_WINDUP, ATTACK_HIT_T, KIND_HEIGHT, KIND_RANGED, RANGED_WINDUP,
  enStrikeSeq, enPoseX, enPoseY, enPoseZ, enPoseYaw, enPosed,
  enHitDX, enHitDZ, enHitK, enDeathClip, enDeathVX, enDeathVZ, enDeathVY, enDeathLift,
  ANIM_FALL_IDX, ANIM_FALL_SKIP, ANIM_FALL_DUR, KIND_LIGHT,
  enAware, enLastX, enLastY, enLastZ, enLos, enHasToken, enStateT, enReactT, enSearchT,
  HSJ_HEAD, HSJ_NECK, HSJ_HIPS, HSJ_HAND_L, HSJ_HAND_R, HSJ_FOOT_L, HSJ_FOOT_R, HSJ_WEAK,
  KIND_HEAD_R, KIND_TORSO_R, KIND_WEAK_R, KIND_WEAK_Z, KIND_BOX_Y,
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
import {
  initMenus, menuOpen, openPause, openMain, closeMenu, updateMenu, drawMenu, currentMenu, MENU_NONE,
  applyGraphicsSettings, openResults, setResultsTime, openSettingsTab, openLevels, openCredits,
  openArmory, openRecord, armoryWeapon,
  selectRow, MENU_RESULTS, menuRow, menuTab,
} from './menu';
import * as STR from './strings';
import * as UIK from './ui';
import * as BND from './binds';
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
import { initNav, surfaceHeightAt } from './nav';
import { initFlow, flowBlockedAt } from './flow';

// Borderless fullscreen at the monitor's native resolution (the engine
// resizes its swapchain + all render targets on the WM_SIZE this triggers).
// The 1024×640 size is the windowed-mode fallback the engine restores to.
initWindow(1024, 640, 'Bloom Shooter', true);
setTargetFPS(60);
initInput();

// SH-037 — settings must load BEFORE anything reads them (input sensitivity,
// audio volumes, FOV, shake). A missing file is a first run, not an error.
SET.loadSettings();
// Phase 6 - what the player has earned (credits, upgrades, stars). After the settings: a first
// profile reads the best scores from them.
PROFILE.loadProfile();

// ---- CLI overrides for A/B-testing graphics settings -----------------------
// `main --render-scale 0.5|0.75|1` and `main --output-scale 0.5|0.75|1`
// override settings.json for this launch (they land in the live settings
// array, so the video menu shows them — and saving from the pause menu
// persists them). Values are matched against the fixed list instead of
// parsed: string equality on argv is safe (world-runtime does it), numeric
// parsing of FFI strings is not (perry-quirks #5). `--pt off|prog|rt`
// further below starts in that path-tracing mode without F9 taps.
function cliArg(name: string): string {
  if (WEB) return ''; // a browser page has no argv
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
// `--debughud 1` starts with the developer overlays showing (F1 toggles them in a run).
if (cliArg('--debughud') === '1') GS.debugHud = true;

// SH-052d — `--audiotest orbit|flyby|river` starts a quiet scene (waves
// suppressed) so the 3D audio can be judged directly. orbit = a voice circles
// your head (pan + rear cue), flyby = a voice flies through you (doppler +
// front/back), river = free-walk with the river as the only source and a
// distance-to-bank readout. See the harness block in the frame loop.
const cliAudioTest = cliArg('--audiotest');
const AUDIOTEST = cliAudioTest === 'orbit' || cliAudioTest === 'flyby' || cliAudioTest === 'river';
const audioTestMode = cliAudioTest === 'orbit' ? 1 : (cliAudioTest === 'flyby' ? 2 : 0);
let audioTestT0 = -1;
let audioTestStatus = '';

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
const sfxAttack = loadSound('assets/sounds/dretch_attack.wav');
const sfxPickup = loadSound('assets/sounds/pickup.wav');
setSoundVolume(sfxAttack, 0.6);
setSoundVolume(sfxPickup, 0.8);
// Weapon shots (see assets/sounds/SOURCES.md). Alien deaths/attacks/pain play
// positionally via playSound3D; the listener follows the camera every frame.
//
// One fire sound PER WEAPON, in WPN.W_* order (rifle, blaster, chaingun,
// cannon), plus a real explosion. Until 2026-11 the chaingun and the cannon
// fired the rifle sample and the cannon's blast was the blaster shot. The rifle
// alternates two samples so full-auto is not one file on repeat. The three new
// files are optional: a checkout without them falls back to the old sharing.
const sfxFireRifle   = loadSound('assets/sounds/rifle_fire2.wav');
const sfxFireRifleB  = loadSound('assets/sounds/rifle_fire.wav');
const sfxFireBlaster = loadSound('assets/sounds/blaster_fire.wav');
const sfxFireChain   = fileExists('assets/sounds/chain_fire.wav')
  ? loadSound('assets/sounds/chain_fire.wav') : sfxFireRifle;
const sfxFireCannon  = fileExists('assets/sounds/cannon_fire.wav')
  ? loadSound('assets/sounds/cannon_fire.wav') : sfxFireRifle;
const sfxExplosion   = fileExists('assets/sounds/explosion.wav')
  ? loadSound('assets/sounds/explosion.wav') : sfxFireBlaster;
setSoundVolume(sfxFireRifle, 0.40);
setSoundVolume(sfxFireRifleB, 0.36);
setSoundVolume(sfxFireBlaster, 0.45);
if (sfxFireChain !== sfxFireRifle) setSoundVolume(sfxFireChain, 0.38);
if (sfxFireCannon !== sfxFireRifle) setSoundVolume(sfxFireCannon, 0.60);
if (sfxExplosion !== sfxFireBlaster) setSoundVolume(sfxExplosion, 0.85);
// The scattergun and the lance borrow the cannon's and the blaster's report (Phase 5 is open).
const sfxFireByWeapon = [sfxFireRifle, sfxFireBlaster, sfxFireChain, sfxFireCannon, sfxFireCannon, sfxFireBlaster];
// Phase 2 (SH-057): the claw swing, the critical-hit confirm and the player's kit. Optional
// files with stand-ins, like the three above.
const sfxSwing = fileExists('assets/sounds/swing.wav')
  ? loadSound('assets/sounds/swing.wav') : sfxAttack;
const sfxCrit = fileExists('assets/sounds/crit_hit.wav')
  ? loadSound('assets/sounds/crit_hit.wav') : sfxPickup;
const sfxMeleeHit = fileExists('assets/sounds/melee_hit.wav')
  ? loadSound('assets/sounds/melee_hit.wav') : sfxAttack;
const sfxNadeThrow = fileExists('assets/sounds/grenade_throw.wav')
  ? loadSound('assets/sounds/grenade_throw.wav') : sfxPickup;
const sfxNadeBounce = fileExists('assets/sounds/grenade_bounce.wav')
  ? loadSound('assets/sounds/grenade_bounce.wav') : sfxPickup;
const sfxHeal = fileExists('assets/sounds/heal.wav')
  ? loadSound('assets/sounds/heal.wav') : sfxPickup;
if (sfxSwing !== sfxAttack) setSoundVolume(sfxSwing, 0.55);
if (sfxCrit !== sfxPickup) setSoundVolume(sfxCrit, 0.70);
if (sfxMeleeHit !== sfxAttack) setSoundVolume(sfxMeleeHit, 0.70);
if (sfxNadeThrow !== sfxPickup) setSoundVolume(sfxNadeThrow, 0.55);
if (sfxNadeBounce !== sfxPickup) setSoundVolume(sfxNadeBounce, 0.50);
if (sfxHeal !== sfxPickup) setSoundVolume(sfxHeal, 0.55);
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
// (The boss, kind 7, uses the Colossus's voice until it has one: Phase 5 is open.)
const SFX_KIND_VOICE = [0, 1, 2, 3, 4, 2, 3, 4];
const sfxAlienDie: any[] = new Array(24);     // 8 kinds x 3 variants
const sfxAlienAttack: any[] = new Array(8);
const sfxAlienPain: any[] = new Array(8);
for (let k = 0; k < 8; k++) {
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
// (The old single-bed fallbacks assets/sounds/{menu,game}.ogg were files of
// unrecorded origin and left the repository with the MIT relicensing,
// 2026-11-14. The three stems are committed, so they are simply required.)
const HAS_STEMS = true;   // kept as a name: the crossfade code reads it
const musicMenu = loadMusic('assets/music/music_menu.ogg');
const musicCalm = loadMusic('assets/music/music_calm.ogg');
const musicCombat = loadMusic('assets/music/music_combat.ogg');
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
// Plan 3.5: the panorama graded to the arena's time of day (tools/gen/grade_sky.py; the order is
// its PRESETS). Look key `sky_variant`: 0 noon as shot, 1 afternoon, 2 mist, 3 dusk, 4 night.
const SKY_FILES = ['assets/env/outdoor.hdr', 'assets/env/outdoor_afternoon.hdr',
                   'assets/env/outdoor_mist.hdr', 'assets/env/outdoor_dusk.hdr',
                   'assets/env/outdoor_night.hdr'];
const SKY_VARIANT = Math.max(0, Math.min(4, Math.floor(W.lookNum('sky_variant', 0))));
setEnvClearFromHdr(SKY_FILES[SKY_VARIANT]);
// Phase 3.5: each arena has its own time of day. The world file's `look` entity carries what the
// engine's environment block has no field for; the fallbacks are the old noon values.
// sky 0 = the HDR panorama, 1 = the engine's physical sky steered by the world's sun direction.
const LOOK_SKY = W.lookNum('sky', 0);
if (LOOK_SKY > 0.5) {
  setProceduralSky(true, { rayleighDensity: W.lookNum('rayleigh', 1.0), mieDensity: W.lookNum('mie', 1.0), groundAlbedo: 0.12 });
  setSunDirection(vec3(W.ENV_SUN_DIR_X, W.ENV_SUN_DIR_Y, W.ENV_SUN_DIR_Z), W.lookNum('sky_sun', 1.0));
}
setTonemap(W.lookNum('tonemap', 0));
setColorSaturation(W.lookNum('saturation', 1.0));
// Tier 1.2 — IBL strength. 1.0 = unit; bump up if the scene reads
// dim against the new HDR sky, pull back if it blows out.
setEnvIntensity(W.lookNum('env_intensity', 1.0));
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
setAutoExposureKey(W.lookNum('exposure_key', 0.155));
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
setFog(W.ENV_FOG_R, W.ENV_FOG_G, W.ENV_FOG_B, W.lookNum('fog_density', 0.016),
       W.lookNum('fog_height', -0.6), W.lookNum('fog_falloff', 6.0));
// Tier 1.7 — warm god-rays through the trees. Round-2 retune (audit F3):
// at 0.4/0.96 the 32-tap shaft march added up to ~+0.14 HDR of warm veil
// on every sunward silhouette — a big share of the "pale backlit
// treeline". 0.18/0.90 keeps the god-ray read without the wash.
setSunShafts(W.lookNum('shafts', 0.18), 0.90, W.ENV_SUN_R, W.ENV_SUN_G * 0.95, W.ENV_SUN_B * 0.85);
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
setCloudShadows(W.lookNum('cloud_shadow', 0.45), 150, 0.008, 6);
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
// Contrast-adaptive sharpening on top of the TSR reconstruction (2026-11, photoreal pass): the
// 4K character and ground textures resolve finer detail than a 0.75-scale reconstruction
// returns on its own, and the image read soft. 0.45 is between the engine's "subtle" and
// "punchy"; it is one cheap full-screen pass. Desktop only: the phone profile has no headroom
// to spare and its smaller screen hides the softness.
if (!MOBILE) setCasStrength(0.45);
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

// SH-055 — Android low-tier override. The mobile base above is an iPhone-class
// budget; a 2020 Adreno (Pixel 4a) can't afford the shadow-map re-render, SSAO,
// or bloom on top of the plaza's 88 trees + 20k grass, and shipped at ~1 fps.
// Cut the heaviest full-scene / full-screen passes and drop the internal buffer
// harder (TAA/TSR still reconstruct toward native). This is deliberately a
// separate, blunt tier — the seed of the hardware-tier auto-detect (SH-056).
if (ANDROID) {
  setShadowsEnabled(false);   // second full-scene pass — the biggest single win
  setSsaoEnabled(false);
  setBloomEnabled(false);
  setTaaEnabled(true);        // needed to reconstruct the low-res buffer
  // SH-055 — user requires >=0.5 for visual quality; measuring what actually
  // costs main_hdr_pass's GPU time at this fixed scale before touching any
  // shared shader/ABI code.
  setRenderScale(0.5);
  setSunShafts(0, 0.90, 1.0, 0.95, 0.7);
}

// SH-054 — web (WebGPU) profile. The renderer is the same one the desktop
// runs, but two things argue for starting near the mobile profile: WebGPU
// has no timestamp queries (so no profiler to steer players with), and the
// SDF-clipmap GI re-bake stalls are much worse without native-thread
// headroom. SSAO/shadows/bloom/TAA stay on; GI and SSR stay off (SSR ships
// off everywhere since the indoor-blizzard bisect anyway).
if (WEB) {
  setSsgiEnabled(false);
  setSsrEnabled(false);
  setSsaoEnabled(true);
  setShadowsEnabled(true);
  setBloomEnabled(true);
  setTaaEnabled(true);
  setRenderScale(0.65);
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
// to give away. WEB keeps its fixed profile for the same reason for now —
// revisit once the WebGPU build has perf numbers behind it.)
// Plan 4.3: every platform reads the settings now. The phone / Android / browser blocks above
// set what the player cannot change there (TAA, sun shafts); the passes they used to pin are
// the settings file's DEFAULTS on those platforms (settings.ts platformDefaults).
applyGraphicsSettings();
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
// 0.5 since the grown trees (2026-11): they are about half again as tall and wide as the old
// ones, and the bend grows with height squared.
for (let i = 0; i < treeVariants.length; i++) setModelFoliageWind(treeVariants[i], 0.5);
// Swaying SHADOWS are a separate, paid-for decision: a caster that moves cannot
// reuse the cached static shadow depth, so all 88 trees would re-render into
// every cascade every frame. Measured before switching on - see docs/tickets.md
// SH-013.
setFoliageShadowMotion(FOLIAGE_SHADOW_MOTION);
// All tree GLBs are 2 primitives: bark (trunk and every branch), then the leaf cards.
const TREE_GLB_PARTS = 2;   // bark, leaves (tools/blender/build_tree.py)
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
let cratePropIdx = -1;      // the crate model doubles as the ammo cache and the field dressing
for (let i = 0; i < W.UNIQUE_MODEL_COUNT; i++) {
  if (W.UNIQUE_MODELS[i] === 'assets/models/prop_tree.glb')     { treePropIdx    = i; }
  if (W.UNIQUE_MODELS[i] === 'assets/models/prop_crate.glb')    { cratePropIdx   = i; }
  // SH-040: any terrain_*.glb is THE terrain shell (arena_02 ships
  // terrain_hills, arena_03 terrain_ravine) — matching one exact filename
  // was the last per-arena hardcode in the load path.
  if (W.UNIQUE_MODELS[i].indexOf('assets/models/terrain_') === 0) { terrainPropIdx = i; }
}

// Same hoist for the static-mesh pass: positions are world data (immutable at
// runtime) and the cube tint depends only on the 4-entry category table.
// Work lights (prop_worklight): where their two lamp heads are, so the frame loop can draw a
// glow on each. The light itself is a world light the dressing tool placed beside them.
const WL_MAX = 16;
const WL_X = new Array<number>(WL_MAX * 2);
const WL_Y = new Array<number>(WL_MAX * 2);
const WL_Z = new Array<number>(WL_MAX * 2);
const WL_N = [0];
for (let i = 0; i < W.MESH_COUNT; i++) {
  if (W.UNIQUE_MODELS[W.MESH_MODEL_IDX[i]].indexOf('prop_worklight') < 0 || WL_N[0] >= WL_MAX * 2 - 1) continue;
  const yawR = (W.MESH_YAW[i] > -999 ? W.MESH_YAW[i] : 0) * Math.PI / 180;
  const sc = W.MESH_SCALE[i];
  for (let side = -1; side <= 1; side += 2) {
    // local (side * 0.22, 1.74, 0): local +X turns to (cos, -sin)
    WL_X[WL_N[0]] = W.MESH_X[i] + Math.cos(yawR) * side * 0.22 * sc;
    WL_Y[WL_N[0]] = W.MESH_Y[i] + 1.74 * sc;
    WL_Z[WL_N[0]] = W.MESH_Z[i] - Math.sin(yawR) * side * 0.22 * sc;
    WL_N[0] = WL_N[0] + 1;
  }
}
// Plan 3.6 - what ties a character to the place it stands in. EN_WET / PL_WET: seconds of
// "just came out of the river" left (the model is tinted darker while it dries). A creature also
// darkens as it is hurt: blood and dirt, read at a glance as "that one is nearly down".
const WET_TIME = 7.0;
const EN_WET = new Array<number>(MAX_ENEMIES);
for (let i = 0; i < MAX_ENEMIES; i++) EN_WET[i] = 0;
const PL_WET = [0];
function wadingAt(x: number, y: number, z: number): boolean {
  return W.WATER_COUNT > 0 && y < ENV.WATER_Y - 0.06
    && Math.abs(x - ENV.WATER_CX) < ENV.WATER_W * 0.5 + 2.5
    && Math.abs(z - ENV.WATER_CZ) < ENV.WATER_D * 0.5 + 2.5;
}
function drawContact(x: number, y: number, z: number, size: number, strength: number): void {
  if (ENV.matContact <= 0) return;
  drawMeshWithMaterial(ENV.matContact, ENV.matContactMesh, vec3(x, y + 0.035, z), size,
    { r: 0, g: 0, b: 0, a: Math.floor(255 * strength) });
}
const DOFS = [0, 14];        // depth of field last sent: aperture, focus distance
const PROP_DRAW_DIST = 46;   // metres; small drawn-only props (river stones) beyond this are skipped
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
const OBST_MAX = FOREST_COUNT + W.MESH_COUNT * 3 + 512;
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
// Phase 3.1: rocks, logs, barriers and the like (`obst` props). A row of circles along the
// prop's long side, turned by its yaw, so a 3 m log is a wall to walk round and not one fat disc.
for (let i = 0; i < W.MESH_COUNT; i++) {
  if (W.MESH_OBST[i] !== 1) continue;
  const hx = W.MESH_COLLIDER_HX[i];
  const hz = W.MESH_COLLIDER_HZ[i];
  const thin = Math.min(hx, hz);
  const long = Math.max(hx, hz) - thin;
  const yawR = (W.MESH_YAW[i] > -999 ? W.MESH_YAW[i] : 0) * Math.PI / 180;
  // local long axis: +X if hx >= hz, else +Z; local +X turns to (cos, -sin), +Z to (sin, cos)
  const ax = hx >= hz ? Math.cos(yawR) : Math.sin(yawR);
  const az = hx >= hz ? -Math.sin(yawR) : Math.cos(yawR);
  // Close together (0.55 of a radius apart): the row has to be near enough to a straight wall
  // that a walker sliding along it does not catch in the notch between two circles (a Bruiser
  // did, against the truck, with the circles a radius and a half apart).
  const n = long < 0.05 ? 1 : Math.max(2, Math.ceil(2 * long / ((thin + 0.15) * 0.55)) + 1);
  for (let k = 0; k < n && GS.OBST_COUNT < OBST_MAX; k++) {
    const t = n === 1 ? 0 : -long + (2 * long * k) / (n - 1);
    OBST_X[GS.OBST_COUNT] = W.MESH_X[i] + ax * t;
    OBST_Z[GS.OBST_COUNT] = W.MESH_Z[i] + az * t;
    OBST_R[GS.OBST_COUNT] = thin + 0.15;
    GS.OBST_COUNT = GS.OBST_COUNT + 1;
  }
}
GS.OBST_WALL_START = GS.OBST_COUNT;
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

// Footstep surface from the PAINTED terrain layers: true where a layer whose
// texture is dirt, mud or rock carries more than half the weight of the cell.
// Which layers count is decided once here (string tests at load, never per
// frame); the per-step query is one array read and a little arithmetic.
const SPLAT_HARD = [0, 0, 0, 0];
for (let l = 0; l < W.TERRAIN_SPLAT_COUNT; l++) {
  const ref = W.TERRAIN_SPLAT_TEX[l];
  if (ref.indexOf('dirt') >= 0 || ref.indexOf('mud') >= 0 || ref.indexOf('rock') >= 0) SPLAT_HARD[l] = 1;
}
function paintedHardGround(x: number, z: number): boolean {
  if (W.TERRAIN_SPLAT_COUNT === 0) return false;
  const n = W.TERRAIN_SPLAT_W;
  const cx = Math.round((x - W.TERRAIN_ORIGIN_X) / W.TERRAIN_CELL_SIZE);
  const cz = Math.round((z - W.TERRAIN_ORIGIN_Z) / W.TERRAIN_CELL_SIZE);
  if (cx < 0 || cz < 0 || cx >= n || cz >= W.TERRAIN_SPLAT_H) return false;
  let packed = W.TERRAIN_SPLAT_DATA[cz * n + cx];
  let hard = 0;
  for (let l = 0; l < W.TERRAIN_SPLAT_COUNT; l++) {
    const v = packed % 256;
    packed = Math.floor(packed / 256);
    if (SPLAT_HARD[l] === 1) hard = hard + v;
  }
  return hard > 127;
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

  const albedoArr = createTextureArrayFromFiles(albedoPaths, TEX_ARRAY_FORMAT_SRGB, 11);   // full chain for 2048 (4 aliased at range)
  // Normals MUST be linear — sRGB-decoding an encoded normal corrupts it.
  const normalArr = createTextureArrayFromFiles(normalPaths, TEX_ARRAY_FORMAT_LINEAR, 11);

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
  0.80, 0.98, 0.70,  2.0,    // lush — leafy_grass,           2.0 m (2026-11: a real grass scan)
  0.86, 0.96, 0.74,  2.0,    // dry  — forrest_ground_01,     2.0 m (was withered_grass: beige straw hills)
  1.00, 0.97, 0.92,  2.35,   // dirt — mud_forest,            2.35 m (dark wet forest mud)
  0.88, 0.90, 0.96,  1.83,   // rock — cliff_side,            1.83 m (cooled — the
                             //        scan is a warm orange sandstone)
  // macro noise freq, slope threshold (cos), ridge height, pale strength
  0.18, 0.72, 4.0,   0.45,
  // river: centre z, half-width, bank fade width, waterline y.
  // Matches the arena_02 river volume (z=12, carve half-width 2.6).
  // SH-050 — bank fade 1.8 -> 3.0: the brown mud now has to READ as a bank, and
  // a 1.8 m fade put the whole grass->mud transition inside a stride.
  // Phase 3.3: filled in below from the world's water volume (it was arena_02's numbers for
  // every arena, so the ravine's mud lay 12 m from its river).
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
if (W.WATER_COUNT > 0) {
  // river vec4 at 20: centre line, half-width (negative = the river runs along Z), fade, waterline
  const alongX = W.WATER_SX[0] >= W.WATER_SZ[0];
  TERRAIN_PARAMS[20] = alongX ? W.WATER_CZ[0] : W.WATER_CX[0];
  TERRAIN_PARAMS[21] = alongX ? 3.2 : -3.2;
  TERRAIN_PARAMS[22] = 3.0;
  TERRAIN_PARAMS[23] = W.WATER_CY[0] + 0.05;
} else {
  TERRAIN_PARAMS[20] = 9999; TERRAIN_PARAMS[21] = 0.01;
}
if (matTerrain > 0) setMaterialParams(matTerrain, TERRAIN_PARAMS);
// Per-mesh collider from userData.collider === 'box'.
for (let i = 0; i < W.MESH_COUNT; i++) {
  if (W.MESH_COLLIDER[i] === 1) {
    const shape = boxShape(vec3(W.MESH_COLLIDER_HX[i], W.MESH_COLLIDER_HY[i], W.MESH_COLLIDER_HZ[i]));
    // A dressing prop carries a yaw; its box turns with the drawn model (same right-handed
    // turn about +Y that drawModelRotated applies).
    const yawR = W.MESH_YAW[i] > -999 ? W.MESH_YAW[i] * Math.PI / 180 : 0;
    createBody(physics, shape, {
      motionType: MotionType.STATIC,
      rotation: { x: 0, y: Math.sin(yawR * 0.5), z: 0, w: Math.cos(yawR * 0.5) },
      // A box placeholder is centred on its position; a prop MODEL has its origin at the
      // base, so its collider is lifted by its half height. (Until 2026-11 the furniture's
      // colliders sat half their height into the floor, under the crates you could see.)
      position: vec3(W.MESH_X[i],
        W.MESH_Y[i] + (W.MODEL_IS_BOX[W.MESH_MODEL_IDX[i]] === 1 ? 0 : W.MESH_COLLIDER_HY[i]),
        W.MESH_Z[i]),
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
// EN-055 boot rework — decode every character GLB in parallel worker threads
// (stageModels = parallelMap over bloom_stage_model), then commit each on the
// main thread where its stage needs it. Sub-timing on 2026-07-16 put 4.9 s of
// the 8.7 s boot in SERIAL loadModel texture decode; the per-slot animation
// parses SH-049 blamed were 43 ms. The staged commit path needed two engine
// fixes first (aux-texture remap + normal-map registration kind) — see the
// EN-055 engine PR; without them this swap would have silently stripped the
// SH-046 character maps.
const CHARACTER_GLBS = new Array<string>(1 + KIND_COUNT);
CHARACTER_GLBS[0] = 'assets/models/player_trooper.glb';
for (let k = 0; k < KIND_COUNT; k++) CHARACTER_GLBS[1 + k] = ALIEN_GLB[k];
// Web: Perry's parallelMap workers each get their own WASM instance, but the
// engine lives on the main thread — a worker-side stageModel reaches nothing.
// Same tickets, decoded sequentially instead.
const stagedCharacters = WEB
  ? stageModelsSync(CHARACTER_GLBS)
  : stageModels(CHARACTER_GLBS);
const stagedAliens = new Array<number>(KIND_COUNT);
for (let k = 0; k < KIND_COUNT; k++) stagedAliens[k] = stagedCharacters[1 + k];

const mdlPlayer  = commitModel(stagedCharacters[0]);
const animPlayer = loadModelAnimation('assets/models/player_trooper.glb');
// player_trooper clips (Tripo Studio Text2Motion, rifle held at the shoulder in every one;
// tools/gen/make_character.sh sorts them by name):
//   0 crouch_idle, 1 crouch_walk, 2 idle, 3 run, 4 walk.
// The ground speed each locomotion clip was AUTHORED to travel at. The playback
// rate is (actual speed / this), which is what plants the feet — get these wrong
// and the character skates.
//
// MEASURED 2026-11-14 in Blender, not estimated: the median speed of a foot
// relative to the hips over the frames it is planted. The run value used to be
// 5.5 (a guess, 70% too high) and normal movement played the WALK clip, which
// at 4.5 m/s wanted 2.8x and hit the clamp: that was the foot-slide.
const ANIM_WALK_SPEED = 1.15;  // a steady march
const ANIM_RUN_SPEED  = 3.25;  // a jog; sped up it carries the sprint too
// Below this ground speed the walk clip is used, above it the run clip. It sits
// between the speeds the game actually produces (crouch 2.0, walk 4.5, sprint
// 9.0), so there is no boundary to flicker on.
const ANIM_RUN_ABOVE = 2.8;

// The Trooper's clips, by sorted name (tools/gen/build_cast.sh prints the list; the prompts are in
// art/source/trooper_clips.md). Second Text2Motion batch, 2026-11-14.
const PLAYER_ANIM_CROUCH     = 0;    // crouch idle
const PLAYER_ANIM_CROUCH_FWD = 1;    // crouch walk
const PLAYER_ANIM_DEATH_BACK = 2;    // shot from the front, falls onto the back
const PLAYER_ANIM_DEATH_FRONT = 3;   // shot from behind, pitches forward
const PLAYER_ANIM_HIT_BACK   = 4;
const PLAYER_ANIM_HIT_FRONT  = 5;
const PLAYER_ANIM_IDLE       = 6;
const PLAYER_ANIM_ROLL       = 7;
const PLAYER_ANIM_RUN        = 8;
const PLAYER_ANIM_SPRINT     = 9;
const PLAYER_ANIM_STRAFE_L   = 10;
const PLAYER_ANIM_STRAFE_R   = 11;
const PLAYER_ANIM_WALK       = 12;
const PLAYER_ANIM_WALK_BACK  = 13;
// Authored ground speeds, measured like the two above (planted-foot median, m/s).
const ANIM_CROUCH_SPEED = 0.9;
const ANIM_SPRINT_SPEED = 3.0;
const ANIM_BACK_SPEED   = 1.05;
const ANIM_STRAFE_SPEED = 1.0;
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
  // Slice D. Until the generated models are in, each borrows the nearest shape it has.
  loadModel(fileExists('assets/models/weapon_scattergun.glb') ? 'assets/models/weapon_scattergun.glb' : 'assets/models/weapon_blaster.glb'),
  loadModel(fileExists('assets/models/weapon_lance.glb') ? 'assets/models/weapon_lance.glb' : 'assets/models/weapon_rifle.glb'),
];
const HAS_SCATTER_MDL = fileExists('assets/models/weapon_scattergun.glb');
const HAS_LANCE_MDL = fileExists('assets/models/weapon_lance.glb');
// Muzzle distance down the barrel, metres. These pair with the `length` column
// in tools/convert-weapons.ts, which normalises each model to that length
// precisely so these constants survive an art change.
// New photoreal weapons (tools/blender/process_static.py): lengths 0.92 / 0.45 / 1.05 / 1.00 m,
// rear of the gun at z = 0, so the muzzle is just short of the full length.
// Scattergun 0.75 m and lance 1.35 m (slice D). Their hand positions below are read off the
// model sheets, not tuned in PLAYERSHOT like the first four. (Without the models the game
// draws the blaster and the rifle and uses their numbers.)
const WEAPON_MUZZLE_Z = [0.90, 0.44, 1.03, 0.98, HAS_SCATTER_MDL ? 0.73 : 0.44, HAS_LANCE_MDL ? 1.33 : 0.90];
const WEAPON_DRAW_SCALE = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0];

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
const PLAYER_ROLL_DUR = animClipDuration(animPlayer, PLAYER_ANIM_ROLL);
const PLAYER_HIT_DUR = 0.75;
// Plan 1.3 (engine EN-064): the torso follows the camera's pitch through the three spine joints,
// and the off hand is pulled onto the weapon's foregrip. Exact names, for the reason above.
const plSpine0 = findJoint(animPlayer, 'mixamorig:Spine');
const plSpine1 = findJoint(animPlayer, 'mixamorig:Spine1');
const plSpine2 = findJoint(animPlayer, 'mixamorig:Spine2');
const plLeftHand = findJoint(animPlayer, 'mixamorig:LeftHand');
// How much of the aim pitch the spine takes (the rest is the arms' own pose), and its limit.
const AIM_SPINE_SHARE = 0.85;
const AIM_SPINE_MAX = 0.9;
// Where the off hand holds each weapon, in the weapon's own frame (m): along the barrel,
// below the bore line. Rifle, blaster (a support hand under the grip), chaingun, cannon.
const WEAPON_GRIP_Z = [0.68, 0.14, 0.72, 0.54, HAS_SCATTER_MDL ? 0.53 : 0.14, HAS_LANCE_MDL ? 0.66 : 0.68];
const WEAPON_GRIP_Y = [-0.06, -0.09, -0.10, -0.14, HAS_SCATTER_MDL ? -0.08 : -0.09, HAS_LANCE_MDL ? -0.07 : -0.06];
// Where the trigger hand holds it: the pistol grip, measured from the model's rear along the
// barrel, and how far the bore line sits above the hand. The weapon is drawn so that this point
// is on the weapon socket (before 2026-11 the socket held the very end of the stock).
// The magazine well, same frame: where the off hand goes during a reload.
const WEAPON_MAG_Z = [0.47, 0.07, 0.52, 0.46, HAS_SCATTER_MDL ? 0.38 : 0.07, HAS_LANCE_MDL ? 0.46 : 0.47];
const WEAPON_MAG_Y = [-0.17, -0.13, -0.18, -0.16, HAS_SCATTER_MDL ? -0.17 : -0.13, HAS_LANCE_MDL ? -0.08 : -0.17];
const WEAPON_HAND_Z = [0.32, 0.07, 0.38, 0.36, HAS_SCATTER_MDL ? 0.24 : 0.07, HAS_LANCE_MDL ? 0.30 : 0.32];
const WEAPON_HAND_Y = [0.07, 0.08, 0.10, 0.09, HAS_SCATTER_MDL ? 0.08 : 0.08, HAS_LANCE_MDL ? 0.07 : 0.07];
// Eased 0..1: how firmly the off hand is held on the weapon (let go for a reload or a dodge).
//   0 off-hand hold          1 upper-body layer weight   2 squared-to-camera timer
//   3 death clip (-1 alive)  4 strafe-left weight        5 strafe-right weight
//   6 hit reaction time left 7 GS.lastHitT last frame    8 hit clip
//   9 clip on the layer      10-12 weapon forward and 13-15 weapon up, in the hand's own frame
//   16 those are known (0/1) 17 weapon follows the hand (eased 0..1)
const PLRIG = [0, 0, 0, -1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0];
// Phase 2 - per enemy slot: the strike the attack layer was last restarted for, and whether a
// hit jolt is currently applied to its spine (so it is cleared exactly once).
const enLayerSeq = new Array<number>(MAX_ENEMIES);
const enJoltOn = new Array<number>(MAX_ENEMIES);
for (let i = 0; i < MAX_ENEMIES; i++) { enLayerSeq[i] = 0; enJoltOn[i] = 0; }
const JOLT_ANGLE = 0.55;       // radians the upper body is knocked at full strength
const TMP3 = [0, 0, 0];
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
// SH-052 — the river gets a live emitter per water volume (EN-062 looping
// voices). Rectangles come from the world file, so moving the river in the
// editor moves its sound; the per-frame update tracks the closest bank point.
MIX.initRiverAmbience(W.WATER_COUNT, W.WATER_CX, W.WATER_CY, W.WATER_CZ,
                      W.WATER_SX, W.WATER_SZ);

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
initFlora();

// SH-051 — build the vertical-navigation tables (walkable building boxes + the
// stair flights) from the world data. Must run before the director's first
// update; it makes no engine calls, but it reads world-runtime, so it lives
// here at an explicit boot position rather than at some module's import time.
initNav();
initFlow();

// ---- Enemies (SH-025: kinds, stats, pool state → src/enemies.ts) ----------
const WHITE = { r: 255, g: 255, b: 255, a: 255 };
initDirector(physics, stagedAliens);

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
// Frames until the arena relaunch fires (0 = none pending). A countdown so the
// LOADING cover is on screen before the process is replaced.
let arenaRestartIn = 0;
// Seconds since the run ended (died or won); -1 once the results screen has been opened.
let endRunT = 0;
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
setVignette(W.lookNum('vignette', 0.4), 0.55);    // darken frame edges
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
let mtJump = 0;
/// Press and release a key two frames apart, through the engine's own key state.
function mtTap(f: number, at: number, key: number): void {
  if (f === at) injectKeyDown(key);
  if (f === at + 2) injectKeyUp(key);
}

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

// ---- PLAYERSHOT harness ------------------------------------------------------
// The Trooper from the side, the front and behind, in each thing the player can do, so the
// animation work of plan Phase 1 is judged from pictures and not from the back of a helmet.
// Six numbers per shot: camera pitch, moveZ, moveX, aim, crouch, sprint, view
// (0 right side, 1 front three-quarter, 2 behind, 3 left side). 50 frames each, captured on the
// 45th as shooter_player_NN.png. MUST be false in shipped builds.
const PLAYERSHOT = false;
const PSHOT_N = 7;
const PSHOTS = [
  0.35,  0, 0, 0, 0, 0, 0,     //  0 idle
  -0.20, 0, 0, 0, 0, 0, 0,     //  1 idle, looking up
  0.90,  0, 0, 0, 0, 0, 0,     //  2 idle, looking down
  0.20,  0, 0, 1, 0, 0, 0,     //  3 aiming
  0.20,  0, 0, 1, 0, 0, 1,     //  4 aiming, from the front
  0.20,  0, 0, 1, 0, 0, 3,     //  5 aiming, off-hand side
  0.30, -1, 0, 0, 0, 0, 0,     //  6 walk
  0.30, -1, 0, 0, 0, 1, 0,     //  7 sprint
  0.30,  0, 0, 0, 1, 0, 0,     //  8 crouch
  0.30, -1, 0, 0, 1, 0, 0,     //  9 crouch walk
  0.20,  0, 1, 1, 0, 0, 2,     // 10 aiming, strafing right
  0.20,  1, 0, 1, 0, 0, 0,     // 11 aiming, backing up
  0.20, -1, 0, 1, 0, 0, 0,     // 12 aiming, advancing
];
const PSHOT_COUNT = 26;   // 13 rows, rows 3 and 5 again with each of the other three weapons,
                          // then seven action shots: roll, reload, hit, late in a roll, strafe
                          // left from the front, death (falling, down)
const PSHOT_FRAMES = 50;

// ---- P2TEST harness (plan Phase 2, SH-057) -----------------------------------
// A scripted pass over what Phase 2 added, with numbers in the log and pictures on disk:
//   1 SHAPES   one of each kind in a row; rays at head / chest / foot / beside / weak point
//              must come back with the right location; a picture with the shapes drawn; then
//              real rifle fire steered onto a head.
//   2 SENSES   a Ravager walking away at 22 m does not notice a silent player; one shot and
//              it does. It closes and strikes: wind-up, hit, recovery, timed and logged with
//              the player's health. The second strike is answered with a roll.
//   3 PACK     eight Skitters at once (the swarm, plan 2.6) around the player: how many are
//              mid-attack at the same moment (attack tokens); then the rifle butt, then a grenade.
//   4 VAULT    the Trooper runs at a crate in the house and jumps.
//   5 a picture of an ammo cache and a field dressing.
// MUST be false in shipped builds.
const P2TEST = false;
//   0 last logged Ravager state  1 time of its last wind-up  2 HP at that wind-up
//   3 strikes seen  4 most creatures mid-attack at once  5 alive before melee
//   6 alive before grenade  7 aim settle frames  8 stage-2 shot fired (0/1)
const P2 = [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
// P2BOT - a whole run played by a stand-in: it stands at the spawn, turns to the nearest creature
// it could see, and holds the trigger. Health is held full. What it proves is flow, not feel:
// that waves of hunting creatures find the player, fight, die and the arena clears, with the
// larger pool, in a few minutes, without a stall or a crash. MUST be false in shipped builds.
const P2BOT = false;
//   0 last wave index logged  1 most alive at once  2 most mid-attack at once  3 hits taken
//   4 HP last frame
//   5 nest to be put beside this frame (-1 none)   6 last boss picture taken (phase * 10 + special)
//   7 the weapon `--weapon` asked for (-1 = whatever it holds)
//   8 frames the boss has been alive
const PB = [-1, 0, 0, 0, 100, -1, 0, -1, 0];
const P2OUT = [0, 0, 0, 0, 0];

function p2Place(slot: number, x: number, z: number, heading: number): void {
  const k = enKind[slot];
  enX[slot] = x; enZ[slot] = z;
  enY[slot] = terrainHeightAt(x, z);
  enHP[slot] = KIND_HP[k];
  enAlive[slot] = 1; enDying[slot] = 0;
  enAnimClip[slot] = -1;
  enAttackCD[slot] = 0;
  enAIState[slot] = 0; enStateT[slot] = 0;
  enHeading[slot] = heading;
  enAware[slot] = 0; enReactT[slot] = 0; enSearchT[slot] = 999;
  enLastX[slot] = x; enLastY[slot] = enY[slot]; enLastZ[slot] = z;
  enPosed[slot] = 0;
  setBodyPosition(enBody[slot], vec3(x, enY[slot] + KIND_BOX_Y[k], z), true);
}

/// One ray from (ox,oy,oz) at slot i's shape joint j (plus an offset to the side): the
/// location it reports, or -1 for a miss, or -2 when it hit some other slot.
function p2Probe(ox: number, oy: number, oz: number, i: number, j: number, side: number): number {
  shapeJoint(i, j, TMP3);
  const tx = TMP3[0] + side, ty = TMP3[1], tz = TMP3[2];
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const hit = rayEnemies(ox, oy, oz, dx / dl, dy / dl, dz / dl, dl + 3, 0, P2OUT);
  if (hit < 0) return -1;
  if (hit !== i) return -2;
  return P2OUT[1];
}

// ---- COMBATSHOT harness -----------------------------------------------------
// Drives a REAL fight and screenshots it, because the AAA-round systems (VFX,
// decals, recoil, hit-stop, flinch, HUD) can only be judged in combat and the
// game takes the whole screen while it runs. Auto-starts the run, spawns a
// couple of enemies in front of the player, holds the trigger, and captures at
// a few points. Same dormancy contract as the other harnesses: MUST be false in
// shipped builds.
const COMBATSHOT = false;

// ---- UISHOT harness (plan Phase 4) -------------------------------------------
// Captures every screen of the front end and the HUD in its states, by opening them through
// menu.ts's own entry points: title, the six settings tabs, arena select, credits, the title
// and a settings tab in German, the arena select in French; then a run - the plain HUD, a hit
// at low health with subtitles on, a reload with pad glyphs in the red-green-safe palette,
// the wave card and the unlock banner, pause, and both results screens. Pictures land as
// shooter_ui_NN_name.png. Changes settings in memory only (never saved). Dormancy contract
// as ever: MUST be false in shipped builds.
const UISHOT = false;
let uiShotPad = false;
const UISHOT_NAMES = ['main', 'set_game', 'set_controls', 'set_binds', 'set_video', 'set_audio',
                      'set_access', 'levels', 'credits', 'main_de', 'set_video_de', 'levels_fr',
                      'armory', 'record'];

// ---- SCENESHOT harness ------------------------------------------------------
// Stills of the level art (house, grass, trees) from fixed viewpoints, no enemies.
// Captures shooter_scene_<n>.png from the view table of the arena that is loaded. MUST be false in shipped builds.
const SCENESHOT = false;
// Rows: player x, z, yaw, pitch, floor y (-1 = stand on the terrain). One table per arena.
const SCENE_VIEWS_02 = [
  -21, 8, 0.0, 0.10, -1,        // house, south front
  -2, 3, -0.85, 0.08, -1,       // house, south-east corner
  -20, -9, 1.2, 0.15, 0.2,      // house, inside ground floor
  -21, -1, 0.0, 0.0, -1,        // house, door close-up
  8, 22, 0.3, 0.02, -1,         // grass + tree line, low
  9, 10, 0.5, -0.20, -1,        // tree, looking up into a crown
  0, 20, 0.0, 0.12, -1,         // spawn view
  15, 2, 1.2, 0.05, -1,         // trees close
  -14, -12, -1.9, 0.10, 0.2,    // house, inside, looking west along the ground floor
  -22, -12, 2.6, 0.12, 3.9,     // house, first floor
  2, -3, -2.2, 0.05, -1,        // plaza, toward the generator and the house's east side
  -30, 30, 0.9, 0.02, -1,       // south-west meadow, to the horizon
];
const SCENE_VIEWS_03 = [
  3, 27, 0.0, 0.10, -1,         // spawn view, up the ravine
  6, 10, -0.6, 0.05, -1,        // east bank, across the river
  -10, 0, 1.57, 0.08, -1,       // west bank, looking east
  0.5, -14, 0.0, 0.03, -1,      // in the river, upstream
  14, -20, 2.4, 0.10, -1,       // north-east rim, back down
  10, 22, 0.9, 0.05, -1,        // the camp by the spawn
];
const SCENE_VIEWS_04 = [
  0, 26, 0.0, 0.10, -1,
  -12, 8, 0.8, 0.06, -1,
  10, 4, -0.9, 0.06, -1,
  0, -6, 3.14, 0.08, -1,
  -20, -18, 0.6, 0.04, -1,
  18, -14, -2.2, 0.08, -1,
  4, 12, 1.57, 0.02, -1,
  -6, -2, -1.57, 0.10, -1,
];
const SCENE_VIEWS_05 = [
  0, 31, 0.0, 0.14, -1,         // spawn, on the rim, into the pit
  -4, 18, 0.0, 0.10, -1,        // head of the south ramp
  -6, 4, 3.14, 0.02, -1,        // pit floor, back up at the benches
  -4, -6, 1.0, 0.04, -1,        // floor, toward the generator
  -22, -8, 1.57, 0.12, -1,      // west bench, across the pit
  8, -22, 2.6, 0.14, -1,        // north bench, down and south
  20, 10, -1.57, 0.10, -1,      // east rim by the channel
  -30, 2, 1.57, 0.10, -1,       // head of the west ramp
];
const SCENE_VIEWS_06 = [
  0, 30, 0.0, 0.10, -1,         // spawn, into the hollow
  0, 14, 0.0, 0.06, -1,         // south edge of the clearing
  0, -2, 0.0, 0.02, -1,         // the middle
  14, 4, -1.9, 0.05, -1,        // east edge, the generator
  -14, 6, 1.6, 0.05, -1,        // west edge, the wreck
  0, -18, 3.14, 0.06, -1,       // north edge, back across
  22, -22, -2.4, 0.08, -1,      // outside the rim, north-east gap
  -24, 0, 1.57, 0.04, -1,       // the creek side
];
const SCENE_VIEWS = W.WORLD_ID === 'arena_03' ? SCENE_VIEWS_03
  : (W.WORLD_ID === 'arena_04' ? SCENE_VIEWS_04
  : (W.WORLD_ID === 'arena_05' ? SCENE_VIEWS_05
  : (W.WORLD_ID === 'arena_06' ? SCENE_VIEWS_06 : SCENE_VIEWS_02)));

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
  sfxSwing, sfxCrit, sfxHeal, sfxRicochet, PLAYER_HP_MAX,
});
// The crate model for pickups: the world's own copy when the arena has crates, else loaded.
const hasCrate = (cratePropIdx >= 0 || fileExists('assets/models/prop_crate.glb')) ? 1 : 0;
const mdlCrate: any = cratePropIdx >= 0 ? meshModelHandles[cratePropIdx]
  : (hasCrate === 1 ? loadModel('assets/models/prop_crate.glb') : 0);

// SH-025c — same pattern for the combat module: camera + physics handles,
// the player model the weapon rides, the weapon models + their ABI columns,
// and the audio handles combat plays. Once, before the loop.
setCombatDeps({
  CAM, physics, TP_PITCH_MIN, TP_PITCH_MAX,
  animPlayer, playerHandJoint, PLAYER_SCALE, PLAYER_MODEL_Y_OFFSET,
  mdlWeapons, WEAPON_MUZZLE_Z, WEAPON_DRAW_SCALE, WEAPON_HAND_Z, WEAPON_HAND_Y,
  sfxFireRifle, sfxFireBlaster, sfxRicochet, sfxPlayerDie, stingDeath,
  sfxFireByWeapon, sfxFireRifleB, sfxExplosion, sfxPlayerPain,
  musicMenu, musicCalm, musicCombat,
  mdlCrate, hasCrate, sfxSwing, sfxMeleeHit, sfxNadeThrow, sfxNadeBounce,
});
// Phase 6 - the nest model and the two sounds a nest makes (objective.ts).
OBJ.hasNest = fileExists('assets/models/prop_nest.glb') ? 1 : 0;
OBJ.mdlNest = OBJ.hasNest === 1 ? loadModel('assets/models/prop_nest.glb') : 0;
OBJ.sfxHit = sfxImpactFlesh;
OBJ.sfxBurst = sfxExplosion;
// A scripted run (any harness) must not bank credits, stars or a best score, and must not be
// stopped by the tutorial.
if (SELFTEST || FACETEST || KEYPROBE || LOCOPROBE || WATERTEST || AITEST || MENUTEST || ANIMDBG
    || PLAYERSHOT || P2TEST || P2BOT || COMBATSHOT || UISHOT || SCENESHOT || STAIRTEST
    || FPSPROBE || PERFTEST || AUDIOTEST) {
  DIR.bank = false;
  TUTOR.setTutorEnabled(false);
}

// ---- P2TEST (see the harness block above) --------------------------------------------------
// Frames: 30-200 shapes, 200-560 senses and the strike, 560-990 the pack, the rifle butt and a
// grenade, 990-1100 the vault, 1100-1170 pickups.
function p2Early(input: any): void {
  const f = testFrame;
  if (f === 20 && GS.gameState === 0) { startRun(); cursorLocked = true; }
  DIR.waveBreakTimer = 9999;
  GS.gameOver = false;
  input.moveX = 0; input.moveZ = 0;
  if (f < 200 || (f >= 560 && f < 990) || f >= 990) GS.playerHP = PLAYER_HP_MAX;
  if (f === 30) {
    // one of each kind, 8 m ahead, 3 m apart, facing the player, told to stand
    for (let k = 0; k < KIND_COUNT; k++) {
      p2Place(KIND_SLOT0[k], -9 + k * 3, 12, Math.PI);
      enReactT[KIND_SLOT0[k]] = 1089;
    }
  }
  if (f === 200) {
    despawnAllEnemies();
    setPlayerPosition(vec3(0, terrainHeightAt(0, 27) + 1.2, 27));
    const sl = KIND_SLOT0[2];
    p2Place(sl, 1.5, 17, 0);                 // 10 m ahead, back turned, walking away
    enLastX[sl] = 1.5; enLastZ[sl] = -30;
    GS.playerHP = PLAYER_HP_MAX;
    P2[0] = -1; P2[3] = 0; P2[8] = 0; P2[9] = 0;
  }
  if (f === 560) {
    despawnAllEnemies();
    setPlayerPosition(vec3(0, terrainHeightAt(0, 24) + 1.2, 24));
    for (let j = 0; j < 8; j++) {
      const a = j * Math.PI / 4;
      p2Place(KIND_SLOT0[0] + j, Math.sin(a) * 9, 24 - Math.cos(a) * 9, a + Math.PI);
      enAware[KIND_SLOT0[0] + j] = 1;
      enLastX[KIND_SLOT0[0] + j] = 0; enLastZ[KIND_SLOT0[0] + j] = 24;
    }
    P2[4] = 0;
  }
  if (f === 990) {
    despawnAllEnemies();
    // 1.6 m short of the ground-floor crate at (-16.5, -14), facing it (-Z)
    setPlayerPosition(vec3(-16.5, 0.2 + 1.2, -12.2));
  }
  if (f >= 1005 && f < 1090) {
    input.moveZ = -1;
    input.jump = f === 1025;
    if ((f % 6) === 0) {
      const pv = playerPosition();
      console.log('P2 vault f=' + f + ' z=' + pv.z.toFixed(2) + ' y=' + pv.y.toFixed(2)
        + ' vault=' + vaultProgress().toFixed(2) + ' grounded=' + (playerGrounded() ? 1 : 0)
        + ' why=' + VD[0] + ' h=' + VD[1].toFixed(2));
    }
  }
  if (f === 1100) {
    setPlayerPosition(vec3(0, terrainHeightAt(0, -10.5) + 1.2, -10.5));
    hpX[0] = 1.6; hpZ[0] = -13.5; hpY[0] = terrainHeightAt(1.6, -13.5); hpLife[0] = 20;
    GS.playerHP = PLAYER_HP_MAX;      // full health: the dressing is left lying for the picture
  }
  if (f >= 1100) { CAM[0] = 0; CAM[1] = 0.25; }
}

function p2Late(): boolean {
  const f = testFrame;
  const pp = playerPosition();
  let fire = false;
  // ---- 1 shapes
  if (f === 60) {
    const oy = pp.y + 0.5;
    for (let k = 0; k < KIND_COUNT; k++) {
      const sl = KIND_SLOT0[k];
      const head = p2Probe(pp.x, oy, pp.z, sl, HSJ_HEAD, 0);
      shapeJoint(sl, HSJ_HIPS, TMP3);
      const hx = TMP3[0], hy = TMP3[1], hz = TMP3[2];
      shapeJoint(sl, HSJ_NECK, TMP3);
      const mx = (hx + TMP3[0]) * 0.5, my = (hy + TMP3[1]) * 0.5, mz = (hz + TMP3[2]) * 0.5;
      let dx = mx - pp.x, dy = my - oy, dz = mz - pp.z;
      let dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const chestI = rayEnemies(pp.x, oy, pp.z, dx / dl, dy / dl, dz / dl, dl + 3, 0, P2OUT);
      const chest = chestI === sl ? P2OUT[1] : -1;
      const foot = p2Probe(pp.x, oy, pp.z, sl, HSJ_FOOT_L, 0);
      const beside = p2Probe(pp.x, oy, pp.z, sl, HSJ_HEAD, 1.4);
      const weak = KIND_WEAK_R[k] > 0 ? p2Probe(pp.x, oy, pp.z, sl, HSJ_WEAK, KIND_WEAK_Z[k]) : -9;
      // and the same chest ray from BEHIND the creature (shell kinds must report 4)
      dx = -dx; dz = -dz;
      const bx = mx - dx / dl * 6, bz = mz - dz / dl * 6;
      const backI = rayEnemies(bx, my, bz, dx / dl, 0, dz / dl, 9, 0, P2OUT);
      const back = backI === sl ? P2OUT[1] : -1;
      console.log('P2 shapes ' + KIND_NAME[k] + ' head=' + head + ' chest=' + chest
        + ' foot=' + foot + ' beside=' + beside + ' weak=' + weak + ' back=' + back
        + ' headY=' + (TMP3[1] - enY[sl]).toFixed(2));
    }
  }
  if (f === 75) takeScreenshot('shooter_p2_shapes.png');
  // real fire, steered onto the Ravager's head (kind 2, at x = -3)
  if (f >= 90 && f < 190) {
    const sl = KIND_SLOT0[2];
    if (enAlive[sl] === 1) {
      shapeJoint(sl, HSJ_HEAD, TMP3);
      const dx = TMP3[0] - CAM[2], dy = TMP3[1] - CAM[3], dz = TMP3[2] - CAM[4];
      CAM[0] = Math.atan2(dx, -dz);
      CAM[1] = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
      P2[7] = P2[7] + 1;
      if (P2[7] > 25) {
        fire = true;
        if ((f % 4) === 0) {
          console.log('P2 fire f=' + f + ' ravagerHP=' + enHP[sl].toFixed(1)
            + ' crit=' + GS.hitMarkCrit + ' hits=' + SCORE.shotsHit() + '/' + SCORE.shotsFired());
        }
      }
      if (f === 130) takeScreenshot('shooter_p2_headshot.png');
    } else if (P2[7] > 0) {
      console.log('P2 fire: ravager dead at f=' + f + ' shots=' + SCORE.shotsFired()
        + ' hits=' + SCORE.shotsHit());
      P2[7] = 0;
    }
  }
  // ---- 2 senses and the strike
  if (f >= 200 && f < 560) {
    const sl = KIND_SLOT0[2];
    CAM[0] = 0; CAM[1] = 0.3;
    const d = Math.hypot(pp.x - enX[sl], pp.z - enZ[sl]);
    if (f === 258) console.log('P2 senses before the shot: aware=' + enAware[sl] + ' dist=' + d.toFixed(1));
    if (f === 262 && P2[8] === 0) { fire = true; P2[8] = 1; }
    if (f === 275) console.log('P2 senses after the shot: aware=' + enAware[sl] + ' dist=' + d.toFixed(1));
    if (enAlive[sl] === 1 && enAIState[sl] !== P2[0]) {
      const tN = getTime();
      console.log('P2 strike state ' + P2[0] + ' -> ' + enAIState[sl] + ' t=' + tN.toFixed(2)
        + ' dist=' + d.toFixed(2) + ' hp=' + Math.ceil(GS.playerHP)
        + ' dodged=' + (DIR.dodgedT > 0 ? 1 : 0));
      if (enAIState[sl] === AI_STRIKE_WIND) { P2[1] = tN; P2[2] = GS.playerHP; P2[3] = P2[3] + 1; }
      if (enAIState[sl] === AI_STRIKE_REC) {
        console.log('P2 strike ' + P2[3] + ': wind-up to recovery ' + (tN - P2[1]).toFixed(2)
          + ' s, hp ' + Math.ceil(P2[2]) + ' -> ' + Math.ceil(GS.playerHP));
      }
      P2[0] = enAIState[sl];
    }
    // answer the second and later strikes with a roll to the right, 0.2 s into the wind-up
    if (P2[3] >= 2 && enAIState[sl] === AI_STRIKE_WIND && getTime() - P2[1] > 0.2) {
      if (startDodge(1, 0)) console.log('P2 rolled at t=' + getTime().toFixed(2));
    }
    // one picture late in the first wind-up (the tell), one during the first recovery
    if (P2[9] === 0 && P2[3] === 1 && enAIState[sl] === AI_STRIKE_WIND && enStateT[sl] < 0.14) {
      takeScreenshot('shooter_p2_windup.png'); P2[9] = 1;
    }
    if (P2[9] === 1 && enAIState[sl] === AI_STRIKE_REC) {
      takeScreenshot('shooter_p2_recover.png'); P2[9] = 2;
    }
  }
  // ---- 3 the pack
  if (f >= 560 && f < 990) {
    CAM[0] = 0; CAM[1] = 0.55;
    let mid = 0, alive = 0, ring = 0;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (enAlive[i] === 0) continue;
      alive = alive + 1;
      if (enAIState[i] === AI_STRIKE_WIND || enAIState[i] === AI_STRIKE_HIT) mid = mid + 1;
      if (Math.hypot(pp.x - enX[i], pp.z - enZ[i]) < 4.5) ring = ring + 1;
    }
    if (mid > P2[4]) P2[4] = mid;
    if (f === 630 || f === 690 || f === 750) {
      takeScreenshot('shooter_p2_pack_f' + f + '.png');
      console.log('P2 pack f=' + f + ' alive=' + alive + ' within4.5m=' + ring
        + ' midAttackNow=' + mid + ' maxMidAttack=' + P2[4] + ' fps=' + getFPS().toFixed(0));
    }
    if (f === 790) { P2[5] = alive; startMelee(); }
    if (f === 796) takeScreenshot('shooter_p2_melee.png');
    if (f === 820) console.log('P2 melee: alive ' + P2[5] + ' -> ' + alive);
    if (f >= 828 && f < 832) CAM[1] = 1.0;
    if (f === 830) { P2[6] = alive; console.log('P2 grenade thrown=' + (throwGrenade() ? 1 : 0)); }
    if (f === 842) takeScreenshot('shooter_p2_grenade.png');
    if (f === 985) console.log('P2 grenade: alive ' + P2[6] + ' -> ' + alive
      + ' grenadesLeft=' + GS.grenades + ' maxMidAttack=' + P2[4]);
  }
  if (f === 1035 || f === 1045) takeScreenshot('shooter_p2_vault_f' + f + '.png');
  if (f === 1150) takeScreenshot('shooter_p2_pickup.png');
  if (f === 1170) { console.log('P2TEST done'); aitestDone = true; }
  return fire;
}

/// Put the player at a point (the harnesses).
function movePlayerTo(x: number, y: number, z: number): void {
  setPlayerPosition(vec3(x, y, z));
}

function p2Bot(): boolean {
  const f = testFrame;
  if (f === 20 && GS.gameState === 0) {
    startRun(); cursorLocked = true;
    // `--wave N` (2..10) starts the stand-in at that wave: the boss is wave 10 of arena_06.
    for (let n = 2; n <= 10; n++) if (cliArg('--wave') === '' + n) DIR.waveIdx = n - 1;
  }
  // `--weapon N` (1..6): the stand-in fights with that weapon, unlocked for the run.
  if (f === 22) {
    for (let n = 1; n <= WPN.WEAPON_COUNT; n++) {
      if (cliArg('--weapon') === '' + n) { WPN.unlock(n - 1); WPN.selectWeapon(n - 1); PB[7] = n - 1; }
    }
  }
  if (PB[7] >= 0 && WPN.currentWeapon() !== PB[7]) WPN.selectWeapon(PB[7]);
  if (GS.gameState !== 1) return false;
  // The boss: a picture the first time each phase and each special is seen.
  if (BOSS[0] > 0) {
    const tag = BOSS[0] * 10 + BOSS[2];
    if (BOSS[2] > 0 && BOSS[3] < 0.25 && PB[6] !== tag) { PB[6] = tag; takeScreenshot('shooter_boss_p' + BOSS[0] + '_s' + BOSS[2] + '.png'); }
    if ((f % 300) === 0) console.log('P2BOT   boss phase=' + BOSS[0] + ' hp=' + Math.round(bossHealth() * 100) + '% special=' + BOSS[2] + ' alive=' + countAlive());
  }
  if (GS.playerHP < PB[4] - 0.5) PB[3] = PB[3] + 1;
  GS.playerHP = PLAYER_HP_MAX; PB[4] = PLAYER_HP_MAX;
  GS.gameOver = false;
  WPN.addAmmo(WPN.currentWeapon(), 1);
  const pp = playerPosition();
  let best = -1, bestD = 1e9, alive = 0, mid = 0;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enAlive[i] === 0) continue;
    alive = alive + 1;
    if (enAIState[i] === AI_STRIKE_WIND || enAIState[i] === AI_STRIKE_HIT) mid = mid + 1;
    const d = Math.hypot(pp.x - enX[i], pp.z - enZ[i]);
    // only what it could see: alerted, or within 30 m with a clear line
    if ((enAware[i] === 1 || enLos[i] === 1) && d < 45 && d < bestD) { bestD = d; best = i; }
  }
  // The boss, while she lives, is what the stand-in looks at (so the pictures have her in them),
  // and one is taken every four seconds of the fight.
  if (BOSS[0] > 0 && BOSS[7] >= 0 && enAlive[BOSS[7]] === 1) {
    best = BOSS[7];
    bestD = Math.hypot(pp.x - enX[best], pp.z - enZ[best]);
    PB[8] = PB[8] + 1;
    if ((PB[8] % 240) === 120 && PB[8] < 2400) takeScreenshot('shooter_boss_t' + Math.floor(PB[8] / 240) + '.png');
  }
  if (alive > PB[1]) PB[1] = alive;
  if (mid > PB[2]) PB[2] = mid;
  let fire = false;
  // Phase 6 - the objectives. The stand-in does not walk, so it is PUT where the objective
  // is: inside the ring for a hold, seven metres from the nearest standing nest otherwise.
  let nestAim = -1;
  if (OBJ.type === 1 && !OBJ.done && !OBJ.inside) {
    movePlayerTo(W.HOLD_SITE[0] + 2.5, W.HOLD_SITE[1] + 1.2, W.HOLD_SITE[2] + 2.5);
  }
  if (OBJ.type === 2 && !OBJ.done) {
    let nd = 1e9;
    for (let i = 0; i < W.NEST_COUNT; i++) {
      if (!nestStanding(i)) continue;
      const d = Math.hypot(pp.x - W.NEST_X[i], pp.z - W.NEST_Z[i]);
      if (d < nd) { nd = d; nestAim = i; }
    }
    if (nestAim >= 0 && nd > 9) {
      PB[5] = nestAim;       // moved below: one setPlayerPosition call site for this branch
    }
  }
  if (PB[5] >= 0) {
    const ni = PB[5];
    PB[5] = -1;
    // Six metres from the nest on the side of the arena's middle: open ground more often
    // than not, and where a player would come from.
    const nl = Math.hypot(W.NEST_X[ni], W.NEST_Z[ni]);
    const ox = nl > 0.1 ? -W.NEST_X[ni] / nl * 6.0 : 6.0;
    const oz = nl > 0.1 ? -W.NEST_Z[ni] / nl * 6.0 : 0;
    movePlayerTo(W.NEST_X[ni] + ox, terrainHeightAt(W.NEST_X[ni] + ox, W.NEST_Z[ni] + oz) + 1.2, W.NEST_Z[ni] + oz);
    console.log('P2BOT   put at nest ' + ni + ' (' + W.NEST_X[ni].toFixed(1) + ',' + W.NEST_Z[ni].toFixed(1) + ')');
  }
  // A creature within eight metres comes first; otherwise the nest.
  if (best >= 0 && (nestAim < 0 || bestD < 8)) {
    shapeJoint(best, HSJ_NECK, TMP3);
    const dx = TMP3[0] - CAM[2], dy = TMP3[1] - 0.15 - CAM[3], dz = TMP3[2] - CAM[4];
    CAM[0] = Math.atan2(dx, -dz);
    CAM[1] = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    fire = true;
  } else if (nestAim >= 0) {
    const dx = W.NEST_X[nestAim] - CAM[2], dz = W.NEST_Z[nestAim] - CAM[4];
    const dy = terrainHeightAt(W.NEST_X[nestAim], W.NEST_Z[nestAim]) + 0.8 - CAM[3];
    CAM[0] = Math.atan2(dx, -dz);
    CAM[1] = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    fire = true;
  }
  if (DIR.waveIdx !== PB[0] || (f % 600) === 0) {
    PB[0] = DIR.waveIdx;
    console.log('P2BOT f=' + f + ' t=' + GS.runElapsed.toFixed(0) + ' wave=' + (DIR.waveIdx + 1)
      + ' spawned=' + DIR.waveSpawned + ' alive=' + alive + ' aware=' + DIR.awareCount
      + ' kills=' + SCORE.kills() + ' acc=' + Math.round(SCORE.accuracy() * 100)
      + ' maxAlive=' + PB[1] + ' maxMidAttack=' + PB[2] + ' hitsTaken=' + PB[3]
      + ' obj=' + OBJ.type + ':' + Math.round(OBJ.prog) + '/' + OBJ.need + ' elites=' + DIR.eliteCount
      + ' score=' + SCORE.score() + ' fps=' + getFPS().toFixed(0));
  }
  // The stragglers, when few are left: where each is and what it thinks.
  if ((f % 600) === 0 && alive > 0 && (alive <= 6 || OBJ.type === 2)) {
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (enAlive[i] === 0) continue;
      console.log('P2BOT   left: slot=' + i + ' kind=' + enKind[i] + ' st=' + enAIState[i]
        + ' aware=' + enAware[i] + ' los=' + enLos[i]
        + ' hp=' + enHP[i].toFixed(0) + (i === best ? ' TARGET' : '')
        + ' pos=' + enX[i].toFixed(1) + ',' + enY[i].toFixed(1) + ',' + enZ[i].toFixed(1)
        + ' goal=' + enLastX[i].toFixed(1) + ',' + enLastY[i].toFixed(1) + ',' + enLastZ[i].toFixed(1)
        + ' react=' + enReactT[i].toFixed(1) + ' search=' + enSearchT[i].toFixed(1)
        + ' v=' + Math.hypot(vxLast[i], vzLast[i]).toFixed(2)
        + ' player=' + pp.x.toFixed(1) + ',' + pp.y.toFixed(1) + ',' + pp.z.toFixed(1));
    }
  }
  if (DIR.gameWon || f > 70000) {
    console.log('P2BOT done won=' + (DIR.gameWon ? 1 : 0) + ' t=' + GS.runElapsed.toFixed(0)
      + ' kills=' + SCORE.kills() + ' maxAlive=' + PB[1] + ' maxMidAttack=' + PB[2]
      + ' hitsTaken=' + PB[3]);
    aitestDone = true;
  }
  return fire;
}

function p2Cam(): void {
  const f = testFrame;
  if (f >= 30 && f < 90) {
    CAM[2] = 0; CAM[3] = terrainHeightAt(0, 19) + 2.4; CAM[4] = 19.5;
    CAM[5] = 0; CAM[6] = terrainHeightAt(0, 12) + 1.4; CAM[7] = 12;
  }
}

/// The hit shapes, drawn over the creatures (shapes stage only).
function p2Draw(): void {
  if (testFrame < 31 || testFrame >= 90) return;
  for (let k = 0; k < KIND_COUNT; k++) {
    const sl = KIND_SLOT0[k];
    if (enAlive[sl] === 0) continue;
    shapeJoint(sl, HSJ_HEAD, TMP3);
    drawSphere(vec3(TMP3[0], TMP3[1], TMP3[2]), KIND_HEAD_R[k], { r: 255, g: 60, b: 60, a: 255 });
    shapeJoint(sl, HSJ_HIPS, TMP3);
    drawSphere(vec3(TMP3[0], TMP3[1], TMP3[2]), KIND_TORSO_R[k], { r: 60, g: 120, b: 255, a: 255 });
    shapeJoint(sl, HSJ_NECK, TMP3);
    drawSphere(vec3(TMP3[0], TMP3[1], TMP3[2]), KIND_TORSO_R[k], { r: 60, g: 200, b: 255, a: 255 });
    shapeJoint(sl, HSJ_HAND_L, TMP3);
    drawSphere(vec3(TMP3[0], TMP3[1], TMP3[2]), 0.08, { r: 255, g: 255, b: 60, a: 255 });
    shapeJoint(sl, HSJ_HAND_R, TMP3);
    drawSphere(vec3(TMP3[0], TMP3[1], TMP3[2]), 0.08, { r: 255, g: 255, b: 60, a: 255 });
    shapeJoint(sl, HSJ_FOOT_L, TMP3);
    drawSphere(vec3(TMP3[0], TMP3[1], TMP3[2]), 0.08, { r: 60, g: 255, b: 60, a: 255 });
    shapeJoint(sl, HSJ_FOOT_R, TMP3);
    drawSphere(vec3(TMP3[0], TMP3[1], TMP3[2]), 0.08, { r: 60, g: 255, b: 60, a: 255 });
    if (KIND_WEAK_R[k] > 0) {
      shapeJoint(sl, HSJ_WEAK, TMP3);
      drawSphere(vec3(TMP3[0], TMP3[1], TMP3[2]), KIND_WEAK_R[k], { r: 255, g: 60, b: 255, a: 255 });
    }
  }
}

// SH-054 — the frame body, extracted from the old blocking
// `while (!windowShouldClose())` loop so runGame() can drive it. On native
// runGame() IS that blocking loop (beginDrawing/update/endDrawing per
// iteration — identical to what stood here); on web it hands this function
// to the JS glue, which drives it from requestAnimationFrame, because a
// browser cannot run a blocking loop. Exits that used to `break` now call
// closeWindow() and return. Top-level function, not nested — Perry
// miscompiles nested functions (SH-025).
function gameFrame(_hostDt: number): void {
  // The self-test harnesses end the run by closing the window (native: the
  // runGame loop sees windowShouldClose and exits; web: the glue stops rAF).
  if (aitestDone || animDbgDone) { closeWindow(); return; }
  if (PERFTEST) {
    const nowTop = getTime();
    perfMsBegin = perfPrevEnd > 0 ? (nowTop - perfPrevEnd) * 1000 : 0;
    perfTTop = nowTop;
  }
  hitShapesBeginFrame();
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
  // Plan 3.5 - depth of field. A menu or an end screen throws the world behind it out of focus.
  // NOT while aiming: tried at aperture 0.02, focus 14 m, and the COMBATSHOT aim frame came out
  // blurred edge to edge, the target included. The engine's blur has no usable in-focus band at
  // gameplay distances yet, so aiming stays sharp. Only re-sent when it changes.
  if (!MOBILE && !WEB) {
    let ap = 0, fd = 14;
    if (SET.get(SET.SET_DOF) !== 0) {
      if (menuOpen() || GS.gameOver || DIR.gameWon) { ap = 0.07; fd = 2.5; }
    }
    if (Math.abs(ap - DOFS[0]) > 0.0005 || Math.abs(fd - DOFS[1]) > 0.05) {
      setDepthOfField(fd, ap);
      DOFS[0] = ap; DOFS[1] = fd;
    }
  }
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
  // Desktop and web: the HUD is authored for a 1080-unit-tall screen and scales
  // with the real height, so it is the same fraction of a 4K panel as of a
  // 1080p one. Within 10% of 1 it snaps to exactly 1 (no camera, crisp text).
  let uiScale = MOBILE ? swPx / 1000 : shPx / 1080;
  if (!MOBILE) {
    if (uiScale < 0.75) uiScale = 0.75;
    if (uiScale > 0.9 && uiScale < 1.1) uiScale = 1;
  }
  // Plan 4.3 - HUD SIZE: the player's factor on top (menus scale with it: one logical space).
  uiScale = uiScale * SET.get(SET.SET_HUD_SCALE);
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
  if (isKeyPressed(Key.F1)) GS.debugHud = !GS.debugHud;   // developer overlays on/off
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
    // Only OPENS the pause menu. With a menu already up, Esc / Start belong to it (back out of
    // a sub-screen, resume from the pause list): closing here would drop the player from the
    // settings straight into the fight.
    if (!menuOpen()) {
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
    mtTap(f, 45, Key.DOWN); mtTap(f, 52, Key.DOWN); mtTap(f, 60, Key.ENTER);
    if (f === 70) menuTestLog = menuTestLog + 'after ENTER on SETTINGS row: menu=' + currentMenu() + ' (want 2=SETTINGS) tab=' + menuTab() + ' (want 0)\n';
    // Phase 4: E twice -> the BINDINGS tab; down x4 -> JUMP; Enter starts a capture; J binds.
    mtTap(f, 75, Key.E); mtTap(f, 82, Key.E);
    if (f === 90) menuTestLog = menuTestLog + 'after E,E: tab=' + menuTab() + ' (want 2=BINDINGS)\n';
    mtTap(f, 92, Key.DOWN); mtTap(f, 99, Key.DOWN); mtTap(f, 106, Key.DOWN); mtTap(f, 113, Key.DOWN);
    mtTap(f, 120, Key.ENTER);
    if (f === 128) menuTestLog = menuTestLog + 'capture started: row=' + menuRow() + ' (want 4) capturing=' + (BND.capturing() ? 1 : 0) + ' (want 1)\n';
    mtTap(f, 130, Key.J);
    if (f === 138) menuTestLog = menuTestLog + 'after J: jump key=' + BND.kbCode(BND.ACT_JUMP) + ' (want 74) capturing=' + (BND.capturing() ? 1 : 0) + ' (want 0)\n';
    // Bind FIRE's key onto JUMP's old one the other way: rebinding SPRINT to J must SWAP.
    mtTap(f, 140, Key.DOWN); mtTap(f, 147, Key.DOWN); mtTap(f, 154, Key.DOWN);   // -> SPRINT
    mtTap(f, 161, Key.ENTER); mtTap(f, 170, Key.J);
    if (f === 178) menuTestLog = menuTestLog + 'after J on SPRINT: sprint=' + BND.kbCode(BND.ACT_SPRINT) + ' (want 74) jump=' + BND.kbCode(BND.ACT_JUMP) + ' (want 280, swapped)\n';
    // ESC must go BACK to MAIN - not close the menu, and not kill the process.
    mtTap(f, 180, Key.ESCAPE);
    if (f === 190) menuTestLog = menuTestLog + 'after ESC in settings: menu=' + currentMenu() + ' (want 4=MAIN, alive=yes)\n';
    // back() resets the selection to row 0 = PLAY.
    mtTap(f, 200, Key.ENTER);
    if (f === 215) {
      menuTestLog = menuTestLog + 'after ENTER on PLAY: menu=' + currentMenu()
        + ' (want 0=NONE) gameState=' + GS.gameState + ' (want 1)'
        + ' cursorLocked=' + (cursorLocked ? 1 : 0) + ' (want 1)\n';
    }
    // In the run: the rebound sprint key (J) must sprint, Shift (now jump) must jump.
    if (f === 230) injectKeyDown(Key.J);
    if (f === 236) menuTestLog = menuTestLog + 'J held in play: sprintDown=' + (input.sprintDown ? 1 : 0) + ' (want 1)\n';
    if (f === 238) injectKeyUp(Key.J);
    if (f === 240) injectKeyDown(Key.LEFT_SHIFT);
    if (f === 241 || f === 242) { if (input.jump) mtJump = 1; }
    if (f === 244) { injectKeyUp(Key.LEFT_SHIFT); menuTestLog = menuTestLog + 'Shift pressed in play: jump=' + mtJump + ' (want 1)\n'; }
    // The run ends: the results screen must open by itself, and its first row must restart.
    if (f === 250) { GS.playerHP = 0; GS.gameOver = true; }
    if (f === 420) menuTestLog = menuTestLog + 'after death + wait: menu=' + currentMenu() + ' (want 6=RESULTS)\n';
    mtTap(f, 425, Key.ENTER);
    if (f === 440) menuTestLog = menuTestLog + 'after ENTER on TRY AGAIN: menu=' + currentMenu() + ' (want 0) gameOver=' + (GS.gameOver ? 1 : 0) + ' (want 0) hp=' + GS.playerHP + ' (want 100)\n';
    // Phase 6 - the tutorial: put it on its DODGE step; the dodge key answers it, the next step
    // follows, and Backspace skips what is left.
    if (f === 442) TUTOR.debugStep(3);
    if (f === 448) injectKeyDown(BND.kbCode(BND.ACT_DODGE));
    if (f === 452) injectKeyUp(BND.kbCode(BND.ACT_DODGE));
    if (f === 458) menuTestLog = menuTestLog + 'tutorial, dodge pressed: step=' + TUTOR.tutorialStep() + ' (want 3) answered=' + (TUTOR.tutorialAnswered() ? 1 : 0) + ' (want 1)\n';
    if (f === 520) menuTestLog = menuTestLog + 'tutorial, a moment later: step=' + TUTOR.tutorialStep() + ' (want 4)\n';
    mtTap(f, 522, Key.BACKSPACE);
    if (f === 530) menuTestLog = menuTestLog + 'tutorial, after Backspace: active=' + (TUTOR.tutorialActive() ? 1 : 0) + ' (want 0)\n';
    // Pause -> MAIN MENU (row 4) -> the title, with no run behind it.
    mtTap(f, 540, Key.ESCAPE);
    if (f === 548) menuTestLog = menuTestLog + 'after ESC in play: menu=' + currentMenu() + ' (want 1=PAUSE)\n';
    mtTap(f, 550, Key.DOWN); mtTap(f, 557, Key.DOWN); mtTap(f, 564, Key.DOWN); mtTap(f, 571, Key.DOWN);
    mtTap(f, 580, Key.ENTER);
    if (f === 590) menuTestLog = menuTestLog + 'after MAIN MENU: menu=' + currentMenu() + ' (want 4) gameState=' + GS.gameState + ' (want 0)\n';
    // Phase 6 - the title's new rows: ARMOURY is row 3 (E steps to the next weapon, the fifth
    // row is BACK), SERVICE RECORD row 4 (Escape leaves it). Nothing is bought.
    mtTap(f, 595, Key.DOWN); mtTap(f, 602, Key.DOWN); mtTap(f, 609, Key.DOWN); mtTap(f, 616, Key.ENTER);
    if (f === 624) menuTestLog = menuTestLog + 'after ENTER on ARMOURY: menu=' + currentMenu() + ' (want 7)\n';
    mtTap(f, 626, Key.E);
    if (f === 632) menuTestLog = menuTestLog + 'after E in the armoury: weapon=' + armoryWeapon() + ' (want 1)\n';
    mtTap(f, 634, Key.DOWN); mtTap(f, 641, Key.DOWN); mtTap(f, 648, Key.DOWN); mtTap(f, 655, Key.DOWN);
    mtTap(f, 662, Key.ENTER);
    if (f === 670) menuTestLog = menuTestLog + 'after ENTER on BACK: menu=' + currentMenu() + ' (want 4)\n';
    mtTap(f, 672, Key.DOWN); mtTap(f, 679, Key.DOWN); mtTap(f, 686, Key.DOWN); mtTap(f, 693, Key.DOWN);
    mtTap(f, 700, Key.ENTER);
    if (f === 708) menuTestLog = menuTestLog + 'after ENTER on SERVICE RECORD: menu=' + currentMenu() + ' (want 8)\n';
    mtTap(f, 710, Key.ESCAPE);
    if (f === 720) {
      menuTestLog = menuTestLog + 'after ESC in the record: menu=' + currentMenu() + ' (want 4)\n';
      // Leave the player's bindings as they were found.
      BND.resetBinds();
      SET.saveSettings();
      writeFile('tools/.testout/menutest.txt', menuTestLog);
      console.log(menuTestLog);
      menuTestDone = true;
      closeWindow();
      return;
    }
  }
  if (UISHOT) {
    const f = testFrame;
    const STEP = 45;
    if (f >= 40 && f < 40 + 14 * STEP) {
      const st = Math.floor((f - 40) / STEP);
      const ph = (f - 40) % STEP;
      if (ph === 0) {
        STR.setLanguage(0);
        if (st === 0) openMain();
        else if (st >= 1 && st <= 6) { openSettingsTab(st - 1); selectRow(st === 3 ? 5 : 1); }
        else if (st === 7) openLevels();
        else if (st === 8) openCredits();
        else if (st === 9) { STR.setLanguage(1); openMain(); }
        else if (st === 10) { STR.setLanguage(1); openSettingsTab(3); selectRow(3); }
        else if (st === 11) { STR.setLanguage(2); openLevels(); selectRow(2); }
        else if (st === 12) { openArmory(0); selectRow(1); }
        else if (st === 13) openRecord();
      }
      if (ph === STEP - 8) takeScreenshot('shooter_ui_' + (st < 10 ? '0' : '') + st + '_' + UISHOT_NAMES[st] + '.png');
    }
    const g0 = 40 + 14 * STEP;
    if (f === g0) { STR.setLanguage(0); openMain(); startRun(); cursorLocked = true; }
    if (f > g0 && f < g0 + 500) GS.playerHP = PLAYER_HP_MAX;
    if (f > g0 + 640) GS.playerHP = PLAYER_HP_MAX;
    if (f === g0 + 300) takeScreenshot('shooter_ui_14_hud.png');
    if (f >= g0 + 310 && f < g0 + 340) {
      GS.playerHP = 18; GS.lastHitT = 1.1; GS.lastHitAngle = 2.2; GS.damageFlashT = 0.3;
      SET.set(SET.SET_CAPTIONS, 1);
    }
    if (f === g0 + 338) takeScreenshot('shooter_ui_15_hud_hit.png');
    if (f === g0 + 345) { SET.set(SET.SET_CAPTIONS, 0); uiShotPad = true; UIK.setPalette(1); WPN.beginReload(); GS.hitMarkT = 0.2; GS.hitMarkCrit = 1; }
    if (f === g0 + 362) takeScreenshot('shooter_ui_16_hud_pad_reload.png');
    if (f === g0 + 370) { uiShotPad = false; UIK.setPalette(0); GS.waveBonusT = 3.4; GS.waveBonus = 420; GS.unlockBannerT = 4.0; }
    if (f === g0 + 395) takeScreenshot('shooter_ui_17_hud_banners.png');
    if (f === g0 + 400) { GS.waveBonusT = 0; GS.unlockBannerT = 0; openPause(); }
    if (f === g0 + 440) takeScreenshot('shooter_ui_18_pause.png');
    if (f === g0 + 450) { DIR.gameWon = true; setResultsTime(GS.runElapsed + 187); openResults(true, 3, 3, true); }
    if (f === g0 + 540) takeScreenshot('shooter_ui_19_results_won.png');
    if (f === g0 + 550) { DIR.gameWon = false; GS.gameOver = true; openResults(false, 2, 3, false); }
    if (f === g0 + 620) takeScreenshot('shooter_ui_20_results_died.png');
    // Phase 6: the tutorial card, a hint, an elite, and the arena's objective waves.
    if (f === g0 + 640) {
      DIR.gameWon = false; GS.gameOver = false; closeMenu(); resetRun(); startRun(); cursorLocked = true;
      DIR.waveBreakTimer = 9999;
      TUTOR.debugStep(1);
    }
    if (f === g0 + 680) takeScreenshot('shooter_ui_21_tutorial.png');
    if (f === g0 + 685) { TUTOR.setTutorEnabled(false); resetRun(); startRun(); TUTOR.debugHint(1); DIR.waveIdx = 5; DIR.waveBreakTimer = 0.05; }
    if (f === g0 + 1000) {
      // Stand the first creature alive in front of the camera as an elite.
      for (let i = 0; i < MAX_ENEMIES; i++) {
        if (enAlive[i] === 0) continue;
        const ppE = playerPosition();
        enElite[i] = 1;
        enX[i] = ppE.x + Math.sin(CAM[0]) * 4.0; enZ[i] = ppE.z - Math.cos(CAM[0]) * 4.0;
        break;
      }
    }
    if (f === g0 + 1008) takeScreenshot('shooter_ui_22_elite.png');
    if (f > g0 + 1040 && f < g0 + 2400) {
      // Walk the objective waves of this arena: jump to each, give it time to start, capture.
      const q = f - (g0 + 1041);
      const slot = Math.floor(q / 560);
      const ph = q % 560;
      let found = -1, seen = 0;
      for (let wv = 0; wv < wavePlan.length; wv++) {
        if (W.WAVE_TYPE[wv] === W.WAVE_KILL) continue;
        if (seen === slot) { found = wv; break; }
        seen = seen + 1;
      }
      if (found < 0) { console.log('UISHOT done'); closeWindow(); return; }
      if (ph === 0) { resetRun(); startRun(); DIR.waveIdx = found; DIR.waveBreakTimer = 0.05; }
      const isHold = W.WAVE_TYPE[found] === W.WAVE_HOLD;
      let mvX = 0, mvY = 0, mvZ = 0, mv = 0;
      if (ph === 200 && isHold) {
        mvX = W.HOLD_SITE[0] + 9.5; mvY = W.HOLD_SITE[1] + 1.2; mvZ = W.HOLD_SITE[2]; mv = 1;
      }
      if (ph === 200 && !isHold) {
        mvX = W.NEST_X[1] + 6.5; mvY = W.NEST_Y[1] + 1.2; mvZ = W.NEST_Z[1]; mv = 1;
      }
      if (ph === 335 && isHold) {
        mvX = W.HOLD_SITE[0] + 3.0; mvY = W.HOLD_SITE[1] + 1.2; mvZ = W.HOLD_SITE[2] + 2.5; mv = 1;
      }
      if (mv === 1) {
        movePlayerTo(mvX, mvY, mvZ);
        CAM[0] = -Math.PI / 2; CAM[1] = 0.16;
      }
      if (ph === 330) takeScreenshot('shooter_ui_' + (23 + slot) + '_objective.png');
      if (ph === 520) takeScreenshot('shooter_ui_' + (25 + slot) + '_objective_b.png');
    }
    if (f === g0 + 2400) { console.log('UISHOT done'); closeWindow(); return; }
  }
  if (menuOpen()) {
    const act = updateMenu(dtReal, sw, sh, uiScale);
    if (act === 1) {                      // ACT_RESUME
      if (cursorLocked) disableCursor();
    } else if (act === 2) {               // ACT_RESTART
      resetRun();
      endRunT = 0;
      cursorLocked = true;
      disableCursor();
    } else if (act === 6) {               // ACT_TITLE - leave the run for the front door
      resetRun();
      endRunT = 0;
      GS.gameState = 0;
      stopMusic(musicCalm);
      if (HAS_STEMS) stopMusic(musicCombat);
      playMusic(musicMenu);
      openMain();
      enableCursor();
      cursorLocked = false;
    } else if (act === 3) {               // ACT_QUIT
      closeWindow();
      return;
    } else if (act === 5) {               // ACT_PLAY — start the run
      startRun();
      cursorLocked = true;
      disableCursor();
    } else if (act === 4) {               // ACT_LEVEL — an arena was chosen
      // The whole world (colliders, heightfield, grass instances, GI proxies,
      // the forest's trunk bodies) is built once at startup from module-level
      // tables, so the arena is applied by relaunching the game into it: the
      // choice is already in level.txt (selectArena), and restartApp() fires a
      // few frames from now, once the LOADING cover has actually been drawn.
      // Until 2026-11 this just told the player to restart the game.
      GS.levelChangeArena = W.PICKED.index;
      if (W.PICKED.index === W.ARENA_INDEX) {
        GS.levelChangeMode = 3;
        GS.levelChangeT = 2.5;
      } else {
        GS.levelChangeMode = 1;
        GS.levelChangeT = 9999;
        arenaRestartIn = 3;
        SET.saveSettings();
      }
    }
  }
  // Plan 4.2 - the end of a run. The verdict fades up over the scene (hud.ts drawOverlays),
  // and a moment later the results screen opens: late enough that a death is watched and a
  // weapon unlock is read, soon enough that nobody wonders what to press.
  if (GS.gameState === 1 && (GS.gameOver || DIR.gameWon)) {
    if (!menuOpen() && endRunT >= 0) {
      endRunT = endRunT + dtReal;
      if (endRunT > (DIR.gameWon ? 3.4 : 2.3) && !UISHOT && !P2BOT && !P2TEST && !PLAYERSHOT && !COMBATSHOT) {
        setResultsTime(GS.runElapsed);
        openResults(DIR.gameWon, DIR.waveIdx + 1, wavePlan.length,
                    SCORE.score() > 0 && SCORE.score() >= SET.bestScore(W.ARENA_INDEX));
        enableCursor();
        endRunT = -1;                     // opened: do not open it again for this run
      }
    }
  } else {
    endRunT = 0;
  }
  if (arenaRestartIn > 0) {
    arenaRestartIn = arenaRestartIn - 1;
    if (arenaRestartIn === 0) {
      // Desktop: does not return. Web: returns true and the page reloads after
      // this frame (the cover stays up). Phones, tablets and TV boxes cannot
      // relaunch an app from inside it: say so instead.
      if (!restartApp()) {
        GS.levelChangeMode = 2;
        GS.levelChangeT = 6.0;
      }
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
  // COMBATSHOT: shoulder-aim for the last stretch, so the final capture is a close-up of the
  // player, the weapon in hand and whatever is being shot (the orbit camera pulls in to 2.6 m).
  if (COMBATSHOT && testFrame >= 160) input.aimDown = true;
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
  if (P2TEST) p2Early(input);
  if (PLAYERSHOT) {
    if (testFrame === 20 && GS.gameState === 0) { startRun(); cursorLocked = true; }
    DIR.waveBreakTimer = 9999;
    const psI = Math.floor((testFrame - 30) / PSHOT_FRAMES);
    if (psI < 24) GS.playerHP = 100;
    if (psI >= 19 && psI < PSHOT_COUNT) {
      const act = psI - 19;
      const fr = (testFrame - 30) % PSHOT_FRAMES;
      if (WPN.currentWeapon() !== 0) WPN.selectWeapon(0);
      CAM[0] = 0; CAM[1] = 0.25;
      input.moveX = 0; input.moveZ = 0; input.aimDown = false;
      input.crouchDown = false; input.sprintDown = false;
      if (act === 0 && fr === 0) setPlayerPosition(spawnPos);   // back into the open
      if (act === 0) { if (fr >= 26) input.moveZ = -1; input.dodgePressed = fr === 32; }
      if (act === 1) {
        if (fr >= 2 && fr < 9) { input.fireDown = true; input.firePressed = fr === 2; }
        input.reloadPressed = fr === 20;
      }
      if (act === 2 && fr === 36) { GS.lastHitAngle = 0; GS.lastHitT = 1.4; }
      if (act === 3) { if (fr >= 16) input.moveZ = -1; input.dodgePressed = fr === 22; }
      if (act === 4) { input.moveX = -1; input.aimDown = true; }
      if (act === 5 && fr === 15) { GS.lastHitAngle = 0; GS.playerHP = 0; GS.gameOver = true; }
    } else if (psI >= 0 && psI < 19) {
      let row = psI;
      if (psI >= 13) {
        const wS = 1 + Math.floor((psI - 13) / 2);
        row = ((psI - 13) % 2) === 0 ? 3 : 5;
        WPN.unlock(wS);
        if (WPN.currentWeapon() !== wS) WPN.selectWeapon(wS);
      }
      const o = row * PSHOT_N;
      CAM[0] = 0; CAM[1] = PSHOTS[o];
      input.moveZ = PSHOTS[o + 1]; input.moveX = PSHOTS[o + 2];
      input.aimDown = PSHOTS[o + 3] !== 0;
      input.crouchDown = PSHOTS[o + 4] !== 0;
      input.sprintDown = PSHOTS[o + 5] !== 0;
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
    updateCameraLook(input.lookX, input.lookY, input.padActive,
      input.moveX !== 0 || input.moveZ !== 0);
  }

  const playing = GS.gameState === 1 && !GS.gameOver && !DIR.gameWon && !menuOpen();

  // Restart on R when the run has ended (died or won); otherwise R reloads.
  // Reload is TIMED now (SH-028) — you can be punished for it.
  if (input.reloadPressed) {
    if (GS.gameOver || DIR.gameWon) {
      // R still restarts from the end of a run, results screen or not.
      if (currentMenu() === MENU_RESULTS) closeMenu();
      resetRun();
      endRunT = 0;
      if (cursorLocked) disableCursor();
    }
    else if (playing && !WPN.isReloading()) {
      const before = WPN.isReloading();
      WPN.beginReload();
      if (!before && WPN.isReloading()) MIX.reloadStart();
    }
  }
  // Weapon selection. Number keys pick directly; the touch/pad button cycles.
  // (Plan 4.3: these are bindings now - number keys and the D-pad by default.)
  if (input.weaponSlot > 0 && playing) WPN.selectWeapon(input.weaponSlot - 1);
  if (input.swapWeapon) WPN.nextWeapon();
  if (playing && input.shoulderPressed) swapShoulder();
  // Plan 2.7 - the kit: a rifle-butt strike and a grenade. Neither through a roll or a vault.
  if (playing && input.meleePressed && !isDodging() && !isVaulting()) startMelee();
  if (playing && input.grenadePressed && !isDodging() && !isVaulting()) throwGrenade();

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
    setCarryMul(WPN.carryMul());
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
    // Phase 3.3: the shoreline is wherever the ground dips under the water (the banks are no
    // longer a straight trench), so "in the river" is asked of the terrain, inside the water
    // volume widened by the 2.5 m the drawn surface overhangs it.
    const inRiver = Math.abs(pp.x - ENV.WATER_CX) < ENV.WATER_W * 0.5 + 2.5 &&
                    Math.abs(pp.z - ENV.WATER_CZ) < ENV.WATER_D * 0.5 + 2.5 &&
                    terrainHeightAt(pp.x, pp.z) < ENV.WATER_Y - 0.04;
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
      // What is underfoot. Until 2026-11 this was `inRiver ? 2 : 0`, so the dirt
      // samples never played and the house floor sounded like a meadow.
      //   water    - in the river band
      //   concrete - inside the house footprint (either floor)
      //   dirt     - the damp bank the terrain shader paints brown beside the
      //              river, or a cell the editor painted with a dirt/mud/rock layer
      //   grass    - everything else
      let surface = 0;
      if (inRiver) {
        surface = 2;
      } else if (BLDG_HX > 0 && Math.abs(pp.x - BLDG_CX) < BLDG_HX
                             && Math.abs(pp.z - BLDG_CZ) < BLDG_HZ) {
        surface = 3;
      } else if (Math.abs(pp.x - ENV.WATER_CX) < ENV.WATER_W * 0.5 + 4.5
                 && Math.abs(pp.z - ENV.WATER_CZ) < ENV.WATER_D * 0.5 + 4.5) {
        surface = 1;
      } else if (paintedHardGround(pp.x, pp.z)) {
        surface = 1;
      }
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
    // SH-052 — the river emitter slides along its bank to stay abreast of the
    // player; the crawl-bed pool follows the nearest moving enemies (it goes
    // silent by itself when nothing qualifies, menus included).
    // SH-052d — the orbit/flyby probe wants a SINGLE source, so the river (and
    // the enemyless crawl pool) stand down in those two modes; `river` mode
    // keeps the river and skips the probe, so each test hears one thing.
    if (!(AUDIOTEST && audioTestMode !== 0)) MIX.updateRiverAmbience(pp.x, pp.z);
    MIX.updateCreatureLoops(pp.x, pp.z);
  }

  // Smooth orbit camera follow after the physics step: occlusion-aware
  // (probe fan vs. static bodies + analytic canopy cylinders) - camera.ts.
  updateCameraOrbit(dt, physics);
  if (P2TEST) p2Cam();
  if (PLAYERSHOT) {
    const psI = Math.floor((testFrame - 30) / PSHOT_FRAMES);
    if (psI >= 0 && psI < PSHOT_COUNT) {
      let view = psI === 23 ? 1 : 0;
      if (psI < 19) view = PSHOTS[(psI < 13 ? psI : (((psI - 13) % 2) === 0 ? 3 : 5)) * PSHOT_N + 6];
      const ppS = playerPosition();
      // camera yaw is pinned at 0: the Trooper faces -Z, its right is +X
      let ox = 3.2, oz = 0;
      if (view === 1) { ox = 2.0; oz = -2.6; }
      if (view === 2) { ox = 0.6; oz = 3.0; }
      if (view === 3) { ox = -3.2; oz = 0; }
      CAM[2] = ppS.x + ox; CAM[3] = ppS.y + 0.55; CAM[4] = ppS.z + oz;
      CAM[5] = ppS.x; CAM[6] = ppS.y + 0.15; CAM[7] = ppS.z;
      if (((testFrame - 30) % PSHOT_FRAMES) === 44) {
        takeScreenshot('shooter_player_' + (psI < 10 ? '0' : '') + psI + '.png');
      }
    } else if (psI >= PSHOT_COUNT) {
      console.log('PLAYERSHOT done');
      closeWindow();
      return;
    }
  }
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
  TUTOR.updateTutor(dt, playing);

  // testFrame is incremented above the input block so the mouse-settle
  // grace period uses the same counter.
  let forceFire = false;
  if (P2TEST) forceFire = p2Late();
  if (P2BOT) forceFire = p2Bot();
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
        const slot = KIND_SLOT0[1 + s];            // stalker, ravager
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
          vec3(enX[slot], enY[slot] + KIND_BOX_Y[k], enZ[slot]), true);
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
    // Captures (macOS/Linux: takeScreenshot works; on Windows use the external shot tools).
    if (testFrame === 70 || testFrame === 110 || testFrame === 150 || testFrame === 230) {
      takeScreenshot('shooter_combat_f' + testFrame + '.png');
    }
    if (testFrame === 260) {
      console.log('COMBATSHOT done  score=' + SCORE.score()
        + ' kills=' + SCORE.kills()
        + ' shots=' + SCORE.shotsFired()
        + ' hits=' + SCORE.shotsHit()
        + ' fps=' + getFPS().toFixed(1));
      closeWindow();
      return;
    }
  }
  if (SCENESHOT) {
    if (testFrame === 20 && GS.gameState === 0) { startRun(); cursorLocked = true; }
    GS.playerHP = PLAYER_HP_MAX;
    DIR.waveBreakTimer = 9999;
    const nViews = SCENE_VIEWS.length / 5;
    const vi = Math.floor((testFrame - 30) / 50);
    if (testFrame >= 30 && vi < nViews) {
      const ph = (testFrame - 30) % 50;
      const vx = SCENE_VIEWS[vi * 5], vz = SCENE_VIEWS[vi * 5 + 1];
      const vy = SCENE_VIEWS[vi * 5 + 4];
      if (ph === 0) setPlayerPosition(vec3(vx, (vy < 0 ? terrainHeightAt(vx, vz) : vy) + 1.2, vz));
      CAM[0] = SCENE_VIEWS[vi * 5 + 2];
      CAM[1] = SCENE_VIEWS[vi * 5 + 3];
      if (ph === 45) takeScreenshot('shooter_scene_' + vi + '.png');
    }
    if (testFrame >= 30 && vi >= nViews) {
      console.log('SCENESHOT done fps=' + getFPS().toFixed(1));
      closeWindow();
      return;
    }
  }
  if (SELFTEST) {
    DIR.waveBreakTimer = 9999;
    if (testFrame < 5) { CAM[0] = 0; CAM[1] = 0.35; CAM[8] = 0; }
    if (testFrame === 5) {
      // Manually spawn ONE dretch off to the side, stays idle.
      enX[0] = -6; enY[0] = 0; enZ[0] = -6;
      enHP[0] = 3; enAlive[0] = 1; enAttackCD[0] = 999;
      setBodyPosition(enBody[0], vec3(-6, KIND_BOX_Y[0], -6), true);
    }
    if (testFrame === 30)  { screenshotSeq++; takeScreenshot('shooter_selftest_' + screenshotSeq + '_t0_5s.png'); }
    if (testFrame === 180) { screenshotSeq++; takeScreenshot('shooter_selftest_' + screenshotSeq + '_t3_0s.png'); }
    if (testFrame === 185) { closeWindow(); return; }
  }

  // Fire + player projectile update (SH-028/033/042, M7) — combat.ts. The
  // COMBATSHOT harness's forceFire goes through the same path.
  updateCombat(dt, playing, cursorLocked, input.fireDown, input.firePressed, forceFire);
  updateEnemyProjectiles(dt, playing);
  if (GS.muzzleFlashT > 0) GS.muzzleFlashT = GS.muzzleFlashT - dt;
  if (GS.damageFlashT > 0) GS.damageFlashT = GS.damageFlashT - dt;
  if (GS.lastHitT > 0) GS.lastHitT = GS.lastHitT - dtReal;
  if (GS.hitMarkT > 0) GS.hitMarkT = GS.hitMarkT - dtReal;
  if (GS.healFlashT > 0) GS.healFlashT = GS.healFlashT - dtReal;
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

  // ---- AUDIOTEST harness (SH-052d) — HEAR the spatialisation, don't infer it.
  // Placed right after the listener is set, so the probe reads the exact same
  // CAM this frame's mixer got. Waves are suppressed in every mode so the test
  // source stands alone; the player stays fully controllable (walk and turn —
  // the orbit re-centres on you, so it keeps circling). Dormant unless
  // --audiotest is passed; same contract as the other harnesses.
  if (AUDIOTEST) {
    GS.playerHP = PLAYER_HP_MAX;      // immortal observer
    GS.gameOver = false;
    DIR.waveBreakTimer = 9999;        // no waves — only the probe / the river
    if (testFrame === 20 && GS.gameState === 0) { startRun(); cursorLocked = true; }
    if (GS.gameState === 1) {
      if (audioTestMode !== 0) {
        if (audioTestT0 < 0) { audioTestT0 = getTime(); MIX.startAudioProbe(); }
        audioTestStatus = MIX.updateAudioProbe(
          audioTestMode, getTime() - audioTestT0, CAM[2], CAM[3], CAM[4]);
      } else {
        // river mode: distance to the nearest bank point of any water volume.
        const ppA = playerPosition();
        let best = 1e9;
        for (let i = 0; i < W.WATER_COUNT; i++) {
          let ex = ppA.x;
          const x0 = W.WATER_CX[i] - W.WATER_SX[i] * 0.5;
          const x1 = W.WATER_CX[i] + W.WATER_SX[i] * 0.5;
          if (ex < x0) ex = x0; if (ex > x1) ex = x1;
          let ez = ppA.z;
          const z0 = W.WATER_CZ[i] - W.WATER_SZ[i] * 0.5;
          const z1 = W.WATER_CZ[i] + W.WATER_SZ[i] * 0.5;
          if (ez < z0) ez = z0; if (ez > z1) ez = z1;
          const d = Math.sqrt((ppA.x - ex) * (ppA.x - ex) + (ppA.z - ez) * (ppA.z - ez));
          if (d < best) best = d;
        }
        audioTestStatus = 'river   dist-to-nearest-bank ' + best.toFixed(1) + ' m';
      }
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
  // Only in the arena that HAS that house: until slice D these three panes hung in the air at
  // the same coordinates in every other arena.
  if (ENV.matGlass > 0 && W.WORLD_ID === 'arena_02') {
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
  // Phase 3.1 / 3.2: ferns, shrubs, reeds, flowers, weeds, and the far tree line.
  drawFlora();
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
      // Props. Small ones are skipped beyond PROP_DRAW_DIST and behind the camera: the
      // dressing adds a few hundred of them and most are never in view.
      const pdx = W.MESH_X[i] - CAM[2], pdz = W.MESH_Z[i] - CAM[4];
      const pd2 = pdx * pdx + pdz * pdz;
      const big = W.MESH_COLLIDER_HX[i] + W.MESH_COLLIDER_HZ[i] > 1.2 || W.MESH_COLLIDER[i] === 1;
      if (!big && pd2 > PROP_DRAW_DIST * PROP_DRAW_DIST) continue;
      if (pd2 > 36 && pdx * (CAM[5] - CAM[2]) + pdz * (CAM[7] - CAM[4]) < -0.35 * Math.sqrt(pd2) *
          Math.sqrt((CAM[5] - CAM[2]) * (CAM[5] - CAM[2]) + (CAM[7] - CAM[4]) * (CAM[7] - CAM[4]))) continue;
      if (W.MESH_YAW[i] > -999) {
        drawModelRotated(meshModelHandles[mi], MESH_POS[i], W.MESH_SCALE[i], W.MESH_YAW[i], WHITE);
      } else {
        drawModel(meshModelHandles[mi], MESH_POS[i], W.MESH_SCALE[i], WHITE);
      }
    }
  }
  // (Water rendering moved up — Phase 9 drawMeshWithMaterial replaces
  // the old cube-grid loop that used to live here.)
  // Point lights from the world file — static scene lights.
  if (ENV.matMuzzleFlash > 0) {
    for (let i = 0; i < WL_N[0]; i++) {
      drawMeshWithMaterial(ENV.matMuzzleFlash, ENV.matMuzzleFlashMesh,
        vec3(WL_X[i], WL_Y[i], WL_Z[i]), 0.34, { r: 255, g: 238, b: 205, a: 210 });
    }
  }
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
    // Squared to the camera: aiming or firing (and for half a second after), the body faces
    // where the gun points and the legs strafe under it. Otherwise it turns to face its travel.
    if (playing && (input.aimDown || input.fireDown) && !isSprinting()) PLRIG[2] = 0.5;
    else if (PLRIG[2] > 0) PLRIG[2] = PLRIG[2] - dt;
    const squared = playing && PLRIG[2] > 0;
    setSquared(squared);
    const rolling = playing && isDodging();
    let faceTarget = 0;
    let turnRate = PLAYER_TURN_RATE;
    if (rolling) {
      // A roll goes head first: face the dodge direction (camera-relative), quickly.
      const rf = dodgeDirX() * Math.sin(camYaw) - dodgeDirZ() * Math.cos(camYaw);
      const rr = dodgeDirX() * Math.cos(camYaw) + dodgeDirZ() * Math.sin(camYaw);
      faceTarget = Math.atan2(rr, rf);
      turnRate = 40;
    } else if (playing && !squared && (input.moveX !== 0 || input.moveZ !== 0)) {
      faceTarget = Math.atan2(input.moveX, -input.moveZ);
    }
    // Ease along the SHORTEST arc, so S+A -> S+D turns the near way, not 270°.
    let dOff = faceTarget - playerFaceOffset;
    while (dOff > Math.PI) dOff = dOff - Math.PI * 2;
    while (dOff < -Math.PI) dOff = dOff + Math.PI * 2;
    playerFaceOffset = playerFaceOffset + dOff * (1 - Math.exp(-turnRate * dt));

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
    const moving = spd > 0.4;
    const deadNow = GS.gameOver && GS.playerHP <= 0;
    if (!deadNow) {
      PLRIG[3] = -1;
    } else if (PLRIG[3] < 0) {
      // Fall away from the blow: hit from the front goes over backward.
      const fromFront = Math.abs(GS.lastHitAngle) < Math.PI / 2;
      PLRIG[3] = fromFront ? PLAYER_ANIM_DEATH_BACK : PLAYER_ANIM_DEATH_FRONT;
    }
    // Whole-body moves: the clip owns every joint, nothing is layered or pulled on top.
    const freeBody = deadNow || rolling;

    // One base clip, chosen by what the player is DOING. Playback rate = ground speed / the
    // speed the clip was authored to travel at, which is what plants the feet.
    let wantClip = PLAYER_ANIM_IDLE;
    let rate = 1;
    let loopClip = true;
    let fade = 0.15;
    let wantL = 0;
    let wantR = 0;
    if (deadNow) {
      wantClip = PLRIG[3]; loopClip = false; fade = 0.08;
    } else if (rolling) {
      wantClip = PLAYER_ANIM_ROLL; loopClip = false; fade = 0.06;
      rate = PLAYER_ROLL_DUR / dodgeDuration();
    } else if (isVaulting()) {
      // Plan 2.7 - over an obstacle with the knees tucked. There is no vault clip (nor a jump
      // clip, still owed from plan 1.1): the crouch is the nearest pose the set has.
      wantClip = PLAYER_ANIM_CROUCH; fade = 0.07;
    } else if (crouching) {
      wantClip = moving ? PLAYER_ANIM_CROUCH_FWD : PLAYER_ANIM_CROUCH;
      if (moving) rate = Math.max(0.5, Math.min(2.4, spd / ANIM_CROUCH_SPEED));
    } else if (moving && squared && !sprinting) {
      // The strafe blend (plan 1.2): forward or back as the base clip, the two sidesteps mixed
      // in by how sideways the input is. All four are phase-locked by the engine (EN-064).
      let mf = -input.moveZ;
      let mr = input.moveX;
      let mn = Math.abs(mf) + Math.abs(mr);
      if (mn < 0.01) { mf = 1; mr = 0; mn = 1; }     // coasting to a stop
      mf = mf / mn; mr = mr / mn;
      wantClip = mf >= 0 ? PLAYER_ANIM_WALK : PLAYER_ANIM_WALK_BACK;
      wantL = mr < 0 ? -mr : 0;
      wantR = mr > 0 ? mr : 0;
      const authored = Math.abs(mf) * (mf >= 0 ? ANIM_WALK_SPEED : ANIM_BACK_SPEED)
                     + (wantL + wantR) * ANIM_STRAFE_SPEED;
      rate = Math.max(0.5, Math.min(2.4, spd / authored));
    } else if (moving) {
      if (sprinting) {
        wantClip = PLAYER_ANIM_SPRINT;
        rate = Math.max(0.5, Math.min(2.9, spd / ANIM_SPRINT_SPEED));
      } else if (spd > ANIM_RUN_ABOVE) {
        wantClip = PLAYER_ANIM_RUN;
        rate = Math.max(0.5, Math.min(2.9, spd / ANIM_RUN_SPEED));
      } else {
        wantClip = PLAYER_ANIM_WALK;
        rate = Math.max(0.5, Math.min(2.4, spd / ANIM_WALK_SPEED));
      }
    }
    {
      const kB = 1 - Math.exp(-12 * dt);
      PLRIG[4] = PLRIG[4] + (wantL - PLRIG[4]) * kB;
      PLRIG[5] = PLRIG[5] + (wantR - PLRIG[5]) * kB;
      animSetBlend(animPlayer, 0, PLAYER_ANIM_STRAFE_L, PLRIG[4] > 0.01 ? PLRIG[4] : 0);
      animSetBlend(animPlayer, 1, PLAYER_ANIM_STRAFE_R, PLRIG[5] > 0.01 ? PLRIG[5] : 0);
    }

    // ---- the rig over the clips (plan 1.3, engine EN-064) ----
    // The aim in MODEL space (the space jointWorld reports): the camera's forward turned back by
    // the model yaw, and the weapon's up, perpendicular to it in the vertical plane.
    const apR = -CAM[1];
    const cpR = Math.cos(apR);
    const wfxR = Math.sin(camYaw) * cpR, wfyR = Math.sin(apR), wfzR = -Math.cos(camYaw) * cpR;
    const cMR = Math.cos(modelYaw), sMR = Math.sin(modelYaw);
    const aFX = wfxR * cMR - wfzR * sMR, aFY = wfyR, aFZ = wfxR * sMR + wfzR * cMR;
    const hlR = Math.sqrt(aFX * aFX + aFZ * aFZ);
    const aUX = hlR > 0.001 ? -aFX * aFY / hlR : 0, aUY = hlR, aUZ = hlR > 0.001 ? -aFZ * aFY / hlR : 0;
    {
      // Aim offset: lean the torso with the camera pitch. The model faces +X with +Y up, so its
      // right is +Z and a positive turn about +Z lifts the chest. It fades out as the body turns
      // away from the camera (running sideways from the hip), where "pitch" is no longer forward.
      const facing = Math.cos(playerFaceOffset);
      let lean = -CAM[1] * AIM_SPINE_SHARE * (facing > 0 ? facing : 0);
      if (!playing || freeBody) lean = 0;
      if (lean > AIM_SPINE_MAX) lean = AIM_SPINE_MAX;
      if (lean < -AIM_SPINE_MAX) lean = -AIM_SPINE_MAX;
      animSetJointRotation(animPlayer, 0, plSpine0, 0, 0, 1, lean * 0.30);
      animSetJointRotation(animPlayer, 1, plSpine1, 0, 0, 1, lean * 0.35);
      animSetJointRotation(animPlayer, 2, plSpine2, 0, 0, 1, lean * 0.35);
      // The rifle-butt strike (plan 2.7) turns the shoulders with the weapon: wound back,
      // then through. Two more rotation slots, about the model's vertical.
      const swingP = freeBody ? 0 : meleeSwing();
      animSetJointRotation(animPlayer, 3, plSpine1, 0, 1, 0, swingP * 0.40);
      animSetJointRotation(animPlayer, 4, plSpine2, 0, 1, 0, swingP * 0.40);

      // A hit jolts the upper body: the flinch clip rides the layer for most of a second.
      if (GS.lastHitT > PLRIG[7] + 0.5 && !deadNow) {
        PLRIG[6] = PLAYER_HIT_DUR;
        PLRIG[8] = Math.abs(GS.lastHitAngle) < Math.PI / 2 ? PLAYER_ANIM_HIT_FRONT : PLAYER_ANIM_HIT_BACK;
      }
      PLRIG[7] = GS.lastHitT;
      if (PLRIG[6] > 0) PLRIG[6] = PLRIG[6] - dt;

      // Off hand onto the foregrip. The weapon is drawn at the weapon socket, pointing down the
      // aim; the grip is a fixed point on it. Let go for a flinch, a roll and death.
      const holdWant = (playing && !freeBody && PLRIG[6] <= 0
                        && plLeftHand >= 0 && playerHandJoint >= 0) ? 1 : 0;
      PLRIG[0] = PLRIG[0] + (holdWant - PLRIG[0]) * (1 - Math.exp(-14 * dt));
      if (PLRIG[0] > 0.01) {
        const wNow = WPN.currentWeapon();
        const gz = (WEAPON_GRIP_Z[wNow] - WEAPON_HAND_Z[wNow]) / PLAYER_SCALE;
        const gy = (WEAPON_GRIP_Y[wNow] + WEAPON_HAND_Y[wNow]) / PLAYER_SCALE;
        const sx = jointWorld(animPlayer, playerHandJoint, 12);
        const sy = jointWorld(animPlayer, playerHandJoint, 13);
        const sz = jointWorld(animPlayer, playerHandJoint, 14);
        let tx = sx + aFX * gz + aUX * gy;
        let ty = sy + aFY * gz + aUY * gy;
        let tz = sz + aFZ * gz + aUZ * gy;
        // Through a strike the handguard swings with the weapon (the same turn about the
        // vertical that combat.ts gives the drawn model), so the off hand stays on it.
        const swH = meleeSwing();
        if (swH !== 0) {
          const saH = swH * 0.95, csH = Math.cos(saH), snH = Math.sin(saH);
          const ox1 = tx - sx, oz1 = tz - sz;
          tx = sx + ox1 * csH + oz1 * snH;
          tz = sz - ox1 * snH + oz1 * csH;
        }
        // Throwing a grenade (plan 2.7) is the off hand's: back past the hip, then out ahead.
        if (GS.throwT > 0) {
          const uT = 1 - GS.throwT / 0.4;
          tx = sx - 0.25 + 0.85 * uT;
          ty = sy + 0.30 - 0.18 * uT;
          tz = sz - 0.45;
        }
        if (WPN.isReloading()) {
          // The reload is this hand's journey, timed to the weapon's own reload: handguard ->
          // magazine well (pull the empty) -> belt at the left hip -> magazine well (seat the
          // new one, a short push up) -> handguard. The Text2Motion reload clip waved the hand
          // at the helmet instead, and could not follow four different magazine positions.
          const mz = (WEAPON_MAG_Z[wNow] - WEAPON_HAND_Z[wNow]) / PLAYER_SCALE;
          const my = (WEAPON_MAG_Y[wNow] + WEAPON_HAND_Y[wNow]) / PLAYER_SCALE;
          const mgx = sx + aFX * mz + aUX * my, mgy = sy + aFY * mz + aUY * my, mgz = sz + aFZ * mz + aUZ * my;
          // belt: behind, below and left of the trigger hand (model -X back, -Y down, -Z left)
          const bx = sx - 0.22, by = sy - 0.42, bz = sz - 0.30;
          const rp = WPN.reloadProgress();
          let ax = tx, ay = ty, az = tz, cx = mgx, cy = mgy, cz = mgz, u = 0;
          if (rp < 0.18) { u = rp / 0.18; }
          else if (rp < 0.45) { ax = mgx; ay = mgy; az = mgz; cx = bx; cy = by; cz = bz; u = (rp - 0.18) / 0.27; }
          else if (rp < 0.72) { ax = bx; ay = by; az = bz; cx = mgx; cy = mgy - 0.05; cz = mgz; u = (rp - 0.45) / 0.27; }
          else if (rp < 0.82) { ax = mgx; ay = mgy - 0.05; az = mgz; u = (rp - 0.72) / 0.10; }
          else { ax = mgx; ay = mgy; az = mgz; cx = tx; cy = ty; cz = tz; u = (rp - 0.82) / 0.18; }
          u = u * u * (3 - 2 * u);
          tx = ax + (cx - ax) * u; ty = ay + (cy - ay) * u; tz = az + (cz - az) * u;
        }
        animSetIK(animPlayer, 0, plLeftHand, tx, ty, tz, PLRIG[0], true);
        // elbow down and out to the left (model left is -Z)
        animSetIKPole(animPlayer, 0, sx, sy - 1.0, sz - 0.6, true);
      } else {
        animSetIK(animPlayer, 0, -1, 0, 0, 0, 0, false);
      }
    }
    GS.playerModelYaw = modelYaw;
    // The upper-body layer, one tenant at a time: a flinch, else the rifle carry. The carry is the run clip's torso and arms at a crawl (it reads as breathing): the
    // run is still the clip that holds the rifle best, and using it under every gait keeps the
    // weapon in one place whatever the legs are doing.
    {
      let layerClip = -1;
      let layerSpeed = 0.06;
      let layerLoop = true;
      if (freeBody) {
        layerClip = -1;
      } else if (PLRIG[6] > 0) {
        layerClip = PLRIG[8]; layerSpeed = 1; layerLoop = false;
      } else if (wantClip !== PLAYER_ANIM_RUN) {
        layerClip = PLAYER_ANIM_RUN;
      }
      if (layerClip !== PLRIG[9]) { PLRIG[1] = 0; PLRIG[9] = layerClip; }
      PLRIG[1] = PLRIG[1] + ((layerClip >= 0 ? 1 : 0) - PLRIG[1]) * (1 - Math.exp(-14 * dt));
      if (layerClip >= 0 && PLRIG[1] > 0.01 && plSpine0 >= 0) {
        animSetLayer(animPlayer, layerClip, PLRIG[1], plSpine0, layerSpeed, layerLoop);
      } else {
        animSetLayer(animPlayer, -1, 0, -1, 1, false);
      }
    }
    animPlay(animPlayer, wantClip, fade, rate, loopClip);
    animUpdate(animPlayer, dt, PLAYER_SCALE,
      pp.x, pp.y + PLAYER_MODEL_Y_OFFSET, pp.z, modelYaw);
    if (wadingAt(pp.x, pp.y + PLAYER_MODEL_Y_OFFSET, pp.z)) PL_WET[0] = WET_TIME;
    else if (PL_WET[0] > 0) PL_WET[0] = PL_WET[0] - dt;
    const plWet = Math.floor(255 * (1 - 0.28 * Math.min(1, PL_WET[0] / (WET_TIME * 0.6))));
    drawModel(mdlPlayer, vec3(pp.x, pp.y + PLAYER_MODEL_Y_OFFSET, pp.z),
              PLAYER_SCALE, plWet >= 254 ? WHITE : { r: plWet, g: plWet, b: plWet, a: 255 });
    if (playerGrounded()) drawContact(pp.x, pp.y + PLAYER_MODEL_Y_OFFSET, pp.z, 1.7, 0.50);

    // The weapon points down the aim while the Trooper holds it, and stays in the HAND through
    // a roll or a death. While it is held, learn where "down the barrel" and "weapon up" are in
    // the hand's own frame; when the body goes free, turn those back out through the hand.
    if (playerHandJoint >= 0) {
      const h0 = jointWorld(animPlayer, playerHandJoint, 0);
      const h1 = jointWorld(animPlayer, playerHandJoint, 1);
      const h2 = jointWorld(animPlayer, playerHandJoint, 2);
      const h4 = jointWorld(animPlayer, playerHandJoint, 4);
      const h5 = jointWorld(animPlayer, playerHandJoint, 5);
      const h6 = jointWorld(animPlayer, playerHandJoint, 6);
      const h8 = jointWorld(animPlayer, playerHandJoint, 8);
      const h9 = jointWorld(animPlayer, playerHandJoint, 9);
      const h10 = jointWorld(animPlayer, playerHandJoint, 10);
      PLRIG[17] = PLRIG[17] + ((freeBody ? 1 : 0) - PLRIG[17]) * (1 - Math.exp(-16 * dt));
      if (!freeBody && PLRIG[0] > 0.9 && PLRIG[17] < 0.05) {
        const kC = PLRIG[16] === 0 ? 1 : 0.15;
        PLRIG[10] = PLRIG[10] + ((h0 * aFX + h1 * aFY + h2 * aFZ) - PLRIG[10]) * kC;
        PLRIG[11] = PLRIG[11] + ((h4 * aFX + h5 * aFY + h6 * aFZ) - PLRIG[11]) * kC;
        PLRIG[12] = PLRIG[12] + ((h8 * aFX + h9 * aFY + h10 * aFZ) - PLRIG[12]) * kC;
        PLRIG[13] = PLRIG[13] + ((h0 * aUX + h1 * aUY + h2 * aUZ) - PLRIG[13]) * kC;
        PLRIG[14] = PLRIG[14] + ((h4 * aUX + h5 * aUY + h6 * aUZ) - PLRIG[14]) * kC;
        PLRIG[15] = PLRIG[15] + ((h8 * aUX + h9 * aUY + h10 * aUZ) - PLRIG[15]) * kC;
        PLRIG[16] = 1;
      }
      if (PLRIG[16] !== 0) {
        const mfx = h0 * PLRIG[10] + h4 * PLRIG[11] + h8 * PLRIG[12];
        const mfy = h1 * PLRIG[10] + h5 * PLRIG[11] + h9 * PLRIG[12];
        const mfz = h2 * PLRIG[10] + h6 * PLRIG[11] + h10 * PLRIG[12];
        const mux = h0 * PLRIG[13] + h4 * PLRIG[14] + h8 * PLRIG[15];
        const muy = h1 * PLRIG[13] + h5 * PLRIG[14] + h9 * PLRIG[15];
        const muz = h2 * PLRIG[13] + h6 * PLRIG[14] + h10 * PLRIG[15];
        // model -> world, the same lift combat.ts gives the socket position
        GS.weaponFwdX = mfx * cMR + mfz * sMR; GS.weaponFwdY = mfy; GS.weaponFwdZ = -mfx * sMR + mfz * cMR;
        GS.weaponUpX = mux * cMR + muz * sMR;  GS.weaponUpY = muy;  GS.weaponUpZ = -mux * sMR + muz * cMR;
        GS.weaponFree = PLRIG[17];
      }
    }

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
    // Plan 2.2 - "attacking" is a STATE now, not a distance: the strike's wind-up, active
    // frames and recovery, the Bruiser's pounce wind-up, a ranged kind's wind-up and volley.
    const stE = enAIState[i];
    const striking = stE === AI_STRIKE_WIND || stE === AI_STRIKE_HIT || stE === AI_STRIKE_REC;
    const rangedAtk = KIND_RANGED[k] === 1 && (stE === AI_WINDUP || stE === 3);
    const attacking = striking || stE === AI_WINDUP || rangedAtk;
    const flinching = stE === AI_FLINCH;
    const spdE = Math.hypot(vxLast[i], vzLast[i]);

    // SH-030 / SH-034 — the base track is locomotion; the attack rides on an
    // UPPER-BODY layer over it (EN-028 masks), so an alien bites while still
    // closing instead of stopping dead to bite. Getting shot interrupts with
    // the pain clip, which is the reward for landing a hit. Standing still (noticing the
    // player, rooted in a wind-up) is the idle clip, not the run at a crawl.
    let baseClip = ANIM_WALK_IDX[k];
    if (flinching) baseClip = ANIM_PAIN_IDX[k];
    else if (attacking && KIND_SPINE_JOINT[k] < 0) baseClip = ANIM_ATTACK_IDX[k];
    else if (spdE < 0.3) baseClip = 5;

    // Attack layer: blended in/out rather than snapped, so the bite doesn't pop. It is
    // RESTARTED for each strike and played at the speed that puts the clip's blow
    // (ATTACK_HIT_T, measured per rig) at the end of the wind-up, which is when the hit
    // shape appears: what the claw does and what hurts are the same moment.
    if (KIND_SPINE_JOINT[k] >= 0) {
      const want = attacking && !flinching ? 1 : 0;
      const kL = 1 - Math.exp(-(want === 1 ? 22 : 9) * dt);
      if (enStrikeSeq[i] !== enLayerSeq[i]) {
        enLayerSeq[i] = enStrikeSeq[i];
        animSetLayer(enAnim[i], -1, 0, -1, 1, false);       // clip -1 then back: time 0
        enAttackLayer[i] = 0;
      }
      enAttackLayer[i] = enAttackLayer[i] + (want - enAttackLayer[i]) * kL;
      let lSpeed = 1.0;
      if (striking) lSpeed = ATTACK_HIT_T[k] / STRIKE_WINDUP[k];
      else if (rangedAtk) lSpeed = ATTACK_HIT_T[k] / RANGED_WINDUP[k];
      animSetLayer(enAnim[i], ANIM_ATTACK_IDX[k], enAttackLayer[i],
                   KIND_SPINE_JOINT[k], lSpeed, false);

      // Plan 2.4 - the directional jolt: a hit knocks the upper body along the shot. The
      // axis is (up x shot direction) in the model's own space, so a round from the left
      // rocks it right and one in the back folds it forward. It decays in a quarter second.
      if (enHitK[i] > 0.02) {
        const yawJ = Math.PI / 2 - enHeading[i];
        const cJ = Math.cos(yawJ), sJ = Math.sin(yawJ);
        const mxJ = enHitDX[i] * cJ - enHitDZ[i] * sJ;
        const mzJ = enHitDX[i] * sJ + enHitDZ[i] * cJ;
        animSetJointRotation(enAnim[i], 0, KIND_SPINE_JOINT[k], mzJ, 0, -mxJ,
                             enHitK[i] * JOLT_ANGLE);
        enJoltOn[i] = 1;
        enHitK[i] = enHitK[i] * Math.exp(-10 * dt);
      } else if (enJoltOn[i] === 1) {
        animSetJointRotation(enAnim[i], 0, KIND_SPINE_JOINT[k], 0, 0, 1, 0);
        enJoltOn[i] = 0;
        enHitK[i] = 0;
      }
    }

    // Speed-matched playback — the fix that kills foot-sliding. The old code
    // played the walk clip at a fixed rate no matter how fast the thing was
    // actually moving, so a charging dragoon's feet skated.
    const authoredE = KIND_SPEED[k];
    const rateE = (flinching || baseClip === 5) ? 1.0
      : Math.max(0.4, Math.min(2.5, spdE / (authoredE > 0.01 ? authoredE : 1)));

    // animPlay is idempotent, so stating the clip we want every frame is the
    // intended use — it only crossfades when that actually changed.
    animPlay(enAnim[i], baseClip, flinching ? 0.06 : 0.15, rateE, !flinching);
    enAnimClip[i] = baseClip;
    // Same engine quirk as the player model: the skinned path applies rotY
    // INVERTED, so pass π/2 − yaw or the aliens strafe sideways-on.
    animUpdate(enAnim[i], dt, enScale(i),
      enX[i], enY[i], enZ[i], Math.PI / 2 - enHeading[i]);
    // The transform this pose was built with: the hit shapes lift the joints out of model
    // space with exactly these numbers (hitshapes.ts).
    enPoseX[i] = enX[i]; enPoseY[i] = enY[i]; enPoseZ[i] = enZ[i];
    enPoseYaw[i] = Math.PI / 2 - enHeading[i];
    enPosed[i] = 1;

    // Plan 2.2 - the tell you can see from across the arena: a hot light at the head that
    // builds through the wind-up and is gone the instant the blow is thrown.
    if (stE === AI_STRIKE_WIND || (stE === AI_WINDUP && KIND_RANGED[k] === 0)) {
      const total = stE === AI_STRIKE_WIND ? STRIKE_WINDUP[k] : 0.65;
      const u = 1 - Math.max(0, Math.min(1, enStateT[i] / total));
      shapeJoint(i, HSJ_HEAD, TMP3);
      addPointLight(TMP3[0], TMP3[1] + 0.1, TMP3[2], 2.5 + KIND_HEIGHT[k],
                    1.0, 0.32, 0.08, 0.6 + u * 3.0);
      // ...and a flare over it, because a point light does nothing in full sun: it swells and
      // brightens until the blow goes. Additive, so it reads against grass and brick alike.
      if (ENV.matMuzzleFlash > 0) {
        drawMeshWithMaterial(ENV.matMuzzleFlash, ENV.matMuzzleFlashMesh,
          vec3(TMP3[0], TMP3[1] + 0.05, TMP3[2]),
          (0.22 + u * 0.50) * (0.7 + KIND_HEIGHT[k] * 0.22),
          { r: 255, g: 110, b: 35, a: Math.floor(110 + u * 145) });
      }
    }

    // Hit flash lerps the KIND tint toward red, so the adv dragoon stays
    // recognisably violet even while flashing.
    const bT = KIND_TINTO[k];
    const f = enFlashT[i] > 0 ? enFlashT[i] / DRETCH_HIT_FLASH : 0;
    if (wadingAt(enX[i], enY[i], enZ[i])) EN_WET[i] = WET_TIME;
    else if (EN_WET[i] > 0) EN_WET[i] = EN_WET[i] - dt;
    const wetK = 1 - 0.30 * Math.min(1, EN_WET[i] / (WET_TIME * 0.6));
    const hurt = 1 - Math.max(0, enHP[i]) / KIND_HP[k];          // 0 fresh .. 1 nearly dead
    const dr = wetK * (1 - hurt * 0.22), dg = wetK * (1 - hurt * 0.42), db = wetK * (1 - hurt * 0.42);
    const tint = (f > 0 || dg < 0.995)
      ? { r: Math.floor(bT.r * dr),
          g: Math.floor(bT.g * dg * (1 - f)),
          b: Math.floor(bT.b * db * (1 - f)),
          a: 255 }
      : bT;
    if (enElite[i] === 1) {
      // An elite: a size up (enScale), flushed red, and it carries its own glow, so it is
      // picked out of a pack at dusk as well as at noon.
      const et = { r: tint.r, g: Math.floor(tint.g * 0.66), b: Math.floor(tint.b * 0.62), a: 255 };
      drawModel(mdlAliens[k], vec3(enX[i], enY[i], enZ[i]), enScale(i), et);
      addPointLight(enX[i], enY[i] + KIND_HEIGHT[k] * 0.7, enZ[i], 4.5, 1.0, 0.25, 0.12,
                    2.2 + 0.6 * Math.sin(getTime() * 6 + i));
    } else {
      drawModel(mdlAliens[k], vec3(enX[i], enY[i], enZ[i]), enScale(i), tint);
    }
    drawContact(enX[i], enY[i], enZ[i], 0.9 + KIND_HEIGHT[k] * 0.75, 0.50);
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
  // The photoreal cast (2026-11) dies by its authored clip instead: every creature carries a
  // purpose-made death (stagger, knees buckle, falls on its back), and the engine's auto-ragdoll
  // (at most 12 capsules, walked breadth-first from the root) covers only the torso end of the
  // 65-joint Mixamo skeleton, which stretched the corpse into a rigid plank. Set this back to true
  // once the ragdoll can be given a per-rig bone list.
  const DEATH_RAGDOLL = false;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (enDying[i] !== 1) continue;
    enDeathT[i] = enDeathT[i] + dt;
    const k = enKind[i];

    if (enRagActive[i] === 0) {
      // --- still animating the blow
      if (enAnimClip[i] !== enDeathClip[i]) {
        // Plan 2.4 - the death the blow chose (director.damageEnemy). "fall" opens with a
        // second of swaying on its feet, so it is raced through at 12x to where the knees go.
        animPlay(enAnim[i], enDeathClip[i], 0.06,
                 enDeathClip[i] === ANIM_FALL_IDX ? 12.0 : 1.0, false);
        enAnimClip[i] = enDeathClip[i];
        animSetLayer(enAnim[i], -1, 0, -1, 1, false);   // drop the attack layer
        if (KIND_SPINE_JOINT[k] >= 0) animSetJointRotation(enAnim[i], 0, KIND_SPINE_JOINT[k], 0, 0, 1, 0);
        enJoltOn[i] = 0;
      }
      const yaw = Math.PI / 2 - enDeathYaw[i];
      animUpdate(enAnim[i], dt, enScale(i), enX[i], enY[i], enZ[i], yaw);
      drawModel(mdlAliens[k], vec3(enX[i], enY[i], enZ[i]), enScale(i), KIND_TINTO[k]);

      if (!DEATH_RAGDOLL) {
        enRagActive[i] = 2;     // play the death clip out, then sink (the branch below)
      } else if (enDeathT[i] >= RAG_HANDOFF && enRagdoll[i] > 0) {
        // The transform passed here MUST be the one we just drew with: it is the
        // bridge between model space and world space, and the engine freezes it.
        const ok = activateRagdoll(enRagdoll[i], enAnim[i], physics,
                                   enScale(i), enX[i], enY[i], enZ[i], yaw);
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
      drawModel(mdlAliens[k], vec3(enX[i], enY[i], enZ[i]), enScale(i), KIND_TINTO[k]);
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
      // --- the authored death, played out; then the corpse lies, then sinks.
      const isFall = enDeathClip[i] === ANIM_FALL_IDX;
      const skipT = ANIM_FALL_SKIP / 12.0;
      if (isFall) animPlay(enAnim[i], ANIM_FALL_IDX, 0.06, enDeathT[i] < skipT ? 12.0 : 1.0, false);
      const dur = isFall ? (ANIM_FALL_DUR - ANIM_FALL_SKIP + skipT) : ANIM_DIE_DUR[k];
      // A body thrown by a blast or a heavy round travels: a low arc, then a short slide.
      // It stops at a wall and follows the floor it is over.
      if (enDeathVX[i] !== 0 || enDeathVZ[i] !== 0 || enDeathLift[i] > 0) {
        const nxD = enX[i] + enDeathVX[i] * dt, nzD = enZ[i] + enDeathVZ[i] * dt;
        if (flowBlockedAt(nxD, nzD, enY[i])) { enDeathVX[i] = 0; enDeathVZ[i] = 0; }
        else { enX[i] = nxD; enZ[i] = nzD; }
        enDeathLift[i] = enDeathLift[i] + enDeathVY[i] * dt;
        enDeathVY[i] = enDeathVY[i] - 16 * dt;
        if (enDeathLift[i] <= 0) {
          enDeathLift[i] = 0; enDeathVY[i] = 0;
          const fr = Math.exp(-7 * dt);
          enDeathVX[i] = enDeathVX[i] * fr; enDeathVZ[i] = enDeathVZ[i] * fr;
          if (Math.abs(enDeathVX[i]) + Math.abs(enDeathVZ[i]) < 0.15) { enDeathVX[i] = 0; enDeathVZ[i] = 0; }
        }
        enY[i] = surfaceHeightAt(enX[i], enZ[i], enY[i]);
      }
      const liftD = enDeathLift[i];
      // The body lies where it fell for CORPSE_LINGER seconds, then sinks into the ground.
      const CORPSE_LINGER = 5.0;
      const sink = enDeathT[i] > dur + CORPSE_LINGER ? (enDeathT[i] - dur - CORPSE_LINGER) * 0.9 : 0;
      animUpdate(enAnim[i], dt, enScale(i),
        enX[i], enY[i] + liftD - sink, enZ[i], Math.PI / 2 - enDeathYaw[i]);
      drawModel(mdlAliens[k], vec3(enX[i], enY[i] + liftD - sink, enZ[i]), enScale(i), KIND_TINTO[k]);
      if (enDeathT[i] > dur + CORPSE_LINGER + 2.5) {
        enDying[i] = 0;
        enRagActive[i] = 0;
        enAnimClip[i] = -1;
      }
    }
  }
  // Combat layer of the pass — muzzle flare light, pickups, player plasma,
  // enemy bolts (combat.ts).
  if (P2TEST) p2Draw();
  drawCombatWorld();

  // SH-033 — particles + decals. One update + one instanced draw per system,
  // last in the 3D pass so the additive particles composite over everything and
  // the depth-tested decals have a full depth buffer to fade against.
  VFX.updateAndDrawVfx(dtReal);

  endMode3D();
  if (PERFTEST) perfTC = getTime();

  // Everything from here to endMode2D() is laid out in the logical HUD space
  // established above. At uiScale 1 the camera is skipped entirely.
  const uiCam = uiScale !== 1;
  if (uiCam) beginMode2DRaw(0, 0, 0, 0, 0, uiScale);

  // The in-run HUD - crosshair/spread, hit marker, damage vignette + arc,
  // HP + dodge, score + combo, render-toggle status, ammo/reload/charge,
  // wave banner + report card, unlock banner - hud.ts (gated on a run inside).
  drawHud(sw, sh, input.padActive || uiShotPad, dbgSsgi, dbgSsao, dbgSsr, dbgShadow,
          ptSupported, SET.get(SET.SET_PT));

  // (The title screen used to live here: a wordmark and "press any key". It is
  // now the MAIN MENU — same live-world backdrop, but with somewhere to go. It
  // is drawn by drawMenu() with every other menu, and starts the run through
  // ACT_PLAY -> startRun() rather than by swallowing a keypress.)

  // End-of-run overlays + the SH-040 level-change notice - hud.ts.
  drawOverlays(sw, sh);

  // SH-038 — the pause / settings menu draws LAST so it sits over the HUD.
  drawMenu(sw, sh);
  drawArenaNotice(sw, sh);

  // Diagnostic HUD — helps verify input is reaching the game. The desktop
  // version is a full-width bar along the bottom, which on a phone lands
  // directly under the thumbs; show just the frame rate up in the corner
  // instead, which is what's actually worth watching on device.
  if (MOBILE && GS.debugHud) {
    drawText('FPS ' + Math.floor(getFPS()), 14, 12, 20,
             { r: 200, g: 210, b: 230, a: 200 });
  }
  // Diag-bar strings are built inside the gate — MOBILE was paying the
  // per-frame concatenation for two lines it never drew.
  if (!MOBILE && GS.debugHud) {
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

  // SH-052d — AUDIOTEST readout, top-centre, so what you HEAR can be checked
  // against where the source actually is.
  if (AUDIOTEST) {
    const label = 'AUDIOTEST ' + cliAudioTest + '   ' + audioTestStatus;
    drawRect(0, 0, sw, 26, { r: 0, g: 0, b: 0, a: 160 });
    drawText(label, 14, 5, 16, { r: 255, g: 230, b: 140, a: 255 });
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

  if (uiCam) endMode2D();

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
  // endDrawing() is issued by runGame() after this callback returns, so the
  // E column (present/swap) now lands in next frame's "begin" gap instead of
  // being measured here. The A–D splits are unchanged.
  if (PERFTEST) {
    perfPrevEnd = getTime();
    perfMsA = (perfTA - perfTTop) * 1000;
    perfMsB = (perfTB - perfTA) * 1000;
    perfMsC = (perfTC - perfTB) * 1000;
    perfMsD = (perfTD - perfTC) * 1000;
    perfMsE = (perfPrevEnd - perfTD) * 1000;
  }
  if (PERFTEST && perfDone) { closeWindow(); return; }
}

runGame(gameFrame);














































