// SH-025 — the enemy system, out of main.ts.
//
// Everything that defines what an alien IS: the seven kinds, their stat lines,
// their animation-clip indices, the ranged bands, and the flat per-slot arrays
// that carry each enemy's state between frames.
//
// Exported by NAME rather than behind a namespace object on purpose. main.ts has
// ~500 references to these arrays across the AI block, the damage path and the
// draw pass; importing them by name means the extraction moves declarations and
// touches not one call site, which is the difference between a refactor you can
// verify and one you can only hope about.
//
// Perry rules carry over verbatim: flat `new Array<number>(N)` + index
// assignment, never `.push()` (its `.length` lies), and no per-frame string work.

import { vec3, loadModelAnimation, instantiateAnimation, commitModel, Model } from 'bloom';
import {
  boxShape, createBody, MotionType, Layer, BodyHandle,
} from 'bloom/physics';
import { findJoint, createRagdoll } from 'bloom/models';

// ---- Unvanquished aliens (5 kinds, M3 model + M5 AI + M6 pool) ------------
// Each kind has its own GLB model and stat line. Kinds and models line up
// with the Unvanquished alien classes:
//   0 = dretch   — small, fast, low HP, moderate damage
//   1 = mantis   — quick, medium HP
//   2 = marauder — medium all-round
//   3 = dragoon  — heavier, slower, hits hard
//   4 = tyrant   — boss tier; rare, big, tanky
// SH-042 — 7 kinds. The two new ones are Unvanquished's UPGRADE classes: the
// same rigs wearing `body_adv.skin`, which is how that game ships them. Both are
// RANGED, which is the point: every previous kind could be handled by backing
// up, and these two cannot, so cover and repositioning start to matter and the
// whole encounter re-weights around them.
export const KIND_COUNT = 7;
// Display names of the original creature cast (art/style/photoreal/enemy_*).
// The kind ORDER and the internal ids in the world files (dretch, mantis, ...)
// are unchanged: they are gameplay roles, and the levels reference them.
export const KIND_NAME  = ['SKITTER', 'STALKER', 'RAVAGER', 'BRUISER', 'COLOSSUS',
                    'SPITTER', 'BOMBARD'];
// Filled by initEnemyPool(), NOT here. An imported module's body runs BEFORE the
// importer's, so a loadModel() at module scope would fire before main.ts has
// called initWindow() — and the engine panics with "Engine not initialized".
// Everything in this file that touches the engine has to wait to be asked.
export const mdlAliens: Model[] = new Array<Model>(KIND_COUNT);
// One animation handle PER KIND is enough for a single-clip sampler, because
// the caller passes the time explicitly on every call. It is NOT enough for the
// mixer (EN-028): the mixer owns the clock, the crossfade and the layer
// weights, and that state lives on the handle — so two dretches sharing one
// handle would advance the same clock twice a frame (double-speed animation)
// and share each other's flinches.
//
// So: one handle per enemy SLOT — but since EN-055 a slot handle is an
// INSTANCE over the kind's already-parsed clip set (instantiateAnimation),
// not another parse of the same GLB. Independence guarantee unchanged;
// the ~5 s of duplicate GLB parsing at boot is gone.
export const ALIEN_GLB = [
  'assets/models/enemy_skitter.glb',
  'assets/models/enemy_stalker.glb',
  'assets/models/enemy_ravager.glb',
  'assets/models/enemy_bruiser.glb',
  'assets/models/enemy_colossus.glb',
  'assets/models/enemy_spitter.glb',
  'assets/models/enemy_bombard.glb',
];

