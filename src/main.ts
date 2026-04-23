import {
  initWindow, windowShouldClose, beginDrawing, endDrawing, clearBackground,
  setTargetFPS, getDeltaTime, getFPS, getTime,
  beginMode3D, endMode3D,
  drawCube, drawSphere, drawText, drawRect, drawCircle, measureText,
  setAmbientLight, setDirectionalLight,
  getScreenWidth, getScreenHeight,
  vec3,
  isKeyPressed, Key, Vec3, injectKeyDown, injectKeyUp,
  disableCursor, enableCursor, takeScreenshot,
  loadModel, drawModel, loadModelAnimation, updateModelAnimation,
  initAudio, loadSound, playSound, setSoundVolume,
  loadMusic, playMusic, updateMusicStream, setMusicVolume,
} from 'bloom';
import { setVignette, setFilmGrain } from 'bloom/core';
import { addPointLight } from 'bloom/scene';
import {
  createWorld, step as stepPhysics,
  boxShape, createBody, destroyBody, MotionType, Layer,
  setLayerCollides, raycast, ALL_LAYERS_MASK, BodyHandle,
  setBodyPosition,
} from 'bloom/physics';
import { initInput, readInput } from './input';
import { createPlayer, updatePlayerController, playerPosition } from './player';

// Colour-coded debug cubes for collider_box entities (real meshes land in later
// milestones; for M2 we just render the collision geometry itself).
interface DebugBox {
  center: Vec3;
  halfExtents: Vec3;
  name: string;
}

initWindow(1024, 640, 'Bloom Shooter');
setTargetFPS(60);
initInput();

// ---- M8 polish: audio -----------------------------------------------------
initAudio();
const sfxFire = loadSound('assets/sounds/rifle_fire.wav');
const sfxAttack = loadSound('assets/sounds/dretch_attack.wav');
const sfxPickup = loadSound('assets/sounds/pickup.wav');
setSoundVolume(sfxFire, 0.35);
setSoundVolume(sfxAttack, 0.6);
setSoundVolume(sfxPickup, 0.8);
const musicAmbient = loadMusic('assets/sounds/ambient.ogg');
setMusicVolume(musicAmbient, 0.35);
playMusic(musicAmbient);

const physics = createWorld({ gravity: vec3(0, -20, 0) });
// Make NON_MOVING (static) and MOVING (character/dynamic) collide.
setLayerCollides(physics, Layer.NON_MOVING, Layer.MOVING, true);
setLayerCollides(physics, Layer.MOVING, Layer.MOVING, true);

// ---- Arena geometry (hardcoded for M2) ------------------------------------
// The world JSON is still at assets/worlds/arena_01.world.json and is meant
// to be authored in the editor, but Perry 0.5.158's JSON.parse produces
// array-like objects whose `.length` reads as `undefined`, so the iteration
// does nothing. Until that's fixed we hardcode the same layout here so M2
// is actually playable. When JSON parsing works, this block will be replaced
// by a loop over the parsed entities.
const spawnPos: Vec3 = vec3(0, 1, 0);
const spawnYaw = 0;
const debugBoxes: DebugBox[] = [
  { name: 'floor',  center: vec3(  0, -0.5,   0), halfExtents: vec3(25, 0.5, 25) },
  { name: 'wall_n', center: vec3(  0,  2.5, -25), halfExtents: vec3(25, 3.0,  0.5) },
  { name: 'wall_s', center: vec3(  0,  2.5,  25), halfExtents: vec3(25, 3.0,  0.5) },
  { name: 'wall_e', center: vec3( 25,  2.5,   0), halfExtents: vec3( 0.5, 3.0, 25) },
  { name: 'wall_w', center: vec3(-25,  2.5,   0), halfExtents: vec3( 0.5, 3.0, 25) },
];
for (let i = 0; i < debugBoxes.length; i++) {
  const b = debugBoxes[i];
  const shape = boxShape(b.halfExtents);
  createBody(physics, shape, {
    motionType: MotionType.STATIC,
    position: b.center,
    objectLayer: Layer.NON_MOVING,
    friction: 0.9,
  });
}
const worldStatus = debugBoxes.length + ' colliders (hardcoded)';

