// GENERATED — do not edit by hand.
// Source: ../../assets/worlds/arena_02.world.json
// Regenerate with: bun tools/build-world.ts ../../assets/worlds/arena_02.world.json src/generated/world.ts

export const WORLD_NAME = "Arena 02 — Outdoor plaza";
export const WORLD_ID = "arena_02";

// Environment
export const ENV_SKY_R = 0.55;
export const ENV_SKY_G = 0.62;
export const ENV_SKY_B = 0.78;
export const ENV_AMBIENT_R = 0.75;
export const ENV_AMBIENT_G = 0.78;
export const ENV_AMBIENT_B = 0.85;
export const ENV_AMBIENT_I = 0.55;
export const ENV_SUN_DIR_X = 0.45;
export const ENV_SUN_DIR_Y = 0.72;
export const ENV_SUN_DIR_Z = 0.52;
export const ENV_SUN_R = 1;
export const ENV_SUN_G = 0.95;
export const ENV_SUN_B = 0.82;
export const ENV_SUN_I = 1.1;
export const ENV_FOG_START = 45;
export const ENV_FOG_END = 140;
export const ENV_FOG_R = 0.62;
export const ENV_FOG_G = 0.68;
export const ENV_FOG_B = 0.78;

// Player spawn
export const SPAWN_X = 0;
export const SPAWN_Y = 1;
export const SPAWN_Z = 20;
export const SPAWN_YAW = 0;

// Static box colliders — walls, floors, invisible terrain bounds
export const COLLIDER_COUNT = 4;
export const COLLIDER_X      = [0.0, 0.0, 40.0, -40.0];
export const COLLIDER_Y      = [3.0, 3.0, 3.0, 3.0];
export const COLLIDER_Z      = [-40.0, 40.0, 0.0, 0.0];
export const COLLIDER_HALF_X = [40.0, 40.0, 0.5, 0.5];
export const COLLIDER_HALF_Y = [4.0, 4.0, 4.0, 4.0];
export const COLLIDER_HALF_Z = [0.5, 0.5, 40.0, 40.0];

// Unique model paths referenced by static_mesh entities. The runtime
// calls loadModel() for each at startup, except for paths flagged as
// box placeholders (MODEL_IS_BOX[i] === 1), which render as drawCube.
export const UNIQUE_MODEL_COUNT = 9;
export const UNIQUE_MODELS      = ["assets/models/terrain_hills.glb", "assets/models/building_floor.glb", "assets/models/prop_table.glb", "assets/models/prop_chair.glb", "assets/models/prop_bed.glb", "assets/models/prop_crate.glb", "assets/models/prop_barrel.glb", "assets/models/prop_tree.glb", "assets/models/_gizmo_box.glb"];
export const MODEL_IS_BOX       = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0];

