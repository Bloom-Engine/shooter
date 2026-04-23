# Engine-side prerequisites

This shooter needs three things on the Bloom engine side before it
will build and run cleanly. Two of them were one-line edits applied
locally during development; they are not upstreamed yet.

## 1. `fs_main_3d` debug-green hardcode

**Status: fixed upstream.** Engine commit
[`0137335`](https://github.com/Bloom-Engine/engine/commit/0137335)
"fix(renderer): drop debug-green hardcode in fs_main_3d".

Before the fix, every 3D fragment rendered as solid bright green
under Perry-compiled builds on macOS. Post-mortem in
[engine-issue-green-gbuffer.md](./engine-issue-green-gbuffer.md). If
you're on an engine older than `0137335`, pull the fix or expect a
green viewport.

## 2. Jolt physics default-enabled on macOS

**Status: local edit, not upstreamed.** The engine's
`native/macos/Cargo.toml` defaults `jolt` to on:

```toml
[features]
default = ["jolt"]
jolt = ["bloom-shared/jolt"]
```

**Why.** Perry's native-library build pipeline does not forward
cargo feature flags to nativeLibrary crates — it invokes `cargo
build --release --manifest-path <crate>/Cargo.toml` with nothing
else (see
`perry/crates/perry/src/commands/compile.rs:6824`). So if `jolt` is
opt-in, any game importing `bloom/physics` fails to link with
undefined `_bloom_physics_*` symbols.

**Better long-term fix.** Teach Perry to read a `features` field on
the `perry.nativeLibrary.targets.<target>` block in `package.json`.
Tracked in our notes; not a shooter-side change.

## 3. `libc++` on the macOS link line

**Status: local edit, not upstreamed.** The engine's `package.json`
has `"libs": ["c++"]` in `perry.nativeLibrary.targets.macos`:

```jsonc
"macos": {
  "crate": "native/macos/",
  "lib": "libbloom_macos.a",
  "frameworks": [/* existing Apple frameworks */],
  "libs": ["c++"]
}
```

**Why.** Jolt is C++ and the Rust build script emits `-l dylib=c++`
as a transitive hint, but Perry's external linker (`clang`) doesn't
see those hints through a static lib. Without `-lc++` on the link
line the build fails with undefined `___cxa_throw` and
`___gxx_personality_v0`.

This is safe to upstream directly — `libc++` is always available on
macOS and is a no-op for games that don't touch C++ code.

## Verifying the engine is ready

From the shooter repo:

```sh
perry compile src/main.ts -o main
```

Expected: clean build ending with `Wrote executable: main`. A link
failure mentioning `_bloom_physics_*` means prerequisite 2 is
missing; one mentioning `___cxa_throw` / `___gxx_personality_v0`
means prerequisite 3 is missing.

## Upstreaming plan

- Open a PR on `Bloom-Engine/engine` adding `"libs": ["c++"]` to the
  macOS target in `package.json`. Zero-risk.
- Once Perry supports per-target cargo features, revert the
  `default = ["jolt"]` change in `native/macos/Cargo.toml` and rely
  on the shooter's `perry.toml` declaring `features = ["jolt"]`
  instead.
