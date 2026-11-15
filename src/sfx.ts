// Plan Phase 5 (SH-063) - audio and effects depth: everything that makes one event sound and
// look different from the last one of its kind.
//
//   WEAPONS    three reports per weapon, never the same one twice running, each at a slightly
//              different pitch; the mechanism after the shot (bolt, pump, capacitor); the
//              casing landing on what the Trooper stands on; a dry click; the swap; a reload
//              in stages, with its own set for the energy weapons.
//   CREATURES  an idle murmur from the ones that have not seen the player, an alert call from
//              the one that has, and every vocal muffled (low-pass) when a wall stands
//              between it and the camera.
//   IMPACTS    `impact()` asks what a round hit (earth, wood, masonry, metal, water) and
//              plays that material's sound and particles.
//   AMBIENCE   birds by day, insects by night, room tone indoors, as three always-running
//              loops whose levels follow the arena's time of day and the enclosure.
//   LIGHT      an explosion lights its surroundings for half a second.
//
// Every file is optional: a missing one is a silent handle and the call sites carry on, so a
// checkout without the generated sounds still runs (tools/gen/sfx.py makes them).
//
// Nobody has LISTENED to any of this: the files were checked for length, level and spectrum,
// and the levels below are first guesses.
//
// Perry rules: top-level functions, flat arrays, state in const arrays, no engine call at
// module scope (initSfx does the loading).

import { Sound, vec3 } from 'bloom';
import {
  loadSound, setSoundVolume, setSoundBus, setSoundReverbSend,
  playSoundEx, playSound3DEx, voiceSetPitch, voiceSetVolume, voiceSetLowpass,
  BUS_SFX,
} from 'bloom/audio';
import { fileExists } from 'bloom/core';
import { raycast, Layer } from 'bloom/physics';
import { addPointLight } from 'bloom/scene';
import * as W from './world-runtime';
import * as WPN from './weapons';
import * as VFX from './vfx';
import { terrainHeightAt } from './terrain';
import {
  MAX_ENEMIES, enX, enY, enZ, enAlive, enDying, enKind, enAware, KIND_HEIGHT,
} from './enemies';

const NO_SOUND: Sound = { handle: 0 } as Sound;
const KINDS = 8;
const WEAPONS = 6;
const VARS = 3;

// ---- sounds -----------------------------------------------------------------------------
const fire = new Array<Sound>(WEAPONS * VARS);
const FIRE_FILES = ['rifle_fire2', 'rifle_fire', 'rifle_fire3',
                    'blaster_fire', 'blaster_fire2', 'blaster_fire3',
                    'chain_fire', 'chain_fire2', 'chain_fire3',
                    'cannon_fire', 'cannon_fire2', 'cannon_fire3',
                    'scatter_fire1', 'scatter_fire2', 'scatter_fire3',
                    'lance_fire1', 'lance_fire2', 'lance_fire3'];
const FIRE_VOL = [0.40, 0.45, 0.38, 0.60, 0.62, 0.52];
// Pitch spread per weapon: wide on the automatic ones (the ear hears a loop soonest there).
const FIRE_SPREAD = [0.05, 0.04, 0.06, 0.03, 0.04, 0.03];
// What the mechanism does after a shot: 0 nothing, 1 bolt (at once), 2 pump (a beat later),
// 3 capacitor.
const MECH_KIND = [1, 3, 0, 3, 2, 3];
// Which weapons throw brass (the casing sound) and take a magazine (the reload set).
const BALLISTIC = [1, 0, 1, 0, 1, 0];
const mech = new Array<Sound>(4);
const shell = new Array<Sound>(4);          // dirt1 dirt2 hard1 hard2
const swapS = new Array<Sound>(2);
const rld = new Array<Sound>(5);            // start mid end cell_out cell_in
const imp = new Array<Sound>(10);           // material * 2 + variant
const ric = new Array<Sound>(2);
const flesh = new Array<Sound>(3);
const boom = new Array<Sound>(3);
const idle = new Array<Sound>(KINDS);
const alert = new Array<Sound>(KINDS);
const spawnS = new Array<Sound>(2);
const amb = new Array<Sound>(3);            // birds night room
const ambVoice = [0, 0, 0];
let sDry: Sound = NO_SOUND;
let sElite: Sound = NO_SOUND;
let sRoar: Sound = NO_SOUND;
let sSlam: Sound = NO_SOUND;
let sSummon: Sound = NO_SOUND;
let sSpit: Sound = NO_SOUND;
let sLob: Sound = NO_SOUND;
let sAcid: Sound = NO_SOUND;
let sNestHit: Sound = NO_SOUND;
let sNestBurst: Sound = NO_SOUND;

