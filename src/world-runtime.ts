// Runtime world loading — this replaced a build-time bake (`tools/build-world.ts`,
// now deleted).
//
// The world file is now read and parsed when the game starts, so editing a
// level in the Bloom editor and relaunching is enough: no regeneration step, no
// recompile. The baker existed because Perry 0.4.x returned arrays from
// JSON.parse whose `.length` read as undefined; that is fixed (verified on
// 0.5.1208), so the workaround can go.
//
// This module exposes exactly the surface `main.ts` already consumed from the
// generated module — flat parallel arrays, numbers not strings — so the game
// loop is unchanged. What used to be frozen at build time is now derived here at
// startup, once.
//
// Two rules from docs/perry-quirks.md govern everything below:
//   - Build arrays with `new Array<number>(n)` + index assignment. `.push()`
//     produces arrays whose `.length` reports the literal initial size.
//   - Parsing strings (halfExtents, the wave plan) happens HERE, at load, and
//     never on a per-frame path.

import { loadWorld, createEmptyWorld, WorldData, EntityData } from 'bloom/world';
import { readFile, fileExists } from 'bloom/core';

// SH-040 — the level is no longer hardcoded.
//
// This module used to pin `arena_02` in a const, which meant the game could
// only ever ship one level no matter how many the editor produced. The whole
// world pipeline (runtime loadWorld, editor round-trip, per-world wave plans in
// `wave_config`) already supported N levels; only the game pretended otherwise.
//
// The arena list is a manifest so adding a level is a JSON edit, not a code
// change — and the runtime resolves it at MODULE LOAD, before anything reads a
// world array, because every export below is derived from it.
//
// Selection order: `level.txt` (written by the menu's level select) → the
// manifest's `default` → arena_02. Kept as a plain text file rather than a
// field in settings.json so that a corrupt settings file can never strand the
// player in a level that will not load.

const MANIFEST_PATH = 'assets/worlds/arenas.json';
const SELECTED_PATH = 'level.txt';

export interface ArenaEntry { id: string; name: string; path: string; }

function loadManifest(): ArenaEntry[] {
  if (!fileExists(MANIFEST_PATH)) {
    // No manifest — fall back to the one arena we know shipped.
    const one: ArenaEntry[] = new Array<ArenaEntry>(1);
    one[0] = { id: 'arena_02', name: 'Outdoor Plaza',
               path: 'assets/worlds/arena_02.world.json' };
    return one;
  }
  const txt = readFile(MANIFEST_PATH);
  const obj: any = JSON.parse(txt);
  const arr: any = obj['arenas'];
  const n: number = arr.length;
  const out: ArenaEntry[] = new Array<ArenaEntry>(n);
  for (let i = 0; i < n; i++) {
    const a: any = arr[i];
    out[i] = { id: a['id'] as string, name: a['name'] as string, path: a['path'] as string };
  }
  return out;
}

export const ARENAS: ArenaEntry[] = loadManifest();
export const ARENA_COUNT = ARENAS.length;

function pickArena(): number {
  if (fileExists(SELECTED_PATH)) {
    const want = readFile(SELECTED_PATH).trim();
    for (let i = 0; i < ARENA_COUNT; i++) {
      if (ARENAS[i].id === want) return i;
    }
  }
  return 0;
}

export const ARENA_INDEX = pickArena();

/// `--world <path>` overrides the manifest entirely.
///
/// This is what "play-in-editor" is built on: the editor saves the level you are
/// looking at to a scratch file and launches the game pointed straight at it. A
/// level you can only test by adding it to a manifest first is a level you will not
/// test often enough.
function worldFromArgs(): string {
  const n = process.argv.length;
  for (let i = 0; i < n - 1; i++) {
    if (process.argv[i] === '--world') return process.argv[i + 1];
  }
  return '';
}
const ARG_WORLD = worldFromArgs();
const WORLD_PATH = ARG_WORLD.length > 0 ? ARG_WORLD : ARENAS[ARENA_INDEX].path;

