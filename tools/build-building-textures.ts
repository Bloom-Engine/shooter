// SH-050 — the building's material textures.
//
//   bun tools/fetch-external-textures.ts    # once — get the sources
//   bun tools/build-building-textures.ts
//
// What this replaces: NOTHING. The building had no textures at all. Its walls
// were two octaves of value noise over a flat sandstone colour, plus a
// procedural mortar line every 3 m — which is why the house read as "a beige
// box with stripes" next to a forest of real scanned bark and leaves. The
// noise gave it *variation*, which is not the same as *material*: at any range
// where the noise resolved, there was nothing underneath it to see.
//
// TWO SLICES, and the split is the point. The shader picks by face direction —
// it already computes which world plane a face points at, for the noise
// projection — so:
//
//   slice 0  WALL   concrete_wall_008 — board-formed concrete.
//   slice 1  SLAB   concrete_floor_02 — the floors and the roof terrace.
//
// WHY CONCRETE AND NOT THE PLASTER IT FIRST SHIPPED WITH: the house is 24 x 8 m
// and the material tiles at the source's real size, so a wall is ~10 x 4 tiles.
// `plaster_stone_wall_01` has sparse, distinctive stones; repeated 40 times they
// read as a stamped GRID — a worse artifact than the flat colour this replaced,
// and clearly visible in a face-on capture. Board-formed concrete is uniform at
// range (which is what real concrete looks like at 20 m) and carries its detail
// in formwork seams and tie-rod holes, whose ~2 m repeat is what an actual
// formed wall does. The tiling is the constraint; pick sources that survive it.
//
// Before, floors and walls were the same beige noise, so the roof terrace read
// as a wall lying down. They are different materials in life and now on screen.
//
// The building has the MR array slot free (terrain does not — its splat map
// lives there), so roughness is real here: the specular break-up across damp
// and dry plaster is most of what separates "a texture" from "a surface".
//
// LAYER ORDER IS THE ABI — building.wgsl indexes these by number. Do not
// reorder without changing SLICE_WALL / SLICE_SLAB there.

import { encodePng, makeTexture } from './png';
import { loadRgbaExact } from './imgutil';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const SIZE = 1024;
const EXT = 'assets/textures/external';

interface Slice {
  name: string;    // output stem
  src: string;     // external asset id (== folder and filename stem)
  sizeM: number;   // real-world extent, metres — building.wgsl scales by it
  what: string;
}
const SLICES: Slice[] = [
  { name: 'building_wall', src: 'concrete_wall_008', sizeM: 2.0, what: 'walls' },
  { name: 'building_slab', src: 'concrete_floor_02', sizeM: 2.0, what: 'floors + roof terrace' },
];

function srcMap(id: string, map: string): string | null {
  const p = `${EXT}/${id}/${id}_${map}_2k.jpg`;
  return existsSync(p) ? p : null;
}

// Fallbacks, for a checkout without assets/textures/external/. Flat mid-tones
// rather than a procedural imitation: if the scans are missing, the honest
// result is the untextured look the material had before, not a worse guess at
// stone. The build still produces a complete array so the game runs.
const FLAT_WALL: [number, number, number, number] = [184, 168, 140, 255];
const FLAT_SLAB: [number, number, number, number] = [150, 148, 143, 255];
const FLAT_NORMAL: [number, number, number, number] = [127, 127, 255, 255];
const FLAT_ROUGH: [number, number, number, number] = [200, 200, 200, 255];

mkdirSync('assets/textures', { recursive: true });

let anyMissing = false;
for (let i = 0; i < SLICES.length; i++) {
  const s = SLICES[i];
  const flat = i === 0 ? FLAT_WALL : FLAT_SLAB;

  const diff  = srcMap(s.src, 'diff');
  const nor   = srcMap(s.src, 'nor_gl');
  const rough = srcMap(s.src, 'rough');
  if (!diff) anyMissing = true;

  const albedo = diff
    ? loadRgbaExact(diff, SIZE).rgba
    : makeTexture(SIZE, SIZE, () => flat);
  writeFileSync(`assets/textures/${s.name}_albedo.png`, encodePng(SIZE, SIZE, albedo));

  // Poly Haven's _nor_gl is OpenGL-convention tangent space (+Y up in green) —
  // already the engine's decode convention, so no channel flip.
  const normal = nor
    ? loadRgbaExact(nor, SIZE).rgba
    : makeTexture(SIZE, SIZE, () => FLAT_NORMAL);
  writeFileSync(`assets/textures/${s.name}_normal.png`, encodePng(SIZE, SIZE, normal));

  // Roughness is greyscale in the source. Stored to all three channels and read
  // as `.g` in the shader, matching the glTF ORM convention (G = roughness) so
  // the slot means the same thing it means everywhere else in the engine.
  const rgh = rough
    ? loadRgbaExact(rough, SIZE).rgba
    : makeTexture(SIZE, SIZE, () => FLAT_ROUGH);
  writeFileSync(`assets/textures/${s.name}_rough.png`, encodePng(SIZE, SIZE, rgh));

  const how = diff ? `scan ${s.src} (${s.sizeM} m)` : 'FLAT fallback (no external set)';
  console.log(`wrote ${s.name}_albedo/_normal/_rough.png ${SIZE}² — ${s.what}, ${how}`);
}

if (anyMissing) {
  console.log('\nSome sources were missing — wrote flat stand-ins so the array is complete.');
  console.log('Run: bun tools/fetch-external-textures.ts');
}
