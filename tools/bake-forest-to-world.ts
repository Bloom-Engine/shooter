// Turn the procedural forest into world entities.
//
//   bun tools/bake-forest-to-world.ts assets/worlds/arena_02.world.json
//
// The forest used to be scattered at startup from a fixed LCG seed, which meant
// it was not a thing you could edit: no tree had an identity, and "move that one
// off the path" was not expressible. This runs the same scatter once and writes
// the result into the world file as ordinary entities, after which each tree is
// a normal object the editor can move, rotate, scale, retint, delete, or
// duplicate — and the game just reads them.
//
// Re-running this REPLACES every tree in the world file, discarding any editing
// you have done to them. It is a one-time seeding step, not part of the build.
//
// The scatter itself is unchanged (same seed, same jitter, same variants), so
// the forest that comes out is the forest the game has always drawn. What
// changes is where it lives: data, not code.

import * as fs from 'fs';

const TREE_KIND = 'prop_tree';
const TREE_MODELS = [
  'assets/models/prop_tree.glb',
  'assets/models/prop_tree2.glb',
  'assets/models/prop_tree3.glb',
];

const COUNT_MAX = 88;
const SEED = 0x55aa1234;
const SPAWN_CLEAR = 6;      // Keep trees off the player's spawn.
const KEEPOUT_MARGIN = 1.5; // Clearance from water and buildings.

interface Rect { x0: number; x1: number; z0: number; z1: number; }

function main(): void {
  const path = process.argv[2] || 'assets/worlds/arena_02.world.json';
  const world = JSON.parse(fs.readFileSync(path, 'utf8'));

  const terrain = world.terrain;
  if (!terrain) {
    console.error(`${path} has no terrain — run bake-terrain-to-world.ts first.`);
    process.exit(1);
  }

  // Keep-out shapes, derived from the world rather than hardcoded: the water
  // volumes, and the bounding box of the building's colliders.
  const keepOut: Rect[] = [];
  for (const w of world.water ?? []) {
    keepOut.push({
      x0: w.center[0] - w.size[0] / 2,
      x1: w.center[0] + w.size[0] / 2,
      z0: w.center[2] - w.size[2] / 2,
      z1: w.center[2] + w.size[2] / 2,
    });
  }

  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const e of world.entities) {
    const ud = e.userData ?? {};
    if (ud.kind !== 'static_mesh' || ud.collider !== 'box') continue;
    if (!(e.tags ?? []).includes('building')) continue;
    const he = (ud.halfExtents ?? '0.5, 0.5, 0.5').split(',').map(Number);
    bx0 = Math.min(bx0, e.transform.position[0] - he[0]);
    bx1 = Math.max(bx1, e.transform.position[0] + he[0]);
    bz0 = Math.min(bz0, e.transform.position[2] - he[2]);
    bz1 = Math.max(bz1, e.transform.position[2] + he[2]);
  }
  if (bx0 < Infinity) {
    keepOut.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1 });
    console.log(`building footprint: x ${bx0.toFixed(1)}..${bx1.toFixed(1)}, z ${bz0.toFixed(1)}..${bz1.toFixed(1)}`);
  }

  const spawn = world.entities.find((e: any) => e.userData?.kind === 'player_spawn');
  const spawnX = spawn ? spawn.transform.position[0] : 0;
  const spawnZ = spawn ? spawn.transform.position[2] : 0;

  const blocked = (x: number, z: number): boolean => {
    for (const r of keepOut) {
      if (x > r.x0 - KEEPOUT_MARGIN && x < r.x1 + KEEPOUT_MARGIN &&
          z > r.z0 - KEEPOUT_MARGIN && z < r.z1 + KEEPOUT_MARGIN) return true;
    }
    return Math.hypot(x - spawnX, z - spawnZ) < SPAWN_CLEAR;
  };

  // Bilinear sample of the authored heightmap: trees stand on the ground.
  const groundAt = (x: number, z: number): number => {
    const fx = (x - terrain.origin[0]) / terrain.cellSize;
    const fz = (z - terrain.origin[2]) / terrain.cellSize;
    if (fx < 0 || fz < 0 || fx >= terrain.width - 1 || fz >= terrain.depth - 1) return 0;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const h00 = terrain.heights[iz * terrain.width + ix];
    const h10 = terrain.heights[iz * terrain.width + ix + 1];
    const h01 = terrain.heights[(iz + 1) * terrain.width + ix];
    const h11 = terrain.heights[(iz + 1) * terrain.width + ix + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };

  // The original scatter, verbatim: same LCG, same rejection order, same jitter.
  let seed = SEED | 0;
  const rand = (): number => {
    seed = ((seed * 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const trees: any[] = [];
  for (let attempt = 0; attempt < COUNT_MAX * 4 && trees.length < COUNT_MAX; attempt++) {
    const r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand(), r5 = rand();
    const px = -36 + r1 * 72;
    const pz = -36 + r2 * 72;
    if (blocked(px, pz)) continue;

    const py = groundAt(px, pz);
    const variant = Math.floor(r3 * 3) % 3;
    const yawDeg = r3 * 360;
    // Leaf-card tree is ~5.5 m at scale 1; 0.85..1.45 gives a believable size
    // hierarchy (4.7..8 m) rather than a field of identical bushes.
    const scale = 0.85 + r4 * 0.60;
    // Subtle per-tree hue shift (±10% around white) so the forest doesn't read
    // as one model copy-pasted.
    const hue = (r5 - 0.5) * 0.20;

    const n = trees.length + 1;
    const id = 'tree_' + String(n).padStart(4, '0');
    trees.push({
      id: id,
      name: id,
      modelRef: TREE_MODELS[variant],
      prefabRef: null,
      transform: {
        position: [round(px), round(py), round(pz)],
        rotation: [0, round(yawDeg * Math.PI / 180), 0],
        scale: [round(scale), round(scale), round(scale)],
      },
      tint: [round(1 - hue), round(1 + hue * 0.5), round(1 - hue * 0.8), 1],
      tags: ['prop', 'tree'],
      userData: { kind: TREE_KIND },
    });
  }

  const kept = world.entities.filter((e: any) => e.userData?.kind !== TREE_KIND);
  const removed = world.entities.length - kept.length;
  world.entities = kept.concat(trees);

  fs.writeFileSync(path, JSON.stringify(world, null, 2) + '\n');
  console.log(
    `wrote ${trees.length} ${TREE_KIND} entities to ${path}` +
    (removed > 0 ? ` (replaced ${removed} existing)` : ''),
  );
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

main();