/// Called by the level-select UI. Writes the choice and returns true; the game
/// re-reads it on the next launch (the world's colliders, scatters and GI
/// proxies are all built at startup, so a mid-run swap would mean tearing all
/// of that down — EN-032's async load is the ticket that makes it seamless).
export function selectArena(id: string): void {
  writeFileRaw(SELECTED_PATH, id);
}

// Small local wrapper so the import list above stays honest about what it uses.
import { writeFile as writeFileRaw } from 'bloom/core';

// loadWorld throws on a missing file, bad JSON, or failed validation. Catch it
// here so a broken world file reports itself and yields an empty arena, rather
// than dying somewhere inside the render loop with no context.
let loadedWorld: WorldData;
try {
  loadedWorld = loadWorld(WORLD_PATH);
} catch (e) {
  console.error('world: ' + (e as Error).message);
  loadedWorld = createEmptyWorld('empty', 'Failed to load ' + WORLD_PATH);
}
const world: WorldData = loadedWorld;

export const WORLD_NAME = world.name;
export const WORLD_ID = world.id;

// ---- environment -------------------------------------------------------------

const env = world.environment;
export const ENV_SKY_R = env.skyColor[0];
export const ENV_SKY_G = env.skyColor[1];
export const ENV_SKY_B = env.skyColor[2];
export const ENV_AMBIENT_R = env.ambientColor[0];
export const ENV_AMBIENT_G = env.ambientColor[1];
export const ENV_AMBIENT_B = env.ambientColor[2];
export const ENV_AMBIENT_I = env.ambientIntensity;
export const ENV_SUN_DIR_X = env.sunDirection[0];
export const ENV_SUN_DIR_Y = env.sunDirection[1];
export const ENV_SUN_DIR_Z = env.sunDirection[2];
export const ENV_SUN_R = env.sunColor[0];
export const ENV_SUN_G = env.sunColor[1];
export const ENV_SUN_B = env.sunColor[2];
export const ENV_SUN_I = env.sunIntensity;
export const ENV_FOG_START = env.fogStart;
export const ENV_FOG_END = env.fogEnd;
export const ENV_FOG_R = env.fogColor[0];
export const ENV_FOG_G = env.fogColor[1];
export const ENV_FOG_B = env.fogColor[2];

// ---- entity buckets ----------------------------------------------------------
//
// Game-defined kinds live in `userData.kind` — the schema deliberately knows
// nothing about spawners or wave plans (lights and water are engine concepts and
// are first-class; see the engine's world schema). Bucketing happens once.

function bucket(kind: string): EntityData[] {
  const all = world.entities;
  let n = 0;
  for (let i = 0; i < all.length; i++) {
    if (all[i].userData['kind'] === kind) n = n + 1;
  }
  const out = new Array<EntityData>(n);
  let w = 0;
  for (let i = 0; i < all.length; i++) {
    if (all[i].userData['kind'] === kind) {
      out[w] = all[i];
      w = w + 1;
    }
  }
  return out;
}

// "40, 4, 0.5" -> component. Load-time only.
function vec3Part(s: string | undefined, idx: number, fallback: number): number {
  if (s === undefined || s.length === 0) return fallback;
  const parts = s.split(',');
  if (parts.length !== 3) return fallback;
  const v = parseFloat(parts[idx]);
  return v === v ? v : fallback;
}

// ---- player spawn ------------------------------------------------------------

const spawns = bucket('player_spawn');
let spawnX = 0;
let spawnY = 1;
let spawnZ = 0;
let spawnYaw = 0;
for (let i = 0; i < spawns.length; i++) {
  const s = spawns[i];
  const primary = s.userData['primary'] === '1';
  if (i === 0 || primary) {
    spawnX = s.transform.position[0];
    spawnY = s.transform.position[1];
    spawnZ = s.transform.position[2];
    const yaw = s.userData['yaw'];
    spawnYaw = yaw !== undefined ? parseFloat(yaw) : 0;
    if (spawnYaw !== spawnYaw) spawnYaw = 0;
    if (primary) break;
  }
}
export const SPAWN_X = spawnX;
export const SPAWN_Y = spawnY;
export const SPAWN_Z = spawnZ;
export const SPAWN_YAW = spawnYaw;

