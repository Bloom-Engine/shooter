// Plan Phase 4 (SH-059) - the UI kit the HUD and the menus are drawn with.
//
// Engine EN-030 (a widget layer) is still open, so this is the game's own: an atlas of white
// shapes (assets/ui/atlas.png, built by tools/gen/ui_atlas.py) tinted at draw time, a palette
// of MEANINGS (danger, good, accent...) so the colour-blind palettes re-colour everything at
// once, nine-slice panels, text helpers, and the button glyphs (plan 4.6): a key, a mouse
// button or a pad button drawn from the binding table, never a hard-coded "[R]".
//
// Everything draws in the logical 2D space main.ts sets up. Perry rules: top-level functions,
// state in const objects/arrays, nothing touching the engine at module scope (the atlas loads
// on first use, like the font in ui-text.ts).

import { drawRect, loadTexture, fileExists } from 'bloom';
import { drawTextureProRaw } from 'bloom/textures';
import { drawText, measureText } from './ui-text';
import {
  ATLAS_RECT, A_PANEL, A_PANEL_LINE, A_KEY, A_KEY_LINE, A_DISC, A_RING, A_MOUSE_L, A_MOUSE_R,
  A_MOUSE_M, A_TRIGGER, A_STICK, A_DPAD,
} from './ui-atlas';
import {
  kbCode, padCode, keyLabel, padLabel, MOUSE_BASE, PAD_AXIS_BASE, PAD_LSTICK,
} from './binds';

// ---- palette ------------------------------------------------------------------------------
export const C_TEXT = 0;     // body text
export const C_BRIGHT = 1;   // headings, selected rows
export const C_DIM = 2;      // secondary text
export const C_ACCENT = 3;   // the game's amber: selection, ammo, score
export const C_DANGER = 4;   // damage, enemies that know where you are, empty magazine
export const C_GOOD = 5;     // healing, ON
export const C_INFO = 6;     // neutral highlight: dodge, reload, unseen
export const C_PANEL = 7;    // panel fill
export const C_LINE = 8;     // panel outline
export const C_BLACK = 9;
const C_N = 10;

//                 text           bright         dim            accent         danger        good           info           panel       line           black
const PAL_STD  = [226, 224, 216, 255, 246, 226, 150, 152, 158, 255, 196, 96,  238, 72, 56,  120, 232, 150, 124, 204, 240, 12, 14, 18, 112, 118, 128, 0, 0, 0];
// Red-green safe (protan / deutan): danger and good move to the blue-orange axis, which both
// keep apart; the amber accent goes pale so it cannot be read as the orange danger.
const PAL_RG   = [226, 224, 216, 255, 255, 255, 150, 152, 158, 250, 236, 170, 255, 122, 20, 70, 160, 255, 190, 220, 255, 12, 14, 18, 112, 118, 128, 0, 0, 0];
// Blue-yellow safe (tritan): danger red and good teal stay apart; the accent leaves yellow.
const PAL_BY   = [226, 224, 216, 255, 255, 255, 150, 152, 158, 255, 170, 190, 240, 60, 60,  60, 220, 200,  230, 230, 235, 12, 14, 18, 112, 118, 128, 0, 0, 0];
// High contrast: pure colours on opaque black.
const PAL_HC   = [255, 255, 255, 255, 255, 255, 205, 205, 205, 255, 236, 0,   255, 48, 48,  64, 255, 64,   90, 220, 255, 0, 0, 0,    255, 255, 255, 0, 0, 0];

const P = new Array<number>(C_N * 3);
// [0] palette index, [1] 1 = panels opaque (high contrast), [2] atlas state (0 untried,
// 1 loaded, 2 missing), [3] atlas texture handle, [4] 1 = pad glyphs, 0 = keyboard glyphs
// [5] 1 once a palette has been copied in
const U = [0, 0, 0, 0, 0, 0];

export function setPalette(n: number): void {
  let src = PAL_STD;
  if (n === 1) src = PAL_RG;
  else if (n === 2) src = PAL_BY;
  else if (n === 3) src = PAL_HC;
  for (let i = 0; i < C_N * 3; i++) P[i] = src[i];
  U[0] = n;
  U[1] = n === 3 ? 1 : 0;
  U[5] = 1;
}

