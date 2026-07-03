// Procedural multi-floor building generator. Emits world-JSON
// entries to stdout; pipe into a clipboard / merge tool, paste
// into arena_02.world.json in place of the old h1/h2 block, then
// re-run `npm run world`.
//
// Design: a 3-storey house with a central stairwell. Each floor
// is a slab with a 2×3 m hole cut for the stairwell; walls form a
// rectangular shell with a south-facing door on the ground floor.
// The stairwell uses 10 steps per floor (rise 0.3 m, run 0.3 m,
// total 3 m up). Stairs alternate direction at each landing so
// the ascent fits in a 4×3 m footprint.

interface Entity {
  id: string;
  position: [number, number, number];
  halfExtents: [number, number, number];
  rotation?: [number, number, number];
}

const out: Entity[] = [];

// House centre + half-extents.
const CX = -21, CZ = -13;
const HX = 9, HZ = 6;            // half footprint (so 18×12 m)
const FLOOR_H = 3.0;              // each floor is 3 m tall
const NUM_FLOORS = 3;             // ground + 1 + 2 = 3 storeys

// Interior stairwell hole (in the slab) — placed in the SE quadrant.
const STAIR_HX = 1.0, STAIR_HZ = 1.5;   // hole is 2×3 m
const STAIR_CX = -15, STAIR_CZ = -10;   // centre of stairwell

// Slab thickness.
const SLAB_T = 0.10;

// Stairs: 10 steps per floor, rise = FLOOR_H/10 = 0.3 m, run = 0.3 m.
const STEPS_PER_FLOOR = 10;
const RISE = FLOOR_H / STEPS_PER_FLOOR;
const RUN  = 0.30;

// ---- Helpers ----
function box(id: string, pos: [number, number, number], hx: number, hy: number, hz: number) {
  out.push({ id, position: pos, halfExtents: [hx, hy, hz] });
}

// Build a slab as 4 rectangles around a central hole. Saves making
// a single mesh with a cutout.
function slabWithHole(
  id: string, y: number,
  cx: number, cz: number, hx: number, hz: number,
  holeCx: number, holeCz: number, holeHx: number, holeHz: number,
) {
  const t = SLAB_T;
  // North strip (high z)
  const nzCenter = (holeCz + holeHz + (cz + hz)) / 2;
  const nzHalf   = ((cz + hz) - (holeCz + holeHz)) / 2;
  if (nzHalf > 0) box(`${id}_n`, [cx, y, nzCenter], hx, t, nzHalf);
  // South strip (low z)
  const szCenter = ((cz - hz) + (holeCz - holeHz)) / 2;
  const szHalf   = ((holeCz - holeHz) - (cz - hz)) / 2;
  if (szHalf > 0) box(`${id}_s`, [cx, y, szCenter], hx, t, szHalf);
  // West strip (low x), only over the hole's z range
  const wxCenter = ((cx - hx) + (holeCx - holeHx)) / 2;
  const wxHalf   = ((holeCx - holeHx) - (cx - hx)) / 2;
  if (wxHalf > 0) box(`${id}_w`, [wxCenter, y, holeCz], wxHalf, t, holeHz);
  // East strip (high x)
  const exCenter = ((cx + hx) + (holeCx + holeHx)) / 2;
  const exHalf   = ((cx + hx) - (holeCx + holeHx)) / 2;
  if (exHalf > 0) box(`${id}_e`, [exCenter, y, holeCz], exHalf, t, holeHz);
}

// ---- Walls per floor ----
// Outer shell: every floor has 4 walls. Ground floor's south wall
// has a door opening (skip a section in the middle).
const DOOR_HX = 1.0;        // door is 2 m wide
const DOOR_H  = 2.4;        // door is 2.4 m tall

for (let f = 0; f < NUM_FLOORS; f++) {
  const y0 = f * FLOOR_H;
  const wallY = y0 + FLOOR_H * 0.5;
  const wallHy = FLOOR_H * 0.5;

  // North wall (high -z). Solid.
  box(`h_f${f}_wall_n`, [CX, wallY, CZ - HZ], HX, wallHy, 0.2);
  // East wall (high x). Solid.
  box(`h_f${f}_wall_e`, [CX + HX, wallY, CZ], 0.2, wallHy, HZ);
  // West wall (low x). Solid.
  box(`h_f${f}_wall_w`, [CX - HX, wallY, CZ], 0.2, wallHy, HZ);
  // South wall (low z). Ground floor has door cut; other floors solid.
  if (f === 0) {
    const sLeftHx  = (HX - DOOR_HX) * 0.5;
    const sLeftCx  = CX - DOOR_HX - sLeftHx;
    const sRightHx = sLeftHx;
    const sRightCx = CX + DOOR_HX + sRightHx;
    box(`h_f0_wall_s_left`,  [sLeftCx,  wallY, CZ + HZ], sLeftHx,  wallHy, 0.2);
    box(`h_f0_wall_s_right`, [sRightCx, wallY, CZ + HZ], sRightHx, wallHy, 0.2);
    // Top of door
    const lintelHy = (FLOOR_H - DOOR_H) * 0.5;
    const lintelY  = DOOR_H + lintelHy;
    box(`h_f0_wall_s_top`,   [CX, lintelY, CZ + HZ], DOOR_HX, lintelHy, 0.2);
  } else {
    box(`h_f${f}_wall_s`, [CX, wallY, CZ + HZ], HX, wallHy, 0.2);
  }
}