// Static-mesh instances — one row per placed entity.
// MESH_CATEGORY: 0=generic, 1=building, 2=terrain, 3=prop.
export const MESH_COUNT = 66;
export const MESH_MODEL_IDX   = [0.0, 1.0, 2.0, 3.0, 3.0, 4.0, 5.0, 4.0, 2.0, 3.0, 5.0, 5.0, 6.0, 6.0, 5.0, 7.0, 7.0, 7.0, 7.0, 7.0, 7.0, 7.0, 7.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0];
export const MESH_X           = [0.0, -21.0, -24.0, -22.5, -25.5, -19.0, -17.5, -23.0, -26.0, -24.5, -20.0, -20.0, -14.0, -13.0, 12.0, 12.0, 18.0, 5.0, -10.0, -8.0, -18.0, 30.0, 22.0, -21.0, -12.0, -30.0, -26.0, -16.0, -21.0, -21.0, -12.0, -30.0, -21.0, -21.0, -12.0, -30.0, -21.0, -21.0, -21.0, -23.0, -13.0, -21.0, -21.0, -23.0, -13.0, -21.0, -15.85, -15.55, -15.25, -14.95, -14.65, -14.35, -14.05, -13.75, -13.45, -13.15, -14.15, -14.45, -14.75, -15.05, -15.35, -15.65, -15.95, -16.25, -16.55, -16.85];
export const MESH_Y           = [0.0, 0.01, 0.0, 0.0, 0.0, 0.0, 0.0, 3.11, 3.11, 3.11, 3.11, 4.11, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.5, 1.5, 1.5, 1.5, 1.5, 2.7, 4.5, 4.5, 4.5, 4.5, 7.5, 7.5, 7.5, 7.5, 2.9, 2.9, 2.9, 2.9, 5.9, 5.9, 5.9, 5.9, 9.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.35, 1.5, 3.15, 3.3, 3.45, 3.6, 3.75, 3.9, 4.05, 4.2, 4.35, 4.5];
export const MESH_Z           = [0.0, -14.0, -14.0, -14.0, -14.0, -15.0, -17.0, -15.0, -13.0, -13.0, -17.0, -17.0, -1.0, -2.2, -6.0, 5.0, 0.0, -8.0, 25.0, 28.0, 25.0, -6.0, 22.0, -19.0, -13.0, -13.0, -7.0, -7.0, -7.0, -19.0, -13.0, -13.0, -7.0, -19.0, -13.0, -13.0, -7.0, -7.75, -15.25, -10.0, -10.0, -7.75, -15.25, -10.0, -10.0, -13.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0, -10.0];
export const MESH_ROT_Y       = [0.0, 0.0, 0.0, -1.57, 1.57, 0.0, 0.5, 1.57, 0.0, -1.57, 0.0, 0.4, 0.0, 0.7, 0.25, 0.0, 1.2, 2.0, 0.4, 1.8, 2.3, 0.9, 3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
export const MESH_SCALE       = [1.0, 1.75, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.8, 1.0, 1.0, 1.0, 1.0, 1.2, 0.9, 1.1, 1.3, 1.0, 1.0, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
export const MESH_COLLIDER    = [0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
export const MESH_COLLIDER_HX = [0.5, 0.5, 0.8, 0.25, 0.25, 1.0, 0.5, 0.5, 0.8, 0.25, 0.5, 0.4, 0.4, 0.4, 0.5, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 9.0, 0.2, 0.2, 4.0, 4.0, 1.0, 9.0, 0.2, 0.2, 9.0, 9.0, 0.2, 0.2, 9.0, 9.0, 9.0, 7.0, 1.0, 9.0, 9.0, 7.0, 1.0, 9.0, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15];
export const MESH_COLLIDER_HY = [0.5, 0.5, 0.4, 0.5, 0.5, 0.3, 0.5, 0.3, 0.4, 0.5, 0.5, 0.4, 0.55, 0.55, 0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.5, 1.5, 1.5, 1.5, 1.5, 0.3, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.35, 1.5, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.35, 1.5];
export const MESH_COLLIDER_HZ = [0.5, 0.5, 0.5, 0.25, 0.25, 0.5, 0.5, 1.0, 0.5, 0.25, 0.5, 0.4, 0.4, 0.4, 0.5, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.2, 6.0, 6.0, 0.2, 0.2, 0.2, 0.2, 6.0, 6.0, 0.2, 0.2, 6.0, 6.0, 0.2, 0.75, 3.75, 1.5, 1.5, 0.75, 3.75, 1.5, 1.5, 6.0, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5];
export const MESH_CATEGORY    = [2.0, 1.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];

// Trees — rendered as trunk-cube + foliage-sphere, small box collider
export const TREE_COUNT = 0;
export const TREE_X      = [];
export const TREE_Y      = [];
export const TREE_Z      = [];
export const TREE_HEIGHT = [];
export const TREE_RADIUS = [];

// Water volumes — flat animated quads at surfaceHeight
export const WATER_COUNT = 1;
export const WATER_CX        = [0.0];
export const WATER_CY        = [0.05];
export const WATER_CZ        = [12.0];
export const WATER_SX        = [80.0];
export const WATER_SZ        = [5.0];
export const WATER_R         = [0.2];
export const WATER_G         = [0.42];
export const WATER_B         = [0.62];
export const WATER_A         = [0.75];
export const WATER_WAVE_AMP  = [0.05];
export const WATER_WAVE_SPD  = [1.4];

// Scene point lights
export const LIGHT_COUNT = 5;
export const LIGHT_X     = [0.0, 0.0, -21.0, -21.0, 26.0];
export const LIGHT_Y     = [5.0, 5.0, 2.6, 5.6, 5.0];
export const LIGHT_Z     = [-20.0, 20.0, -14.0, -14.0, -24.0];
export const LIGHT_RANGE = [22.0, 22.0, 12.0, 12.0, 18.0];
export const LIGHT_R     = [1.0, 1.0, 0.95, 0.85, 0.95];
export const LIGHT_G     = [0.85, 0.85, 0.85, 0.9, 0.75];
export const LIGHT_B     = [0.55, 0.55, 0.65, 1.0, 0.45];
export const LIGHT_INT   = [1.0, 1.0, 1.1, 0.9, 0.8];

// Enemy spawner anchors — fed into the wave director as corner points
export const SPAWNER_COUNT = 4;
export const SPAWNER_X    = [30.0, -30.0, 30.0, -30.0];
export const SPAWNER_Z    = [-30.0, -30.0, 30.0, 30.0];

// Weapon pickups (ground placements)
export const PICKUP_COUNT = 4;
export const PICKUP_X     = [0.0, -25.0, 26.0, -24.0];
export const PICKUP_Z     = [-15.0, -17.0, -24.0, 26.0];
export const PICKUP_KIND  = [0.0, 1.0, 0.0, 1.0];
// Pickup kind id → string: 0=rifle 1=blaster

// Wave plan — parallel arrays: WAVE_COUNT[i] enemies of the kind sequence
// starting at WAVE_OFFS[i] in WAVE_KIND[].
export const WAVE_PLAN_COUNT = 3;
export const WAVE_SIZE      = [4.0, 7.0, 11.0];
export const WAVE_OFFS      = [0.0, 4.0, 11.0];
export const WAVE_KIND      = [0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 2.0, 1.0, 0.0, 2.0, 1.0, 2.0, 3.0, 1.0, 2.0, 3.0, 0.0, 2.0, 1.0, 3.0, 2.0, 4.0];
// Enemy kind id → string: 0=dretch 1=mantis 2=marauder 3=dragoon 4=tyrant