// Per-kind base tint (an albedo multiplier; shading and normal maps are
// untouched). All white since the 2026-11 cast: every kind has its own model
// now, so nothing needs a recolour to be told apart. The table stays because
// the draw path multiplies by it and a tint is the cheapest elite/variant hook.
export const KIND_TINT_R = [255, 255, 255, 255, 255, 255, 255];
export const KIND_TINT_G = [255, 255, 255, 255, 255, 255, 255];
export const KIND_TINT_B = [255, 255, 255, 255, 255, 255, 255];
export const KIND_TINTO = new Array<any>(KIND_COUNT);
for (let k = 0; k < KIND_COUNT; k++) {
  KIND_TINTO[k] = { r: KIND_TINT_R[k], g: KIND_TINT_G[k], b: KIND_TINT_B[k], a: 255 };
}
// Per-kind handle, kept only for the load-time joint lookups below.
// Also deferred to initEnemyPool() — same reason.
export const animAliens = new Array<number>(KIND_COUNT);
// NEW CAST (Tripo Studio rigs, tools/gen/build_cast.sh): every creature carries
// the same nine clips in sorted order —
//   0 c_attack  1 c_run  2 death  3 fall  4 hit_to_body_01  5 idle  6 run  7 slash  8 walk
// c_run and c_attack are that creature's OWN motion (the Skitter scuttles, the
// Colossus lumbers, the Spitter spits, the Bombard fires from its back); 6 and 7
// are the shared human presets they replaced, kept as fallbacks. Everything is
// authored in metres at real height, so KIND_SCALE is 1.
// The Bombard (the ranged heavy) has its own model, so the violet tint that used
// to tell it from the melee heavy is gone (KIND_TINT_* are all white).
// Animation indices — IQE declaration order. Dretch (and most others):
// 0 stand, 1 attack, 4 die, 14 run, 20 walk. We map gameplay -> anim idx.
// Per-kind animation indices, in kind order [dretch, mantis, marauder,
// dragoon, tyrant]. The GLBs do NOT share one layout — the old flat
// [14,...]/[1,...] tables played run_right on the dragoon, pain2 on the
// tyrant, and stand1 as the mantis "attack". Verified against each GLB's
// animation list (tools/inspect-glb.ts).
// The upgrade classes share their BASE class's rig and clip layout — that is
// what makes them upgrades rather than new models — so adv marauder reuses the
// marauder's indices (col 2) and adv dragoon the dragoon's (col 3).
export const ANIM_WALK_IDX   = [ 1,  1,  1,  1,  1,  1,  1];   // 'run'
// Every creature attacks with its own clip. (Skitter and Bruiser needed a second, more forceful
// take; their first came out as a near-static guard pose. Review any new take on a
// tools/blender/clip_sheet.py sheet before trusting it.)
export const ANIM_ATTACK_IDX = [ 0,  0,  0,  0,  0,  0,  0];   // 'attack'
export const ANIM_DIE_IDX    = [ 2,  2,  2,  2,  2,  2,  2];   // 'die'
// SH-030 — pain clips, for the flinch state. The IQE sources carry them and the
// converter extracts every clip; indices verified per GLB with
// tools/inspect-glb.ts. Falls back to the attack clip's neighbour if a kind
// turns out not to have one, which is harmless (a short twitch).
export const ANIM_PAIN_IDX   = [ 4,  4,  4,  4,  4,  4,  4];
// EN-028 upper-body mask root, so an alien can bite WHILE closing instead of
// stopping to bite. -1 = no such joint, and the attack stays full-body (i.e.
// exactly today's behaviour) rather than breaking.
export const KIND_SPINE_JOINT = new Array<number>(KIND_COUNT);
export const KIND_IDLE_IDX    = [ 5,  5,  5,  5,  5,  5,  5];
// Die-anim durations (max keyframe time per GLB). The engine WRAPS anim
// time (t % duration), so death playback clamps just short of these to
// freeze on the final collapsed pose instead of re-looping the fall.
export const ANIM_DIE_DUR    = [2.35, 2.35, 2.35, 2.35, 2.35, 2.35, 2.35];
// Per-kind tuning. Collider half-extents are generous (taller than the visual
// model) so horizontal aim at any range connects.
// Round-6 rescale — the GLBs have wildly different native sizes (engine
// getModelBounds rest-pose heights: dretch 0.74, mantis 2.54, marauder
// 4.63, dragoon 14.99, tyrant 5.27 m), and the old uniform-ish scales
// made the later kinds monstrous (dragoon 36 m!). Scales now target
// world heights ≈ 0.65 / 1.4 / 1.8 / 2.1 / 3.0 m. Colliders unchanged
// (they were deliberately generous).
//                 dretch mantis maraud dragoon tyrant  ADV.MAR  ADV.DRAGOON
export const KIND_SCALE = [1.00, 1.00, 1.00, 1.00, 1.00,  1.00,    1.00];
export const KIND_HX    = [1.0,  0.9,  1.2,  1.4,  1.8,   1.2,     1.4];
export const KIND_HY    = [1.0,  1.0,  1.2,  1.5,  2.0,   1.2,     1.5];
export const KIND_HZ    = [1.1,  1.0,  1.3,  1.6,  2.0,   1.3,     1.6];
export const KIND_Y_OFF = [1.0,  1.0,  1.2,  1.5,  2.0,   1.2,     1.5];
// The PHYSICS box (what the player's capsule bumps into) is the body's real size since plan 2.3:
// shots are tested against the hit shapes now, so the box no longer has to be "generous", and
// the old one (2 m tall and 2 m wide for an 0.8 m Skitter) shoved the player from a metre away.
// Half extents; the box is centred KIND_BOX_Y above the feet.
export const KIND_BOX_HX = [0.28, 0.32, 0.42, 0.58, 0.95, 0.36, 0.62];
export const KIND_BOX_HY = [0.38, 0.82, 0.92, 1.15, 1.70, 0.92, 1.15];
export const KIND_BOX_Y  = [0.40, 0.85, 0.95, 1.20, 1.75, 0.95, 1.20];
export const KIND_SPEED = [3.0,  4.5,  3.5,  2.5,  2.2,   4.0,     2.4];
// Plan 2.3 rescaled HP and weapon damage by ten (rifle 1 -> 10 against Skitter 3 -> 30), so a
// headshot, a limb hit and range falloff can all be fractions of a body shot.
export const KIND_HP    = [30,   40,   60,   100,  200,   80,      140];
export const KIND_DMG   = [12,   10,   16,   22,   35,    14,      20];
export const KIND_CD    = [0.9,  0.7,  0.9,  1.1,  1.3,   0.9,     1.1];
export const KIND_MELEE = [2.0,  2.0,  2.3,  2.6,  3.0,   2.3,     2.6];
// SH-052 — locomotion audio. Stride = metres of travel per audible step
// (drives enStepPhase for EVERY kind now, not just the tyrant, whose 2.2 is
// the pre-SH-052 value unchanged). Small things patter, big things pound.
export const KIND_STRIDE = [0.7,  1.1,  1.3,  1.6,  2.2,   1.3,     1.6];
export const DRETCH_HIT_FLASH = 0.18;
// Ichor colour per kind — drives the blood decal tint (SH-033).
export const KIND_BLOOD_R = [0.55, 0.50, 0.62, 0.70, 0.45, 0.62, 0.70];
export const KIND_BLOOD_G = [0.95, 0.85, 0.55, 0.35, 0.90, 0.55, 0.35];
export const KIND_BLOOD_B = [0.35, 0.95, 0.85, 0.75, 0.30, 0.85, 0.75];