/// A palette colour with an alpha (0..255).
export function col(c: number, a: number): { r: number, g: number, b: number, a: number } {
  if (U[5] === 0) setPalette(0);
  let al = Math.floor(a);
  if (al < 0) al = 0;
  if (al > 255) al = 255;
  return { r: P[c * 3], g: P[c * 3 + 1], b: P[c * 3 + 2], a: al };
}

/// Panel alpha: what the caller asks for, or opaque in the high-contrast palette.
export function panelA(a: number): number { return U[1] === 1 ? 255 : a; }

export function setPadGlyphs(pad: boolean): void { U[4] = pad ? 1 : 0; }
export function padGlyphs(): boolean { return U[4] === 1; }

// ---- atlas ----------------------------------------------------------------------------------
function atlas(): number {
  if (U[2] === 0) {
    if (fileExists('assets/ui/atlas.png')) {
      const t = loadTexture('assets/ui/atlas.png');
      U[3] = t.handle;
      U[2] = t.handle > 0 ? 1 : 2;
    } else {
      U[2] = 2;
    }
  }
  return U[2] === 1 ? U[3] : 0;
}

export function atlasReady(): boolean { return atlas() !== 0; }

/// A sprite stretched into a rectangle.
export function spr(id: number, x: number, y: number, w: number, h: number, c: number, a: number): void {
  const t = atlas();
  const k = col(c, a);
  if (t === 0) { drawRect(x, y, w, h, k); return; }
  const o = id * 4;
  drawTextureProRaw(t, ATLAS_RECT[o], ATLAS_RECT[o + 1], ATLAS_RECT[o + 2], ATLAS_RECT[o + 3],
                    x, y, w, h, 0, 0, 0, k.r, k.g, k.b, k.a);
}

/// A sprite of size w x h whose point (ox, oy) sits at (px, py), turned `deg` about it.
export function sprRot(id: number, px: number, py: number, w: number, h: number,
                       ox: number, oy: number, deg: number, c: number, a: number): void {
  const t = atlas();
  if (t === 0) return;
  const k = col(c, a);
  const o = id * 4;
  // The engine's origin is the ABSOLUTE pivot (not raylib's offset into the rectangle): the
  // rectangle is placed so its (ox, oy) lands on (px, py), then turned about that point.
  drawTextureProRaw(t, ATLAS_RECT[o], ATLAS_RECT[o + 1], ATLAS_RECT[o + 2], ATLAS_RECT[o + 3],
                    px - ox, py - oy, w, h, px, py, deg, k.r, k.g, k.b, k.a);
}

/// A sprite mirrored left-to-right (the weapon silhouettes face left in the atlas).
export function sprFlip(id: number, x: number, y: number, w: number, h: number, c: number, a: number): void {
  const t = atlas();
  if (t === 0) return;
  const k = col(c, a);
  const o = id * 4;
  drawTextureProRaw(t, ATLAS_RECT[o] + ATLAS_RECT[o + 2], ATLAS_RECT[o + 1], -ATLAS_RECT[o + 2], ATLAS_RECT[o + 3],
                    x, y, w, h, 0, 0, 0, k.r, k.g, k.b, k.a);
}

/// The left `frac` of a sprite, drawn into the left `frac` of the rectangle (fill meters).
export function sprClip(id: number, x: number, y: number, w: number, h: number, frac: number,
                        c: number, a: number): void {
  const t = atlas();
  if (t === 0 || frac <= 0) return;
  const f = frac > 1 ? 1 : frac;
  const k = col(c, a);
  const o = id * 4;
  drawTextureProRaw(t, ATLAS_RECT[o], ATLAS_RECT[o + 1], ATLAS_RECT[o + 2] * f, ATLAS_RECT[o + 3],
                    x, y, w * f, h, 0, 0, 0, k.r, k.g, k.b, k.a);
}

