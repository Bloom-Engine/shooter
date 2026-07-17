#!/usr/bin/env bash
# Build Bloom Shooter for the web (SH-054).
#
# Output: dist/web/
#   index.html            Perry-generated game HTML, spliced to boot the Bloom
#                         engine first (engine/native/web/splice_game.py)
#   pkg/                  bloom_web wasm-bindgen output (wasm-pack, ../engine)
#   bloom_glue.js         Engine bootstrap + FFI bridge (copied from engine)
#   jolt_bridge.js        JoltPhysics.js bridge (copied from engine)
#   jolt-physics.mjs      Vendored JoltPhysics.js (downloaded once; the glue
#                         falls back to the CDN when absent)
#   assets/               game assets (models, textures, sounds, worlds, ...)
#   assets_manifest.json  every asset path — drives the glue's prefetch cache
#                         AND its no-XHR fileExists answers
#
# Flags:
#   --skip-bloom   Reuse the existing engine pkg/ (skip wasm-pack)
#   --serve        After building, serve dist/web on http://localhost:8080
#
# Windows notes: run from Git Bash. Python 3 is `python` here, not `python3`.

set -euo pipefail

SHOOTER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_WEB="$SHOOTER_DIR/../engine/native/web"
OUT="$SHOOTER_DIR/dist/web"

# Pick a python that actually runs — on Windows the `python3` on PATH is
# often the Microsoft Store alias stub, which exists but only prints an ad.
PY=""
for cand in python3 python; do
  if "$cand" --version >/dev/null 2>&1; then PY="$cand"; break; fi
done
[ -n "$PY" ] || { echo "error: no working python found" >&2; exit 1; }

skip_bloom=false
serve=false
for arg in "$@"; do
  case "$arg" in
    --skip-bloom) skip_bloom=true ;;
    --serve) serve=true ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -d "$ENGINE_WEB" ]; then
  echo "error: engine web crate not found at $ENGINE_WEB" >&2
  exit 1
fi

if ! $skip_bloom; then
  echo "[1/5] Building bloom_web.wasm (wasm-pack release)..."
  (cd "$ENGINE_WEB" && wasm-pack build --target web --out-dir pkg --no-typescript --release 2>&1 | tail -3)
else
  echo "[1/5] Skipping bloom_web build (--skip-bloom)"
fi

echo "[2/5] Compiling game WASM (perry --target web)..."
# Clean CONTENTS, keep the directory: a dev server serving dist/web holds
# the dir open on Windows, and deleting the root under it fails the build.
mkdir -p "$OUT"
rm -rf "$OUT"/* 2>/dev/null || true
# perry.cmd is the Windows shim; plain perry elsewhere.
PERRY=perry
command -v perry >/dev/null 2>&1 || PERRY=perry.cmd
"$PERRY" compile --target web "$SHOOTER_DIR/src/main.ts" -o "$OUT/game" >/dev/null

echo "[3/5] Assembling dist/web..."
cp -R "$ENGINE_WEB/pkg" "$OUT/pkg"
cp "$ENGINE_WEB/bloom_glue.js" "$OUT/bloom_glue.js"
cp "$ENGINE_WEB/jolt_bridge.js" "$OUT/jolt_bridge.js"

# Vendor JoltPhysics.js so the game runs without CDN access. Downloaded once
# into tools/web/ and committed to neither repo (gitignored via dist/ anyway
# — the cache just avoids re-downloading per build).
JOLT_CACHE="$SHOOTER_DIR/tools/web/jolt-physics.mjs"
if [ ! -f "$JOLT_CACHE" ]; then
  mkdir -p "$SHOOTER_DIR/tools/web"
  echo "  fetching JoltPhysics.js (one-time)..."
  curl -fsSL "https://cdn.jsdelivr.net/npm/jolt-physics@1.0.0/+esm" -o "$JOLT_CACHE" \
    || echo "  (download failed — the page will fall back to the CDN at runtime)"
fi
[ -f "$JOLT_CACHE" ] && cp "$JOLT_CACHE" "$OUT/jolt-physics.mjs"

echo "[4/5] Copying assets + writing manifest..."
cp -R "$SHOOTER_DIR/assets" "$OUT/assets"
# Manifest: every file under assets/, forward slashes, relative to dist/web.
# The glue prefetches these and treats the list as authoritative for
# fileExists — so it must be complete.
(cd "$OUT" && find assets -type f | sed 's|\\|/|g' | sort) \
  | "$PY" -c 'import json,sys; print(json.dumps({"files": [l.strip() for l in sys.stdin if l.strip()]}))' \
  > "$OUT/assets_manifest.json"

echo "[5/5] Splicing engine bootstrap into Perry HTML..."
"$PY" "$ENGINE_WEB/splice_game.py" "$OUT/game.html" "$OUT/index.html"
rm "$OUT/game.html"

WASM_KB=$(($(wc -c < "$OUT/pkg/bloom_web_bg.wasm") / 1024))
HTML_KB=$(($(wc -c < "$OUT/index.html") / 1024))
ASSETS_MB=$(du -sm "$OUT/assets" | cut -f1)
echo ""
echo "Done."
echo "  bloom_web.wasm: ${WASM_KB}KB"
echo "  index.html:     ${HTML_KB}KB"
echo "  assets/:        ${ASSETS_MB}MB"
echo ""
echo "Serve:  cd $OUT && $PY -m http.server 8080"
echo "Open:   http://localhost:8080"

if $serve; then
  (cd "$OUT" && exec "$PY" -m http.server 8080)
fi