export const K_ADV_MARAUDER = 5;
export const K_ADV_DRAGOON  = 6;

// SH-042 — RANGED behaviour, shared by both upgrade classes.
//
// This is the addition that actually changes the game. Every kind before these
// two closes to melee, so every one of them is answered by backing up and
// holding the trigger. A ranged enemy is not: it HOLDS a band and shoots you
// there, which means standing in the open stops being free and the building and
// the treeline become cover rather than scenery.
//
// It also gives the arena a reason to have a shape.
//   1 = adv marauder (fast, light, chip damage)
//   0 = adv dragoon  (slow, tanky, hits hard — the barb spitter)
export const KIND_RANGED = [0, 0, 0, 0, 0, 1, 1];
// Band each holds. Closer than MIN and it backs off; further than MAX and it
// closes. Inside the band it strafes.
export const RANGED_MIN = [0, 0, 0, 0, 0, 10.0, 13.0];
export const RANGED_MAX = [0, 0, 0, 0, 0, 17.0, 22.0];
export const RANGED_CD  = [0, 0, 0, 0, 0,  2.2,  3.0];   // seconds between volleys
export const RANGED_SHOTS  = [0, 0, 0, 0, 0, 3, 1];      // rounds per volley
export const RANGED_DMG    = [0, 0, 0, 0, 0, 6, 16];
export const RANGED_SPEED  = [0, 0, 0, 0, 0, 30.0, 22.0];
export const RANGED_SPREAD = [0, 0, 0, 0, 0, 0.05, 0.02];   // radians
// Telegraph: a rooted wind-up before the volley, so it can be dodged and read.
export const RANGED_WINDUP = [0, 0, 0, 0, 0, 0.35, 0.6];


