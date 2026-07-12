// Round 2 — SH-003 / SH-035 / SH-036: the game's side of the audio work.
//
// The engine now has buses, a reverb send and a per-voice low-pass (EN-029).
// This module decides *when* to use them, and owns the three things that were
// simply missing: footsteps, a weapon tail that changes with the space you're
// standing in, and music that responds to the fight.
//
// Assets: several of these SFX do not exist yet (see docs/ASSET-TODO.md A1-A6).
// Every load goes through `optional()`, which returns a null handle the play
// functions silently skip — so the *systems* are complete and testable now, and
// dropping the real files in later needs no code change.

import { Sound } from 'bloom';
import {
  loadSound, playSound, playSound3D, setSoundVolume,
  setSoundBus, setSoundReverbSend, setSoundLowpass,
  setBusGain, duckBus, setReverb,
  BUS_SFX, BUS_MUSIC, BUS_UI,
} from 'bloom/audio';
import { fileExists } from 'bloom/core';
import { get, SET_MASTER_VOL, SET_MUSIC_VOL, SET_SFX_VOL } from './settings';

const NO_SOUND: Sound = { handle: 0 } as Sound;

/// Load a sound that may not be in the repo yet. A missing file must not be a
/// crash and must not be a silent mystery either — it is logged once and the
/// call sites keep working.
function optional(path: string, vol: number, bus: number, send: number): Sound {
  if (!fileExists(path)) return NO_SOUND;
  const s = loadSound(path);
  setSoundVolume(s, vol);
  setSoundBus(s, bus);
  if (send > 0) setSoundReverbSend(s, send);
  return s;
}

function play(s: Sound): void {
  if (s.handle !== 0) playSound(s);
}
function play3d(s: Sound, x: number, y: number, z: number): void {
  if (s.handle !== 0) playSound3D(s, x, y, z);
}

// ---- footstep banks (SH-003) ------------------------------------------------
const STEP_VARIANTS = 4;
const stepGrass = new Array<Sound>(STEP_VARIANTS);
const stepDirt  = new Array<Sound>(STEP_VARIANTS);
let stepWater: Sound = NO_SOUND;
let stepHeavy: Sound = NO_SOUND;   // tyrant

// Reload + UI
let sfxReloadStart: Sound = NO_SOUND;
let sfxReloadEnd: Sound = NO_SOUND;
let sfxUiMove: Sound = NO_SOUND;
let sfxUiSelect: Sound = NO_SOUND;

// Weapon tails, indexed by weapon id (see weapons.ts).
const weaponTail = new Array<Sound>(4);

//   0 stride accumulator  1 last surface  2 reverb wet (current)
//   3 music intensity (0 calm, 1 combat)  4 intensity blend
const S = [0, 0, 0, 0, 0];

export function initAudioMix(): void {
  for (let i = 0; i < STEP_VARIANTS; i++) {
    stepGrass[i] = optional('assets/sounds/step_grass' + (i + 1) + '.wav', 0.30, BUS_SFX, 0.15);
    stepDirt[i]  = optional('assets/sounds/step_dirt' + (i + 1) + '.wav',  0.30, BUS_SFX, 0.15);
  }
  stepWater = optional('assets/sounds/splash1.wav', 0.30, BUS_SFX, 0.1);
  stepHeavy = optional('assets/sounds/step_heavy1.wav', 0.55, BUS_SFX, 0.25);

  sfxReloadStart = optional('assets/sounds/reload_start.wav', 0.45, BUS_SFX, 0.1);
  sfxReloadEnd   = optional('assets/sounds/reload_end.wav',   0.45, BUS_SFX, 0.1);
  sfxUiMove      = optional('assets/sounds/ui_move.wav',   0.35, BUS_UI, 0);
  sfxUiSelect    = optional('assets/sounds/ui_select.wav', 0.45, BUS_UI, 0);

  weaponTail[0] = optional('assets/sounds/rifle_tail.wav',   0.5, BUS_SFX, 1.0);
  weaponTail[1] = optional('assets/sounds/blaster_tail.wav', 0.5, BUS_SFX, 1.0);
  weaponTail[2] = optional('assets/sounds/chain_tail.wav',   0.5, BUS_SFX, 1.0);
  weaponTail[3] = optional('assets/sounds/cannon_tail.wav',  0.6, BUS_SFX, 1.0);

  applyVolumes();
  // A dry-ish outdoor default: some size, quite damped, barely any wet. The
  // zone logic below rides `wet` up as the player moves into the building.
  setReverb(0.55, 0.65, 0.03);
}

