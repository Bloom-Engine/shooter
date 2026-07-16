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
  playSound3DEx, voiceSetPosition, voiceStop, voiceSetVolume, voiceSetPitch,
  BUS_SFX, BUS_MUSIC, BUS_UI,
} from 'bloom/audio';
import { fileExists } from 'bloom/core';
import { get, SET_MASTER_VOL, SET_MUSIC_VOL, SET_SFX_VOL } from './settings';
import {
  MAX_ENEMIES, enX, enY, enZ, enAlive, enDying, enKind, vxLast, vzLast,
} from './enemies';

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

// SH-001/SH-052 — wind-coupled ambience. The grass, the canopies and the cloud
// deck all move on the same wind vector; the audio was a static loop. This ties
// a 3D leaf-rustle bed to the forest itself, and its volume to the wind that is
// bending it.
//
// SH-052 — the retrigger timer is gone: EN-062 gives us looping voices, so each
// forest source is now ONE live emitter whose volume rides the wind per frame.
// The three sources are detuned (0.94/1.0/1.07) so they stop being audibly the
// same file — the treeline decorrelates the way a real one does.
const WIND_SOURCES  = 3;
const WIND_PITCH    = [0.94, 1.0, 1.07];
const windSrcX = new Array<number>(WIND_SOURCES);
const windSrcZ = new Array<number>(WIND_SOURCES);
const windVoice = new Array<number>(WIND_SOURCES);
let sfxWind: Sound = NO_SOUND;
let windAmpRef = 0.10;   // the setWind() amplitude this bed was balanced against

// SH-052 — the river. One looping voice per water volume, positioned every
// frame at the closest point of the volume's rectangle to the player: a line
// source faked with a point source that never lets you flank it. Walk the bank
// and the water stays abreast of you; cross it and it passes through you.
const RIVER_MAX = 4;
let riverCount = 0;
const riverX0 = new Array<number>(RIVER_MAX);
const riverX1 = new Array<number>(RIVER_MAX);
const riverZ0 = new Array<number>(RIVER_MAX);
const riverZ1 = new Array<number>(RIVER_MAX);
const riverY  = new Array<number>(RIVER_MAX);
const riverVoice = new Array<number>(RIVER_MAX);
let sfxRiver: Sound = NO_SOUND;

// SH-052 — creature presence. A pool of looping crawl-bed voices assigned to
// the nearest MOVING enemies: the thing you cannot see is audible closing in
// BETWEEN its steps, which is precisely what makes it scary. The tyrant is
// excluded — his footfalls already own the low end.
const CRAWL_VOICES = 4;
const CRAWL_RANGE  = 28.0;   // m — candidates beyond this stay silent anyway
// Per-kind crawl pitch: small = fast ticking, big = slow chitin. Index = kind.
const CRAWL_PITCH  = [1.25, 1.1, 0.95, 0.8, 1.0, 0.95, 0.8];
const crawlVoice = new Array<number>(CRAWL_VOICES);
const crawlEnemy = new Array<number>(CRAWL_VOICES);
// Scratch (per frame, preallocated): candidate flag / dist² / speed / top-set.
const CAND   = new Array<number>(MAX_ENEMIES);
const CANDD2 = new Array<number>(MAX_ENEMIES);
const CANDSP = new Array<number>(MAX_ENEMIES);
const TOPSET = new Array<number>(MAX_ENEMIES);
let sfxCrawl: Sound = NO_SOUND;

// SH-052 — per-kind locomotion one-shots (the step itself; the crawl bed above
// is what lives between them). Two weight classes; the tyrant keeps stepHeavy.
const skitterLight = new Array<Sound>(4);
const skitterHeavy = new Array<Sound>(4);

// Zero-fill every voice slot at module load — a `new Array(n)` slot reads as
// undefined until assigned, and the re-init guards compare against 0.
for (let i = 0; i < WIND_SOURCES; i++) { windVoice[i] = 0; windSrcX[i] = 0; windSrcZ[i] = 0; }
for (let i = 0; i < RIVER_MAX; i++) riverVoice[i] = 0;
for (let i = 0; i < CRAWL_VOICES; i++) { crawlVoice[i] = 0; crawlEnemy[i] = -1; }

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

  sfxWind = optional('assets/sounds/ambient_wind.wav', 0.55, BUS_SFX, 0.25);
  sfxRiver = optional('assets/sounds/river_loop.wav', 0.5, BUS_SFX, 0.05);
  sfxCrawl = optional('assets/sounds/crawl_loop.wav', 0.45, BUS_SFX, 0.1);
  for (let i = 0; i < 4; i++) {
    skitterLight[i] = optional('assets/sounds/skitter_light' + (i + 1) + '.wav', 0.35, BUS_SFX, 0.1);
    skitterHeavy[i] = optional('assets/sounds/skitter_heavy' + (i + 1) + '.wav', 0.45, BUS_SFX, 0.12);
  }
  // The crawl-bed pool starts once, parked far underground at volume 0; slots
  // are ASSIGNED, never re-played — a looping voice is cheap to keep and a
  // re-trigger would restart the bed audibly.
  for (let s = 0; s < CRAWL_VOICES; s++) {
    crawlEnemy[s] = -1;
    crawlVoice[s] = 0;
    if (sfxCrawl.handle !== 0) {
      crawlVoice[s] = playSound3DEx(sfxCrawl, 0, -500, 0, true, 2.5, 45.0, 1.2);
      voiceSetVolume(crawlVoice[s], 0);
    }
  }

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


