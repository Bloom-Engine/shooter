// SH-025 — terrain height sampling.
//
// Extracted from main.ts because three separate systems need it (enemy
// ground-following, decal placement, explosion craters) and none of them should
// have to reach into the game loop's scope to get it.
//
// This is the SAME heightfield Jolt collides against — sampled bilinearly from
// `world.terrain`, which the editor authors. Enemies are kinematic and steered
// in XZ only, so without this they keep their spawn height and walk straight
// INTO hills (attacking the player "from inside the ground", which is how the
// bug first showed up).

import * as T from './world-runtime';

/// Bilinear height at a world XZ. Clamps to the grid edge outside the covered
/// area, so walking off the authored terrain gives you its border height rather
/// than a hole.
export function terrainHeightAt(x: number, z: number): number {
  const n = T.TERRAIN_SAMPLE_COUNT;
  // A world with no terrain block (a pre-schema-v2 file, or one authored
  // without sculpting) would otherwise index an empty array and hand back NaN —
  // which propagates into every enemy position and every scatter, and shows up
  // as the game silently vanishing rather than as an error. Flat ground is a
  // survivable answer; NaN is not.
  if (n < 2) return 0;

  const fx = (x - T.TERRAIN_ORIGIN_X) / T.TERRAIN_CELL_SIZE;
  const fz = (z - T.TERRAIN_ORIGIN_Z) / T.TERRAIN_CELL_SIZE;
  const cx = fx < 0 ? 0 : (fx > n - 1.001 ? n - 1.001 : fx);
  const cz = fz < 0 ? 0 : (fz > n - 1.001 ? n - 1.001 : fz);
  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const tx = cx - x0;
  const tz = cz - z0;
  const h00 = T.TERRAIN_HEIGHTS[z0 * n + x0];
  const h10 = T.TERRAIN_HEIGHTS[z0 * n + x0 + 1];
  const h01 = T.TERRAIN_HEIGHTS[(z0 + 1) * n + x0];
  const h11 = T.TERRAIN_HEIGHTS[(z0 + 1) * n + x0 + 1];
  const h0 = h00 + (h10 - h00) * tx;
  const h1 = h01 + (h11 - h01) * tx;
  return T.TERRAIN_ORIGIN_Y + h0 + (h1 - h0) * tz;
}
