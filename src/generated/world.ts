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
export const ENV_FOG_START = 40;
export const ENV_FOG_END = 120;
export const ENV_FOG_R = 0.62;
export const ENV_FOG_G = 0.68;
export const ENV_FOG_B = 0.78;

// Player spawn
export const SPAWN_X = 0;
export const SPAWN_Y = 1;
export const SPAWN_Z = 18;
export const SPAWN_YAW = 0;

// Static box colliders — walls, floors, invisible terrain bounds
export const COLLIDER_COUNT = 5;
export const COLLIDER_X      = [0.0, 0.0, 0.0, 40.0, -40.0];
export const COLLIDER_Y      = [-0.5, 3.0, 3.0, 3.0, 3.0];
export const COLLIDER_Z      = [0.0, -40.0, 40.0, 0.0, 0.0];
export const COLLIDER_HALF_X = [40.0, 40.0, 40.0, 0.5, 0.5];
export const COLLIDER_HALF_Y = [0.5, 4.0, 4.0, 4.0, 4.0];
export const COLLIDER_HALF_Z = [40.0, 0.5, 0.5, 40.0, 40.0];

// Drawable meshes — optional box collider via userData.collider = "box".
// MESH_CATEGORY: 0=generic, 1=building, 2=terrain, 3=prop.
export const MESH_COUNT = 10;
export const MESH_MODEL       = ["assets/models/_gizmo_box.glb", "assets/models/_gizmo_box.glb", "assets/models/_gizmo_box.glb", "assets/models/_gizmo_box.glb", "assets/models/_gizmo_box.glb", "assets/models/_gizmo_box.glb", "assets/models/_gizmo_box.glb", "assets/models/_gizmo_box.glb", "assets/models/_gizmo_box.glb", "assets/models/_gizmo_box.glb"];
export const MESH_X           = [-20.0, -25.0, -16.0, -20.0, -12.0, -28.0, -20.0, 25.0, 25.0, -25.0];
export const MESH_Y           = [1.5, 1.5, 1.5, 2.7, 1.5, 1.5, 1.5, 0.5, 1.8, 0.4];
export const MESH_Z           = [-10.0, -2.0, -2.0, -2.0, -6.0, -6.0, -6.0, -25.0, -25.0, 25.0];
export const MESH_SCALE       = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
export const MESH_COLLIDER    = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
export const MESH_COLLIDER_HX = [8.0, 3.0, 4.0, 2.0, 0.2, 0.2, 0.2, 8.0, 5.0, 7.0];
export const MESH_COLLIDER_HY = [1.5, 1.5, 1.5, 0.3, 1.5, 1.5, 1.5, 1.0, 0.8, 0.8];
export const MESH_COLLIDER_HZ = [0.2, 0.2, 0.2, 0.2, 4.0, 4.0, 3.0, 8.0, 5.0, 7.0];
export const MESH_CATEGORY    = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 2.0, 2.0, 2.0];

// Trees — rendered as trunk-cube + foliage-sphere, small box collider
export const TREE_COUNT = 6;
export const TREE_X      = [12.0, 16.0, 20.0, -10.0, -6.0, -18.0];
export const TREE_Y      = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
export const TREE_Z      = [12.0, 6.0, -14.0, 15.0, 26.0, 18.0];
export const TREE_HEIGHT = [3.2, 3.8, 3.0, 3.5, 4.0, 3.1];
export const TREE_RADIUS = [1.2, 1.4, 1.1, 1.3, 1.5, 1.2];

// Water volumes — flat animated quads at surfaceHeight
export const WATER_COUNT = 1;
export const WATER_CX        = [22.0];
export const WATER_CY        = [0.1];
export const WATER_CZ        = [18.0];
export const WATER_SX        = [12.0];
export const WATER_SZ        = [8.0];
export const WATER_R         = [0.18];
export const WATER_G         = [0.35];
export const WATER_B         = [0.55];
export const WATER_A         = [0.7];
export const WATER_WAVE_AMP  = [0.04];
export const WATER_WAVE_SPD  = [0.6];

// Scene point lights
export const LIGHT_COUNT = 3;
export const LIGHT_X     = [0.0, 0.0, -20.0];
export const LIGHT_Y     = [5.0, 5.0, 2.2];
export const LIGHT_Z     = [-20.0, 20.0, -6.0];
export const LIGHT_RANGE = [22.0, 22.0, 10.0];
export const LIGHT_R     = [1.0, 1.0, 0.85];
export const LIGHT_G     = [0.85, 0.85, 0.9];
export const LIGHT_B     = [0.55, 0.55, 1.0];
export const LIGHT_INT   = [1.0, 1.0, 0.9];

// Enemy spawner anchors — fed into the wave director as corner points
export const SPAWNER_COUNT = 4;
export const SPAWNER_X    = [28.0, -28.0, 28.0, -28.0];
export const SPAWNER_Z    = [-28.0, -28.0, 28.0, 28.0];

// Weapon pickups (ground placements)
export const PICKUP_COUNT = 4;
export const PICKUP_X     = [0.0, 0.0, 25.0, -20.0];
export const PICKUP_Z     = [-18.0, 10.0, -25.0, -8.0];
export const PICKUP_KIND  = [0.0, 1.0, 0.0, 1.0];
// Pickup kind id → string: 0=rifle 1=blaster

// Wave plan — parallel arrays: WAVE_COUNT[i] enemies of the kind sequence
// starting at WAVE_OFFS[i] in WAVE_KIND[].
export const WAVE_PLAN_COUNT = 3;
export const WAVE_SIZE      = [3.0, 6.0, 10.0];
export const WAVE_OFFS      = [0.0, 3.0, 9.0];
export const WAVE_KIND      = [0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0];
// Enemy kind id → string: 0=dretch 1=mantis 2=marauder 3=dragoon 4=tyrant
