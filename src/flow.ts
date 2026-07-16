// SH-051b — flow-field routing over the building's walkable floors.
//
// WHY THIS EXISTS. nav.ts gives an enemy the right WAYPOINT (the stair it
// should board), but SH-051 showed the walk TO that waypoint is the part that
// fails: the route in is a corner, greedy seeks do not turn corners, and the
// wall-repulsion circles fence the lowest tread (it sits inside the east
// wall's ~1.3 m repulsion field). Every local rule tried there was reverted.
//
// This module is the non-local rule: a coarse grid over the building (one
// layer per floor level, layers linked by nav.ts's stair flights), and a BFS
// flow field seeded at the player's cell. Following the field turns corners
// by construction, because the field only ever flows through walkable cells —
// and it routes DOWN the stairs as readily as up, because the portal edges
// are undirected.
//
// Perry rules (same as nav.ts): no engine calls at all; no exported `let`
// (state lives on the const FLOW object); flat arrays via new Array(n) +
// index assignment; top-level functions only. initFlow() is called from
// main.ts after initNav() so boot order stays explicit.

import {
  NAV, SAME_FLOOR_EPS, onFlight, navFlightFor, surfaceHeightAt,
} from './nav';

/// Grid resolution. Half a metre resolves the house's 1.2 m doorways (two
/// clear cells) and the 2.8 m stairwell without making the graph big: the
/// house + 4 m of apron is ~64 x 48 cells x 3 levels ≈ 9k nodes, and the BFS
/// over it is microseconds — cheap enough to re-run whenever the player
/// changes cell.
export const FLOW_CELL = 0.5;

/// Walls are inflated by this much when a cell is tested for walkability, so
/// the field keeps a body's width off them where there is room. Deliberately
/// LESS than the repulsion circles' padding: cells the circles would deny
/// (the stair approach) must stay in the graph — the circles are suppressed
/// only in the mounting zone, and elsewhere they still shepherd the body.
export const FLOW_WALL_PAD = 0.25;

export const FLOW: any = {
  ready: 0,        // grid built (initFlow ran and found a building + stairs)
  active: 0,       // field currently seeded at a reachable player node
  x0: 0, z0: 0, nx: 0, nz: 0,
  lvlCount: 0, lvlY: [],
  walk: [],        // 1 per node — cell is standable at that level
  nextNode: [],    // per node: node index of the next hop toward the player, -1 none
  flightVia: [],   // per node: flight index when the next hop crosses a stair portal, else -1
  // Stair portals: node index at each end + the flight they belong to.
  portalCount: 0, pA: [], pB: [], pF: [],
  // BFS scratch, allocated once.
  dist: [], queue: [],
  // Player-node cache — the field is only rebuilt when this changes.
  lastNode: -1,
};

function nodeOf(l: number, ix: number, iz: number): number {
  return (l * FLOW.nz + iz) * FLOW.nx + ix;
}

function levelOf(y: number): number {
  let best = -1;
  let bestD = SAME_FLOOR_EPS;
  for (let l = 0; l < FLOW.lvlCount; l++) {
    const d = Math.abs(FLOW.lvlY[l] - y);
    if (d < bestD) { bestD = d; best = l; }
  }
  return best;
}

/// Is a walker's body blocked by a (non-stair) building box at (x,z) on level
/// y? Same span test as nav.ts's navStairBlocked, inflated by FLOW_WALL_PAD.
function flowWallBlocked(x: number, z: number, y: number, wallPad: number): boolean {
  for (let i = 0; i < NAV.boxCount; i++) {
    // Stair boxes are NOT skipped: a staircase is a wall from the high side
    // (same height-aware test navStairBlocked applies per move). Skipping
    // them made the ground-level cells UNDER the wedge walkable in the
    // graph, so the field's shortest path ran straight through the
    // staircase and walkers pinballed against its mass (STAIRTEST caught
    // it: stuck at ground under the landing).
    //
    // Treads always get pad 0 — they are for standing on, and padding the
    // second tread turned the bottom tread's cell into a one-cell island
    // (the reach probe showed the upstairs flood crossing the portal and
    // stopping dead at L0 = 1/2540). `wallPad` is the caller's business:
    // the GRAPH pads walls so routes prefer clearance; the MOVE law and the
    // portal approach rings use 0, because the real mount is a 0.5 m gap
    // between the bottom tread and the east wall that no padded cell fits.
    const pad = NAV.boxIsStair[i] === 1 ? 0.0 : wallPad;
    if (x < NAV.boxX0[i] - pad || x > NAV.boxX1[i] + pad) continue;
    if (z < NAV.boxZ0[i] - pad || z > NAV.boxZ1[i] + pad) continue;
    if (NAV.boxTop[i] <= y + 0.4) continue;   // low enough to step over / stand on
    if (NAV.boxBot[i] >= y + 1.5) continue;   // high enough to walk under
    return true;
  }
  return false;
}