/// Push the settings volumes into the buses. Called at boot and whenever the
/// options menu changes a slider.
export function applyVolumes(): void {
  const master = get(SET_MASTER_VOL);
  setBusGain(BUS_SFX, get(SET_SFX_VOL) * master);
  setBusGain(BUS_MUSIC, get(SET_MUSIC_VOL) * master);
  setBusGain(BUS_UI, master);
}

// ---- footsteps --------------------------------------------------------------

/// Accumulate distance travelled and fire a step each stride. Distance-based
/// (not timer-based) so the cadence automatically matches sprinting, walking
/// and being slowed, without a single extra branch.
///
/// `surface`: 0 grass, 1 dirt, 2 water.
/// Returns true on the frames a step actually fired, so the caller can kick up
/// dust in the same instant (SH-033).
export function updateFootsteps(
  dist: number, surface: number, grounded: boolean,
  x: number, y: number, z: number,
): boolean {
  if (!grounded) return false;
  const STRIDE = 1.9;
  S[0] = S[0] + dist;
  if (S[0] < STRIDE) return false;
  S[0] = 0;

  const v = Math.floor(Math.random() * STEP_VARIANTS);
  if (surface === 2) {
    play3d(stepWater, x, y, z);
  } else if (surface === 1) {
    play3d(stepDirt[v], x, y, z);
  } else {
    play3d(stepGrass[v], x, y, z);
  }
  return true;
}

/// A tyrant's footfall. Heavy, positional, and it feeds the camera a little
/// trauma from the caller — you should be able to hear (and feel) the big one
/// coming before you see it.
export function tyrantStep(x: number, y: number, z: number): void {
  play3d(stepHeavy, x, y, z);
}

// ---- weapons ----------------------------------------------------------------

/// The tail is what makes a gun sound big. It rides the reverb send, so the
/// same shot is dry in the open field and cracks off the walls indoors.
export function weaponTailFor(weapon: number, x: number, y: number, z: number): void {
  if (weapon >= 0 && weapon < 4) play3d(weaponTail[weapon], x, y, z);
}

export function reloadStart(): void { play(sfxReloadStart); }
export function reloadEnd(): void { play(sfxReloadEnd); }
export function uiMove(): void { play(sfxUiMove); }
export function uiSelect(): void { play(sfxUiSelect); }

// ---- reverb zones (SH-035) --------------------------------------------------

/// Ride the global reverb wet toward what the player's surroundings imply.
/// `enclosure` is 0 (open field) .. 1 (inside the building) — the caller
/// computes it from proximity to the building footprint.
///
/// Ramped, not switched: teleporting the wet level as you cross a doorway is
/// audible as a click on any tail that happens to be sounding.
export function updateReverbZone(dt: number, enclosure: number): void {
  const target = 0.03 + enclosure * 0.42;
  const k = 1 - Math.exp(-2.5 * dt);
  S[2] = S[2] + (target - S[2]) * k;
  setReverb(0.55 + enclosure * 0.25, 0.65 - enclosure * 0.25, S[2]);
}

/// Occlusion: the game raycasts (it is the only one who can) and hands us the
/// verdict. A blocked emitter is LOW-PASSED, not just quieter — muffling is
/// what the ear reads as "there is a wall there".
export function setOccluded(s: Sound, blocked: boolean): void {
  if (s.handle === 0) return;
  setSoundLowpass(s, blocked ? 900 : 0);
}

// ---- music (SH-036) ---------------------------------------------------------

/// Duck the music when the player takes a hit. The single most-used mix move in
/// the genre: it makes damage audible even when the screen is busy.
export function duckMusicOnDamage(): void {
  duckBus(BUS_MUSIC, 0.55, 0.05, 1.2, 1.5);
}

/// Near-death: pull everything but the player's own feedback down, so the
/// heartbeat of a bad situation comes through.
export function duckForLowHealth(active: boolean): void {
  if (active) duckBus(BUS_MUSIC, 0.35, 0.4, 1.5, 0.6);
}

/// Track combat intensity so the music (once real stems exist — ASSET-TODO A4)
/// can crossfade between calm and combat. Today both stems are the same track,
/// so this drives only the bus level; the moment two stems land, the crossfade
/// has somewhere to go.
export function updateMusicIntensity(dt: number, enemiesAlive: number, waveActive: boolean): void {
  const target = (waveActive && enemiesAlive > 0) ? 1 : 0;
  S[3] = target;
  const k = 1 - Math.exp(-0.5 * dt);   // ~2 s crossfade, with natural hysteresis
  S[4] = S[4] + (target - S[4]) * k;
  const base = get(SET_MUSIC_VOL) * get(SET_MASTER_VOL);
  // Calm sits ~35% quieter than combat.
  setBusGain(BUS_MUSIC, base * (0.65 + 0.35 * S[4]));
}

export function musicIntensity(): number { return S[4]; }
