# CLAUDE.md — Bloom Shooter

Notes for AI coding assistants working on this repo.

## Quick orientation

The full picture is in `README.md`. This is a Perry-compiled TypeScript
**third-person shooter** (over-the-shoulder orbit camera — TPS, not
FPS) built on the Bloom engine. Seven alien kinds (two RANGED), three
waves, four weapons, TWO playable arenas (`arena_02` Outdoor Plaza and
`arena_03` Riverbend Ravine — see SH-040; a third is still owed),
textured arena, skeletal-animated enemies, ambient music, and a live 3D
soundscape (river/wind emitters + creature locomotion on EN-062 voices —
see SH-052) — runnable with
`perry compile src/main.ts -o main && ./main`.

## Where things live

- `src/main.ts` — the boot sequence + frame loop and their wiring
  (~2,100 lines; the SH-025 module split is complete). Flat-array
  state per Perry convention. The dormant test harnesses
  (SELFTEST/AITEST/ANIMDBG/MENUTEST/FACETEST/LOCOPROBE/KEYPROBE/
  COMBATSHOT/PERFTEST) and the
  diagnostics (diag bar, profiler overlay) live here too.
- The game is split by subsystem, one module each: `enemies.ts`
  (kind tables + pool), `director.ts` (waves + per-kind AI + enemy
  projectiles), `combat.ts` (weapons/fire/player projectiles/pickups),
  `camera.ts` (orbit + canopy occlusion), `hud.ts`, `environment.ts`
  (water/grass/building/glass/GI proxies), `gamestate.ts` (shared run
  scalars as `const GS`), plus `feel/vfx/weapons/menu/settings/score/
  audio-mix/boot/terrain`. Module headers state the Perry rules each
  follows — read one before adding cross-module state; a green
  compile does NOT prove cross-module references resolve (they fail
  at runtime, one ReferenceError at a time).
- Shaders load from `assets/materials/*.wgsl` at runtime (SH-005 is
  done — there are no inline WGSL copies to keep in sync any more).
- `src/input.ts` / `src/player.ts` / `src/world-runtime.ts` — small
  single-purpose modules.
- `assets/worlds/*.world.json` — authored level data using the engine's
  standard world schema (`engine/src/world/types.ts`). The editor at
  `../editor/` round-trips these files unmodified.
- `tools/` — offline converters + glTF diagnostics. Run with `bun`.
- `assets/models/` — committed GLBs. Regenerate via
  `bun tools/convert-aliens-anim.ts` (skinned aliens + player) and
  `bun tools/build-props.ts` (trees/props).

## Read before changing things

- **`docs/perry-quirks.md`** — five Perry 0.5.x bugs we work around.
  Never add `throw new Error(...)`, never rely on object-shorthand
  return values, never `JSON.parse(...).arr.length`, and **never
  `split()`/`parseFloat()` an FFI string on a per-frame path** (quirk
  #5 / EN-020 — the runtime overreads its own slice allocations; this
  crashed the shipped game). Use flat arrays, explicit keys, and
  numeric FFIs. A well-meaning refactor can silently crash this on
  startup if these rules are forgotten.
- **`docs/engine-notes.md`** — the macOS Jolt/`libc++` link
  requirements are landed in the engine repo now; the doc records why
  they exist.
- **`docs/asset-pipeline.md`** — the IQE → glTF conversion notes,
  especially the Z-up → Y-up rotation scheme. The naive
  "conjugate every joint" approach doesn't work; only the root joint
  gets X90-prefixed (vertices + root rest pose + root animation
  keyframes).
- **`docs/engine-issue-green-gbuffer.md`** — historical bug post-
  mortem. Already fixed in the engine (`0137335`) — kept as a
  reference for the debugging approach.

## Build commands