// Textured arena mesh — a single GLB containing floor + 4 walls + ceiling,
// with tiled tex-tech textures. Sits on top of the same collider geometry
// declared in debugBoxes so physics behaviour is unchanged.
const mdlArena = loadModel('assets/models/arena.glb');

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

// ---- Unvanquished aliens (5 kinds, M3 model + M5 AI + M6 pool) ------------
// Each kind has its own GLB model and stat line. Kinds and models line up
// with the Unvanquished alien classes:
//   0 = dretch   — small, fast, low HP, moderate damage
//   1 = mantis   — quick, medium HP
//   2 = marauder — medium all-round
//   3 = dragoon  — heavier, slower, hits hard
//   4 = tyrant   — boss tier; rare, big, tanky
const KIND_COUNT = 5;
const KIND_NAME  = ['DRETCH', 'MANTIS', 'MARAUDER', 'DRAGOON', 'TYRANT'];
const mdlAliens  = [
  loadModel('assets/models/enemy_dretch.glb'),
  loadModel('assets/models/enemy_mantis.glb'),
  loadModel('assets/models/enemy_marauder.glb'),
  loadModel('assets/models/enemy_dragoon.glb'),
  loadModel('assets/models/enemy_tyrant.glb'),
];
const animAliens = [
  loadModelAnimation('assets/models/enemy_dretch.glb'),
  loadModelAnimation('assets/models/enemy_mantis.glb'),
  loadModelAnimation('assets/models/enemy_marauder.glb'),
  loadModelAnimation('assets/models/enemy_dragoon.glb'),
  loadModelAnimation('assets/models/enemy_tyrant.glb'),
];
// Animation indices — IQE declaration order. Dretch (and most others):
// 0 stand, 1 attack, 4 die, 14 run, 20 walk. We map gameplay -> anim idx.
const ANIM_WALK_IDX   = [14, 14, 14, 14, 14];
const ANIM_ATTACK_IDX = [1, 1, 1, 1, 1];
// Procedural motion parameters (cheap substitute for skeletal animation).
// Each enemy has a phase accumulator — sinusoids on top give a bob + side-
// sway while walking, and a forward-lunge while attacking.
const WALK_BOB_Y = 0.12;       // metres
const WALK_BOB_RATE = 9.0;     // rad/s
const WALK_TILT = 0.06;        // unused; kept for future side-sway
const ATTACK_LUNGE_AMP = 0.25; // m forward during attack
// Per-kind tuning. Collider half-extents are generous (taller than the visual
// model) so horizontal aim at any range connects.
const KIND_SCALE = [1.6, 1.6, 1.9, 2.4, 3.0];
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

// Enemy pool — each slot is permanently tied to one kind because Jolt body
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
const enBody: BodyHandle[] = new Array<BodyHandle>(MAX_ENEMIES);
for (let k = 0; k < KIND_COUNT; k++) {
  const shape = boxShape(vec3(KIND_HX[k], KIND_HY[k], KIND_HZ[k]));
  for (let j = 0; j < BODIES_PER_KIND; j++) {
    const i = k * BODIES_PER_KIND + j;
    enX[i] = 0; enY[i] = -100; enZ[i] = 0;
    enHP[i] = 0; enAlive[i] = 0; enAttackCD[i] = 0; enFlashT[i] = 0;
    enPhase[i] = Math.random() * Math.PI * 2;   // stagger the bob phases
    enKind[i] = k;
    enBody[i] = createBody(physics, shape, {
      motionType: MotionType.KINEMATIC,
      position: vec3(0, -100, 0),
      objectLayer: Layer.MOVING,
    });
  }
}

// Wave director — 3 waves at the 4 arena corners, escalating composition.
// WAVE_KINDS is the flat concatenation of per-wave kind sequences; WAVE_OFFS
// locates each wave's sub-range. (Flat arrays work best with Perry.)
const spawnerX = [-18, 18, -18, 18];
const spawnerZ = [-18, -18, 18, 18];
const wavePlan    = [3, 6, 10];
const WAVE_OFFS   = [0, 3, 9, 19];
const WAVE_KINDS  = [
  // wave 1 — 3 dretches
  0, 0, 0,
  // wave 2 — dretches + mantises
  0, 1, 0, 1, 0, 1,
  // wave 3 — variety with 1 tyrant at the end
  0, 1, 0, 2, 1, 2, 3, 0, 1, 4,
];
const WAVE_SPAWN_DELAY = 1.2;
const WAVE_BREAK_DELAY = 2.5;
const MAX_CONCURRENT = 4;

