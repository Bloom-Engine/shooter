#!/usr/bin/env bash
# Build the Perry compiler and its runtime/stdlib static libraries for the host
# (macOS) and the Apple device targets, from the Perry source checkout that
# release.py uses (PERRY_HOME, default below). Run once per Perry update.
#
# The device runtimes are built with `ios-game-loop`: perry links prebuilt
# archives, and only that feature compiles the main() that hands the main thread
# to UIKit and runs the Bloom loop on a game thread.
#
#   tools/release/build_toolchain.sh            # host + ios + tvos
#   tools/release/build_toolchain.sh tvos       # one target
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# Perry main since 2026-11-15 (it holds pull requests 14766 and 14768, so no local patches).
# The last release-based toolchain was worktrees/perry-0.5.1665 with two uncommitted patches.
PERRY_HOME="${PERRY_HOME:-/Users/amlug/projects/perry/worktrees/perry-main-latest}"
# perry-codegen's build script needs the LLVM 22 headers.
export LLVM_SYS_221_PREFIX="${LLVM_SYS_221_PREFIX:-/opt/homebrew/opt/llvm@22}"
cd "$PERRY_HOME"

targets=("$@")
[[ ${#targets[@]} -eq 0 ]] && targets=(host ios tvos)

for t in "${targets[@]}"; do
  case "$t" in
    host)
      cargo build --release -p perry -p perry-runtime-static -p perry-stdlib-static
      scripts/gc_call_effects/sidecars.sh target/release ;;
    ios)
      rustup target add aarch64-apple-ios >/dev/null
      cargo build --release --target aarch64-apple-ios -p perry-runtime-static -p perry-stdlib-static -p perry-ui-ios \
        --features perry-runtime/ios-game-loop
      scripts/gc_call_effects/sidecars.sh target/aarch64-apple-ios/release ;;
    tvos)
      # perry-runtime calls libc::execve, which Rust's libc doesn't expose on tvOS.
      # Applied to the checkout's working tree until it lands upstream.
      if git apply --check "$HERE/perry-tvos-execve.patch" 2>/dev/null; then
        git apply "$HERE/perry-tvos-execve.patch"
      fi
      # Tier 3: no prebuilt std, so build it from rust-src (pinned nightly in rust-toolchain.toml).
      cargo build --release -Zbuild-std=std,panic_abort --target aarch64-apple-tvos \
        -p perry-runtime-static -p perry-ui-tvos --features perry-runtime/ios-game-loop
      # The stdlib embeds its own copy of perry-runtime. --no-default-features (to drop crypto/TLS,
      # vendored OpenSSL has no tvOS configuration) would also drop the runtime's defaults, among
      # them alloc-mimalloc: that copy's allocator shim then forwards to system malloc while the
      # runtime allocates with mimalloc, and the app aborts at launch. Building it together with
      # perry-runtime-static and the runtime's defaults keeps both copies identical.
      cargo build --release -Zbuild-std=std,panic_abort --target aarch64-apple-tvos \
        -p perry-runtime-static -p perry-stdlib-static --no-default-features \
        --features perry-stdlib/scheduler,perry-stdlib/ids,perry-stdlib/bundled-events,perry-stdlib/bundled-streams,perry-stdlib/compression,perry-runtime/default,perry-runtime/ios-game-loop
      scripts/gc_call_effects/sidecars.sh target/aarch64-apple-tvos/release ;;
    *) echo "unknown target $t (host|ios|tvos)" >&2; exit 2 ;;
  esac
done
