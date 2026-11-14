// UI typeface (2026-11, photoreal pass). Drop-in replacements for the engine's
// `drawText` / `measureText` that draw with Rajdhani SemiBold (SIL OFL,
// assets/fonts/) instead of the built-in monospace debug font, so every HUD,
// menu and boot-screen string picks it up by changing one import.
//
// Perry rules this module follows (see docs/perry-quirks.md and the header of
// gamestate.ts):
//   - the font handle lives in a `const` OBJECT that is mutated, never in a
//     reassigned module-level `let` (cross-module reads of those go stale);
//   - nothing touches the engine at module scope: an imported module's body
//     runs before main.ts calls initWindow(), and loadFont() before that
//     panics with "Engine not initialized". The font loads on first use.
//   - missing file -> fall back to the engine font, never throw.
import {
  drawText as engineDrawText, measureText as engineMeasureText,
  loadFont, drawTextEx, measureTextEx, fileExists,
} from 'bloom';

const FONT_PATH = 'assets/fonts/Rajdhani-SemiBold.ttf';
// Rasterised once at this size; drawTextEx scales it. 64 px keeps the large
// title and the banner text sharp, and small HUD text still filters cleanly.
const FONT_PX = 64;
// Rajdhani is narrow with a tall x-height: at the same nominal size it reads
// smaller than the old monospace, so sizes are nudged up and tracking opened a
// little. Callers keep passing the sizes they always did.
const SIZE_SCALE = 1.18;
const TRACKING = 0.06;          // extra advance, as a fraction of the size

// state: 0 not tried, 1 loaded, 2 unavailable (use the engine font)
const UI = { state: 0, handle: 0 };

function ready(): boolean {
  if (UI.state === 0) {
    if (fileExists(FONT_PATH)) {
      const f = loadFont(FONT_PATH, FONT_PX);
      UI.handle = f.handle;
      UI.state = f.handle > 0 ? 1 : 2;
    } else {
      UI.state = 2;
    }
  }
  return UI.state === 1;
}

export function drawText(text: string, x: number, y: number, size: number,
                         color: { r: number, g: number, b: number, a: number }): void {
  if (!ready()) { engineDrawText(text, x, y, size, color); return; }
  const s = size * SIZE_SCALE;
  // The taller glyph box would sit low in rows laid out for the old font:
  // lift by half the size increase so text stays centred on the same line.
  drawTextEx({ handle: UI.handle, size: FONT_PX }, text,
             { x: x, y: y - (s - size) * 0.5 }, s, s * TRACKING, color);
}

export function measureText(text: string, size: number): number {
  if (!ready()) return engineMeasureText(text, size);
  const s = size * SIZE_SCALE;
  const m = measureTextEx({ handle: UI.handle, size: FONT_PX }, text, s, s * TRACKING);
  return m.x;
}
