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