// ---- collider_box ------------------------------------------------------------

const cols = bucket('collider_box');
export const COLLIDER_COUNT = cols.length;
export const COLLIDER_X = new Array<number>(COLLIDER_COUNT);
export const COLLIDER_Y = new Array<number>(COLLIDER_COUNT);
export const COLLIDER_Z = new Array<number>(COLLIDER_COUNT);
export const COLLIDER_HALF_X = new Array<number>(COLLIDER_COUNT);
export const COLLIDER_HALF_Y = new Array<number>(COLLIDER_COUNT);
export const COLLIDER_HALF_Z = new Array<number>(COLLIDER_COUNT);
for (let i = 0; i < COLLIDER_COUNT; i++) {
  const e = cols[i];
  const he = e.userData['halfExtents'];
  COLLIDER_X[i] = e.transform.position[0];
  COLLIDER_Y[i] = e.transform.position[1];
  COLLIDER_Z[i] = e.transform.position[2];
  COLLIDER_HALF_X[i] = vec3Part(he, 0, 0.5);
  COLLIDER_HALF_Y[i] = vec3Part(he, 1, 0.5);
  COLLIDER_HALF_Z[i] = vec3Part(he, 2, 0.5);
}

// ---- static_mesh -------------------------------------------------------------
//
// modelRef is resolved to an index into a unique-model list, so the runtime
// loads each GLB once and draws by index. `_gizmo_box.glb` is a sentinel for
// "no mesh, draw a coloured box" — the same convention the editor renders as a
// placeholder cube.

const meshes = bucket('static_mesh');
export const MESH_COUNT = meshes.length;

const modelRefs = new Array<string>(MESH_COUNT);
for (let i = 0; i < MESH_COUNT; i++) {
  const r = meshes[i].modelRef;
  modelRefs[i] = r !== null ? r : '';
}

// Unique-ify without .push().
const uniqueTmp = new Array<string>(MESH_COUNT);
let uniqueN = 0;
const meshModelIdx = new Array<number>(MESH_COUNT);
for (let i = 0; i < MESH_COUNT; i++) {
  const ref = modelRefs[i];
  let found = -1;
  for (let u = 0; u < uniqueN; u++) {
    if (uniqueTmp[u] === ref) { found = u; break; }
  }
  if (found < 0) {
    uniqueTmp[uniqueN] = ref;
    found = uniqueN;
    uniqueN = uniqueN + 1;
  }
  meshModelIdx[i] = found;
}

export const UNIQUE_MODEL_COUNT = uniqueN;
export const UNIQUE_MODELS = new Array<string>(uniqueN);
export const MODEL_IS_BOX = new Array<number>(uniqueN);
for (let i = 0; i < uniqueN; i++) {
  const path = uniqueTmp[i];
  UNIQUE_MODELS[i] = path;
  const isBox = path.length === 0 || path.endsWith('_gizmo_box.glb');
  MODEL_IS_BOX[i] = isBox ? 1 : 0;
}

export const MESH_MODEL_IDX = meshModelIdx;
export const MESH_X = new Array<number>(MESH_COUNT);
export const MESH_Y = new Array<number>(MESH_COUNT);
export const MESH_Z = new Array<number>(MESH_COUNT);
export const MESH_ROT_Y = new Array<number>(MESH_COUNT);
export const MESH_SCALE = new Array<number>(MESH_COUNT);
export const MESH_COLLIDER = new Array<number>(MESH_COUNT);
export const MESH_COLLIDER_HX = new Array<number>(MESH_COUNT);
export const MESH_COLLIDER_HY = new Array<number>(MESH_COUNT);
export const MESH_COLLIDER_HZ = new Array<number>(MESH_COUNT);
export const MESH_CATEGORY = new Array<number>(MESH_COUNT);

