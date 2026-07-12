# Performance audit — July 2026 (35 fps investigation)

Measured on the dev box: AMD Radeon 760M iGPU (Dx12), 3840×2160 borderless
output, render scale 0.5 (1920×1080 internal), TSR upscale. Data from the
PERFTEST harness (mode 0 staged bisect on the title screen + mode 1 gameplay
timeline), engine profiler per-pass table, plus a code audit of the engine
render path, engine CPU frame path, game loop, and content.

## Measurements

### Feature bisect (mode 0, title screen = full world backdrop)

| Stage | fps | ms | Δ vs mailbox baseline |
|---|---|---|---|
| baseline Fifo rs0.5 | 31.3 | 31.99 | — |
| mailbox rs0.5 | 31.7 | 31.56 | baseline (vsync is not the cap) |
| no SSGI | 33.4 | 29.91 | **−1.65 ms** |
| no SSAO | 32.4 | 30.83 | −0.73 ms |
| no SSR | 31.7 | 31.56 | ±0 |
| **no shadows** | **48.7** | **20.55** | **−11.4 ms** |
| no bloom | 32.2 | 31.02 | −0.54 ms |
| rs 0.25 | 32.1 | 31.16 | −0.4 ms (**not fill-bound at internal res**) |
| rs 1.0 | 16.8 | 59.50 | +27.9 ms |
| all off | 58.2 | 17.18 | −14.4 ms (floor is still > 16.7 ms) |
| profiler on | 24.8 | 40.29 | profiler itself costs ~9 ms |

### Gameplay (mode 1)

Steady combat with 3–5 enemies: 30.3–31.2 ms (~32–33 fps) — within ~1 ms of
the title screen. Enemies/AI/skinning are **not** the regression. The drop to
25 fps at t≈54 s in the log is the profiler turning on, not wave 1.
Worst-frame spikes of 44–75 ms recur during movement (see finding 9).

### Per-pass GPU (profiler on; proportions valid, absolutes inflated ~9 ms)

| Pass | GPU ms | Res |
|---|---|---|
| shadow_pass | 7.2 | 3 cascades × 2048² |
| main_hdr_pass | 6.1–6.4 | 1920×1080, 5-target MRT (~22 B/px) |
| taa_pass (TSR) | 2.9–3.0 | → 3840×2160 Rgba16F |
| final_composite | 2.5–2.6 | 3840×2160 |
| material_pass (terrain+grass+building) | 2.0–2.2 | 1920×1080 |
| ssao | 0.52 | 960×540 (+ full-res blur, untimed) |
| bloom | 0.43 | 960×540 chain |
| ssgi probes (trace+temporal+resolve) | 0.28 | 960×540 |
| ssr_march | 0.20 | 1920×1080 |
| hiz chain | 0.15 | 960×540 |

Frame is **GPU-bound**: GPU avg 22.5–23.2 ms vs CPU avg 9.7–10.1 ms.
**Untimestamped GPU passes** (the historical "unattributed 8–10 ms"): planar
reflections, card_light relight, scene_compose, ssao_blur, ssr_temporal,
auto-exposure (engine `renderer/mod.rs:11715,11771`, `postfx_chain.rs:275-280`).

### Scene content (per main view)

~452 draw calls, of which **384 (85%) are tree primitives** (96 trees × 4
alpha-cutout prims); ~510 k triangles, of which grass 240 k (20 000 × 12),
terrain 130 k (single un-decimated mesh), trees 84 k. Tree GLBs carry
3×1024² JPEG + 1×512² PNG each for 880 tris.

## Root cause in one sentence

Everything that is not a scene-graph node — the 88 cached-model trees, the
material draws, the skinned enemies — bypasses the culling and
uniform-pooling infrastructure the engine already has, so the whole forest
is re-submitted unculled into the main pass, all three shadow cascades, and
the water reflection probe every frame (≈1,900 tree-prim submissions/frame),
while the post tail pays fixed 4K-Rgba16F bandwidth.

## Ranked findings