```
npm run dev                            # compile + run (world loads at runtime)
npm run build                          # compile only
npm run assets                         # rebuild props + terrain visual mesh
perry compile src/main.ts -o main      # raw compile
./main                                  # play
bun tools/convert-aliens-anim.ts       # regenerate animated alien GLBs
bun tools/validate-glb.ts <path>       # glTF-validator report
bun tools/fetch-external-textures.ts   # re-download the CC0 photoscan sources
bun tools/build-terrain-textures.ts    # rebuild the 4 terrain splat layers
bun tools/build-building-textures.ts   # rebuild the building wall/slab slices
./tools/deploy-ios.sh                  # build + sign + install + launch on iPhone
./tools/deploy-ios.sh --console        # ...and stream the device's stdout/stderr
```

### iOS

`tools/deploy-ios.sh` is the whole loop. Set `BLOOM_IOS_DEVICE` to target a
different device (`xcrun devicectl list devices` for the id).

Four things about this target are load-bearing and non-obvious:

- **`--features ios-game-loop` is mandatory.** UIKit wants
  `UIApplicationMain()` to own the main thread forever; the game loop wants it
  too. The feature makes Perry run the game on a spawned thread instead.
  Without it the app links, installs, launches — and never shows a window.
- **Perry's own signing step fails** on the extended attributes macOS leaves on
  the asset files (`resource fork, Finder information, or similar detritus not
  allowed`), so the script does `xattr -cr` and codesigns itself.
- **The screen is reported in pixels, not points** (engine EN-024). Every
  hardcoded HUD offset would come out a third of its intended size on a 3x
  phone, so `main.ts` lays the HUD out in a ~1000-unit logical space and scales
  the whole 2D pass through `beginMode2DRaw`'s zoom. The touch controls are
  drawn *outside* that camera, in raw pixels, because they have to land on
  exactly the coordinates `input.ts` hit-tests.
- **Touch slots are sparse.** Scan `0..getMaxTouchPoints()` and skip slots
  `isTouchActive(i)` rejects — never `0..getTouchCount()`, which reads a
  released slot's stale coordinates as a live finger and leaves the player
  walking after the thumb is gone.

Signing material: profile at `~/.perry/com_bloomengine_shooter_dev.mobileprovision`
(mint with `perry setup ios --development`), entitlements in `ent.plist`, team
`K6UW5YV9F7`. The provisioning profile is *not* a wildcard — a new bundle id
needs a new profile.

The mobile render profile (`MOBILE` branch in `main.ts`) drops SSGI, SSR, GTAO
and sun shafts and keeps shadows + bloom. That lands ~50 fps on an iPhone 16
Pro. Lumen SW-GI is the one that must stay off: it re-bakes an SDF clipmap as
the view moves, and the phone has no headroom to absorb the stall.

### Windows specifics (the current dev box)

- `npm` may not be on the PowerShell PATH — run the tools directly
  with `bun` (e.g. `bun tools/build-terrain.ts`) and compile with
  `perry` as below.
- Compile with `perry compile src/main.ts -o main --debug-symbols` so
  `main.pdb` lands next to the exe — crash reports then symbolize.
- Engine rebuild:
  `cargo build --release --manifest-path ..\engine\native\windows\Cargo.toml`
  with `INTERPROCEDURAL_OPTIMIZATION=OFF` in the environment. After an
  engine-only rebuild, **touch `src/main.ts`** or perry skips the
  relink; after any engine `package.json` manifest change, also delete
  `node_modules/.cache/perry/` — that is where Perry's object cache
  actually lives (`.perry-cache/` is a stale name; deleting it does
  nothing, which faked a stale-build conclusion on 2026-07-16).
- Crashes self-report: the engine prints
  `bloom: FATAL unhandled exception … (main.exe+0x…)` to stderr and
  writes a minidump to `tools/.testout/dumps/` (WER LocalDumps is armed
  there too). Triage runbook: engine `docs/crash-triage-windows.md`.
- The game runs borderless-fullscreen at native res — test runs are
  batch runs (launch with stdout/stderr redirected; the screen is
  gone while it runs).

