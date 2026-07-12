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
| A3 | Wind / leaf-rustle ambience loop | 🟡 | **Synthesised stand-in shipped** (16 s, seamless — the tail is cross-faded over the head). SH-001 is now wired: three 3D sources placed on the forest's own centroids (computed from the world file, so moving the trees in the editor moves the sound), volume from distance **and from the live wind amplitude**, so the rustle swells with the same vector that bends the grass. |
| A4 | Music stems: calm + combat loops, and 3 stingers | 🔵 | **The one thing I can't fake.** Everything else here I could synthesise; music I cannot. SH-036's crossfade is live but inert — it reuses `ambient.ogg` for both intensities, so clearing a wave changes nothing you can hear. This is the highest-value item left on this list. |
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
| T1 | 4× terrain PBR sets (grass / dry grass / dirt / rock) | 🟡 | **Generated procedurally** (`tools/build-terrain-textures.ts`). SH-009's splat terrain is shipped and reads as real material at range; the layers are synthesised, not photographed. Real CC0 sets (Poly Haven) are a drop-in file swap. Note the tuning trap recorded in the generator: the first pass came out saturated emerald and undid round-4's de-cartoonification — keep them olive. |
| T2 | Particle textures (smoke, spark, droplet, flash, dust, shell) | 🟡 | **Generated procedurally** (`tools/build-vfx-textures.ts`) as one PNG per effect — texture-array *layers*, not an atlas, so no UV math and no bleed. Hand-authored or photographic art is a file swap. |
| T3 | Decal textures (bullet hole, scorch, blood splat, crater) | 🟡 | Same. The blood splat in particular would benefit from real art. |

## Decisions for you

| # | Question | Why it needs you |
|---|---|---|
| ~~D1~~ | ~~Clone the `vendor/unvanquished` submodules?~~ | ✅ **Done.** Shallow-cloned and initialised only `res-players`, `res-weapons`, `res-legacy`. Unblocked M1 and M2. |
| ~~D2~~ | ~~Ship target: 60 fps at 4K, or 60 fps at 1440p?~~ | ✅ **Answered by making it not our decision.** Engine EN-046 added an output-scale knob and SH-045 put it in the settings screen. The player picks: native 4K ≈ 53 fps in combat, or **0.8 → a locked 60**. |
| **D4** | **Default display resolution: 1.0 or 0.8?** | The one live question. It currently ships at **1.0** — the game looks its best out of the box and the slider is right there — which means a fresh install runs ~53 fps in combat when 0.8 would give a locked 60. Defaulting to 0.8 is entirely defensible; I did not want to quietly downscale your display without asking. One line. |
| D3 | Is GPLv3 still the licence you want? | Only binding while Unvanquished assets ship. If the procedural stand-ins ever fully replace them, the project could relicense. |

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