let waveIdx = 0;
let waveSpawned = 0;
let waveBreakTimer = WAVE_BREAK_DELAY;
let spawnTimer = 0;
let gameWon = false;

function countAlive(): number {
  let c = 0;
  for (let i = 0; i < MAX_ENEMIES; i++) if (enAlive[i] > 0) c = c + 1;
  return c;
}

function findDormantSlot(kind: number): number {
  for (let j = 0; j < BODIES_PER_KIND; j++) {
    const i = kind * BODIES_PER_KIND + j;
    if (enAlive[i] === 0) return i;
  }
  return -1;
}

function spawnEnemy(): void {
  const kind = WAVE_KINDS[WAVE_OFFS[waveIdx] + waveSpawned];
  const slot = findDormantSlot(kind);
  if (slot < 0) return;   // all bodies of this kind busy; retry next tick
  const sp = waveSpawned % 4;
  enX[slot] = spawnerX[sp];
  enY[slot] = 0;
  enZ[slot] = spawnerZ[sp];
  enHP[slot] = KIND_HP[kind];
  enAlive[slot] = 1;
  enAttackCD[slot] = 0;
  enFlashT[slot] = 0;
  enPhase[slot] = Math.random() * Math.PI * 2;
  setBodyPosition(enBody[slot],
    vec3(enX[slot], enY[slot] + KIND_Y_OFF[kind], enZ[slot]), true);
  waveSpawned = waveSpawned + 1;
}

// ---- Weapon + combat state (M4 / M5 / M6 / M7) ----------------------------
const PLAYER_HP_MAX = 100;
const FIRE_RANGE = 60.0;

// Weapon registry
const WEAPON_RIFLE = 0;
const WEAPON_BLASTER = 1;
const WEAPON_NAMES = ['RIFLE', 'BLASTER'];
const RIFLE_MAG = 30;
const BLASTER_MAG = 20;
const RIFLE_FIRE_CD = 0.10;   // full-auto, ~600 rpm
const BLASTER_FIRE_CD = 0.35; // tap-fire
const RIFLE_DAMAGE = 1;
const BLASTER_DAMAGE = 2;
const BLASTER_PROJ_SPEED = 40.0;
const BLASTER_PROJ_LIFE = 2.5;
const BLASTER_PROJ_GRAVITY = 9.0;   // m/s^2 — lighter than world gravity for a softer arc

let currentWeapon = WEAPON_RIFLE;
let rifleAmmo = RIFLE_MAG;
let blasterAmmo = BLASTER_MAG;
let fireCD = 0;

let playerHP = PLAYER_HP_MAX;
let gameOver = false;
let muzzleFlashT = 0;
let damageFlashT = 0;
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
for (let i = 0; i < MAX_PROJ; i++) pLife[i] = 0;
let projNext = 0;

function spawnProjectile(x: number, y: number, z: number,
                         vx: number, vy: number, vz: number): void {
  pX[projNext] = x; pY[projNext] = y; pZ[projNext] = z;
  pVX[projNext] = vx; pVY[projNext] = vy; pVZ[projNext] = vz;
  pLife[projNext] = BLASTER_PROJ_LIFE;
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
const pickupKind = [PICKUP_RIFLE, PICKUP_BLASTER, PICKUP_RIFLE, PICKUP_BLASTER];
const pickupX    = [ -18,  18, -18,  18 ];
const pickupZ    = [  18, -18, -18,  18 ];
const PICKUP_COUNT = 4;
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
    enX[i] = 0; enY[i] = -100; enZ[i] = 0;
    setBodyPosition(enBody[i], vec3(0, -100, 0), false);
  }
}

function resetRun(): void {
  currentWeapon = WEAPON_RIFLE;
  rifleAmmo = RIFLE_MAG;
  blasterAmmo = BLASTER_MAG;
  fireCD = 0;
  playerHP = PLAYER_HP_MAX;
  gameOver = false;
  gameWon = false;
  muzzleFlashT = 0;
  damageFlashT = 0;
  shotsFired = 0;
  shotsHit = 0;
  waveIdx = 0;
  waveSpawned = 0;
  waveBreakTimer = WAVE_BREAK_DELAY;
  spawnTimer = 0;
  for (let i = 0; i < MAX_PROJ; i++) pLife[i] = 0;
  for (let i = 0; i < PICKUP_COUNT; i++) { pickupActive[i] = 1; pickupRespawnT[i] = 0; }
  despawnAllEnemies();
}

