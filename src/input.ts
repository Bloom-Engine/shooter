import {
  isKeyDown, isKeyPressed,
  isMouseButtonDown, isMouseButtonPressed,
  getMouseDeltaX, getMouseDeltaY,
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
}

const MOUSE_SENSITIVITY = 0.004;

export function initInput(): void {
  // cursor capture is owned by main.ts so it can be toggled with Tab
}

export function readInput(): InputState {
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
    moveX,
    moveZ,
    lookX,
    lookY,
    jump: isKeyPressed(Key.SPACE),
    firePressed: isMouseButtonPressed(0),
    fireDown: isMouseButtonDown(0),
  };
}
