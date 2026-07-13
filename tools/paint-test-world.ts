// Author a painted world WITHOUT the editor GUI, so the splat pipeline can be
// tested end to end in a batch run.
//
// Synthetic mouse input does not reach a Bloom window (it does not even hover),
// so the paint brush cannot be driven from a script. This writes the same data
// the brush would: four `terrain.layers`, with a rock stripe and a dirt disc
// painted straight across the arena in front of the player spawn.
//
// If the game renders bare rock in a band and dirt in a circle, then the editor
// -> world file -> world-runtime -> splat texture -> shader chain is intact.
// Output is gitignored; this is a test fixture, not content.
//
//   bun tools/paint-test-world.ts && ./main.exe --world assets/worlds/__painttest.world.json

import { readFileSync, writeFileSync } from 'fs';

const SRC = 'assets/worlds/arena_02.world.json';
const DST = 'assets/worlds/__painttest.world.json';

const world = JSON.parse(readFileSync(SRC, 'utf8'));
const t = world.terrain;
if (!t) throw new Error('arena_02 has no terrain');

const W = t.width, D = t.depth, cell = t.cellSize;
const ox = t.origin[0], oz = t.origin[2];
const n = W * D;

const TEX = [
  'assets/textures/terrain_grass_lush_albedo.png',
  'assets/textures/terrain_grass_dry_albedo.png',
  'assets/textures/terrain_dirt_albedo.png',
  'assets/textures/terrain_rock_albedo.png',
];
const IDS = ['grass_lush', 'grass_dry', 'dirt', 'rock'];

const weights: number[][] = IDS.map(() => new Array(n).fill(0));

// Paint. Same normalization the editor's paintCell does: the active layer takes
// weight, the others are scaled into whatever room is left, so a cell never sums
// past 1 (a cell that is 90% grass AND 90% rock renders as a grey average).
function paint(idx: number, layer: number, amount: number) {
  const next = Math.min(1, Math.round((weights[layer][idx] + amount) * 1000) / 1000);
  weights[layer][idx] = next;
  let others = 0;
  for (let l = 0; l < 4; l++) if (l !== layer) others += weights[l][idx];
  const room = 1 - next;
  if (others > room && others > 0) {
    const k = room / others;
    for (let l = 0; l < 4; l++) {
      if (l !== layer) weights[l][idx] = Math.round(weights[l][idx] * k * 1000) / 1000;
    }
  }
}

let painted = 0;
for (let z = 0; z < D; z++) {
  for (let x = 0; x < W; x++) {
    const idx = z * W + x;
    const wx = ox + x * cell;
    const wz = oz + z * cell;

    // A rock band running east-west across the near bank (player spawns at z=20).
    if (wz > 22 && wz < 30) { paint(idx, 3, 1.0); painted++; }

    // A dirt disc centred on the spawn, with a soft edge so the coverage blend
    // is visible: the rim should fade into the procedural grass, not cut to it.
    const dx = wx - 0, dz = wz - 20;
    const r = Math.sqrt(dx * dx + dz * dz);
    if (r < 8) {
      const a = Math.min(1, (8 - r) / 3);
      paint(idx, 2, a);
      painted++;
    }
  }
}

t.layers = IDS.map((id, i) => ({
  id, textureRef: TEX[i], weights: weights[i], tileScale: 1,
}));
world.name = 'PAINT TEST';

writeFileSync(DST, JSON.stringify(world));
console.log(`wrote ${DST}: ${W}x${D} grid, 4 layers, ${painted} cells painted`);