for (let i = 0; i < MESH_COUNT; i++) {
  const e = meshes[i];
  const he = e.userData['halfExtents'];
  MESH_X[i] = e.transform.position[0];
  MESH_Y[i] = e.transform.position[1];
  MESH_Z[i] = e.transform.position[2];
  MESH_ROT_Y[i] = e.transform.rotation[1];
  MESH_SCALE[i] = e.transform.scale[0];
  MESH_COLLIDER[i] = e.userData['collider'] === 'box' ? 1 : 0;
  MESH_COLLIDER_HX[i] = vec3Part(he, 0, 0.5);
  MESH_COLLIDER_HY[i] = vec3Part(he, 1, 0.5);
  MESH_COLLIDER_HZ[i] = vec3Part(he, 2, 0.5);

  // Paint category from the first tag: 0 generic, 1 building, 2 terrain, 3 prop.
  const tag = e.tags.length > 0 ? e.tags[0] : '';
  let cat = 0;
  if (tag === 'building') cat = 1;
  else if (tag === 'terrain') cat = 2;
  else if (tag === 'prop') cat = 3;
  MESH_CATEGORY[i] = cat;
}

// ---- water -------------------------------------------------------------------

export const WATER_COUNT = world.water.length;
export const WATER_CX = new Array<number>(WATER_COUNT);
export const WATER_CY = new Array<number>(WATER_COUNT);
export const WATER_CZ = new Array<number>(WATER_COUNT);
export const WATER_SX = new Array<number>(WATER_COUNT);
export const WATER_SZ = new Array<number>(WATER_COUNT);
export const WATER_R = new Array<number>(WATER_COUNT);
export const WATER_G = new Array<number>(WATER_COUNT);
export const WATER_B = new Array<number>(WATER_COUNT);
export const WATER_A = new Array<number>(WATER_COUNT);
export const WATER_WAVE_AMP = new Array<number>(WATER_COUNT);
export const WATER_WAVE_SPD = new Array<number>(WATER_COUNT);
for (let i = 0; i < WATER_COUNT; i++) {
  const w = world.water[i];
  WATER_CX[i] = w.center[0];
  WATER_CY[i] = w.surfaceHeight;
  WATER_CZ[i] = w.center[2];
  WATER_SX[i] = w.size[0];
  WATER_SZ[i] = w.size[2];
  WATER_R[i] = w.color[0];
  WATER_G[i] = w.color[1];
  WATER_B[i] = w.color[2];
  WATER_A[i] = w.color[3];
  WATER_WAVE_AMP[i] = w.waveAmplitude;
  WATER_WAVE_SPD[i] = w.waveSpeed;
}

// ---- lights (schema v2: top-level, not entities) ------------------------------

export const LIGHT_COUNT = world.lights.length;
export const LIGHT_X = new Array<number>(LIGHT_COUNT);
export const LIGHT_Y = new Array<number>(LIGHT_COUNT);
export const LIGHT_Z = new Array<number>(LIGHT_COUNT);
export const LIGHT_RANGE = new Array<number>(LIGHT_COUNT);
export const LIGHT_R = new Array<number>(LIGHT_COUNT);
export const LIGHT_G = new Array<number>(LIGHT_COUNT);
export const LIGHT_B = new Array<number>(LIGHT_COUNT);
export const LIGHT_INT = new Array<number>(LIGHT_COUNT);
for (let i = 0; i < LIGHT_COUNT; i++) {
  const l = world.lights[i];
  LIGHT_X[i] = l.position[0];
  LIGHT_Y[i] = l.position[1];
  LIGHT_Z[i] = l.position[2];
  LIGHT_RANGE[i] = l.range;
  LIGHT_R[i] = l.color[0];
  LIGHT_G[i] = l.color[1];
  LIGHT_B[i] = l.color[2];
  LIGHT_INT[i] = l.intensity;
}

