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
| A1 | Footstep SFX — grass ×4, dirt ×4, heavy ×1 | 🟡 | **Synthesised stand-ins shipped** (`bun tools/gen-sfx.ts`). A step is an *impact* plus a *scuff*: grass is nearly all scuff (bright, grainy), dirt is mostly impact (low thud + grit), the tyrant footfall is a 48 Hz body with debris on top. They are audible and they sit right in the mix — but they are synthesis, not recordings. Replace with the Sonniss GDC bundle (a documented source in `SOURCES.md`) as a straight file drop: same names, no code change. |
| A2 | Weapon tail layers — rifle, blaster, chaingun, cannon | 🟡 | **Synthesised stand-ins shipped.** The "BOOM" half of crack-BOOM: band-limited decaying noise + a low body, routed to the reverb send by the mixer. Cannon runs 2.4 s and is still audible when the next shot lands. Real recordings would be better; the *system* is no longer silent. |
| A3 | Wind / leaf-rustle ambience loop | 🟡 | **Synthesised stand-in shipped** (16 s, seamless — the tail is cross-faded over the head). SH-001 is now wired: three 3D sources placed on the forest's own centroids (computed from the world file, so moving the trees in the editor moves the sound), volume from distance **and from the live wind amplitude**, so the rustle swells with the same vector that bends the grass. **SH-052:** the retrigger hack is gone — the three sources are true looping voices now (EN-062), detuned 0.94/1.0/1.07 so they decorrelate. |
| ~~A7~~ | ~~River loop~~ | ✅ | **Done 2026-07-16 (SH-052b) — real recording.** The synth stand-in read as fake (sine-chirp "babble" is the tell), so `river_loop.wav` is now a 32 s seamless cut of Bolt's *Immersive Creek* babbling-brook recording (Sonniss GDC 2024, same license line as `splash1.wav`). Cut is scripted and reproducible: `tools/convert-audio.ts` (`startAt`/`loopFade` — the window was picked by scanning for minimum RMS + brightness variance, not by ear). Runtime got width too: main emitter + two detuned flankers along the channel axis. |
| A8 | Chitin skitter steps — light ×4, heavy ×4 | 🟡 | **Synthesised stand-ins shipped** (SH-052) — leg-tap bursts; heavy adds body + scrape. Fired per stride by every non-tyrant kind (`KIND_STRIDE`). Real replacements: insect-on-stone foley, dry leaves off. Names `skitter_light1-4.wav` / `skitter_heavy1-4.wav`. |
| A9 | Crawl bed loop | 🟡 | **Synthesised stand-in shipped** (SH-052, 3.5 s seamless) — the continuous chitinous rustle a pooled voice carries on each nearby *moving* enemy, so something closing in is audible between its steps. Keep any replacement QUIET and broadband; it reads subliminally by design. `crawl_loop.wav`. |
| ~~A4~~ | ~~Music stems: calm + combat loops, and 3 stingers~~ | ✅ | **Done 2026-07-13.** Six tracks generated, mastered and shipped. Suno ignored the lengths (162 s beds, a 49 s "stinger") and the key (came back **A# minor**, not D minor) — the key was fine because all three beds agree with *each other*, which is the only thing that mattered, and that was **verified** rather than assumed (chroma + Krumhansl in `tools/audio.ts`). `bun tools/music-master.ts` finds each loop point by searching for self-similarity, crossfades the seam, and trims the stingers to windows read off the waveform. Raw renders kept in `assets/music/src/`. |
| A5 | Reload SFX (start / finish) | 🟡 | **Synthesised stand-ins shipped** — noise clack + two metallic partials; start is lower (mag out), finish is higher and harder (seated). |
| A6 | UI click / hover SFX | 🟡 | **Synthesised stand-ins shipped** — soft sine blips. Kept deliberately dull: they fire on every menu move, and anything with a sharp transient becomes torture inside a minute. |

> **What "synthesised stand-in" means here.** `tools/gen-sfx.ts` generates these
> from noise, filters and decaying sines — deterministically, so re-running it
> reproduces byte-identical files instead of a fresh set of near-misses in every
> diff. They exist because the *code* for footsteps, tails, reload and UI sound had
> been shipped and silent for weeks: `optional()` probed for a file, found nothing,
> and fell back to no sound. A system that looks done and makes no noise is the
> worst state for a feature to sit in. These make it audible today and cost nothing
> to replace tomorrow.

## Models

| # | Item | Status | Notes |
|---|---|---|---|
| M1 | Weapon models (rifle, blaster, chaingun, lucifer cannon) | ✅ | **Real Unvanquished art.** `tools/convert-weapons.ts` converts the MD3 third-person meshes with their textures. NB `<weapon>_hand.md3` is a trap — it parses fine and has zero surfaces, because it is a tag-only attachment model; the mesh is `tpweapon.md3` (and `chaingun_thirdperson.md3` for the odd one out). |
| M2 | Two new enemy kinds | ✅ | **Advanced marauder + advanced dragoon** — Unvanquished's upgrade classes, which are the base rigs wearing `body_adv.skin`. `convert-aliens-anim.ts` honours `.skin` files, so they cost two table rows and no new art. Both are RANGED, which is the point (SH-042). |
| M3 | A third arena | 🔵 | **Not an art job — an authoring job, in the editor.** SH-040's pipeline is done and the level select is live, but only `arena_01` and `arena_02` exist and SH-040 asked for three. A new arena is world-file + one manifest line; no game code changes. It is also the acceptance test for the whole editor pipeline. |

## Textures

| # | Item | Status | Notes |
|---|---|---|---|
| ~~T1~~ | ~~4× terrain PBR sets (grass / dry grass / dirt / rock)~~ | ✅ | **Done 2026-07-15 (SH-050) — real CC0 Poly Haven photoscans**, at 1024² with the scans' own MEASURED normals (the procedural set derived normals from albedo luminance, which assumes dark = deep; on grass that is false, so the relief fought the light). `forrest_ground_01` / `withered_grass` / `brown_mud_dry` / `cliff_side`. It really was the drop-in swap SH-009 promised — the generators are kept as the no-`external/` fallback. Two things worth knowing: the swap surfaced that **SH-010's detail normal had been a flat no-op since it shipped** (its fbm returned a constant — fixed), and each layer now tiles at its scan's real physical size rather than one shared guess. Cost: **0.19 fps** measured 512 vs 1024, same binary. |
| T2 | Particle textures (smoke, spark, droplet, flash, dust, shell) | 🟡 | **Generated procedurally** (`tools/build-vfx-textures.ts`) as one PNG per effect — texture-array *layers*, not an atlas, so no UV math and no bleed. Hand-authored or photographic art is a file swap. |
| T3 | Decal textures (bullet hole, scorch, blood splat, crater) | 🟡 | Same. The blood splat in particular would benefit from real art. |

## Decisions for you

| # | Question | Why it needs you |
|---|---|---|
| ~~D1~~ | ~~Clone the `vendor/unvanquished` submodules?~~ | ✅ **Done.** Shallow-cloned and initialised only `res-players`, `res-weapons`, `res-legacy`. Unblocked M1 and M2. |
| ~~D2~~ | ~~Ship target: 60 fps at 4K, or 60 fps at 1440p?~~ | ✅ **Answered by making it not our decision.** Engine EN-046 added an output-scale knob and SH-045 put it in the settings screen. The player picks: native 4K ≈ 53 fps in combat, or **0.8 → a locked 60**. |
| ~~D4~~ | ~~Default display resolution: 1.0 or 0.8?~~ | ✅ **Answered 2026-07-13: stays at 1.0.** Full native resolution, ~53 fps in combat. The player can still trade it for a locked 60 in the graphics settings — it is their call, not ours, which was the point of SH-045. |
| ~~D3~~ | ~~Is GPLv3 still the licence you want?~~ | ✅ **Answered 2026-07-13: it does not matter.** This is a demo that should be as good as it can possibly be, so asset QUALITY outranks licence permissiveness. GPL / CC-BY-SA / CC-BY / CC0 are all fair game, attribution included. Recorded because it *widens* the sourcing options for SH-046 rather than narrowing them. |

---

## What is NOT blocked on you

Purely-software work still open — i.e. what I would pick up next, in order:

- **Editor: prefab authoring UI** (`../editor/PLAN.md` §E). `prefab-tool.ts` is fully
  written — create/save/add-child — with **zero UI entry points**, and the shooter has
  zero prefabs. Biggest content-throughput multiplier available.
- **Editor: terrain painting** (PLAN §D). SH-009's splat weights are authored nowhere.
- **Editor: play-in-editor** — save to a temp world, shell out to the game with that
  path. SH-040 already made the world path a parameter, so this is cheap.
- **EN-038** — `takeScreenshot()` writes no file on Windows. Its original *diagnosis*
  is void (see docs/tickets.md), so it needs re-diagnosing with a file-write probe,
  not a print.
- **EN-039** — immediate-mode draws cannot pitch, so the gun cannot tilt with the aim.
- **EN-033** — bone-socket query, for SH-027's v2 weapon attach (weapon rides the hand
  bone through walk/run/attack instead of a fixed offset).
