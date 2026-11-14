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
  // Developer overlays (render-pass status line, diagnostics bar). Off in a normal run;
  // F1 toggles them, `--debughud` starts with them on. Test harnesses turn them on.
  debugHud: false,
  playerHP: 100,
  gameState: 0,
  gameOver: false,
  muzzleFlashT: 0,
  damageFlashT: 0,
  // SH-029/SH-043 — where the last hit came from, relative to the camera.
  // Drives the HUD's damage arc, which is what makes damage direction
  // readable WITHOUT relying on colour (the colourblind-safe path).
  lastHitAngle: 0,
  lastHitT: 0,
  // SH-041 — end-of-wave report card + unlock banner.
  waveBonus: 0,
  waveBonusT: 0,
  unlockBannerT: 0,
  unlockBannerWeapon: 2,   // which weapon the banner names (a WPN.W_* index)
  // The yaw the Trooper's skeleton was last posed with (what animUpdate got), so anything
  // that lifts a joint out of model space uses the same number the pose did.
  playerModelYaw: 0,
  // How much the weapon follows the hand instead of the aim (0 held and aimed .. 1 through a
  // roll or a death), and the hand-driven barrel and up directions in world space.
  weaponFree: 0,
  weaponFwdX: 0, weaponFwdY: 0, weaponFwdZ: 1,
  weaponUpX: 0, weaponUpY: 1, weaponUpZ: 0,
  muzzleX: 0,
  muzzleY: 0,
  muzzleZ: 0,
  // SH-043 — hit marker. A white tick + a sound, so a colourblind player
  // gets the same confirmation everyone else does.
  hitMarkT: 0,
  // SH-040 — seconds left on the arena-change notice, and what it says:
  //   1 loading (full-screen cover; the game relaunches into the arena)
  //   2 this platform cannot relaunch itself - ask the player to reopen
  //   3 the chosen arena is the one already loaded
  levelChangeT: 0,
  levelChangeMode: 0,
  levelChangeArena: 0,
  // Seconds since the run began — drives the wave clock and score bonuses.
  runElapsed: 0,
  // Round-9 obstacle-circle count (the arrays stay in main; the count
  // is written during world init and read by the director's steering).
  OBST_COUNT: 0,
  // SH-051b — index where the WALL circles begin (trees before, walls after),
  // so the director can stand the walls down in the stair-mounting zone
  // without ever letting an enemy through a tree.
  OBST_WALL_START: 0,
};
