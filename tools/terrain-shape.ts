// The procedural shape of arena_02's terrain, in one place.
//
// This is *authoring* code: it produced the heightmap that now lives in the
// world file (`world.terrain`), which is the source of truth the game and the
// editor both read. It stays around so the terrain can be re-derived from
// scratch (`bun tools/bake-terrain-to-world.ts`), and because the visual mesh's
// skirt — the ring of hills outside the playable arena that hides the horizon —
// is still generated rather than authored.
//
// Split into two pieces on purpose:
//   arenaHeightAt  — inside the arena. Baked into world.terrain; the editor may
//                    sculpt over it, and once it has, this function no longer
//                    describes what the game loads.
//   skirtHeightAt  — outside the arena. Visual only (nothing walks there, and
//                    the physics heightfield doesn't cover it), so it is
//                    derived every time rather than stored.

export const ARENA_HALF = 40;     // Gameplay arena half-extent. Must match the world bounds.
export const EXTENT_HALF = 140;   // Visual mesh half-extent, including the skirt.

export interface RiverCarve {
  z: number;          // Centre line of the channel (world Z).
  halfWidth: number;  // Half the water's width.
  bed: number;        // Height of the channel floor.
  bank: number;       // Distance over which the bed ramps back to the terrain.
}

// Two gaussian hills, a western ridge, low-frequency waviness, a flat plaza
// around the origin, and a carved river channel. Everything but the carve is a
// pure function of position; the carve is driven by the world's water volume,
// because a riverbed that doesn't line up with its river is just a ditch.
export function arenaHeightAt(x: number, z: number, river: RiverCarve): number {
  // Flatten the plaza so the gameplay colliders sit on level ground.
  const r = Math.sqrt(x * x + z * z);
  const plazaBlend = r < 16 ? 0 : Math.min(1, (r - 16) / 8);

  const hill = (cx: number, cz: number, sigma: number, h: number) => {
    const dx = x - cx, dz = z - cz;
    const d = dx * dx + dz * dz;
    return h * Math.exp(-d / (2 * sigma * sigma));
  };

  let h = 0;
  h += hill(26, -24, 10, 3.2);
  h += hill(-24, 26, 9, 2.6);
  h += hill(30, 28, 7, 1.8);
  h += 1.1 * Math.exp(-Math.pow(x + 28, 2) / 140) *
       0.6 * (1 + Math.sin(z * 0.12));
  h += 0.25 * Math.sin(x * 0.08) * Math.cos(z * 0.10);
  h += 0.18 * Math.sin(x * 0.17 + z * 0.11);

  let y = h * plazaBlend;

  // River channel — carve below the water plane along the river's path, or the
  // riverbed pokes through the surface. Forced to `bed` at the centre line and
  // smoothly ramped back over `bank` metres, so it reads as a carved channel
  // with grassy banks rather than a trench. Drives the visual mesh and the
  // physics heightfield alike: one shape, one source.
  const dzr = Math.abs(z - river.z);
  if (dzr < river.halfWidth + river.bank) {
    let carve = 1.0;
    if (dzr > river.halfWidth) {
      const tt = 1 - (dzr - river.halfWidth) / river.bank;
      carve = tt * tt * (3 - 2 * tt);                   // smoothstep
    }
    // Fade the channel out past the arena so it closes into the skirt hills
    // instead of dead-ending against a wall.
    let endFade = 1.0;
    if (x >= 40) endFade = Math.max(0, 1 - (x - 40) / 14);
    else if (x <= -38) endFade = Math.max(0, 1 - (-38 - x) / 14);
    endFade = endFade * endFade * (3 - 2 * endFade);
    carve *= endFade;
    if (carve > 0) y = y * (1 - carve) + river.bed * carve;
  }

  return y;
}

// Height *added* outside the arena: rolling hills rising with distance, so that
// from any gameplay eye height the horizon (and the dark below-horizon sky)
// stays hidden behind terrain instead of the world ending on a hard edge.
// Zero inside the arena, easing in smoothly at the boundary so the mesh has no
// crease where skirt meets arena.
export function skirtHeightAt(x: number, z: number): number {
  const dEdge = Math.max(Math.abs(x), Math.abs(z));
  if (dEdge <= ARENA_HALF) return 0;

  const t = Math.min(1, (dEdge - ARENA_HALF) / (EXTENT_HALF - ARENA_HALF));
  const ss = t * t * (3 - 2 * t);

  // Angular lobes break the square-ring symmetry; the rolls add local relief.
  const ang = Math.atan2(z, x);
  const lobes = 1 + 0.35 * Math.sin(ang * 3 + 1.7) + 0.2 * Math.sin(ang * 7 + 0.6);
  const roll = Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05 + 0.4) * 3.2
             + Math.sin(x * 0.11 + z * 0.07) * 1.6;

  // Floor the profile: where lobes and roll both dip, sightlines from eye height
  // cleared the ring and the sky peeked through between the hills. 6.5 m at the
  // far edge is ≈ +2.7° above the ground plane from anywhere in the arena.
  return Math.max(ss * (12.0 * lobes + roll), ss * 6.5);
}
