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
export const KIND_NAME  = ['DRETCH', 'MANTIS', 'MARAUDER', 'DRAGOON', 'TYRANT',
                    'ADV MARAUDER', 'ADV DRAGOON'];
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
  'assets/models/enemy_dretch.glb',
  'assets/models/enemy_mantis.glb',
  'assets/models/enemy_marauder.glb',
  'assets/models/enemy_dragoon.glb',
  'assets/models/enemy_tyrant.glb',
  'assets/models/enemy_adv_marauder.glb',
  // The adv dragoon deliberately loads the BASE dragoon GLB: upstream level3
  // has no adv art (`body_adv.skin` maps to the same textures as default), so
  // enemy_adv_dragoon.glb was a byte-identical 4.9 MB copy. Its identity comes
  // from KIND_TINTO below instead.
  'assets/models/enemy_dragoon.glb',
];

// 2026-07-16 audit — per-kind base tint (an albedo multiplier; shading and
// normal maps are untouched). Exists for one reason: the adv dragoon is the
// only RANGED heavy in the game and, with upstream art identical to the melee
// dragoon, a player could not tell which threat was closing until the barb
// was already in the air. The violet shift reads at combat distance and
// matches the "upgrade classes run cooler" language the adv marauder's real
// recolour already speaks. Everyone else stays white (multiplier of 1).
export const KIND_TINT_R = [255, 255, 255, 255, 255, 255, 255];
export const KIND_TINT_G = [255, 255, 255, 255, 255, 255, 150];
export const KIND_TINT_B = [255, 255, 255, 255, 255, 255, 235];
export const KIND_TINTO = new Array<any>(KIND_COUNT);
for (let k = 0; k < KIND_COUNT; k++) {
  KIND_TINTO[k] = { r: KIND_TINT_R[k], g: KIND_TINT_G[k], b: KIND_TINT_B[k], a: 255 };
}
// Per-kind handle, kept only for the load-time joint lookups below.
// Also deferred to initEnemyPool() — same reason.
export const animAliens = new Array<number>(KIND_COUNT);
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
export const ANIM_WALK_IDX   = [14, 18, 14, 12, 15, 14, 12];   // 'run'
export const ANIM_ATTACK_IDX = [ 1,  4,  1,  6,  1,  1,  6];   // 'attack'
export const ANIM_DIE_IDX    = [ 4,  7,  4,  7,  5,  4,  7];   // 'die'
// SH-030 — pain clips, for the flinch state. The IQE sources carry them and the
// converter extracts every clip; indices verified per GLB with
// tools/inspect-glb.ts. Falls back to the attack clip's neighbour if a kind
// turns out not to have one, which is harmless (a short twitch).
export const ANIM_PAIN_IDX   = [ 2,  5,  2,  8,  3,  2,  8];
// EN-028 upper-body mask root, so an alien can bite WHILE closing instead of
// stopping to bite. -1 = no such joint, and the attack stays full-body (i.e.
// exactly today's behaviour) rather than breaking.
export const KIND_SPINE_JOINT = new Array<number>(KIND_COUNT);
export const KIND_IDLE_IDX    = [ 0,  0,  0,  0,  0,  0,  0];
// Die-anim durations (max keyframe time per GLB). The engine WRAPS anim
// time (t % duration), so death playback clamps just short of these to
// freeze on the final collapsed pose instead of re-looping the fall.
export const ANIM_DIE_DUR    = [1.55, 1.567, 0.883, 1.8, 2.567, 0.883, 1.8];
// Procedural motion parameters (cheap substitute for skeletal animation).
// Each enemy has a phase accumulator — sinusoids on top give a bob + side-
// sway while walking, and a forward-lunge while attacking.
export const WALK_BOB_Y = 0.12;       // metres
export const WALK_BOB_RATE = 9.0;     // rad/s
export const WALK_TILT = 0.06;        // unused; kept for future side-sway
export const ATTACK_LUNGE_AMP = 0.25; // m forward during attack
// Per-kind tuning. Collider half-extents are generous (taller than the visual
// model) so horizontal aim at any range connects.
// Round-6 rescale — the GLBs have wildly different native sizes (engine
// getModelBounds rest-pose heights: dretch 0.74, mantis 2.54, marauder
// 4.63, dragoon 14.99, tyrant 5.27 m), and the old uniform-ish scales
// made the later kinds monstrous (dragoon 36 m!). Scales now target
// world heights ≈ 0.65 / 1.4 / 1.8 / 2.1 / 3.0 m. Colliders unchanged
// (they were deliberately generous).
//                 dretch mantis maraud dragoon tyrant  ADV.MAR  ADV.DRAGOON
export const KIND_SCALE = [0.88, 0.55, 0.39, 0.14, 0.57,  0.41,    0.15];
export const KIND_HX    = [1.0,  0.9,  1.2,  1.4,  1.8,   1.2,     1.4];
export const KIND_HY    = [1.0,  1.0,  1.2,  1.5,  2.0,   1.2,     1.5];
export const KIND_HZ    = [1.1,  1.0,  1.3,  1.6,  2.0,   1.3,     1.6];
export const KIND_Y_OFF = [1.0,  1.0,  1.2,  1.5,  2.0,   1.2,     1.5];
export const KIND_SPEED = [3.0,  4.5,  3.5,  2.5,  2.2,   4.0,     2.4];
export const KIND_HP    = [3,    4,    6,    10,   20,    8,       14];
export const KIND_DMG   = [12,   10,   16,   22,   35,    14,      20];
export const KIND_CD    = [0.9,  0.7,  0.9,  1.1,  1.3,   0.9,     1.1];
export const KIND_MELEE = [2.0,  2.0,  2.3,  2.6,  3.0,   2.3,     2.6];
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
export const BODIES_PER_KIND = 2;
export const MAX_ENEMIES = KIND_COUNT * BODIES_PER_KIND;
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
export const enBody: BodyHandle[] = new Array<BodyHandle>(MAX_ENEMIES);
// EN-028 — one animation handle per SLOT, so every enemy owns its own mixer
// clock, crossfade and attack-layer weight (see the note at ALIEN_GLB).
export const enAnim = new Array<number>(MAX_ENEMIES);

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
    const shape = boxShape(vec3(KIND_HX[k], KIND_HY[k], KIND_HZ[k]));
    for (let j = 0; j < BODIES_PER_KIND; j++) {
      const i = k * BODIES_PER_KIND + j;
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
            + ' slot0=' + enAnim[0] + ' slot1=' + enAnim[1]);
}
