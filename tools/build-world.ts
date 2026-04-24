// Builds a Perry-safe TypeScript module from a Bloom world JSON file.
//
// Why: Perry 0.5.158's JSON.parse produces arrays whose `.length` reads as
// undefined (see docs/perry-quirks.md). So at runtime we can't read
// `.world.json` directly. This tool is a build step — run under `bun` — that
// reads the editor-authored world JSON and emits a sibling `.ts` module with
// literal-initialized flat arrays per entity kind. `src/main.ts` imports the
// generated file and consumes those arrays directly.
//
// Usage:
//   bun tools/build-world.ts assets/worlds/arena_02.world.json src/generated/world.ts
//
// The generated module exports one parallel flat-array block per entity kind
// (e.g. COLLIDER_X[], COLLIDER_Y[], COLLIDER_HALF_EXT_X[] …), plus scalar
// constants for the environment and spawn point. Strings that are always
// drawn from a known vocabulary (e.g. enemy kind names) are translated to
// numeric ids at build time so the generated module has no `.length`-sensitive
// string arrays.

import * as fs from 'fs';
import * as path from 'path';

interface Vec3Lit { 0: number; 1: number; 2: number; length: 3 }

interface EntityData {
  id: string;
  name: string;
  modelRef: string | null;
  prefabRef: string | null;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  tint: [number, number, number, number] | null;
  tags: string[];
  userData: Record<string, string>;
}

interface WaterVolume {
  id: string;
  kind: string;
  center: [number, number, number];
  size: [number, number, number];
  surfaceHeight: number;
  color: [number, number, number, number];
  waveAmplitude: number;
  waveSpeed: number;
}

interface WorldData {
  schemaVersion: number;
  name: string;
  id: string;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  environment: {
    skyColor: [number, number, number];
    ambientColor: [number, number, number];
    ambientIntensity: number;
    sunDirection: [number, number, number];
    sunColor: [number, number, number];
    sunIntensity: number;
    fogStart: number;
    fogEnd: number;
    fogColor: [number, number, number];
    shadowsEnabled: boolean;
  };
  terrain: unknown;
  entities: EntityData[];
  water: WaterVolume[];
  rivers: unknown[];
  metadata: Record<string, string>;
}

// Enemy kind names recognized by the shooter runtime. Index into this list is
// the numeric kind id emitted into ENEMY_SPAWNER_ENEMY_KIND[].
const ENEMY_KINDS = ['dretch', 'mantis', 'marauder', 'dragoon', 'tyrant'];
const PICKUP_KINDS = ['rifle', 'blaster'];

function fmtNumList(xs: number[]): string {
  if (xs.length === 0) return '[]';
  return '[' + xs.map(n => (Number.isInteger(n) ? n.toFixed(1) : n.toString())).join(', ') + ']';
}

function fmtStrList(xs: string[]): string {
  if (xs.length === 0) return '[]';
  return '[' + xs.map(s => JSON.stringify(s)).join(', ') + ']';
}

