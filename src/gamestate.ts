// SH-025b — shared run/combat state, out of main.ts.
//
// These are the mutable scalars the frame loop, the enemy director,
// the (future SH-025c) combat module and the HUD all read and write:
// player health, run flags, hit/muzzle feedback timers, the weapon's
// world-space muzzle. They live as properties of one const object
// because Perry does not reliably propagate module-scope `let`
// reassignment across modules — property writes through a const
// binding are the proven pattern (see the CAM array note in main.ts).
//
// gameState: 0 = title screen (world renders as the backdrop), 1 =
// playing. gameOver/gameWon ride here too so the director can end a
// run without reaching into main.

export const GS: any = {
  playerHP: 100,
  gameState: 0,
  gameOver: false,
  muzzleFlashT: 0,
  damageFlashT: 0,
  lastHitAngle: 0,
  lastHitT: 0,
  waveBonus: 0,
  waveBonusT: 0,
  unlockBannerT: 0,
  muzzleX: 0,
  muzzleY: 0,
  muzzleZ: 0,
  hitMarkT: 0,
  levelChangeT: 0,
  runElapsed: 0,
  // Round-9 obstacle-circle count (the arrays stay in main; the count
  // is written during world init and read by the director's steering).
  OBST_COUNT: 0,
};