/// Nine-slice: the sprite's corners keep their shape at size `m`, the middle stretches.
/// The source margin is a third of the sprite (the panel and key sprites are built for that).
export function nine(id: number, x: number, y: number, w: number, h: number, m: number,
                     c: number, a: number): void {
  const t = atlas();
  const k = col(c, a);
  if (t === 0) { drawRect(x, y, w, h, k); return; }
  const o = id * 4;
  const sx = ATLAS_RECT[o], sy = ATLAS_RECT[o + 1], sw = ATLAS_RECT[o + 2], sh = ATLAS_RECT[o + 3];
  const smx = sw / 3, smy = sh / 3;
  let mm = m;
  if (mm * 2 > w) mm = w / 2;
  if (mm * 2 > h) mm = h / 2;
  for (let j = 0; j < 3; j++) {
    const syj = j === 0 ? sy : (j === 1 ? sy + smy : sy + sh - smy);
    const dyj = j === 0 ? y : (j === 1 ? y + mm : y + h - mm);
    const dhj = j === 1 ? h - mm * 2 : mm;
    if (dhj <= 0) continue;
    for (let i = 0; i < 3; i++) {
      const sxi = i === 0 ? sx : (i === 1 ? sx + smx : sx + sw - smx);
      const dxi = i === 0 ? x : (i === 1 ? x + mm : x + w - mm);
      const dwi = i === 1 ? w - mm * 2 : mm;
      if (dwi <= 0) continue;
      drawTextureProRaw(t, sxi, syj, smx, smy, dxi, dyj, dwi, dhj, 0, 0, 0, k.r, k.g, k.b, k.a);
    }
  }
}

/// The standard panel: chamfered dark plate with a thin outline.
export function panel(x: number, y: number, w: number, h: number, a: number): void {
  nine(A_PANEL, x, y, w, h, 14, C_PANEL, panelA(a));
  nine(A_PANEL_LINE, x, y, w, h, 14, C_LINE, a * 0.55);
}

// ---- text -----------------------------------------------------------------------------------
export function text(s: string, x: number, y: number, size: number, c: number, a: number): void {
  drawText(s, x, y, size, col(c, a));
}
/// Text with a one-unit dark offset copy behind it, for words that sit on the 3D scene.
export function textS(s: string, x: number, y: number, size: number, c: number, a: number): void {
  drawText(s, x + 1.5, y + 1.5, size, col(C_BLACK, a * 0.7));
  drawText(s, x, y, size, col(c, a));
}
export function textC(s: string, cx: number, y: number, size: number, c: number, a: number): void {
  const w = measureText(s, size);
  drawText(s, cx - w / 2, y, size, col(c, a));
}
export function textCS(s: string, cx: number, y: number, size: number, c: number, a: number): void {
  const w = measureText(s, size);
  textS(s, cx - w / 2, y, size, c, a);
}
export function textR(s: string, rx: number, y: number, size: number, c: number, a: number): void {
  const w = measureText(s, size);
  drawText(s, rx - w, y, size, col(c, a));
}
export function textRS(s: string, rx: number, y: number, size: number, c: number, a: number): void {
  const w = measureText(s, size);
  textS(s, rx - w, y, size, c, a);
}
export function textW(s: string, size: number): number { return measureText(s, size); }

// ---- easing ---------------------------------------------------------------------------------
export function clamp01(t: number): number { return t < 0 ? 0 : (t > 1 ? 1 : t); }
export function easeOut(t: number): number { const u = 1 - clamp01(t); return 1 - u * u * u; }
/// Overshoots a little before settling: for things that pop in.
export function easeBack(t: number): number {
  const u = clamp01(t) - 1;
  return 1 + u * u * (2.7 * u + 1.7);
}

// ---- glyphs (plan 4.6) ------------------------------------------------------------------------
// A glyph is `h` units tall; its width depends on what is printed on it. Both functions below
// take the LEFT edge and the TOP, and glyphW() reports the width so callers can lay out rows.

function keyW(label: string, h: number): number {
  if (label.length <= 1) return h;
  return Math.max(h, measureText(label, h * 0.46) + h * 0.5);
}

export function kbGlyphW(code: number, h: number): number {
  if (code < 0) return h;
  if (code >= MOUSE_BASE) return h * 0.8;
  return keyW(keyLabel(code), h);
}

export function drawKbGlyph(code: number, x: number, y: number, h: number, a: number): void {
  if (code < 0) {
    nine(A_KEY_LINE, x, y, h, h, h * 0.3, C_DIM, a * 0.6);
    return;
  }
  if (code >= MOUSE_BASE) {
    const b = code - MOUSE_BASE;
    const id = b === 0 ? A_MOUSE_L : (b === 1 ? A_MOUSE_R : A_MOUSE_M);
    spr(id, x - h * 0.1, y, h, h, C_BRIGHT, a);
    return;
  }
  const label = keyLabel(code);
  const w = keyW(label, h);
  nine(A_KEY, x, y, w, h, h * 0.3, C_TEXT, a);
  const fs = label.length <= 1 ? h * 0.58 : h * 0.46;
  const tw = measureText(label, fs);
  drawText(label, x + (w - tw) / 2, y + (h * 0.84 - fs) / 2, fs, col(C_PANEL, a));
}

