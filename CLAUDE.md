# CLAUDE.md — Bloom Shooter

Notes for AI coding assistants working on this repo.

## Quick orientation

The full picture is in `README.md`. This is a Perry-compiled TypeScript
**third-person shooter** (over-the-shoulder orbit camera — TPS, not
FPS) built on the Bloom engine. Seven alien kinds (two RANGED; an original
cast since 2026-11: Skitter, Stalker, Ravager, Bruiser, Colossus, Spitter,
Bombard, against the Trooper), three
waves, six weapons, FIVE playable arenas of ten waves each (`arena_05` Quarry at an overcast noon,
`arena_06` Brood Hollow at night, where wave 10 is the boss, the Matriarch) (elites, a hold or a nest objective
wave, credits and weapon upgrades between runs: Phase 6), (`arena_02` Outdoor Plaza in late afternoon,
`arena_03` Riverbend Ravine on a misty morning, `arena_04` Checkpoint at dusk),
textured arena, skeletal-animated enemies, ambient music, and a live 3D
soundscape (river/wind emitters + creature locomotion on EN-062 voices —
see SH-052) — runnable with
`PERRY_LLVM_INPROCESS=0 perry compile src/main.ts -o main && ./main` (the variable is not optional:
`docs/perry-quirks.md` #6).

## Where things live

- `src/main.ts` — the boot sequence + frame loop and their wiring
  (~2,100 lines; the SH-025 module split is complete). Flat-array
  state per Perry convention. The test harnesses, started with `./main --harness <name>`
  (lower-case name; no source edit since Phase 7)
  (SELFTEST/AITEST/ANIMDBG/MENUTEST/FACETEST/LOCOPROBE/KEYPROBE/
  COMBATSHOT/PLAYERSHOT/P2TEST/P2BOT/PERFTEST) and the
  diagnostics (diag bar, profiler overlay) live here too. UISHOT captures every menu screen and
  HUD state; MENUTEST drives the menus with injected keys and logs pass/fail lines.
  **`tools/check.sh` runs the static checks, a build, boot, AI and menus in about four minutes
  and restores the player's files; run it before a commit that touches `src/`.** `--bot` adds a
  whole stand-in run, `--perf` the frame rates. `tools/check_static.py` alone is what CI runs.
- The game is split by subsystem, one module each: `enemies.ts`
  (kind tables + pool), `director.ts` (waves + per-kind AI + enemy
  projectiles), `combat.ts` (weapons/fire/player projectiles/pickups/grenades/melee),
  `hitshapes.ts` (where a shot lands on a creature: shapes on its live skeleton),
  `flora.ts` (plant cards and the far tree line, scattered at load, instanced),
  `camera.ts` (orbit + canopy occlusion), `hud.ts`, `menu.ts` (title, pause, tabbed settings,
  arena cards, results, credits), `ui.ts` (the UI kit: atlas sprites, palette, panels, button
  glyphs), `binds.ts` (which key / mouse button / pad button each action is on),
  `strings.ts` (GENERATED string table, four languages), `profile.ts` (what a player keeps:
  credits, upgrades, stars, lifetime numbers, in `profile.json`), `objective.ts` (hold and nest
  waves), `tutor.ts` (the tutorial and the one-time hints), `environment.ts`
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
- `assets/models/` — committed GLBs, built by the asset pipeline below
  (`tools/gen/`, `tools/blender/`).
- `docs/aaa-plan.md` — the current plan: what is missing for AAA quality, in
  order. Phases 0 (bugs and hygiene), 1 (the player on screen), 2 (combat), 3 (world art
  and lighting), 4 (UI and front end) and 6 (encounters, progression, objectives, onboarding,
  volume) landed 2026-11-14; each phase's header says what it left open. Phase 5 (audio and VFX
  depth) was skipped, not done. Phase 7 (performance and production) is partly done: measured at
  40-51 fps on the M1 Max, 60 not reached, see its table.

## Read before changing things

