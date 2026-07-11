#!/usr/bin/env bash
# Build → sign → install → launch the shooter on a physical iPhone.
#
# Perry's compile step bundles + auto-signs, but its codesign call fails on the
# extended attributes macOS puts on the asset files ("resource fork, Finder
# information, or similar detritus not allowed"), so we strip those and sign
# ourselves. Pass --console to stream stdout/stderr from the device.
set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE="${BLOOM_IOS_DEVICE:-6F220DD1-012C-5FF2-9EE7-BEC1CEA74497}"   # Ralph's iPhone
BUNDLE_ID="com.bloomengine.shooter"
APP="build/BloomShooter.app"
IDENTITY="Apple Development: Ralph Kuepper (372EYFG3C5)"

echo "==> world"
bun tools/build-world.ts assets/worlds/arena_02.world.json src/generated/world.ts >/dev/null

echo "==> compile (ios, game-loop)"
perry compile src/main.ts -o build/BloomShooter --target ios --features ios-game-loop 2>&1 \
  | grep -Ev '^(warning|ld: warning)|^ *[|=^]|^ *-->|built for newer|duplicate symbol|^ +/Users' \
  | grep -Ev '^\s*$' || true
[ -d "$APP" ] || { echo "no app bundle produced"; exit 1; }

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