## World pipeline

**The world is loaded at runtime.** `src/world-runtime.ts` reads
`assets/worlds/arena_02.world.json` at startup via the engine's
`loadWorld`, and exposes it as the flat number arrays the game loop
consumes. There is no `src/generated/` any more, and no bake step:
edit a level in the Bloom editor, relaunch, and it is there.

(The old `tools/build-world.ts` baker existed because Perry 0.4.x
returned arrays from `JSON.parse` whose `.length` read as undefined.
That is fixed — verified on 0.5.1208 — so the workaround is gone. The
two Perry rules that still bind: build arrays with `new Array(n)` +
index assignment, never `.push()`; and parse strings at load, never on
a per-frame path.)

What lives in the world file:

- **Engine concepts, first-class**: `environment` (sky/sun/ambient/fog),
  `lights` (schema v2 — point lights are engine-universal, so they are
  not `userData`), `water`, `rivers`, `terrain` (the authored
  heightmap *and* its splat `layers`: physics, enemy ground-following,
  the scatters and now the ground textures all read it directly).
- **Game concepts, in `userData.kind`**: `player_spawn`, `collider_box`,
  `static_mesh` (optional box collider + tag-driven paint category),
  `prop_tree` (the forest — 88 real entities, each movable), 
  `enemy_spawner`, `weapon_pickup`, `wave_config`. A spawner means
  nothing without this game, so it stays game-defined; the editor
  round-trips it as opaque key/values.

Adding a new kind = bucket it in `src/world-runtime.ts` and consume the
array in `main.ts`. Nothing to regenerate.

**Terrain painting.** `terrain.layers` is a splat map: layer i's `weights`
(one per grid cell) become channel i of an RGBA8 texture, and `terrain.wgsl`
mixes it OVER its procedural slope/moisture/riverbed blend by *coverage* (the
sum of the four weights). A cell nobody painted has zero coverage and keeps the
procedural look exactly — which is why both arenas were unaffected when this
landed. Erasing lowers coverage, so paint fades back into the procedural blend
rather than leaving a bald patch. Layer order is the ABI and it is the world
file's: `textureRef` → array slice, weights → splat channel, 4 max. Paint in the
editor, hit Play, and it is there — no bake step.

### What is still derived rather than authored

- **The terrain's visual mesh** (`assets/models/terrain_hills.glb`) is
  built from `world.terrain` by `bun tools/build-terrain.ts`, which also
  adds the horizon "skirt" outside the arena. Sculpt in the editor →
  save → re-run that one command → the visuals follow. Physics and
  height queries need no rebuild; they read the world file. **Painting
  needs no rebuild either** — the splat is uploaded at load.
- **The grass** (20k instances) is scattered at startup. Its keep-out
  shapes — water, building footprint — are *derived from the world data*
  (`W.keepOut`), not hardcoded rectangles as before: move the river in
  the editor and the grass moves with it.
- **Seeding tools**, run once, not part of the build:
  `bake-terrain-to-world.ts` (heightmap from the procedural recipe in
  `terrain-shape.ts`) and `bake-forest-to-world.ts` (the 88 trees).
  Re-running either OVERWRITES editor work on that data.

## Conventions

- Use flat typed arrays (`new Array<number>(N)` + index assignment)
  for hot-loop state. `.push()` can produce arrays whose `.length`
  reports as the literal initial size.
- Return `{ ok: boolean, error: string }` instead of throwing.
- JSON-loaded config is fine — the Perry `JSON.parse` bug that forced
  hardcoded constants is FIXED (verified on 0.5.1208; see the world
  pipeline section above, which reads the whole level from JSON at
  runtime). What still binds is WHERE you parse: at load, never on a
  per-frame path.
- Data crossing the FFI on a hot path is numbers, not delimited
  strings (perry-quirks #5). Strings that do cross are drawn whole,
  never parsed.

## License

GPLv3 — required because we bundle Unvanquished's GPLv3 assets.