/// Build the grid. Call once at boot, after initNav().
export function initFlow(): void {
  FLOW.ready = 0;
  FLOW.active = 0;
  if (NAV.hasBldg !== 1 || NAV.flightCount === 0) return;

  // ---- levels: the distinct floor heights the flights connect ------------
  const raw = new Array<number>(NAV.flightCount * 2);
  for (let f = 0; f < NAV.flightCount; f++) {
    raw[f * 2] = NAV.fLoY[f];
    raw[f * 2 + 1] = NAV.fHiY[f];
  }
  const lvl = new Array<number>(raw.length);
  let lc = 0;
  for (let i = 0; i < raw.length; i++) {
    let dup = 0;
    for (let j = 0; j < lc; j++) {
      if (Math.abs(lvl[j] - raw[i]) < 0.5) { dup = 1; break; }
    }
    if (dup === 0) { lvl[lc] = raw[i]; lc = lc + 1; }
  }
  // Ascending — insertion sort, lc is tiny.
  for (let a = 1; a < lc; a++) {
    const v = lvl[a];
    let b = a - 1;
    while (b >= 0 && lvl[b] > v) { lvl[b + 1] = lvl[b]; b = b - 1; }
    lvl[b + 1] = v;
  }
  FLOW.lvlCount = lc;
  FLOW.lvlY = lvl;

  // ---- grid over the building bounds + apron ------------------------------
  const x0 = NAV.bx0 - 2.0, x1 = NAV.bx1 + 2.0;
  const z0 = NAV.bz0 - 2.0, z1 = NAV.bz1 + 2.0;
  const nx = Math.max(1, Math.ceil((x1 - x0) / FLOW_CELL));
  const nz = Math.max(1, Math.ceil((z1 - z0) / FLOW_CELL));
  FLOW.x0 = x0; FLOW.z0 = z0; FLOW.nx = nx; FLOW.nz = nz;
  const total = lc * nx * nz;
  const walk = new Array<number>(total);
  for (let l = 0; l < lc; l++) {
    const y = lvl[l];
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = x0 + (ix + 0.5) * FLOW_CELL;
        const z = z0 + (iz + 0.5) * FLOW_CELL;
        // Within mounting distance of a stair end, walls are tested at pad 0
        // (true mass only): the shipped mount is a 0.5 m gap between the
        // bottom tread and the east wall, and successive probes showed no
        // fixed ring bridges the padded no-man's-land around it (reach went
        // 1 -> 6 of 2566 and stayed cut off). Everywhere else keeps the
        // body pad, so routes still prefer clearance where there is room.
        let mount = 0;
        for (let f2 = 0; f2 < NAV.flightCount; f2++) {
          const dax = x - NAV.fAX[f2], daz = z - NAV.fAZ[f2];
          const dlx = x - NAV.fLandX[f2], dlz = z - NAV.fLandZ[f2];
          if (dax * dax + daz * daz <= 16.0 || dlx * dlx + dlz * dlz <= 16.0) { mount = 1; break; }
        }
        let ok = 0;
        const s = surfaceHeightAt(x, z, y + 0.1);
        if (Math.abs(s - y) <= 0.6
            && !flowWallBlocked(x, z, y, mount === 1 ? 0.0 : FLOW_WALL_PAD)) ok = 1;
        walk[nodeOf(l, ix, iz)] = ok;
      }
    }
  }

  // ---- stair portals -------------------------------------------------------
  // One per flight: the cell at the bottom tread on the lower level, and the
  // cell at the landing on the upper level. Both are forced walkable — the
  // bottom tread sits in the east wall's inflation shadow by design, and a
  // portal you cannot stand at is no portal.
  const pA = new Array<number>(NAV.flightCount);
  const pB = new Array<number>(NAV.flightCount);
  const pF = new Array<number>(NAV.flightCount);
  let pc = 0;
  for (let f = 0; f < NAV.flightCount; f++) {
    const la = levelOf(NAV.fLoY[f]);
    const lb = levelOf(NAV.fHiY[f]);
    if (la < 0 || lb < 0) continue;
    const aix = Math.floor((NAV.fAX[f] - x0) / FLOW_CELL);
    const aiz = Math.floor((NAV.fAZ[f] - z0) / FLOW_CELL);
    const bix = Math.floor((NAV.fLandX[f] - x0) / FLOW_CELL);
    const biz = Math.floor((NAV.fLandZ[f] - z0) / FLOW_CELL);
    if (aix < 0 || aix >= nx || aiz < 0 || aiz >= nz) continue;
    if (bix < 0 || bix >= nx || biz < 0 || biz >= nz) continue;
    const a = nodeOf(la, aix, aiz);
    const b = nodeOf(lb, bix, biz);
    walk[a] = 1;
    walk[b] = 1;
    pA[pc] = a; pB[pc] = b; pF[pc] = f;
    pc = pc + 1;
  }
  FLOW.portalCount = pc;
  FLOW.pA = pA; FLOW.pB = pB; FLOW.pF = pF;
  FLOW.walk = walk;

  const nextNode = new Array<number>(total);
  const flightVia = new Array<number>(total);
  const dist = new Array<number>(total);
  const queue = new Array<number>(total);
  for (let i = 0; i < total; i++) { nextNode[i] = -1; flightVia[i] = -1; dist[i] = -1; }
  FLOW.nextNode = nextNode;
  FLOW.flightVia = flightVia;
  FLOW.dist = dist;
  FLOW.queue = queue;
  FLOW.lastNode = -1;
  FLOW.ready = 1;

  let wc = 0;
  for (let i = 0; i < total; i++) if (walk[i] === 1) wc = wc + 1;
  console.log('[flow] ' + nx + 'x' + nz + ' cells x ' + lc + ' levels, '
    + wc + ' walkable, ' + pc + ' stair portal(s)');
}

