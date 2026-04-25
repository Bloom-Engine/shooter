# Visual quality plan

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