// ---- enemy spawners ----------------------------------------------------------

const spawners = bucket('enemy_spawner');
export const SPAWNER_COUNT = spawners.length;
export const SPAWNER_X = new Array<number>(SPAWNER_COUNT);
export const SPAWNER_Z = new Array<number>(SPAWNER_COUNT);
for (let i = 0; i < SPAWNER_COUNT; i++) {
  SPAWNER_X[i] = spawners[i].transform.position[0];
  SPAWNER_Z[i] = spawners[i].transform.position[2];
}

// ---- weapon pickups ----------------------------------------------------------

const pickups = bucket('weapon_pickup');
export const PICKUP_COUNT = pickups.length;
export const PICKUP_X = new Array<number>(PICKUP_COUNT);
export const PICKUP_Z = new Array<number>(PICKUP_COUNT);
export const PICKUP_KIND = new Array<number>(PICKUP_COUNT);
for (let i = 0; i < PICKUP_COUNT; i++) {
  PICKUP_X[i] = pickups[i].transform.position[0];
  PICKUP_Z[i] = pickups[i].transform.position[2];
  // 0 = rifle, 1 = blaster.
  PICKUP_KIND[i] = pickups[i].userData['weapon'] === 'blaster' ? 1 : 0;
}

// ---- wave plan ---------------------------------------------------------------
//
// `wave_config.userData.waves` is an escaped-JSON string of [{count, enemy}],
// where `enemy` may be a comma-separated sequence so one wave can mix kinds.
// Expanded here into two flat arrays, once, so the wave director never parses.

// SH-042 — order IS the kind index (main.ts's KIND_NAME / KIND_* tables index
// by it). The last two are Unvanquished's upgrade classes, and they are the
// game's only RANGED enemies.
const ENEMY_KIND_NAMES = ['dretch', 'mantis', 'marauder', 'dragoon', 'tyrant',
                          'adv_marauder', 'adv_dragoon'];

const waveEnts = bucket('wave_config');
let planCount = 0;
let kindTotal = 0;
let waveSize = new Array<number>(0);
let waveOffs = new Array<number>(0);
let waveKind = new Array<number>(0);

if (waveEnts.length > 0) {
  const raw = waveEnts[0].userData['waves'];
  if (raw !== undefined && raw.length > 0) {
    const waves = JSON.parse(raw);
    planCount = waves.length;

    for (let i = 0; i < planCount; i++) {
      kindTotal = kindTotal + waves[i].count;
    }

    waveSize = new Array<number>(planCount);
    waveOffs = new Array<number>(planCount);
    waveKind = new Array<number>(kindTotal);

    let off = 0;
    for (let i = 0; i < planCount; i++) {
      const w = waves[i];
      const count = w.count;
      waveSize[i] = count;
      waveOffs[i] = off;

      const names = w.enemy.split(',');
      const nameCount = names.length;
      for (let k = 0; k < count; k++) {
        const name = nameCount > 0 ? names[k % nameCount].trim() : 'dretch';
        let id = 0;
        for (let n = 0; n < ENEMY_KIND_NAMES.length; n++) {
          if (ENEMY_KIND_NAMES[n] === name) { id = n; break; }
        }
        waveKind[off + k] = id;
      }
      off = off + count;
    }
  }
}

export const WAVE_PLAN_COUNT = planCount;
export const WAVE_SIZE = waveSize;
export const WAVE_OFFS = waveOffs;
export const WAVE_KIND = waveKind;

// ---- forest ------------------------------------------------------------------
//
// The 88 trees used to be scattered at startup from a fixed LCG seed. That made
// them unauthorable: no tree had an identity, so "move that one off the path"
// could not be expressed. They are ordinary entities now (`bun
// tools/bake-forest-to-world.ts` seeded them from the same scatter), so the
// editor can move, delete, retint, or add one, and the game just reads them.
//
// Y is taken as authored rather than re-snapped to the terrain: the world file
// is the source of truth, and silently overriding a placement the editor made
// is worse than a tree that needs re-seating after a big sculpt.

