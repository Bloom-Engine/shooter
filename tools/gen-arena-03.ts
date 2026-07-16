// SH-040 — arena_03 "RIVERBEND RAVINE": the second playable arena.
//
//   bun tools/gen-arena-03.ts          # writes assets/worlds/arena_03.world.json
//
// The read, and why it is different from arena_02's open plaza: a north-south
// RAVINE with the river running its floor. The rims stand ~3.5 m above the
// floor and carry a dense forest; crossing east-west funnels through two
// saddle dips in the walls — the chokepoints. Ranged kinds appear from wave 1
// (SH-042's acceptance asked every arena to mix ranged + melee pressure), so
// the crate clusters on the floor are cover you actually use, not dressing.
//
// SEEDING TOOL, run once: like bake-forest-to-world.ts, re-running OVERWRITES
// any editor work on this file. The terrain is authored HERE (not via
// bake-terrain-to-world.ts, whose recipe is arena_02's rolling plaza); after
// generation the file is the editor's to own.
//
// After running: bun tools/build-terrain.ts assets/worlds/arena_03.world.json \
//                    assets/models/terrain_ravine.glb

import * as fs from 'fs';

const OUT = 'assets/worlds/arena_03.world.json';
const HALF = 40;                 // world runs -40..40, matching arena_02
const SAMPLES = 128;             // heightmap resolution (divides by physics block 4)
const CELL = (HALF * 2) / (SAMPLES - 1);

