# Releasing to TestFlight (iOS, tvOS, macOS)

One command builds all three platforms locally, signs them for the App Store and
uploads them to App Store Connect. The internal TestFlight group gets every build
automatically.

```sh
python3 tools/release/release.py                 # next build number, all platforms
python3 tools/release/release.py --bump minor    # 0.1.x -> 0.2.0 as well
python3 tools/release/release.py --only ios      # subset
python3 tools/release/release.py --no-upload --no-commit   # dry run: dist/*.ipa, dist/*.pkg
```

What the script does:
1. Picks the build number as max(perry.toml + 1, highest uploaded + 1) and writes it to `perry.toml`.
2. Runs `perry compile` per target (`--features ios-game-loop` on iOS/tvOS). Perry copies `assets/`
   into the iOS/tvOS `.app`. For macOS, Perry
   writes a bare executable for a Bloom game, so the script assembles `BloomShooter.app` itself, with
   the assets under `Contents/Resources` (the Perry runtime chdirs there at launch).
3. Compiles icons from `icons/` into an asset catalog with `actool`: the iOS 1024 icon,
   the tvOS layered icon and Top Shelf images, and the macOS icon set.
4. Fills in Info.plist (version, build, encryption exemption, landscape, SDK keys), embeds the
   App Store profile, signs (Apple Distribution / 3rd Party Mac Developer Application), and
   packages a `.ipa` or a signed `.pkg` into `dist/`.
5. Uploads with `xcrun altool` using the App Store Connect API key, then commits perry.toml
   and tags `v<version>-<build>`.

Nothing goes through Perry Hub. `perry publish` would upload the source tree, and this game
depends on `../engine`, which lies outside the repo.

## Identity

| | |
|---|---|
| Bundle ID | `com.bloomengine.shooter` (one universal App ID for all platforms, so one app record and universal purchase) |
| Team | Skelpo GmbH, `K6UW5YV9F7` |
| API key | `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY_PATH` in `.env` |
| Profiles | `~/.perry/com_bloomengine_shooter_{ios,tvos}.mobileprovision`, `~/.perry/com_bloomengine_shooter_macos.provisionprofile` |
| Certs (login keychain) | Apple Distribution, 3rd Party Mac Developer Application, 3rd Party Mac Developer Installer |

`tools/release/asc.py`:
- `setup`: registers the bundle ID and creates or renews and downloads the three App Store profiles. Re-run it when a profile expires (March 2027 for the current ones).
- `testers`: creates the internal group "Team" with access to all builds, then lists its members.
- `status`: lists recent builds per platform and their processing state.

## One-time setup on a new machine

1. Install Xcode, then log in to the keychain holding the three certificates above.
2. `.env`: fill in the `ASC_*` and `APPLE_TEAM_ID` values (see `.env.example`).
3. Build Perry and its host, iOS and tvOS runtime libraries from the checkout named by
   `PERRY_HOME` (default `~/projects/perry/worktrees/perry-0.5.1665`):
   `tools/release/build_toolchain.sh`. Re-run it after every Perry update. That checkout carries two
   local runtime patches that are not upstream yet (see "Perry patches" below).
4. `python3 tools/release/asc.py setup`

## Store art

`icons/*.png` come from `tools/release/make_icons.py`, which derives every size from two generated
images: `icons/icon-src.png` (square) and `icons/keyart-src.png` (wide). Their prompts are in
`art/style/keyart/`; regenerate with `tools/gen/codex_image.sh`, then re-run `make_icons.py`.

## Perry patches

The Perry checkout in `PERRY_HOME` is release 0.5.1665 plus two uncommitted runtime patches:

- `crates/perry-runtime/src/object/shapes_store/flat.rs`: on iOS-family targets the shape region
  reserves 512 MB per agent instead of 8 GB. An iPhone app has about 8 GB of address space, and two
  agents (main thread + game thread) at 8 GB each made `malloc` fail at launch.
- `crates/perry-runtime/src/gc/mark/mark_slots.rs`: remembered-set custody for observer rewrites
  follows the parent kind.

For tvOS, `build_toolchain.sh` also applies `tools/release/perry-tvos-execve.patch`.

## Known gaps

- On iOS, `getScreenWidth()` reports pixels where macOS reports points (Bloom EN-024); `main.ts`
  already lays the HUD out in a logical space, see CLAUDE.md.
- tvOS has no touch screen: the game needs a paired gamepad there (`src/input.ts` reads one).
- The macOS minimum OS comes from the linked binary, because Bloom's static library is built
  against the installed SDK.

## tvOS: crash at launch in `Thread::new` (allocator mismatch)

Symptom: the tvOS app aborts immediately; the crash log shows `main` → `std::thread::Thread::new`
→ `realloc` → `pointer being freed was not allocated`. Cause: Perry's runtime allocates with mimalloc
(its `#[global_allocator]`), but the binary's `__rust_alloc`/`__rust_realloc` shim forwarded to system
malloc. Two libraries carried a system-malloc shim with the same mangled names (tvOS builds every Rust
library with the same pinned nightly, so the names collide):

- `libperry_stdlib.a` embeds its own perry-runtime; built with `--no-default-features` it lost
  `alloc-mimalloc`. `build_toolchain.sh` now builds it together with perry-runtime-static and the
  runtime's default features.
- `libbloom_tvos.a` has a shim object of its own; `strip_alloc_shim.py` removes it (run by the cargo
  shim after a tvOS Bloom build and by `release.py` before each tvOS compile).

Check a build: `nm` the binary for `___rust_alloc` (exactly one) and disassemble it: it must branch to
`_mi_malloc_aligned`, not `_malloc`.
