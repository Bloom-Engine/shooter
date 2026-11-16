// No imports on purpose: settings.ts, environment.ts, flora.ts and main.ts all read
// this, and an import cycle through it would be one more module-init order for Perry to get
// wrong.
//
// SH-069 — the engine's low tier: an Android phone whose GPU is in the budget class (a Pixel 4a
// is the reference; the engine classifies the adapter, renderer/low_tier.rs). The engine shades
// with its low-tier shader there, and the game's low-tier budget (fewer and nearer trees and
// props, the light terrain shader, no plants) follows the same answer. Every other Android phone
// takes the mobile profile, as an iPhone does. Known only after initWindow: main.ts sets TIER[0]
// right after it, and code that runs earlier must not ask.
export const TIER = [0];
export function lowTier(): boolean { return TIER[0] === 1; }
// SH-068 — the mid tier (TIER[0] = 2): an older Apple GPU (A-series up to the A14: the 2020 iPad
// Pros' A12Z, an iPad Air 4, an iPhone 11 or 12) behind a big screen. main.ts decides it from the
// adapter name. The look stays the mobile profile's (model shading, plants, grass, water); what
// goes is cost nobody sees at a glance: the light terrain shader, props drawn only near the
// player, the Apple TV's shorter sun-shadow reach, SSAO off by default. On a 12.9" iPad Pro
// (A12Z) the full mobile profile ran fights at about 17 fps, nearly all of it GPU time.
export function midTier(): boolean { return TIER[0] === 2; }
