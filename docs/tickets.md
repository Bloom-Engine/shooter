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

---

# UE5-tier rendering roadmap

Tickets SH-009 onward are the work to take ground / grass / trees /
water from the current "polished mid-tier" baseline (Tiers 1–4 in
`docs/visual-quality.md`) toward Unreal-Engine-5-class quality. The
overall plan + phase ordering lives in
[`docs/visual-quality.md`](visual-quality.md) under the "Tier 6+"
section; each ticket here is the concrete unit of work.

Phase A = shader-only, no engine change. Phase B = gated by a small
engine FFI addition. Phase C = v2 roadmap territory.

---

## SH-009 — Splat-mapped PBR terrain 🟢  *(Phase A)*

**Why:** the largest remaining quality gap in the scene is the
ground itself. `terrain.wgsl` today is purely procedural — three
colour stops blended by a 2-octave hash noise, with zero textures.
Below ~1 m the surface has no detail at all; the camera looking
straight down sees a smooth gradient. Even one tileable PBR layer
is a generational leap, and 4 layers blended by slope/height/noise
gets us to Half-Life-2-era ground at minimum, modern outdoors with
detail textures.

**Scope:** medium — new material + 12 textures.

- Source 4 CC0 PBR sets (1024² tileable) from polyhaven.com:
  `grass_lush`, `grass_dry`, `dirt`, `rock_cliff`. Each ships
  albedo + normal + roughness + AO.
- Pack them into 4 texture-array slots (or 12 separate slots —
  see EN-014 for the cleanest binding pattern).
- Rewrite `assets/materials/terrain.wgsl` to:
  - **Triplanar projection** so cliffs and overhangs sample sanely
    (current world-XZ fbm fails on vertical faces).
  - 4-layer weight blend driven by `(noise, slope, height,
    distance_to_water)` — same masks the current shader already
    computes, just routing them to texture weights.
  - Detail normal layered at ~50× UV scale (covered by SH-010).
  - Cascade-shadow sample (today the shader skips sun shadows).
- Replace `TERRAIN_PARAMS` floats in `main.ts:257-263` with new
  layer weights / blend thresholds.

**Acceptance:** standing on the ground looking down, surface
reads as real grass at any distance; cliffs and steep terrain show
rock; transitions between layers blend instead of stepping; water
edge tile shifts toward dirt naturally.

**Blocker:** asset sourcing (1 hour); cleanest version waits on
EN-014 (texture-array binding pattern) but a 12-slot interim
version works today.

---

## SH-010 — Detail normal + macro variation 🟢  *(Phase A)*

**Why:** a 1024² texture stretched over an 80 m terrain reads as
~1 cm per texel — but ground detail breaks down at 2 cm scales
(individual blade roots, pebbles, cracks). The standard UE5 trick
is a separate detail normal map tiled at 25–50× the macro UV plus
a low-frequency macro variation mask to break the obvious tiling.

**Scope:** small — once SH-009 has a normal-map binding, adding a
detail layer is a vertex-shader UV scale + a fragment-shader normal
combine.

- Source one 512² CC0 detail normal (`grass_detail_normal.png`,
  fine blade-root noise).
- Source one 256² macro variation mask (`grass_macro_var.png`,
  large blob noise) — multiply this into albedo at world-XZ
  scale ~30 m so the whole field doesn't read identical.
- Material change: sample detail normal at UV × 50, blend into the
  base normal via the half-derivative trick. Sample macro var at
  UV × 0.03, multiply albedo by `0.85 + 0.3 * macro`.

**Acceptance:** pressing the camera against the ground shows
sub-cm normal detail; flying overhead, no obvious tiling pattern
visible at any zoom level.

**Blocker:** none after SH-009 ships.

---

## SH-011 — Grass shading polish 🟡 *(Phase A — wrap-lambert + shadow receive shipped, density LOD pending)*

**Why:** `grass.wgsl` today is Lambert against the sun + cloud
shadow. Real grass has three behaviours we miss:

1. **Sub-surface translucency** — sun lighting *behind* a blade
   passes through the leaf and tints it luminous green. Without
   this the back-lit lawn reads dead-flat.
