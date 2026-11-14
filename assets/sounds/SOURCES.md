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

## Generated with ElevenLabs sound effects (`tools/gen/sfx.py`, 2026-11-13)

These replaced every file that used to be converted from Unvanquished (GPLv3), and three older
files whose origin was never recorded. Prompts are in the tool; file names are unchanged.

| File(s) | What |
|---|---|
| `alien{0-4}_attack.wav`, `alien{0-4}_pain.wav`, `alien{0-4}_die{1-3}.wav` | creature voices: 0 Skitter, 1 Stalker, 2 Ravager (also Spitter), 3 Bruiser (also Bombard), 4 Colossus |
| `dretch_attack.wav` | bite |
| `impact_flesh.wav`, `ricochet{1,2}.wav` | bullet impacts |
| `player_pain{1,2}.wav`, `player_die{1,2}.wav` | the Trooper, muffled by the helmet |
| `pickup.wav`, `rifle_fire.wav` | weapon pickup; legacy rifle shot (superseded by rifle_fire2) |
| `step_grass{1-4}.wav`, `step_dirt{1-4}.wav`, `step_heavy1.wav` | footsteps (second pass: these and the rows below replaced the synthesised placeholders) |
| `skitter_light{1-4}.wav`, `skitter_heavy{1-4}.wav`, `crawl_loop.wav` | creature locomotion |
| `reload_start.wav`, `reload_end.wav`, `ui_move.wav`, `ui_select.wav` | reload and interface |
| `ui_back.wav`, `ui_tab.wav`, `ui_tick.wav`, `ui_toggle.wav`, `ui_error.wav`, `ui_start.wav` | interface (2026-11-14, Phase 4): synthesised by `tools/gen/ui_sfx.py`, no outside source |
| `rifle_tail.wav`, `blaster_tail.wav`, `chain_tail.wav`, `cannon_tail.wav` | weapon echo tails |
| `ambient_wind.wav` | wind bed (seamless loop) |
| `chain_fire.wav`, `cannon_fire.wav`, `explosion.wav` | one shot per weapon and the cannon's blast (2026-11-14; before that the chaingun and cannon fired the rifle sample) |
| `step_concrete{1-4}.wav` | footsteps inside the house (2026-11-14) |

`tools/convert-audio.ts` no longer lists the Unvanquished sources for these names (removed
2026-11-14); it only cuts the Sonniss river loop now.

## Sonniss GDC 2024 Game Audio Bundle (royalty-free game-use license)

License: royalty-free incl. commercial use, no attribution; NOT
redistributable as a sound library — only these processed/renamed
game-ready files are committed, never pack folders.

| File | Source |
|---|---|
| `rifle_fire2.wav` | Dramatic Cat — SVD Dragunov, DESIGNED Single Shot Core Long |
| `blaster_fire.wav` | BluezoneCorp — Sci Fi Weapon, gun_shot_008 |
| `splash1.wav` | BluezoneCorp — Designed Water, impact_006 (first 1.2 s) |
| `river_loop.wav` | Bolt — Immersive Creek (Vermont), Babbling Brook XY pair; 32 s seamless loop cut at 49 s by `tools/convert-audio.ts` (SH-052b — window chosen by RMS/brightness variance scan, equal-power tail-over-head loop fade) |

Fourth pass, 2026-11-14 (plan Phase 2): `swing.wav`, `crit_hit.wav`, `melee_hit.wav`,
`grenade_throw.wav`, `grenade_bounce.wav`, `heal.wav`, same tool, prompts in it.

## Synthesised by `tools/gen-sfx.ts` — superseded

Every file that tool wrote now comes from `tools/gen/sfx.py` (table above). Do not re-run
`tools/gen-sfx.ts`: it would overwrite them with the synthesised placeholders.