// ---- deterministic RNG (mulberry32) — same world every run ------------------
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- terrain: the ravine -----------------------------------------------------
// Base: gentle 2-octave value noise so nothing reads as machined. Ravine: walls
// rise east and west of a ~16 m-wide floor; two gaussian SADDLES dip the walls
// where crossings belong. River: carved along x = 0, the ravine's lowest line.
const nrand = rng(0xA3);
const GRID = 17;
const noise = new Array<number>(GRID * GRID);
for (let i = 0; i < GRID * GRID; i++) noise[i] = nrand();
function vnoise(u: number, v: number): number {
  const gu = Math.min(GRID - 2, Math.max(0, u)), gv = Math.min(GRID - 2, Math.max(0, v));
  const iu = Math.floor(gu), iv = Math.floor(gv);
  const fu = gu - iu, fv = gv - iv;
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  const a = noise[iv * GRID + iu], b = noise[iv * GRID + iu + 1];
  const c = noise[(iv + 1) * GRID + iu], d = noise[(iv + 1) * GRID + iu + 1];
  return (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv;
}

const RAVINE_FLOOR_HW = 8;      // |x| below this = floor
const RAVINE_TOP_HW = 15;       // |x| above this = full rim height
const RIM_H = 3.5;
const SADDLES = [ { z: -16, w: 7 }, { z: 19, w: 6 } ];   // crossing dips
const RIVER_HW = 2.5, RIVER_BED = -0.55, RIVER_BANK = 2.4;

function heightAt(x: number, z: number): number {
  // base undulation, calmer on the floor so the fight there is readable
  const base = (vnoise((x + HALF) / 5.5, (z + HALF) / 5.5) - 0.5) * 1.5
             + (vnoise((x + HALF) / 2.2, (z + HALF) / 2.2) - 0.5) * 0.5;
  // ravine wall profile
  const ax = Math.abs(x);
  let wall = 0;
  if (ax >= RAVINE_TOP_HW) wall = 1;
  else if (ax > RAVINE_FLOOR_HW) {
    const t = (ax - RAVINE_FLOOR_HW) / (RAVINE_TOP_HW - RAVINE_FLOOR_HW);
    wall = t * t * (3 - 2 * t);
  }
  // saddles cut the wall down where the crossings are
  let dip = 0;
  for (const s of SADDLES) {
    const d = (z - s.z) / s.w;
    dip = Math.max(dip, Math.exp(-d * d));
  }
  wall *= 1 - 0.82 * dip;
  let h = 0.35 + wall * RIM_H + base * (0.35 + 0.65 * wall);
  // river carve along x = 0 (the ravine floor's centre line)
  if (ax < RIVER_HW + RIVER_BANK) {
    if (ax <= RIVER_HW) h = Math.min(h, RIVER_BED);
    else {
      // Smooth bank: bed at the water's edge blending up to the floor height.
      const t = (ax - RIVER_HW) / RIVER_BANK;
      const s = t * t * (3 - 2 * t);
      h = RIVER_BED * (1 - s) + h * s;
    }
  }
  return Math.round(h * 10000) / 10000;
}

const heights = new Array<number>(SAMPLES * SAMPLES);
for (let iz = 0; iz < SAMPLES; iz++) {
  for (let ix = 0; ix < SAMPLES; ix++) {
    heights[iz * SAMPLES + ix] = heightAt(-HALF + ix * CELL, -HALF + iz * CELL);
  }
}

// ---- entities ----------------------------------------------------------------
const GIZMO = 'assets/models/_gizmo_box.glb';
function ent(id: string, modelRef: string, pos: number[], rotY: number,
             scale: number, tint: number[] | null, tags: string[], ud: any): any {
  return {
    id: id, name: id, modelRef: modelRef, prefabRef: null,
    transform: { position: pos, rotation: [0, rotY, 0], scale: [scale, scale, scale] },
    tint: tint, tags: tags, userData: ud,
  };
}
const entities: any[] = [];

// Spawn on the EAST BANK, not x = 0 — that is the river's centre line, and
// the first build put the player ankle-deep at boot.
entities.push(ent('spawn_1', GIZMO, [5.5, 1, 30], 0, 1, null, ['logic'],
  { kind: 'player_spawn', primary: '1', yaw: '0' }));

// Terrain visual shell (GLB built by build-terrain.ts from this file's heights).
entities.push(ent('terrain_ground', 'assets/models/terrain_ravine.glb',
  [0, 0, 0], 0, 1, null, ['terrain'], { kind: 'static_mesh' }));

// Boundary walls — same invisible fence as arena_02.
const walls = [
  ['wall_boundary_n', [0, 3, -HALF], '40, 4, 0.5'],
  ['wall_boundary_s', [0, 3, HALF], '40, 4, 0.5'],
  ['wall_boundary_e', [HALF, 3, 0], '0.5, 4, 40'],
  ['wall_boundary_w', [-HALF, 3, 0], '0.5, 4, 40'],
] as const;
for (const [id, pos, he] of walls) {
  entities.push(ent(id, GIZMO, pos as any, 0, 1, null, ['static'],
    { kind: 'collider_box', halfExtents: he, static: '1' }));
}

// Spawners: north floor (up-river), both rims, and a saddle mouth — waves
// arrive down the ravine AND over the walls, so the floor never feels safe
// from one direction only.
const spawners = [
  ['spawner_north_floor', [0, 1, -34]],
  ['spawner_east_rim', [30, 4, -8]],
  ['spawner_west_rim', [-30, 4, 12]],
  ['spawner_saddle_ne', [26, 3, -18]],
] as const;
for (const [id, pos] of spawners) {
  entities.push(ent(id, GIZMO, pos as any, 0, 1, null, ['logic'], { kind: 'enemy_spawner' }));
}

// Pickups: floor pair near spawn, one at each saddle (the contested ground),
// one on each rim. Rifles where the fight funnels, blasters on the rims.
const pickups = [
  ['pickup_rifle_floor_s', [3.8, 0.9, 24], 'rifle'],
  ['pickup_rifle_floor_n', [-3.8, 0.9, -22], 'rifle'],
  ['pickup_rifle_saddle_w', [-12, 2.2, 19], 'rifle'],
  ['pickup_rifle_saddle_e', [12, 2.2, -16], 'rifle'],
  ['pickup_blaster_rim_e', [24, 4.2, 6], 'blaster'],
  ['pickup_blaster_rim_w', [-24, 4.2, -14], 'blaster'],
] as const;
for (const [id, pos, weapon] of pickups) {
  // Pickup Y is authored data the game trusts (the house-v2 lesson): derive
  // it from the terrain instead of guessing per-location numbers.
  const py = heightAt(pos[0] as number, pos[2] as number) + 0.7;
  entities.push(ent(id, GIZMO, [pos[0], Math.round(py * 100) / 100, pos[2]] as any,
    0, 1, null, ['logic'], { kind: 'weapon_pickup', weapon: weapon }));
}

// Crate/barrel cover on the ravine floor — the answer to the rim shooters.
// Clusters flank the river so both banks have something to fight from.
const crates = [
  ['cov_a1', 'prop_crate.glb', [5.5, 0, 16.5], 0.4], ['cov_a2', 'prop_crate.glb', [6.4, 0, 15.6], 1.2],
  ['cov_a3', 'prop_barrel.glb', [4.9, 0, 15.4], 0],
  ['cov_b1', 'prop_crate.glb', [-6.1, 0, 6.2], 2.1], ['cov_b2', 'prop_barrel.glb', [-5.2, 0, 7.3], 0],
  ['cov_c1', 'prop_crate.glb', [6.3, 0, -4.8], 0.9], ['cov_c2', 'prop_crate.glb', [5.2, 0, -6.0], 2.6],
  ['cov_d1', 'prop_barrel.glb', [-5.8, 0, -14.2], 0], ['cov_d2', 'prop_crate.glb', [-6.9, 0, -15.3], 1.7],
] as const;
for (const [id, glb, pos, rotY] of crates) {
  const he = glb === 'prop_crate.glb' ? '0.500, 0.500, 0.500' : '0.350, 0.550, 0.350';
  const y = heightAt(pos[0] as number, pos[2] as number);
  entities.push(ent(id, 'assets/models/' + glb, [pos[0], Math.max(y, 0.0), pos[2]] as any,
    rotY as number, 1, null, ['prop'],
    { kind: 'static_mesh', collider: 'box', halfExtents: he }));
}

// The forest: dense on rims and slopes, sparse on the floor, never in the
// river, the spawn clearing, a saddle mouth or a cover cluster.
const trand = rng(0x51D);
const TREES = 116;
const variants = ['prop_tree.glb', 'prop_tree2.glb', 'prop_tree3.glb'];
let placed = 0, attempts = 0, ti = 0;
const treePos: number[][] = [];
while (placed < TREES && attempts < 4000) {
  attempts++;
  const x = (trand() * 2 - 1) * (HALF - 2.5);
  const z = (trand() * 2 - 1) * (HALF - 2.5);
  const ax = Math.abs(x);
  if (ax < RIVER_HW + 2.0) continue;                        // river + banks stay open
  if (Math.hypot(x - 0, z - 30) < 7) continue;              // spawn clearing
  let nearSaddle = false;
  for (const s of SADDLES) {
    if (ax > RAVINE_FLOOR_HW - 2 && Math.abs(z - s.z) < s.w * 0.8) nearSaddle = true;
  }
  if (nearSaddle) continue;                                  // crossings stay open
  let nearCover = false;
  for (const c of crates) { if (Math.hypot(x - (c[2][0] as number), z - (c[2][2] as number)) < 3) nearCover = true; }
  if (nearCover) continue;
  // density by zone: floor sparse, slopes/rims dense
  const density = ax < RAVINE_FLOOR_HW ? 0.14 : 0.95;
  if (trand() > density) continue;
  let tooClose = false;
  for (const p of treePos) { if (Math.hypot(x - p[0], z - p[1]) < 3.1) { tooClose = true; break; } }
  if (tooClose) continue;
  treePos.push([x, z]);
  const y = heightAt(x, z);
  const scale = 0.95 + trand() * 0.5;
  // arena_02's calibrated tint language: 1-D dryness wedge, green dominant.
  const dry = trand();
  const tint = [0.92 + dry * 0.14, 1.02 + (1 - dry) * 0.06, 0.86 + (1 - dry) * 0.08, 1];
  const rot = trand() * Math.PI * 2;
  ti++;
  entities.push(ent('tree_' + String(ti).padStart(4, '0'),
    'assets/models/' + variants[ti % 3], [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000, Math.round(z * 10000) / 10000],
    Math.round(rot * 10000) / 10000, Math.round(scale * 10000) / 10000,
    tint.map(v => Math.round(v * 10000) / 10000), ['prop', 'tree'], { kind: 'prop_tree' }));
  placed++;
}

// Waves — ranged pressure from wave 1 (SH-042 acceptance).
const waves = [
  { count: 5, enemy: 'dretch,dretch,mantis,adv_marauder,dretch' },
  { count: 8, enemy: 'mantis,marauder,adv_marauder,dretch,dragoon,adv_marauder,mantis,marauder' },
  { count: 12, enemy: 'dragoon,adv_dragoon,marauder,adv_marauder,mantis,adv_dragoon,marauder,adv_marauder,dretch,dragoon,mantis,tyrant' },
];
entities.push(ent('waves', GIZMO, [0, 0, 0], 0, 1, null, ['logic'],
  { kind: 'wave_config', waves: JSON.stringify(waves) }));

// ---- world -------------------------------------------------------------------
const world = {
  schemaVersion: 2,
  name: 'Arena 03 - Riverbend Ravine',
  id: 'arena_03',
  bounds: { min: [-HALF, -5, -HALF], max: [HALF, 30, HALF] },
  environment: {
    // Late afternoon, sun low from the west so one ravine wall holds the light
    // and the other holds the shade — the light itself tells you which rim the
    // ranged kinds will shoot from.
    skyColor: [0.6, 0.6, 0.72],
    ambientColor: [0.78, 0.76, 0.8],
    ambientIntensity: 0.55,
    sunDirection: [-0.55, 0.58, 0.35],
    sunColor: [1, 0.9, 0.74],
    sunIntensity: 1.1,
    fogStart: 42, fogEnd: 130, fogColor: [0.66, 0.64, 0.66],
    shadowsEnabled: true,
  },
  terrain: {
    width: SAMPLES, depth: SAMPLES, cellSize: CELL, origin: [-HALF, 0, -HALF],
    heights: heights,
    layers: [],
  },
  entities: entities,
  lights: [
    { id: 'light_saddle_n', name: 'light_saddle_n', kind: 'point', position: [12, 4.5, -16], color: [1, 0.8, 0.5], intensity: 0.9, range: 16 },
    { id: 'light_saddle_s', name: 'light_saddle_s', kind: 'point', position: [-12, 4.5, 19], color: [1, 0.8, 0.5], intensity: 0.9, range: 16 },
    { id: 'light_spawn', name: 'light_spawn', kind: 'point', position: [3, 3.5, 27], color: [0.85, 0.9, 1], intensity: 0.7, range: 14 },
  ],
  water: [
    { id: 'ravine_river', kind: 'box', center: [0, 0, 0], size: [2 * RIVER_HW, 1, 2 * HALF],
      surfaceHeight: 0.05, color: [0.18, 0.4, 0.58, 0.75], waveAmplitude: 0.05, waveSpeed: 1.5 },
  ],
  rivers: [],
  metadata: { generator: 'tools/gen-arena-03.ts', seed: '0xA3/0x51D', date: '2026-07-16' },
};

fs.writeFileSync(OUT, JSON.stringify(world));
console.log('[gen-arena-03] wrote ' + OUT + ': ' + entities.length + ' entities ('
  + placed + ' trees), ' + SAMPLES + 'x' + SAMPLES + ' terrain');
