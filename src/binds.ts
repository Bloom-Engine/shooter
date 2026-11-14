// Plan 4.3 / 4.6 - bindings: which key, mouse button or pad button each action is on.
//
// Until Phase 4 every binding was an `isKeyPressed(Key.R)` at its point of use. This module is
// the one table input.ts reads, the BINDINGS settings tab edits and ui.ts draws glyphs from,
// so a rebound key is rebound in the game, in the settings row and in every HUD hint at once.
//
// Codes. Keyboard: the engine's key code. Mouse: MOUSE_BASE + button. Pad: the engine's button
// index, or PAD_AXIS_BASE + axis for the two triggers. -1 = nothing bound.
//
// Not rebindable, on purpose: the menus (arrows / Enter / Esc and D-pad / A / B), the pause key
// (Esc and Start: a player who unbinds pause cannot reach this screen again), and movement and
// look on the pad's sticks. The arrow keys always move as well as whatever is bound.
//
// Perry rules: top-level functions, state in const arrays, nothing at module scope that calls
// the engine. Edge detection for pad triggers keeps its own previous-state array, so
// padPressed() must be asked once per action per frame (input.ts is the only caller).

import {
  isKeyDown, isKeyPressed, isMouseButtonDown, isMouseButtonPressed,
  isGamepadAvailable, isGamepadButtonDown, isGamepadButtonPressed, getGamepadAxis, Key,
} from 'bloom';

export const ACT_FWD = 0;
export const ACT_BACK = 1;
export const ACT_LEFT = 2;
export const ACT_RIGHT = 3;
export const ACT_JUMP = 4;
export const ACT_FIRE = 5;
export const ACT_AIM = 6;
export const ACT_SPRINT = 7;
export const ACT_CROUCH = 8;
export const ACT_DODGE = 9;
export const ACT_RELOAD = 10;
export const ACT_SWAP = 11;
export const ACT_MELEE = 12;
export const ACT_GRENADE = 13;
export const ACT_SHOULDER = 14;
export const ACT_WPN1 = 15;
export const ACT_WPN2 = 16;
export const ACT_WPN3 = 17;
export const ACT_WPN4 = 18;
export const ACT_PAUSE = 19;
export const ACT_COUNT = 20;

export const MOUSE_BASE = 1000;
export const PAD_AXIS_BASE = 100;
/// Pad code for "the left stick" / "the right stick": drawn, never polled.
export const PAD_LSTICK = 200;
export const PAD_RSTICK = 201;

const TRIGGER_THRESHOLD = 0.4;

//                    fwd back left right jump fire  aim   sprint crouch dodge reload swap melee nade shoulder 1   2   3   4  pause
const KB_DEFAULT = [87,  83,  65,  68,   32,  1000, 1001, 280,   67,    282,  82,    81,  70,   71,  86,      49, 50, 51, 52, 27];
// Pad: A jump, RT fire, LT aim, LS sprint, RS crouch, B dodge, X reload, Y swap, LB melee,
// Back grenade, RB shoulder, D-pad up/right/down/left the four weapons, Start pause.
const PAD_DEFAULT = [200, 200, 200, 200, 0,   105,  104,  8,     9,     1,    2,     3,   4,    6,   5,       10, 13, 11, 12, 7];

const KB = new Array<number>(ACT_COUNT);
const PD = new Array<number>(ACT_COUNT);
const PD_PREV = new Array<number>(ACT_COUNT);
// capture: [0] action being rebound or -1, [1] device (0 keyboard/mouse, 1 pad), [2] frames
// to wait before listening (so the Enter / A that opened the capture is not what gets bound)
const CAP = [-1, 0, 0];

export function resetBinds(): void {
  for (let i = 0; i < ACT_COUNT; i++) {
    KB[i] = KB_DEFAULT[i];
    PD[i] = PAD_DEFAULT[i];
    PD_PREV[i] = 0;
  }
}

export function kbCode(a: number): number { return KB[a]; }
export function padCode(a: number): number { return PD[a]; }
export function setKbCode(a: number, c: number): void { if (a >= 0 && a < ACT_COUNT) KB[a] = c; }
export function setPadCode(a: number, c: number): void { if (a >= 0 && a < ACT_COUNT) PD[a] = c; }

/// May this action be rebound on this device?
export function rebindable(a: number, pad: boolean): boolean {
  if (a === ACT_PAUSE) return false;
  if (pad && a <= ACT_RIGHT) return false;
  return true;
}