//  0 last fire variant   1 last weapon seen (swap detect)   2 was reloading   3 last reload
//  progress   4 mid stage played   5 shots since a casing sounded   6 idle call countdown
//  7 alert cooldown   8 spawn-sound cooldown   9 listener x  10 y  11 z   12 night 0..1
//  13 enclosure 0..1   14 surface under the player (0 soft, 1 hard)   15 swap variant
//  16 ambience level (fades in after boot)   17 dry-click cooldown
const S = [-1, -1, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// Delayed one-shots (the pump a beat after the blast, the casing when it lands).
//   kind 1 mechanism (a = which)   2 casing (a = shell index)
const EV = 12;
const evT = new Array<number>(EV);
const evKind = new Array<number>(EV);
const evA = new Array<number>(EV);
const evX = new Array<number>(EV);
const evY = new Array<number>(EV);
const evZ = new Array<number>(EV);

// Flashes: a point light has to be added again every frame it should be seen.
const FL = 6;
const flT = new Array<number>(FL);          // seconds left
const flDur = new Array<number>(FL);
const flX = new Array<number>(FL);
const flY = new Array<number>(FL);
const flZ = new Array<number>(FL);
const flRange = new Array<number>(FL);
const flR = new Array<number>(FL);
const flG = new Array<number>(FL);
const flB = new Array<number>(FL);
const flI = new Array<number>(FL);

// Material boxes: the static meshes whose model says what they are made of.
const MB_MAX = 320;
const mbX = new Array<number>(MB_MAX);
const mbY = new Array<number>(MB_MAX);
const mbZ = new Array<number>(MB_MAX);
const mbH = new Array<number>(MB_MAX);      // half extent in xz (a circle is close enough)
const mbT = new Array<number>(MB_MAX);      // top
const mbM = new Array<number>(MB_MAX);
//  0 box count   1 physics world handle (set by main)   2 1 = the world handle is set
//  3..6 building footprint cx cz hx hz (hx 0 = none)
const G = [0, 0, 0, 0, 0, 0, 0];
let world: any = null;
const STATIC_MASK = 1 << Layer.NON_MOVING;

for (let i = 0; i < EV; i++) { evT[i] = 0; evKind[i] = 0; evA[i] = 0; evX[i] = 0; evY[i] = 0; evZ[i] = 0; }
for (let i = 0; i < FL; i++) { flT[i] = 0; flDur[i] = 1; flX[i] = 0; flY[i] = 0; flZ[i] = 0; flRange[i] = 0; flR[i] = 0; flG[i] = 0; flB[i] = 0; flI[i] = 0; }

function opt(name: string, vol: number, send: number): Sound {
  const path = 'assets/sounds/' + name + '.wav';
  if (!fileExists(path)) return NO_SOUND;
  const s = loadSound(path);
  setSoundVolume(s, vol);
  setSoundBus(s, BUS_SFX);
  if (send > 0) setSoundReverbSend(s, send);
  return s;
}

function spread(amount: number): number { return 1 + (Math.random() * 2 - 1) * amount; }

/// A one-shot in the player's own hands (no position), at a varied pitch.
function near(s: Sound, vol: number, pitchSpread: number): void {
  if (s.handle === 0) return;
  playSoundEx(s, false, vol, spread(pitchSpread), 0);
}

/// A positional one-shot at a varied pitch. `occl` asks whether a wall stands between it and
/// the camera, and muffles it if so. Same distance curve as playSound3D.
function at(s: Sound, x: number, y: number, z: number, pitchSpread: number, occl: boolean): void {
  if (s.handle === 0) return;
  const v = playSound3DEx(s, x, y, z, false, 1.0, 0.0, 1.0);
  if (v === 0) return;
  voiceSetPitch(v, spread(pitchSpread));
  if (occl && blocked(x, y, z)) {
    voiceSetLowpass(v, 900);
    voiceSetVolume(v, 0.7);
  }
}

/// Is the static world between the camera and this point?
function blocked(x: number, y: number, z: number): boolean {
  if (G[2] === 0) return false;
  const dx = x - S[9], dy = y - S[10], dz = z - S[11];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 2.5 || d > 70) return false;
  const hit = raycast(world, vec3(S[9], S[10], S[11]), vec3(dx / d, dy / d, dz / d), d - 0.6, STATIC_MASK);
  return hit ? true : false;
}