/// Nearest walkable node to (x,z) on level `l`, searching outward up to
/// `maxR` cells. Returns -1 when nothing is standable nearby.
function nearestWalkable(l: number, ix: number, iz: number, maxR: number): number {
  for (let r = 0; r <= maxR; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;   // ring only
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jx >= FLOW.nx || jz < 0 || jz >= FLOW.nz) continue;
        const n = nodeOf(l, jx, jz);
        if (FLOW.walk[n] === 1) return n;
      }
    }
  }
  return -1;
}

/// Re-seed the flow field at the player. Cheap when the player has not
/// changed cell (one node computation, then out). Call once per director
/// update — BEFORE the enemy loop reads it.
export function flowRecompute(px: number, pFeetY: number, pz: number): void {
  if (FLOW.ready !== 1) return;
  const pl = levelOf(pFeetY);
  if (pl < 0) { FLOW.active = 0; FLOW.lastNode = -1; return; }
  // Clamp into the grid: a player out in the field still seeds the field at
  // the building's edge, which is the right direction for anyone upstairs.
  let ix = Math.floor((px - FLOW.x0) / FLOW_CELL);
  let iz = Math.floor((pz - FLOW.z0) / FLOW_CELL);
  if (ix < 0) ix = 0; if (ix >= FLOW.nx) ix = FLOW.nx - 1;
  if (iz < 0) iz = 0; if (iz >= FLOW.nz) iz = FLOW.nz - 1;
  let seed = nodeOf(pl, ix, iz);
  if (FLOW.walk[seed] !== 1) seed = nearestWalkable(pl, ix, iz, 6);
  if (seed < 0) { FLOW.active = 0; FLOW.lastNode = -1; return; }
  if (seed === FLOW.lastNode && FLOW.active === 1) return;
  FLOW.lastNode = seed;

  // ---- BFS out from the player over cells + portals -----------------------
  const total = FLOW.lvlCount * FLOW.nx * FLOW.nz;
  const dist = FLOW.dist, next = FLOW.nextNode, via = FLOW.flightVia;
  const walk = FLOW.walk, queue = FLOW.queue;
  for (let i = 0; i < total; i++) { dist[i] = -1; next[i] = -1; via[i] = -1; }
  let qh = 0, qt = 0;
  dist[seed] = 0;
  queue[qt] = seed; qt = qt + 1;
  const layer = FLOW.nx * FLOW.nz;
  while (qh < qt) {
    const n = queue[qh]; qh = qh + 1;
    const d = dist[n];
    const l = Math.floor(n / layer);
    const rem = n - l * layer;
    const niz = Math.floor(rem / FLOW.nx);
    const nix = rem - niz * FLOW.nx;
    // 4-neighbours on the same level. The hop points BACK toward the seed:
    // next[m] = n means "from m, walk to n to close on the player".
    if (nix > 0) {
      const m = n - 1;
      if (walk[m] === 1 && dist[m] < 0) { dist[m] = d + 1; next[m] = n; queue[qt] = m; qt = qt + 1; }
    }
    if (nix < FLOW.nx - 1) {
      const m = n + 1;
      if (walk[m] === 1 && dist[m] < 0) { dist[m] = d + 1; next[m] = n; queue[qt] = m; qt = qt + 1; }
    }
    if (niz > 0) {
      const m = n - FLOW.nx;
      if (walk[m] === 1 && dist[m] < 0) { dist[m] = d + 1; next[m] = n; queue[qt] = m; qt = qt + 1; }
    }
    if (niz < FLOW.nz - 1) {
      const m = n + FLOW.nx;
      if (walk[m] === 1 && dist[m] < 0) { dist[m] = d + 1; next[m] = n; queue[qt] = m; qt = qt + 1; }
    }
    // Portals — undirected, so the field routes down stairs as well as up.
    // Approximate the flight's length as a fixed few cells; exactness does
    // not matter for a flow field, only reachability and rough preference.
    for (let p = 0; p < FLOW.portalCount; p++) {
      let m = -1;
      if (FLOW.pA[p] === n) m = FLOW.pB[p];
      else if (FLOW.pB[p] === n) m = FLOW.pA[p];
      if (m < 0 || dist[m] >= 0) continue;
      dist[m] = d + 8;
      next[m] = n;
      via[m] = FLOW.pF[p];
      queue[qt] = m; qt = qt + 1;
    }
  }
  FLOW.active = 1;
}

