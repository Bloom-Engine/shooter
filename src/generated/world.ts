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
export const ENV_SUN_DIR_X = -0.35;
export const ENV_SUN_DIR_Y = -0.85;
export const ENV_SUN_DIR_Z = -0.25;
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
export const UNIQUE_MODELS      = ["assets/models/terrain_hills.glb", "assets/models/_gizmo_box.glb", "assets/models/building_floor.glb", "assets/models/prop_table.glb", "assets/models/prop_chair.glb", "assets/models/prop_bed.glb", "assets/models/prop_crate.glb", "assets/models/prop_barrel.glb", "assets/models/prop_tree.glb"];
export const MODEL_IS_BOX       = [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

// Static-mesh instances — one row per placed entity.
// MESH_CATEGORY: 0=generic, 1=building, 2=terrain, 3=prop.
export const MESH_COUNT = 49;
export const MESH_MODEL_IDX   = [0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 2.0, 3.0, 4.0, 4.0, 5.0, 6.0, 5.0, 3.0, 4.0, 6.0, 6.0, 7.0, 7.0, 6.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 8.0];
export const MESH_X           = [0.0, -21.0, -25.0, -17.0, -21.0, -28.0, -14.0, -21.0, -21.0, -21.0, -17.825, -17.475, -17.125, -16.775, -16.425, -16.075, -15.725, -15.375, -15.025, -14.675, -23.0, -16.0, -21.0, -21.0, -14.0, -28.0, -21.0, -21.0, -24.0, -22.5, -25.5, -19.0, -17.5, -23.0, -26.0, -24.5, -20.0, -20.0, -14.0, -13.0, 12.0, 12.0, 18.0, 5.0, -10.0, -8.0, -18.0, 30.0, 22.0];
export const MESH_Y           = [0.0, 1.5, 1.5, 1.5, 2.7, 1.5, 1.5, 1.5, 1.5, 2.7, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.35, 1.5, 3.05, 3.05, 4.55, 4.55, 4.55, 4.55, 6.1, 0.01, 0.0, 0.0, 0.0, 0.0, 0.0, 3.11, 3.11, 3.11, 3.11, 4.11, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
export const MESH_Z           = [0.0, -18.0, -10.0, -10.0, -10.0, -14.0, -16.0, -16.0, -11.5, -13.5, -11.0, -11.0, -11.0, -11.0, -11.0, -11.0, -11.0, -11.0, -11.0, -11.0, -14.0, -15.0, -18.0, -10.0, -14.0, -14.0, -14.0, -14.0, -14.0, -14.0, -14.0, -15.0, -17.0, -15.0, -13.0, -13.0, -17.0, -17.0, -1.0, -2.2, -6.0, 5.0, 0.0, -8.0, 25.0, 28.0, 25.0, -6.0, 22.0];
export const MESH_ROT_Y       = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.57, 1.57, 0.0, 0.5, 1.57, 0.0, -1.57, 0.0, 0.4, 0.0, 0.7, 0.25, 0.0, 1.2, 2.0, 0.4, 1.8, 2.3, 0.9, 3.0];
export const MESH_SCALE       = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.75, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.8, 1.0, 1.0, 1.0, 1.0, 1.2, 0.9, 1.1, 1.3, 1.0, 1.0, 0.9];
export const MESH_COLLIDER    = [0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
export const MESH_COLLIDER_HX = [0.5, 7.0, 3.0, 3.0, 1.0, 0.2, 0.2, 0.2, 0.2, 0.2, 0.175, 0.175, 0.175, 0.175, 0.175, 0.175, 0.175, 0.175, 0.175, 0.175, 5.0, 2.0, 7.0, 7.0, 0.2, 0.2, 7.2, 0.5, 0.8, 0.25, 0.25, 1.0, 0.5, 0.5, 0.8, 0.25, 0.5, 0.4, 0.4, 0.4, 0.5, 0.25, 0.3, 0.25, 0.27, 0.32, 0.25, 0.25, 0.22];
export const MESH_COLLIDER_HY = [0.5, 1.5, 1.5, 1.5, 0.3, 1.5, 1.5, 1.5, 1.5, 0.3, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.35, 1.5, 0.05, 0.05, 1.45, 1.45, 1.45, 1.45, 0.1, 0.5, 0.4, 0.5, 0.5, 0.3, 0.5, 0.3, 0.4, 0.5, 0.5, 0.4, 0.55, 0.55, 0.5, 1.9, 2.3, 1.7, 2.1, 2.5, 1.9, 1.9, 1.7];
export const MESH_COLLIDER_HZ = [0.5, 0.2, 0.2, 0.2, 0.2, 4.0, 2.0, 2.0, 1.5, 0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 4.0, 3.0, 0.2, 0.2, 4.0, 4.0, 4.2, 0.5, 0.5, 0.25, 0.25, 0.5, 0.5, 1.0, 0.5, 0.25, 0.5, 0.4, 0.4, 0.4, 0.5, 0.25, 0.3, 0.25, 0.27, 0.32, 0.25, 0.25, 0.22];
export const MESH_CATEGORY    = [2.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0];

// Trees — rendered as trunk-cube + foliage-sphere, small box collider
export const TREE_COUNT = 0;
export const TREE_X      = [];
export const TREE_Y      = [];
export const TREE_Z      = [];
export const TREE_HEIGHT = [];
export const TREE_RADIUS = [];

// Water volumes — flat animated quads at surfaceHeight
export const WATER_COUNT = 6;
export const WATER_CX        = [32.0, 20.0, 8.0, -4.0, -16.0, -30.0];
export const WATER_CY        = [0.05, 0.05, 0.05, 0.05, 0.05, 0.05];
export const WATER_CZ        = [13.0, 11.0, 13.0, 11.0, 13.0, 11.0];
export const WATER_SX        = [14.0, 12.0, 12.0, 12.0, 12.0, 12.0];
export const WATER_SZ        = [3.0, 3.0, 3.0, 3.0, 3.0, 3.0];
export const WATER_R         = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2];
export const WATER_G         = [0.42, 0.42, 0.42, 0.42, 0.42, 0.42];
export const WATER_B         = [0.62, 0.62, 0.62, 0.62, 0.62, 0.62];
export const WATER_A         = [0.75, 0.75, 0.75, 0.75, 0.75, 0.75];
export const WATER_WAVE_AMP  = [0.05, 0.05, 0.05, 0.05, 0.05, 0.05];
export const WATER_WAVE_SPD  = [1.4, 1.4, 1.4, 1.4, 1.4, 1.4];

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
export const WAVE_SIZE      = [3.0, 6.0, 10.0];
export const WAVE_OFFS      = [0.0, 3.0, 9.0];
export const WAVE_KIND      = [0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0];
// Enemy kind id → string: 0=dretch 1=mantis 2=marauder 3=dragoon 4=tyrant