const treeEnts = bucket('prop_tree');
export const FOREST_COUNT = treeEnts.length;
export const FOREST_X = new Array<number>(FOREST_COUNT);
export const FOREST_Y = new Array<number>(FOREST_COUNT);
export const FOREST_Z = new Array<number>(FOREST_COUNT);
export const FOREST_VAR = new Array<number>(FOREST_COUNT);
export const FOREST_YAW = new Array<number>(FOREST_COUNT);      // degrees (drawModelRotated)
export const FOREST_SCALE = new Array<number>(FOREST_COUNT);
export const FOREST_TINT_R = new Array<number>(FOREST_COUNT);
export const FOREST_TINT_G = new Array<number>(FOREST_COUNT);
export const FOREST_TINT_B = new Array<number>(FOREST_COUNT);

// The three tree GLBs, in variant order. A tree whose modelRef isn't one of them
// falls back to variant 0 rather than vanishing.
const TREE_MODEL_0 = 'assets/models/prop_tree.glb';
const TREE_MODEL_1 = 'assets/models/prop_tree2.glb';
const TREE_MODEL_2 = 'assets/models/prop_tree3.glb';

for (let i = 0; i < FOREST_COUNT; i++) {
  const e = treeEnts[i];
  FOREST_X[i] = e.transform.position[0];
  FOREST_Y[i] = e.transform.position[1];
  FOREST_Z[i] = e.transform.position[2];

  const ref = e.modelRef !== null ? e.modelRef : '';
  let variant = 0;
  if (ref === TREE_MODEL_1) variant = 1;
  else if (ref === TREE_MODEL_2) variant = 2;
  FOREST_VAR[i] = variant;

  // The world stores rotation in radians; drawModelRotated takes degrees.
  FOREST_YAW[i] = e.transform.rotation[1] * 180 / Math.PI;
  FOREST_SCALE[i] = e.transform.scale[0];

  // Entity tints are 0-1 (the schema's convention); the draw API takes 0-255.
  const tint = e.tint;
  const tr = tint !== null ? tint[0] : 1;
  const tg = tint !== null ? tint[1] : 1;
  const tb = tint !== null ? tint[2] : 1;
  FOREST_TINT_R[i] = Math.max(0, Math.min(255, Math.floor(tr * 255)));
  FOREST_TINT_G[i] = Math.max(0, Math.min(255, Math.floor(tg * 255)));
  FOREST_TINT_B[i] = Math.max(0, Math.min(255, Math.floor(tb * 255)));
}

// ---- scatter keep-out --------------------------------------------------------
//
// Where the procedural scatters (forest, grass) must not put anything: on the
// water, inside the building, or on top of the player's spawn.
//
// These used to be hardcoded rectangles copied out of the level by hand — the
// river at "z = 12", the building at "x -30..-12, z -19..-7". Move the river in
// the editor and the grass kept avoiding the old channel while growing out of
// the new one. Now the shapes are derived from the world data itself, so they
// cannot drift.
//
// Water rectangles, from the volumes. Rectangles (not the boxes' full extents)
// because the scatters are 2D — they only ask "may something grow here".

export const KEEPOUT_COUNT = WATER_COUNT + 1;   // water volumes + the building
const KEEPOUT_X0 = new Array<number>(KEEPOUT_COUNT);
const KEEPOUT_X1 = new Array<number>(KEEPOUT_COUNT);
const KEEPOUT_Z0 = new Array<number>(KEEPOUT_COUNT);
const KEEPOUT_Z1 = new Array<number>(KEEPOUT_COUNT);

