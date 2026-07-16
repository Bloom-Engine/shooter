// SH-051 — vertical navigation: what an enemy is standing on, and how it gets
// to another floor.
//
// WHY THIS EXISTS. Enemies were pinned to the terrain heightfield
// (`enY[i] = terrainHeightAt(nx, nz)`), so they could not stand on a building
// floor at all — the house was, to the AI, a flat patch of ground with some
// walls scribbled on it. Combined with an XZ-ONLY distance check in the melee
// test, an enemy on the ground floor sat directly under a player on the first
// floor at `dist ~= 0` and clawed them to death through the ceiling. That is
// the bug this module exists to make impossible.
//
// Three things are needed and they are all here:
//   1. surfaceHeightAt() — the walkable height at (x,z), floors included.
//   2. The stair FLIGHTS, derived from the world's `stair`-tagged boxes.
//   3. navGoal() — where an enemy should walk when the player is on another
//      floor (the stair, not the player).
//
// Perry rules this module follows (see perry-quirks.md):
// - NO engine calls at module scope. This module makes no engine calls at all;
//   it is arithmetic over world-runtime's flat arrays plus terrainHeightAt.
//   Building the flight table still happens in initNav(), called from main.ts,
//   so boot ORDER stays explicit rather than import-order-dependent.
// - NO exported `let`. Cross-module state is slots on the const NAV object.
// - Flat arrays built with new Array(n) + index assignment, never .push().

import * as W from './world-runtime';
import { terrainHeightAt } from './terrain';

/// How far a walker can rise in one step without a ramp. The house's steps rise
/// 0.308 m, so this must clear that; it must also stay well UNDER a floor-to-
/// floor gap (3.7 m here) or enemies would teleport up through the ceiling —
/// which is the same bug in a different costume.
export const STEP_UP = 0.5;

/// Two feet-heights closer than this count as "the same floor". Sized between
/// the tallest single step (0.31 m) and the shortest floor gap (3.7 m), and
/// generous enough to survive a jump and a slope.
export const SAME_FLOOR_EPS = 2.0;

/// playerPosition() returns the CAPSULE CENTRE, not the feet — halfHeight 0.6 +
/// radius 0.35 puts the soles 0.95 below it (see player.ts). Every comparison
/// against an enemy's Y is feet-to-feet, because an enemy's Y *is* its feet.
/// Getting this wrong is a silent 0.95 m of free reach.
export const PLAYER_FEET_OFF = 0.95;

/// Building boxes that a walker can stand ON. Flat parallel arrays, index-
/// assigned. Populated by initNav().
export const NAV: any = {
  boxCount: 0,
  boxX0: [], boxX1: [], boxZ0: [], boxZ1: [], boxTop: [], boxBot: [], boxIsStair: [],
  // Stair flights, derived. A flight is walked along ONE horizontal axis.
  flightCount: 0,
  // A = the LOWEST tread, B = the HIGHEST tread (centres, world XZ).
  fAX: [], fAZ: [], fBX: [], fBZ: [],
  // The floor level each end serves: fLoY is the floor the flight rises FROM,
  // fHiY the floor it arrives AT (== the top tread's surface).
  fLoY: [], fHiY: [],
  // The LANDING: one pace beyond the top tread, out on the upper floor. The low
  // end gets no equivalent — the bottom tread IS the entry, because a walker
  // steps straight onto it, and padding "before" it would place the waypoint
  // inside (or through) the wall the staircase backs onto. In the shipped house
  // the bottom tread sits 0.9 m off the east wall, so a 1.2 m pad landed
  // OUTSIDE the building.
  fLandX: [], fLandZ: [],
  fHalfW: [],   // perpendicular half-width of the flight (its tread width)
  // The house's overall XZ bounds — the early-out for surfaceHeightAt.
  bx0: 0, bx1: 0, bz0: 0, bz1: 0, hasBldg: 0,
};