export function setWorld(physics: any): void { world = physics; G[2] = 1; }
export function setBuilding(cx: number, cz: number, hx: number, hz: number): void {
  G[3] = cx; G[4] = cz; G[5] = hx; G[6] = hz;
}
/// 0 = day, 1 = night (main reads it off the arena's sky).
export function setNight(k: number): void { S[12] = k; }

/// What a model is made of, by its file name. -1 = not a thing a round can tell from stone.
function modelMaterial(path: string): number {
  if (path.indexOf('stump') >= 0 || path.indexOf('log_') >= 0 || path.indexOf('prop_tree') >= 0
      || path.indexOf('prop_table') >= 0 || path.indexOf('prop_chair') >= 0
      || path.indexOf('prop_bed') >= 0 || path.indexOf('prop_shelf') >= 0) return VFX.MAT_WOOD;
  if (path.indexOf('prop_barrel') >= 0 || path.indexOf('prop_crate') >= 0
      || path.indexOf('prop_generator') >= 0 || path.indexOf('prop_locker') >= 0
      || path.indexOf('prop_wreck') >= 0 || path.indexOf('prop_worklight') >= 0) return VFX.MAT_METAL;
  if (path.indexOf('prop_sandbags') >= 0) return VFX.MAT_DIRT;
  return -1;
}