- **`docs/perry-quirks.md`** — six Perry 0.5.x bugs we work around. #6 is why every build sets
  `PERRY_LLVM_INPROCESS=0`: without it `src/main.ts` fails with `unknown type { double, i64 }`,
  and the line that seems to cause it never does.
  Since Perry 0.5.16xx the temporal dead zone is enforced for module-level `const`: a
  function called during module init must not read a `const` declared further down the file
  (`ReferenceError: Cannot access 'X' before initialization` at boot).
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
PERRY_LLVM_INPROCESS=0 perry compile src/main.ts -o main      # raw compile (quirk #6)
./main                                  # play
bun tools/validate-glb.ts <path>       # glTF-validator report
bun tools/fetch-external-textures.ts   # re-download the CC0 photoscan sources
bun tools/build-terrain-textures.ts    # rebuild the 4 terrain splat layers
bun tools/build-building-textures.ts   # rebuild the building wall/slab slices
./tools/deploy-ios.sh                  # build + sign + install + launch on iPhone
./tools/deploy-ios.sh --console        # ...and stream the device's stdout/stderr
./tools/build-web.sh                   # SH-054: browser build -> dist/web (add --serve to host it)
bun tools/web-check.ts                 # headless-Edge boot check (console + screenshot)
bun tools/web-play-check.ts            # drives PLAY, walks, fires, screenshots gameplay
tools/check.sh                         # static checks + build + boot + AI + menus (--bot, --perf, --static)
./main --harness uishot                # any harness by name; --wave N / --weapon N for p2bot
python3 tools/release/bundle_audit.py  # what a bundle's assets weigh, by kind
```

Every bundle (TestFlight, web, Android) trims its COPY of `assets/` through one list,
`tools/release/assets_bundle.py`: add an exclusion there, not in a build script.
`tools/build-android.sh` refuses to start while `assets/` has uncommitted changes, because it
restores that folder from git after Perry's bundling step.

### Web (browser, WASM + WebGPU)

`tools/build-web.sh` produces `dist/web`: the engine's `bloom_web.wasm`
(wasm-pack, `../engine/native/web`), the Perry game wasm (`--target web`,
spliced HTML), the asset tree plus `assets_manifest.json` (the JS glue
prefetches it and treats it as authoritative for `fileExists`). Serve the
directory (`python -m http.server 8080`) — `file://` won't do, the loaders
fetch same-origin. WebGPU required (Chrome/Edge 113+); there is no WebGL2
fallback for the 3D path. The main loop is `runGame(gameFrame)` — identical
blocking loop on native, rAF on web — so never reintroduce a bare
`while (!windowShouldClose())`. Web-specific guards hang off `WEB` in
`src/input.ts`. Writes via `writeFile` land in localStorage under
`bloom_fs:`. Three Perry wasm-codegen fixes this port depends on live on
perry branch `fix/wasm-new-array-sized`; the engine side is EN-063.

### TestFlight (iOS, tvOS, macOS)