**1. Shadow pass re-renders the entire world into all 3 cascades every frame
— measured 11.4 ms swing.**
`shadow_pass.rs:103-114` forces a full re-render whenever any immediate/model/
material command exists (always). Cached-model and material casters get
sentinel bounds (`shadow_pass.rs:250-251`) so per-cascade frustum culling
(`:265-275`) never rejects them: ~470 casters × 3 cascades ≈ 1,400 draws,
including 130 k-tri terrain ×3 and every alpha-tested leaf card ×3.
Fix: (a) store a world AABB per cached draw (`models.get_bounds()` exists)
so cascade culling engages; (b) cache static cascades — re-render cascade 0
(enemies) per frame, cascades 1–2 only on VP/content change; (c) skip leaf
cutout in the far cascade. Expected: shadow 7.2 → ~2–3 ms GPU, −1 ms CPU.

**2. Planar-reflection probe re-renders the scene unculled, grass included,
with no GPU timestamp.** `renderer/mod.rs:11291-11807`: pass A re-draws all
material commands (20 k grass blades + 130 k terrain) into a 512² probe where
blades are sub-pixel; pass B re-draws all ~450 cached meshes with no frustum
test vs the mirrored camera, one 128 B `write_buffer` per draw (~450/frame),
fresh bind group + 2 fresh texture views per frame. Fix: exclude grass
(promised in `material_system.rs:1678-1680`), cull by mirrored frustum
(`extract_frustum_planes` is already pub(crate)), batch uniforms into one
write, cache the BG, add timestamps. Expected: −0.7–1.5 ms GPU, −0.5–1.5 ms CPU.

**3. card_light relights the whole GI card atlas every frame for a static
sun.** `renderer/mod.rs:7113-7206`, only gated on there being cards: ~1,600
slots ⇒ ~6.8 M texels × (albedo fetch + sun/sky + 3-cascade shadow lookup +
Rgba16F write) ≈ 110+ MB traffic/frame. Sun never moves. Fix: dirty-gate on
(sun, sky, shadow) hash or relight 1/8 of rows round-robin. Expected: −1–2 ms.

**4. TSR + composite pay full 4K Rgba16Float bandwidth — 5.5 ms measured
tail.** History/output are 2× 3840×2160 Rgba16F (66 MB each,
`formats.rs:650-669`); composite reads 4K Rgba16F → writes 4K swapchain. On
~60 GB/s effective shared memory this is ~3.5–5 ms of pure bandwidth. Fix:
`Rg11b10Ufloat` history (renderable/filterable, halves the hottest traffic)
≈ −1–1.5 ms; the remainder is the price of 4K output (1440p output would cut
it further).

**5. SSGI stack: measured 1.65 ms for a previously-measured-invisible
result.** 2,040 probes × 64 SDF rays/frame + temporal + resolve + finding 3,
plus clipmap/WSRC re-bakes triggered by normal player movement. On this
outdoor sunlit scene the round-2 audit already measured near-zero visual
contribution. Fix: `setSsgiEnabled(false)` in the shooter on this GPU tier
(also stops the card/SDF feed), or halve probe rays and cap SDF steps.

**6. Skinned enemies take the immediate path: full CPU vertex re-transform +
~13 MB/frame re-upload.** `renderer/model_draw.rs:272-315`,
`mod.rs:9049-9056`: every vertex of every alive enemy + player copied,
tinted, pushed, and `write_buffer`'d every frame (~2–5 ms CPU at wave sizes),
then drawn bounds-less into all 3 cascades. GPU skinning + joint upload are
already correct; the bind-pose VB just isn't cached. Fix: cache skinned VB/IB
like static meshes, per-draw uniform carries {model, joint_offset} (the
material path already does this via `PerDrawUniforms.skin_info`). Also gives
per-enemy bounds → cullable in cascades.

**7. ~900–1,000 tiny `queue.write_buffer` calls per frame for per-draw
uniforms.** `model_draw.rs:31-35,86-90` (208 B × ~450 main) + probe writes
(finding 2). The pooled pattern already exists and is documented to have cut
scene_prepare 1.7 → 0.3 ms (`scene.rs:263-283`). Fix: same pooling + dynamic
offsets. Expected: −1.5–3 ms CPU.