export function initSfx(): void {
  for (let w = 0; w < WEAPONS; w++) {
    for (let v = 0; v < VARS; v++) fire[w * VARS + v] = opt(FIRE_FILES[w * VARS + v], FIRE_VOL[w], 0);
  }
  mech[0] = NO_SOUND;
  mech[1] = opt('mech_rifle', 0.16, 0);
  mech[2] = opt('mech_pump', 0.42, 0.05);
  mech[3] = opt('mech_energy', 0.20, 0);
  shell[0] = opt('shell_dirt1', 0.22, 0.05);
  shell[1] = opt('shell_dirt2', 0.22, 0.05);
  shell[2] = opt('shell_hard1', 0.28, 0.3);
  shell[3] = opt('shell_hard2', 0.28, 0.3);
  swapS[0] = opt('swap1', 0.40, 0.05);
  swapS[1] = opt('swap2', 0.40, 0.05);
  rld[0] = opt('reload_start', 0.45, 0.1);
  rld[1] = opt('reload_mid', 0.42, 0.1);
  rld[2] = opt('reload_end', 0.45, 0.1);
  rld[3] = opt('reload_cell_out', 0.42, 0.1);
  rld[4] = opt('reload_cell_in', 0.45, 0.1);
  sDry = opt('dry_fire', 0.45, 0);
  const IMP_FILES = ['impact_dirt', 'impact_wood', 'impact_stone', 'impact_metal', 'impact_water'];
  const IMP_VOL = [0.34, 0.38, 0.36, 0.34, 0.36];
  for (let m = 0; m < 5; m++) {
    imp[m * 2] = opt(IMP_FILES[m] + '1', IMP_VOL[m], 0.2);
    imp[m * 2 + 1] = opt(IMP_FILES[m] + '2', IMP_VOL[m], 0.2);
  }
  ric[0] = opt('ricochet1', 0.22, 0.25);
  ric[1] = opt('ricochet2', 0.22, 0.25);
  flesh[0] = opt('impact_flesh', 0.45, 0.1);
  flesh[1] = opt('impact_flesh2', 0.45, 0.1);
  flesh[2] = opt('impact_flesh3', 0.45, 0.1);
  boom[0] = opt('explosion', 0.85, 0.5);
  boom[1] = opt('explosion2', 0.85, 0.5);
  boom[2] = opt('explosion3', 0.85, 0.5);
  for (let k = 0; k < KINDS; k++) {
    idle[k] = opt('alien' + k + '_idle', 0.34, 0.15);
    alert[k] = opt('alien' + k + '_alert', 0.55, 0.2);
  }
  spawnS[0] = opt('spawn1', 0.42, 0.15);
  spawnS[1] = opt('spawn2', 0.42, 0.15);
  sElite = opt('elite_growl', 0.70, 0.3);
  sRoar = opt('boss_roar', 0.95, 0.5);
  sSlam = opt('boss_slam', 0.95, 0.4);
  sSummon = opt('boss_summon', 0.85, 0.5);
  sSpit = opt('spit_fire', 0.50, 0.1);
  sLob = opt('lob_fire', 0.60, 0.15);
  sAcid = opt('acid_hit', 0.42, 0.1);
  sNestHit = opt('nest_hit', 0.45, 0.1);
  sNestBurst = opt('nest_burst', 0.85, 0.3);
  amb[0] = opt('amb_birds', 1.0, 0);
  amb[1] = opt('amb_night', 1.0, 0);
  amb[2] = opt('amb_room', 1.0, 0);
  for (let i = 0; i < 3; i++) {
    ambVoice[i] = 0;
    if (amb[i].handle !== 0) ambVoice[i] = playSoundEx(amb[i], true, 0, 1, 0);
  }

  // What the props are made of. A prop with no collider cannot be hit and is skipped.
  let n = 0;
  for (let i = 0; i < W.MESH_COUNT && n < MB_MAX; i++) {
    if (W.MESH_COLLIDER[i] === 0) continue;
    const m = modelMaterial(W.UNIQUE_MODELS[W.MESH_MODEL_IDX[i]]);
    if (m < 0) continue;
    mbX[n] = W.MESH_X[i]; mbY[n] = W.MESH_Y[i]; mbZ[n] = W.MESH_Z[i];
    const hx = W.MESH_COLLIDER_HX[i], hz = W.MESH_COLLIDER_HZ[i];
    mbH[n] = Math.sqrt(hx * hx + hz * hz) + 0.2;
    mbT[n] = W.MESH_Y[i] + W.MESH_COLLIDER_HY[i] * 2 + 0.3;
    mbM[n] = m;
    n++;
  }
  G[0] = n;
}

export function nestHitSound(fallback: Sound): Sound { return sNestHit.handle !== 0 ? sNestHit : fallback; }
export function nestBurstSound(fallback: Sound): Sound { return sNestBurst.handle !== 0 ? sNestBurst : fallback; }

// ---- weapons ----------------------------------------------------------------------------

function later(delay: number, kind: number, a: number, x: number, y: number, z: number): void {
  for (let i = 0; i < EV; i++) {
    if (evT[i] > 0) continue;
    evT[i] = delay; evKind[i] = kind; evA[i] = a; evX[i] = x; evY[i] = y; evZ[i] = z;
    return;
  }
}

/// One shot leaves weapon `w`. (px, py, pz) are the Trooper's feet, for the casing.
/// Returns false when the weapon has no report loaded, so the caller can use the old one.
export function fireShot(w: number, px: number, py: number, pz: number): boolean {
  if (w < 0 || w >= WEAPONS) return false;
  let have = 0;
  for (let v = 0; v < VARS; v++) if (fire[w * VARS + v].handle !== 0) have++;
  if (have === 0) return false;
  // Not the one that just played (with two or more to choose from).
  let v = Math.floor(Math.random() * VARS);
  for (let tries = 0; tries < 4; tries++) {
    if (fire[w * VARS + v].handle !== 0 && (have === 1 || v !== S[0])) break;
    v = (v + 1) % VARS;
  }
  S[0] = v;
  near(fire[w * VARS + v], 1.0, FIRE_SPREAD[w]);
  const mk = MECH_KIND[w];
  if (mk === 1) near(mech[1], 1.0, 0.08);
  else if (mk === 2) later(0.30, 1, 2, 0, 0, 0);
  else if (mk === 3) later(0.10, 1, 3, 0, 0, 0);
  if (BALLISTIC[w] === 1) {
    // The chaingun throws brass faster than it can be heard one by one.
    S[5] = S[5] + 1;
    if (w !== WPN.W_CHAIN || S[5] >= 3) {
      S[5] = 0;
      const hard = S[14] > 0.5 ? 2 : 0;
      later(0.42 + Math.random() * 0.15, 2, hard + Math.floor(Math.random() * 2),
            px + (Math.random() - 0.5) * 1.4, py, pz + (Math.random() - 0.5) * 1.4);
    }
  }
  return true;
}