/// Build the walkable-box table and the stair flights from the world file.
/// Call once at boot, after world-runtime has parsed (main.ts does).
export function initNav(): void {
  // ---- walkable boxes -----------------------------------------------------
  let n = 0;
  for (let i = 0; i < W.MESH_COUNT; i++) {
    const mi = W.MESH_MODEL_IDX[i];
    if (W.MODEL_IS_BOX[mi] !== 1 || W.MESH_CATEGORY[i] !== 1) continue;
    n = n + 1;
  }
  const bx0 = new Array<number>(n), bx1 = new Array<number>(n);
  const bz0 = new Array<number>(n), bz1 = new Array<number>(n);
  const btop = new Array<number>(n), bbot = new Array<number>(n), bstair = new Array<number>(n);
  let w = 0;
  let ax0 = 1e9, ax1 = -1e9, az0 = 1e9, az1 = -1e9, any = 0;
  for (let i = 0; i < W.MESH_COUNT; i++) {
    const mi = W.MESH_MODEL_IDX[i];
    if (W.MODEL_IS_BOX[mi] !== 1 || W.MESH_CATEGORY[i] !== 1) continue;
    const hx = W.MESH_COLLIDER_HX[i], hy = W.MESH_COLLIDER_HY[i], hz = W.MESH_COLLIDER_HZ[i];
    bx0[w] = W.MESH_X[i] - hx; bx1[w] = W.MESH_X[i] + hx;
    bz0[w] = W.MESH_Z[i] - hz; bz1[w] = W.MESH_Z[i] + hz;
    btop[w] = W.MESH_Y[i] + hy;
    bbot[w] = W.MESH_Y[i] - hy;
    bstair[w] = W.MESH_IS_STAIR[i];
    if (bx0[w] < ax0) ax0 = bx0[w];
    if (bx1[w] > ax1) ax1 = bx1[w];
    if (bz0[w] < az0) az0 = bz0[w];
    if (bz1[w] > az1) az1 = bz1[w];
    any = 1;
    w = w + 1;
  }
  NAV.boxCount = w;
  NAV.boxX0 = bx0; NAV.boxX1 = bx1; NAV.boxZ0 = bz0; NAV.boxZ1 = bz1;
  NAV.boxTop = btop; NAV.boxBot = bbot; NAV.boxIsStair = bstair;
  NAV.hasBldg = any;
  if (any === 1) {
    // Pad the early-out box: an enemy standing just outside the wall still needs
    // the floor under the doorway to exist.
    NAV.bx0 = ax0 - 2.0; NAV.bx1 = ax1 + 2.0;
    NAV.bz0 = az0 - 2.0; NAV.bz1 = az1 + 2.0;
  }

  // ---- stair flights ------------------------------------------------------
  // A flight is a run of `stair` boxes sharing a horizontal line. Rather than
  // trust a naming convention (the shipped house calls them h_stair_a_* and
  // h_stair_b_*, which is house-v2's private business), group them by the axis
  // they DON'T travel along: every step in a flight shares that coordinate.
  //
  // The steps are boxes rising from the floor to their tread, so a step's
  // walkable height is its TOP, and the flight's endpoints are the lowest and
  // highest treads.
  let sc = 0;
  for (let i = 0; i < W.MESH_COUNT; i++) {
    if (W.MESH_IS_STAIR[i] === 1) sc = sc + 1;
  }
  // At most one flight per step (degenerate), which is the safe upper bound.
  const fax = new Array<number>(sc), faz = new Array<number>(sc);
  const fbx = new Array<number>(sc), fbz = new Array<number>(sc);
  const floY = new Array<number>(sc), fhiY = new Array<number>(sc);
  const flx = new Array<number>(sc), flz = new Array<number>(sc);
  const fhw = new Array<number>(sc);
  let fc = 0;
  // Precompute each step's tread height once — the flood below reads it O(n^2).
  const topOf = new Array<number>(W.MESH_COUNT);
  for (let i = 0; i < W.MESH_COUNT; i++) {
    topOf[i] = W.MESH_Y[i] + W.MESH_COLLIDER_HY[i];
  }

  // Group steps into flights by ADJACENCY, flood-filled from a seed: two treads
  // belong to the same flight if they are within one run of each other
  // horizontally AND within one riser vertically.
  //
  // The obvious cheaper test — "same fixed axis" — is WRONG here and the [nav]
  // boot log caught it: this house's two flights are stacked directly above one
  // another and use the SAME x values (-10.1 .. -13.4), differing only in z. So
  // "shares an axis" merged both staircases into one 10 m-long flight running
  // diagonally through the building. Adjacency makes no assumption about which
  // axis a flight travels, which is also what lets a future arena turn a corner.
  const used = new Array<number>(W.MESH_COUNT);
  for (let i = 0; i < W.MESH_COUNT; i++) used[i] = 0;
  const stack = new Array<number>(sc);
  for (let i = 0; i < W.MESH_COUNT; i++) {
    if (W.MESH_IS_STAIR[i] !== 1 || used[i] === 1) continue;
    let sp = 0;
    stack[sp] = i; sp = sp + 1; used[i] = 1;
    let loX = W.MESH_X[i], loZ = W.MESH_Z[i], loTop = topOf[i];
    let hiX = loX, hiZ = loZ, hiTop = loTop;
    let hw = 0.5;
    let nSteps = 0;
    while (sp > 0) {
      sp = sp - 1;
      const c = stack[sp];
      nSteps = nSteps + 1;
      if (topOf[c] < loTop) { loTop = topOf[c]; loX = W.MESH_X[c]; loZ = W.MESH_Z[c]; }
      if (topOf[c] > hiTop) { hiTop = topOf[c]; hiX = W.MESH_X[c]; hiZ = W.MESH_Z[c]; }
      // A tread's width ACROSS the flight is its long horizontal half-extent
      // (a step is thin along the direction you climb).
      const wc = Math.max(W.MESH_COLLIDER_HX[c], W.MESH_COLLIDER_HZ[c]);
      if (wc > hw) hw = wc;
      for (let j = 0; j < W.MESH_COUNT; j++) {
        if (W.MESH_IS_STAIR[j] !== 1 || used[j] === 1) continue;
        const dxj = W.MESH_X[j] - W.MESH_X[c];
        const dzj = W.MESH_Z[j] - W.MESH_Z[c];
        const hd2 = dxj * dxj + dzj * dzj;
        const dtj = Math.abs(topOf[j] - topOf[c]);
        if (hd2 > 0.8 * 0.8 || dtj > 0.5) continue;    // not the next tread along
        used[j] = 1;
        stack[sp] = j; sp = sp + 1;
      }
    }
    const dirX = hiX - loX, dirZ = hiZ - loZ;
    const dl = Math.sqrt(dirX * dirX + dirZ * dirZ);
    const ux = dl > 0.001 ? dirX / dl : 1, uz = dl > 0.001 ? dirZ / dl : 0;
    fax[fc] = loX; faz[fc] = loZ;
    fbx[fc] = hiX; fbz[fc] = hiZ;
    // The floor this flight rises FROM is one riser below its lowest tread. The
    // riser comes from THIS flight's own step count — using the global stair
    // count divided the height by every step in the house and put the ground
    // floor at 0.33 instead of 0.20.
    const rise = nSteps > 1 ? (hiTop - loTop) / (nSteps - 1) : 0.3;
    floY[fc] = loTop - rise;
    fhiY[fc] = hiTop;
    // Landing: one pace past the top tread, along the climb direction.
    flx[fc] = hiX + ux * 1.2; flz[fc] = hiZ + uz * 1.2;
    fhw[fc] = hw;
    fc = fc + 1;
  }
  NAV.flightCount = fc;
  NAV.fAX = fax; NAV.fAZ = faz; NAV.fBX = fbx; NAV.fBZ = fbz;
  NAV.fLoY = floY; NAV.fHiY = fhiY;
  NAV.fLandX = flx; NAV.fLandZ = flz; NAV.fHalfW = fhw;

  console.log('[nav] ' + NAV.boxCount + ' walkable boxes, ' + fc + ' stair flight(s)');
  for (let f = 0; f < fc; f++) {
    console.log('[nav]   flight ' + f
      + ': floor y=' + floY[f].toFixed(2) + ' -> y=' + fhiY[f].toFixed(2)
      + '  tread A (' + fax[f].toFixed(1) + ',' + faz[f].toFixed(1) + ')'
      + ' -> B (' + fbx[f].toFixed(1) + ',' + fbz[f].toFixed(1) + ')'
      + '  landing (' + flx[f].toFixed(1) + ',' + flz[f].toFixed(1) + ')');
  }
}