**8. Grass: all 20 000 instances rasterized every frame with no distance
cap** (`material_system.rs:1766-1769`), twice (main + probe). 240 k tiny
triangles ⇒ poor quad occupancy on 8 CUs. Fix: build instances in concentric
rings and pick instance_count by camera distance; exclude from probe.
Expected: −0.5–1 ms.

**9. SDF-clipmap re-bake does 20–60 ms of CPU prep in one frame every ~10 m
of travel.** `gi_bake.rs:33-48` recenters, `scene.build_world_triangles()`
re-transforms ~300 k verts and bins ~300 k tris in a single frame — matches
the recurring 44–75 ms worst-frame spikes in the mode-1 log. Fix: cache world
triangles keyed on `tlas_version` (scene is static), amortize binning across
the 4 frames the GPU bake already takes. (Moot for this game if SSGI is
turned off per finding 5.)

**10. Inert / misc engine work.** Hi-Z occlusion culling runs every frame but
its only consumers are scene nodes, and the shooter's only scene nodes are
gi_only proxies that are never rasterized — the reduce+readback benefits zero
draws (`occlusion.rs:211-274`, `scene.rs:1194`). 267 gi_only proxies still pay
full uniform-build + upload + frustum/Hi-Z tests in prepare
(`scene.rs:1083-1134`). Lighting UBO (8.7 KB) uploaded 8–9×/frame
(`mod.rs:8708,10245,10271`). Bloom creates ~11 buffers + ~15–20 bind groups
per frame in the post stack (`postfx_chain.rs:66-141`). SSR (0.2 ms) has no
receivers in this scene — turn off in the shooter. Each small; together
~0.5–1 ms.

**11. Game-side main.ts is NOT the bottleneck** (~240 FFI calls/frame ≈
≤0.3 ms; no O(n²) at current scale; water/grass fully engine-side). Hygiene
only: 88 `drawModelRotated` + 176 fresh objects per frame for static trees
(hoist to startup arrays or scene nodes once the engine path supports it),
`playerPosition()` FFI ×6–7/frame (read once), HUD/diag string churn, ~15–20
constant color/vec3 objects rebuilt per frame.

**12. Content follow-ups (separate from engine work).** Terrain is 130 k tris
un-decimated for pure visuals (a heightmap already exists for gameplay);
dragoon is 14.9 k tris / 73 joints (6× the dretch); tree GLBs carry 3×1024²
textures for 880-tri models; `house.glb` (45 prims/45 materials) and
`calib_rig.glb` (20 k tris) are unused but shipped.

## Budget to 60 fps (16.7 ms)

GPU today ~22.5 ms. Findings 1+2+3+4+5+8+10 ≈ −8 to −12 ms ⇒ ~11–14.5 ms
GPU. CPU today ~10 ms; findings 6+7+10 ≈ −4 to −8 ms ⇒ ~4–6 ms, fully
overlapped. Locked 60 at 4K/TSR 0.5 is plausible; if it lands short, the
fallback lever is 1440p output (cuts the fixed 4K tail ~2× → ~3 ms).

## Suggested phases

- **Phase 1 — config wins, no engine changes (hours):** SSGI off + SSR off on
  this tier (−1.9 ms measured), game-side hygiene (finding 11). Expected
  ~33 → ~36 fps.
- **Phase 2 — shadow caster bounds + static-cascade cache (findings 1):**
  biggest single win, ~−4–5 ms. Expected ~36 → ~44 fps.
- **Phase 3 — probe culling/exclusions + card_light dirty-gate + uniform
  pooling + skinned VB cache (findings 2,3,6,7):** ~−3–5 ms GPU + big CPU
  cut. Expected → ~52–58 fps.
- **Phase 4 — TSR history format + grass rings + misc (findings 4,8,10):**
  the last ~2–3 ms to lock 60, else drop output to 1440p.
- **Content (parallel, optional):** decimate terrain to ~30 k tris, LOD or
  merge tree primitives, shrink tree textures to 512².