/// The trigger pulled on nothing.
export function dryFire(): void {
  if (S[17] > 0) return;
  S[17] = 0.25;
  near(sDry, 1.0, 0.05);
}

// ---- impacts ----------------------------------------------------------------------------

/// What is at this point of the static world. `ny` is the surface normal's y.
export function surfaceAt(x: number, y: number, z: number, ny: number): number {
  const gy = terrainHeightAt(x, z);
  // Water: at or under the surface, where the ground is under it too.
  for (let i = 0; i < W.WATER_COUNT; i++) {
    if (Math.abs(x - W.WATER_CX[i]) > W.WATER_SX[i] * 0.5 + 2.5) continue;
    if (Math.abs(z - W.WATER_CZ[i]) > W.WATER_SZ[i] * 0.5 + 2.5) continue;
    if (gy < W.WATER_CY[i] - 0.03 && y < W.WATER_CY[i] + 0.2) return VFX.MAT_WATER;
  }
  // A prop.
  for (let i = 0; i < G[0]; i++) {
    const dx = x - mbX[i], dz = z - mbZ[i];
    if (dx * dx + dz * dz > mbH[i] * mbH[i]) continue;
    if (y < mbY[i] - 0.3 || y > mbT[i]) continue;
    return mbM[i];
  }
  // A tree trunk: off the ground, within a trunk's width of a tree.
  if (y > gy + 0.25) {
    for (let i = 0; i < W.FOREST_COUNT; i++) {
      const dx = x - W.FOREST_X[i], dz = z - W.FOREST_Z[i];
      if (dx * dx + dz * dz < 0.85 * 0.85 * W.FOREST_SCALE[i] * W.FOREST_SCALE[i]) return VFX.MAT_WOOD;
    }
  }
  // The building: floors and walls alike are masonry.
  if (G[5] > 0 && Math.abs(x - G[3]) < G[5] + 0.3 && Math.abs(z - G[4]) < G[6] + 0.3) return VFX.MAT_STONE;
  // The ground.
  if (ny > 0.5 && Math.abs(y - gy) < 0.35) return VFX.MAT_DIRT;
  return VFX.MAT_STONE;
}

/// A round hits the static world: that material's particles and sound.
export function impact(x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
  const m = surfaceAt(x, y, z, ny);
  VFX.emitImpactMat(m, x, y, z, nx, ny, nz, Math.random() * 6.28);
  const s = imp[m * 2 + Math.floor(Math.random() * 2)];
  if (s.handle !== 0) at(s, x, y, z, 0.10, false);
  // The whine of a round leaving again: hard things only, and not every time.
  if ((m === VFX.MAT_STONE || m === VFX.MAT_METAL) && (Math.random() < 0.3 || s.handle === 0)) {
    at(ric[Math.floor(Math.random() * 2)], x, y, z, 0.12, false);
  }
}

/// A round hits a creature's body.
export function fleshHit(x: number, y: number, z: number): void {
  let v = Math.floor(Math.random() * 3);
  if (flesh[v].handle === 0) v = 0;
  at(flesh[v], x, y, z, 0.10, false);
}

/// A round glances off armour.
export function ricochet(x: number, y: number, z: number): void {
  at(ric[Math.floor(Math.random() * 2)], x, y, z, 0.12, false);
}

