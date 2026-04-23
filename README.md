# Bloom Shooter

A first-person arena wave shooter built in TypeScript on the
[Bloom engine](https://github.com/Bloom-Engine/engine) and compiled with
[Perry](https://github.com/PerryTS/perry). Art and audio converted from
the open-source [Unvanquished](https://github.com/UnvanquishedAssets)
game (GPLv3).

Built as an end-to-end stress test of the engine — exercising the
character controller, physics raycasts, spatial audio, skeletal
animation, bloom/vignette post-FX, and the retained-mode scene graph —
and as a reference implementation for games that convert
Quake-family (`.iqe`) assets.

## Play

```
perry compile src/main.ts -o main && ./main
```

Controls:

| Input            | Action                                    |
|------------------|-------------------------------------------|
| WASD             | Move                                      |
| Mouse            | Look                                      |
| Space            | Jump                                      |
| Left mouse       | Fire (rifle = full-auto, blaster = tap)   |
| 1 / 2            | Switch weapon (rifle / blaster)           |
| R                | Reload / restart after death              |
| Tab              | Toggle cursor capture                     |
| F12              | Screenshot to `shooter_<N>.png`           |
| Esc              | Quit                                      |

Survive three waves — dretches, mantises, marauders, dragoons, and a
tyrant. Ammo crates respawn at the four arena corners.

## Prerequisites

- **Perry** `0.5.158+` on `$PATH`.
- **Bloom engine** at `../engine/` relative to this repo, built at
  commit `0137335` (drop debug-green hardcode in `fs_main_3d`) or
  later. The engine's `native/macos/Cargo.toml` needs `default =
  ["jolt"]` and its `package.json` needs `"libs": ["c++"]` on the
  macOS target so Jolt physics links cleanly (see
  [docs/engine-notes.md](docs/engine-notes.md)).
- **Bun** for the asset converters and dev scripts.
- **ffmpeg** and macOS's `sips` for audio + texture resizing during
  asset conversion.

## Building assets from Unvanquished sources

The repo ships with converted `.glb` / `.wav` / `.ogg` so you can play
immediately. To regenerate from sources:

```
git clone --recurse-submodules https://github.com/UnvanquishedAssets/UnvanquishedAssets vendor/unvanquished
cd vendor/unvanquished
git submodule update --init --depth 1 \
    pkg/res-players_src.dpkdir \
    pkg/res-weapons_src.dpkdir \
    pkg/res-ambient_src.dpkdir \
    pkg/tex-tech_src.dpkdir
cd ../..

bun tools/convert-aliens-anim.ts   # 5 skinned + animated alien GLBs
bun tools/convert-arena.ts         # textured arena
# (SFX were converted ad-hoc via ffmpeg — see docs/asset-pipeline.md)
```

See [docs/asset-pipeline.md](docs/asset-pipeline.md) for the full
conversion pipeline (IQE skeletal parsing, Y-up conversion quirks,
glTF skin layout, texture resizing).

## Layout

```
shooter/
  src/                TypeScript game code (Perry-compiled)
    main.ts           entry + game loop
    input.ts          WASD / mouse / fire input aggregator
    camera-fp.ts      first-person yaw / pitch camera
    player.ts         Jolt character-controller wrapper
  assets/             committed runtime assets
    models/           .glb (arena + 5 alien classes)
    sounds/           .wav SFX + .ogg ambient
    worlds/           JSON world format (not yet runtime-loaded; see docs)
    LICENSE.md        Unvanquished asset attribution
  tools/              Bun scripts for offline asset conversion + diagnostics
    convert-aliens-anim.ts   IQE → glTF skeletal with skinning + animations
    convert-aliens.ts        IQE → glTF static (kept as a simpler reference)
    convert-arena.ts         programmatic textured arena .glb
    validate-glb.ts          runs gltf-validator against a GLB
    inspect-glb.ts           human-readable GLB structure dump
    dump-nodes.ts            one-line-per-node tree dump
    diag-skin.ts             numerical IBM × rest-world = I check
  vendor/             gitignored — Unvanquished source packs cloned here
  docs/
    asset-pipeline.md         IQE/IQM format notes + converter design
    engine-notes.md           engine-side changes needed to build this game
    perry-quirks.md           Perry 0.5.158 codegen issues and workarounds
    engine-issue-green-gbuffer.md  historical post-mortem of the green-screen bug
```

## Key engineering notes

Short version of findings accumulated while building this:

- **IQE is Z-up, glTF is Y-up.** Apply X90 rotation to vertex positions +
  normals and to the root joint's rest pose + every animation keyframe of
  that root. Child joints inherit through the hierarchy unchanged. IBMs
  are plain inverses of the resulting world matrices. Conjugating every
  joint individually (a reasonable-looking alternative) conflicts with
  bloom's Y-axis yaw that the renderer applies on top of skin matrices.
- **Perry 0.5.158 has three codegen bugs** we worked around: reachable
  `throw new Error` segfaults at startup; object-shorthand returns
  (`return { ok, errors }`) can corrupt boolean fields; `JSON.parse`
  arrays have no populated `.length`. World data is hardcoded in TS
  until JSON.parse is fixed. Details in
  [docs/perry-quirks.md](docs/perry-quirks.md).
- **Bloom's deferred pipeline had a debug-green hardcode** in
  `fs_main_3d` that made all 3D geometry render solid green under
  Perry-compiled builds on macOS. Fixed upstream in engine commit
  `0137335`. Bisect story in
  [docs/engine-issue-green-gbuffer.md](docs/engine-issue-green-gbuffer.md).
- **glTF skinned mesh nodes shouldn't have parent transforms** —
  bloom's skeleton walker in
  `engine/native/shared/src/models.rs:478` starts hierarchy
  traversal at `mat4_identity()`, so any armature node above the
  skeleton root is a no-op. We put mesh + skeleton roots at the
  scene root and bake the Z-up→Y-up rotation into the root joint's
  transforms instead.

## Licence

GPLv3. Bloom engine is MIT, Perry is Apache-2.0, but the Unvanquished
assets this game ships are GPLv3 — so this repo must be too. See
[LICENSE](LICENSE) and [assets/LICENSE.md](assets/LICENSE.md) for
attribution.
