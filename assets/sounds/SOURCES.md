# Sound sources

All files converted to 16-bit mono 44.1 kHz WAV (the engine's `parse_wav`
decodes 8/16-bit PCM only). Mono because anything positional must not carry
baked-in panning that would fight `playSound3D`'s listener.

**Conversion is scripted (SH-044):**

```
bun tools/convert-audio.ts           # convert whatever is missing
bun tools/convert-audio.ts --force   # re-cut everything
bun tools/convert-audio.ts --list    # show what is missing and from where
```

The manifest inside that tool IS the mapping — the table below mirrors it for
reading. It used to say "regenerate by hand if sources change", which meant the
42-file set was unreproducible: the flags lived in someone's shell history.

## Unvanquished legacy assets (GPL-compatible, same line as our models)

From github.com/UnvanquishedAssets/res-legacy_src.dpkdir (FLAC sources):

| File(s) | Source path |
|---|---|
| `alien{0-4}_die{1-3}.wav` | `sound/player/level{0-4}/death{1-3}.flac` |
| `alien{0-4}_pain.wav` | `sound/player/level{0-4}/pain50_1.flac` |
| `alien0_attack.wav` | `models/weapons/level0/flash0.flac` |
| `alien1_attack.wav` | `sound/player/level1/grab.flac` |
| `alien{2-4}_attack.wav` | `models/weapons/level{2-4}/flash0.flac` |
| `impact_flesh.wav` | `models/weapons/level2/impactflesh0.flac` |
| `ricochet{1,2}.wav` | `models/weapons/rifle/ricochet{0,1}.flac` |
| `player_pain{1,2}.wav` | `sound/player/human_bsuit/pain{50,100}_1.flac` |
| `player_die{1,2}.wav` | `sound/player/human_bsuit/death{1,2}.flac` |

Kind mapping: 0=dretch(level0) 1=mantis(level1) 2=marauder(level2)
3=dragoon(level3) 4=tyrant(level4).

## Sonniss GDC 2024 Game Audio Bundle (royalty-free game-use license)

License: royalty-free incl. commercial use, no attribution; NOT
redistributable as a sound library — only these processed/renamed
game-ready files are committed, never pack folders.

| File | Source |
|---|---|
| `rifle_fire2.wav` | Dramatic Cat — SVD Dragunov, DESIGNED Single Shot Core Long |
| `blaster_fire.wav` | BluezoneCorp — Sci Fi Weapon, gun_shot_008 |
| `splash1.wav` | BluezoneCorp — Designed Water, impact_006 (first 1.2 s) |

## Pre-existing (provenance predates this file)

`rifle_fire.wav` (superseded by rifle_fire2 but kept), `dretch_attack.wav`,
`pickup.wav`, `menu.ogg`, `game.ogg`, `ambient.ogg`.

## Synthesised by `tools/gen-sfx.ts` (no external source — GPL-clean by construction)

Deterministic (seeded), so re-running the tool reproduces byte-identical
files. See docs/ASSET-TODO.md A1/A2/A3/A5/A6/A7/A8/A9 for the intended real
replacements.

`step_grass{1-4}.wav`, `step_dirt{1-4}.wav`, `step_heavy1.wav`,
`reload_start.wav`, `reload_end.wav`, `ui_move.wav`, `ui_select.wav`,
`{rifle,blaster,chain,cannon}_tail.wav`, `ambient_wind.wav` (16 s seamless
loop), and the SH-052 set: `river_loop.wav` (14 s seamless),
`skitter_light{1-4}.wav`, `skitter_heavy{1-4}.wav`, `crawl_loop.wav`
(3.5 s seamless).