2. **Cascade shadow receiving** — the grass shader doesn't sample
   `shadow_tex_0/1/2` so tree shadows don't fall on the grass.
   Trees float visually as a result.
3. **Density LOD** — uniform 5 000 blades across 80 × 80 m means
   sparse foreground. Re-bucketing into 3 density rings (2× inside
   12 m, 1× from 12–25 m, fade out 25–40 m) keeps the budget but
   makes the immediate ground feel carpeted.

**Scope:** small — one shader edit + one scatter-rebucket in
`main.ts`.

- ✅ Add `wrap_lambert(n,l,wrap=0.5)` for soft front-face shading. *(shipped via grass_instanced.wgsl in SH-021 pass)*
- ✅ Add transmission term: `pow(back, 2) * pow(view·-l, 1.5)`
  scaled by a warm-green tint, added to `lit` independent of `cloud`. *(shipped)*
- ✅ Sample shadow cascades via `sample_sun_shadow(world_pos)` (EN-016 helper). *(shipped)*
- ⏳ In the scatter loop, change to ring-based density (2× inside
  12 m, 1× 12–25 m, fade out 25–40 m). *(pending — current scatter
  is still uniform across the playfield)*

**Acceptance:** standing in the field at sunrise, blades glow when
back-lit ✅; tree shadows visibly fall onto the grass beneath ✅;
the foreground always looks dense ⏳.

**Blocker:** none — density-LOD is straightforward; the shading
work landed in the SH-021 instanced-grass material rewrite.

---

## SH-012 — Two-sided foliage lighting in `tree.wgsl` 🟢  *(Phase A)*

**Why:** `tree.wgsl` is plain Lambert with cloud noise. The
canopy half facing away from the sun goes pure black on every
tree, reading as solid silhouette rather than translucent leaves.
The cheapest fix is a wrap-lambert + a transmission term using the
same trick as grass — no new geometry, no new ABI.

**Scope:** tiny.

- Add `wrap_lambert(n, l, 0.5)` so the shadowed side keeps a soft
  fill instead of dropping to zero.
- Add transmission: `back_term = saturate(dot(-n, l)) * pow(saturate(dot(v, l)), 4) * trans_strength`.
- Apply the back term **only** to leaf vertices (use the existing
  `local_y > trunk_top_y` discriminator already in the shader).
- Per-tree leaf-tint controls transmission strength via the alpha
  channel of `draw.model_tint`.

**Acceptance:** standing inside the forest looking up at the sun
through a canopy, leaves read as luminous edge-lit instead of
solid black; the trunk still shadows correctly.

**Blocker:** none. EN-012 is the "do this properly via the standard
PBR ABI" version, but the local fix lives in tree.wgsl with no
dependency.

---

## SH-013 — Hierarchical wind via vertex-color regions 🟢  *(Phase A)*

**Why:** current wind is one quadratic-Y sine — every vertex above
`y = 1.4` sways at the same frequency and phase. Real foliage
moves at three different rates: trunk leans slowly, branches sway
medium, leaves flutter fast. The vertex format already carries a
4-channel color attribute (used by grass for tip-weight). Tree
GLBs don't currently set vertex color, so all four channels are
free.

**Scope:** medium — converter change + shader change.

- Extend `tools/convert-arena.ts` (or add `tools/bake-tree-wind.ts`)
  to bake per-vertex weights into the tree GLBs:
  - **R** = main bend weight (0 at root → 1 at outer canopy,
    distance from local origin in the XZ plane)
  - **G** = branch wind weight (large near branch tips, low elsewhere
    — same as existing local-y heuristic, but localised per branch
    cluster instead of global Y)
  - **B** = leaf flutter weight (1 only on the leaf primitive)
  - **A** = phase offset hash so branches in one tree desync
- Rewrite the `tree.wgsl` vertex shader to displace by three
  layered sines, each weighted by the matching color channel.

**Acceptance:** trunk leans slowly under a gust, branches sway at
~2× frequency, leaves flutter at ~5× frequency; adjacent branches
on one tree don't move in lockstep.

