# Visual quality plan

> **Status 2026-07-06:** Tiers 1–4 below are landed and merged
> (round 1), plus the round-2 pass on top: water fresnel/foam
> recalibration, tree crown self-occlusion + rim-gated transmission,
> fog + sun-shaft retune, real motion vectors for all world materials
> under TSR, and physical-resolution 2D text. The *numbers* in the
> tier tables are the values as first landed — current values live in
> `src/main.ts` and `assets/materials/*.wgsl`, and the measured
> round-2 evidence lives in `docs/audit-round2.md`. The forward
> roadmap ("Tier 6+" / UE5-tier) is ticketed as SH-009+ in
> `docs/tickets.md`.

This doc tracks the multi-phase work to take the shooter from
"structurally correct but flat" to "looks like a real outdoor
scene." Player + enemies are explicitly **out of scope** here —
they already look acceptable and any visual change to them risks
breaking the muzzle-flash / hit-spark / animation feel.

In scope: sky, lighting, fog, exposure, terrain, grass, trees,
water polish, ambient cues. Everything that makes the *world*
feel real.

## Why the current look is flat

Snapshot of the pre-Tier-1 baseline:

- **No HDR environment.** `setEnvClearFromHdr` is exposed by the
  engine but never called. PBR materials sample
  `env_tex` / `env_diffuse_tex` for image-based lighting; with
  nothing loaded the env is a 1×1 black, so metallic/specular
  surfaces (water, glass) reflect nothing and dielectrics get
  zero ambient diffuse.
- **No shadows.** `enableShadows()` is also unused. Without sun
  shadows every object reads as floating; the shooter's
  characters and props have no contact darkness.
- **No fog / no auto-exposure.** `setFog` and `setAutoExposure`
  go uncalled. The HDR pipeline's tonemap therefore runs against
  a fixed exposure, so the scene reads either washed out (full
  daylight, no atmospheric softening) or muddy.
- **One-light flat shading.** `setAmbientLight` + one
  `setDirectionalLight` is the entire light rig. No bounce, no
  IBL, no fill.
- **Trees are low-poly untextured GLBs.** `prop_tree.glb` is a
  cardboard-cutout placeholder in the world data — no leaf
  texture, no foliage card, no wind.
- **Terrain is a single-colour green heightmap.** No grass
  blades, no ground texture, no slope/height tinting.
- **Water tessellation is coarse.** 80×10 verts spans 80×5 m —
  every Gerstner wave wavelength longer than ~1 m looks fine but
  the surface is otherwise flat between vertices. No second
  small-wave layer; no scrolling normal map.

None of these are missing engine features — every fix is a
one-line API call or a single new material WGSL file. The work
is opt-in lighting + asset polish, not engine changes.

## Tier 1 — Lighting overhaul (HIGHEST ROI)

Goal: change the look of every surface that's already there.
After this tier, water reflects a real sky, glass picks up sun
glints, characters cast shadows, and the scene reads as
"outdoor afternoon" instead of "neutral test render."

| Step | API | Notes |
|---|---|---|
| 1.1 | `setEnvClearFromHdr('assets/env/outdoor.hdr')` | Copy `engine/examples/bistro/assets/outdoor.hdr` (or pick a different HDRI from the others) into `shooter/assets/env/`. The engine handles equirectangular convolution into env + diffuse on load. |
| 1.2 | `setEnvIntensity(1.0)` | Pump up if the scene reads too dim; pull back if blown out. |
| 1.3 | `enableShadows()` | Three cascaded shadow maps; engine-managed. |
| 1.4 | `setAutoExposure(true)` | Tonemap follows scene luminance instead of a fixed value. |
| 1.5 | `setFog(0.75, 0.82, 0.88, 0.012, 0, 200)` | Pale-blue distance haze; tweak density per scene. |
| 1.6 | Tune `setDirectionalLight` direction + warmth | Match the HDR's sun pose (most outdoor HDRIs have a clear sun direction; mismatched direction makes shadows look wrong). |
| 1.7 | Optional: `setSunShafts(0.4, 0.96, 1.0, 0.95, 0.7)` | Warm god-rays through the trees. Polish, can defer. |

**Acceptance:** screenshot before/after with the same camera
yaw + pitch. Water visibly reflects the sky/sun. Player + house
cast shadows. Tree silhouettes go gold-rim from the sun.

**Watch out for:**
- HDR sun direction baked into the equirectangular won't match
  `setDirectionalLight` direction unless you align them — the
  sky shows the sun in one place, shadows fall as if it's
  somewhere else. The fix is staring at the HDR in a viewer
  (or just iterating in-game), reading the bright spot's UV,
  and back-solving the direction.
