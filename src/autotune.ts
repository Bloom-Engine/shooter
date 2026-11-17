// autotune.ts - pick the best graphics settings this PC can run (desktop).
//
// A first run, a run on a GPU the settings file has not seen, `--recalibrate 1`, or the
// DETECT BEST SETTINGS row starts it. On the title screen it walks a ladder of quality RUNGS,
// from Ultra at native output down to Low with the sun's shadows off, timing each rung it
// visits with the frame cap, vsync and dynamic resolution off, and keeps the best rung that
// holds the frame rate. It starts at High and moves up while a rung holds 60 fps in a fight and
// down while it does not, so a fast GPU and a slow one each need few steps (about three seconds
// each). Leaving the title screen ends it early with the best rung measured so far.
//
// This module only DECIDES. main.ts applies a rung (menu.ts applyQualityRung) and restores the
// frame cap and dynamic resolution when it finishes, so this file imports nothing from the menus
// (menu.ts imports `request` from here, and a cycle between the two is a Perry risk).
//
// Perry rules this module follows: state lives in const arrays (no exported `let`), no nested
// functions, no closures, numbers across every call.

// The ladder, best first: quality preset (0 low .. 3 ultra), output scale, sun shadows.
export const RUNG_COUNT = 7;
const RUNG_PRESET = [3, 2, 2, 2, 1, 0, 0];
const RUNG_OUT    = [1.0, 1.0, 0.75, 0.5, 0.5, 0.5, 0.5];
const RUNG_SUN    = [1, 1, 1, 1, 1, 1, 0];

// The title screen runs about 25% faster than a fight (Radeon 760M, 2026-11-16: title 36 fps
// against a fight's 29 at the same settings), so a rung "holds 60 in a fight" when the title
// runs at 75, and "holds 30" at 38.
//  0 holds-60 threshold  1 holds-30 threshold (title fps)
const TH = [75, 38];
// Stepping down a rung must gain at least this much, or the frame is not limited by the GPU
// (a slow CPU) and lower settings only cost picture.
const MIN_GAIN = 1.08;
const WAIT_TITLE_S = 3.0;   // the title has been on screen this long before the first rung
const SETTLE_S = 1.0;       // after a rung is applied (a new output scale rebuilds the swapchain)
const MEASURE_S = 2.0;

export const ACT_NONE = 0;
export const ACT_APPLY = 1;    // apply rungPreset/rungOut/rungSun of `current()`
export const ACT_FINISH = 2;   // apply `current()`, restore cap + dynamic resolution, save

const PH_IDLE = 0, PH_WAIT = 1, PH_SETTLE = 2, PH_MEASURE = 3;
//  0 phase  1 current rung  2 phase start time  3 frames counted  4 start rung
//  5 requested (1 = start when next on the title)  6 seconds on the title so far
//  7 last time seen  8 first rung measured (1 once any)
const A = [PH_IDLE, 2, 0, 0, 2, 0, 0, -1, 0];
const FPS = new Array<number>(RUNG_COUNT);
for (let i = 0; i < RUNG_COUNT; i++) FPS[i] = -1;

export function rungPreset(r: number): number { return RUNG_PRESET[r]; }
export function rungOut(r: number): number { return RUNG_OUT[r]; }
export function rungSun(r: number): number { return RUNG_SUN[r]; }
export function current(): number { return A[1]; }
export function active(): boolean { return A[0] !== PH_IDLE || A[5] === 1; }
export function measuring(): boolean { return A[0] !== PH_IDLE; }
export function fpsOf(r: number): number { return FPS[r]; }

/// For a test on a slow GPU (`--autotune-easy 1`): thresholds a quarter as high, so the walk
/// climbs the ladder instead of descending it.
export function setEasy(): void { TH[0] = 19; TH[1] = 10; }

/// Ask for a run. `startRung` is where the walk begins (2 = High at 75% output).
export function request(startRung: number): void {
  A[5] = 1;
  A[4] = startRung < 0 ? 0 : (startRung >= RUNG_COUNT ? RUNG_COUNT - 1 : startRung);
}

/// The best rung measured so far: the best one that holds 60 in a fight, else the best that
/// holds 30, else the best within 8% of the fastest (a CPU-limited machine gains nothing lower).
/// -1 when nothing was measured.
export function decide(): number {
  let max = -1;
  for (let r = 0; r < RUNG_COUNT; r++) if (FPS[r] > max) max = FPS[r];
  if (max < 0) return -1;
  for (let r = 0; r < RUNG_COUNT; r++) if (FPS[r] >= TH[0]) return r;
  for (let r = 0; r < RUNG_COUNT; r++) if (FPS[r] >= TH[1]) return r;
  for (let r = 0; r < RUNG_COUNT; r++) if (FPS[r] >= 0 && FPS[r] >= max / MIN_GAIN) return r;
  return RUNG_COUNT - 1;
}

function finish(): number {
  const d = decide();
  A[1] = d < 0 ? A[4] : d;
  A[0] = PH_IDLE;
  return ACT_FINISH;
}

function goTo(r: number, now: number): number {
  A[1] = r;
  A[0] = PH_SETTLE;
  A[2] = now;
  return ACT_APPLY;
}

/// Once per frame. `onTitle`: the player is on the title screen or its menus (not in a run).
export function update(now: number, onTitle: boolean): number {
  const dt = A[7] < 0 ? 0 : now - A[7];
  A[7] = now;
  if (A[0] === PH_IDLE) {
    if (A[5] !== 1) return ACT_NONE;
    if (!onTitle) { A[6] = 0; return ACT_NONE; }
    A[6] = A[6] + dt;
    if (A[6] < WAIT_TITLE_S) return ACT_NONE;
    A[5] = 0;
    A[6] = 0;
    for (let i = 0; i < RUNG_COUNT; i++) FPS[i] = -1;
    return goTo(A[4], now);
  }
  if (!onTitle) return finish();
  if (A[0] === PH_SETTLE) {
    if (now - A[2] >= SETTLE_S) { A[0] = PH_MEASURE; A[2] = now; A[3] = 0; }
    return ACT_NONE;
  }
  // PH_MEASURE
  A[3] = A[3] + 1;
  const el = now - A[2];
  if (el < MEASURE_S) return ACT_NONE;
  const r = A[1];
  const fps = A[3] / el;
  FPS[r] = fps;
  if (fps >= TH[0]) {
    // Holds 60: try the next better rung unless it was measured already (it failed).
    if (r > 0 && FPS[r - 1] < 0) return goTo(r - 1, now);
    return finish();
  }
  // Too slow. Stop if this step down gained nothing over the rung above (CPU-limited).
  if (r > 0 && FPS[r - 1] >= 0 && fps < FPS[r - 1] * MIN_GAIN) return finish();
  if (r < RUNG_COUNT - 1 && FPS[r + 1] < 0) return goTo(r + 1, now);
  return finish();
}
