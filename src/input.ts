import {
  isKeyDown, isKeyPressed,
  isMouseButtonDown, isMouseButtonPressed,
  getMouseDeltaX, getMouseDeltaY,
  isMobile,
  getTouchX, getTouchY, isTouchActive, getMaxTouchPoints,
  getScreenWidth, getScreenHeight,
  drawCircle, drawCircleLines, drawText, measureText,
  isGamepadAvailable, getGamepadAxis,
  isGamepadButtonDown, isGamepadButtonPressed,
  Key,
} from 'bloom';
import { get, SET_SENS, SET_PAD_SENS, SET_INVERT_Y } from './settings';

export interface InputState {
  moveX: number;
  moveZ: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  firePressed: boolean;
  fireDown: boolean;
  // Touch equivalents of the keyboard verbs, so main.ts can OR them into its
  // existing isKeyPressed() checks instead of growing a second code path.
  reloadPressed: boolean;   // R   — reload, or restart once the run has ended
  swapWeapon: boolean;      // 1/2 — toggle rifle <-> blaster
  // SH-028 / SH-032 / SH-038
  aimDown: boolean;         // RMB / LT — shoulder aim
  sprintDown: boolean;      // Shift / LS-click
  crouchDown: boolean;      // C — hold to crouch (SH-048)
  dodgePressed: boolean;    // Ctrl / B
  pausePressed: boolean;    // Esc / Start
  /// True when a pad was the last thing touched — the HUD swaps its glyphs.
  padActive: boolean;
}

const MOUSE_SENSITIVITY = 0.004;

// ---- Gamepad (SH-039 / EN-031) ----------------------------------------------
// Axis + button indices are the engine's canonical map (see the XInput poll in
// native/windows). Sticks are 0..3, triggers 4..5.
const GP_LX = 0, GP_LY = 1, GP_RX = 2, GP_RY = 3, GP_LT = 4, GP_RT = 5;
const GP_A = 0, GP_B = 1, GP_X = 2, GP_Y = 3;
const GP_LB = 4, GP_RB = 5, GP_BACK = 6, GP_START = 7, GP_LS = 8;

const STICK_DEADZONE = 0.18;
const PAD_LOOK_RATE = 2.6;    // radians/sec at full deflection
const TRIGGER_THRESHOLD = 0.4;

let padWasActive = false;
let padTriggerPrev = false;