// Enemy pool — each slot is permanently tied to one kind because Jolt body
// shapes can't be swapped in-place. BODIES_PER_KIND dormant bodies per kind
// give us a fixed pool of MAX_ENEMIES = KIND_COUNT * BODIES_PER_KIND.
// Plan 2.6 - the pool is sized PER KIND now. The creature rigs lost their finger and toe joints
// (tools/gen/strip_joints.py: 66 -> 23 joints), and the engine's budget is 1024 joint matrices a
// frame for every skinned draw: 67 (Trooper) + 30 slots x 23 = 757. Past the budget the engine
// does not fail loudly: the draw that does not fit is posed with another model's matrices. Slots of one kind are
// contiguous: kind k owns KIND_SLOT0[k] .. KIND_SLOT0[k] + KIND_POOL[k] - 1.
//                      skitter stalker ravager bruiser colossus spitter bombard
export const KIND_POOL  = [8,    5,     5,      3,      2,       4,      3];
export const KIND_SLOT0 = [0,    8,     13,     18,     21,      23,     27];
export const MAX_ENEMIES = 30;
export const enX = new Array<number>(MAX_ENEMIES);
export const enY = new Array<number>(MAX_ENEMIES);
export const enZ = new Array<number>(MAX_ENEMIES);
export const enHP = new Array<number>(MAX_ENEMIES);
export const enAlive = new Array<number>(MAX_ENEMIES);
export const enKind  = new Array<number>(MAX_ENEMIES);
export const enAttackCD = new Array<number>(MAX_ENEMIES);
export const enFlashT = new Array<number>(MAX_ENEMIES);
export const enPhase = new Array<number>(MAX_ENEMIES);        // walk-cycle phase accumulator
// Death playback: corpse keeps drawing at its last position while the die
// animation plays (then sinks), independent of enAlive so wave logic and
// AI treat the enemy as gone immediately.
export const enDying    = new Array<number>(MAX_ENEMIES);     // 1 = death anim in progress
export const enDeathT   = new Array<number>(MAX_ENEMIES);     // seconds since the kill
export const enDeathYaw = new Array<number>(MAX_ENEMIES);     // facing frozen at death
// Round-9 AI overhaul — per-enemy steering state (flat arrays, Perry
// convention). Each kind runs its own little state machine in the AI
// block; these carry it between frames.
export const AI_APPROACH = 0;   // close on the player (kind-specific flavour)
export const AI_ORBIT    = 1;   // mantis: circle-strafe at ring distance
export const AI_WINDUP   = 2;   // dragoon: rooted pounce telegraph
export const AI_CHARGE   = 3;   // mantis dart / dragoon pounce — locked direction
export const AI_RECOVER  = 4;   // post-attack back-off / cooldown creep
// SH-030 — being shot now interrupts the enemy. Light kinds flinch outright;
// heavies only stagger once enough damage lands inside a window, so a tyrant
// stays menacing instead of being stun-locked by a rifle.
export const AI_FLINCH   = 5;
export const FLINCH_TIME    = 0.25;
export const FLINCH_LOCKOUT = 0.60;   // min gap between flinches — no stun-lock
export const STAGGER_WINDOW = 1.0;
export const STAGGER_FRAC   = 0.15;   // % of max HP inside the window to stagger
export const STAGGER_TIME   = 0.60;
// Which kinds flinch on any hit (light) vs need the stagger meter (heavy).
export const KIND_LIGHT = [1, 1, 1, 0, 0, 1, 1];
export const enAIState  = new Array<number>(MAX_ENEMIES);
export const enStateT   = new Array<number>(MAX_ENEMIES);   // seconds left in state
export const enOrbitDir = new Array<number>(MAX_ENEMIES);   // ±1 — circle/flank side
export const enChargeX  = new Array<number>(MAX_ENEMIES);   // locked charge direction
export const enChargeZ  = new Array<number>(MAX_ENEMIES);
export const enHeading  = new Array<number>(MAX_ENEMIES);   // smoothed facing yaw
export const enSpeedMul = new Array<number>(MAX_ENEMIES);   // tyrant momentum
// SH-030 — flinch / stagger bookkeeping.
export const enFlinchLock = new Array<number>(MAX_ENEMIES);  // s until it can flinch again
export const enDmgWindow  = new Array<number>(MAX_ENEMIES);  // damage inside STAGGER_WINDOW
export const enDmgTimer   = new Array<number>(MAX_ENEMIES);
// SH-034 — the clip currently requested on the base track, so animPlay is only
// called on a real change (it is idempotent, but this keeps the intent clear).
export const enAnimClip   = new Array<number>(MAX_ENEMIES);
// Upper-body attack layer weight, blended in/out rather than snapped.
export const enAttackLayer = new Array<number>(MAX_ENEMIES);
// Tyrant footstep cadence.
export const enStepPhase  = new Array<number>(MAX_ENEMIES);
// SH-042 — ranged: volley cooldown, and how many rounds are left in the burst.
export const enRangedCD   = new Array<number>(MAX_ENEMIES);
export const enBurst      = new Array<number>(MAX_ENEMIES);
export const enBurstT     = new Array<number>(MAX_ENEMIES);
// SH-031 / EN-025 — one ragdoll slot per enemy slot, pooled and reused. A slot
// is cheap; the bodies it holds are not, so they are released when the corpse
// goes away.
export const enRagdoll    = new Array<number>(MAX_ENEMIES);
export const enRagActive  = new Array<number>(MAX_ENEMIES);
// The killing shot, kept so the corpse is thrown along it.
export const enDeathDX    = new Array<number>(MAX_ENEMIES);
export const enDeathDY    = new Array<number>(MAX_ENEMIES);
export const enDeathDZ    = new Array<number>(MAX_ENEMIES);
export const enDeathImp   = new Array<number>(MAX_ENEMIES);
// Last frame's steering velocity, so the draw pass can match animation playback
// rate to actual ground speed (SH-034 — the foot-slide fix).
export const vxLast = new Array<number>(MAX_ENEMIES);
export const vzLast = new Array<number>(MAX_ENEMIES);
// ---- Plan 2.1: perception -------------------------------------------------------------------
// enAware 0 = hunting blind (walks to the last place the pack believes the player is),
// 1 = alerted (sees, hears or was just hurt: runs its kind's combat behaviour).
export const enAware   = new Array<number>(MAX_ENEMIES);
export const enSeenT   = new Array<number>(MAX_ENEMIES);   // seconds since it last perceived the player
export const enLastX   = new Array<number>(MAX_ENEMIES);   // last known player position (feet)
export const enLastY   = new Array<number>(MAX_ENEMIES);
export const enLastZ   = new Array<number>(MAX_ENEMIES);
export const enLos     = new Array<number>(MAX_ENEMIES);   // cached line of sight to the player (0/1)
export const enLosT    = new Array<number>(MAX_ENEMIES);   // seconds until the next sight ray
export const enReactT  = new Array<number>(MAX_ENEMIES);   // "noticed you" pause before it acts
export const enSearchT = new Array<number>(MAX_ENEMIES);   // seconds until the pack re-guesses
export const enBlockT  = new Array<number>(MAX_ENEMIES);   // ranged: seconds without a clear shot
export const enRouteT  = new Array<number>(MAX_ENEMIES);   // seconds until the next wall-in-the-way test
export const enRouted  = new Array<number>(MAX_ENEMIES);   // 1 = a wall is between it and its target
// How far each kind sees (m, standing target in the open) and the half-angle of its sight cone.
export const KIND_SIGHT = [26, 34, 30, 28, 30, 38, 40];
export const SIGHT_COS = 0.26;          // cos 75 deg: a 150 deg cone while unaware
export const SIGHT_CROUCH_MUL = 0.5;    // a crouched Trooper is seen at half the distance
export const SENSE_NEAR = 3.5;          // inside this it knows, whatever it faces
export const LOSE_TIME = 5.0;           // seconds without perceiving before it stops being alerted
export const ALERT_SHARE_R = 12.0;      // an alerted creature rouses others this close