function flash(x: number, y: number, z: number, range: number, r: number, g: number, b: number,
               intensity: number, dur: number): void {
  let slot = 0;
  for (let i = 0; i < FL; i++) { if (flT[i] <= 0) { slot = i; break; } if (flT[i] < flT[slot]) slot = i; }
  flT[slot] = dur; flDur[slot] = dur;
  flX[slot] = x; flY[slot] = y; flZ[slot] = z; flRange[slot] = range;
  flR[slot] = r; flG[slot] = g; flB[slot] = b; flI[slot] = intensity;
}

/// The sound and the light of an explosion (the particles are VFX.emitExplosion).
/// Returns false when no explosion sound is loaded.
export function explosion(x: number, y: number, z: number): boolean {
  flash(x, y + 0.8, z, 18, 1.0, 0.62, 0.30, 9.0, 0.5);
  let v = Math.floor(Math.random() * 3);
  if (boom[v].handle === 0) v = 0;
  if (boom[v].handle === 0) return false;
  at(boom[v], x, y, z, 0.06, false);
  return true;
}

// ---- creatures --------------------------------------------------------------------------

/// Any creature vocal the director plays: varied in pitch, muffled behind a wall.
export function vox(s: Sound, x: number, y: number, z: number): void {
  at(s, x, y, z, 0.07, true);
}

/// A creature has just noticed the player. One call at a time: a pack does not bark in unison.
/// Returns false when it stayed quiet.
export function alertCall(kind: number, x: number, y: number, z: number): boolean {
  if (kind < 0 || kind >= KINDS || alert[kind].handle === 0) return false;
  if (S[7] > 0) return true;
  S[7] = 0.9;
  at(alert[kind], x, y + KIND_HEIGHT[kind] * 0.7, z, 0.07, true);
  return true;
}

/// A creature arrives: thrown earth, the sound of it, and a growl if it is an elite.
export function spawned(kind: number, x: number, y: number, z: number, elite: boolean): void {
  VFX.emitSpawn(x, y, z, 0.6 + KIND_HEIGHT[kind] * 0.35);
  if (S[8] <= 0) {
    S[8] = 0.18;
    at(spawnS[Math.floor(Math.random() * 2)], x, y + 0.3, z, 0.12, true);
  }
  if (elite) at(sElite, x, y + 1.0, z, 0.05, false);
}

export function bossRoar(x: number, y: number, z: number): boolean {
  if (sRoar.handle === 0) return false;
  at(sRoar, x, y, z, 0.03, false);
  return true;
}
export function bossSlam(x: number, y: number, z: number, r: number): boolean {
  VFX.emitShockRing(x, y, z, r * 0.7);
  VFX.emitShockRing(x, y, z, r * 0.35);
  flash(x, y + 1.0, z, 14, 1.0, 0.8, 0.55, 3.0, 0.25);
  if (sSlam.handle === 0) return false;
  at(sSlam, x, y + 1, z, 0.04, false);
  return true;
}
export function bossSummon(x: number, y: number, z: number): void {
  at(sSummon, x, y, z, 0.03, false);
}

/// A ranged creature looses a bolt. Returns false when it has no sound of its own.
export function spit(heavy: boolean, x: number, y: number, z: number): boolean {
  const s = heavy ? sLob : sSpit;
  if (s.handle === 0) return false;
  at(s, x, y, z, 0.08, true);
  return true;
}

/// A creature's bolt lands on the world.
export function acid(x: number, y: number, z: number): void {
  VFX.emitAcid(x, y, z);
  flash(x, y + 0.3, z, 5, 0.45, 1.0, 0.3, 2.2, 0.22);
  at(sAcid, x, y, z, 0.1, false);
}

// ---- frame ------------------------------------------------------------------------------