/// SH-001 — place the leaf-rustle bed on the forest.
///
/// Takes the tree positions and reduces them to a few centroids rather than one
/// emitter per tree: 88 looping 3D voices would be absurd, and the ear cannot
/// localise a rustle that precisely anyway. Sources are seeded by splitting the
/// forest on its own bounding box, so they land where the trees actually are
/// instead of on a hardcoded rectangle — move the forest in the editor and the
/// sound moves with it.
export function initWindAmbience(
  xs: number[], zs: number[], n: number, windAmp: number,
): void {
  windAmpRef = windAmp > 1e-4 ? windAmp : 0.10;
  // Re-init (arena reload): stop the previous emitters before placing new ones,
  // or the old treeline keeps rustling forever.
  for (let b = 0; b < WIND_SOURCES; b++) {
    if (windVoice[b] !== 0) voiceStop(windVoice[b]);
    windVoice[b] = 0;
  }
  if (n <= 0) {
    for (let i = 0; i < WIND_SOURCES; i++) { windSrcX[i] = 0; windSrcZ[i] = 0; }
    return;
  }
  // Bucket the trees into WIND_SOURCES bands along their long axis, and take the
  // mean of each band. Cheap, stable, and it tracks the shape of the treeline.
  let minX = xs[0]; let maxX = xs[0]; let minZ = zs[0]; let maxZ = zs[0];
  for (let i = 1; i < n; i++) {
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (zs[i] < minZ) minZ = zs[i];
    if (zs[i] > maxZ) maxZ = zs[i];
  }
  const alongX = (maxX - minX) >= (maxZ - minZ);
  const lo = alongX ? minX : minZ;
  const hi = alongX ? maxX : maxZ;
  const span = Math.max(1e-3, hi - lo);
  for (let b = 0; b < WIND_SOURCES; b++) {
    let sx = 0; let sz = 0; let c = 0;
    for (let i = 0; i < n; i++) {
      const v = alongX ? xs[i] : zs[i];
      const band = Math.min(WIND_SOURCES - 1, Math.floor(((v - lo) / span) * WIND_SOURCES));
      if (band !== b) continue;
      sx += xs[i]; sz += zs[i]; c++;
    }
    windSrcX[b] = c > 0 ? sx / c : (minX + maxX) * 0.5;
    windSrcZ[b] = c > 0 ? sz / c : (minZ + maxZ) * 0.5;
    // SH-052 — one looping voice per source, detuned, started silent; the
    // per-frame update below owns the volume. refDist 7 / rolloff 0.9 keeps
    // it full inside the treeline and a distant murmur from the open field.
    if (sfxWind.handle !== 0) {
      windVoice[b] = playSound3DEx(sfxWind, windSrcX[b], 3.0, windSrcZ[b], true, 7.0, 75.0, 0.9);
      voiceSetPitch(windVoice[b], WIND_PITCH[b]);
      voiceSetVolume(windVoice[b], 0);
    }
  }
}

/// Per-frame: ride each forest emitter's volume on the CURRENT wind amplitude.
/// Crank setWind()'s amplitude and the trees lean harder and the rustle swells
/// with them. Distance, panning and air absorption are the engine's job now
/// (EN-062) — the px/pz parameters remain for call-site stability but the
/// manual 40 m window is gone: a treeline is faintly audible across a field,
/// and that is correct.
export function updateWindAmbience(
  dt: number, px: number, pz: number, windAmp: number,
): void {
  if (sfxWind.handle === 0) return;
  const amp = windAmp / windAmpRef;
  for (let i = 0; i < WIND_SOURCES; i++) {
    voiceSetVolume(windVoice[i], 0.55 * amp);
  }
}

/// SH-052 — place one looping river emitter per water volume. Rectangles come
/// from the world file (WATER_*), so moving the river in the editor moves its
/// sound. Called once at boot, after initAudioMix.
export function initRiverAmbience(
  count: number, cx: number[], cy: number[], cz: number[],
  sx: number[], sz: number[],
): void {
  for (let i = 0; i < riverCount; i++) {
    if (riverVoice[i] !== 0) voiceStop(riverVoice[i]);
  }
  riverCount = count < RIVER_MAX ? count : RIVER_MAX;
  for (let i = 0; i < riverCount; i++) {
    riverX0[i] = cx[i] - sx[i] * 0.5;
    riverX1[i] = cx[i] + sx[i] * 0.5;
    riverZ0[i] = cz[i] - sz[i] * 0.5;
    riverZ1[i] = cz[i] + sz[i] * 0.5;
    riverY[i]  = cy[i];
    riverVoice[i] = 0;
    if (sfxRiver.handle === 0) continue;
    // refDist ≈ the half-width of the channel: standing on the bank IS the
    // full-volume experience; the falloff starts past the water's edge.
    const halfW = (sx[i] < sz[i] ? sx[i] : sz[i]) * 0.5;
    riverVoice[i] = playSound3DEx(sfxRiver, cx[i], cy[i], cz[i], true, halfW + 2.0, 110.0, 1.0);
    voiceSetVolume(riverVoice[i], 0);
  }
}

