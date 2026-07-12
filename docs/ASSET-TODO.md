# Asset TODO — things only you can do

Running tab of work that is **not** a software problem: assets I could
not source or generate myself, and decisions that need a human. Kept
in priority order. Everything else in `docs/tickets.md` is being done
in code.

Status: 🔵 not started · 🟡 partial (placeholder in place) · ✅ done

---

## Legend of what "placeholder in place" means

Where an asset was missing I shipped a **procedurally generated stand-in**
so the *system* is complete and testable, and swapping in a real asset is
a file drop with no code change. Those are the 🟡 rows — the game works
today, it just sounds/looks better once you replace them.

---

## Audio

| # | Item | Status | Notes |
|---|---|---|---|
| A1 | Footstep SFX — grass ×4, dirt ×4, stone ×4 | 🔵 | Sonniss GDC bundle (already a documented source in `assets/sounds/SOURCES.md`) has these. Drop as `assets/sounds/step_grass1..4.wav` etc. Code (SH-003) already looks for exactly these names and falls back silently. |
| A2 | Weapon tail layers — rifle, blaster, chaingun, cannon | 🔵 | The "crack-BOOM" body+tail split (SH-035). Name them `<weapon>_tail.wav`; the mixer routes them to the reverb send automatically. |
| A3 | Wind / leaf-rustle ambience loop (10–20 s, CC0) | 🔵 | freesound.org / Sonniss. `assets/sounds/ambient_wind.wav`. SH-001 wires volume to `wind.amp` the moment it exists. |
| A4 | Music stems: calm + combat loops, and 3 stingers (wave-clear, death, victory) | 🔵 | SH-036 crossfades two stems. Today it reuses `game.wav` for both, so the intensity system is inert until real stems land. |
| A5 | Reload SFX (start/finish) per weapon | 🔵 | `rifle_reload_start.wav` / `_finish.wav`. |
| A6 | UI click / hover SFX | 🔵 | Menus (SH-038) are silent without them. |

## Models

| # | Item | Status | Notes |
|---|---|---|---|
| M1 | Weapon models (rifle, blaster, chaingun, lucifer cannon) | 🟡 | **Done procedurally** — `tools/build-weapons.ts` generates 4 GLBs with real silhouettes and documented muzzle points, and the game rides the skeleton's `tag_weapon` socket. The cubes are gone. Replacing them with the Unvanquished originals needs the `res-weapons_src.dpkdir` submodule (D1); the converter pattern already exists. |
| M2 | New enemy kinds: basilisk + advanced marauder | 🔵 | **Blocked on D1.** `tools/convert-aliens-anim.ts` already handles the format; it is a matter of running it with the two extra source paths once the vendor clone exists. The ranged marauder in particular would re-weight every arena — it is the single biggest gameplay addition still on the table. |

## Textures

| # | Item | Status | Notes |
|---|---|---|---|
| T1 | 4× terrain PBR sets (grass_lush / grass_dry / dirt / rock_cliff), 1024² tileable, CC0 | 🔵 | SH-009, not started. `forrest_ground_01` is already vendored. The engine side is ready: `createTextureArrayFromFiles()` now exists precisely for this. |
| T2 | Particle textures (smoke, spark, droplet, flash, dust, shell) | 🟡 | **Generated procedurally** (`tools/build-vfx-textures.ts`) as one PNG per effect — they are texture-array *layers*, not an atlas, so there is no UV math and no bleed. Hand-authored or photographic art is a drop-in file swap. |
| T3 | Decal textures (bullet hole, scorch, blood splat, crater) | 🟡 | Same. The splat in particular would benefit from real art. |

## Decisions for you

| # | Question | Why it needs you |
|---|---|---|
| D1 | Clone the `vendor/unvanquished` submodules on this box? | Unblocks M2 (2 new enemy kinds, including the first *ranged* enemy) and upgrades M1 to the real weapon art. It is a multi-GB clone, so I did not pull it unasked. Commands are in `README.md`. |
| D2 | Ship target: 60 fps at 4K, or 60 fps at 1440p? | The 4K TSR+composite tail is ~5.4 ms of fixed cost. Combat currently sits at ~32 fps at 4K on the 760M iGPU; the VFX round did not measurably move it. This is still the last lever. |
| D3 | Is GPLv3 still the licence you want? | Only binding while Unvanquished assets ship. If the procedural stand-ins ever fully replace them, the project could relicense. |

---

## What is NOT blocked on you

For completeness, the things still open that are purely software and need no
asset — i.e. what I would pick up next:

- **EN-025 ragdolls + SH-031** — Jolt already ships the solver; it has no FFI.
  This is the biggest remaining *feel* item.
- **SH-040 level select** — `world-runtime.ts` still hardcodes `arena_02`.
  Un-hardcoding it is small; authoring 2 more arenas in the editor is the work.
- **SH-009 splat terrain** — the last big pure-visual gap. Engine is ready.
- **EN-038** — `takeScreenshot()` does nothing on Windows, so every
  screenshot-based harness has been silently capturing nothing.
- **SH-025** — `main.ts` is still ~3,800 lines. The new systems went into their
  own modules, but the loop itself has not been split.
