# Round-2 Audit — Bloom Shooter + Engine (2026-07-04)

Second full audit of the shooter (`main` @ af98dbe) and engine (`main` @
f8614c6) after the round-1 merge. Goal unchanged: **Unreal-level graphics
with raylib/Unity simplicity.**

Method: five parallel code investigations (frame-cost/profiler coverage, 2D
text, water+SSR specular, GI stack, foliage/cutout distance quality) plus a
**scripted self-driving measurement build** (temporary `AUDIT` block in
main.ts, reverted; copy kept in the session scratchpad as
`audit2/main.audit-tour.ts`) that ran staged camera poses, an SSGI A/B,
water fog/foam A/Bs, pool-max combat, and a feature-cost ladder at native
4K fullscreen, captured externally with PMv2 DPI-aware full-frame grabs.

Evidence: `tools/.testout/audit2/` — 4K frames (`gi_on/gi_off`,
`water_nofog/water_nofoam`, `treeline_backlit`, `combat_profiler`,
`combat_noprof`, `ladder_ssroff`, `title_4k`, `crash_dialog`) + profiler
stdout logs. Region-luma numbers below were measured on those exact files
(System.Drawing LockBits mean over stated rects).

Hardware context (matters for every number here): **AMD Radeon 760M** —
8-CU RDNA3 *integrated* GPU, shared DRAM. This is a modest iGPU, not a
dGPU. 31–45 fps at 3840×2160 output with a full deferred + GI stack is
already a strong result on this silicon; "locked 4K60" is not a realistic
target on this box (see Decision D1).

---

## Status addendum (2026-07-06)

The plan below was executed as PRs: engine **#75** (profiler stale
averages + eviction), **#76** (2D gamma + sharpen), **#77** (transient
depth leak — the F7 "translucent mystery", 16–26× improvement), **#78**
(EN-021 SSR/IBL ownership), **#79** (EN-023 GI data path, partial),
**#80** (present-mode FFI), **#81** (2D text at physical resolution),
**#82** (EN-022 material motion vectors); shooter **#2** (water/tree/
fog/title), **#3** (waves/camera/water bounds), **#4** (material
velocity). All open against their mains; local `round2/integration`
branches carry the merged set.

**Finding F1 (the AV) is root-caused and fixed** — and the audit's
toggle correlation was a red herring. The real trigger was per-frame
profiler *string parsing*: Perry 0.5.x `split()`/`parseFloat()` read
past their own slice allocations (EN-020). With the overlay as a rate
amplifier it reproduced 6/6 in 7–29 s; the fix (numeric profiler ABI +
padded engine strings + in-engine crash reporting) validated 3/3 × 90 s
clean. Full story: engine `docs/tickets.md` § EN-020 and
`docs/crash-triage-windows.md`; quirk write-up in
`docs/perry-quirks.md` § 5.

Decisions D1 (operating point), D2 (GI strategy on SW adapters), D3
(content budget) remain open — they are the user's call.

## Headline results

1. **The game AVs (access violation) under runtime feature toggling** —
   three crashes in three scripted runs, all `main.exe+0xe8e5`, read of
   `0x…FFF8` (page-boundary read → buffer overrun/use-after-free class).
   Each crash followed a *pipeline-scale* runtime toggle by 0.4–6 s:
   `setSsgiEnabled(false)` (run 1), `setProfilerEnabled(false)` (run 2),
   `setShadowsEnabled(false)` (run 3). SSR/SSAO/bloom toggles survived
   repeatedly. Never seen before because nothing ever toggled features at
   runtime. Any future settings menu hits this. Evidence:
   `crash_dialog.png`, Windows Application log Id 1000 ×3, run logs.