/// Is (x,y,z) ON flight `f`'s treads — actually standing on the staircase?
///
/// Projects onto the A->B segment; `t` past 1 covers the landing. Stateless on
/// purpose: a walker's goal is a function of where it IS, so it cannot get stuck
/// holding a waypoint it already passed.
///
/// THE HEIGHT TEST IS NOT OPTIONAL, and leaving it out is a deadlock. A
/// staircase is a solid wedge with FLOOR underneath it: an enemy on the ground
/// floor beneath the landing has exactly the landing's XZ. With an XZ-only test
/// it reported "on the flight", so its goal became the landing it was already
/// standing under, its seek velocity went to zero, and it stood there forever.
/// The STAIRTEST harness caught precisely this — every enemy parked at
/// (-14.6, 0.20, -8.2), the landing's XZ at ground level.
///
/// So: compare the walker's height to the tread height expected at `t`. Being
/// under the stairs is not being on them.
export function onFlight(f: number, x: number, y: number, z: number): boolean {
  const ax = NAV.fAX[f], az = NAV.fAZ[f];
  const sx = NAV.fBX[f] - ax, sz = NAV.fBZ[f] - az;
  const L2 = sx * sx + sz * sz;
  if (L2 < 0.0001) return false;
  let t = ((x - ax) * sx + (z - az) * sz) / L2;
  if (t < -0.15 || t > 1.45) return false;      // 1.45 reaches the landing
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const px = ax + sx * t, pz = az + sz * t;
  const dx = x - px, dz = z - pz;
  const w = NAV.fHalfW[f] + 0.5;
  if ((dx * dx + dz * dz) > w * w) return false;
  // Height the treads are at, this far along. Tolerance clears one riser.
  const expY = NAV.fLoY[f] + (NAV.fHiY[f] - NAV.fLoY[f]) * t;
  return Math.abs(y - expY) <= 0.7;
}