**Blocker:** none. Best paired with EN-013 (global wind UBO) so
all foliage materials can be driven by one set of params, but the
local TreeParams UBO works today.

---

## SH-014 — Bark normal + per-tree HSV variance 🟢  *(Phase A)*

**Why:** trunks today are flat brown. Once SH-009 establishes the
normal-map binding pattern, dropping a tileable bark normal map
on the trunk-portion of `tree.wgsl` is a free upgrade. Separately,
the existing per-tree leaf tint is computed in RGB channel-deltas
which can drift to cyan or desaturated outliers (already noted
as SH-004); rotating to HSV saturation-clamped variance fixes it
in one place.

**Scope:** small.

- Source `bark_oak_512.png` + `bark_oak_normal_512.png` from
  Polyhaven (CC0).
- Add binding to `tree.wgsl`; sample triplanar in trunk region only.
- Replace the `(R-165, G-85, B-195)` projection in `main.ts:1595-1597`
  with an HSV jitter: hue ±0.04 around 0.30, saturation clamp
  [0.45, 0.85], value clamp [0.55, 0.85]. Then convert back to RGB.

**Acceptance:** trunks show real bark grooves under raking sun;
all 120 forest trees stay in the healthy-summer-green leaf band
(closes SH-004).

**Blocker:** SH-009 lands the texture-loading pattern first.

---

## SH-015 — Multi-octave Gerstner + dense water tessellation 🟢  *(Phase A)*

**Why:** `water.wgsl` runs 3 Gerstner lobes (5 m / 3.5 m / 2.2 m
wavelengths) on an 80 × 10 vert mesh. UE5 water typically uses
6–8 lobes spanning ~10 m down to ~0.4 m so the surface reads as
crinkled at every scale. Adding 4 short-wavelength lobes only
helps if the mesh is dense enough to sample them — the current
80 × 10 quantises anything below 1 m wavelength to noise.

**Scope:** small.

- In `water.wgsl:vs_main`, add 4 more `gerstner` calls at
  wavelengths 1.4 m, 0.9 m, 0.6 m, 0.4 m, with steepness curve
  decreasing as wavelength shrinks (0.10, 0.07, 0.05, 0.03).
- In `main.ts:554-555`, bump `WATER_COLS = 320, WATER_ROWS = 40`
  (32 000 verts, ~96 000 indices — well within the engine budget).
- Tune the existing 3 long-wavelength lobes to the same wind dir
  family so the spectrum reads coherent.

**Acceptance:** standing on the riverbank, water shows a layered
spectrum from boat-wake-scale down to ripple-scale; no obvious
single sine pattern; vertex displacement smooth at all
tessellation scales.

**Blocker:** none.

---

## SH-016 — GGX sun glint on water 🟢  *(Phase A)*

**Why:** today the only specular is `sample_env(r, lod)` against
the static IBL panorama. That gives a soft sky reflection but no
moving sun glint. Real water's "wet" cue is the sharp specular
highlight from the sun on every wave crest as you walk along the
bank. UE5 Single Layer Water uses a separate GGX evaluation
against the directional sun for exactly this.

**Scope:** tiny — one extra term in `fs_main`.

- Compute GGX-D × Schlick-G × Schlick-F against `view.sun_dir` /
  `view.sun_color`, roughness ~0.02 (very sharp).
- Add to `water` after the IBL `sky` mix; clip below the horizon
  so we don't double-add when the sun is low.

**Acceptance:** moving the camera along the riverbank shows a
swimming sparkle pattern that tracks individual wave crests; turning
to face the sun, a bright moving glint cone appears.

**Blocker:** none.

---

## SH-017 — Texture-based water caustics 🟢  *(Phase A)*

**Why:** caustics in `water.wgsl:124-130` are 3 sin lobes max-blended
into a sharp interference pattern. It animates but reads as a
synthetic regular pattern at close range. The standard cheap
upgrade is a 2-layer scrolling Voronoi/Worley caustic texture (the
same trick UE5 ships as `T_Water_Caustic_01_M`) sampled at
world-XZ + animated by a scrolling offset, modulated by water
column.