2. **SSGI contributes ~nothing visible in the shipped config** (the round-1
   GI-proxy investment currently has no visual payoff on this machine).
   Measured at a fixed pose, SSGI on→off (settled, ship config):
   shaded building wall Δ −0.7 % (= noise; sky control drifted −0.5 %),
   shaded ground −2.1 %, sunlit grass −2.6 %, and **G/R ratio at the wall
   base identical to 4 decimal places (0.9463)** → zero colored bounce.
   Root cause chain (verified in code + the live profiler pass list):
   this box runs **`probe_trace_sdf_pass`** — the HW ray-query tier never
   engages (never logged, silently falls back;
   `native/windows/src/lib.rs:449-474`), the SDF path's mesh-card lookup
   compares world-space hits against **object-space** AABBs so every
   transformed proxy degrades to flat gray 0.55 albedo
   (`shaders/ssgi.rs:914-956, 996-1010`), and the software world-radiance
   cache bake is **pure analytic sun+sky, no geometry**
   (`gi.rs:329-455`). The ~267 gi_only proxies feed a pipeline whose
   colored output can't reach the screen on SW adapters. Cost of the probe
   stack in combat: ~1.2–1.9 ms GPU.

3. **The water grazing-angle calibration was lost in the round-1 merge**
   (regression). `assets/materials/water.wgsl:145-146` is back to uncapped
   Schlick (`0.02 + 0.98·pow(1-cosθ,5)`); the June fix (cap 0.70 + horizon
   dim) is in neither the file nor the inline fallback. Measured: the river
   at grazing reads **L≈113–120 — 16–23 % brighter than the sky above the
   horizon (L≈97.5)** and ~24 % above adjacent grass; an over-unity
   "milk stripe". A/B isolation: foam-off −5.5 %, fog-off ≈ 0 → the
   dominant term is Fresnel→1 × the pale GGX-prefiltered horizon mip
   (`sample_env(r, lod 2.0)`). Also found: `screen_uv` is perspective-
   divided per-vertex then linearly interpolated (wrong at grazing;
   water.wgsl:74) and the inline fallback shader in main.ts has drifted
   (older UBO layout — if it ever engages, params land on wrong fields).

