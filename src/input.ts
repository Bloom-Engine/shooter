import {
  isKeyDown, isKeyPressed,
  isMouseButtonDown, isMouseButtonPressed,
  getMouseDeltaX, getMouseDeltaY,
  isMobile,
  getTouchX, getTouchY, isTouchActive, getMaxTouchPoints,
  getScreenWidth, getScreenHeight,
  drawCircle, drawCircleLines, drawText, measureText,
  Key,
} from 'bloom';

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
}

const MOUSE_SENSITIVITY = 0.004;

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
  };
}

export function readInput(): InputState {
  if (MOBILE) return readTouch();

  let moveX = 0;
  let moveZ = 0;

  if (isKeyDown(Key.W) || isKeyDown(Key.UP)) moveZ -= 1;
  if (isKeyDown(Key.S) || isKeyDown(Key.DOWN)) moveZ += 1;
  if (isKeyDown(Key.A) || isKeyDown(Key.LEFT)) moveX -= 1;
  if (isKeyDown(Key.D) || isKeyDown(Key.RIGHT)) moveX += 1;

  const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (len > 1) { moveX /= len; moveZ /= len; }

  const lookX = getMouseDeltaX() * MOUSE_SENSITIVITY;
  const lookY = getMouseDeltaY() * MOUSE_SENSITIVITY;

  return {
    moveX: moveX,
    moveZ: moveZ,
    lookX: lookX,
    lookY: lookY,
    jump: isKeyPressed(Key.SPACE),
    firePressed: isMouseButtonPressed(0),
    fireDown: isMouseButtonDown(0),
    reloadPressed: false,
    swapWeapon: false,
  };
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
