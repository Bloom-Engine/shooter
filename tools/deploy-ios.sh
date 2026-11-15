#!/usr/bin/env bash
# Build → sign → install → launch the shooter on a physical iPhone.
#
# Perry's compile step bundles + auto-signs, but its codesign call fails on the
# extended attributes macOS puts on the asset files ("resource fork, Finder
# information, or similar detritus not allowed"), so we strip those and sign
# ourselves. Pass --console to stream stdout/stderr from the device.
set -euo pipefail
# docs/perry-quirks.md #6: Perry's in-process LLVM backend fails on src/main.ts; use its external one.
export PERRY_LLVM_INPROCESS="${PERRY_LLVM_INPROCESS:-0}"
cd "$(dirname "$0")/.."

DEVICE="${BLOOM_IOS_DEVICE:-6F220DD1-012C-5FF2-9EE7-BEC1CEA74497}"   # Ralph's iPhone
BUNDLE_ID="com.bloomengine.shooter"
APP="build/BloomShooter.app"
IDENTITY="Apple Development: Ralph Kuepper (372EYFG3C5)"

echo "==> world"

# Same toolchain and PERRY_HOME default as tools/release/release.py. The `perry` launcher on
# PATH pins PERRY_RUNTIME_DIR to the macOS runtime, which makes the iOS link pull in a macOS
# libperry_stdlib.a; without the variable, perry finds target/aarch64-apple-ios/release itself.
PERRY_HOME="${PERRY_HOME:-$HOME/projects/perry/worktrees/perry-main-latest}"
PERRY="$PERRY_HOME/target/release/perry"
unset PERRY_RUNTIME_DIR

# Same assets as a release bundle (tools/release/release.py): every model ships as its ASTC copy.
# The raw 4K PNG textures stay uncompressed in GPU memory, and that is more than an iPhone allows.
echo "==> compress models (only stale ones are redone)"
./tools/gen/compress_assets.sh

echo "==> compile (ios, game-loop) with $PERRY"
"$PERRY" compile src/main.ts -o build/BloomShooter --target ios --features ios-game-loop 2>&1 \
  | grep -Ev '^(warning|ld: warning)|^ *[|=^]|^ *-->|built for newer|duplicate symbol|^ +/Users' \
  | grep -Ev '^\s*$' || true
[ -d "$APP" ] || { echo "no app bundle produced"; exit 1; }

echo "==> trim the bundle's assets (tools/release/assets_bundle.py)"
python3 tools/release/assets_bundle.py "$APP/assets"

echo "==> sign"
xattr -cr "$APP"
codesign --force --sign "$IDENTITY" --entitlements ent.plist \
         --generate-entitlement-der "$APP"

echo "==> install"
xcrun devicectl device install app --device "$DEVICE" "$APP" 2>&1 | grep -E "App installed|bundleID|Error" || true

echo "==> launch"
if [ "${1:-}" = "--console" ]; then
  xcrun devicectl device process launch --console --device "$DEVICE" "$BUNDLE_ID"
else
  xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE_ID" 2>&1 | grep -E "Launched|Error" || true
fi