// Impact sparks — fixed ring buffer to avoid array growth in the hot loop.
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
disableCursor();

// ---- M8 polish: post-FX ---------------------------------------------------
// Called once at startup — these are cheap, always-on stylistic passes.
setVignette(0.4, 0.55);    // darken frame edges
setFilmGrain(0.06);        // very subtle noise


// ---- Self-test harness ----------------------------------------------------
// When SELFTEST is true the game auto-fires a shot on frame 30, screenshots
// the scene on frame 60, and exits on frame 90. Used while investigating the
// engine's deferred-render green-screen bug — kept dormant for future debug.
const SELFTEST = false;
let testFrame = 0;


while (!windowShouldClose()) {
  beginDrawing();
  const dt = getDeltaTime();
  const sw = getScreenWidth();
  const sh = getScreenHeight();
  updateMusicStream(musicAmbient);

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

  const input = readInput();
  // Only apply mouse look when cursor is captured — avoids jumpy yaw/pitch
  // when the user is moving the mouse outside the window. The first ~10
  // frames after window creation often report giant mouse deltas (system
  // cursor settling into the captured state), which can fling the camera
  // to a useless angle before the player even sees the scene.
  testFrame = testFrame + 1;
  if (cursorLocked && testFrame > 10) {
    CAM[0] = CAM[0] + input.lookX;
    const np = CAM[1] + input.lookY;
    CAM[1] = np < TP_PITCH_MIN ? TP_PITCH_MIN : (np > TP_PITCH_MAX ? TP_PITCH_MAX : np);
  }

  // Restart on R when the run has ended (died or won); otherwise R reloads
  // the currently-equipped weapon.
  if (isKeyPressed(Key.R)) {
    if (gameOver || gameWon) resetRun();
    else if (currentWeapon === WEAPON_RIFLE) rifleAmmo = RIFLE_MAG;
    else blasterAmmo = BLASTER_MAG;
  }
  // Weapon switching with 1/2.
  if (isKeyPressed(Key.ONE))  { currentWeapon = WEAPON_RIFLE;   fireCD = 0; }
  if (isKeyPressed(Key.TWO))  { currentWeapon = WEAPON_BLASTER; fireCD = 0; }

  // Freeze player movement while dead or after victory; physics still steps.
  if (!gameOver && !gameWon) {
    const yawNow = CAM[0];
    const fwd = vec3(Math.sin(yawNow), 0, -Math.cos(yawNow));
    const rgt = vec3(Math.cos(yawNow), 0, Math.sin(yawNow));
    updatePlayerController(dt, input.moveX, input.moveZ, fwd, rgt, input.jump);
  }
  stepPhysics(physics, dt);
  // Smooth orbit camera follow after physics step.
  // Inline orbit-camera follow.
  {
    const pp0 = playerPosition();
    const ya = CAM[0], pi = CAM[1];
    const cpi = Math.cos(pi), spi = Math.sin(pi);
    const fX = pp0.x;
    const fY = pp0.y + TP_EYE_HEIGHT;
    const fZ = pp0.z;
    const wX = fX - Math.sin(ya) * cpi * TP_ORBIT_DIST;
    const wY = fY + spi * TP_ORBIT_DIST;
    const wZ = fZ + Math.cos(ya) * cpi * TP_ORBIT_DIST;
    if (CAM[8] === 0) {
      CAM[2] = wX; CAM[3] = wY; CAM[4] = wZ;
      CAM[5] = fX; CAM[6] = fY; CAM[7] = fZ;
      CAM[8] = 1;
    } else {
      const t = 1 - Math.exp(-TP_SMOOTH * dt);
      CAM[2] = CAM[2] + (wX - CAM[2]) * t;
      CAM[3] = CAM[3] + (wY - CAM[3]) * t;
      CAM[4] = CAM[4] + (wZ - CAM[4]) * t;
      CAM[5] = CAM[5] + (fX - CAM[5]) * t;
      CAM[6] = CAM[6] + (fY - CAM[6]) * t;
      CAM[7] = CAM[7] + (fZ - CAM[7]) * t;
    }
  }
  playerAnimT = playerAnimT + dt;

  // ---- Enemy AI + wave director (M5 / M6) -------------------------------
  if (!gameOver && !gameWon) {
    const pp = playerPosition();
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (enAlive[i] === 0) continue;
      const k = enKind[i];
      const dx = pp.x - enX[i];
      const dz = pp.z - enZ[i];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > KIND_MELEE[k]) {
        const step = KIND_SPEED[k] * dt;
        const move = step < dist ? step : dist;
        enX[i] = enX[i] + (dx / dist) * move;
        enZ[i] = enZ[i] + (dz / dist) * move;
        setBodyPosition(enBody[i],
          vec3(enX[i], enY[i] + KIND_Y_OFF[k], enZ[i]), true);
      } else if (enAttackCD[i] <= 0) {
        playerHP = playerHP - KIND_DMG[k];
        damageFlashT = 0.5;
        enAttackCD[i] = KIND_CD[k];
        playSound(sfxAttack);
        if (playerHP <= 0) { playerHP = 0; gameOver = true; }
      }
      if (enAttackCD[i] > 0) enAttackCD[i] = enAttackCD[i] - dt;
      if (enFlashT[i]   > 0) enFlashT[i]   = enFlashT[i]   - dt;
      enPhase[i] = enPhase[i] + dt;   // seconds into current animation
    }

    // Pickups — proximity collect, respawn after delay.
    for (let i = 0; i < PICKUP_COUNT; i++) {
      if (pickupActive[i] === 0) {
        pickupRespawnT[i] = pickupRespawnT[i] - dt;
        if (pickupRespawnT[i] <= 0) pickupActive[i] = 1;
        continue;
      }
      const pdx = pp.x - pickupX[i];
      const pdz = pp.z - pickupZ[i];
      if (pdx * pdx + pdz * pdz < PICKUP_RADIUS * PICKUP_RADIUS) {
        if (pickupKind[i] === PICKUP_RIFLE) {
          rifleAmmo = Math.min(RIFLE_MAG, rifleAmmo + PICKUP_RIFLE_AMT);
        } else {
          blasterAmmo = Math.min(BLASTER_MAG, blasterAmmo + PICKUP_BLASTER_AMT);
        }
        pickupActive[i] = 0;
        pickupRespawnT[i] = PICKUP_RESPAWN;
        playSound(sfxPickup);
      }
    }

    // Wave director
    const alive = countAlive();
    if (waveIdx < wavePlan.length) {
      if (waveBreakTimer > 0) {
        waveBreakTimer = waveBreakTimer - dt;
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
          waveIdx = waveIdx + 1;
          waveSpawned = 0;
          waveBreakTimer = WAVE_BREAK_DELAY;
          if (waveIdx >= wavePlan.length) gameWon = true;
        }
      }
    }
  }

  // testFrame is incremented above the input block so the mouse-settle
  // grace period uses the same counter.
  let forceFire = false;
  if (SELFTEST) {
    waveBreakTimer = 9999;                  // suppress wave spawns during test
    if (testFrame < 5) { CAM[0] = 0; CAM[1] = 0.35; CAM[8] = 0; }   // reset camera each settle-frame
    if (testFrame === 5)  injectKeyDown(Key.W);    // hold W from frame 5
    if (testFrame === 30) { screenshotSeq++; takeScreenshot('shooter_selftest_' + screenshotSeq + '_tp_moving.png'); }
    if (testFrame === 60) { injectKeyUp(Key.W); screenshotSeq++; takeScreenshot('shooter_selftest_' + screenshotSeq + '_tp_stopped.png'); }
    if (testFrame === 90) break;
  }

  // ---- Fire (M4 / M7) ---------------------------------------------------
  if (fireCD > 0) fireCD = fireCD - dt;
  const combatActive = !gameOver && !gameWon && cursorLocked;
  const isRifle    = currentWeapon === WEAPON_RIFLE;
  const haveAmmo   = isRifle ? rifleAmmo > 0 : blasterAmmo > 0;
  // Rifle = full-auto (mouse held); blaster = tap (press edge only).
  const fireIntent = combatActive && haveAmmo && fireCD <= 0 &&
                     (isRifle ? input.fireDown : input.firePressed);
  if (fireIntent || (forceFire && haveAmmo && combatActive)) {
    shotsFired = shotsFired + 1;
    muzzleFlashT = 0.05;
    playSound(sfxFire);
    // Raycast from the camera along its aim direction, offset past the
    // player so we don't hit our own capsule. Orbit distance is ~4.5m;
    // 5m offset clears the player body reliably.
    const camOrigin = vec3(CAM[2], CAM[3], CAM[4]);
    const adx = CAM[5] - CAM[2], ady = CAM[6] - CAM[3], adz = CAM[7] - CAM[4];
    const alen = Math.sqrt(adx*adx + ady*ady + adz*adz);
    const aim = alen > 0 ? vec3(adx/alen, ady/alen, adz/alen) : vec3(0, 0, -1);
    const originX = camOrigin.x + aim.x * 5.0;
    const originY = camOrigin.y + aim.y * 5.0;
    const originZ = camOrigin.z + aim.z * 5.0;

    if (isRifle) {
      rifleAmmo = rifleAmmo - 1;
      fireCD = RIFLE_FIRE_CD;
      const hit = raycast(physics, vec3(originX, originY, originZ), aim,
                          FIRE_RANGE, ALL_LAYERS_MASK);
      if (hit) {
        shotsHit = shotsHit + 1;
        spawnSpark(hit.point);
        for (let i = 0; i < MAX_ENEMIES; i++) {
          if (enAlive[i] > 0 && hit.body === enBody[i]) {
            enHP[i] = enHP[i] - RIFLE_DAMAGE;
            enFlashT[i] = DRETCH_HIT_FLASH;
            if (enHP[i] <= 0) {
              enAlive[i] = 0;
              enY[i] = -100;
              setBodyPosition(enBody[i], vec3(enX[i], -100, enZ[i]), false);
              playSound(sfxAttack);   // reuse clank as death thud
            }
            break;
          }
        }
      }
    } else {
      blasterAmmo = blasterAmmo - 1;
      fireCD = BLASTER_FIRE_CD;
      spawnProjectile(originX, originY, originZ,
                      aim.x * BLASTER_PROJ_SPEED,
                      aim.y * BLASTER_PROJ_SPEED,
                      aim.z * BLASTER_PROJ_SPEED);
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
      spawnSpark(hit.point);
      for (let j = 0; j < MAX_ENEMIES; j++) {
        if (enAlive[j] > 0 && hit.body === enBody[j]) {
          enHP[j] = enHP[j] - BLASTER_DAMAGE;
          enFlashT[j] = DRETCH_HIT_FLASH;
          shotsHit = shotsHit + 1;
          if (enHP[j] <= 0) {
            enAlive[j] = 0;
            enY[j] = -100;
            setBodyPosition(enBody[j], vec3(enX[j], -100, enZ[j]), false);
            playSound(sfxAttack);
          }
          break;
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
  for (let i = 0; i < SPARK_MAX; i++) {
    if (sparkT[i] > 0) sparkT[i] = sparkT[i] - dt;
  }

  clearBackground({ r: 22, g: 25, b: 35, a: 255 });
  setAmbientLight({ r: 120, g: 130, b: 160, a: 255 }, 0.35);
  setDirectionalLight(vec3(-0.3, -0.9, -0.2), { r: 255, g: 245, b: 220, a: 255 }, 0.9);

  beginMode3D({
    position: vec3(CAM[2], CAM[3], CAM[4]),
    target:   vec3(CAM[5], CAM[6], CAM[7]),
    up: vec3(0, 1, 0),
    fovy: TP_FOVY,
    projection: 0,
  });

  // M8: warm amber fills at the 4 arena corners — mood lighting.
  addPointLight(-18, 3.0, -18, 18, 1.0, 0.75, 0.45, 0.9);
  addPointLight( 18, 3.0, -18, 18, 1.0, 0.75, 0.45, 0.9);
  addPointLight(-18, 3.0,  18, 18, 1.0, 0.75, 0.45, 0.9);
  addPointLight( 18, 3.0,  18, 18, 1.0, 0.75, 0.45, 0.9);

  // Muzzle flare at the player's torso when firing.
  if (muzzleFlashT > 0) {
    const pp = playerPosition();
    addPointLight(pp.x, pp.y + 1.2, pp.z, 6, 1.0, 0.85, 0.5, 3.5);
  }

  drawModel(mdlArena, vec3(0, 0, 0), 1.0, WHITE);

  // Player: skinned + animated. Face the camera's horizontal yaw (so the
  // character always looks "away from the camera"). Walk if input is
  // nonzero, idle otherwise. A debug sphere at the capsule centre is
  // always drawn as a fallback so the player's position is visible even
  // if the skinned model fails to render.
  {
    const pp = playerPosition();
    drawSphere(vec3(pp.x, pp.y, pp.z), 0.25, { r: 255, g: 120, b: 120, a: 180 });
    const moving = input.moveX !== 0 || input.moveZ !== 0;
    const camYaw = CAM[0];
    const fsin = Math.sin(camYaw);
    const fcos = -Math.cos(camYaw);
    const panim = moving ? PLAYER_ANIM_WALK : PLAYER_ANIM_IDLE;
    updateModelAnimation(animPlayer, panim, playerAnimT, PLAYER_SCALE,
      pp.x, pp.y + PLAYER_MODEL_Y_OFFSET, pp.z, fsin, fcos);
    drawModel(mdlPlayer, vec3(pp.x, pp.y + PLAYER_MODEL_Y_OFFSET, pp.z),
              PLAYER_SCALE, WHITE);
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
    const distA = Math.sqrt(dxA * dxA + dzA * dzA);
    const faceSin = distA > 0.001 ? dxA / distA : 0;
    const faceCos = distA > 0.001 ? -dzA / distA : -1;
    const attacking = distA <= KIND_MELEE[k];
    const animIdx = attacking ? ANIM_ATTACK_IDX[k] : ANIM_WALK_IDX[k];
    updateModelAnimation(animAliens[k], animIdx, enPhase[i], KIND_SCALE[k],
      enX[i], enY[i], enZ[i], faceSin, faceCos);
    const f = enFlashT[i] > 0 ? enFlashT[i] / DRETCH_HIT_FLASH : 0;
    const tint = f > 0
      ? { r: 255,
          g: Math.floor(255 * (1 - f)),
          b: Math.floor(255 * (1 - f)),
          a: 255 }
      : WHITE;
    drawModel(mdlAliens[k], vec3(enX[i], enY[i], enZ[i]), KIND_SCALE[k], tint);
  }
  // Pickups — bobbing cubes, color-coded per kind.
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
  // Impact sparks — small yellow puffs that fade over 0.35s.
  for (let i = 0; i < SPARK_MAX; i++) {
    if (sparkT[i] > 0) {
      const t = sparkT[i] / 0.35;
      const a = Math.min(255, Math.floor(t * 255));
      drawSphere(vec3(sparkX[i], sparkY[i], sparkZ[i]), 0.25 * t + 0.05,
        { r: 255, g: 240, b: 140, a });
    }
  }
  // Blaster projectiles — glowing cyan spheres.
  for (let i = 0; i < MAX_PROJ; i++) {
    if (pLife[i] > 0) {
      drawSphere(vec3(pX[i], pY[i], pZ[i]), 0.16,
        { r: 140, g: 220, b: 255, a: 255 });
    }
  }
  endMode3D();

  // Crosshair — brighten while firing
  const crossA = muzzleFlashT > 0 ? 240 : 160;
  drawCircle(sw / 2, sh / 2, 3, { r: 255, g: 255, b: 255, a: crossA });
  // Muzzle flash — small warm smudge near the crosshair, not full-screen.
  if (muzzleFlashT > 0) {
    const fa = Math.floor((muzzleFlashT / 0.05) * 180);
    drawCircle(sw / 2, sh / 2 + 4, 14, { r: 255, g: 220, b: 120, a: fa });
  }

  // Damage vignette — red screen edges when the player takes a hit.
  if (damageFlashT > 0) {
    const fa = Math.floor((damageFlashT / 0.5) * 120);
    drawRect(0, 0, sw, 60, { r: 200, g: 20, b: 20, a: fa });
    drawRect(0, sh - 60, sw, 60, { r: 200, g: 20, b: 20, a: fa });
    drawRect(0, 0, 60, sh, { r: 200, g: 20, b: 20, a: fa });
    drawRect(sw - 60, 0, 60, sh, { r: 200, g: 20, b: 20, a: fa });
  }

  // Player HP bar — bottom-left.
  const phpW = 220;
  const phpFill = Math.max(0, Math.floor(phpW * (playerHP / PLAYER_HP_MAX)));
  drawRect(10, sh - 68, phpW, 18, { r: 30, g: 10, b: 10, a: 180 });
  drawRect(10, sh - 68, phpFill, 18, { r: 180, g: 60, b: 50, a: 230 });
  drawText('HP ' + playerHP, 18, sh - 65, 14, { r: 240, g: 240, b: 240, a: 255 });

  // Weapon + ammo — bottom-right.
  const isRifleHud = currentWeapon === WEAPON_RIFLE;
  const curAmmo = isRifleHud ? rifleAmmo : blasterAmmo;
  const curMag  = isRifleHud ? RIFLE_MAG : BLASTER_MAG;
  const wtxt = WEAPON_NAMES[currentWeapon] + '  ' + curAmmo + ' / ' + curMag;
  drawRect(sw - 260, sh - 68, 250, 18, { r: 0, g: 0, b: 0, a: 150 });
  drawText(wtxt + '   [1/2 switch  R reload]',
           sw - 252, sh - 65, 13, { r: 240, g: 230, b: 180, a: 255 });

  // Wave HUD — top-center. Shows "WAVE X — enemies K/N" while spawning,
  // or a "NEXT WAVE IN ..." countdown between waves.
  const aliveNow = countAlive();
  if (!gameOver && !gameWon) {
    if (waveBreakTimer > 0 && waveIdx < wavePlan.length) {
      const label = 'WAVE ' + (waveIdx + 1) + ' IN ' + waveBreakTimer.toFixed(1) + 's';
      const lw = measureText(label, 22);
      drawText(label, (sw - lw) / 2, 18, 22, { r: 230, g: 220, b: 160, a: 230 });
    } else if (waveIdx < wavePlan.length) {
      const waveSize = wavePlan[waveIdx];
      const remaining = (waveSize - waveSpawned) + aliveNow;
      const label = 'WAVE ' + (waveIdx + 1) + ' — ' + remaining + ' / ' + waveSize;
      const lw = measureText(label, 20);
      drawText(label, (sw - lw) / 2, 18, 20, { r: 230, g: 220, b: 160, a: 230 });
    }
  }

  // Game over overlay.
  if (gameOver) {
    drawRect(0, 0, sw, sh, { r: 0, g: 0, b: 0, a: 170 });
    const msg = 'YOU DIED';
    const mw = measureText(msg, 56);
    drawText(msg, (sw - mw) / 2, sh * 0.35, 56, { r: 220, g: 60, b: 50, a: 255 });
    const sub = 'Reached wave ' + (waveIdx + 1) + ' — press R to restart';
    const sww = measureText(sub, 22);
    drawText(sub, (sw - sww) / 2, sh * 0.35 + 72, 22, { r: 220, g: 220, b: 220, a: 230 });
  }

  // Victory overlay.
  if (gameWon) {
    drawRect(0, 0, sw, sh, { r: 0, g: 0, b: 0, a: 170 });
    const msg = 'ARENA CLEARED';
    const mw = measureText(msg, 52);
    drawText(msg, (sw - mw) / 2, sh * 0.33, 52, { r: 180, g: 230, b: 180, a: 255 });
    const sub = 'Survived all ' + wavePlan.length + ' waves — press R to play again';
    const sww = measureText(sub, 22);
    drawText(sub, (sw - sww) / 2, sh * 0.33 + 70, 22, { r: 220, g: 220, b: 220, a: 230 });
  }

  // Diagnostic HUD — helps verify input is reaching the game
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
    + '  shots ' + shotsHit + '/' + shotsFired;

  drawRect(0, sh - 44, sw, 44, { r: 0, g: 0, b: 0, a: 150 });
  drawText(diag1, 10, sh - 40, 13, { r: 200, g: 210, b: 230, a: 220 });
  drawText(diag2, 10, sh - 20, 13, { r: 180, g: 200, b: 220, a: 220 });

  if (isKeyPressed(Key.ESCAPE)) break;
  endDrawing();
}
