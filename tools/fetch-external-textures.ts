// SH-050 — fetch the CC0 photoscan sets the terrain + building materials use.
//
//   bun tools/fetch-external-textures.ts          # fetch anything missing
//   bun tools/fetch-external-textures.ts --force  # re-fetch everything
//
// Every set here is CC0 from Poly Haven, downloaded into the same
// folder-per-asset layout the repo already uses for pine_bark / leafset /
// forrest_ground_01, and recorded in assets/textures/external/SOURCES.md.
//
// WHY A TOOL AND NOT A README LINE: the layer textures are DERIVED from these
// (build-terrain-textures.ts resizes + repacks them), so the sources have to be
// reproducible on a fresh box. Both the sources and the derived PNGs are
// committed — a checkout builds and runs with no network — but when a layer
// needs re-deriving at a different size, this is how the input comes back.
//
// TWO TRAPS THIS TOOL EXISTS TO AVOID. Both cost a round trip here; do not
// re-learn them.
//
// 1. POLY HAVEN ASSET NAMES LIE ABOUT COLOUR. `brown_mud` and `brown_mud_02`
//    are both GREY. Picking the riverbank by name would have shipped grey mud
//    for a request that was specifically "natural brown". Download the diffuse
//    and LOOK at it.
//
// 2. JUDGE A TEXTURE AT THE TILING IT WILL ACTUALLY GET, NOT AT 2x2. The walls
//    were first given `plaster_stone_wall_01` — lovely warm plaster with stones
//    showing through, and fine at 2x2. The house is 24 x 8 m, which is 10 x 4
//    tiles, and there it read as a repeating GRID of identical stone clusters:
//    worse than the flat colour it replaced. A texture with SPARSE DISTINCTIVE
//    features announces its period the moment it repeats; the eye locks onto the
//    constellation. Uniform, high-frequency, or architecturally-repeating
//    textures survive tiling. That is why the wall is board-formed concrete —
//    its seams and tie-holes are *supposed* to repeat at ~2 m — and not plaster.
//    Simulate the real tile count before committing to a source.

import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs';

const FORCE = process.argv.indexOf('--force') >= 0;
const ROOT = 'assets/textures/external';

/// One Poly Haven texture set. `res` is the source resolution we keep in the
/// repo; the derived layers are smaller, so 2k is headroom, not waste.
interface Set {
  id: string;          // Poly Haven asset id == its filename stem
  res: string;         // '1k' | '2k' | '4k'
  maps: string[];      // Poly Haven map suffixes to fetch
  sizeM: number;       // real-world extent in metres (from the API's `dimensions`)
  use: string;         // what consumes it — mirrored into SOURCES.md
}

// Real-world sizes are the API's `dimensions` field, in metres. They are not
// decoration: terrain.wgsl scales each layer by its own physical size so a
// pebble is a pebble at 1:1 rather than whatever the shared UV scale implied.
// NB the terrain sets fetch NO roughness map, on purpose. terrain.wgsl computes
// roughness analytically (sod vs rock, wetter in the riverbed) because all three
// of its texture-array slots are already spoken for — albedo, normal, and the
// splat map in the MR slot (EN-014 caps it at three). There is nowhere to bind a
// terrain roughness texture, so fetching one would commit ~7 MB of JPEG that
// nothing can ever sample. The building sets DO fetch it: they have the MR slot
// free.
const SETS: Set[] = [
  {
    id: 'withered_grass', res: '2k', maps: ['diff', 'nor_gl'], sizeM: 2.0,
    use: 'terrain layer 1 (grass_dry) — pale straw, low contrast',
  },
  {
    id: 'brown_mud_dry', res: '2k', maps: ['diff', 'nor_gl'], sizeM: 1.3,
    use: 'terrain layer 2 (dirt) — the riverbank + scattered field patches',
  },
  {
    id: 'cliff_side', res: '2k', maps: ['diff', 'nor_gl'], sizeM: 1.83,
    use: 'terrain layer 3 (rock) — stratified cliff face, steep slopes only',
  },
  {
    id: 'concrete_wall_008', res: '2k', maps: ['diff', 'nor_gl', 'rough'], sizeM: 2.0,
    use: 'building walls — board-formed concrete (panel seams + tie-rod holes)',
  },
  {
    id: 'concrete_floor_02', res: '2k', maps: ['diff', 'nor_gl', 'rough'], sizeM: 2.0,
    use: 'building floors + roof terrace',
  },
  // forrest_ground_01 (terrain layer 0) is already committed — SOURCES.md has
  // recorded it as "downloaded for the upcoming terrain splat pass, not
  // consumed yet" since it landed. This pass is what finally consumes it.
];

/// Poly Haven's CDN path is derivable from (id, map, res) — no API round-trip
/// per file. Verified against the /files/<id> response, which returns exactly
/// these URLs.
function url(id: string, map: string, res: string): string {
  return `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/${res}/${id}/${id}_${map}_${res}.jpg`;
}

async function fetchOne(s: Set, map: string): Promise<boolean> {
  const dir = `${ROOT}/${s.id}`;
  const dst = `${dir}/${s.id}_${map}_${s.res}.jpg`;
  if (!FORCE && existsSync(dst) && statSync(dst).size > 0) {
    console.log(`  skip  ${dst} (exists)`);
    return true;
  }
  const u = url(s.id, map, s.res);
  const r = await fetch(u);
  if (!r.ok) {
    console.error(`  FAIL  ${u} -> HTTP ${r.status}`);
    return false;
  }
  const buf = new Uint8Array(await r.arrayBuffer());
  // A CDN error page is a 200 with HTML in it. A JPEG starts FF D8 FF; check
  // rather than write a 4 KB "not found" page named like a texture and let
  // build-terrain-textures fail later with something unrelated.
  if (buf.length < 1024 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    console.error(`  FAIL  ${u} -> not a JPEG (${buf.length} bytes)`);
    return false;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(dst, buf);
  console.log(`  got   ${dst} (${(buf.length / 1024).toFixed(0)} KB)`);
  return true;
}

let ok = true;
for (const s of SETS) {
  console.log(`${s.id} @ ${s.res} — ${s.use}`);
  for (const m of s.maps) {
    const got = await fetchOne(s, m);
    if (!got) ok = false;
  }
}

if (!ok) {
  console.error('\nSome downloads failed. The derived layers already committed in');
  console.error('assets/textures/ are unaffected — this only blocks RE-deriving them.');
  process.exit(1);
}
console.log('\nAll sets present. Next: bun tools/build-terrain-textures.ts');