- Auto-exposure can wander on the title screen if there's no
  geometry to anchor luminance. Set `setManualExposure` for
  menus.

## Tier 2 — Grass detail (BIG payoff)

Goal: the terrain stops being a flat green flag and reads as
ground.

### 2a — Per-vertex terrain colour variation

Cheap first pass, no new geometry:
- Sample a noise function in the existing terrain shader (or the
  generated terrain mesh) to vary `albedo` between three colour
  stops: dry-yellow, mid-green, deep-green. Slope-tint dark
  brown for steep angles. Height-tint pale for ridges.
- Engine has a "paint category" tag on static meshes already;
  the terrain mesh gets a custom material that does this.

### 2b — Instanced grass blades

The real win:
- Generate ~15,000 grass-blade transforms scattered on the
  heightmap in a build-time tool
  (`shooter/tools/build-grass.ts` — pattern parallels
  `build-world.ts` / `build-terrain.ts`).
- Each blade is a 4-tri double-sided card or a low-poly fan.
- One material instance, drawn instanced; per-instance variation
  comes from a vertex stream (height scale, hue tint,
  per-blade phase for wind).
- Material reads time from `PerFrame` and applies a sine wind
  sway in the vertex shader — Phase 5 user_params holds wind
  direction + amplitude.
- Frustum cull at the instance level; LOD-fade beyond ~20 m.

**Engine work it implies (small):** an instanced-draw FFI on top
of `drawMeshWithMaterial`. Currently each draw is one mesh + one
transform; instanced needs a per-instance buffer. Fits naturally
as a Phase 11-equivalent on the material RFC. ~1 day of engine
work + ~1 day of shooter integration.

**Acceptance:** standing in the field, grass blades visibly fill
the ground at all distances out to ~20 m; wind ripples in
patches; performance overlay shows the grass pass at < 2 ms GPU.

## Tier 3 — Trees (BIG payoff)

The current `prop_tree.glb` is a placeholder. Replace with one
of:

### 3a — Better procedural tree mesh + foliage material

- Trunk: cylinder + branch cones (3-tier L-system in a build-
  time tool).
- Leaves: alpha-tested foliage cards (5–7 cross-quads per
  cluster, 3–4 clusters per tree). Each card is a leafy texture
  with alpha cutout.
