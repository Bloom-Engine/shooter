// Write the arena's heightmap into the world file, so `world.terrain` becomes
// the source of truth the game loads and the editor sculpts.
//
//   bun tools/bake-terrain-to-world.ts assets/worlds/arena_02.world.json
//
// Run once to seed the terrain from the procedural shape in ./terrain-shape.ts.
// Running it again OVERWRITES any sculpting done in the editor — it re-derives
// the heights from scratch — so it is not part of the normal build. It exists so
// the terrain can be regenerated from its recipe if that is ever wanted.
//
// The river channel is carved from the world's own water volume rather than a
// constant: the riverbed used to be cut at a hardcoded z = 12 that happened to
// match the water, and moving the water in the editor would have left the
// channel behind.

import * as fs from 'fs';
import { arenaHeightAt, ARENA_HALF, RiverCarve } from './terrain-shape';

// 128 × 128 over the 80 m arena → 0.63 m cells. Fine enough to sculpt with and
// to hold the river channel; the count must divide by the physics heightfield's
// block size (4).
const SAMPLES = 128;
const CELL = (ARENA_HALF * 2) / (SAMPLES - 1);
const ORIGIN = -ARENA_HALF;

// Channel floor and bank width. Not derivable from the water volume (it says
// where the water is, not how the ground beneath it was cut), so they stay here
// with the rest of the terrain recipe.
const BED = -0.55;
const BANK = 2.4;

function main(): void {
  const path = process.argv[2] || 'assets/worlds/arena_02.world.json';
  const world = JSON.parse(fs.readFileSync(path, 'utf8'));

  // River carve follows the world's water volume: centre line and width come
  // from the data, so the ground and the water can never disagree.
  let river: RiverCarve = { z: 12, halfWidth: 2.5, bed: BED, bank: BANK };
  if (world.water && world.water.length > 0) {
    const w = world.water[0];
    river = {
      z: w.center[2],
      halfWidth: w.size[2] / 2,
      bed: BED,
      bank: BANK,
    };
    console.log(
      `river channel from water "${w.id}": z=${river.z}, half-width=${river.halfWidth}`,
    );
  } else {
    console.log('no water volume — carving the default channel');
  }

  const heights: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (let z = 0; z < SAMPLES; z++) {
    for (let x = 0; x < SAMPLES; x++) {
      const wx = ORIGIN + x * CELL;
      const wz = ORIGIN + z * CELL;
      const h = Math.round(arenaHeightAt(wx, wz, river) * 10000) / 10000;
      heights.push(h);
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  world.terrain = {
    width: SAMPLES,
    depth: SAMPLES,
    cellSize: CELL,
    origin: [ORIGIN, 0, ORIGIN],
    heights: heights,
    layers: [],
  };

  fs.writeFileSync(path, JSON.stringify(world, null, 2) + '\n');

  console.log(
    `wrote world.terrain: ${SAMPLES}×${SAMPLES} @ ${CELL.toFixed(4)} m, ` +
    `heights ${min.toFixed(2)}..${max.toFixed(2)} m → ${path}`,
  );
}

main();
