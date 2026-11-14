# Bloom Shooter

A third-person arena wave shooter built in TypeScript on the
[Bloom engine](https://github.com/Bloom-Engine/engine) and compiled with
[Perry](https://github.com/PerryTS/perry). MIT licensed; the art and
audio are original to this game (see [assets/LICENSE.md](assets/LICENSE.md)).

Built as an end-to-end test of the engine (character controller, physics
raycasts, spatial audio, skeletal animation, the deferred renderer and its
post stack, the runtime world format) and as a reference for a complete
Perry + Bloom game on desktop, iOS, tvOS, Android and the web.

## Play

```
PERRY_LLVM_INPROCESS=0 perry compile src/main.ts -o main && ./main
```

(or `npm run dev`. The variable works round a Perry code-generation fault: `docs/perry-quirks.md` #6.)

Controls:

| Input            | Action                                    |
|------------------|-------------------------------------------|
| WASD             | Move (the body turns to face where it moves) |
| Mouse            | Look                                      |
| Space            | Jump; moving into something up to chest height, vault it |
| Left mouse       | Fire (rifle = full-auto, blaster = tap)   |
| Right mouse      | Aim down sights (hold, or toggle — settings); moving while aiming or firing is at half speed |
| Shift            | Sprint (hold, or toggle — settings)       |
| C                | Crouch (hold)                             |
| Ctrl             | Dodge: a roll, invulnerable for most of it |
| V                | Camera to the other shoulder              |
| F                | Rifle-butt strike (knocks back and stuns) |
| G                | Throw a grenade (two-second fuse; crates refill one) |
| 1 / 2 / 3 / 4    | Switch weapon (rifle / blaster / chaingun / cannon) |
| Q                | Cycle weapon                              |
| R                | Reload / restart after death              |
| (all of the above) | Rebindable: SETTINGS, BINDINGS tab (keyboard, mouse and pad) |
| Tab              | Toggle cursor capture                     |
| F3               | Profiler overlay (per-pass CPU/GPU µs)    |
| F5–F9            | Render-pass debug toggles / path tracing  |
| F12              | Screenshot (engine-native; see EN-038)    |
| Esc              | Pause (menu) — **not** quit; QUIT is a menu row |

### On an iPhone

```
./tools/deploy-ios.sh           # build, sign, install, launch
./tools/deploy-ios.sh --console # ...and stream the device log
```

Runs at ~50 fps on an iPhone 16 Pro, landscape. Touch controls: the left half
of the screen is a movement stick that appears under your thumb wherever it
lands, the right half is drag-to-look, and FIRE / JUMP / R / GUN / AIM / DASH /
DUCK / HIT / NADE sit along the right edge, with pause in the top-right corner. AIM and DUCK
are toggles. Holding FIRE still steers, so you can shoot and aim with the same
thumb.

The mobile branch drops the screen-space GI, reflections and ambient occlusion
— a phone is a tile-based GPU on a battery, and those three are what scale
worst — and keeps sun shadows and bloom, which is most of what the arena's look
actually rests on.

Requires a paid Apple developer account (Perry's signing flow is App Store
Connect API-only). See `CLAUDE.md` for the provisioning details.

### Gamepad

Left stick moves, right stick looks, RT fires, LT aims, A jumps, B dodges,
X reloads, Y cycles weapons, click the left stick to sprint and the right stick
to crouch, RB moves the camera to the other shoulder, LB is the rifle-butt
strike, Back throws a grenade, Start pauses. A pad gets aim assist (slowdown
near a target, the view following a target that moves, and a small bullet
magnetism); it is one switch in the settings, next to a separate look speed for
aiming down the sights.

### The game

Three arenas (Outdoor Plaza in the afternoon, Riverbend Ravine in morning mist, Checkpoint at dusk), ten waves each, against seven
alien kinds: Skitter, Stalker, Ravager, Bruiser and the Colossus up close, and
the Spitter and Bombard at range, so closing the distance is not the universal
answer. Rifle and blaster from the start; clearing the first arena unlocks the
chaingun and clearing the second the cannon. Picking another arena in the menu
relaunches the game into it (on phones and TV boxes, which cannot relaunch an
app, it asks you to reopen it). Ammo crates respawn around the arena.

A wave arrives in groups that pick where they come from as they start: a flank from both
sides of where you are looking, an ambush from behind, a ranged line from as far off as the
arena allows. Some creatures are elites (a size larger, glowing red, tougher, worth triple).
Each arena has one or two objective waves: hold the ring at the generator until its seconds
are banked, or destroy the three nests that keep breeding. A run pays credits, spent in the
armoury on four upgrades per weapon; a cleared arena is worth up to three stars, and stars
open the next arena. The first run starts with a five-step tutorial that can be skipped.
Progress lives in `profile.json` next to `settings.json`.

How a fight works (November 2026): the aliens have to see or hear you. A crouch
is silent and seen at half the distance, a sprint and a shot carry; break their
line of sight for five seconds and they go back to hunting where they last knew
you were. Every melee attack is a wind-up (a flare at the head, the attack
voice), a short moment when it can hit, and a recovery: step aside or roll
through it and punish the recovery. Only two or three attack at once; the rest
circle. Shots land where they land: a head is worth double (more with the
rifle), a limb less, the Bruiser and the Colossus have a soft belly and an
armoured back, and the Bombard's launcher tubes are its weak point. Health
comes back on its own up to 40; past that it takes the field dressings some
kills drop.

## Prerequisites

- **Perry** `0.5.16xx` on `$PATH`.
- **Bloom engine** at `../engine/` relative to this repo, built at
  a commit that has `restartApp()` (November 2026) or later. The Jolt/`libc++` link requirements are committed in the
  engine repo these days — [docs/engine-notes.md](docs/engine-notes.md)
  records why they exist. On Windows, prefer
  `perry compile src/main.ts -o main --debug-symbols` so crash
  reports symbolize (see `CLAUDE.md`).
- **Bun** for the asset and dev scripts in `tools/`.
- **Blender**, **ffmpeg** and macOS's `sips` only if you rebuild assets.

## Assets

Everything the game loads is committed, so you can play straight away. The
cast, weapons and props are original to this game: a concept image, a
generated mesh, then Blender (`tools/gen/`, `tools/blender/`); sounds come from
`tools/gen/sfx.py`; terrain, building and bark textures are CC0 scans. The
pipeline, step by step, is in [CLAUDE.md](CLAUDE.md) under "Asset pipeline";
sources and licences are in [assets/LICENSE.md](assets/LICENSE.md).

(Until November 2026 the art was converted from the Unvanquished project. Those
files and their converters are gone from the tree; `docs/asset-pipeline.md` is
kept as the record of how the IQE to glTF conversion worked.)

## Layout

```
shooter/
  src/                TypeScript game code (Perry-compiled)
    main.ts           boot sequence + frame loop and their wiring
    enemies.ts        kind tables + pool        director.ts  waves, AI, enemy projectiles
    combat.ts         firing, player projectiles, pickups     weapons.ts   stat table
    player.ts         character controller      camera.ts    orbit camera
    hud.ts menu.ts settings.ts score.ts         UI and persistence
    profile.ts objective.ts tutor.ts            credits/upgrades/stars, objective waves, tutorial
    ui.ts binds.ts strings.ts ui-atlas.ts       UI kit, key bindings, string table (4 languages)
    audio-mix.ts vfx.ts feel.ts environment.ts  presentation
    world-runtime.ts  runtime world loader (world.json -> flat arrays)
  assets/             committed runtime assets
    models/ sounds/ music/ textures/ materials/ fonts/ env/
    worlds/           JSON worlds, loaded at runtime (edit with ../editor)
    LICENSE.md        what ships and under which terms
  art/                concept images and provenance for the generated cast
  tools/              asset pipeline, build + release scripts, diagnostics
  android/            Gradle project for the Android build
  docs/
    aaa-plan.md       the current plan: what is missing, in order
    tickets.md        the ticket registry
    perry-quirks.md   Perry codegen issues and workarounds (read before refactoring)
    RELEASE.md        TestFlight builds
    engine-notes.md, asset-pipeline.md, audits   background and history
```

## Key engineering notes

Short version of findings accumulated while building this:

- **Perry has a running list of codegen bugs** we work around — and the list
  has moved, so treat any specific version number here as history rather than
  as current advice. Fixed since: reachable `throw new Error` segfaulting at
  startup, and `JSON.parse` arrays reporting no `.length`. **World data is NOT
  hardcoded any more** — `src/world-runtime.ts` reads
  `assets/worlds/*.world.json` at startup via the engine's `loadWorld`, there is
  no `src/generated/`, and there is no bake step. Still live: object-shorthand
  returns can corrupt fields; never `split()`/`parseFloat()` an FFI string on a
  per-frame path; some small numeric functions in imported modules silently
  compile to a constant. The authority is
  [docs/perry-quirks.md](docs/perry-quirks.md) — this bullet is a pointer, not a
  second copy of it.
- **Bloom's deferred pipeline had a debug-green hardcode** in
  `fs_main_3d` that made all 3D geometry render solid green under
  Perry-compiled builds on macOS. Fixed upstream in engine commit
  `0137335`. Bisect story in
  [docs/engine-issue-green-gbuffer.md](docs/engine-issue-green-gbuffer.md).
- **The asset conventions the code relies on** (models face +X, clips are
  addressed by index, `Root` stays joint 0, the 1024 joint-matrix budget) are
  listed in [CLAUDE.md](CLAUDE.md).

## Licence

MIT — see [LICENSE](LICENSE). That covers the code and the assets made
for this game. Third-party assets keep their own terms, listed in
[assets/LICENSE.md](assets/LICENSE.md). The Unvanquished-derived (GPLv3)
models the game started with were removed from the tree on 2026-11-14;
they remain in the git history under their original licence.
