#!/usr/bin/env bash
# Install the tvOS RELEASE bundle on an Apple TV with a development signature, and launch it.
#
#   python3 tools/release/release.py --only tvos --no-upload --no-commit --build <current>
#   tools/deploy-tvos.sh [--console] [--args "--perflog 1 --harness p2bot"] [--mem]
#
# --args: command-line arguments for this install (written to launch-args.txt in the copy; the
#         Apple TV passes no argv). --perflog 1 prints the frame rate every two seconds.
# --mem:  the engine prints the app's memory footprint once a second (BLOOM_MEM_STATS).
#
# The bundle is the one release.py left in build/release/tvos (same binary, same trimmed assets
# as TestFlight gets), so what runs here is what ships. It replaces a TestFlight install of the
# game on that Apple TV. One-time: `python3 tools/release/asc.py tv-dev` mints the profile.
# An app the system ends for memory leaves no crash log, only "terminated due to signal 9" here
# and a JetsamEvent report on the device (xcrun devicectl device info files --domain-type
# systemCrashLogs): that is how the 4K textures were found on 2026-11-15.
set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE="${BLOOM_TVOS_DEVICE:-0AB0AD2E-1B93-59B0-AE54-5EEAA66BA0F7}"   # Living Room
BUNDLE_ID="com.bloomengine.shooter"
TEAM="K6UW5YV9F7"
IDENTITY="Apple Development: Ralph Kuepper (372EYFG3C5)"
PROFILE="$HOME/.perry/com_bloomengine_shooter_tvos_dev.mobileprovision"
SRC="build/release/tvos/BloomShooter.app"
APP="build/tvos-dev/BloomShooter.app"

CONSOLE=0; ARGS=""; ENVOPT=()
while [ $# -gt 0 ]; do
  case "$1" in
    --console) CONSOLE=1 ;;
    --args) ARGS="$2"; shift ;;
    --mem) ENVOPT=(--environment-variables '{"BLOOM_MEM_STATS":"1"}') ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
  shift
done

[ -d "$SRC" ] || { echo "no $SRC: run release.py --only tvos --no-upload --no-commit first"; exit 1; }
[ -f "$PROFILE" ] || { echo "no $PROFILE: run python3 tools/release/asc.py tv-dev"; exit 1; }

echo "==> copy + sign for development"
rm -rf build/tvos-dev && mkdir -p build/tvos-dev
ditto "$SRC" "$APP"
cp "$PROFILE" "$APP/embedded.mobileprovision"
[ -n "$ARGS" ] && echo "$ARGS" > "$APP/launch-args.txt"
ENT=build/tvos-dev/entitlements.plist
cat > "$ENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>application-identifier</key><string>$TEAM.$BUNDLE_ID</string>
  <key>com.apple.developer.team-identifier</key><string>$TEAM</string>
  <key>get-task-allow</key><true/>
</dict></plist>
EOF
xattr -cr "$APP"
codesign --force --sign "$IDENTITY" --entitlements "$ENT" --generate-entitlement-der "$APP"

echo "==> install"
xcrun devicectl device install app --device "$DEVICE" "$APP" 2>&1 | grep -E "App installed|bundleID|Error|error" || true

echo "==> launch"
if [ "$CONSOLE" = 1 ]; then
  xcrun devicectl device process launch --console --terminate-existing ${ENVOPT[@]+"${ENVOPT[@]}"} --device "$DEVICE" "$BUNDLE_ID"
else
  xcrun devicectl device process launch --terminate-existing --device "$DEVICE" "$BUNDLE_ID" 2>&1 | grep -E "Launched|Error" || true
fi
