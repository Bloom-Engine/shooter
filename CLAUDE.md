# CLAUDE.md — Bloom Shooter

Notes for AI coding assistants working on this repo.

## Quick orientation

The full picture is in `README.md`. This is a Perry-compiled TypeScript
FPS built on the Bloom engine. Five alien kinds, three waves, two
weapons, textured arena, skeletal-animated enemies, ambient music —
runnable with `perry compile src/main.ts -o main && ./main`.

## Where things live

- `src/main.ts` — single-file game (~900 LOC). Flat-array state per
  Perry convention.
- `src/input.ts` / `src/player.ts` — small single-purpose modules.
- `src/generated/world.ts` — **generated, do not edit**. Built from
  `assets/worlds/arena_02.world.json` by `tools/build-world.ts`. The
  runtime reads world geometry, lighting, spawners, pickups, and the
  wave plan from this module.
- `assets/worlds/*.world.json` — authored level data using the engine's
  standard world schema (`engine/src/world/types.ts`). The editor at
  `../editor/` round-trips these files unmodified.
- `tools/` — offline converters + glTF diagnostics. Run with `bun`.
- `assets/models/` — committed GLBs. Regenerate via
  `bun tools/convert-aliens-anim.ts` and `bun tools/convert-arena.ts`.

## Read before changing things

- **`docs/perry-quirks.md`** — three Perry 0.5.158 bugs we work around.
  Never add `throw new Error(...)`, never rely on object-shorthand
  return values, never `JSON.parse(...).arr.length`. Use flat arrays
  and explicit keys. A well-meaning refactor can silently crash this
  on startup if these rules are forgotten.
- **`docs/engine-notes.md`** — the engine needs `default = ["jolt"]`
  in `native/macos/Cargo.toml` and `"libs": ["c++"]` in
  `package.json`'s macOS nativeLibrary target. Not yet upstream.
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
npm run dev                            # build world + compile + run
npm run build                          # build world + compile only
npm run world                          # regenerate src/generated/world.ts
perry compile src/main.ts -o main      # raw compile (skip world build)
./main                                  # play
bun tools/convert-aliens-anim.ts       # regenerate animated alien GLBs
bun tools/convert-arena.ts             # regenerate textured arena
bun tools/validate-glb.ts <path>       # glTF-validator report
```

## World pipeline

`assets/worlds/<name>.world.json` is authored by hand (later: by the
bloom editor). Every `npm run dev` re-runs `tools/build-world.ts`,
which buckets entities by `userData.kind` and emits a Perry-safe
TypeScript module of parallel flat arrays at `src/generated/world.ts`.
Perry can't parse JSON at runtime (arrays from `JSON.parse` have no
`.length`), so the generator is a hard requirement — never import the
JSON directly. Supported kinds today: `player_spawn`, `collider_box`,
`static_mesh` (with optional box collider + tag-driven paint
category), `prop_tree`, `point_light`, `enemy_spawner`,
`weapon_pickup`, `wave_config`. Water volumes and environment settings
come from the top-level fields. Adding a new kind = add a bucket in
`tools/build-world.ts` + consume the generated arrays in `main.ts`.

## Conventions

- Use flat typed arrays (`new Array<number>(N)` + index assignment)
  for hot-loop state. `.push()` can produce arrays whose `.length`
  reports as the literal initial size.
- Return `{ ok: boolean, error: string }` instead of throwing.
- Prefer hardcoded constants over JSON-loaded config until the Perry
  JSON.parse bug is resolved.

## License

GPLv3 — required because we bundle Unvanquished's GPLv3 assets.