4. **Backlit treeline paleness is real, quantified, and is NOT the round-1
   hypothesis.** There is no cutout treeline anymore (prop_tree/tuft path
   is dead code; the perimeter is solid Kenney trees through `tree.wgsl`).
   Measured on `treeline_backlit.png`: backlit canopies **L=126 vs the
   sunlit hills behind them L=93 (+35 %)** — silhouettes render *brighter*
   than their background. Verified chain: `tree.wgsl:105-109` backlit
   crowns get sky-fill only (no transmission term, leaf shadow floored at
   50 %, and the sun's 1.1× intensity `sun_dir.w` is dropped) → sun-shaft
   compose adds a warm veil up to ~+0.14 HDR on sunward silhouettes at
   strength 0.4/decay 0.96 (`post.rs:646-670`) → TSR's luma-only history
   clamp retains sky *chroma* on thin features + a hardcoded 0.8 sharpen
   halo (no FFI setter; `mod.rs:5923`). Fog is measurably innocent
   (≤0.0002 % at canopy height). Bonus engine bug found: the cutout
   transmission block in `fs_main_scene` is **pasted twice**
   (`core.rs:852-864`) — unshadowed, 1.7× strength; dormant today, will
   blow out any future MASK foliage.

5. **Real combat load costs ~6 fps vs title.** At pool-max load (10
   skinned enemies + projectiles + sparks, worst case the code can
   produce): **34 fps clean / 31 fps with profiler** vs ~40 title.
   GPU pass sum ~13.8 ms: TAA 3.15, main_hdr 2.45, composite 2.45,
   shadows 2.22, SSAO 0.73, probe stack ~1.6, bloom 0.46, SSR 0.19.
   No single feature is a silver bullet — the ladder's per-feature fps
   deltas sat within noise; the cost is spread across TAA+composite
   (output-res at 4K) and the skinned-geometry passes.
   **Shipped waves never show more than 2 enemies at once** (each wave is
   a single kind × BODIES_PER_KIND=2 pool slots) — the "19 enemies" plan
   is 19 *total*, max 2 concurrent. Gameplay reads emptier than intended
   and the shipped perf load is far below what the engine handles.

6. **Two significant profiler/measurement traps** (now facts, were
   unknowns): (a) enabling the profiler inserts a **blocking GPU sync every
   frame** (`profiler.frame_end`: map_async + `device.poll(Wait)`,
   engine.rs:195) — all round-1 fps readings taken with F3 open were
   pessimistic (~3 fps at combat load, more when GPU-bound); (b) the
   overlay's rolling averages **freeze stale values for passes that stop
   running** — a disabled feature's row keeps showing its old cost.
   Also: `post_fx` CPU bracket has no matching begin (dead), scene_compose
   is deliberately untimestamped, `MAX_GPU_PAIRS=32` is nearly exhausted
   (28 used), and `getFPS()` returns 0 on the title screen for many
   seconds.

7. **2D/HUD: `measureText` is exact in the current build** — verified to
   the disassembly level (measure ≡ draw advance; `0.6001·size·len` for
   the embedded Courier New). The visible title off-centering is caused by
   the **hand-tuned 0.58 workaround itself** (main.ts:2101-2110; ~11 px
   right at 4K). Real 2D issues: glyphs rasterize at *logical* 2560×1440
   then stretch ×1.5 bilinear (soft HUD at 4K), 2D vertex colors are
   double-sRGB-encoded (washed bright), and the glyph atlas silently
   wraps UVs when full (Repeat sampler, no eviction).

8. **Frame-cost structure at 4K** (title, render 1920×1080 → output 4K):
   GPU pass sum ~11.1 ms of a ~25 ms frame. The unaccounted remainder is
   now explained by a *list*, not one villain: profiler serialization
   (only while measuring), untimestamped passes (scene_compose with 16-step
   fog march + 32-tap sun-shaft march, SSR temporal, SSAO blur, 2D pass at
   4K, water snapshot copies), FIFO present + `desired_maximum_frame_latency
   2` (present mode hardcoded; `setTargetFPS` is inert under vsync), iGPU
   shared-bandwidth contention, and a **new mystery: `translucent_pass`
   CPU grows 0.4 ms (title) → 2.8–4.7 ms (building pose) → 6.4–6.7 ms
   (combat)** while the water draw is constant — top CPU line in gameplay
   frames, unexplained, worth ~15–20 % of the frame.

9. **Stale/closed leads:** the "grey boundary-wall gizmo boxes" no longer
   exist (all 43 box entities are category-1 → baked into the building
   mesh; nothing draws them — verified in code and captures). SSR+IBL
   double-count is real but confined to **metals at roughness ≈0.05–0.85
   on `fs_main_scene`** — in this game that's only the aliens/weapon per
   their glTF factors; the world's custom materials are unaffected. The
   authored river zig-zags (6 segments, cz 11↔13) while the game draws one
   straight 80×5 plane — bank mismatch at the edges.

10. **New gameplay-visual issue:** when the mob surrounds the player, the
    orbit camera's collision shortening puts the camera *inside* enemy
    volumes — near-plane clipping fills the screen with polygon soup
    (`combat_profiler.png`). Happens in real play whenever cornered.

---

## Ranked findings (visual impact × effort)

| # | Finding | Impact | Effort | Evidence |
|---|---|---|---|---|
| F1 | AV on runtime disable of shadows/SSGI/profiler (teardown UAF class) | Blocker for settings/robustness; blocks future A/B tooling | M (debug session; repro exists) | 3× WER events, crash_dialog.png |
| F2 | Water grazing regression (lost cap) — river brighter than sky | High — hero element reads broken | **S** (shader edit, hot-reloadable) | water_* PNGs + luma table |
| F3 | Backlit treeline +35 % over background (no transmission, shaft veil, sharpen halo) | High — every screenshot shows it | **S–M** (tree.wgsl + one param + engine dup-block delete) | treeline_backlit.png + luma |
| F4 | SSGI invisible on SW path (gray cards, analytic WSRC, silent HW fallback) | High strategic — round-1 investment inert; ~1.6 ms GPU spent | M–L (engine) or **S** (reallocate) | GI A/B luma, pass list |
| F5 | HUD soft + double-sRGB + title workaround; measureText exact | Med — polish visible at 4K | S (game) + S–M (engine text) | disasm + code refs |
| F6 | Operating point: 34 fps combat on 760M iGPU at 4K; FIFO hardcoded, no cap that works | High decision | Decision + S | combat_noprof.png |
| F7 | translucent_pass CPU mystery (0.4→6.7 ms with load) | Med-high perf | M (investigate) | run1/run3 tables |
| F8 | Material-world velocity=0 → TSR shimmer/ghost under motion, motion clamp never engages | Med-high in-motion quality | M (engine + shaders) | code (tree/grass wgsl:114/155, post.rs:870) |
| F9 | Profiler hygiene: per-frame sync, stale averages, dead bracket, pair budget, getFPS=0 | Med (trust in all future measurement) | S | run logs |
| F10 | SSR+IBL double-count (metals only here) + SSR miss=black inconsistency | Low-med visual, correctness | S–M | code refs |
| F11 | Waves cap at 2 concurrent enemies; river plane vs authored zig-zag; camera-in-mob soup | Med gameplay feel | S / S / M | world.ts, captures |
| F12 | Content gap (terrain textures, grass shape, tree/leaf quality, weapon cubes, plaster box building) | **Largest single lever toward "Unreal look"** | content track | all captures |

---

## Phased plan (proposed — awaiting approval)

### Phase 0 — Stability + measurement trust (~1–2 days, engine)
Gate for everything else; every later fix gets validated by re-running the
audit tour, which currently crashes the game.
1. Build engine lib with debug symbols, repro F1 with the preserved tour
   (`audit2/main.audit-tour.ts`), fix the teardown UAF(s) behind
   `setShadowsEnabled(false)` / `setSsgiEnabled(false)` /
   `setProfilerEnabled(false)`. Acceptance: full 3-toggle tour ×3 runs, no AV.
2. Profiler hygiene batch: decay/clear stale rolling averages on disable;
   remove dead `post_fx` end; timestamp scene_compose (or split it);
   log the GI trace backend + a one-line adapter/features print at boot;
   fix title-screen `getFPS()=0`.
3. Optional (cheap while in there): make the per-frame profiler sync
   opt-in (`snapshot` on demand) so measuring stops distorting.

### Phase 1 — Visual quick wins (~2–4 days, mostly game-side shaders, all A/B-able with the tour + luma rects)
1. **Water re-calibration** (F2): re-land Fresnel cap ~0.6–0.7 **plus**
   horizon-avoidance on the env sample (`r.y = max(r.y, 0.06)` or luma
   clamp), add view-angle foam fade; fix per-vertex `screen_uv` →
   per-fragment; delete or regenerate the drifted inline fallback (SH-005).
   Acceptance: far-water luma ≤ sky−10 % at the S4 pose; teal saturation
   returns; predicted −30–50 % stripe luma.
2. **Treeline/backlit fix** (F3): grass-style transmission term in
   tree.wgsl leaves, multiply direct by `sun_dir.w`, deepen leaf shadow
   floor with distance; sun shafts 0.4 → ~0.15–0.2 (or decay 0.96→0.85).
   Engine: delete the duplicated cutout transmission block
   (core.rs:857-864) and shadow the survivor. Acceptance: backlit canopy
   luma ≤ background hills at the S5B pose.
3. **HUD**: delete the 0.58 title estimate (use measureText); 2D gamma fix
   (sRGB-decode vertex colors); [engine-small] rasterize glyphs at
   physical scale for crisp 4K text.
4. **SSGI decision follow-through** (see D2): short-term on this box,
   either `setSsgiIntensity(≈2)` after verifying it scales (cheap
   visibility test) or disable SSGI and bank ~1.6 ms; long-term per D2.
5. Close stale leads in docs/tickets (boundary boxes; measureText myth).

### Phase 2 — Engine projects (ordered, ~0.5–1.5 weeks each)
1. **Material-path velocity** (F8): prev-frame model matrix per material
   draw → real motion vectors for the whole world; unlocks TSR motion
   clamp + fixes sway ghosting. Biggest in-motion quality item.
2. **translucent_pass CPU investigation** (F7): bracket-split snapshot
   copies / bind-group rebuild / impulse pass; fix the scaling term.
   Likely double-digit % CPU frame win in combat.
3. **GI on SW adapters** (D2 path A): fix SDF card lookup transform bug,
   make SW WSRC sample cards (or at least sun-shadowed colored ground
   bounce), log backend; acceptance = the same GI A/B shows a hue shift at
   the wall base (G/R moves) and ≥8–10 % luma in shaded receivers.
4. **SSR/IBL exclusive-ownership crossfade + env-miss fallback** (F10).
5. **Present/pacing options** (F6): Mailbox/Immediate FFI, working fps cap
   under vsync-off, expose composite sharpen strength; consider half-res
   composite/CA tap reduction at 4K.
6. **2D text at physical resolution + atlas eviction/clamp sampler** (F5).

### Phase 3 — Content track (parallel, flagged separately — this is the biggest lever toward the goal)
Existing tickets confirmed as the right moves, in order: **SH-009**
splat-mapped PBR terrain (single largest look upgrade; the ground is
texture-less at every scale), SH-010 detail normals, **SH-016** GGX sun
glint (pairs with the F2 recalibration), SH-002 scrolling water normal map,
SH-020/EN-010 leaf-card trees (kills the "smooth blob" canopies), SH-011
density-ring grass + blade-shape/tint pass (current blades read as sparse
cones near-field — see any capture), weapon viewmodel model (cubes today),
building texture/trim pass (flat plaster box), terrain-skirt seam polish.
New content items from this audit: wave design (mix kinds per wave or raise
BODIES_PER_KIND so >2 enemies are concurrent), river plane vs authored
zig-zag reconciliation, mob-camera handling (fade/limit instead of
clipping through enemies).

### Decisions needed (blocking parts of the plan)
- **D1 — Operating point on the 760M:** ship 4K/TSR0.5 at ~40 (uncapped,
  current) vs target 1440p output (likely 50–60, sharper per-pixel cost
  ratio) vs enable the existing DRS. Recommendation: test 1440p output for
  one session (one-line window change); pick by eye.
- **D2 — GI strategy on iGPU:** (A) invest in the SW path (Phase 2.3) so
  bounce is visible on this class of hardware; (B) accept SSGI-as-subtle-AO
  on iGPU, reallocate its ~1.6 ms, and treat colored bounce as a
  dGPU/HW-RT feature (validate HW tier on a dGPU box when available).
  Recommendation: B short-term, A as the durable engine investment.
- **D3 — Content sourcing:** how much budget for CC0 texture/model packs
  vs procedural generation for Phase 3.

---

## Appendix: key numbers

| Measurement | Value |
|---|---|
| Title fps (profiler on / historical clean) | 39–40 / ~45 |
| Combat fps (10 enemies; clean / profiler) | **34 / 31** |
| Title GPU pass sum | ~11.1 ms (TAA 2.62, composite 2.62, material 2.10, shadows 1.14, hdr 0.95, SSAO 0.61, bloom 0.42) |
| Combat GPU pass sum | ~13.8 ms (TAA 3.15, hdr 2.45, composite 2.45, shadows 2.22, probes ~1.6, SSAO 0.73) |
| SSGI on→off, shaded wall / ground / sky control | −0.7 % / −2.1 % / −0.5 % (noise floor); G/R unchanged (0.9463) |
| Water stripe vs sky vs grass (grazing) | 113–120 vs 97.5 vs 91.5 (water ≫ sky) |
| Water foam-off / fog-off delta | −5.5 % / ≈0 |
| Backlit canopy vs hills behind | 126.2 vs 93.3 (+35 %) |
| translucent_pass CPU (title → building pose → combat) | 0.4 → 2.8–4.7 → 6.4–6.7 ms |
| Crashes | 3/3 runs, main.exe+0xe8e5, after shadows/ssgi/profiler off |