export function padGlyphW(code: number, h: number): number {
  if (code === 4 || code === 5 || code === 6 || code === 7) {
    return Math.max(h * 1.3, measureText(padLabel(code), h * 0.42) + h * 0.6);
  }
  return h;
}

export function drawPadGlyph(code: number, x: number, y: number, h: number, a: number): void {
  if (code < 0) {
    spr(A_RING, x, y, h, h, C_DIM, a * 0.6);
    return;
  }
  const label = padLabel(code);
  if (code <= 3) {
    // Face buttons: a disc with the letter. The four are told apart by letter and position,
    // not by colour (the colours differ between pad makers and say nothing to some players).
    spr(A_DISC, x, y, h, h, C_TEXT, a);
    const fs = h * 0.6;
    const tw = measureText(label, fs);
    drawText(label, x + (h - tw) / 2, y + (h - fs) / 2, fs, col(C_PANEL, a));
    return;
  }
  if (code === 4 || code === 5 || code === 6 || code === 7) {
    const w = padGlyphW(code, h);
    nine(A_PANEL, x, y + h * 0.1, w, h * 0.8, h * 0.26, C_TEXT, a);
    const fs = h * 0.42;
    const tw = measureText(label, fs);
    drawText(label, x + (w - tw) / 2, y + (h - fs) / 2, fs, col(C_PANEL, a));
    return;
  }
  if (code === PAD_AXIS_BASE + 4 || code === PAD_AXIS_BASE + 5) {
    spr(A_TRIGGER, x, y, h, h, C_TEXT, a);
    const fs = h * 0.4;
    const tw = measureText(label, fs);
    drawText(label, x + (h - tw) / 2, y + h * 0.16, fs, col(C_PANEL, a));
    return;
  }
  if (code === 8 || code === 9 || code >= PAD_LSTICK) {
    spr(A_STICK, x, y, h, h, C_TEXT, a);
    const fs = h * 0.42;
    const tw = measureText(label, fs);
    drawText(label, x + (h - tw) / 2, y + (h - fs) / 2, fs, col(C_PANEL, a));
    return;
  }
  if (code >= 10 && code <= 13) {
    // D-pad: the cross, with the arm to press filled in the accent colour.
    spr(A_DPAD, x, y, h, h, C_TEXT, a);
    const k = col(C_ACCENT, a);
    const arm = h * 0.28, len = h * 0.30, m = h * 0.09;
    if (code === 10) drawRect(x + (h - arm) / 2, y + m, arm, len, k);
    else if (code === 11) drawRect(x + (h - arm) / 2, y + h - m - len, arm, len, k);
    else if (code === 12) drawRect(x + m, y + (h - arm) / 2, len, arm, k);
    else drawRect(x + h - m - len, y + (h - arm) / 2, len, arm, k);
    return;
  }
  spr(A_DISC, x, y, h, h, C_TEXT, a);
}

/// Width of the glyph for an action on the device in use.
export function glyphW(action: number, h: number): number {
  if (U[4] === 1) return padGlyphW(padCode(action), h);
  return kbGlyphW(kbCode(action), h);
}

/// The glyph for an action on the device in use.
export function drawGlyph(action: number, x: number, y: number, h: number, a: number): void {
  if (U[4] === 1) drawPadGlyph(padCode(action), x, y, h, a);
  else drawKbGlyph(kbCode(action), x, y, h, a);
}

/// "[glyph] LABEL", right edge at rx. Returns the left edge, so prompts chain leftwards.
export function promptR(action: number, label: string, rx: number, y: number, h: number,
                        c: number, a: number): number {
  const fs = h * 0.62;
  const tw = measureText(label, fs);
  const gw = glyphW(action, h);
  const x0 = rx - tw - gw - h * 0.3;
  drawGlyph(action, x0, y, h, a);
  textS(label, x0 + gw + h * 0.3, y + (h - fs) / 2, fs, c, a);
  return x0;
}

/// "[glyph] LABEL", left edge at x. Returns the right edge.
export function promptL(action: number, label: string, x: number, y: number, h: number,
                        c: number, a: number): number {
  const fs = h * 0.62;
  const gw = glyphW(action, h);
  drawGlyph(action, x, y, h, a);
  textS(label, x + gw + h * 0.3, y + (h - fs) / 2, fs, c, a);
  return x + gw + h * 0.3 + measureText(label, fs);
}