/// Radial deadzone + a squared response curve. Linear sticks feel twitchy at
/// small deflections and sluggish at large ones; x·|x| gives fine control near
/// centre without giving up the top end.
function stick(ax: number, ay: number, out: number[]): void {
  const m = Math.sqrt(ax * ax + ay * ay);
  if (m < STICK_DEADZONE) { out[0] = 0; out[1] = 0; return; }
  // Rescale so the deadzone edge is 0, not a jump to 0.18.
  const s = (m - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  const curved = s * s;
  out[0] = (ax / m) * curved;
  out[1] = (ay / m) * curved;
}

// Radians of yaw per full-screen-width drag, and of pitch per full-height drag.
// Normalised against the screen instead of raw pixels, so the feel is identical
// on a 3x iPhone and a 2x iPad rather than scaling with pixel density.
const TOUCH_YAW_PER_SCREEN = 3.4;
const TOUCH_PITCH_PER_SCREEN = 2.4;

// The stick only starts steering once the thumb has travelled this far from
// where it landed, so a thumb resting on the glass doesn't creep the player.
const JOY_DEADZONE = 0.14;

export const MOBILE = isMobile();

// ---- Touch state ------------------------------------------------------------
// Which touch slot owns each control, or T_NONE. Tracking the slot — rather
// than re-deriving the control from finger positions every frame — is what
// makes a drag a drag: a look delta is only meaningful against the *same*
// finger as last frame.
const T_NONE = -1;
let joySlot = T_NONE;
let joyOriginX = 0;
let joyOriginY = 0;
let joyCurX = 0;
let joyCurY = 0;
let lookSlot = T_NONE;
let lookLastX = 0;
let lookLastY = 0;
let fireSlot = T_NONE;

// Previous-frame button levels, for rising-edge detection.
let firePrev = false;
let jumpPrev = false;
let reloadPrev = false;
let swapPrev = false;

// Control geometry, recomputed each frame from the screen size and shared with
// the draw pass — the circles you see are hit-tested from these same numbers,
// so what you press is always what you touched.
const CTRL = new Array<number>(14);
const C_SCALE = 0;
const C_JOY_R = 1;
const C_FIRE_X = 2;
const C_FIRE_Y = 3;
const C_FIRE_R = 4;
const C_JUMP_X = 5;
const C_JUMP_Y = 6;
const C_JUMP_R = 7;
const C_RELOAD_X = 8;
const C_RELOAD_Y = 9;
const C_RELOAD_R = 10;
const C_SWAP_X = 11;
const C_SWAP_Y = 12;
const C_SWAP_R = 13;

function layoutControls(sw: number, sh: number): void {
  // Size everything off the screen height, capped so the controls don't balloon
  // on an iPad — a thumb is the same size on every device.
  const s = sh < 1300 ? sh : 1300;
  CTRL[C_SCALE] = s;
  CTRL[C_JOY_R] = s * 0.20;

  CTRL[C_FIRE_R] = s * 0.13;
  CTRL[C_FIRE_X] = sw - s * 0.19;
  CTRL[C_FIRE_Y] = sh - s * 0.19;

  CTRL[C_JUMP_R] = s * 0.085;
  CTRL[C_JUMP_X] = sw - s * 0.44;
  CTRL[C_JUMP_Y] = sh - s * 0.13;

  CTRL[C_RELOAD_R] = s * 0.078;
  CTRL[C_RELOAD_X] = sw - s * 0.17;
  CTRL[C_RELOAD_Y] = sh - s * 0.47;

  CTRL[C_SWAP_R] = s * 0.078;
  CTRL[C_SWAP_X] = sw - s * 0.42;
  CTRL[C_SWAP_Y] = sh - s * 0.40;
}

function hits(x: number, y: number, cx: number, cy: number, r: number): boolean {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

export function initInput(): void {
  // cursor capture is owned by main.ts so it can be toggled with Tab
}

function readTouch(): InputState {
  const sw = getScreenWidth();
  const sh = getScreenHeight();
  layoutControls(sw, sh);

  let jumpDown = false;
  let reloadDown = false;
  let swapDown = false;
  let fireDown = false;
  let lookX = 0;
  let lookY = 0;

  // Release any finger that has lifted before claiming new ones. Slots go
  // sparse the moment a finger lifts out of order, and a released slot keeps
  // reporting its last coordinates — so we scan the whole slot space and let
  // isTouchActive() arbitrate. Walking 0..getTouchCount() instead would read a
  // dead slot as live and pin the stick to wherever the thumb left the glass.
  if (joySlot !== T_NONE && !isTouchActive(joySlot)) joySlot = T_NONE;
  if (lookSlot !== T_NONE && !isTouchActive(lookSlot)) lookSlot = T_NONE;
  if (fireSlot !== T_NONE && !isTouchActive(fireSlot)) fireSlot = T_NONE;

  const maxT = getMaxTouchPoints();
  for (let i = 0; i < maxT; i++) {
    if (!isTouchActive(i)) continue;
    const tx = getTouchX(i);
    const ty = getTouchY(i);

    // Fingers that already own a control keep doing their job.
    if (i === joySlot) {
      joyCurX = tx;
      joyCurY = ty;
      continue;
    }
    if (i === lookSlot || i === fireSlot) {
      // The trigger finger steers too, so you can hold fire and keep aiming
      // with the same thumb instead of having to choose.
      lookX = lookX + ((tx - lookLastX) / sw) * TOUCH_YAW_PER_SCREEN;
      lookY = lookY + ((ty - lookLastY) / sh) * TOUCH_PITCH_PER_SCREEN;
      lookLastX = tx;
      lookLastY = ty;
      continue;
    }

    // A new finger. Buttons win, since they sit inside the look zone.
    if (hits(tx, ty, CTRL[C_FIRE_X], CTRL[C_FIRE_Y], CTRL[C_FIRE_R])) {
      fireSlot = i;
      lookLastX = tx;
      lookLastY = ty;
      continue;
    }
    if (hits(tx, ty, CTRL[C_JUMP_X], CTRL[C_JUMP_Y], CTRL[C_JUMP_R])) {
      jumpDown = true;
      continue;
    }
    if (hits(tx, ty, CTRL[C_RELOAD_X], CTRL[C_RELOAD_Y], CTRL[C_RELOAD_R])) {
      reloadDown = true;
      continue;
    }
    if (hits(tx, ty, CTRL[C_SWAP_X], CTRL[C_SWAP_Y], CTRL[C_SWAP_R])) {
      swapDown = true;
      continue;
    }

    // Left of the split moves, right of it looks. The stick's origin is
    // wherever the thumb lands, so there's no fixed circle to hunt for by feel.
    if (tx < sw * 0.45) {
      if (joySlot === T_NONE) {
        joySlot = i;
        joyOriginX = tx;
        joyOriginY = ty;
        joyCurX = tx;
        joyCurY = ty;
      }
    } else if (lookSlot === T_NONE) {
      lookSlot = i;
      lookLastX = tx;
      lookLastY = ty;
    }
  }

  if (fireSlot !== T_NONE) fireDown = true;

  let moveX = 0;
  let moveZ = 0;
  if (joySlot !== T_NONE) {
    const r = CTRL[C_JOY_R];
    const dx = joyCurX - joyOriginX;
    const dy = joyCurY - joyOriginY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > JOY_DEADZONE * r) {
      const clamped = dist > r ? r : dist;
      const scale = (clamped / r) / dist;
      moveX = dx * scale;
      // Screen-down is world-backward, matching what S does on the keyboard.
      moveZ = dy * scale;
    }
  }

  const firePressedNow = fireDown && !firePrev;
  const jumpPressedNow = jumpDown && !jumpPrev;
  const reloadPressedNow = reloadDown && !reloadPrev;
  const swapPressedNow = swapDown && !swapPrev;
  firePrev = fireDown;
  jumpPrev = jumpDown;
  reloadPrev = reloadDown;
  swapPrev = swapDown;

  // Sprint on touch is a stick gesture, not another button: push the thumb to
  // the rim and you run. Adding a fifth circle to a phone screen already
  // holding four would cost more than it buys.
  const sprinting = joySlot !== T_NONE
    && Math.sqrt(moveX * moveX + moveZ * moveZ) > 0.92;

  return {
    moveX: moveX,
    moveZ: moveZ,
    lookX: lookX,
    lookY: lookY,
    jump: jumpPressedNow,
    firePressed: firePressedNow,
    fireDown: fireDown,
    reloadPressed: reloadPressedNow,
    swapWeapon: swapPressedNow,
    aimDown: false,
    sprintDown: sprinting,
    crouchDown: false,        // no touch crouch control yet
    dodgePressed: false,
    pausePressed: false,
    padActive: false,
  };
}

export function readInput(dt: number): InputState {
  if (MOBILE) return readTouch();

  let moveX = 0;
  let moveZ = 0;

  if (isKeyDown(Key.W) || isKeyDown(Key.UP)) moveZ -= 1;
  if (isKeyDown(Key.S) || isKeyDown(Key.DOWN)) moveZ += 1;
  if (isKeyDown(Key.A) || isKeyDown(Key.LEFT)) moveX -= 1;
  if (isKeyDown(Key.D) || isKeyDown(Key.RIGHT)) moveX += 1;

  const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (len > 1) { moveX /= len; moveZ /= len; }

  const sens = get(SET_SENS);
  const invert = get(SET_INVERT_Y) !== 0 ? -1 : 1;
  let lookX = getMouseDeltaX() * MOUSE_SENSITIVITY * sens;
  let lookY = getMouseDeltaY() * MOUSE_SENSITIVITY * sens * invert;

  let jump = isKeyPressed(Key.SPACE);
  let firePressed = isMouseButtonPressed(0);
  let fireDown = isMouseButtonDown(0);
  let aimDown = isMouseButtonDown(1);
  let sprintDown = isKeyDown(Key.LEFT_SHIFT) || isKeyDown(Key.RIGHT_SHIFT);
  let crouchDown = isKeyDown(Key.C);
  let dodgePressed = isKeyPressed(Key.LEFT_CONTROL) || isKeyPressed(Key.RIGHT_CONTROL);
  let reloadPressed = isKeyPressed(Key.R);
  let swapWeapon = isKeyPressed(Key.Q);
  let pausePressed = isKeyPressed(Key.ESCAPE);

  // --- gamepad, folded into the same verbs ---------------------------------
  // Anything the pad reports is OR'd in rather than replacing the keyboard, so
  // a player can switch mid-fight without the game caring.
  let padUsed = false;
  if (isGamepadAvailable()) {
    const ls = [0, 0];
    const rs = [0, 0];
    stick(getGamepadAxis(GP_LX), getGamepadAxis(GP_LY), ls);
    stick(getGamepadAxis(GP_RX), getGamepadAxis(GP_RY), rs);

    if (ls[0] !== 0 || ls[1] !== 0) {
      moveX = moveX + ls[0];
      moveZ = moveZ + ls[1];
      const l2 = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (l2 > 1) { moveX /= l2; moveZ /= l2; }
      padUsed = true;
    }
    if (rs[0] !== 0 || rs[1] !== 0) {
      // Pad look is a RATE (rad/sec), not a delta — a held stick must keep
      // turning. Mouse look is a delta. Conflating the two is the classic way
      // to get a pad that feels like sludge.
      const padSens = get(SET_PAD_SENS);
      lookX = lookX + rs[0] * PAD_LOOK_RATE * padSens * dt;
      lookY = lookY + rs[1] * PAD_LOOK_RATE * padSens * invert * dt;
      padUsed = true;
    }

    const rt = getGamepadAxis(GP_RT) > TRIGGER_THRESHOLD;
    if (rt) { fireDown = true; padUsed = true; }
    if (rt && !padTriggerPrev) firePressed = true;
    padTriggerPrev = rt;

    if (getGamepadAxis(GP_LT) > TRIGGER_THRESHOLD) { aimDown = true; padUsed = true; }
    if (isGamepadButtonDown(GP_LS)) { sprintDown = true; padUsed = true; }
    if (isGamepadButtonPressed(GP_A)) { jump = true; padUsed = true; }
    if (isGamepadButtonPressed(GP_B)) { dodgePressed = true; padUsed = true; }
    if (isGamepadButtonPressed(GP_X)) { reloadPressed = true; padUsed = true; }
    if (isGamepadButtonPressed(GP_Y)) { swapWeapon = true; padUsed = true; }
    if (isGamepadButtonPressed(GP_START)) { pausePressed = true; padUsed = true; }
  }
  if (padUsed) padWasActive = true;
  // Any mouse movement hands the "last input" crown back to the keyboard, so
  // the HUD's glyphs follow whatever the player is actually holding.
  if (getMouseDeltaX() !== 0 || getMouseDeltaY() !== 0) padWasActive = false;

  return {
    moveX: moveX,
    moveZ: moveZ,
    lookX: lookX,
    lookY: lookY,
    jump: jump,
    firePressed: firePressed,
    fireDown: fireDown,
    reloadPressed: reloadPressed,
    swapWeapon: swapWeapon,
    aimDown: aimDown,
    sprintDown: sprintDown,
    crouchDown: crouchDown,
    dodgePressed: dodgePressed,
    pausePressed: pausePressed,
    padActive: padWasActive,
  };
}

/// SH-039 — pad aim assist. Inside a narrow cone of a target, slow the look
/// stick down. This is the standard console-shooter concession: it is not
/// magnetism (the stick still does all the aiming), it just widens the window
/// in which fine adjustment is possible with a thumb.
export function aimAssistScale(cosToNearestEnemy: number): number {
  if (!padWasActive) return 1;
  // 6° cone.
  const COS_6DEG = 0.9945;
  return cosToNearestEnemy > COS_6DEG ? 0.65 : 1;
}

// Drawn in raw screen pixels, deliberately outside the HUD's scaled 2D camera:
// these circles have to land on exactly the coordinates readTouch() hit-tests,
// or you get controls that don't press where they look.
export function drawTouchControls(): void {
  if (!MOBILE) return;

  const idle = { r: 255, g: 255, b: 255, a: 40 };
  const live = { r: 255, g: 255, b: 255, a: 95 };
  const ink = { r: 255, g: 255, b: 255, a: 165 };

  // The movement stick only appears once a thumb is down — it materialises
  // wherever you touched, so there's nothing to show until then.
  if (joySlot !== T_NONE) {
    const r = CTRL[C_JOY_R];
    drawCircleLines(joyOriginX, joyOriginY, r, idle);
    const dx = joyCurX - joyOriginX;
    const dy = joyCurY - joyOriginY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let hx = joyCurX;
    let hy = joyCurY;
    if (dist > r) {
      hx = joyOriginX + (dx / dist) * r;
      hy = joyOriginY + (dy / dist) * r;
    }
    drawCircle(hx, hy, r * 0.38, live);
  }

  drawCircle(CTRL[C_FIRE_X], CTRL[C_FIRE_Y], CTRL[C_FIRE_R],
             fireSlot !== T_NONE ? live : idle);
  labelAt('FIRE', CTRL[C_FIRE_X], CTRL[C_FIRE_Y], CTRL[C_FIRE_R] * 0.42, ink);

  drawCircle(CTRL[C_JUMP_X], CTRL[C_JUMP_Y], CTRL[C_JUMP_R], idle);
  labelAt('JUMP', CTRL[C_JUMP_X], CTRL[C_JUMP_Y], CTRL[C_JUMP_R] * 0.50, ink);

  drawCircle(CTRL[C_RELOAD_X], CTRL[C_RELOAD_Y], CTRL[C_RELOAD_R], idle);
  labelAt('R', CTRL[C_RELOAD_X], CTRL[C_RELOAD_Y], CTRL[C_RELOAD_R] * 0.80, ink);

  drawCircle(CTRL[C_SWAP_X], CTRL[C_SWAP_Y], CTRL[C_SWAP_R], idle);
  labelAt('GUN', CTRL[C_SWAP_X], CTRL[C_SWAP_Y], CTRL[C_SWAP_R] * 0.52, ink);
}

function labelAt(text: string, cx: number, cy: number, size: number,
                 col: { r: number; g: number; b: number; a: number }): void {
  const w = measureText(text, size);
  drawText(text, cx - w / 2, cy - size / 2, size, col);
}