**Scope:** small.

- Source / paint `water_caustic.png` (1024² Voronoi-edge bake,
  greyscale).
- Sample twice at different world-XZ scales (1.2 × and 0.8 ×) and
  scroll speeds; max-blend the two samples.
- Replace the 3-sin block; keep the column-fade smoothstep.

**Acceptance:** river bed under shallow water shows wandering
crisp caustic lines that don't repeat obviously; deep water stays
dark per Beer-Lambert.

**Blocker:** none. Asset is the only requirement (~30 min in any
texture tool).

---

## SH-018 — Shore wetness 🟢  *(Phase A)*

**Why:** the river/land transition reads as a hard tile boundary —
dry grass meets bright shoreline foam at the same shading values.
Real wet ground darkens albedo and drops roughness. Sampling the
distance-to-waterline in the terrain shader and biasing both
within ~1 m closes the seam beautifully.

**Scope:** small — terrain shader edit only.

- Pass water plane Y + half-extents through `TerrainParams` (UBO).
- Inline a shore-mask: `1 - smoothstep(0, 1.0,
  distance_to_water)`.
- Multiply albedo by `mix(1.0, 0.55, shore_mask)`; multiply
  roughness output by `mix(1.0, 0.35, shore_mask)`.

**Acceptance:** the strip of ground within 1 m of the waterline
reads visibly damper (darker + glossier); the transition fades
out smoothly inland.

**Blocker:** none.

---

## SH-019 — Underwater post-process 🟡  *(Phase A)*

**Why:** when the camera Y dips below the river surface (some
shore tiles in arena_02 let you wade), the world should tint
blue-green and lose contrast — basic submerged colour absorption.
Today nothing changes.

**Scope:** small.

- Detect `camera.y < water_y && inside_river_xz` in `main.ts`
  per frame; toggle a custom post-FX call.
- Engine option A — leverage existing `setFog` to push a thicker
  bluer fog while submerged (works today, dirty).
- Engine option B — add a post-pass slot that runs a fullscreen
  WGSL shader after composite (need engine FFI; small).

**Acceptance:** wading into the river visibly tints + dims the
view; walking back out clears it within 200 ms.

**Blocker:** option B needs an engine post-pass FFI (proposed in
EN-017). Option A works as a stop-gap.

---

## SH-020 — Real leaf-card trees 🟡  *(Phase B — gated on EN-010)*

**Why:** Kenney trees are low-poly with single-colour leaf
volumes. The standard quality leap is alpha-tested foliage cards —
each leaf cluster is a textured quad with alpha cutoff, giving
the silhouetted leaf detail you can't get from solid geometry.

**Scope:** medium.