/// Is (x,y,z) inside flight `f`'s climb corridor — the wedge's XZ footprint at
/// any height ABOVE its base floor? Looser than nav.ts's onFlight on purpose:
/// onFlight demands the height match the tread under you within 0.7 m, and a
/// climber shoved sideways (or sampled between risers) flickers it false for
/// a frame — at which point the WALKING phase resumed, the ground-level field
/// took over, and it marched the climber straight back down. STAIRTEST caught
/// the resulting yo-yo (up to 1.75 m, then back to 0.20). Being anywhere over
/// the wedge above its base floor can only mean one thing: you are climbing.
/// (Standing UNDER the landing at ground level fails the `y > fLoY + 0.15`
/// arm, so nav.ts's under-the-stairs deadlock stays fixed.)
function flightCorridor(f: number, x: number, y: number, z: number): boolean {
  if (y <= NAV.fLoY[f] + 0.15) return false;
  if (y >= NAV.fHiY[f] + 1.0) return false;
  const ax = NAV.fAX[f], az = NAV.fAZ[f];
  const sx = NAV.fBX[f] - ax, sz = NAV.fBZ[f] - az;
  const L2 = sx * sx + sz * sz;
  if (L2 < 0.0001) return false;
  let t = ((x - ax) * sx + (z - az) * sz) / L2;
  if (t < -0.15 || t > 1.45) return false;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const px = ax + sx * t, pz = az + sz * t;
  const dx = x - px, dz = z - pz;
  const w = NAV.fHalfW[f] + 0.6;
  return (dx * dx + dz * dz) <= w * w;
}

/// Y-aware wall test at a point — the graph's walkability rule, exposed for
/// the director: a field-follower has its wall circles stood down (they fence
/// the mount and fight the field on the apron), so THIS is its wall collision.
export function flowBlockedAt(x: number, z: number, y: number): boolean {
  if (NAV.hasBldg !== 1) return false;
  return flowWallBlocked(x, z, y, 0.0);
}

