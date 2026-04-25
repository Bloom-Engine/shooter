# Shooter ticket backlog

Outstanding game-side work. Engine-side counterparts live in the
engine repo's `docs/tickets.md`.

Status legend: 🟢 ready · 🟡 needs engine support · 🔴 needs an asset
or a design decision

---

## SH-001 — Wind-coupled ambient audio 🔴

**Why:** the visible scene now reads as breezy (grass + tree
canopies + cloud shadows all swing on the same wind UBO), but
audio is still a static `ambient.ogg` loop. A 3D-positioned
leaf-rustle layered onto forest clusters would close the
last "this place isn't alive" gap.

**Scope:** small once the asset exists.

- Source a CC0 leaf-rustle / wind-through-trees loop (~10–20 s).
- `playSound3D` with the source positioned at a few representative
  forest centroids; volume scales with `wind.amp` from the same
  vec4 that drives grass + tree sway.
- Falloff: linear within ~25 m, silent past ~40 m.

**Acceptance:** stand near a tree cluster, hear leaves rustling;
walk away to open field, the rustle fades; the volume swells if
we crank `wind.amp` mid-game.

**Blocker:** asset.

---

## SH-002 — Scrolling normal-map for water 🔴

**Why:** the Tier 4 water has procedural micro-normal that gives
crinkle, but at close range it still reads slightly synthetic. A
real tiled normal-map texture scrolling at two layered speeds
(per-pixel detail you can't get from sin lobes) is the standard
trick to push water past "good" into "great."

**Scope:** small.

- Source / paint a `water_normal.png` (1024² tile, two-layer
  Worley/Perlin, baked).
- Add to `shooter/assets/textures/` and load via the existing
  texture-loading API.
- Bind into the water material at `@group(2) @binding(0..1)`
  (the standard PBR base-color slots are unused for water).
- Vertex shader scrolls UVs at two speeds + scales; fragment
  unpacks the normal and combines with the existing wave normal.

**Acceptance:** standing on the riverbank looking down close,
sub-mm ripples visible per pixel even when the camera is still.

**Blocker:** asset.

---

## SH-003 — Footstep audio (positional) 🟢

**Why:** standing-still vs walking is currently silent except
for the muzzle flash and ambient. Footsteps would sell motion.

**Scope:** small.

- Source / record 3–4 footstep SFX (grass, dirt, water).
- Trigger one per step from the player controller — detect step
  by accumulating horizontal travelled distance modulo a
  STRIDE constant (~0.8 m at MOVE_SPEED).
- Pick a variant by sampling the surface beneath the player
  (water if `pp.z` in river band; otherwise grass).

**Acceptance:** walking on grass plays grass footsteps at a
believable cadence; entering the river switches to water splashes.

**Blocker:** asset.

---

## SH-004 — Tighter tree-tint distribution 🟢

**Why:** the per-tree leaf-tint hue jitter range was tuned by eye
and a few canopies still come out cooler than naturalistic. The
material's local-Y trunk/leaf split now handles the bigger issue,
but the leaf colour space could use a cleaner saturation clamp.

**Scope:** tiny — a 10-line tweak to the `(FOREST_TINT_R/G/B - 165/-85/-195)`
projection in `main.ts` so the green channel never drops below
a minimum saturation.

**Acceptance:** all 120 forest trees read as healthy summer green;
no cyan / desaturated outliers.

---

## SH-005 — Inline WGSL fallback strings should be auto-generated 🟡

**Why:** `main.ts` has ~200 lines of inline WGSL strings duplicated
from `assets/materials/*.wgsl` so the game still runs in a binary-
only build with no on-disk assets. They drift from the on-disk
files whenever the WGSL changes. A build-time tool that reads each
`assets/materials/*.wgsl` and emits a generated TS module with the
strings would give us the safety net + zero drift.

**Scope:** small — a `tools/build-materials.ts` that reads the
WGSL files and writes `src/generated/materials.ts` exporting one
const per file. Then `main.ts` imports from the generated module
instead of inlining strings.

**Acceptance:** edit `assets/materials/water.wgsl`, re-run
`npm run materials` (or hook into `npm run build`), inline string
in the generated module updates verbatim.

**Blocker:** none, but `npm run dev` workflow extension needed.

---

## SH-006 — Footstep dust / impact puffs 🟡

**Why:** the impulse-field infrastructure already exists (Phase 7);
we use it for water ripples. Same pattern could trigger small
particle puffs at the player's feet on grass / dirt. Adds presence
to running.

**Scope:** medium — needs a small particle system.

- Lightweight CPU-side particle pool (positions + velocities +
  lifetime).
- Spawn 3–5 particles per footstep (when `inGrass`), upward + a
  tiny outward kick.
- Render via `drawMeshWithMaterial` against the additive material
  with a brown-tinted draw call.

**Acceptance:** running across grass leaves a small dust trail
that fades within ~0.5 s.

---

## SH-007 — Tier 5 cloud-volume drifting 🟡

**Why:** the HDR sky has clouds painted-in but they're static. A
slow-rotating sample of the env_tex (or a separate cloud noise
layer added to the sky pass) would give the sky the same "alive"
quality as the ground.

**Scope:** larger — needs sky-pass shader extension.

**Blocker:** depends on **EN-005** (atmospheric scattering /
sky pass refactor) for clean integration.

---

## SH-008 — Sprint key 🟢

**Why:** standard FPS feel. Hold Shift to sprint at 1.5× speed.

**Scope:** tiny — `MOVE_SPEED` becomes `MOVE_SPEED * (sprinting ? 1.5 : 1)`
in `player.ts`. Maybe drain a stamina meter, or simpler: always-on
when held.

**Acceptance:** holding Shift while moving is visibly faster;
releasing returns to normal.