/// Per-frame: the emitter is the closest point of the water rectangle to the
/// player — a line source built from a point source that always stays abreast
/// of you. Doppler is intentionally near-zero here (the point tracks you), so
/// the water never chirps as you sprint along the bank.
export function updateRiverAmbience(px: number, pz: number): void {
  for (let i = 0; i < riverCount; i++) {
    if (riverVoice[i] === 0) continue;
    let ex = px;
    if (ex < riverX0[i]) ex = riverX0[i];
    if (ex > riverX1[i]) ex = riverX1[i];
    let ez = pz;
    if (ez < riverZ0[i]) ez = riverZ0[i];
    if (ez > riverZ1[i]) ez = riverZ1[i];
    voiceSetPosition(riverVoice[i], ex, riverY[i], ez);
    voiceSetVolume(riverVoice[i], 0.5);
  }
}

/// SH-052 — assign the crawl-bed pool to the nearest moving enemies and ride
/// each claimed voice's position, volume (speed) per frame. Reads the enemy
/// pool directly; when nothing qualifies (menu, wave cleared) every slot goes
/// silent, so this needs no external gate.
export function updateCreatureLoops(px: number, pz: number): void {
  if (sfxCrawl.handle === 0) return;
  // A candidate crawls: alive, not mid-death, legged-small (not the tyrant),
  // and actually moving — a parked enemy is silent between its steps.
  for (let i = 0; i < MAX_ENEMIES; i++) {
    CAND[i] = 0;
    TOPSET[i] = 0;
    if (enAlive[i] !== 1 || enDying[i] === 1 || enKind[i] === 4) continue;
    const sp = Math.sqrt(vxLast[i] * vxLast[i] + vzLast[i] * vzLast[i]);
    if (sp < 0.4) continue;
    const dx = enX[i] - px;
    const dz = enZ[i] - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 > CRAWL_RANGE * CRAWL_RANGE) continue;
    CAND[i] = 1;
    CANDD2[i] = d2;
    CANDSP[i] = sp;
  }
  // "In the CRAWL_VOICES nearest" by counting strictly-nearer candidates —
  // O(n²) with n = 14 is cheaper than sorting and allocates nothing.
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (CAND[i] === 0) continue;
    let nearer = 0;
    for (let j = 0; j < MAX_ENEMIES; j++) {
      if (j === i || CAND[j] === 0) continue;
      if (CANDD2[j] < CANDD2[i] || (CANDD2[j] === CANDD2[i] && j < i)) nearer++;
    }
    if (nearer < CRAWL_VOICES) TOPSET[i] = 1;
  }
  // Slots keep their enemy while it stays in the top set (stability beats
  // optimality — a swap teleports the voice); everything else is released.
  for (let s = 0; s < CRAWL_VOICES; s++) {
    const e = crawlEnemy[s];
    if (e >= 0 && TOPSET[e] === 1) {
      TOPSET[e] = 2;   // claimed
      continue;
    }
    if (e >= 0) {
      crawlEnemy[s] = -1;
      voiceSetVolume(crawlVoice[s], 0);
    }
  }
  // Free slots pick up the unclaimed remainder.
  for (let s = 0; s < CRAWL_VOICES; s++) {
    if (crawlEnemy[s] >= 0) continue;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (TOPSET[i] !== 1) continue;
      TOPSET[i] = 2;
      crawlEnemy[s] = i;
      voiceSetPitch(crawlVoice[s], CRAWL_PITCH[enKind[i]]);
      break;
    }
  }
  // Ride every claimed voice. Louder the faster it scrabbles; distance and
  // direction are the engine's problem.
  for (let s = 0; s < CRAWL_VOICES; s++) {
    const e = crawlEnemy[s];
    if (e < 0) continue;
    voiceSetPosition(crawlVoice[s], enX[e], enY[e] + 0.4, enZ[e]);
    let g = CANDSP[e] * 0.25;
    if (g > 1) g = 1;
    voiceSetVolume(crawlVoice[s], 0.45 * (0.35 + 0.65 * g));
  }
}

/// SH-052 — one audible step for a non-tyrant kind (the director drives this
/// from the same per-kind stride accumulator the tyrant has always used).
export function skitterStep(kind: number, x: number, y: number, z: number): void {
  const v = Math.floor(Math.random() * 4);
  if (kind === 0 || kind === 1) {
    play3d(skitterLight[v], x, y, z);
  } else {
    play3d(skitterHeavy[v], x, y, z);
  }
}