function parseVec3Str(s: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!s) return fallback;
  const parts = s.split(',').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return fallback;
  return [parts[0], parts[1], parts[2]];
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    console.error('usage: bun tools/build-world.ts <input.world.json> <output.ts>');
    process.exit(2);
  }

  const world: WorldData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  // Bucket entities by userData.kind. Unknown kinds are dropped with a warning
  // — the generated file stays compact and the game doesn't silently misbehave
  // on typos in the world file.
  const buckets: Record<string, EntityData[]> = {};
  for (const e of world.entities) {
    const k = e.userData.kind || 'unknown';
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(e);
  }

  const out: string[] = [];
  const header = path.relative(path.dirname(outputPath), inputPath);
  out.push('// GENERATED — do not edit by hand.');
  out.push(`// Source: ${header}`);
  out.push(`// Regenerate with: bun tools/build-world.ts ${header} ${path.relative(process.cwd(), outputPath)}`);
  out.push('');
  out.push(`export const WORLD_NAME = ${JSON.stringify(world.name)};`);
  out.push(`export const WORLD_ID = ${JSON.stringify(world.id)};`);
  out.push('');
  out.push('// Environment');
  const env = world.environment;
  out.push(`export const ENV_SKY_R = ${env.skyColor[0]};`);
  out.push(`export const ENV_SKY_G = ${env.skyColor[1]};`);
  out.push(`export const ENV_SKY_B = ${env.skyColor[2]};`);
  out.push(`export const ENV_AMBIENT_R = ${env.ambientColor[0]};`);
  out.push(`export const ENV_AMBIENT_G = ${env.ambientColor[1]};`);
  out.push(`export const ENV_AMBIENT_B = ${env.ambientColor[2]};`);
  out.push(`export const ENV_AMBIENT_I = ${env.ambientIntensity};`);
  out.push(`export const ENV_SUN_DIR_X = ${env.sunDirection[0]};`);
  out.push(`export const ENV_SUN_DIR_Y = ${env.sunDirection[1]};`);
  out.push(`export const ENV_SUN_DIR_Z = ${env.sunDirection[2]};`);
  out.push(`export const ENV_SUN_R = ${env.sunColor[0]};`);
  out.push(`export const ENV_SUN_G = ${env.sunColor[1]};`);
  out.push(`export const ENV_SUN_B = ${env.sunColor[2]};`);
  out.push(`export const ENV_SUN_I = ${env.sunIntensity};`);
  out.push(`export const ENV_FOG_START = ${env.fogStart};`);
  out.push(`export const ENV_FOG_END = ${env.fogEnd};`);
  out.push(`export const ENV_FOG_R = ${env.fogColor[0]};`);
  out.push(`export const ENV_FOG_G = ${env.fogColor[1]};`);
  out.push(`export const ENV_FOG_B = ${env.fogColor[2]};`);
  out.push('');

  // --- player_spawn (single, required) --------------------------------------
  const spawns = buckets['player_spawn'] || [];
  const primarySpawn = spawns.find(s => s.userData.primary === '1') || spawns[0];
  if (!primarySpawn) throw new Error('world has no player_spawn entity');
  out.push('// Player spawn');
  out.push(`export const SPAWN_X = ${primarySpawn.transform.position[0]};`);
  out.push(`export const SPAWN_Y = ${primarySpawn.transform.position[1]};`);
  out.push(`export const SPAWN_Z = ${primarySpawn.transform.position[2]};`);
  out.push(`export const SPAWN_YAW = ${primarySpawn.userData.yaw || '0'};`);
  out.push('');

  // --- collider_box --------------------------------------------------------
  const cols = buckets['collider_box'] || [];
  out.push('// Static box colliders — walls, floors, invisible terrain bounds');
  out.push(`export const COLLIDER_COUNT = ${cols.length};`);
  out.push(`export const COLLIDER_X      = ${fmtNumList(cols.map(e => e.transform.position[0]))};`);
  out.push(`export const COLLIDER_Y      = ${fmtNumList(cols.map(e => e.transform.position[1]))};`);
  out.push(`export const COLLIDER_Z      = ${fmtNumList(cols.map(e => e.transform.position[2]))};`);
  out.push(`export const COLLIDER_HALF_X = ${fmtNumList(cols.map(e => parseVec3Str(e.userData.halfExtents, [0.5, 0.5, 0.5])[0]))};`);
  out.push(`export const COLLIDER_HALF_Y = ${fmtNumList(cols.map(e => parseVec3Str(e.userData.halfExtents, [0.5, 0.5, 0.5])[1]))};`);
  out.push(`export const COLLIDER_HALF_Z = ${fmtNumList(cols.map(e => parseVec3Str(e.userData.halfExtents, [0.5, 0.5, 0.5])[2]))};`);
  out.push('');

  // --- static_mesh — drawable, optional box collider ------------------------
  //
  // Each static_mesh entity's modelRef is resolved to an index into a flat
  // UNIQUE_MODELS[] list. The runtime loadModel's each unique ref once at
  // startup and drawModel's by index per frame. The special placeholder
  // path "_gizmo_box.glb" signals "no real model, render as a coloured box"
  // — the runtime checks this with a sentinel MODEL_IS_BOX[] array so it
  // doesn't have to string-compare every frame.
  //
  // Paint category is still available on box-placeholder meshes: 0 = grey,
  // 1 = building (tan stone), 2 = terrain (green), 3 = prop (brown),
  // derived from the entity's first tag.
  const MESH_CATEGORY_MAP: Record<string, number> = { building: 1, terrain: 2, prop: 3 };
  const meshes = buckets['static_mesh'] || [];

  const uniqueModels: string[] = [];
  for (const e of meshes) {
    const m = e.modelRef || '';
    if (uniqueModels.indexOf(m) < 0) uniqueModels.push(m);
  }
  const isBoxModel = (path: string) => path === '' || path.endsWith('_gizmo_box.glb');

  out.push('// Unique model paths referenced by static_mesh entities. The runtime');
  out.push('// calls loadModel() for each at startup, except for paths flagged as');
  out.push('// box placeholders (MODEL_IS_BOX[i] === 1), which render as drawCube.');
  out.push(`export const UNIQUE_MODEL_COUNT = ${uniqueModels.length};`);
  out.push(`export const UNIQUE_MODELS      = ${fmtStrList(uniqueModels)};`);
  out.push(`export const MODEL_IS_BOX       = ${fmtNumList(uniqueModels.map(m => isBoxModel(m) ? 1 : 0))};`);
  out.push('');

  out.push('// Static-mesh instances — one row per placed entity.');
  out.push('// MESH_CATEGORY: 0=generic, 1=building, 2=terrain, 3=prop.');
  out.push(`export const MESH_COUNT = ${meshes.length};`);
  out.push(`export const MESH_MODEL_IDX   = ${fmtNumList(meshes.map(e => uniqueModels.indexOf(e.modelRef || '')))};`);
  out.push(`export const MESH_X           = ${fmtNumList(meshes.map(e => e.transform.position[0]))};`);
  out.push(`export const MESH_Y           = ${fmtNumList(meshes.map(e => e.transform.position[1]))};`);
  out.push(`export const MESH_Z           = ${fmtNumList(meshes.map(e => e.transform.position[2]))};`);
  out.push(`export const MESH_ROT_Y       = ${fmtNumList(meshes.map(e => e.transform.rotation[1]))};`);
  out.push(`export const MESH_SCALE       = ${fmtNumList(meshes.map(e => e.transform.scale[0]))};`);
  out.push(`export const MESH_COLLIDER    = ${fmtNumList(meshes.map(e => e.userData.collider === 'box' ? 1 : 0))};`);
  out.push(`export const MESH_COLLIDER_HX = ${fmtNumList(meshes.map(e => parseVec3Str(e.userData.halfExtents, [0.5, 0.5, 0.5])[0]))};`);
  out.push(`export const MESH_COLLIDER_HY = ${fmtNumList(meshes.map(e => parseVec3Str(e.userData.halfExtents, [0.5, 0.5, 0.5])[1]))};`);
  out.push(`export const MESH_COLLIDER_HZ = ${fmtNumList(meshes.map(e => parseVec3Str(e.userData.halfExtents, [0.5, 0.5, 0.5])[2]))};`);
  out.push(`export const MESH_CATEGORY    = ${fmtNumList(meshes.map(e => MESH_CATEGORY_MAP[e.tags[0] || ''] || 0))};`);
  out.push('');

  // --- prop_tree — placeholder trees until we have real GLBs ---------------
  const trees = buckets['prop_tree'] || [];
  out.push('// Trees — rendered as trunk-cube + foliage-sphere, small box collider');
  out.push(`export const TREE_COUNT = ${trees.length};`);
  out.push(`export const TREE_X      = ${fmtNumList(trees.map(e => e.transform.position[0]))};`);
  out.push(`export const TREE_Y      = ${fmtNumList(trees.map(e => e.transform.position[1]))};`);
  out.push(`export const TREE_Z      = ${fmtNumList(trees.map(e => e.transform.position[2]))};`);
  out.push(`export const TREE_HEIGHT = ${fmtNumList(trees.map(e => parseFloat(e.userData.height || '3.0')))};`);
  out.push(`export const TREE_RADIUS = ${fmtNumList(trees.map(e => parseFloat(e.userData.radius || '1.2')))};`);
  out.push('');

  // --- water — box volumes mapped straight through ------------------------
  out.push('// Water volumes — flat animated quads at surfaceHeight');
  out.push(`export const WATER_COUNT = ${world.water.length};`);
  out.push(`export const WATER_CX        = ${fmtNumList(world.water.map(w => w.center[0]))};`);
  out.push(`export const WATER_CY        = ${fmtNumList(world.water.map(w => w.surfaceHeight))};`);
  out.push(`export const WATER_CZ        = ${fmtNumList(world.water.map(w => w.center[2]))};`);
  out.push(`export const WATER_SX        = ${fmtNumList(world.water.map(w => w.size[0]))};`);
  out.push(`export const WATER_SZ        = ${fmtNumList(world.water.map(w => w.size[2]))};`);
  out.push(`export const WATER_R         = ${fmtNumList(world.water.map(w => w.color[0]))};`);
  out.push(`export const WATER_G         = ${fmtNumList(world.water.map(w => w.color[1]))};`);
  out.push(`export const WATER_B         = ${fmtNumList(world.water.map(w => w.color[2]))};`);
  out.push(`export const WATER_A         = ${fmtNumList(world.water.map(w => w.color[3]))};`);
  out.push(`export const WATER_WAVE_AMP  = ${fmtNumList(world.water.map(w => w.waveAmplitude))};`);
  out.push(`export const WATER_WAVE_SPD  = ${fmtNumList(world.water.map(w => w.waveSpeed))};`);
  out.push('');

  // --- point_light ---------------------------------------------------------
  const lights = buckets['point_light'] || [];
  out.push('// Scene point lights');
  out.push(`export const LIGHT_COUNT = ${lights.length};`);
  out.push(`export const LIGHT_X     = ${fmtNumList(lights.map(e => e.transform.position[0]))};`);
  out.push(`export const LIGHT_Y     = ${fmtNumList(lights.map(e => e.transform.position[1]))};`);
  out.push(`export const LIGHT_Z     = ${fmtNumList(lights.map(e => e.transform.position[2]))};`);
  out.push(`export const LIGHT_RANGE = ${fmtNumList(lights.map(e => parseFloat(e.userData.range || '12')))};`);
  out.push(`export const LIGHT_R     = ${fmtNumList(lights.map(e => parseVec3Str(e.userData.color, [1, 1, 1])[0]))};`);
  out.push(`export const LIGHT_G     = ${fmtNumList(lights.map(e => parseVec3Str(e.userData.color, [1, 1, 1])[1]))};`);
  out.push(`export const LIGHT_B     = ${fmtNumList(lights.map(e => parseVec3Str(e.userData.color, [1, 1, 1])[2]))};`);
  out.push(`export const LIGHT_INT   = ${fmtNumList(lights.map(e => parseFloat(e.userData.intensity || '1')))};`);
  out.push('');

  // --- enemy_spawner -------------------------------------------------------
  const spawners = buckets['enemy_spawner'] || [];
  out.push('// Enemy spawner anchors — fed into the wave director as corner points');
  out.push(`export const SPAWNER_COUNT = ${spawners.length};`);
  out.push(`export const SPAWNER_X    = ${fmtNumList(spawners.map(e => e.transform.position[0]))};`);
  out.push(`export const SPAWNER_Z    = ${fmtNumList(spawners.map(e => e.transform.position[2]))};`);
  out.push('');

  // --- weapon_pickup -------------------------------------------------------
  const pickups = buckets['weapon_pickup'] || [];
  out.push('// Weapon pickups (ground placements)');
  out.push(`export const PICKUP_COUNT = ${pickups.length};`);
  out.push(`export const PICKUP_X     = ${fmtNumList(pickups.map(e => e.transform.position[0]))};`);
  out.push(`export const PICKUP_Z     = ${fmtNumList(pickups.map(e => e.transform.position[2]))};`);
  out.push(`export const PICKUP_KIND  = ${fmtNumList(pickups.map(e => {
    const idx = PICKUP_KINDS.indexOf(e.userData.weapon || 'rifle');
    return idx < 0 ? 0 : idx;
  }))};`);
  out.push(`// Pickup kind id → string: ${PICKUP_KINDS.map((n, i) => i + '=' + n).join(' ')}`);
  out.push('');

  // --- wave_config ---------------------------------------------------------
  // Exactly zero or one wave_config entity allowed. `userData.waves` is a JSON
  // string of `[{count, enemy}]` — the editor edits it as an escaped blob; we
  // expand into two parallel arrays here so the runtime never parses JSON.
  const waveEnts = buckets['wave_config'] || [];
  const plan: number[] = [];
  const kinds: number[] = [];
  const offs: number[] = [];
  if (waveEnts.length > 0) {
    const we = waveEnts[0];
    try {
      const waves: { count: number; enemy: string }[] = JSON.parse(we.userData.waves || '[]');
      for (const w of waves) {
        offs.push(kinds.length);
        plan.push(w.count);
        const kid = ENEMY_KINDS.indexOf(w.enemy);
        const safe = kid < 0 ? 0 : kid;
        for (let i = 0; i < w.count; i++) kinds.push(safe);
      }
    } catch (err) {
      console.warn('wave_config userData.waves is not valid JSON; skipping:', err);
    }
  }
  out.push('// Wave plan — parallel arrays: WAVE_COUNT[i] enemies of the kind sequence');
  out.push('// starting at WAVE_OFFS[i] in WAVE_KIND[].');
  out.push(`export const WAVE_PLAN_COUNT = ${plan.length};`);
  out.push(`export const WAVE_SIZE      = ${fmtNumList(plan)};`);
  out.push(`export const WAVE_OFFS      = ${fmtNumList(offs)};`);
  out.push(`export const WAVE_KIND      = ${fmtNumList(kinds)};`);
  out.push(`// Enemy kind id → string: ${ENEMY_KINDS.map((n, i) => i + '=' + n).join(' ')}`);
  out.push('');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, out.join('\n'));
  console.log(`Wrote ${outputPath}`);
  console.log(`  ${cols.length} colliders, ${meshes.length} static meshes, ${trees.length} trees,`);
  console.log(`  ${lights.length} lights, ${spawners.length} spawners, ${pickups.length} pickups,`);
  console.log(`  ${world.water.length} water volumes, ${plan.length} waves (${kinds.length} enemies total).`);
}

main();