// ---- polling ----------------------------------------------------------------------------

function codeDown(c: number): boolean {
  if (c < 0) return false;
  if (c >= MOUSE_BASE) return isMouseButtonDown(c - MOUSE_BASE);
  // Either Shift is Shift, either Ctrl is Ctrl: a binding names the key, not the hand.
  if (c === 280 || c === 281) return isKeyDown(280) || isKeyDown(281);
  if (c === 282 || c === 283) return isKeyDown(282) || isKeyDown(283);
  if (c === 284 || c === 285) return isKeyDown(284) || isKeyDown(285);
  return isKeyDown(c);
}

function codePressed(c: number): boolean {
  if (c < 0) return false;
  if (c >= MOUSE_BASE) return isMouseButtonPressed(c - MOUSE_BASE);
  if (c === 280 || c === 281) return isKeyPressed(280) || isKeyPressed(281);
  if (c === 282 || c === 283) return isKeyPressed(282) || isKeyPressed(283);
  if (c === 284 || c === 285) return isKeyPressed(284) || isKeyPressed(285);
  return isKeyPressed(c);
}

export function kbDown(a: number): boolean { return codeDown(KB[a]); }
export function kbPressed(a: number): boolean { return codePressed(KB[a]); }

export function padDown(a: number): boolean {
  const c = PD[a];
  if (c < 0 || c >= PAD_LSTICK) return false;
  if (c >= PAD_AXIS_BASE) return getGamepadAxis(c - PAD_AXIS_BASE) > TRIGGER_THRESHOLD;
  return isGamepadButtonDown(c);
}

/// Rising edge. Ask once per action per frame.
export function padPressed(a: number): boolean {
  const c = PD[a];
  if (c < 0 || c >= PAD_LSTICK) return false;
  if (c >= PAD_AXIS_BASE) {
    const now = getGamepadAxis(c - PAD_AXIS_BASE) > TRIGGER_THRESHOLD ? 1 : 0;
    const was = PD_PREV[a];
    PD_PREV[a] = now;
    return now === 1 && was === 0;
  }
  return isGamepadButtonPressed(c);
}

// ---- capture ----------------------------------------------------------------------------

// Every key a binding may land on. Function keys are left out: F1-F12 are the developer
// toggles. Escape cancels a capture and is never bound.
const CAPTURE_KEYS = [
  65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
  32, 265, 9, 8, 260, 261, 262, 263, 264,
  256, 257, 258, 259,
  280, 281, 282, 283, 284, 285,
  39, 44, 45, 46, 47, 59, 61, 91, 92, 93, 96,
];
const CAPTURE_KEY_COUNT = 66;   // MUST equal the number of entries above

export function captureStart(a: number, pad: boolean): void {
  CAP[0] = a;
  CAP[1] = pad ? 1 : 0;
  CAP[2] = 3;
}
export function captureCancel(): void { CAP[0] = -1; }
export function capturing(): boolean { return CAP[0] >= 0; }
export function captureAction(): number { return CAP[0]; }
export function capturePad(): boolean { return CAP[1] === 1; }

function assign(a: number, pad: boolean, code: number): void {
  // A code can only be on one action: whoever had it gets this action's old one (a swap), so
  // rebinding can never leave an action silently sharing a key or without one.
  if (pad) {
    const old = PD[a];
    for (let i = 0; i < ACT_COUNT; i++) {
      if (i !== a && PD[i] === code && rebindable(i, true)) PD[i] = old;
    }
    PD[a] = code;
  } else {
    const old = KB[a];
    for (let i = 0; i < ACT_COUNT; i++) {
      if (i !== a && KB[i] === code && rebindable(i, false)) KB[i] = old;
    }
    KB[a] = code;
  }
}

