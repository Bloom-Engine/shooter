#!/bin/bash
# Raw store captures: runs the game's own picture harnesses (src/main.ts) per arena and files
# what they write under store/screenshots/raw/captures/<arena>/<harness>/. No source change:
# STORESHOT (a real wave staged for the camera, with and without the HUD), UISHOT (menus, HUD,
# objective waves), SCENESHOT (fixed views of the level art). STORE_BIN=<binary> runs another build.
#
#   store/tools/capture.sh                       the default list below
#   store/tools/capture.sh arena_06:p2bot:--wave:10 arena_02:uishot   chosen runs
#
# Run it in the logged-in desktop session, on the built-in screen (the game is borderless
# fullscreen at native resolution, and a covered window skips its screenshots). Every run goes
# through ../agents/run_locked.sh, the machine-wide one-window-at-a-time lock. The binary is
# COPIED first (another session may relink ./main mid-run); build it before you start.
# settings.json, profile.json and level.txt are put back after every run.
# Then: pick shots into store/screenshots/raw/<shot>.png (store/tools/shots.json says which),
# python3 store/tools/frame_screenshots.py, python3 store/tools/build_metadata.py.
set -u
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
LOCK="$ROOT/../agents/run_locked.sh"
CAP="$ROOT/store/screenshots/raw/captures"
BIN=$(mktemp -d)/main
cp -p "${STORE_BIN:-./main}" "$BIN" || { echo "no ./main: build it first (or set STORE_BIN)"; exit 1; }

RUNS=("$@")
if [ ${#RUNS[@]} -eq 0 ]; then
  # STORESHOT (a staged real wave, each moment with and without the HUD) per arena, a mid or
  # late wave and a different weapon each; the Matriarch; the menus; the level art.
  RUNS=(arena_02:storeshot:--shots:8:--wave:6:--weapon:1
        arena_03:storeshot:--shots:8:--wave:7:--weapon:5
        arena_04:storeshot:--shots:8:--wave:8:--weapon:3
        arena_05:storeshot:--shots:8:--wave:5:--weapon:6
        arena_06:storeshot:--shots:8:--wave:9:--weapon:2
        arena_06:storeshot:--shots:8:--wave:10:--weapon:3
        arena_02:uishot arena_03:sceneshot arena_06:sceneshot)
fi

SAVE=$(mktemp -d)
for f in settings.json profile.json level.txt; do [ -f $f ] && cp -p $f "$SAVE/$f"; done
restore() {
  for f in settings.json profile.json level.txt; do
    if [ -f "$SAVE/$f" ]; then cp -p "$SAVE/$f" $f; else rm -f $f; fi
  done
}
trap 'restore; rm -rf "$SAVE" "$(dirname "$BIN")"' EXIT

for spec in "${RUNS[@]}"; do
  IFS=: read -r arena harness extra <<< "$spec"
  args=(); [ -n "${extra:-}" ] && IFS=: read -r -a args <<< "$extra"
  tag=$(printf %s "${extra:-}" | tr -d -- "-" | tr ":" "_"); out="$CAP/$arena/$harness${tag:+_$tag}"; mkdir -p "$out"; rm -f "$out"/*.png "$out"/*.jpg
  echo "== $arena $harness ${args[*]+${args[*]}}"
  # Inside the lock: choose the arena, run, collect, put the player's files back. Pictures
  # land in the repo root as shooter_*.png; only the ones newer than this run's marker move.
  "$LOCK" 420 bash -c '
    cd "$1"; arena=$2; bin=$3; out=$4; harness=$5; shift 5
    mark=$(mktemp); echo "$arena" > level.txt
    "$bin" --harness "$harness" "$@" > "$out/run.log" 2>&1
    find . -maxdepth 1 -name "shooter_*.png" -newer "$mark" -exec mv {} "$out/" \;
    rm -f "$mark"' _ "$ROOT" "$arena" "$BIN" "$out" "$harness" ${args[@]+"${args[@]}"}
  restore
  # PNG at native size is ~15 MB a picture: keep JPEG (quality 92) only.
  for png in "$out"/*.png; do
    [ -f "$png" ] && sips -s format jpeg -s formatOptions 92 "$png" --out "${png%.png}.jpg" >/dev/null && rm -f "$png"
  done
  n=$(ls "$out"/*.jpg 2>/dev/null | wc -l | tr -d ' ')
  grep -a -E "ReferenceError|TypeError|panicked|FATAL" "$out/run.log" | head -1
  echo "   $n pictures -> $out"
done