## Implementation results (2026-07-11, same day)

User approved: shadow fix + phases 3 + 4, with SSGI/SSR kept ON and no
machine-specific tuning. Landed in the engine (all general mechanisms):

1. **Cached whole-scene shadows** — per-cascade static depth textures
   re-rendered only when the cascade's VP or static-caster content
   signature changes; live cascades refresh by copy + dynamic
   (immediate-batch) casters drawn on top. Plus caster AABBs (cache-time
   local bounds × model matrix), per-cascade frustum culling, cascade
   re-fit slack (1.15× on cascades ≥ 1), immediate-batch segmentation
   with joint-derived AABBs for skinned models, and main-pass frustum
   culling for cached draws. Shadow pass GPU: **7.2 ms → 0.1–1.7 ms**.
   Key insight: frustum culling alone was weak (pancake columns
   legitimately keep most casters); the win is not re-rendering.
2. **Planar probe** — mirrored-frustum culling for pass B, batched
   per-draw uniform upload (one write instead of ~450), cached per-probe
   PerView bind group, GPU timestamps on both passes, and a general
   `setMaterialProbeVisible` material flag (new FFI; the shooter turns it
   off for grass — sub-pixel in a 512² probe). Probe CPU 1.34 ms → 47 µs;
   probe GPU now measured at ~0.2 ms total.
3. **card_light dirty-gate** — full-atlas GI-card relight now runs only
   when sun/sky/cascade-VPs/slot-count/card-content change (view matrix
   deliberately excluded — it only shifts cascade selection).
4. **Pooled cached-model uniforms** — one buffer + per-slot bind groups
   at 256 B offsets, single flush write per frame (was ~450 × 208 B
   write_buffer). Render CPU 4.5 → 2.2 ms, submit 2.5 → 1.4 ms.
5. **TAA history format** — audited: history alpha carries a
   reprojection blend weight, so Rg11b10 is NOT safe. No change; the 4K
   Rgba16F tail is the price of 4K output.

Measured (title screen, mailbox): **31.6 → 21.1 ms (31.7 → 47.3 fps)**.
GPU 22.5 → ~15.0 ms, CPU 10.1 → 4.2 ms. Gameplay: wave 0 ~32 → ~37.5 fps;
heavy wave-1 combat ~28-29 → ~33-34 fps. Visual verification: desktop
captures confirm correct player/tree shadows (stable over time) and
intact water reflections.

**Round 2 (same day):** grass tile culling landed (engine aeb3228 —
instance buffers tile + reorder at creation, dispatch culls merged
visible-tile ranges per view; material_pass GPU 2.23 → 1.36 ms, title
47.3 → 50.7 fps, no visual change) and skinned VB/IB caching landed
(engine 684a06f — skinned models are cached draws with GPU skinning
via a per-draw joint offset; shadow-dynamic with rigorous joint-union
bounds; heavy combat 33-34 → 35-36 fps, combat worst-frames
37-43 → ~31 ms; enemy pose/tint/position verified visually).

**Final round totals:** title screen 31.7 → 50.7 fps (31.6 → 19.7 ms;
GPU 22.5 → 14.1 ms), wave-0 gameplay ~32 → ~39-40 fps, heavy combat
~28-29 → 35-36 fps. Still open for a future round: wave-spawn frame
spikes (50-68 ms, likely SDF clipmap prep — finding 9), the 4K
TSR+composite tail (~5.4 ms, price of 4K output), main_hdr cutout
overdraw (~5.6 ms), and content work (130k-tri terrain, tree LODs).

## Reproducing the measurements

PERFTEST harness in `src/main.ts` (`PERFTEST=true`, `PERF_MODE` 0 or 1; mode 1
also needs `PERF_START_GAME=true` and disabling the `perfWindows === 23`
early-exit leftover). Compile `perry compile src/main.ts -o main
--debug-symbols`, run with stdout redirected (batch — the game takes the
screen). Logs from this audit: scratchpad `perf_mode0.log` / `perf_mode1.log`.


## Round 3 (2026-07-12) — the cache had silently stopped working