// ---- Floor slabs (with stairwell hole) ----
// Floor between f-1 and f sits at y = f * FLOOR_H. The ground slab
// (y=0) is provided by the world's existing collider_box floor, so
// we only emit floors at y = FLOOR_H, 2*FLOOR_H. The roof is at
// y = NUM_FLOORS * FLOOR_H.
for (let f = 1; f < NUM_FLOORS; f++) {
  const y = f * FLOOR_H;
  slabWithHole(`h_slab_f${f}`, y - SLAB_T, CX, CZ, HX, HZ, STAIR_CX, STAIR_CZ, STAIR_HX, STAIR_HZ);
}
// Solid roof slab.
const roofY = NUM_FLOORS * FLOOR_H;
box(`h_roof`, [CX, roofY, CZ], HX, SLAB_T, HZ);

// ---- Interior stairs ----
// Switchback: each floor's stairs run east-west, alternating
// direction. Steps are 0.3 × 0.3, full-width (3 m hole = stair
// width 1.0 m wide for player + railing). For simplicity we use
// per-step boxes that grow taller cumulatively to act as both the
// step and the riser.
for (let f = 0; f < NUM_FLOORS - 1; f++) {
  const baseY = f * FLOOR_H;
  // Direction: even floors go from west→east up; odd floors east→west.
  const goEast = (f % 2) === 0;
  for (let s = 0; s < STEPS_PER_FLOOR; s++) {
    const stepHy = (s + 1) * RISE * 0.5;   // half-height
    const stepCy = baseY + stepHy;
    const offset = (s + 0.5) * RUN - STAIR_HX;
    const stepCx = goEast ? STAIR_CX + offset : STAIR_CX - offset;
    box(`h_step_f${f}_${s}`, [stepCx, stepCy, STAIR_CZ], RUN * 0.5, stepHy, STAIR_HZ);
  }
}

// ---- Emit JSON & merge into world file ----
//
// Behaviour: read assets/worlds/arena_02.world.json, drop every
// entity whose id starts with "h_" (the procedural-building
// namespace), append the freshly-generated ones, write back.
// Re-running this script is the canonical way to retune building
// dimensions — no more manual copy-paste from stdout.
//
// Pass a --print flag to fall back to stdout-only mode (useful
// when staging a different building variant before merging).

import * as fs from 'fs';
import * as path from 'path';

const WORLD_PATH = path.resolve(
  path.dirname(import.meta.url.replace('file://', '')),
  '../assets/worlds/arena_02.world.json'
);

function buildEntityJson(): string[] {
  return out.map(e => {
    const rot = e.rotation ?? [0, 0, 0];
    const he  = e.halfExtents.map(v => v.toFixed(3)).join(', ');
    return `    { "id": "${e.id}", "name": "${e.id}",
      "modelRef": "assets/models/_gizmo_box.glb", "prefabRef": null,
      "transform": { "position": [${e.position.map(v => v.toFixed(3)).join(', ')}], "rotation": [${rot.join(', ')}], "scale": [1, 1, 1] },
      "tint": null, "tags": ["building"],
      "userData": { "kind": "static_mesh", "collider": "box", "halfExtents": "${he}" } }`;
  });
}

const printOnly = process.argv.includes('--print');
const entityLines = buildEntityJson();

if (printOnly) {
  console.log(entityLines.join(',\n'));
  console.log(`\n// Total entities: ${out.length}`);
} else {
  // Read the world file as a parsed object (validates the JSON)
  // then re-walk the raw text so we can preserve the comment-free
  // formatting + entity ordering of neighbouring sections.
  const raw = fs.readFileSync(WORLD_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const before = parsed.entities?.length ?? 0;

  // Strip out every existing "h_*" entity. Use a regex that
  // matches the entire entity object across multiple lines,
  // anchored by the id field.
  let cleaned = raw;
  const idRe = /^\s*\{\s*"id":\s*"h_[A-Za-z0-9_]+",[\s\S]*?\}\s*\},?\n/gm;
  cleaned = cleaned.replace(idRe, '');

  // Find the trailing entity in the entities array so we can
  // append our new entries before the closing bracket. We pick
  // the last "} }," / "} }" line inside the entities block.
  const insertMarker = '  ],';  // line that ends the "entities" array
  const insertIdx = cleaned.indexOf(insertMarker);
  if (insertIdx < 0) {
    throw new Error(`could not find entities-array close marker '${insertMarker}' in ${WORLD_PATH}`);
  }

  // The text just before insertMarker should end with "} }\n"
  // (last entity, no trailing comma). Add a comma to it, then
  // splice in our new entities.
  const headEnd = cleaned.lastIndexOf('} }', insertIdx);
  if (headEnd < 0) {
    throw new Error('could not find last entity terminator before entities-array close');
  }
  const head = cleaned.slice(0, headEnd + 3) + ',\n';
  const tail = cleaned.slice(insertIdx);
  const newBody = entityLines.join(',\n') + '\n';
  const final = head + newBody + tail;

  // Validate the result parses cleanly.
  JSON.parse(final);
  fs.writeFileSync(WORLD_PATH, final);
  const reparsed = JSON.parse(final);
  console.log(`Wrote ${WORLD_PATH}`);
  console.log(`  removed ${before - (reparsed.entities.length - out.length)} previous h_* entities`);
  console.log(`  added   ${out.length} new (count=${reparsed.entities.length})`);
  console.log(`  re-run \`npm run world\` to regenerate src/generated/world.ts`);
}