/// Listen for the new binding. Returns 0 still waiting, 1 bound, 2 cancelled, 3 cleared.
export function capturePoll(): number {
  if (CAP[0] < 0) return 2;
  if (CAP[2] > 0) { CAP[2] = CAP[2] - 1; return 0; }
  const a = CAP[0];
  if (isKeyPressed(Key.ESCAPE)) { CAP[0] = -1; return 2; }
  if (CAP[1] === 0) {
    if (isKeyPressed(Key.DELETE)) { KB[a] = -1; CAP[0] = -1; return 3; }
    for (let i = 0; i < CAPTURE_KEY_COUNT; i++) {
      let c = CAPTURE_KEYS[i];
      if (isKeyPressed(c)) {
        if (c === 281) c = 280;
        if (c === 283) c = 282;
        if (c === 285) c = 284;
        assign(a, false, c);
        CAP[0] = -1;
        return 1;
      }
    }
    for (let b = 0; b < 3; b++) {
      if (isMouseButtonPressed(b)) { assign(a, false, MOUSE_BASE + b); CAP[0] = -1; return 1; }
    }
    return 0;
  }
  if (!isGamepadAvailable()) return 0;
  // Start cancels on the pad (it is the pause button and is never bound to anything else).
  if (isGamepadButtonPressed(7)) { CAP[0] = -1; return 2; }
  for (let b = 0; b < 16; b++) {
    if (b === 7) continue;
    if (isGamepadButtonPressed(b)) { assign(a, true, b); CAP[0] = -1; return 1; }
  }
  for (let ax = 4; ax < 6; ax++) {
    if (getGamepadAxis(ax) > 0.7) { assign(a, true, PAD_AXIS_BASE + ax); CAP[0] = -1; return 1; }
  }
  return 0;
}

// ---- names (for the keycap glyphs) -------------------------------------------------------

/// What is printed on the key. Short: it has to fit a keycap.
export function keyLabel(c: number): string {
  if (c < 0) return '';
  if (c >= 65 && c <= 90) return String.fromCharCode(c);
  if (c >= 48 && c <= 57) return String.fromCharCode(c);
  if (c === 32) return 'SPACE';
  if (c === 265) return 'ENTER';
  if (c === 27) return 'ESC';
  if (c === 9) return 'TAB';
  if (c === 8) return 'BKSP';
  if (c === 127) return 'DEL';
  if (c === 260) return 'INS';
  if (c === 261) return 'HOME';
  if (c === 262) return 'END';
  if (c === 263) return 'PGUP';
  if (c === 264) return 'PGDN';
  if (c === 256) return 'UP';
  if (c === 257) return 'DOWN';
  if (c === 258) return 'LEFT';
  if (c === 259) return 'RIGHT';
  if (c === 280 || c === 281) return 'SHIFT';
  if (c === 282 || c === 283) return 'CTRL';
  if (c === 284 || c === 285) return 'ALT';
  if (c === 39) return "'";
  if (c === 44) return ',';
  if (c === 45) return '-';
  if (c === 46) return '.';
  if (c === 47) return '/';
  if (c === 59) return ';';
  if (c === 61) return '=';
  if (c === 91) return '[';
  if (c === 92) return '\\';
  if (c === 93) return ']';
  if (c === 96) return '`';
  return '?';
}

/// What is printed on a pad button (the Xbox letters; the engine does not say which pad it is).
export function padLabel(c: number): string {
  if (c === 0) return 'A';
  if (c === 1) return 'B';
  if (c === 2) return 'X';
  if (c === 3) return 'Y';
  if (c === 4) return 'LB';
  if (c === 5) return 'RB';
  if (c === 6) return 'BACK';
  if (c === 7) return 'START';
  if (c === 8) return 'L';
  if (c === 9) return 'R';
  if (c === 104) return 'LT';
  if (c === 105) return 'RT';
  if (c === PAD_LSTICK) return 'L';
  if (c === PAD_RSTICK) return 'R';
  return '';
}

// ---- persistence (settings.ts owns the file) ----------------------------------------------

/// `"k0": 87, "p0": 200, ...` - the inside of the "binds" object in settings.json.
export function bindsJson(): string {
  let s = '';
  for (let i = 0; i < ACT_COUNT; i++) {
    if (i > 0) s = s + ', ';
    s = s + '"k' + i + '": ' + KB[i] + ', "p' + i + '": ' + PD[i];
  }
  return s;
}

export function bindsFromObject(o: any): void {
  if (o === null || o === undefined) return;
  for (let i = 0; i < ACT_COUNT; i++) {
    const k = o['k' + i];
    if (k !== undefined && k !== null && rebindable(i, false)) {
      const kn = k as number;
      if (kn === kn) KB[i] = kn;
    }
    const p = o['p' + i];
    if (p !== undefined && p !== null && rebindable(i, true)) {
      const pn = p as number;
      if (pn === pn) PD[i] = pn;
    }
  }
}