Re-measured after the AAA rounds landed (splat terrain, particles/decals, 7 enemy
kinds, cloud deck, foliage wind, 40k grass). Title screen was **33.5 fps**, down
from the 50.7 this document last recorded — and `shadow_pass` GPU was **6.9 ms**,
back to where it had been *before* the static-cascade cache was ever built.

**The cache was not slow. It was being defeated.** A cached, non-skinned caster
whose transform changed since last frame stayed in the STATIC set with a *changed*
content signature — which invalidates the cascade's cached depth. So every tree,
wall and terrain tile re-rendered into all three cascades, every frame, because
something small in the scene was moving.

Fixed in the engine as **EN-043**: a caster that moves is *dynamic*, by definition.
Movers now draw on top of the cached static depth instead of poisoning it.

| | before | after |
|---|---|---|
| `shadow_pass` GPU | 6954 µs | **182 µs** (38×) |
| title screen | 33.5 fps | **44.7 fps** |

**Where the time goes now** (title, 4K output / TSR 0.5):

| pass | GPU |
|---|---|
| `main_hdr_pass` | ~7.9 ms |
| `material_pass` | ~1.9 ms |
| `shadow_pass` | 0.18 ms |

Toggling shadows off still buys 5.3 ms even though the shadow *pass* is now 0.18 ms
— so that cost is PCF **sampling** in the fragment shaders, not map rendering. That
is the next thing to look at, along with `main_hdr_pass`, which is now the single
dominant pass.

One measurement worth keeping in mind: before the fix, `rs0.25` ran no faster than
`rs0.5`. The frame was not fragment-bound at render resolution at all — it was
bound on fixed-rate work (the shadow re-render), which is exactly what EN-043 turned
out to be.

**A warning, twice earned.** Two "wins" this round were correctness losses in
disguise, and both announced themselves the same way: *the number improved more than
the change could justify*. Enabling swaying shadow casters measured 34 → 40 fps
because it had silently deleted every shadow (EN-042). The first cut of EN-043
measured 42 fps because a key collision made all 88 trees dynamic and dropped every
shadow again. **On this renderer, always confirm a shadow/perf win with a
screenshot.**


### Round 3, part 2 — the forest was the whole frame

With the shadow cache fixed (EN-043) the title sat at 44.7 fps. Bisecting by simply
not drawing the forest was decisive:

| | with forest | forest off |
|---|---|---|
| `main_hdr_pass` GPU | 7.4 ms | **1.8 ms** |
| title screen | 46.7 fps | **60.0 (vsync cap)** |

**88 trees were the entire remaining frame.** And not for the reason you would
guess: they are only **880 triangles each** (77k total — nothing), and `rs0.25`
(a *quarter* of the pixels) ran no faster than `rs0.5`. It was neither geometry
volume nor plain pixel count. It was **overdraw that could not be rejected**: the
scene shader can `discard` for alpha-cutout leaves, and a discarding shader cannot
early-Z write, so every overlapping leaf card shaded the full 5-target MRT and threw
it away.

Two fixes, in order of cost:

1. **Draw the forest front-to-back** (game side, ~20 lines). A discarding shader
   still early-Z *tests*, so the near trees' depth rejects the far ones' leaves —
   but only if the near trees are drawn first. In world order, that never happened.
   **main_hdr 7.43 → 6.11 ms, title 46.7 → 49.9 fps.**
2. **Depth prepass** (engine EN-044). Prime depth, then draw with depth writes OFF
   so the hardware can early-Z reject. **main_hdr → 2.14 ms, title → 56.6 fps.**

## Round 3 totals

| | before | after |
|---|---|---|
| `shadow_pass` GPU | 6954 µs | **142 µs** |
| `main_hdr_pass` GPU | 7430 µs | **2144 µs** |
| title screen | **33.5 fps** | **56.6 fps** |
| gameplay | ~33 fps | ~40 fps |

Remaining, for a future round: `material_pass` (1.9 ms — terrain/grass/water), and
the fixed 4K output tail (TSR + composite), which is why `rs0.25` buys nothing.