// ---- Plan 2.2: telegraphed melee ------------------------------------------------------------
// Every melee attack is wind-up -> active -> recovery. The hit shape (a disc in front of the
// attacker) exists only during the active frames; the wind-up is the tell and the dodge window.
export const AI_STRIKE_WIND = 6;
export const AI_STRIKE_HIT  = 7;
export const AI_STRIKE_REC  = 8;
//                              skitter stalker ravager bruiser colossus spitter bombard
export const STRIKE_WINDUP   = [0.34,  0.40,   0.48,   0.62,   0.80,    0,      0];
export const STRIKE_ACTIVE   = [0.14,  0.14,   0.16,   0.20,   0.24,    0,      0];
export const STRIKE_RECOVER  = [0.45,  0.50,   0.60,   0.85,   1.20,    0,      0];
export const STRIKE_START    = [1.5,   1.9,    2.1,    2.6,    3.3,     0,      0];   // begin a strike inside this
export const STRIKE_REACH    = [0.9,   1.2,    1.3,    1.6,    2.2,     0,      0];   // disc centre, ahead of the body
export const STRIKE_RADIUS   = [0.9,   1.0,    1.1,    1.4,    1.9,     0,      0];
export const STRIKE_LUNGE    = [4.0,   5.0,    4.0,    3.0,    1.5,     0,      0];   // m/s forward while active
// The attack clip, and when in it the blow lands (measured per rig): the upper-body layer is
// played at ATTACK_HIT_T / STRIKE_WINDUP speed so the claw arrives as the active frames open.
export const ATTACK_HIT_T    = [0.42,  0.46,   0.50,   0.80,   0.55,    0.15,   1.50];
export const enHitDone  = new Array<number>(MAX_ENEMIES);   // this strike already landed or whiffed
export const enStrikeSeq = new Array<number>(MAX_ENEMIES);  // bumped per strike; the draw restarts the layer on a change
export const enHasToken = new Array<number>(MAX_ENEMIES);   // holds an attack token (plan 2.5)