/// Once a frame. (lx, ly, lz) is the camera; (px, py, pz) the Trooper's feet; `hard` says the
/// Trooper stands on a hard floor; `enclosure` is the reverb zone's 0..1; `playing` is false
/// in menus and after the run has ended.
export function updateSfx(dt: number, lx: number, ly: number, lz: number,
                          px: number, py: number, pz: number,
                          hard: boolean, enclosure: number, playing: boolean): void {
  S[9] = lx; S[10] = ly; S[11] = lz;
  S[13] = enclosure;
  S[14] = hard ? 1 : 0;
  if (S[7] > 0) S[7] = S[7] - dt;
  if (S[8] > 0) S[8] = S[8] - dt;
  if (S[17] > 0) S[17] = S[17] - dt;

  // -- delayed one-shots
  for (let i = 0; i < EV; i++) {
    if (evT[i] <= 0) continue;
    evT[i] = evT[i] - dt;
    if (evT[i] > 0) continue;
    if (evKind[i] === 1) near(mech[evA[i]], 1.0, 0.06);
    else if (evKind[i] === 2) at(shell[evA[i]], evX[i], evY[i], evZ[i], 0.15, false);
  }

  // -- the swap: whenever the weapon in hand is not the one it was
  const w = WPN.currentWeapon();
  if (S[1] >= 0 && w !== S[1] && playing) {
    S[15] = 1 - S[15];
    near(swapS[S[15]], 1.0, 0.06);
  }
  S[1] = w;

  // -- the reload, in stages
  const rl = WPN.isReloading();
  const prog = WPN.reloadProgress();
  const cell = BALLISTIC[w] === 0;
  if (rl && S[2] === 0) {
    S[4] = 0;
    near(cell ? rld[3] : rld[0], 1.0, 0.04);
  }
  if (rl && S[4] === 0 && prog > 0.5 && !cell) {
    S[4] = 1;
    near(rld[1], 1.0, 0.04);
  }
  // It ended: finished (the bar was nearly full) or cancelled (a swap, a roll: no sound).
  if (!rl && S[2] === 1 && S[3] > 0.8) near(cell ? rld[4] : rld[2], 1.0, 0.04);
  S[2] = rl ? 1 : 0;
  S[3] = rl ? prog : 0;

  // -- idle murmurs from creatures that have not noticed the player
  S[6] = S[6] - dt;
  if (S[6] <= 0 && playing) {
    S[6] = 2.2 + Math.random() * 3.2;
    let pick = -1, seen = 0;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (enAlive[i] !== 1 || enDying[i] === 1 || enAware[i] === 1) continue;
      const dx = enX[i] - px, dz = enZ[i] - pz;
      if (dx * dx + dz * dz > 45 * 45) continue;
      seen++;
      if (Math.random() * seen < 1) pick = i;       // one of them, each as likely
    }
    if (pick >= 0) {
      const k = enKind[pick];
      at(idle[k], enX[pick], enY[pick] + KIND_HEIGHT[k] * 0.7, enZ[pick], 0.08, true);
    }
  }

  // -- ambience: three loops, levels by time of day and enclosure. Faded in over two seconds
  // so the menu does not open on a cut.
  if (S[16] < 1) S[16] = Math.min(1, S[16] + dt * 0.5);
  const open = 1 - enclosure;
  const day = 1 - S[12];
  if (ambVoice[0] !== 0) voiceSetVolume(ambVoice[0], 0.50 * day * open * S[16]);
  if (ambVoice[1] !== 0) voiceSetVolume(ambVoice[1], 0.45 * S[12] * open * S[16]);
  if (ambVoice[2] !== 0) voiceSetVolume(ambVoice[2], 0.40 * enclosure * S[16]);

  for (let i = 0; i < FL; i++) if (flT[i] > 0) flT[i] = flT[i] - dt;
}

/// Inside the 3D pass, where the frame's point lights are added.
export function addFlashLights(): void {
  for (let i = 0; i < FL; i++) {
    if (flT[i] <= 0) continue;
    const u = flT[i] / flDur[i];            // 1 at the instant, 0 at the end
    addPointLight(flX[i], flY[i], flZ[i], flRange[i], flR[i], flG[i], flB[i], flI[i] * u * u);
  }
}

/// A run begins: nothing pending carries over.
export function resetSfx(): void {
  for (let i = 0; i < EV; i++) evT[i] = 0;
  for (let i = 0; i < FL; i++) flT[i] = 0;
  S[1] = -1; S[2] = 0; S[3] = 0; S[4] = 0; S[5] = 0; S[6] = 3; S[7] = 0; S[8] = 0;
}