for (let i = 0; i < WATER_COUNT; i++) {
  KEEPOUT_X0[i] = WATER_CX[i] - WATER_SX[i] / 2;
  KEEPOUT_X1[i] = WATER_CX[i] + WATER_SX[i] / 2;
  KEEPOUT_Z0[i] = WATER_CZ[i] - WATER_SZ[i] / 2;
  KEEPOUT_Z1[i] = WATER_CZ[i] + WATER_SZ[i] / 2;
}

// The building's footprint, as the bounding box of every `building`-tagged mesh
// (category 1) that carries a collider. Beats hardcoding the rect that the
// building generator happened to use, and follows the building if it moves.
{
  let bx0 = 0, bx1 = 0, bz0 = 0, bz1 = 0;
  let any = false;
  for (let i = 0; i < MESH_COUNT; i++) {
    if (MESH_CATEGORY[i] !== 1 || MESH_COLLIDER[i] !== 1) continue;
    const x0 = MESH_X[i] - MESH_COLLIDER_HX[i];
    const x1 = MESH_X[i] + MESH_COLLIDER_HX[i];
    const z0 = MESH_Z[i] - MESH_COLLIDER_HZ[i];
    const z1 = MESH_Z[i] + MESH_COLLIDER_HZ[i];
    if (!any) {
      bx0 = x0; bx1 = x1; bz0 = z0; bz1 = z1;
      any = true;
    } else {
      if (x0 < bx0) bx0 = x0;
      if (x1 > bx1) bx1 = x1;
      if (z0 < bz0) bz0 = z0;
      if (z1 > bz1) bz1 = z1;
    }
  }
  const i = WATER_COUNT;
  // An empty box (x0 > x1) rejects nothing, which is what we want when a world
  // has no building at all.
  KEEPOUT_X0[i] = any ? bx0 : 1;
  KEEPOUT_X1[i] = any ? bx1 : -1;
  KEEPOUT_Z0[i] = any ? bz0 : 1;
  KEEPOUT_Z1[i] = any ? bz1 : -1;
}

// True when (x, z) falls inside any keep-out rectangle, grown by `margin`.
// Callers pass their own margin: trees need more clearance than grass blades.
export function keepOut(x: number, z: number, margin: number): boolean {
  for (let i = 0; i < KEEPOUT_COUNT; i++) {
    if (x > KEEPOUT_X0[i] - margin && x < KEEPOUT_X1[i] + margin &&
        z > KEEPOUT_Z0[i] - margin && z < KEEPOUT_Z1[i] + margin) {
      return true;
    }
  }
  return false;
}

// ---- terrain -----------------------------------------------------------------
//
// The heightmap comes from the world file, which the editor sculpts. It feeds
// the Jolt heightfield, enemy ground-following, and the grass/tree scatter — so
// reshaping the ground in the editor changes collision and gameplay on the next
// launch, with nothing to regenerate. (The *visual* mesh is still baked from
// these same heights by `bun tools/build-terrain.ts`, which also adds the
// horizon skirt outside the arena.)
//
// A world with no terrain yields a flat plane at y = 0 rather than a crash.

const terrain = world.terrain;
const hasTerrain = terrain !== null;

export const TERRAIN_SAMPLE_COUNT = hasTerrain ? terrain.width : 2;
export const TERRAIN_CELL_SIZE = hasTerrain ? terrain.cellSize : 1;
export const TERRAIN_ORIGIN_X = hasTerrain ? terrain.origin[0] : 0;
export const TERRAIN_ORIGIN_Y = hasTerrain ? terrain.origin[1] : 0;
export const TERRAIN_ORIGIN_Z = hasTerrain ? terrain.origin[2] : 0;

const heightCount = TERRAIN_SAMPLE_COUNT * TERRAIN_SAMPLE_COUNT;
export const TERRAIN_HEIGHTS = new Array<number>(heightCount);
for (let i = 0; i < heightCount; i++) {
  TERRAIN_HEIGHTS[i] = hasTerrain ? terrain.heights[i] : 0;
}