- Material: opaque-with-alpha-cutout bucket (need to add — the
  ABI already supports alpha_cutoff in MaterialFactors; just
  haven't wired a draw bucket for it). Two-sided so card
  backsides aren't invisible from the wrong angle.
- Wind sway in the vertex shader — same wind UBO as grass so
  blades and leaves move together.

### 3b — Real GLB tree assets

Faster path if we accept asset constraints:
- Pick a CC0 tree pack (Quaternius / Kenney / poly.pizza).
- Drop into `assets/models/trees/` and reference from the world
  data.
- Tune the existing world generator to scatter them with
  rotation + scale jitter.

**Recommended:** start with 3b for the look-improvement, follow
with 3a's wind sway material once we have a baseline scene we're
happy with.

**Engine work:** alpha-cutout bucket — `Bucket::Cutout` or just
materialise `alpha_cutoff > 0` into the opaque path with a
`discard`. Probably half a day.

## Tier 4 — Water polish (smaller delta — water is already good)

Phase 9's water already has Gerstner waves + Fresnel + refraction
+ shoreline fade + impulse ripples. Remaining gaps:

- **Tessellation.** 80×10 verts is fine for the current 5 m
  wavelengths; if we add a 0.6 m wavelength layer the visual
  banding shows. Bump to 320×40 *only* if Tier 4b lands.
- **Second wave layer.** Add three more `gerstner` calls in the
  vertex shader with shorter wavelengths (0.6 m, 0.9 m, 1.4 m)
  for the close-range crinkle. Wired through user_params so the
  amplitude can be tuned without recompile.
- **Scrolling normal map.** A real-world water shader cheats
  the close-range detail with a tiled normal map scrolling at
  two different speeds, perturbing the wave normal that drives
  refraction. Adds visible sub-mm ripples. Needs an asset
  (a single `water_normal.png` tiled).
- **Caustics.** A projector-style light texture animated on the
  ground beneath the water surface. Honest version is
  expensive; cheaper version is a precomputed scrolling
  caustic loop blended into the scene shader where world-y is
  near 0.
- **Volumetric depth absorption.** Currently `column` only
  drives shoreline alpha. Use it to darken refracted scene
  colour by Beer-Lambert at greater depth — turquoise shallows,
  inky deeps.

**Acceptance:** standing on the riverbank looking down,
sub-metre crinkle visible; far bank reads as soft mirror;
refracted floor visibly tints toward absorption colour with
depth.

## Tier 5 — Atmospheric finish

Once Tiers 1–4 land, the scene reads cohesive but still benefits
from:

- **`setVignette` / `setFilmGrain` / `setChromaticAberration`**
  already wired (called for the existing post-FX). Tune for the
  new baseline.
- **Cloud shadows.** A scrolling 2D noise texture multiplied
  into the directional shadow contribution gives the sense of
  drifting overcast. Cheap.
- **Wind-coupled audio.** Tie the wind UBO that drives grass +
  trees to a `playSound3D` ambient leaf-rustle. Audio + visual
  motion locked makes the scene feel alive.
- **Ambient occlusion tuning.** SSAO is already in the
  pipeline (we see it in the F3 overlay). Tune the radius +
  strength after the lighting overhaul resets the baseline.

## Tier order: my recommendation

Land Tier 1 first, screenshot, *then* decide between Tier 2 and
Tier 3 based on what now looks worst. The default after Tier 1
will be: terrain + trees both look weak relative to the better
lighting, so pick whichever is cheaper to ship. Probably 3b
(real tree GLBs), then 2b (grass instancing).

Tier 4 + 5 are best done last — they're polish tiers and only
read clearly against good lighting + good ground geometry.

## Risks & open questions

- **Asset licensing.** HDRIs from `polyhaven.com` are CC0 —
  safe. CC0 tree packs exist (Kenney / Quaternius). Verify
  before committing.
- **Build pipeline for grass instances.** Need a deterministic
  scatter so the same heightmap always produces the same grass
  layout — important so screenshot diffs aren't chaotic. Seed
  the RNG with `world_id`.
- **Perf budget.** Tier 1 adds shadow-map rendering (~3 ms GPU
  on the M-series we're targeting). Tier 2b adds instanced
  grass (~2 ms with frustum cull). We have ~5 ms of budget at
  60 fps with the current 16 ms total — landing both should
  still leave 5+ ms of headroom.
- **Hot-reload coverage.** The new grass / tree / sky materials
  should all go through `loadMaterial` / `compileMaterialFromFile`
  so iterating in-game stays fast.

## Acceptance — overall

A side-by-side screenshot:
- Same camera pose (selftest already produces this).
- Before: current `t0_5s.png`.
- After: scene reads as "real outdoor afternoon" — sun warm,
  shadows present, water mirror-like at the horizon, trees
  with foliage volume, ground with grass detail.
- Profiler overlay shows < 16 ms total frame time on the dev
  M-series machine.

---

# Tier 6+ — UE5-tier roadmap

Tiers 1–5 above are essentially shipped (HDR env, shadows, fog,
auto-exposure, terrain colour variation, instanced grass scatter,
real tree GLBs with wind sway, multi-octave water with caustics
and Beer–Lambert absorption). The scene reads coherent and "real
outdoor afternoon" from the prescribed camera pose.

The remaining gap to Unreal Engine 5 baseline is mostly about
texture detail, shading models, and reflection fidelity — *not*
rasterisation or geometry density. The full set of work is split
into Phase A (shader-only, no engine change), Phase B (gated by
small engine FFI additions), and Phase C (v2 roadmap territory).

The **concrete unit-of-work tickets** live in
[`docs/tickets.md`](tickets.md) (game side, SH-009..SH-024) and
the engine repo's `docs/tickets.md` (EN-010..EN-017). This section
just orders them.

## Where the gap actually lives

| Subsystem | Today | UE5 baseline | Practical gap |
|---|---|---|---|
| Ground | Procedural fbm tint, **zero textures** | Splat-mapped PBR (4–8 layers), detail normals, distance-field shadows | Macro + detail PBR textures + triplanar (SH-009/010) |
| Grass | 5 000 cross-quads, Lambert | 50k–200k HISM, foliage shading model, alpha-cutout, distance LOD | Instanced draw + transmission lighting + density ring (SH-011/021) |
| Trees | 4 low-poly GLB variants, single-sine wind | Foliage-card geometry, hierarchical wind, two-sided BRDF, imposter LOD | Two-sided lighting + wind regions + leaf cards (SH-012/013/014/020/024) |
| Water | 3 Gerstner + IBL sky reflect + sin-lobe caustics | Single-Layer-Water BRDF, multi-octave Gerstner, planar reflection, sun glint, scrolling normal | Sun glint + multi-octave + planar reflection + texture caustics (SH-002/015/016/017/022) |
| Lighting | 3-cascade CSM + IBL + SSGI single-bounce | Lumen GI + virtual shadow maps + ray-traced reflections (optional) | v2 roadmap — Phase C |

## Phase A — shader-only, no engine change

Ship in this order; each ticket is independent except where
noted. Roughly 2–3 weeks of focused work.

1. **SH-009** — Splat-mapped PBR terrain. *Largest single quality
   leap available; gates SH-010 + SH-014.*
2. **SH-010** — Detail normal + macro variation.
3. **SH-002** *(existing)* — Scrolling normal map for water.
4. **SH-015** — Multi-octave Gerstner + dense water tessellation.
5. **SH-016** — GGX sun glint on water. *Cheapest "wow" upgrade in
   the whole list.*
6. **SH-017** — Texture-based water caustics.
7. **SH-018** — Shore wetness.
8. **SH-012** — Two-sided foliage lighting in `tree.wgsl`.
9. **SH-013** — Hierarchical wind via vertex-color regions.
10. **SH-014** — Bark normal + per-tree HSV variance (closes
    SH-004).
11. **SH-011** — Grass shading polish (transmission + shadow
    receive + density LOD).
12. **SH-019** — Underwater post-process. *Either with engine-
    side EN-017, or with a `setFog` stop-gap.*

**Acceptance for Phase A:** screenshot from the same camera pose
reads as "modern game from 2018" — textured ground, leaves
glowing back-lit, water with moving sun glints and crinkle, river
edge visibly damp. Frame time still < 16 ms.

## Phase B — gated on engine FFI additions

Each game-side ticket has an engine-side counterpart that gates
it. The engine work is small per ticket (~half-week to one week
each) but additive.

| Game ticket | Engine ticket | What it unlocks | Status |
|---|---|---|---|
| SH-021 high-density grass | EN-001 instanced draw | 4× grass density | ✅ shipped |
| SH-020 leaf-card trees | EN-010 alpha-cutout bucket | Real leaf silhouettes | engine ✅, game ⏳ |
| SH-022 planar-reflective river | EN-011 planar reflection capture | River reflects bank trees | both ⏳ |
| SH-023 foliage shading model | EN-012 foliage BRDF in PBR ABI | Drop-in shading for new foliage | both ⏳ |
| SH-024 imposter LOD | EN-015 imposter system | 1 000+ tree forests | both ⏳ |
| (all foliage) | EN-013 global wind UBO | Sync grass + trees + future foliage | engine ✅, partial use |
| SH-009 done cleanly | EN-014 texture-array binding | 4-layer terrain in one slot | both ⏳ |
| (all custom mats) | EN-016 shadow-sample helper | One-line shadow receive | engine ✅, partial use |
| SH-019 done cleanly | EN-017 post-pass slot | Game-side fullscreen FX | both ⏳ |

**Recommended engine merge order:** EN-001 + EN-010 first (each
unlocks one major shooter feature with one day of integration).
EN-011 second (single biggest water upgrade). EN-016 + EN-013 as
quality-of-life. EN-014 only when SH-009 hits the 12-slot limit
in practice. EN-015 last; only matters at >500 trees.

**Acceptance for Phase B:** scene approaches modern Unreal
demo quality at 60 fps. River mirrors the bank, dense leaf-card
forest, carpeted grass with proper LOD.

## Phase C — v2 roadmap territory

The engine's `bloom-renderer-spec-v2.md` plans these explicitly;
they're 12+ months out and out of scope for the shooter today,
listed here for completeness.

- **Virtual shadow maps** (replaces 3-cascade CSM) — softer,
  sharper, unlimited shadow casters. Spec phase D, months 10–14.
- **Lumen-equivalent dynamic GI** — real bounce light under
  canopies (today: single-bounce SSGI). Spec phase E, months
  12–20.
- **Nanite-equivalent virtualized geometry** — full-poly distant
  trees, no LOD chain authoring. Spec phase C, months 8–14.
- **FFT ocean (Tessendorf)** — overkill for a river; relevant if
  the game ever opens to a coastline. Spec phase H, months
  20–26.
- **Procedural sky + sun disk** — Rayleigh/Mie scattering instead
  of static HDR. Tracked in EN-005 🔴.

## What to ship first

If you want one ticket to land *now*, it's **SH-009** —
splat-mapped PBR terrain. The current ground has zero texture
detail at any scale below ~1 m and is the single most jarring
"this looks 2010" element in the scene. Everything else benefits
from the new texture-loading + normal-map pattern that SH-009
establishes.

If you want one ticket to land **second**, it's **SH-016** — GGX
sun glint on water. It's a 20-line fragment-shader edit and the
single biggest "wow" upgrade in the whole roadmap.

After those two, ship Phase A linearly; then ask the engine team
to land EN-001 + EN-010 + EN-011 in that order to unlock Phase B.
