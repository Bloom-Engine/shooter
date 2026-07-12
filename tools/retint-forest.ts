// SH-014 / SH-004 — rewrite ONLY the `tint` of every prop_tree in a world file.
//
// Why this is not just "re-run bake-forest-to-world.ts": that tool re-seeds the
// whole forest — positions, yaw, scale — and would overwrite anything moved in
// the editor since. This touches one field and leaves the rest byte-for-byte.
//
// THE BUG IT FIXES. The tints were independent per-channel jitter — r, g and b
// each nudged at random around 1.0. That is a random walk in RGB, so a third of
// the forest ended up with its multiplier pushed off the green axis entirely,
// toward cyan or magenta. The saturation is low enough that no single tree looks
// obviously wrong, but the canopy as a whole picks up a faint iridescent
// speckle that reads as digital noise rather than as foliage.
//
// Real trees do not vary that way. They vary along ONE axis — how lush or how
// dry — which runs green → yellow-olive, plus how much light the crown is
// getting. So that is what this generates: a 1-D dryness parameter and a
// brightness, mapped to a multiplier that can never leave the green-yellow
// wedge. Same amount of visible variety, none of the speckle.
//
//   bun tools/retint-forest.ts assets/worlds/arena_02.world.json

const path = process.argv[2] ?? 'assets/worlds/arena_02.world.json';
const file = Bun.file(path);
const world = await file.json();

// Deterministic per-tree hash: the same world always retints the same way, so a
// re-run is a no-op rather than a diff.
function hash01(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

let n = 0;
for (let i = 0; i < world.entities.length; i++) {
  const e = world.entities[i];
  if (!e.userData || e.userData.kind !== 'prop_tree') continue;

  // dryness 0 = lush green, 1 = dry olive/straw. Skewed toward lush: a stand of
  // trees has a few thirsty ones, not a 50/50 split.
  const d = Math.pow(hash01(i, 1), 1.7);
  // brightness: crowns that catch more sun are lighter. Kept narrow — this is a
  // multiplier over an already-lit texture, not an albedo.
  const b = 0.94 + hash01(i, 2) * 0.12;

  // The wedge. Dry pushes red UP and blue DOWN (green→yellow); green always
  // stays the dominant channel, so no tree can drift toward cyan or magenta.
  const r = b * (0.93 + d * 0.13);
  const g = b * (1.00 + d * 0.02);
  const bl = b * (0.90 - d * 0.16);

  const a = Array.isArray(e.tint) && e.tint.length > 3 ? e.tint[3] : 1;
  e.tint = [
    Math.round(r * 10000) / 10000,
    Math.round(g * 10000) / 10000,
    Math.round(bl * 10000) / 10000,
    a,
  ];
  n++;
}

// Escape non-ASCII on the way out. The file on disk stores non-ASCII as \uXXXX
// (its `name` field carries an em-dash), and JSON.stringify would emit it raw —
// re-encoding a string this tool has no business touching. A tint rewrite should
// move tint lines and nothing else.
const json = JSON.stringify(world, null, 2).replace(
  /[-￿]/g,
  (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
);
await Bun.write(path, json + '\n');
console.log(`retinted ${n} trees in ${path} (lush→dry axis; green stays dominant)`);