- Source one CC0 foliage-card tree pack (Quaternius "Foliage Pack
  Vol 2" has alpha-tested oaks).
- Convert via existing `tools/convert-arena.ts` flow; expose
  `alpha_cutoff` per primitive.
- Wire a new `tree_cutout.wgsl` material that uses the
  `Bucket::Cutout` path (EN-010), reading `MaterialFactors.alpha_cutoff`.
- Replace 2 of the 4 tree variants with leaf-card versions; keep
  the others as solid for performance comparison.

**Acceptance:** zooming on a tree at 5 m, individual leaf
silhouettes visible against the sky; from 30 m the tree reads as
a textured volume, not a polygon ball.

**Blocker:** EN-010 (alpha-cutout bucket).

---

## SH-021 — High-density instanced grass ✅ *(Phase B — shipped)*

**Why:** 5 000 blades was the CPU-mesh-build ceiling, not a quality
choice. With EN-001 instanced drawing we now push 20 000 blades at
a single draw call.

**What shipped:**

- ✅ `assets/materials/grass_instanced.wgsl` — canonical instanced
  material declaring `InstancedVertexInput` with attributes 7-10
  (pos / rot_y / scale / tint).
- ✅ Canonical 6-vert cross-quad blade mesh (12 indices for
  double-sided cross) created once at startup.
- ✅ 20 000-instance flat-array buffer with deterministic LCG
  scatter, heightmap-bilinear Y, building + river rejection,
  per-blade scale 0.85–1.25 and tint variance ±15%.
- ✅ Single `drawMeshWithMaterialInstanced` call per frame
  (down from one big baked mesh; up 4× density).
- ✅ Wind via `frame.wind` (EN-013) — `setWind(0.85, 0.50, 0.10, 1.6)`
  at startup; per-blade phase from world XZ + frame.time.
- ✅ Cascade shadow receive via `sample_sun_shadow` (EN-016 helper).
- ✅ Wrap-lambert + transmission for back-lit blades (closes
  SH-011's first two acceptance criteria).
- ✅ Old `assets/materials/grass.wgsl` deleted; old 5 000-blade
  `GRASS_VERTS`/`GRASS_INDS` baked-mesh path removed from main.ts.

**Acceptance:** ground reads as carpeted to ~30 m ✅; 20 000 blades
at one draw call ✅; tree shadows visibly fall on grass ✅; back-lit
blades glow ✅. (Density-ring LOD per SH-011 still pending; current
scatter is uniform.)

**Note:** the new material lives in `compileMaterialInstanced(string)`
which has no from-file/hot-reload path today, so the WGSL is also
inlined in `main.ts` as `GRASS_INSTANCED_WGSL`. Source of truth is
the `.wgsl` file; the inline copy must track edits to it. SH-005's
auto-generation will close that gap.

---

## SH-022 — Planar-reflective river 🟡  *(Phase B — gated on EN-011)*

**Why:** today the water reflects only the static HDR sky panorama
via `sample_env()`. Trees lining the bank don't show up in the
reflection; bridges and buildings near the water look
disconnected. Planar reflection (mirror camera into a low-res RT
captured per frame) is the single most-noticed water upgrade in
modern games.

**Scope:** small once EN-011 lands.

- Tag the river quad as a reflection source (engine API TBD).
- In `water.wgsl`, replace the `sample_env(r, lod)` call with a
  sample of the planar reflection RT, perturbed by the surface
  normal.
- Fall back to `sample_env` for grazing angles past the planar
  capture's FOV.

**Acceptance:** trees on the far bank visibly reflect in the
river; standing on the bridge sees the bridge underside in the
reflection; reflection wobbles with surface waves.

**Blocker:** EN-011 (planar reflection capture).

---

## SH-023 — Adopt foliage shading model 🟡  *(Phase B — gated on EN-012)*

**Why:** SH-012 patches transmission into `tree.wgsl` locally;
SH-011 does the same for grass. Once the engine ships a real
foliage shading model in the standard PBR ABI (two-sided lighting
+ light wrapping + simple subsurface tint), foliage materials
become 4-line declarations instead of bespoke shaders.

**Scope:** small — port both materials to the new ABI.

- Replace the local wrap-lambert + transmission code in
  `grass.wgsl` and `tree.wgsl` with the standard `shading_model:
  foliage` declaration.
- Tune the per-material transmission tint via `MaterialFactors`.

**Acceptance:** behaviourally identical to SH-011 + SH-012, but
the shaders shrink ~30 lines each and lighting stays consistent
with any new foliage materials.

**Blocker:** EN-012.

---

## SH-024 — Imposter LOD for distant trees 🟡  *(Phase B — gated on EN-015)*

**Why:** the arena ships 120 trees today; if we open the playfield
or move toward dense-forest gameplay we'll want 500 – 1 000.
Beyond ~40 m the per-tree GPU cost is wasted on silhouette pixels
— an octahedral imposter (one quad textured with a pre-rendered
multi-angle bake) is the standard solution.

**Scope:** small once EN-015 ships an imposter system.

- Bake octahedral imposter atlases for all 4 tree variants at
  build time (`tools/bake-tree-imposters.ts`).
- Game-side: tree draw loop swaps to the imposter material when
  `distance(camera, tree) > 40`.

**Acceptance:** 1 000 trees draw at the same cost as today's 120;
the LOD switch is invisible during normal gameplay.

**Blocker:** EN-015.