// ---- Plan 2.3: locational damage ------------------------------------------------------------
// Sizes measured from each mesh in its idle pose (85th percentile of the vertices skinned to the
// part), then floored: the Skitter's real torso is 6 cm thick and nobody could hit that.
//                             skitter stalker ravager bruiser colossus spitter bombard
export const KIND_HEAD_OFF_X = [0.03,  0.05,   0.07,   0.11,   0.18,    0.07,   0.15];
export const KIND_HEAD_OFF_Y = [0.03,  0.04,   0.07,   0.00,  -0.09,    0.07,  -0.05];
export const KIND_HEAD_R     = [0.14,  0.18,   0.20,   0.25,   0.31,    0.21,   0.21];
export const KIND_TORSO_R    = [0.16,  0.17,   0.28,   0.44,   0.74,    0.20,   0.47];
export const KIND_ARM_R      = [0.07,  0.10,   0.13,   0.18,   0.36,    0.09,   0.26];
export const KIND_LEG_R      = [0.08,  0.10,   0.14,   0.19,   0.42,    0.10,   0.18];
export const KIND_HEIGHT     = [0.80,  1.70,   1.89,   2.40,   3.51,    1.90,   2.37];
// A weak point per heavy (the plan's phrase): a sphere riding a joint, offset in the model's axes
// (X forward, Y up, Z right; a non-zero Z is mirrored to both sides). FRONT = it only counts for
// a shot coming in from the front, where the pale belly is; the Bombard's launcher tubes sit on
// top of its back and can be hit from anywhere.
export const KIND_WEAK_JOINT_NAME = ['', '', '', 'mixamorig:Spine', 'mixamorig:Spine', '', 'mixamorig:Neck'];
export const KIND_WEAK_X     = [0, 0, 0, 0.25, 0.36, 0, 0.00];
export const KIND_WEAK_Y     = [0, 0, 0, 0.00, 0.04, 0, 0.28];
export const KIND_WEAK_Z     = [0, 0, 0, 0.00, 0.00, 0, 0.32];
export const KIND_WEAK_R     = [0, 0, 0, 0.27, 0.42, 0, 0.24];
export const KIND_WEAK_FRONT = [0, 0, 0, 1,    1,    0, 0];
// Shelled backs: a body shot that comes in from behind a Bruiser or a Colossus glances.
export const KIND_SHELL      = [0, 0, 0, 1,    1,    0, 0];
export const LOC_LIMB = 0;
export const LOC_BODY = 1;
export const LOC_HEAD = 2;
export const LOC_WEAK = 3;
export const LOC_SHELL = 4;
export const LOC_MUL  = [0.7, 1.0, 2.0, 2.5, 0.5];   // head is multiplied again per weapon (W_HEAD_MUL)
// Joints the hit shapes ride, looked up once per kind in initEnemyPool (HS_J * KIND_COUNT).
export const HS_J = 17;
export const HSJ_HEAD = 0, HSJ_NECK = 1, HSJ_HIPS = 2;
export const HSJ_ARM_L = 3, HSJ_FARM_L = 4, HSJ_HAND_L = 5;
export const HSJ_ARM_R = 6, HSJ_FARM_R = 7, HSJ_HAND_R = 8;
export const HSJ_ULEG_L = 9, HSJ_LEG_L = 10, HSJ_FOOT_L = 11;
export const HSJ_ULEG_R = 12, HSJ_LEG_R = 13, HSJ_FOOT_R = 14;
export const HSJ_WEAK = 15, HSJ_SPINE2 = 16;
export const KIND_HS_JOINT = new Array<number>(KIND_COUNT * HS_J);
const HS_JOINT_NAMES = [
  'mixamorig:Head', 'mixamorig:Neck', 'mixamorig:Hips',
  'mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand',
  'mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand',
  'mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'mixamorig:LeftFoot',
  'mixamorig:RightUpLeg', 'mixamorig:RightLeg', 'mixamorig:RightFoot',
  '', 'mixamorig:Spine2',
];
// The transform each slot's skeleton was last posed with (what animUpdate got), so a shot is
// tested against the pose on screen.
export const enPoseX   = new Array<number>(MAX_ENEMIES);
export const enPoseY   = new Array<number>(MAX_ENEMIES);
export const enPoseZ   = new Array<number>(MAX_ENEMIES);
export const enPoseYaw = new Array<number>(MAX_ENEMIES);
export const enPosed   = new Array<number>(MAX_ENEMIES);   // 1 once the slot has a pose this life