/// Would a walker at height `curY` be walking INTO a stair's solid mass at
/// (x,z)? A staircase is a wedge of boxes rising from the floor, so from the
/// high side it is a wall, and from the low side it is a ramp — the SAME box,
/// and which one it is depends entirely on how high you already are.
///
/// The static obstacle circles in main.ts cannot express that: they are 2D and
/// Y-blind, so they either fence the stairs off from everyone (what they used to
/// do, and why nothing could climb) or let everyone walk through the wedge. This
/// is the Y-aware half, and it is checked per move.
///
/// Blocked = the box's top is more than one step above us (we cannot mount it)
/// AND its mass is at our body's height (it is not a ceiling we walk under).
export function navStairBlocked(x: number, z: number, curY: number): boolean {
  if (NAV.hasBldg !== 1) return false;
  if (x < NAV.bx0 || x > NAV.bx1 || z < NAV.bz0 || z > NAV.bz1) return false;
  const lim = curY + STEP_UP;
  const head = curY + 1.6;          // roughly a walker's height
  for (let i = 0; i < NAV.boxCount; i++) {
    if (NAV.boxIsStair[i] !== 1) continue;
    if (x < NAV.boxX0[i] || x > NAV.boxX1[i]) continue;
    if (z < NAV.boxZ0[i] || z > NAV.boxZ1[i]) continue;
    if (NAV.boxTop[i] <= lim) continue;        // low enough to step onto
    if (NAV.boxBot[i] >= head) continue;       // high enough to walk under
    return true;
  }
  return false;
}

