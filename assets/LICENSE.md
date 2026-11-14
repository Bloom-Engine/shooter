# Asset licensing

The repository is MIT licensed (`../LICENSE`). That covers the code and the assets made for this game.
Third-party material listed below keeps the terms of its source, and the legacy Unvanquished-derived
files at the end remain GPLv3: the MIT licence does not apply to them.

## Shipped assets (what release builds contain)

- **Characters, weapons, furniture props** (`models/enemy_{skitter,stalker,ravager,spitter,bruiser,bombard,colossus}.glb`,
  `player_trooper.glb`, `weapon_*.glb`, `prop_{barrel,crate,table,chair,bed}.glb`): original designs made for
  this game in November 2026. Concept images in `art/style/photoreal/`, meshes generated with Tripo Studio,
  processed in Blender. Provenance: `art/source/README.md`.
- **Creature, player and impact sounds**: generated with ElevenLabs sound effects (`tools/gen/sfx.py`).
  Other sounds: synthesised by `tools/gen-sfx.ts`, or from the Sonniss GDC 2024 bundle. See `sounds/SOURCES.md`.
- **Music**: generated with Suno, mastered by `tools/music-master.ts` (`music/SUNO-PROMPTS.md`).
- **Terrain, building and tree textures**: CC0 scans (Poly Haven, ambientCG), see `textures/external/SOURCES.md`.
- **Sky**: `env/outdoor.hdr`, from the Bloom engine's Bistro example assets.

## Legacy files still in the repository, NOT shipped

`models/enemy_{dretch,mantis,marauder,adv_marauder,dragoon,tyrant}.glb` and `models/player_bsuit.glb`
were converted from [Unvanquished](https://github.com/Unvanquished/Unvanquished) (GPLv3; asset
repositories at https://github.com/UnvanquishedAssets). The game no longer loads them and
`tools/release/release.py` leaves them out of every bundle. Any redistribution of those files must
comply with the GPLv3. `sounds/menu.ogg`, `sounds/game.ogg` and `sounds/ambient.ogg` are old files of
unrecorded origin, also left out of bundles.