// ---- Plan 2.4: hit reactions ----------------------------------------------------------------
export const enHitDX   = new Array<number>(MAX_ENEMIES);   // world direction of the last hit (unit, XZ)
export const enHitDZ   = new Array<number>(MAX_ENEMIES);
export const enHitK    = new Array<number>(MAX_ENEMIES);   // jolt strength, decays to 0
export const enDeathClip = new Array<number>(MAX_ENEMIES); // which clip this death plays
export const enDeathVX = new Array<number>(MAX_ENEMIES);   // a body thrown by a blast slides
export const enDeathVZ = new Array<number>(MAX_ENEMIES);
export const enDeathVY = new Array<number>(MAX_ENEMIES);
export const enDeathLift = new Array<number>(MAX_ENEMIES); // height above the ground while thrown
// The second death: clip 3 ("fall") crumples where it stands, but only after a second of
// swaying, so it is entered at ANIM_FALL_SKIP by playing that first second very fast.
export const ANIM_FALL_IDX = 3;
export const ANIM_FALL_SKIP = 1.05;
export const ANIM_FALL_DUR = 3.0;

export const enBody: BodyHandle[] = new Array<BodyHandle>(MAX_ENEMIES);
// EN-028 — one animation handle per SLOT, so every enemy owns its own mixer
// clock, crossfade and attack-layer weight (see the note at ALIEN_GLB).
export const enAnim = new Array<number>(MAX_ENEMIES);

// ---- Phase 6: elites ---------------------------------------------------------------------
// An elite is a creature of an ordinary kind that the wave plan marked with `!`: tougher, hits
// harder, drawn a size up with a red glow, shrugs off light hits, and pays triple. One flag per
// slot; every table above still applies, scaled by the constants here.
export const enElite = new Array<number>(MAX_ENEMIES);
for (let i = 0; i < MAX_ENEMIES; i++) enElite[i] = 0;
export const ELITE_HP = 2.4;
export const ELITE_DMG = 1.3;
export const ELITE_SCALE = 1.16;
export const ELITE_SCORE = 3;
/// The scale slot i is drawn (and its hit shapes sized) at.
export function enScale(i: number): number {
  const s = KIND_SCALE[enKind[i]];
  return enElite[i] === 1 ? s * ELITE_SCALE : s;
}

