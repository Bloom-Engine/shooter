#!/bin/bash
# Phase 7.2 - one command that says whether the game still works.
#
#   tools/check.sh              static checks, build, boot, AI, menus   (about 4 minutes)
#   tools/check.sh --no-build   the same against the ./main that is there
#   tools/check.sh --static     only the checks that need no build and no window (what CI runs)
#   tools/check.sh --bot        also a whole ten-wave run by the stand-in    (plus 6-12 minutes)
#   tools/check.sh --perf       also the frame-rate numbers                  (plus 3 minutes)
#
# The harnesses are the ones in src/main.ts, started with `./main --harness <name>`. They open
# the real window, so this needs a logged-in desktop session with a GPU; a hosted CI runner
# cannot do it. Screenshots are skipped while the window is covered: the checks here read the
# log, never a picture, so a covered window does not fail them.
#
# The player's files (settings.json, profile.json, level.txt) are copied aside first and put
# back at the end, whatever happens: MENUTEST saves settings, and a run must never be banked.
#
# Exit code: 0 all passed, 1 something failed. Logs: tools/.testout/check/.
set -u
cd "$(dirname "$0")/.."
OUT=tools/.testout/check
mkdir -p "$OUT"

BUILD=1; STATIC_ONLY=0; BOT=0; PERF=0
for a in "$@"; do
  case "$a" in
    --no-build) BUILD=0 ;;
    --static) STATIC_ONLY=1 ;;
    --bot) BOT=1 ;;
    --perf) PERF=1 ;;
    *) echo "unknown option $a"; exit 2 ;;
  esac
done

FAILS=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILS=$((FAILS + 1)); }

echo "== static"
if python3 tools/check_static.py > "$OUT/static.log" 2>&1; then
  pass "static ($(tail -1 "$OUT/static.log"))"
else
  fail "static: see $OUT/static.log"; grep -E "^(FAIL|ERROR)" "$OUT/static.log" | head -20
fi
if [ $STATIC_ONLY = 1 ]; then [ $FAILS = 0 ]; exit $?; fi

# -- the player's files
SAVE=$(mktemp -d)
for f in settings.json profile.json level.txt; do [ -f $f ] && cp -p $f "$SAVE/$f"; done
restore() {
  pkill -f "main --harness" 2>/dev/null
  for f in settings.json profile.json level.txt; do
    if [ -f "$SAVE/$f" ]; then cp -p "$SAVE/$f" $f; else rm -f $f; fi
  done
  rm -rf "$SAVE"
  mkdir -p "$OUT/shots"; mv shooter_*.png "$OUT/shots/" 2>/dev/null
}
trap restore EXIT

if [ $BUILD = 1 ]; then
  echo "== build"
  if PERRY_LLVM_INPROCESS=0 perry compile src/main.ts -o main > "$OUT/build.log" 2>&1 \
     && grep -q "Wrote executable" "$OUT/build.log"; then
    pass "build"
  else
    fail "build: see $OUT/build.log"; tail -5 "$OUT/build.log"; exit 1
  fi
fi

# run <name> <max seconds> [args...]: start a harness, wait for it to exit or kill it.
# Sets RAN (seconds) and ENDED (1 = it left by itself).
run() {
  local name=$1 max=$2; shift 2
  ./main --harness "$name" "$@" > "$OUT/$name.log" 2>&1 &
  local pid=$!
  RAN=0; ENDED=1
  while kill -0 $pid 2>/dev/null; do
    if [ $RAN -ge $max ]; then kill $pid 2>/dev/null; ENDED=0; break; fi
    sleep 1; RAN=$((RAN + 1))
  done
  wait $pid 2>/dev/null
}
# A runtime error in the log fails any harness (a cross-module reference that does not
# resolve shows up only here, one ReferenceError at a time).
clean() {
  if grep -a -E "ReferenceError|TypeError|panicked|FATAL|Segmentation" "$OUT/$1.log" > "$OUT/$1.err"; then
    fail "$1: runtime error: $(head -1 "$OUT/$1.err" | cut -c1-160)"; return 1
  fi
  return 0
}

echo "== boot (selftest)"
run selftest 120
if clean selftest; then
  if [ $ENDED = 1 ]; then pass "boot: loaded, ran 185 frames and left by itself (${RAN}s)"
  else fail "boot: still running after ${RAN}s"; fi
fi

echo "== AI (aitest)"
run aitest 75
if clean aitest; then
  LINES=$(grep -a -c "^AITEST f=" "$OUT/aitest.log")
  STATES=$(grep -a -o " st[0-9]*" "$OUT/aitest.log" | sort -u | wc -l | tr -d ' ')
  KINDS=$(grep -a -o ":k[0-9]*" "$OUT/aitest.log" | sort -u | wc -l | tr -d ' ')
  if [ "$LINES" -ge 10 ] && [ "$STATES" -ge 3 ] && [ "$KINDS" -ge 2 ]; then
    pass "AI: $LINES samples, $KINDS kinds, $STATES distinct states"
  else
    fail "AI: $LINES samples, $KINDS kinds, $STATES states (want 10+, 2+, 3+)"
  fi
fi

echo "== menus (menutest)"
rm -f tools/.testout/menutest.txt
run menutest 150
if clean menutest; then
  if [ ! -f tools/.testout/menutest.txt ]; then
    fail "menus: the script did not finish (no menutest.txt after ${RAN}s)"
  else
    R=$(python3 - <<'PY'
import re
ok = bad = 0
for line in open('tools/.testout/menutest.txt'):
    m = re.search(r'=(-?[\w.]+) \(want (-?[\w.]+)', line)
    if m:
        if m.group(1) == m.group(2): ok += 1
        else: bad += 1
print(ok, bad)
PY
)
    OKN=${R% *}; BADN=${R#* }
    if [ "$BADN" = 0 ] && [ "$OKN" -ge 20 ]; then pass "menus: $OKN of $OKN checks"
    else fail "menus: $BADN of $((OKN + BADN)) checks wrong"; grep -E "want" tools/.testout/menutest.txt | head -30; fi
  fi
fi

if [ $BOT = 1 ]; then
  echo "== a whole run (p2bot)"
  run p2bot 900
  if clean p2bot; then
    if grep -a -q "P2BOT done won=1" "$OUT/p2bot.log"; then
      pass "run: $(grep -a "P2BOT done" "$OUT/p2bot.log" | tail -1)"
    else
      fail "run: not won after ${RAN}s"
    fi
  fi
fi

if [ $PERF = 1 ]; then
  echo "== frame rate (not a pass/fail check)"
  run fpsprobe 90
  echo "  title screen, as shipped, uncapped:  $(grep -a FPSPROBE "$OUT/fpsprobe.log" | tail -1)"
  cp "$OUT/fpsprobe.log" "$OUT/fpsprobe_default.log"
  run fpsprobe 90 --render-scale 0.5
  echo "  title screen, render scale 0.5:      $(grep -a FPSPROBE "$OUT/fpsprobe.log" | tail -1)"
  run perftest 120
  echo "  in a fight (60-frame windows):       $(grep -a "^PERFT" "$OUT/perftest.log" | awk '{split($3,a,"="); s+=a[2]; n++; if(min==""||a[2]<min)min=a[2]} END {if(n) printf "mean %.1f fps, worst window %.1f fps, %d windows", s/n, min, n}')"
fi

echo
if [ $FAILS = 0 ]; then echo "ALL PASSED"; else echo "$FAILS FAILED"; fi
[ $FAILS = 0 ]