/// The height of the surface a walker at (x,z) is standing on, given the height
/// it is at now. Terrain, plus any building box it can be ON.
///
/// `curY` is what makes this work without a physics query: a box counts only if
/// its top is no more than STEP_UP above where the walker already is. So the
/// first-floor slab is furniture to someone on the ground (3.9 m up, ignored)
/// and floor to someone who climbed the stairs — and each 0.31 m tread is a
/// step up from the one before. That is the whole staircase, for free.
export function surfaceHeightAt(x: number, z: number, curY: number): number {
  let best = terrainHeightAt(x, z);
  if (NAV.hasBldg !== 1) return best;
  if (x < NAV.bx0 || x > NAV.bx1 || z < NAV.bz0 || z > NAV.bz1) return best;
  const lim = curY + STEP_UP;
  for (let i = 0; i < NAV.boxCount; i++) {
    if (x < NAV.boxX0[i] || x > NAV.boxX1[i]) continue;
    if (z < NAV.boxZ0[i] || z > NAV.boxZ1[i]) continue;
    const t = NAV.boxTop[i];
    if (t > lim) continue;       // too high to step onto from here
    if (t > best) best = t;
  }
  return best;
}

/// Which stair flight, if any, gets a walker at (ex,ez,ey) toward `targetY`.
/// Returns the flight index, or -1 when none applies.
///
/// A flight is usable in the direction you need it: to go UP, its bottom must be
/// on your level; to go DOWN, its top must be. Ties break on horizontal distance
/// to the end you would enter, so an enemy takes the near staircase.
export function navFlightFor(ex: number, ey: number, ez: number, targetY: number): number {
  const up = targetY > ey;
  let best = -1;
  let bestD = 1e9;
  for (let f = 0; f < NAV.flightCount; f++) {
    // The level we'd board this flight from must be OUR level, and the level it
    // delivers to must be progress toward the target. A flight from the first
    // floor to the roof is no use to someone on the ground, even though it is
    // "upward" — they need the one below it first, and they will pick this one
    // once they arrive. That chaining is what makes two flights reach the roof
    // with no path graph.
    const boardY = up ? NAV.fLoY[f] : NAV.fHiY[f];
    const exitY  = up ? NAV.fHiY[f] : NAV.fLoY[f];
    if (Math.abs(boardY - ey) > SAME_FLOOR_EPS) continue;
    if (up && exitY <= ey + 0.5) continue;
    if (!up && exitY >= ey - 0.5) continue;
    // Don't board a flight that climbs PAST the player's floor.
    if (up && exitY > targetY + SAME_FLOOR_EPS) continue;
    if (!up && exitY < targetY - SAME_FLOOR_EPS) continue;
    const bx = up ? NAV.fAX[f] : NAV.fLandX[f];
    const bz = up ? NAV.fAZ[f] : NAV.fLandZ[f];
    const dx = bx - ex, dz = bz - ez;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

/// Where a walker at (ex,ey,ez) should head to reach `targetY`, written into
/// `out` as [x, z, active]. `active` is 1 when a stair is being used — the
/// caller should then steer to (x,z) and NOT attack, because it is travelling.
///
/// Two waypoints, chosen by whether the walker is already on the treads:
///   off the flight -> the end you board at (bottom tread going up, top landing
///                     coming down). The existing wall obstacles funnel it
///                     through the doors on the way, unchanged.
///   on the flight  -> the far end, which means walking up (or down) it. The
///                     climbing itself is surfaceHeightAt's job: each tread is
///                     within STEP_UP of the last.
export function navGoal(ex: number, ey: number, ez: number, targetY: number,
                        out: number[]): void {
  out[2] = 0;
  const f = navFlightFor(ex, ey, ez, targetY);
  if (f < 0) return;
  const up = targetY > ey;
  const on = onFlight(f, ex, ey, ez);
  // Boarding end vs far end, flipped by direction of travel.
  const boardX = up ? NAV.fAX[f] : NAV.fLandX[f];
  const boardZ = up ? NAV.fAZ[f] : NAV.fLandZ[f];
  const farX   = up ? NAV.fLandX[f] : NAV.fAX[f];
  const farZ   = up ? NAV.fLandZ[f] : NAV.fAZ[f];
  out[0] = on ? farX : boardX;
  out[1] = on ? farZ : boardZ;
  out[2] = 1;
}
