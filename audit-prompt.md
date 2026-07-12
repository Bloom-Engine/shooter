# Prompt: Visual/Engine Audit — Round 2

Copy everything below into a fresh Claude Code session started in
`C:\Users\Ralph\projects\bloom\shooter`.

---

Run a full second-round audit of this game plus the Bloom engine it runs on
(`../engine`, same checkout level). The goal is unchanged: **Unreal-engine-level
graphics with raylib/unity3d simplicity**. Round 1 landed and is fully merged —
audit the game as it exists on `main` today with fresh eyes, and produce a
ranked plan for the next round of quality work. Do not start implementing
until I approve the plan.

## What round 1 already fixed (don't re-discover it)

Everything below is merged: engine `main` @ `f8614c6`, shooter `main` @
`af98dbe`. Details in the merge commits, `docs/visual-quality.md`,
`docs/tickets.md`, and auto-memory.

- Root causes: black-stone albedo (png.ts hash2 sign bug), TAA silently
  rendering at half res (now TSR by choice), bloom uniform aliasing, Hi-Z
  linearize sign bug (GTAO was inert for months), shadows-disabled darkening.
- Shading: foliage two-sided + wrap lighting, normal-offset shadow receiver
  bias everywhere, IBL sky-fill in all custom materials, sun-direction
  convention normalized (TO-sun).
- Fullscreen: borderless native 4K (3840×2160 physical / 2560×1440 logical —
  the dev monitor is 4K at 150% scaling), TSR 0.5 → 1920×1080 internal,
  ~45 fps measured on the title screen. Screen-space GI stack now runs at
  render resolution; 2048² shadow cascades.
- World shadows: material-system draws cast into the sun cascades; terrain/
  building/tree materials receive via `sample_sun_shadow_n` (slope-adaptive
  normal offset). Cascade pancake bounds include the static world (was the
  cause of shadows flickering in/out).
- GI: ~267 `gi_only` proxy scene-nodes feed BLAS/TLAS/mesh cards/SDF so SSGI
  has off-screen geometry.
- Gameplay polish: title screen + menu music, per-kind enemy death animations,
  opaque texture-alpha fix (player was see-through via its gloss mask).

## Where to focus (known open leads + unverified areas)

Verify and rank these, and find what we haven't seen:

1. **Gameplay-load performance.** Nearly all measurements were taken on the
   title screen. Profile real waves (19 enemies, projectiles, sparks) at 4K —
   fps, per-pass GPU µs, CPU. The engine profiler exists: `setProfilerEnabled`
   + `getProfilerOverlay` (F3 in-game), or dump `profiler.snapshot()` to
   stderr from `Engine::begin_frame` temporarily.
2. **Remaining 4K frame cost.** final_composite ~3.8 ms and TAA/TSR ~2.6 ms at
   output res, plus ~8–10 ms per frame not covered by pass timestamps (DWM
   composition / submit gaps / passes without GPU timestamps — planar
   reflections, froxel, postfx-tail members). Locked 60 needs a plan, or an
   explicit decision to ship 45.
3. **In-motion quality.** TSR shimmer on shadow edges and thin grass at 0.5
   scale; shadow stability while moving (the flicker fix is verified by
   mechanism, lightly verified by play); death anims + menu transition by
   playtest.
4. **Carry-over visual leads:** distant/backlit perimeter treeline reads pale
   (mip alpha + IBL on cards); flat grey boundary-wall gizmo boxes exposed
   against the terrain skirt; water still milky at grazing angles; metal
   SSR + IBL specular double-count on hit; EN-012 material-ABI foliage model.
5. **SSGI payoff.** The GI proxies feed the stack, but nobody has measured
   actual bounce contribution in-game (e.g. green bounce at the building
   base, wall bounce on shaded ground). Quantify with region luma; decide if
   probe counts/intensity need tuning to be visible.
6. **2D/HUD:** `measureText` under-reports at large sizes (title centering
   uses a hand estimate); audit the 2D text metrics path at DPI ≠ 1.
7. **Content gap to "Unreal level":** the biggest remaining deltas are likely
   content-side — placeholder cube weapon, low-poly tree silhouettes, single
   building, texture-less terrain material. Say so honestly and separate
   engine work from content work in the plan.

## Method requirements

- Objective evidence for every finding: screenshots + region-luma
  measurements (System.Drawing GetPixel), profiler numbers, or stderr probes.
  Before/after for any fix you propose to validate later.
- Capture correctly on this box: `tools/shot.ps1` (geisterhand, port 7676) is
  DPI-virtualized — it returns a **2560×1440 top-left crop of the 4K screen**.
  For full-frame grabs use a fresh PowerShell that calls
  `SetProcessDpiAwarenessContext(PMv2)` then `CopyFromScreen` (pattern in
  auto-memory). The game steals the whole screen when it runs — batch your
  runs, the user may be using the machine.
- Build flow: engine `cargo build --release --manifest-path
  ..\engine\native\windows\Cargo.toml` with `INTERPROCEDURAL_OPTIMIZATION=OFF`
  (~10 s incremental), then **always** `perry compile src/main.ts -o main`
  from the shooter (it statically links the engine; it skips relinking if
  `main.ts` is untouched — touch it after engine-only changes, and clear
  `.perry-cache` after `package.json` manifest changes). `npm run dev` for
  the full world+compile+run loop.
- Read `CLAUDE.md`, `docs/perry-quirks.md`, and `docs/engine-notes.md` before
  proposing refactors — Perry 0.5.x breaks on patterns that look like
  perfectly good TypeScript.

## Deliverable

A written audit: findings ranked by (visual impact × implementation effort),
each with its evidence, then a phased plan — quick wins first, engine
projects second, content work flagged separately. Stop after the plan and
wait for approval.