/// The full cross-floor routing goal, superseding nav.ts's navGoal for the
/// walking phase. Writes [x, z, active, viaFlight, onTreads, fieldFollow]:
///   active      1 = steer to (x,z) and do not run the combat state machine
///   viaFlight   >= 0 when the immediate business is boarding that flight
///   onTreads    1 = currently climbing (skip separation shoves too)
///   fieldFollow 1 = the flow graph owns this walker's route: wall CIRCLES
///                 stand down and flowBlockedAt() is its wall collision
export function routeGoal(ex: number, ey: number, ez: number, targetY: number,
                          out: number[]): void {
  out[2] = 0; out[3] = -1; out[4] = 0; out[5] = 0;
  const f = navFlightFor(ex, ey, ez, targetY);
  // On the treads (or anywhere over the wedge above its base floor) -> walk
  // to the far end. The corridor arm is the anti-yo-yo hysteresis.
  //
  // The base-level guard is walker 0's minute-long dither, distilled:
  // onFlight's +-0.7 m height tolerance also matches a walker standing at
  // GROUND level beside tread 2 (expY there is 0.83). The climb arm then
  // pointed it west along the wedge flank it could never mount, the field
  // pointed it east toward the real mount, and it seesawed on the spot with
  // z frozen against the wedge's south face. Standing at base level counts
  // as climbing ONLY within a stride of the boarding end itself.
  if (f >= 0 && (onFlight(f, ex, ey, ez) || flightCorridor(f, ex, ey, ez))) {
    const up = targetY > ey;
    const aboveBase = ey > NAV.fLoY[f] + 0.15;
    const bdx = ex - (up ? NAV.fAX[f] : NAV.fLandX[f]);
    const bdz = ez - (up ? NAV.fAZ[f] : NAV.fLandZ[f]);
    const nearBoard = (bdx * bdx + bdz * bdz) <= 0.85 * 0.85;
    if (!aboveBase && !nearBoard) {
      // Beside the wedge at its base — not climbing. Fall through to the
      // field, which routes AROUND to the mount.
    } else {
    out[0] = up ? NAV.fLandX[f] : NAV.fAX[f];
    out[1] = up ? NAV.fLandZ[f] : NAV.fAZ[f];
    out[2] = 1; out[3] = f; out[4] = 1; out[5] = 1;
    return;
    }
  }
  // Walking phase — follow the flow field when it covers us.
  if (FLOW.ready === 1 && FLOW.active === 1) {
    const l = levelOf(ey);
    if (l >= 0) {
      const ix = Math.floor((ex - FLOW.x0) / FLOW_CELL);
      const iz = Math.floor((ez - FLOW.z0) / FLOW_CELL);
      if (ix >= 0 && ix < FLOW.nx && iz >= 0 && iz < FLOW.nz) {
        let n = nodeOf(l, ix, iz);
        if (FLOW.walk[n] !== 1) n = nearestWalkable(l, ix, iz, 2);
        if (n >= 0 && FLOW.nextNode[n] >= 0) {
          // About to cross a portal: the goal is the boarding end itself —
          // stepping onto the bottom tread flips onFlight and the climb
          // branch above takes over.
          const vf = FLOW.flightVia[n];
          if (vf >= 0) {
            const nearLo = Math.abs(ey - NAV.fLoY[vf]) <= Math.abs(ey - NAV.fHiY[vf]);
            out[0] = nearLo ? NAV.fAX[vf] : NAV.fLandX[vf];
            out[1] = nearLo ? NAV.fAZ[vf] : NAV.fLandZ[vf];
            out[2] = 1; out[3] = vf; out[5] = 1;
            return;
          }
          // Same-level hop: look one cell further for smoother motion, but
          // never through a portal.
          let t = FLOW.nextNode[n];
          const t2 = FLOW.nextNode[t];
          if (t2 >= 0 && FLOW.flightVia[t] < 0) t = t2;
          const layer = FLOW.nx * FLOW.nz;
          const tl = Math.floor(t / layer);
          const trem = t - tl * layer;
          const tiz = Math.floor(trem / FLOW.nx);
          const tix = trem - tiz * FLOW.nx;
          out[0] = FLOW.x0 + (tix + 0.5) * FLOW_CELL;
          out[1] = FLOW.z0 + (tiz + 0.5) * FLOW_CELL;
          out[2] = 1; out[5] = 1;
          return;
        }
      }
    }
  }
  // No field coverage (outside the grid, or the seed failed) — fall back to
  // nav.ts's boarding waypoint; the wall circles funnel through doors as they
  // always have.
  if (f >= 0) {
    const up = targetY > ey;
    out[0] = up ? NAV.fAX[f] : NAV.fLandX[f];
    out[1] = up ? NAV.fAZ[f] : NAV.fLandZ[f];
    out[2] = 1; out[3] = f;
  }
}