// The pool's Jolt bodies, animation handles and ragdoll slots. Split out from the
// tables above because it is the one part that needs the physics world, which
// main.ts owns — so it is a function taking `physics` rather than module-scope
// work that would force an import cycle.
/// `stagedAliens` are handles from main's boot-time stageModels() batch —
/// the GLBs are already decoded on worker threads; committing here is just
/// the GPU upload + registry insert.
export function initEnemyPool(physics: number, stagedAliens: number[]): void {
  for (let k = 0; k < KIND_COUNT; k++) {
    mdlAliens[k]  = commitModel(stagedAliens[k]);
    animAliens[k] = loadModelAnimation(ALIEN_GLB[k]);
  }
  // Spine joint per kind, once. findJoint parses a STRING — fine at load time,
  // forbidden on a per-frame path (perry-quirks #5).
  for (let k = 0; k < KIND_COUNT; k++) {
    KIND_SPINE_JOINT[k] = findJoint(animAliens[k], 'spine');
  }
  for (let k = 0; k < KIND_COUNT; k++) {
    for (let j = 0; j < HS_J; j++) {
      let nm = HS_JOINT_NAMES[j];
      if (j === HSJ_WEAK) nm = KIND_WEAK_JOINT_NAME[k];
      KIND_HS_JOINT[k * HS_J + j] = nm.length > 0 ? findJoint(animAliens[k], nm) : -1;
    }
  }
  for (let k = 0; k < KIND_COUNT; k++) {
    const shape = boxShape(vec3(KIND_BOX_HX[k], KIND_BOX_HY[k], KIND_BOX_HX[k]));
    for (let j = 0; j < KIND_POOL[k]; j++) {
      const i = KIND_SLOT0[k] + j;
      // EN-055 — an INSTANCE over the per-kind clip set, not another parse of
      // the same GLB. Same guarantee as before (own mixer, own joint state —
      // two dretches never share a clock), but "the aliens" boot stage drops
      // from ~5.1 s to the cost of allocating joint arrays.
      enAnim[i] = instantiateAnimation(animAliens[k]);
      enX[i] = 0; enY[i] = -100; enZ[i] = 0;
      enHP[i] = 0; enAlive[i] = 0; enAttackCD[i] = 0; enFlashT[i] = 0;
      enPhase[i] = Math.random() * Math.PI * 2;   // stagger the bob phases
      enKind[i] = k;
      // Explicit init — Perry arrays don't default-fill, and findDormantSlot
      // compares enDying with === 0.
      enDying[i] = 0;
      enDeathT[i] = 0;
      enDeathYaw[i] = 0;
      enAIState[i] = AI_APPROACH;
      enStateT[i] = 0;
      enOrbitDir[i] = (i & 1) === 0 ? 1 : -1;
      enChargeX[i] = 0;
      enChargeZ[i] = 1;
      enHeading[i] = 0;
      enSpeedMul[i] = 1;
      enFlinchLock[i] = 0;
      enDmgWindow[i] = 0;
      enDmgTimer[i] = 0;
      enAnimClip[i] = -1;
      enAttackLayer[i] = 0;
      enStepPhase[i] = 0;
      enRangedCD[i] = 0;
      enBurst[i] = 0;
      enBurstT[i] = 0;
      enAware[i] = 0; enSeenT[i] = 0; enLastX[i] = 0; enLastY[i] = 0; enLastZ[i] = 0;
      enLos[i] = 0; enLosT[i] = 0; enReactT[i] = 0; enSearchT[i] = 0; enBlockT[i] = 0;
      enRouteT[i] = 0; enRouted[i] = 0;
      enHitDone[i] = 0; enStrikeSeq[i] = 0; enHasToken[i] = 0;
      enPoseX[i] = 0; enPoseY[i] = 0; enPoseZ[i] = 0; enPoseYaw[i] = 0; enPosed[i] = 0;
      enHitDX[i] = 0; enHitDZ[i] = 0; enHitK[i] = 0;
      enDeathClip[i] = 2; enDeathVX[i] = 0; enDeathVZ[i] = 0; enDeathVY[i] = 0; enDeathLift[i] = 0;
      enRagdoll[i] = createRagdoll();
      enRagActive[i] = 0;
      vxLast[i] = 0;
      vzLast[i] = 0;
      enBody[i] = createBody(physics, shape, {
        motionType: MotionType.KINEMATIC,
        position: vec3(0, -100, 0),
        objectLayer: Layer.MOVING,
      });
    }
  }
  // EN-055 verification on the boot log (same rationale as the [music]
  // probe): a failed instance is a handle of 0, and its symptom at runtime —
  // enemies frozen in rest pose — is exactly the kind of thing a batch run
  // cannot see. Handles are allocator-ordered, so slot0 > kind-set proves the
  // instances are NEW handles, not aliases.
  console.log('[anim] kind0 clipset=' + animAliens[0]
            + ' slot0=' + enAnim[0] + ' slot1=' + enAnim[1]
            + ' head=' + KIND_HS_JOINT[HSJ_HEAD] + ' hips=' + KIND_HS_JOINT[HSJ_HIPS]
            + ' foot=' + KIND_HS_JOINT[HSJ_FOOT_R]);
}