`python3 tools/release/release.py` builds all three, signs for the App Store and uploads
(`--only ios`, `--no-upload --no-commit` for a dry run). Details, one-time setup and the Perry
patches the build depends on: `docs/RELEASE.md`. The compiler and runtimes come from the Perry
checkout in `PERRY_HOME` (default `~/projects/perry/worktrees/perry-0.5.1665`), not from the
`perry` on PATH; rebuild them with `tools/release/build_toolchain.sh`.

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
  the whole 2D pass through `beginMode2DRaw`'s zoom. (Desktop and web do the same
  against a 1080-unit-tall space, so the HUD holds its size at 4K; anchor
  right-edge text with `measureText`, never a fixed offset.) The touch controls are
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
- Set `$env:PERRY_LLVM_INPROCESS = "0"` first (perry-quirks #6), then
  compile with `perry compile src/main.ts -o main --debug-symbols` so
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

## Asset pipeline (photoreal models, since 2026-11)

Characters, weapons and props are generated, not converted: a photoreal concept image, Tripo Studio
(Ralph's account, through his Chrome with the Claude in Chrome extension), then Blender. The older
Unvanquished-derived GLBs and their converters were removed from the tree on 2026-11-14. Do not run
`npm run assets` without reading what it overwrites: `build-props.ts`, `build-weapons.ts` and
`build-vfx-textures.ts` are the older procedural generators and write over the generated models.

1. **Concept**: `art/style/photoreal/<name>/prompt.txt` -> `front-1.png` with
   `tools/gen/codex_image.sh <out.png> <WxH> <prompt.txt> [reference images]` (Codex CLI image
   generation). All creature prompts share one species paragraph and all gear prompts one hardware
   paragraph, so the cast matches. Weapon prompts must read as inert film props or the image model
   refuses them.
2. **Tripo Studio**: workspace ids, settings and credit costs are in `art/source/README.md`.
   Say what a step costs before spending; ask Ralph before anything over a few hundred credits.
   Each download needs his yes. Chrome may block the site's later downloads ("download multiple
   files"): Tripo then reports success and nothing arrives; Ralph has to click Allow.
3. **Characters**: `tools/gen/collect_tripo.sh <name>` files the two first downloads
   (`collect_rig.sh` a later re-export with added clips); `tools/gen/build_cast.sh [name]` holds the
   whole recipe for all eight and rebuilds them through `make_character.sh`: scale, turn to face
   glTF +X, name and sort the clips, cut each generated run to its most seamless stride loop
   (`studio_import.py --loop`), trim attack/death, bake a 4K normal map from the 2M-triangle original.
4. **Weapons and props**: `blender -b -P tools/blender/process_static.py -- in.glb out.glb --kind
   weapon|prop --size <m>` (decimate, unwrap, bake base colour / normal / roughness / metallic at 4K).
   Exact arguments per model: `art/source/README.md`.
5. **Trees**: `tools/blender/build_tree.py` GROWS them (one trunk tapering to the crown top, limbs,
   branches, twigs as bark tubes; bark is the Poly Haven `bark_willow_02` scan;
   two crossed leaf-cluster cards on every twig). Leaf cards are photographed-style branch tips
   generated on magenta (`art/style/foliage/`) and keyed by `tools/gen/key_foliage.py`; bark is the
   Poly Haven 2K scan. It prints the CANOPY numbers for `src/camera.ts`.
6. **Surfaces**: terrain and building layers are the Poly Haven 2K scans at full resolution
   (`tools/build-terrain-textures.ts`, `build-building-textures.ts`). Smoke, dust, muzzle flash and
   the decals are generated photographs converted by `tools/gen/vfx_from_image.py`
   (`art/style/vfx/`); spark, droplet and shell are still procedural (`build-vfx-textures.ts`,
   which would overwrite the photographic ones if re-run, so re-run the converter after it).
   **Grass**: one instance is a seven-blade TUFT built in `src/environment.ts` (80k on desktop, 36k
   on mobile). **House**: the wall boxes of a world get drawn-only dressing (concrete frame, steel
   window linings, sills, awnings) from `tools/gen/house_trim.py <world.json>` as `building_trim`
   entities; re-run it after editing the walls. Brick / concrete / steel are slices 0/1/2 of the
   building texture arrays, chosen per box through vertex colour (see `building.wgsl`).
   The SCENESHOT harness in `src/main.ts` captures fixed views of house, grass and trees.
7. **Sounds**: `tools/gen/sfx.py` (ElevenLabs). **UI type**: `assets/fonts/` via `src/ui-text.ts`.
8. **Dressing an arena** (Phase 3, SH-058): `tools/gen/dress_arena.py <arena_id>` shapes the
   river banks, places rocks, logs, stumps, river stones and the hand-listed hardware (its `EXTRA`
   table) as `static_mesh` entities, adds a world light at every work light, and paints
   `terrain.layers`. It replaces what it placed before (`dress_*` ids) and repaints all four
   layers, so editor paint on a dressed arena is lost on a re-run. Rebuild the terrain's drawn
   mesh afterwards if the banks changed (`bun tools/build-terrain.ts <world> <glb>`).
   `tools/gen/set_look.py <arena_id> key=value ...` sets the time of day and grade;
   `tools/gen/grade_sky.py` makes the sky variants in `assets/env/`. `tools/gen/gen_arena_04.py`
   seeded the Checkpoint arena (re-running it overwrites the world file). Plant cards are
   generated on magenta like the tree leaves and keyed into `assets/textures/flora_*.png`; the far
   tree card is rendered from the tree model by `tools/blender/tree_impostor.py`.
9. **UI** (Phase 4, SH-059): `python3 tools/gen/ui_atlas.py` draws `assets/ui/atlas.png` (white
   shapes, tinted where drawn) and writes `src/ui-atlas.ts`; add a sprite to its `SPRITES` list,
   never index the atlas by hand. The weapon silhouettes in it are renders of the weapon models
   (`tools/blender/weapon_silhouette.py` into `art/ui/`). `python3 tools/gen/strings_table.py`
   holds every string in four languages and writes `src/strings.ts`: edit the table, not the
   generated file. `tools/gen/ui_sfx.py` synthesises the interface sounds. Arena pictures for the
   menu are `assets/ui/<arena_id>.png`, 640 x 360.
10. **Open arenas** (slice D, SH-061): `tools/gen/gen_arena_open.py arena_05|arena_06` seeds the Quarry and
   Brood Hollow (its docstring lists the four commands that follow it). Re-running overwrites.
11. **Encounters** (Phase 6, SH-060): `python3 tools/gen/gen_waves.py <arena_id>` writes the ten-wave
   plan into the world's `wave_config` (its docstring is the format: `!` marks an elite, `groups`
   is `size:pattern:gap`, `type` is kill / hold / nests), adds four spawn points (`spawner_x*`)
   and the objective sites (`obj_hold` at the arena's generator, three `obj_nest_*`). Re-running
   replaces all of those. The nest model is procedural: `blender -b -P tools/blender/build_nest.py
   -- assets/models/prop_nest.glb`.
12. **Compress**: `tools/gen/compress_assets.sh` writes `<model>.astc.glb` (git-ignored); release
   bundles ship those under the plain names.
Check anything visually with `tools/blender/model_sheet.py` (four views with axes) and
`tools/blender/clip_sheet.py` (frames of one clip), and in-game with the COMBATSHOT harness, which
ends on a shoulder-aim close-up.

What the code expects of a model (all measured tables live in `src/enemies.ts`, `src/main.ts`):
- Characters face glTF **+X**, +Y up, feet at the origin, authored in metres (scale tables are 1).
- Clips are addressed **by index**. Every creature carries the same nine in sorted order:
  0 c_attack, 1 c_run, 2 death, 3 fall, 4 hit_to_body_01, 5 idle, 6 run, 7 slash, 8 walk
  (c_* are that creature's own motion). Trooper (14 clips, `PLAYER_ANIM_*` in `src/main.ts`):
  0 crouch_idle, 1 crouch_walk, 2 death_back, 3 death_front, 4 hit_back, 5 hit_front, 6 idle, 7 roll,
  8 run, 9 sprint, 10 strafe_left, 11 strafe_right, 12 walk, 13 walk_back. Prompts: `art/source/trooper_clips.md`.
- Trees are two primitives, bark then leaves (`TREE_GLB_PARTS`); leaves are alpha MASK, double sided.
- Mixamo skeleton under a static `Root` bone that the importer adds: 67 joints on the Trooper
  (with `tag_weapon`), 23 on every creature (`tools/gen/strip_joints.py` drops fingers, toe ends
  and the head top after import; `build_cast.sh` runs it; their hands are open claws in every clip). `Root` must stay joint 0: with root motion off the engine pins joint 0's
  translation, and if that were the hips a death would lie down in mid-air and a crouch would not
  lower the body. The engine has 1024 joint matrices per frame for ALL skinned draws
  and fails silently past it (the draw that does not fit is posed with another model's matrices):
  67 + 31 pool slots x 23 = 780 (the 31st is the boss). The pool is per kind (`KIND_POOL` / `KIND_SLOT0` in
  `src/enemies.ts`: 8 Skitters down to 2 Colossi); 41 creature slots is the ceiling.
- The Trooper's rig sits on top of its clips (engine EN-064, the player block of `src/main.ts`):
  the spine leans with the camera pitch, the off hand is pulled onto the weapon's handguard by IK
  (and walks handguard -> magazine -> belt -> magazine during a reload), and every gait except the
  run takes its torso and arms from the run clip, which holds the rifle best (see SH-056). Aiming or
  firing squares the body to the camera and blends walk / walk_back with the two strafes
  (`animSetBlend`); otherwise the body faces its travel. Roll and death own the whole body and the
  weapon then follows the hand. `build_cast.sh` closes the Trooper's fingers with `--grip`. The
  weapon tables (`WEAPON_HAND_*`, `WEAPON_GRIP_*`, `WEAPON_MAG_*`) say where the hands go on each
  model. Judge any change with the PLAYERSHOT harness: 26 captures of the Trooper (poses from three
  sides, all four weapons, roll, reload, hit, death).
- Combat rules the code rests on (Phase 2, SH-057). A creature only knows where the player is
  while it perceives them (`enAware`, sight cone + range + one ray, hearing radius, touch); the
  director steers at `enLast*`, never at the player directly. Melee is wind-up / active / recovery
  (`AI_STRIKE_*`, tables `STRIKE_*`): damage exists only in the active frames, and the attack
  layer is restarted per strike (`enStrikeSeq`) at the speed that puts `ATTACK_HIT_T` at the end of
  the wind-up. Attack tokens cap how many are mid-attack. Shots are tested against
  `hitshapes.ts` and the static world separately; the creatures' physics boxes only block the
  player. All damage to the player goes through `director.damagePlayer`. HP and weapon damage
  are x10 the pre-November numbers. Judge changes with P2TEST (scripted checks, `P2 ...` log
  lines and pictures) and P2BOT (a stand-in plays a whole run).
- Enemies die by their authored clip (chosen by the blow: `enDeathClip`); the engine's auto-ragdoll is switched off (`DEATH_RAGDOLL` in
  `src/main.ts`) because it mangles this skeleton.
- Developer overlays (render-pass line, diagnostics bar) are hidden; F1 or `--debughud 1` shows them.
- World rules the code rests on (Phase 3, SH-058). The shoreline is where the terrain crosses
  the water surface, not the water volume's edge: the drawn surface overhangs the volume by
  2.5 m a side, and "in the river" is asked of the terrain height. Custom material shaders
  light themselves, so a point light only reaches the house and the ground because
  `building.wgsl` and `terrain.wgsl` loop over `view.point_lights` (unshadowed). A long prop is
  a row of obstacle circles; keep them closer than a radius apart or walkers catch between
  them. A spawn below the terrain falls through it for ever. Do not use bit-mixing hashes
  (`| 0` on products past 2^53) for noise: compiled by Perry they came out nearly constant;
  `flora.ts` has a Park-Miller cell hash that works. Judge world changes with SCENESHOT
  (a view table per arena, `SCENE_VIEWS_0x` in `src/main.ts`; pick the arena with `level.txt`).
- UI rules the code rests on (Phase 4, SH-059). Nothing the player reads is a string literal:
  it is `T(STR.S_...)` from the table, upper case, Latin script only (the font has no other).
  Colours are meanings (`UI.col(UI.C_DANGER, alpha)`), never RGB, so the four palettes work.
  A key hint is `UI.drawGlyph(action, ...)` from `binds.ts`, never a typed "[R]"; gameplay reads
  input through `binds.ts` (`kbDown(ACT_...)`), and only the menus and the developer keys use
  fixed keys. Settings rows are one table (`addRow` in `menu.ts`); a new setting is an index in
  `settings.ts` (load + save + default) plus one row, and `applyLive` if it must act at once.
  One function (`rowRect`) says where a row is, for drawing and for the pointer alike. A menu
  ignores input on the frame it opens (the key that opened it is still pressed). The engine's
  `drawTexturePro` origin is an absolute pivot; use `UI.sprRot`. The HUD is authored for a
  1080-unit-tall space and drawn at 0.62 on phones. A harness screenshot is skipped while the
  window is covered, so rerun if pictures are missing.
- Encounter and progression rules the code rests on (Phase 6, SH-060). A wave is a list of
  GROUPS; a group's pattern picks its spawn point(s) when the group STARTS, from where the
  player stands and where the camera looks (`startGroup` in `director.ts`), so the same wave
  plays differently from a different spot. A group waits out its gap unless two or fewer
  creatures are left. An objective wave repeats its list until `OBJ.done`; if the world has no
  site for it, it is an ordinary wave. An elite is a flag on a slot (`enElite`), never a new
  kind: scale, health, damage and score are multiplied where they are read, and
  `despawnAllEnemies` clears it. Weapon numbers are read through `WPN.damageOf / magSize /
  pierceOf / aoeOf`, never from the `W_*` tables, or an upgrade does nothing. A run is banked
  once, in `director.bankRun` (best score to `settings.json`, the rest to `profile.json`), and
  not at all under a harness (`DIR.bank`): a bot run once overwrote a best score. The hold ring
  is solid stakes because the additive glow card is one warm colour and too faint in daylight
  to mark anything. A creature that wants to move and does not is sidestepped (`UN_*` in
  `director.ts`), and the last few of a wave are told where the player is after twenty
  seconds unaware: both exist because a wave that cannot end is the worst bug this game can
  have. Judge changes with P2BOT (it is PUT at each objective; it does not walk),
  UISHOT (captures 21-26: tutorial, elite, objective waves; run it per arena with `level.txt`)
  and MENUTEST.
- Slice D (SH-061). There are EIGHT kinds: kind 7 (`K_BOSS`) is the Matriarch, one body, and
  every per-kind table anywhere must have eight entries (a seven-entry one crashes with a
  TypeError the moment she is alive). Her weak point is the brood-sac cluster on her back (a
  sphere behind the neck). Her hit-shape columns and the scattergun's and lance's hand tables
  are estimates: tune them against P2TEST / PLAYERSHOT pictures before trusting them. (If one
  of the three slice D models is missing the game falls back to a larger Colossus, the blaster
  or the rifle: `HAS_BOSS_MODEL`, `HAS_SCATTER_MDL`, `HAS_LANCE_MDL`.) A weapon with
  pellets or a piercing hitscan round goes through `combat.fireMulti`. Bot aids:
  `--wave N` starts the stand-in at a wave, `--weapon N` gives it a weapon.
- No vertex colours (the engine multiplies `COLOR_0` into albedo).
- Weapons: barrel along +Z, rear at z = 0, metres. Props: origin at the base centre, drawn unrotated.

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
  `enemy_spawner`, `weapon_pickup`, `wave_config`, `objective` (`role=hold` with a `radius`, or
  `role=nest`), `building_trim`, and `look` (one per world:
  time of day and grade as key/values, read with `W.lookNum`). A `static_mesh` may carry `yaw`
  (degrees: the model is drawn turned and its box collider turns with it) and `obst=1`
  (creatures steer round it). Every entity needs a `modelRef`: logic entities use
  `_gizmo_box.glb`, or the loader rejects the whole world. A spawner means
  nothing without this game, so it stays game-defined; the editor
  round-trips it as opaque key/values.

Adding a new kind = bucket it in `src/world-runtime.ts` and consume the
array in `main.ts`. Nothing to regenerate.

**Changing arena relaunches the game.** Everything above is read into module-level tables at
startup, so the level select writes the choice to `level.txt` and calls the engine's `restartApp()`
(exec in place on macOS/Linux, successor process on Windows, page reload on web). iOS, tvOS and
Android cannot relaunch an app: there the game asks the player to reopen it. A true in-process
reload would need those tables to become reloadable state and an engine teardown path for
colliders, scatters and GI proxies.

Wave configs name enemies by their current names (`skitter`, `stalker`, `ravager`, `bruiser`,
`colossus`, `spitter`, `bombard`); the old Unvanquished class names are still accepted.

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

The repository is MIT (`LICENSE`, since 2026-11-14). The Unvanquished-derived (GPLv3) models and
their converters were deleted from the tree the same day; do not restore them from history. What
ships and under which terms: `assets/LICENSE.md`.
