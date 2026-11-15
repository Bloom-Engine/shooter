# Asset licensing

The repository is MIT licensed (`../LICENSE`). That covers the code and the assets made for this game.
Third-party material listed below keeps the terms of its source.

## Shipped assets (what release builds contain)

- **Characters, weapons, furniture props** (`models/enemy_{skitter,stalker,ravager,spitter,bruiser,bombard,colossus,matriarch}.glb`,
  `player_trooper.glb`, `weapon_*.glb`, `prop_{barrel,crate,table,chair,bed}.glb`): original designs made for
  this game in November 2026. Concept images in `art/style/photoreal/`, meshes generated with Tripo Studio,
  processed in Blender. Provenance: `art/source/README.md`.
- **Creature, player and impact sounds**: generated with ElevenLabs sound effects (`tools/gen/sfx.py`).
  Other sounds: synthesised by `tools/gen-sfx.ts`, or from the Sonniss GDC 2024 bundle. See `sounds/SOURCES.md`.
- **Music**: generated with Suno, mastered by `tools/music-master.ts` (`music/SUNO-PROMPTS.md`).
- **Terrain, building and tree textures**: CC0 scans (Poly Haven, ambientCG), see `textures/external/SOURCES.md`.
- **Trees, grass clumps, tall grass and the flowering herb**: converted from Poly Haven models
  (CC0): `tree_small_02`, `island_tree_02`, `grass_medium_01`, `shrub_03`. The sources are not in
  the repository; `tools/gen/build_trees.sh` downloads and converts them.
- **Sky**: `env/outdoor.hdr`, from the Bloom engine's Bistro example assets.

Which provider terms the generated assets depend on, and what has to be confirmed before the game
is sold: `TERMS.md`.

## Removed on 2026-11-14

The models converted from [Unvanquished](https://github.com/Unvanquished/Unvanquished) (GPLv3:
`enemy_{dretch,mantis,marauder,adv_marauder,dragoon,tyrant}.glb`, `player_bsuit.glb`), their
converters (`tools/convert-aliens*.ts`, `tools/convert-weapons.ts`) and three old music files of
unrecorded origin (`sounds/menu.ogg`, `game.ogg`, `ambient.ogg`) were deleted from the tree when the
repository became MIT. They are still in the git history, where the GPLv3 continues to apply to them.
