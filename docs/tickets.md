# Shooter ticket backlog

Outstanding game-side work. Engine-side counterparts live in the
engine repo's `docs/tickets.md`.

Status legend: 🟢 ready · 🟡 needs engine support · 🔴 needs an asset
or a design decision

> **Reorganized 2026-07-12** after the AAA gap audit (shooter + engine
> + editor surveyed). The renderer is no longer the bottleneck — the
> gap to AAA is *feel* (animation, VFX, camera, audio), *game
> structure* (menus, saves, gamepad, content volume), and *production
> throughput* (editor + asset ingest). The backlog is now organized
> into rounds in recommended shipping order. Water tickets are closed:
> water is accepted at current quality.
>
> **The game is a third-person shooter (TPS)** — over-the-shoulder
> orbit camera (`TP_ORBIT_DIST`), not first-person. All feel tickets
> below are designed for that camera. Docs that said "FPS" have been
> corrected.

## Round overview

| Round | Theme | Tickets | Status |
|---|---|---|---|
| 0 | Architecture | SH-025, SH-005, SH-026 | ✅ **CLOSED** — module split complete (SH-025a–d, PRs #14–#17); main.ts 4,381 → 2,132 lines |
| 1 | Combat feel — the biggest perceived jump | SH-027..SH-034 | ✅ shipped, incl. SH-031 ragdolls (EN-025) |
| 2 | Audio | SH-003, SH-001, SH-035, SH-036 | ✅ SH-001/003/035 shipped (synthesised stand-ins); SH-036 needs real music stems |
| 3 | Game structure & content | SH-037..SH-043 | ✅ incl. SH-040 level select and SH-042 (4 weapons + 7 enemy kinds, 2 of them RANGED) |
| 4 | Visual backlog | ✅ **CLOSED** — SH-007/009/010/011/013/014/020 shipped; SH-023/024 won't-do (reasoned) | splat terrain, coherent cloud deck (EN-040), hierarchical foliage wind (EN-041), 40k grass |
| 5 | Production tooling | SH-044 ✅ + editor PLAN items ⏳ | ✅ asset ingest scripted + cross-platform; editor items are in `../editor` |

> **Round-1 results (2026-07-12):** see [`docs/aaa-round-1.md`](aaa-round-1.md).
> Round 0 was deliberately deferred: the new systems went into their own modules
> (`feel.ts`, `vfx.ts`, `weapons.ts`, `menu.ts`, `settings.ts`, `score.ts`,
> `audio-mix.ts`), which got most of the benefit of the split, but `main.ts`
> itself grew rather than shrank (~3,800 lines) and the loop is still one
> function. SH-025 is now MORE urgent, not less.
>
> Also found and fixed a real engine bug that had nothing to do with the round
> and everything to do with why it took so long: `set_user_params` silently
> unbound a material's texture array (engine EN-014). And two new engine
> tickets from things that turned out to be broken: EN-038 (`takeScreenshot()`
> never fires on Windows — every screenshot harness has been capturing
> nothing) and EN-039 (immediate draws can't pitch, so the gun can't tilt with
> the aim).
>
> **EN-038's evidence is void (2026-07-12).** It concluded `takeScreenshot()` was
> dead *because its unconditional `eprintln!` never printed*. That inference does
> not hold: on this box **no `eprintln!` from post-init engine code reaches a
> redirected stderr at all**. Verified by putting a print in `bloom_begin_drawing`
> — which must run 60x a second for the game to render at all — and getting
> nothing, while a `std::fs::write` from the very same place fired fine. Only the
> two init-time lines ever appear. So `takeScreenshot` may have been firing all
> along and failing for another reason; EN-038 needs re-diagnosing with a
> file-write probe, not a print. **Any past Windows debugging that concluded "the
> FFI is never reached" from a missing log line is suspect for the same reason.**

**Engine gates** (details in engine `docs/tickets.md`):

| Game ticket | Engine ticket | What it unlocks |
|---|---|---|
| SH-031 ragdoll deaths | EN-025 ragdoll FFI | clip → physics death handoff |
| SH-033 combat VFX | EN-026 particles + EN-027 decals | blood/smoke/shells/bullet holes |
| SH-034 locomotion, SH-030 polish | EN-028 anim blending/masks/root motion | pop-free transitions |
| SH-035 audio depth | EN-029 buses/reverb/occlusion | weapon tails, zone reverb |
| SH-038 menus | EN-030 UI widget layer | navigable settings/pause UI |
| SH-039 gamepad | EN-031 backend verification | pad input actually polled natively |
| SH-027 weapon attach (v2) | EN-033 bone-socket query | weapon rides the hand bone |

## Closed tickets (2026-07-12)

| Ticket | Resolution |
|---|---|
| SH-002 scrolling water normal map | ❌ won't-do — water accepted at current quality |
| SH-004 tree-tint distribution | folded into SH-014 (HSV clamp) |
| SH-006 footstep dust puffs | absorbed into SH-033 (combat VFX suite) |
| SH-008 sprint key | absorbed into SH-032 (movement expansion) |
| SH-012 two-sided foliage lighting | ✅ shipped (round-2 PR #2, evolved form — crown AO + rim-gated transmission) |
| SH-015 multi-octave Gerstner | ❌ won't-do — water accepted |
| SH-016 GGX sun glint | ❌ won't-do — water accepted |
| SH-017 texture caustics | ❌ won't-do — water accepted |
| SH-018 shore wetness | ❌ won't-do — water accepted |
| SH-019 underwater post-process | ❌ won't-do — wading is not a mechanic; EN-017 post-pass (now shipped) is consumed by SH-029 instead |
| SH-021 high-density instanced grass | ✅ shipped (20k instances, one draw, wind + shadows + transmission) |
| SH-022 planar-reflective river | ✅ shipped (planar probe + round-2 fresnel recalibration + 2026-07 probe perf fixes) |

---

# Round 0 — Architecture

Prerequisite for the feel/content rounds: gameplay work multiplies
LOC, and `main.ts` is already at ~3,200 lines with ~18 subsystems
inline.

---

## SH-025 — Split `main.ts` into modules ✅ *(COMPLETE 2026-07-15 — slices a–d landed, PRs #14–#17)*

> **Status 2026-07-15 — the split is done.** Four slices, each landed as its
> own PR with a behavioural probe (a green compile proves nothing here — Perry
> is silent about unresolved cross-module references and throws ReferenceError
> at runtime, one identifier at a time):
>
> - **a — `environment.ts`** (PR #14): water + planar probe, 20k grass,
>   building, glass, muzzle material, gi_only Lumen proxies.
> - **b — `director.ts` + `gamestate.ts`** (PR #15): wave plan/spawn, per-kind
>   AI, enemy projectiles, damage/death; shared run scalars as `const GS`.
> - **c — `combat.ts`** (PR #16): weapon transform (SH-027), fire block,
>   player projectile pool, pickups, explode, startRun/resetRun, combat draws.
> - **d — `camera.ts` + `hud.ts`** (PR #17): orbit camera with the canopy
>   occlusion (probe fan + analytic cylinders), pad aim assist; the in-run HUD,
>   overlays and run summary.
>
> `main.ts`: 4,381 → 2,132 lines. What remains is what a main file should be:
> CLI overrides, asset/world boot in order, the frame loop and its wiring, the
> dormant test harnesses, and the diagnostics (diag bar, profiler overlay).
>
> The patterns that made it safe are written down in the module headers:
> top-level functions only (nested declarations kill the process silently at
> boot), state crosses as `const` object/array slots (exported `let`
> reassignment does not propagate), main-owned handles cross ONCE via
> `set*Deps()` before the loop, engine calls never at module scope — but
> `W.*` capture at module scope is fine (world-runtime parses the world file
> in its own module body, which import order runs first).

### Original notes (first slice, 2026-07-12)

> **The enemy system now lives in `src/enemies.ts`** — seven kinds, their stat
> lines, animation-clip indices, ranged bands, AI constants, and the ~40 flat
> per-slot state arrays. `main.ts` is down to 3,849 lines from 4,088 despite this
> session adding ragdolls, a cloud deck and hierarchical wind.
>
> **Exported by NAME, not behind a namespace object.** main.ts has ~500 references
> to these arrays across the AI block, the damage path and the draw pass. Named
> imports mean the extraction moved declarations and touched **not one call site** —
> the difference between a refactor you can verify and one you can only hope about.
> It compiled first try.
>
> **The one real trap:** an imported module's body runs *before* the importer's, so
> `loadModel()` at `enemies.ts` module scope fired before `main.ts` had called
> `initWindow()` — the engine panicked with `Engine not initialized`. Everything
> that touches the engine had to move into `initEnemyPool(physics)`, which main.ts
> calls at the point the old inline block used to sit. Worth remembering for any
> future extraction: **data can live at module scope; engine calls cannot.**
>
> Verified behaviourally, not just by compiling: the `AITEST` harness logged
> enemies spawning, closing on the player (56.8 → 51.0 → 39.8 → 34.3 → 28.7 m) and
> cycling their state machines (mantis approach → orbit → recover), with the
> corpse, wave and score HUD all live.
>
> The AI block itself stays in the game loop. It reads player state and writes
> projectiles, VFX, audio and score, so extracting it is a dependency-injection
> design, not code motion — and the state boundary above is what makes that
> tractable later. The remaining `main.ts` is the loop and its wiring, which is
> what a main file should be.

> **Status 2026-07-12.** Everything NEW went into its own module — `feel.ts`,
> `vfx.ts`, `weapons.ts`, `menu.ts`, `settings.ts`, `score.ts`, `audio-mix.ts`,
> `terrain.ts` — and the ~600 lines of inline WGSL are gone (SH-005), so
> `main.ts` came down from 4,024 to ~3,460 lines despite the round adding a
> large amount of behaviour.
>
> What remains is the **enemy system** (kind tables, pool, per-kind AI state
> machines, damage, draw) and the game loop itself. That extraction is a
> mechanical rename across ~300 array references, and it deserves to be its own
> change with its own verification pass rather than being bolted onto the tail
> of a feature round — the risk of quietly breaking a verified game is real and
> the payoff is maintainability, not behaviour.
>
> The original *motivation* — "gameplay work multiplies LOC, do this first so
> the feel round doesn't collide" — is now moot: the feel round is landed. What
> is left is the ordinary case for good structure, and it should be scheduled as
> such.

**Why:** `main.ts` is ~3,200 LOC: audio setup, physics colliders,
water/grass/glass/building mesh+material construction, enemy tables +
pools + AI, wave director, weapons, projectiles, pickups, sparks, GI
proxies, four dormant test harnesses, and a ~1,300-line game loop —
all in one module scope. Every feel ticket in Round 1 lands inside
this file; without boundaries the merge conflicts and accidental
coupling will eat the round. Perry compiles multi-module projects fine
(`input.ts`/`player.ts`/`world-runtime.ts` already exist) — the
single-file layout is historical, not required.

**Scope:** medium — pure code motion, no behavior change.

- Target modules (each owns its flat-array state and exports
  init/update/draw functions):
  - `src/world-setup.ts` — env/post-FX config, static + heightfield +
    trunk colliders, water/grass/glass/building meshes + materials,
    GI proxies.
  - `src/enemies.ts` — kind tables, Jolt body pool, per-kind AI state
    machines, hit/death/corpse handling.
  - `src/waves.ts` — wave director + spawners + pickups.
  - `src/weapons.ts` — weapon state, firing, projectile pool.
  - `src/vfx.ts` — sparks, muzzle flash, projectile draw (future home
    of the SH-033 particle/decal wrappers).
  - `src/audio-game.ts` — sound handle tables, 3D-audio helpers,
    music state.
  - `src/hud.ts` — the whole 2D pass (HUD, overlays, touch controls).
  - `src/debug.ts` — SELFTEST/WATERTEST/AITEST/PERFTEST harnesses,
    F5–F8 toggle bar, diag bar. (Keep the harnesses — they are the
    audit tooling — but out of the shipping loop's file.)
- Perry rules carry over verbatim: flat arrays via `new Array(n)` +
  index assignment, no `throw`, no per-frame FFI-string parsing,
  static imports only.

**Acceptance:** game behaves identically (title-screen fps within
noise of pre-split; one full 3-wave playthrough with kills, death,
restart); `main.ts` shrinks to orchestration (< ~600 LOC); each
harness still runs when its flag is flipped.

---

## SH-005 — Inline WGSL fallback strings auto-generated ✅ *(shipped — materials load from `assets/materials/*.wgsl`; no inline WGSL left in game source)*

**Why:** `main.ts` carries inline copies of **three** shaders now —
`GRASS_INSTANCED_WGSL`, the ~130-line water WGSL, and the glass WGSL
(~600 LOC of duplication against `assets/materials/*.wgsl`). The
drift bit for real during EN-022 (motion-vector rewrite had to be
hand-applied to both copies).

**Scope:** small — `tools/build-materials.ts` reads each
`assets/materials/*.wgsl` and emits `src/generated/materials.ts`
exporting one const per file; game imports from the generated module.
Hook into `npm run build`/`npm run dev`.

**Acceptance:** edit `assets/materials/water.wgsl`, run the build,
the generated module updates verbatim; no hand-maintained WGSL
strings remain in game source.

---

## SH-026 — Dead-weight sweep ✅ *(shipped; `tree.wgsl` also removed with SH-007)*

**Why:** the repo ships things the game never uses, and the loop
carries scaffolding.

**Scope:** small.

- Delete or stop shipping `house.glb` (45 prims/45 materials, unused)
  and `calib_rig.glb` (20k tris, unused) — perf-audit finding 12.
- Remove the startup smoke-test material + cube block
  (`main.ts:448-518`) or fold it into `src/debug.ts`.
- Remove the `perfWindows === 23` early-exit leftover in the PERFTEST
  path.
- Verify no other committed asset is unreferenced
  (`bun tools/validate-glb.ts` sweep + grep for each `assets/models/*`
  filename).

**Acceptance:** binary/asset payload drops; a full playthrough is
unchanged.

---

# Round 1 — Combat feel

The largest gap-to-effort ratio in the whole audit. Everything here
is what makes 30 seconds of footage read as AAA.

---

## SH-027 — Real weapon models ✅ *(shipped; v2 complete 2026-07-15 — hand-bone attach + the gun tilts with aim)*

> **v2 closed 2026-07-15.** This header claimed v2 was "still gated on EN-033"
> long after EN-033 landed — the weapon has ridden the `tag_weapon` hand joint
> via `jointWorld()` since then, with the fixed offset only a fallback. The last
> real gap was pitch: `drawModelRotated` takes a single Y rotation, so the barrel
> stayed level while you aimed up or down. **EN-039** (`drawModelTransform`,
> engine PR #100) landed and this now feeds it the same forward vector the
> muzzle, tracer and shot ray use — so the gun and the bullet agree by
> construction. Shooter PR #22.

**Why:** both weapons are **grey `drawCube` primitives**
(`main.ts:2795-2836`). This is the single most visible "placeholder"
left in the game.

**Scope:** medium.

- Convert the Unvanquished rifle + a blaster-appropriate weapon from
  `vendor/unvanquished pkg/res-weapons_src.dpkdir` (IQE/MD5 sources)
  via the existing converter flow (new `tools/convert-weapons.ts`,
  patterned on `convert-aliens-anim.ts`; static mesh is enough for
  v1, fire/reload clips if the sources carry them).
- Record each weapon's muzzle position in the GLB (or a constants
  table) so muzzle flash, tracers, and shell ejection (SH-033) spawn
  from the real barrel.
- **v1 attach:** draw the weapon at a fixed offset from the player
  model transform, pitched with aim — same math the cube uses today.
- **v2 attach (EN-033):** query the hand joint's world transform per
  frame and parent the weapon to it, so it rides walk/run/attack
  animations.

**Acceptance:** no cube weapons anywhere; rifle and blaster are
visibly distinct models; muzzle flash originates at the true muzzle
in third-person at all pitches.

**Blocker:** asset conversion pass (vendor submodule already
documented in README).

---

## SH-028 — Weapon mechanics: reload, spread, recoil, aim ✅ *(shipped — `src/weapons.ts`)*

**Why:** `R` refills the mag instantly, the rifle raycast is
pixel-perfect down camera-forward with zero spread
(`main.ts:2500-2501`), and recoil is a cosmetic 18 cm model slide for
one flash tick. AAA gunfeel is these four systems interacting.

**Scope:** medium — all game-side math in `src/weapons.ts`.

- **Timed reload:** rifle 1.6 s, blaster 2.0 s; movement allowed;
  switching weapons or dodging cancels it; HUD shows a radial/bar
  progress; reload SFX start/finish.
- **Spread:** per-weapon base cone (rifle 0.8°) growing +0.25° per
  shot to a 3.0° cap, recovering at 4°/s; fired ray perturbed inside
  the cone; crosshair gap renders live spread. Blaster: no cone
  (projectile), slower recovery of camera kick instead.
- **Recoil:** camera pitch kick per shot (rifle 0.35°, blaster 1.2°)
  with smooth recovery toward the pre-fire aim; small horizontal
  jitter so full-auto climbs with wobble, not a rail.
- **Aim mode (TPS shoulder aim):** hold RMB / LT — orbit distance
  6.0 → 2.6 m, FOV 70 → 52 (lerped ~10/s), spread ×0.4, look
  sensitivity ×0.6, crosshair tightens. Camera-collision logic
  (`main.ts:2113-2168`) already handles the closer orbit.
- Per-weapon stat table (damage, rpm, mag, reload, spread base/growth/
  recovery, kick) as one flat structure so SH-042's new weapons are
  rows, not code.

**Acceptance:** full-auto at 20 m visibly walks off target and
recovers; tap-fire stays tight; reload is interruptible with visible
progress; aim mode zooms smoothly over the shoulder and steadies the
gun; all tunables live in the stat table.

---

## SH-029 — Camera & screen feedback ✅ *(shipped — `src/feel.ts`: trauma shake, hit-stop, flinch)*

**Why:** no camera shake, no FOV kick, no damage flinch, no hit-stop
anywhere — fixed FOV 70 and a red edge vignette are the entire
somatic channel. This is pure `main.ts` math plus the already-shipped
engine post-pass slot (EN-017 ✅); zero engine work.

**Scope:** medium.

- **Trauma-based shake:** single scalar `trauma` (0..1); events add
  trauma (player damage 0.4, tyrant stomp within 12 m 0.3 scaled by
  distance, explosion 0.6); shake amplitude = trauma², applied as
  hash-noise yaw/pitch/roll offsets (max ~1.2°) decaying at 1.5/s.
  Exposed as a 0–1 accessibility slider (SH-043).
- **FOV kick:** sprint +6° (SH-032), dodge +4° pulse, lerp ~8/s.
- **Damage flinch:** short pitch/yaw impulse away from the damage
  source + a directional red arc on the HUD pointing at the attacker.
- **Hit-stop:** on kill, timescale 0.05 for ~50 ms (cap once per
  second); on heavy hits (dragoon pounce connecting), 80 ms.
- **Post FX states via `addPostPass`:** damage flash (brief warm
  desaturate), low-health (< 25 HP) desaturation + vignette deepen.
- **Landing dip:** small camera Y dip + recovery on landing from a
  jump/fall.

**Acceptance:** getting hit is unmistakable with eyes on the
crosshair (flinch + arc + flash); kills feel punchy (hit-stop +
shake); sprint/dodge read through FOV; all magnitudes on the settings
sliders; motion-sensitive players can zero the shake.

---

## SH-030 — Enemy hit reactions ✅ *(shipped — flinch + stagger meter; EN-028 crossfades landed)*

**Why:** shooting an enemy produces only a 0.18 s red tint flash
(`main.ts:2876-2882`). No flinch, no stagger — damage feedback is the
core loop of a shooter and this is the weakest link in it.

**Scope:** medium.

- Verify pain clips exist in the converted GLBs
  (`bun tools/inspect-glb.ts assets/models/enemy_dretch.glb` — the
  IQE sources carry pain animations and the converter already
  extracts all clips); add an `ANIM_PAIN_IDX` per-kind table next to
  `ANIM_WALK_IDX`.
- New `AI_FLINCH` state: light kinds (dretch/mantis/marauder) play
  pain + freeze steering for ~0.25 s on any hit, with a 0.6 s lockout
  so full-auto doesn't stun-lock.
- Heavy kinds (dragoon/tyrant): stagger meter — if damage taken in a
  1 s window exceeds 15% of max HP, 0.6 s stagger (pain clip +
  movement zeroed); otherwise unflinching (preserves their menace).
- v1 uses hard clip swaps (current engine behavior); when EN-028
  lands, crossfade 0.1 s in/out.

**Acceptance:** every landed shot produces a visible skeletal
reaction or an intentional "armored, unflinching" read on heavies;
sustained fire staggers a dragoon mid-telegraph; no stun-lock.

---

## SH-031 — Ragdoll deaths ✅ *(shipped 2026-07-12; EN-025 landed)*

> **Shipped.** The handoff point turned out to be the whole design. Going
> straight to physics on the death frame throws away the authored mortal blow
> and the enemy goes limp like a dropped coat; playing the clip out in full and
> *then* switching shows a visible snap from the canned final pose into a
> physical one. Shipping value: **0.22 s** — the blow lands, the thing reels,
> and physics picks up the motion the animator started.
>
> Corpses are thrown along the killing shot, scaled by damage and divided by the
> kind's heft. Ragdolls are pooled per enemy slot and released on settle (8 s)
> and on run restart — an unreleased ragdoll leaks bodies into the physics world,
> and a restart is exactly where that would go unnoticed. Kinds with no usable
> skeleton fall back to the old clip-and-sink corpse.
>
> The joint limits were the tuning: the first pass used generous ones (±1.2 rad)
> and the bodies settled into a **puddle** rather than a body. ±0.8 bend / ±0.25
> twist + 0.75 angular damping + chunkier capsules (0.38 × bone length) is what
> made them read as corpses.

**Why:** deaths play one clip, clamp the last frame, then the corpse
sinks through the floor (`main.ts:2885-2901`). Ragdoll handoff is the
single strongest "physical world" signal in the genre, and Jolt
already ships the ragdoll code — it just has no FFI.

**Scope:** small once EN-025 lands.

- On death: play the die clip for 0.15–0.3 s (the recognizable
  "mortal blow" pose), then hand off to a ragdoll seeded with the
  current pose and an impulse along the killing shot's direction
  scaled by weapon damage.
- Corpses settle for ~8 s, then sink/free as today (pool of
  `BODIES_PER_KIND` ragdolls, reused).
- Mobile profile keeps the clip-only path (perf).

**Acceptance:** enemies crumple over terrain edges and slide down
slopes; a blaster kill visibly shoves the body; no corpse clips
through the heightfield; frame cost < 0.5 ms with 4 active ragdolls.

**Blocker:** EN-025.

---

## SH-032 — Movement expansion: sprint + dodge ✅ *(shipped — `src/player.ts`)*

**Why:** the player walks at one speed and jumps. Enemy AI (mantis
darts, dragoon pounces) is already more mobile than the player —
inverted from how a power-fantasy shooter should feel.

**Scope:** small — `player.ts` + input.

- **Sprint:** hold Shift / stick fully deflected (touch) — 1.5×
  `MOVE_SPEED`, +6° FOV (SH-029), sprint interrupts aim mode, firing
  drops sprint. No stamina meter — arcade pacing.
- **Dodge:** tap Ctrl (pad: B) — 4.5 m burst over 0.25 s in the
  current move direction, 1.2 s cooldown, cancels reload, small FOV
  pulse. No i-frames v1 (tune after playtest).
- Player run animation exists in the GLB and is currently unused
  (`main.ts:440-443`) — wire it to sprint.

**Acceptance:** sprint visibly faster with run anim + FOV; dodge
reliably escapes a telegraphed dragoon pounce when timed; cooldowns
readable on the HUD.

---

## SH-033 — Combat VFX suite ✅ *(shipped — EN-026 particles + EN-027 decals landed; `src/vfx.ts`)*

**Why:** the game has a 16-slot spark pool and a muzzle puff — no
blood, no tracers, no shells, no impact variety, no dust, and the
world takes no marks. This is most of the remaining visual gap in
actual combat footage.

**Scope:** medium game-side once the engine systems exist. Itemized:

- **Muzzle:** flash sprite (2 frames) + 4–6 smoke wisps per shot,
  warm point-light pulse (already exists — keep).
- **Tracers:** stretched additive quad along the hitscan ray every
  3rd rifle shot, ~12 m/frame apparent speed.
- **Shells:** 1 per rifle shot, 24-slot pool, manual ballistic arc +
  one ground bounce + ricochet-tick SFX, fade after 3 s.
- **Blood:** 8–12 dark sprites burst from the hit point along the
  ray reflection + a splat decal beneath the enemy; per-kind tint
  (alien green/violet — matches the licensed art's palette).
- **Impact decals:** bullet holes on stone/building, scorch for
  blaster, 64-slot ring buffer, normal-aligned (EN-027).
- **Dust kicks:** footstep puffs while sprinting on grass/dirt
  (absorbs SH-006) + landing puff, driven from the SH-003 step
  events.
- **Death burst:** brief per-kind particle burst on kill (fluid spray
  for dretch, chitin flecks for tyrant) layered under the ragdoll.
- **Explosion set:** flash + fireball sprites + smoke column + dirt
  chunks + decal — consumed by SH-042's lucifer cannon.
- **Water splash** on projectile/ray hits in the river — the impulse
  field already exists; add the sprite burst.

**Acceptance:** a 10-second combat clip contains visible tracers,
shells, blood, and persistent bullet holes; total particle GPU cost
< 0.5 ms in heavy combat on the dev 760M; mobile profile halves pool
sizes.

**Blockers:** EN-026, EN-027.

---

## SH-034 — Locomotion & animation blending ✅ *(shipped; **thresholds corrected 2026-07-13** — see below)*

**The bug that shipped with it.** The clip was chosen by crossing a speed
threshold: run above 7.0 m/s, walk below. But `MOVE_SPEED` was **6.0**, so normal
movement *always* took the walk clip — and the walk clip is authored for ~2.6 m/s,
so covering 6 m/s of ground meant playing it at the **2.2x clamp**. Even at the
clamp the stride only covers ~5.7 m/s, so the feet could never keep up with the
floor. That is what read as the player "sliding": the animation was playing the
whole time, at double speed, losing a race with the ground.

Sprint (9.0 m/s target, ~7.4 actual) only just cleared 7.0, so the run clip
flickered in and out at the boundary rather than being a state you could feel.

**Fixed two ways, and the second is the real one:**

1. The clip now follows what the player is *doing* — `isSprinting()` runs, moving
   walks, standing idles. No threshold to sit on. (`isSprinting()` was exported by
   `player.ts` and imported by nobody, which was the clue.)
2. `MOVE_SPEED` 6.0 → **4.5**. 6.0 m/s is a *run* speed wearing a walk animation;
   no clip selection fixes that. `SPRINT_MUL` 1.5 → **2.0** absorbs it, so the top
   speed is **still 9.0 m/s** and nothing about outrunning a dragoon pounce
   changed. Only the cruise is slower — and now holding shift is the difference
   between a walk and a run, which is what it should always have been.

**The clamp is the canary.** Playback rate is (actual speed / the speed the clip
was authored for). If that ratio ever *reaches* the clamp, the movement speed and
the clip no longer belong together, and the fix is the speed constant — not a wider
clamp. Measured after the change: walk lands at ~1.4x, sprint at ~1.1x. Both well
inside it.

**Why:** every animation change is a hard swap; enemies play walk at
a fixed rate regardless of actual velocity (foot-sliding); the player
never blends idle/walk/run; attacks hijack the whole body.

**Scope:** medium.

- **No engine dep, do now:** sync each enemy's walk-clip playback
  rate to its actual speed / authored stride speed — kills the
  foot-slide for a few lines.
- **Gated on EN-028 crossfade:** 0.15 s fades on all transitions
  (walk↔attack↔pain↔die, player idle↔walk↔run).
- **Gated on EN-028 masks:** attack as an upper-body layer over
  locomotion so enemies bite while closing instead of stopping.
- **Gated on EN-028 root motion:** dragoon pounce and tyrant charge
  driven by authored root motion (the engine currently strips it at
  import) — the authored arcs are better than the hand-tuned
  kinematics in the AI.

**Acceptance:** no foot-sliding at any enemy speed; no visible pops
between clips; a marauder can lunge-bite mid-stride; the dragoon
pounce trajectory matches its authored animation.

**Blocker:** EN-028 for everything past the playback-rate sync.

---

# Round 2 — Audio

---

## SH-003 — Footstep audio (positional) ✅ *(shipped 2026-07-12 — synthesised stand-ins; see ASSET-TODO A1)*

**Why:** motion is silent except water wading. Footsteps are the
cheapest presence signal in games.

**Scope:** small.

- 3–4 step variants each for grass and dirt + reuse the water splash;
  trigger by accumulated horizontal distance modulo stride (~0.8 m
  walk, ~0.55 m interval at sprint); surface picked from position
  (river band = water, else grass/dirt by terrain paint category).
- **Extended:** tyrant footsteps as heavy 3D thuds with a subtle
  distance-scaled camera rumble (SH-029 trauma 0.05/step within
  15 m) — telegraphs the most dangerous enemy through walls.
- Emits "step events" consumed by SH-033's dust kicks.

**Acceptance:** walking/sprinting is audible at believable cadence;
entering the river switches to splashes; an unseen tyrant is heard
(and faintly felt) approaching.

**Blocker:** asset (step SFX — Sonniss GDC bundle already in the
audio sources).

---

## SH-001 — Wind-coupled ambient audio ✅ *(shipped 2026-07-12 — 3 forest-centroid sources, volume from the live wind amplitude)*

**Why:** grass, canopies, and cloud shadows all move on the wind UBO;
audio is a static loop. A 3D leaf-rustle bed scaled by `wind.amp`
closes the "place isn't alive" gap.

**Scope:** small once the asset exists — `playSound3D` loops at 3–4
forest centroids, volume from the same wind vec4 that drives sway;
linear falloff 25→40 m.

**Acceptance:** rustle near trees, fading in open field, swelling
when `wind.amp` is cranked.

**Blocker:** asset (CC0 wind-through-trees loop).

---

## SH-035 — Weapon audio & mix depth ✅ *(code shipped — EN-029 buses/reverb/ducking landed; layered tails still asset-blocked)*

**Why:** weapon shots are single one-shot samples on a flat mix. The
"crack-BOOM" that makes AAA guns feel powerful is a close-mic body
layer plus a reverb tail plus a mix that ducks around it.

**Scope:** medium.

- Fire = body sample + tail layer routed through the reverb send.
- Bus layout (EN-029): master → music / sfx / ui; music ducks −6 dB
  for 1.5 s when the player takes damage; everything but a heartbeat
  LP ducks at < 15 HP.
- Reverb zone: proximity to the building raises the send (~0.3)
  so fights by the walls sound enclosed; open field stays dry.
- Occlusion: 1 ray to each audible emitter; blocked by the building
  → low-pass ~1.2 kHz.
- Distance layers for enemy vocals: beyond ~25 m swap to a
  low-passed variant so far shrieks read distant, not quiet.

**Acceptance:** rifle sounds distinct at the wall vs open field; a
dragoon shrieking behind the building is audibly muffled; taking
damage audibly ducks the music; no render-thread glitches.

**Blocker:** EN-029.

---

## SH-036 — Dynamic music intensity ✅ *(shipped 2026-07-13 — real music, mastered and looping)*

**Why:** one looping combat track from the first frame to the last
flattens the pacing the wave director already creates.

**Scope:** small logic, asset-bound.

- Two intensity states v1: **calm** (between waves / < 2 enemies
  alive) and **combat** (wave active), crossfaded over ~2 s on state
  change with a 4 s hysteresis so it doesn't flap.
- Stingers: wave-clear, player death, victory (2–4 s one-shots over
  the bed).
- Assets: arrange the existing `game.wav` into two loopable stems +
  3 stingers (or source CC0 equivalents).

**Acceptance:** clearing a wave audibly relaxes the music within
seconds; the next wave's spawn re-escalates it; stingers land on
clear/death/win.

**Status (2026-07-13):** the software half is DONE. The game loads
`assets/music/{music_calm,music_combat,music_menu}.ogg` and the three
stingers if they exist, and falls back to the old single `game.wav` bed
if they don't — so the repo still runs with no music directory at all,
exactly as before.

- Both beds stream **simultaneously** from the moment play starts, and
  the crossfade is pure gain. Opening the combat stream on demand would
  cost a stream-open on the frame a wave spawns — the worst frame there
  is — and would start it at bar 0 while the calm bed was 40 s in, so
  the two would be permanently out of phase.
- The fade is **equal-power** (`cos`/`sin`), not linear: two linear fades
  sum to a ~3 dB dip in the middle, heard as the music ducking every
  time a wave starts.
- Both streams are pumped every frame even when one is silent, or the
  silent one starves and comes in late when the crossfade reaches it.
- Stingers are one-shots played **over** the bed. Victory replaces the
  wave-clear sting rather than stacking with it.

**Blocker:** the audio. `assets/music/SUNO-PROMPTS.md` has the six
prompts and — the part that actually matters — the **key/tempo lock**:
the two beds are crossfaded, not cut, so if they are in different keys
the 2 s overlap is two songs colliding and no mixing fixes it later.

---

# Round 3 — Game structure & content

What turns the demo into a game. Order matters: SH-037 (settings
data) before SH-038 (menus that edit it); SH-040 (levels) before
SH-041/SH-042 fill them.

---

## SH-037 — Settings & persistence foundation ✅ *(shipped — `src/settings.ts`)*

**Why:** nothing persists — no settings, no saves, every tunable is a
compile-time constant. Every later ticket (menus, gamepad, meta
scores, accessibility) needs this file.

**Scope:** small.

- `settings.json` next to the binary via the engine's
  `bloom_read_file`/`bloom_write_file`; parsed **once at boot**
  (`JSON.parse` is safe at load on Perry 0.5.1208; keep the flat-array
  rules — read fields by explicit key, never `.push()`).
- Schema v1: `video` (renderScale, fpsCap, vsync, fov, shakeScale),
  `audio` (master/music/sfx volumes), `controls` (sensitivity,
  invertY, bind map, aimToggle/holdMode).
- Write-through on change (from SH-038's UI); missing/corrupt file →
  defaults, never a crash.
- Same file carries `meta` (best scores, unlocks) for SH-041.

**Acceptance:** change sensitivity, quit, relaunch — it stuck; delete
the file — clean defaults; no per-frame file or parse work.

---

## SH-038 — Front-end, pause & settings menus ✅ *(shipped — `src/menu.ts`)*

**Why:** there is no pause, no settings UI, and the title screen is
"press anything." Two states exist in the whole game
(`main.ts:1491`).

**Scope:** medium.

- **Pause (Esc / Start):** freezes the sim (dt=0 path — audio keeps
  running, world stops), releases cursor capture; Resume / Settings /
  Restart / Quit.
- **Title:** Play / Level select (SH-040) / Settings / Quit over the
  existing live-world backdrop.
- **Settings panel:** sliders/toggles bound to SH-037 (video, audio,
  controls, accessibility), applied live where possible (renderScale,
  volumes) and on-confirm otherwise.
- **Game-over / victory:** proper flow into Restart / Level select /
  Title instead of the bare `R` prompt.
- Navigable by mouse, keyboard, touch, and gamepad (SH-039) — this
  is what EN-030's focus model exists for. Interim: the game already
  hit-tests hand-drawn touch buttons; an IM version can ship before
  EN-030 if that lands first.
- Menu click/hover SFX on the ui bus.

**Acceptance:** Esc pauses and fully resumes mid-combat with no state
corruption; all SH-037 settings are editable in-game on all four
input methods; dying no longer dead-ends into a keyboard-only prompt.

**Blocker:** EN-030 (or accept the IM interim).

---

## SH-039 — Gamepad support ✅ *(shipped — EN-031: XInput polling was already wired; rumble added)*

**Why:** input is keyboard/mouse + touch only. The engine FFI surface
already exists (`bloom_is_gamepad_available`, `bloom_get_gamepad_axis`,
button queries — engine `package.json:1664-1697`) but nothing in the
game consumes it, and the native backends need verification (EN-031 —
the `inject_*` twins suggest the desktop path may never have been
wired to real hardware).

**Scope:** medium.

- Mapping: LS move, RS look, RT fire, LT aim, A jump, B dodge,
  X reload, Y switch weapon, Start pause, D-pad menu nav.
- Look-stick response curve (x·|x|) + separate pad sensitivity in
  SH-037; deadzones per stick.
- **Aim slowdown** (TPS-standard pad assist): inside a 6° cone of an
  enemy, look sensitivity ×0.65. No magnetism v1.
- Menus (SH-038) fully navigable; on-screen glyphs switch to pad
  buttons when a pad was the last input.

**Acceptance:** full playthrough start-to-victory on a pad without
touching the keyboard, on Windows and iPhone (BT controller).

**Blocker:** EN-031.

---

## SH-040 — Level pipeline & selection 🟡 *(pipeline ✅; arenas 2 of 3 — arena_03 shipped 2026-07-16)*

> **arena_03 "RIVERBEND RAVINE" landed (2026-07-16, `tools/gen-arena-03.ts`).**
> The different read the ticket asked for: a north-south ravine, the river as
> its floor, two saddle crossings as the chokepoints, dense rim forest, crate
> cover on the floor, and ranged kinds mixed in FROM WAVE 1 (SH-042's per-arena
> acceptance). Verified end-to-end: boots via the manifest, AITEST plays a
> mixed wave on it (adv marauder holding its 16.9 m band), captures in
> `tools/.testout/arena03-*.png`. Two generalizations made the "no game code
> per arena" claim true: `build-terrain.ts` takes an output GLB path, and
> main.ts matches ANY `assets/models/terrain_*.glb` as the terrain shell.
> The generator is a SEEDING tool like the others — re-running it overwrites
> editor work; the file is the editor's to own now. Still owed for ✅: a third
> arena, and arena_01's rehab or retirement.


> **Reality check 2026-07-15: the PIPELINE is done, the CONTENT is not. One
> arena is playable.** `arenas.json` lists only `arena_02`. The acceptance was
> "three selectable, completable arenas". This is the single biggest gap between
> what the game says it is and what it is.
>
> **`arena_01` is NOT a rehab candidate — I tried it, and the attempt is the
> useful part.** The manifest calls it "a pre-schema-v2 stub"; it is actually
> schemaVersion 2 already, and it does have a `player_spawn`, an `enemy_spawner`
> and a `wave_config`. Only `terrain` is missing, which looks like a one-command
> fix (`bun tools/bake-terrain-to-world.ts assets/worlds/arena_01.world.json`).
> It is not. What that produces is INCOHERENT:
>
> - arena_01's ground is a flat `collider_box` (halfExtents 25,0.5,25). Baking a
>   heightfield on top gives you two grounds fighting each other.
> - The baker carves a river channel from the world's water volume. arena_01 has
>   no water, so it "carves the default channel" — a **dry ditch** across a box.
>
> Reverted. It loads, and it is worse than not offering it — which is exactly
> what the manifest comment already argued.
>
> **What arena_01 actually is:** a 50 × 50 flat walled box, one `enemy_spawner`,
> dretch-only waves (5 / 10 / 20), no pickups, no cover, no props. It is the
> original prototype, and it predates terrain, the prop vocabulary, ranged
> enemies and weapon pickups. Compare arena_02: **226 entities**.
>
> **So a second arena is AUTHORING, not repair.** Concretely it needs:
> 1. terrain baked *and* the flat ground collider removed (they conflict);
> 2. a water volume first if you want the river channel — or a baker run that
>    skips the carve;
> 3. `weapon_pickup`s — 35 enemies with no ammo resupply is not completable;
> 4. waves mixing kinds. SH-042's own acceptance asks for "at least one wave per
>    arena mixing ranged + melee pressure"; dretch-only fails it;
> 5. cover/props, or it is a flat box.
>
> None of that is blocked by code. Every system it needs already exists and the
> manifest takes a new entry with zero code changes — which is precisely why this
> is worth doing and why nobody has.


**Why:** `world-runtime.ts:23` hardcodes `arena_02`; `arena_01` is a
stale 8-entity v1 file; there is no way to ship more than one level.
The entire world pipeline (runtime `loadWorld`, editor round-trip)
already supports N levels — only the game pretends otherwise.

**Scope:** medium (code small; content is the point).

- `WORLD_PATH` becomes a parameter: default from `settings.json`,
  selected via the title-screen level list (SH-038); level list =
  scan or a small manifest of `assets/worlds/*.world.json` with
  display names.
- Rehab `arena_01` in the editor to schema v2 (terrain, lights,
  forest, wave plan) as the "small intro arena."
- Author **one new arena in the editor** end-to-end (different
  read: e.g. dense-forest ravine with the river as a chokepoint) —
  this is also the acceptance test for the whole editor pipeline and
  will surface its gaps (see Round 5).
- Per-world wave plans already live in world data (`wave_config`) —
  no code per level.

**Acceptance:** three selectable, completable arenas; adding a fourth
requires zero game-code changes — world file + manifest entry only.

---

## SH-041 — Meta loop: scoring, report, unlocks ✅ *(shipped — `src/score.ts`)*

**Why:** win/lose → restart with no numbers is a tech-demo loop.
Score pressure is the cheapest replayability system for an arena
shooter.

**Scope:** medium.

- Score: per-kind kill values × a combo multiplier (decays 4 s
  without a kill); accuracy and wave-time bonuses.
- End-of-wave report card (kills, accuracy, time, combo peak) and
  end-of-run total with per-arena best persisted via SH-037.
- Unlocks keyed to progress (e.g. chaingun unlocked by clearing
  arena_01; lucifer cannon by clearing arena_02 — pairs with
  SH-042).
- Optional wave modifiers surfaced on the report ("next wave:
  frenzied — enemies +20% speed, score ×1.5") for risk/reward.

**Acceptance:** the HUD shows live score/combo; the report screen
appears between waves; bests persist across relaunches; at least one
unlock gate works end-to-end.

---

## SH-042 — Content expansion: +2 weapons, +2 enemy kinds ✅ *(shipped — 4 weapons, 7 kinds, 2 of them RANGED; MAX_CONCURRENT 6→8 done 2026-07-15)*

> **The `MAX_CONCURRENT` 6 → 8 sub-item is now done, and measuring it was worth
> more than the change.** It was gated on "re-verify combat frame time"
> (acceptance: ≥ 35 fps at 4K/TSR). Measured on the dev box at the shipped
> defaults: **0 enemies → ~28 fps, 3 enemies → ~27.5 fps**. Enemies cost about
> **0.2 fps each**, so 8 concurrent is worth well under 1 fps. Bumped.
>
> But the acceptance **fails on the baseline** — ~28 fps with nothing on screen
> to fight. That is a rendering-cost problem (4K at 0.75 render scale, the
> forest, the house, the shadow/GI stack), not a director one, and it is not
> this ticket's to fix. See `docs/perf-audit-2026-07.md`, which now records the
> re-measurement. Do not "fix" the frame rate by lowering enemy counts: the
> numbers say it would buy nothing.

**Why:** 2 weapons and 5 enemy kinds is one encounter's worth of
variety; the run is ~3 minutes. The Unvanquished source packs carry
a full arsenal and more alien classes — conversion capacity, not
authoring, is the constraint.

**Scope:** large (this is the content ticket).

- **Chaingun:** 0.5 s spin-up → 1,200 rpm hitscan, heavy spread
  (2.5° base), strong shake while firing, big ammo pool. Stresses the
  SH-028 stat table and SH-029 feedback.
- **Lucifer cannon:** hold-to-charge (0–1.5 s) plasma sphere,
  radius-4 m AoE on impact with falloff damage + the SH-033 explosion
  set + a point-light pulse. First AoE — splash must damage the
  player too.
- **Basilisk** (IQE source exists): fast wall-hugging flanker; on
  hit applies a 4 s poison DoT (green edge vignette + tick SFX). New
  AI flavour: prefers approach vectors outside the player's view
  cone.
- **Advanced marauder** (IQE source exists): the first **ranged**
  enemy — holds a 12–18 m band, strafes, fires 3-projectile volleys
  (reuse the blaster projectile pool with a hostile flag). Forces
  cover usage and re-weights every arena.
- Wave plans in all three arenas updated to mix the new kinds;
  `MAX_CONCURRENT` 6 → 8 (skinned VB caching landed; re-verify combat
  frame time).

**Acceptance:** 4 weapons with distinct roles; 7 enemy kinds; at
least one wave per arena mixing ranged + melee pressure; heavy-combat
frame time still ≥ 35 fps on the dev box at 4K/TSR.

**Blocker:** asset conversion (models/anims/SFX for all four).

---

## SH-043 — Accessibility & localization scaffolding 🟡 *(partial — see below; the ✅ was wrong)*

> **Corrected 2026-07-15.** This header read
> *"✅ shipped — `src/strings.ts`, shake slider, colourblind-safe hit cues"*.
> **`src/strings.ts` has never existed** and there is not one `STRINGS`
> reference in `src/` — verified, not inferred. `docs/aaa-round-1.md` had the
> honest version all along ("Partial. Localization table not done."). This was
> the registry's only false ✅, and it is exactly the kind that costs someone a
> day: you go looking for a file the docs promise and it isn't there.
>
> | Part | Status |
> |---|---|
> | Camera-shake slider | ✅ shipped, wired to `FEEL.setShakeScale` |
> | Colourblind-safe hit cues | ✅ shipped — and **unconditional**: the white flash + tick and the damage arc REPLACED the colour-only versions. The `COLORBLIND CUES` settings row was therefore switching nothing and was removed 2026-07-15. |
> | Telegraph captions | ✅ shipped 2026-07-15 — the dragoon's roar IS the dodge window; a player who cannot hear it was told nothing. |
> | **Localization table (`strings.ts`)** | ❌ **NOT DONE** — every user-facing literal is still inline. |
> | **Rebindable keys** | ❌ **NOT DONE** — the bind list is fixed. |

**Why:** all-or-nothing camera shake, red-only damage cues, hardcoded
English literals, fixed keybinds. Cheap now, expensive to retrofit.

**Scope:** medium.

- `src/strings.ts`: every user-facing string through one flat table
  (key → text). English-only today; the table *is* the localization
  scaffolding.
- Remappable binds (data in SH-037, UI in SH-038); hold vs toggle
  for aim and sprint.
- Colorblind-safe feedback: hits confirmed by a white crosshair
  flash + tick sound, not only red tint; damage direction by shape
  (arc), not only color; HUD palette option.
- Caption cues for gameplay-critical audio: off-screen telegraphs
  ("Tyrant charging ←") as small HUD text, toggleable.
- Sliders: camera shake 0–1 (SH-029), FOV 60–90, look sensitivity.

**Acceptance:** shake can be zeroed; a colorblind player gets full
hit/damage information; every string in the game routes through
`strings.ts`; binds remap and persist.

---

# Round 4 — Visual backlog *(kept from the UE5-tier roadmap)*

Still worth shipping, now sequenced **after** feel/structure — the
renderer is past the point of diminishing returns relative to the
rounds above. Phase framing (A/B/C) from `docs/visual-quality.md`
still applies.

---

## SH-009 — Splat-mapped PBR terrain ✅ *(shipped — 4-layer triplanar splat; EN-014 texture-array bug fixed on the way)*

**Why:** the largest remaining pure-visual gap. `terrain.wgsl` is
procedural color stops with zero textures — below ~1 m the ground has
no detail.

**Scope:** medium — 4 CC0 PBR sets (grass_lush / grass_dry / dirt /
rock_cliff from Poly Haven; `forrest_ground_01` is already staged in
`assets/textures/external/`), texture-array bindings (EN-014 ✅),
triplanar projection, 4-layer weight blend by (noise, slope, height,
water-distance), cascade shadow sample. Pairs with the editor's
terrain-paint mode (Round 5) so the weights become authorable.

**Acceptance:** ground reads as real material at all distances;
cliffs show rock; layer transitions blend, not step.

**Weights are now AUTHORABLE (2026-07-13).** The four weights were computed
procedurally in the fragment shader — slope for rock, a moisture FBM for the
dry/lush grass split, distance to a hardcoded river line for dirt — and
`TerrainLayer.weights` was written by nothing and read by nothing. The editor's
paint brush (PLAN §D) now writes them, and they arrive here as one RGBA8 texel per
terrain cell, mixed **over** the procedural blend by coverage (= the sum of the four
weights).

That layering is the whole trick: a cell nobody painted has zero coverage and keeps
the procedural look *exactly*, so both shipped arenas render unchanged. Erasing in
the editor lowers coverage rather than zeroing the ground, so paint fades back into
the procedural blend instead of leaving a bald patch.

Layer order is the ABI and it is the **world file's**, not ours: if a world authors
`terrain.layers`, layer i's `textureRef` becomes array slice i and its weights become
splat channel i (normal map found by the `_albedo.png` → `_normal.png` convention).
No layers = the built-in four. Cap is 4 — the shader has four tints and four samples.

The splat map rides the MR array slot; SH-010's detail normal moved to slice 4 of the
normal array to free it (all five normal maps are 512², and there are only three
array slots — EN-014). Transport is EN-049 `createTextureArrayFromTexels`.

---

## SH-010 — Detail normal + macro variation ✅ *(shipped with SH-009)*

As specified previously: 512² detail normal at ~50× UV via
half-derivative blend + 256² macro mask at ~30 m scale into albedo.
Lands right after SH-009's binding pattern.

---

## SH-011 — Grass density LOD ✅ *(shipped 2026-07-12 — but not the way the ticket said)*

> **Measured, and the ticket's plan was wrong.** It asked for player-following
> density *rings* (2× inside 12 m, fading out by 40 m), and claimed the engine's
> grass-tile culling made that "a scatter-time bucketing change only". It doesn't:
> rings follow the **camera**, and these 20k instances are **static**. A ring would
> mean re-scattering and re-uploading 20k × 9 floats every frame — which the perf
> audit would flag the same week.
>
> What the tile culling *does* buy is that off-screen grass is already free. So the
> answer is simply more grass: **20k → 40k costs one fps** (34 → 33 on the 760M at
> 4K/TSR), and the field finally reads as grass rather than as tufts on a green
> carpet.
>
> 70k was measured too: still 33 fps, but **no denser to look at** — past ~40k the
> scatter saturates against its own keep-outs, so the limit is the scatter, not the
> GPU. There is no reason to pay for instances that never get placed.

---

## SH-013 — Hierarchical wind ✅ *(shipped 2026-07-12 as EN-041 — no vertex colours needed)*

> **Shipped, and the plan changed on contact.** The ticket said to bake wind
> weights into vertex colours. Two things killed that: `COLOR_0` is already spent
> by the engine as an **albedo multiplier**, so wind weights there would tint every
> trunk; and our trees are *procedurally generated*, which means the regions are
> known analytically and don't need authoring at all.
>
> So the weights are **derived** from where each vertex sits relative to the model
> origin: trunk bend ∝ height² (a cantilever), branch sway ∝ reach from the trunk
> axis, leaf flutter on the cutout cards only. Same three-layer result the ticket
> wanted — trunk slow, branches medium, leaves fast — with no new attribute and no
> GLB re-bake.
>
> **The real find:** the engine only ever swayed alpha-cut materials, so leaf cards
> fluttered and **all 88 trunks were rigid**. `setModelFoliageWind(model, 1.0)`
> opts a model in; everything else in the world stays still.
>
> **Swaying shadows are OFF (`FOLIAGE_SHADOW_MOTION = false`)** — and the reason is
> engine EN-042, not taste. A moving caster can't reuse the cached static shadow
> depth, so it must join the DYNAMIC set, which holds 64. The forest is 88 × 4 =
> **352**. Enabling it overflowed the budget and the overflow was dropped silently:
> it measured *faster* (34 → 40 fps) because it had deleted every tree shadow **and
> the player's own shadow**. The engine now degrades gracefully (24 foliage casters
> max), but the feature stays off until EN-042 raises the budget properly.

---

## SH-014 — Bark normal + per-tree HSV variance ✅ *(both halves shipped 2026-07-12)*

> **Tint half shipped 2026-07-12 — and the diagnosis was better than the fix the
> ticket proposed.** The tints were independent per-channel jitter (r, g and b
> each nudged at random around 1.0), i.e. a random walk in RGB — so **33 of 88
> trees** had their multiplier pushed off the green axis toward cyan or magenta.
> Saturation was low enough that no single tree looked wrong, but the canopy
> picked up a faint iridescent speckle that read as digital noise.
>
> HSV jitter with clamps (what the ticket asked for) would have papered over it.
> Real trees do not vary in hue at random: they vary along **one** axis — how
> lush or how dry — which runs green → yellow-olive, plus crown brightness. So
> that is what is generated now: a 1-D dryness parameter mapped into a wedge
> where **green is always the dominant channel**, so no tree *can* drift to cyan.
> Hue is now confined to 0.146–0.283 (was 0.354–0.856), zero outliers, and with
> *more* visible variety than before (sat 0.10–0.30, was 0.00–0.14).
>
> `bun tools/retint-forest.ts assets/worlds/arena_02.world.json` — rewrites ONLY
> the `tint` field, so editor-authored positions survive (unlike re-running
> `bake-forest-to-world.ts`, which re-seeds the whole forest). Verified: the diff
> is exactly 264 lines = 88 trees × 3 channels.

**Bark normal — ✅ already shipped, my earlier note was wrong.** I claimed this was
blocked on the missing `TANGENT` attribute. It isn't: the engine reconstructs a TBN
from screen-space derivatives (Mikkelsen 2010) whenever a mesh has no tangents, and
the tree trunk materials have carried `normalTexture` + `metallicRoughnessTexture`
(Poly Haven `pine_bark_nor_gl_1k`) since the round-5 texture work. Verified by
reading the GLB material blocks. Nothing to do.

---

## SH-020 — Real leaf-card trees ✅ *(shipped in round 5 — scanned-leaf cards through the cutout bucket)*

Replace 2 of 4 tree variants with alpha-cutout leaf-card versions
(the scanned-leaf card pipeline from the round-5 texture work already
exists in `build-props.ts`); per-primitive `alpha_cutoff` through the
cutout bucket.

---

## SH-023 — Adopt foliage shading model ❌ *won't-do (verified 2026-07-12)*

> The ticket said "verify then port". **The verification says don't port.**
>
> The engine's `shade_foliage` is explicitly a V1 and it is *less* capable than
> what `grass_instanced.wgsl` already does:
>
> - its transmission is `pow(V·−L, 4)` alone — it **drops the `dot(−N, L)` term**,
>   i.e. it does not actually check whether the sun is *behind the leaf*. Ours
>   gates on exactly that (`pow(back,2) · pow(view_align,1.5)`), which is the whole
>   reason the backlit grass reads right;
> - it excludes **ambient / IBL / specular** by its own documented V1 limitation, so
>   the material has to supply those anyway;
> - everything else in our shader — cascade shadow, cloud deck, root→tip gradient,
>   distance anti-grit — is untouched by it either way.
>
> So the port would make the grass look *worse* and delete about six lines. Revisit
> if the engine's foliage model reaches a V2 that carries ambient and a real
> transmission gate. The tree material that this ticket also named no longer exists
> (`tree.wgsl` was deleted with SH-007 — the forest is cached leaf-card models).

---

## SH-024 — Imposter LOD for distant trees ❌ *won't-do at this scale (2026-07-12)*

> Still gated on EN-015, and the ticket's own note is the reason to close it: it
> "only matters at > 500 trees". The arena has **88**, and the forest is not the
> frame-time problem — the perf audit put the cost in shadows and unculled
> non-scene-node draws, and the tree draws are cascade-culled now. Building an
> octahedral imposter pipeline to LOD out 88 trees would be effort spent where the
> measurement says there is nothing to win. Reopen if an arena ever gets a real
> forest.

---

## SH-007 — Drifting clouds ✅ *(shipped 2026-07-12 as EN-040)*

> **Shipped — and the ticket had it backwards.** The premise was "the sky has no
> clouds, but the ground already has cloud shadows." By the time we got here the
> engine HAD grown a procedural cloud layer, so the real defect was that the two
> had never been reconciled:
>
> - the sky's puffs were fBm on a plane pinned to the **camera**, so they slid
>   along with the player instead of hanging over the world;
> - the ground's shadow was a **different** noise field entirely, drifting ~80x
>   faster (20 m/s against the sky's 0.25);
> - and only the materials carrying a private copy of the ground function
>   darkened at all — grass and terrain each had one, and the **forest standing in
>   that grass had none**. A cloud shadow crossed the field and ignored the trees.
>
> Now there is one field (`common/clouds.wgsl`), in world space, shared by the sky
> that draws the clouds and the ground that takes their shadow. Look up at a
> cloud, and the shadow you are standing in is its shadow.
>
> Deck height and feature scale are **coupled** — sky puff size = `(deck − eye) ×
> scale` — so they are not free knobs. `setCloudShadows(0.45, 150, 0.008, 6)` is
> the pair that keeps the sky reading as it always has while making the shadows
> arena-scale. The dead `tree.wgsl` (superseded by the leaf-card cached path in
> round 5) was deleted rather than ported.

---

# Round 5 — Production tooling

Content velocity is the real AAA moat. Game-side ticket below;
editor-side items live in `../editor/PLAN.md` — listed here because
they gate SH-040/SH-042's content work.

**Editor items (from PLAN.md, priority order for content throughput):**

1. **Wire prefab authoring** (PLAN §E) — `prefab-tool.ts` is fully
   written (create/save/add-child) with **zero UI entry points**, and
   the shooter has zero prefabs. This is the single biggest reuse
   multiplier available; a tree cluster, a spawner+pickup camp, a
   building corner become one placeable asset.
2. **Terrain texture painting** (PLAN §D) — pairs with SH-009; the
   schema's `TerrainLayer` weights are authored nowhere today.
3. **Play-in-editor** (beyond the fly-cam): a "Launch game here"
   button — save to a temp world, shell out to the shooter binary
   with that path (SH-040 makes the path a parameter). Cheap and
   transforms iteration.
4. **Multi-select transforms** — selection is a Set but gizmos act on
   primary only.
5. **Asset thumbnails** (PLAN §G — `renderAllThumbnails` exists,
   uncalled) + inspector rename/tint/modelRef (PLAN §F2).
6. **`postSaveCommand` hook** (PLAN §K2) — auto-run
   `bun tools/build-terrain.ts` on save; kills the last bake step in
   the level loop.

---

## SH-044 — Asset ingest automation ✅ *(shipped — `tools/convert-*.ts`, cross-platform)*

**Why:** audio conversion is ad-hoc hand-run ffmpeg (unscripted,
`assets/sounds/SOURCES.md`), texture downscaling uses macOS-only
`sips`, and `gen-building.ts` output is copy-pasted into world files.
SH-042's content push multiplies all three frictions.

**Scope:** small.

- `tools/convert-audio.ts`: batch ffmpeg driven by a manifest
  (source path → output name/format/gain), covering everything in
  `SOURCES.md`; becomes the documented path for new SFX.
- Replace `sips` with the in-repo PNG codec (`tools/png.ts` already
  encodes/decodes) or ffmpeg scaling — converters become
  Windows-clean.
- `gen-building.ts` gains `--merge <world.json>` to insert/replace
  its entities programmatically instead of stdout copy-paste.
- One documented command (`npm run convert`) rebuilds every committed
  asset from `vendor/` + external sources on any OS.

**Acceptance:** fresh clone + vendor submodules + one command
reproduces `assets/` byte-comparable (or documented-diff) on Windows
and macOS; adding a new SFX is a manifest line, not a shell history.


---

## SH-045 — Graphics settings are the player's, not ours ✅ *(shipped 2026-07-12)*

The game hardcoded its own graphics config and shipped `SET_RENDER_SCALE` in
`settings.json` **without ever putting it in the menu**. Meanwhile, on a 4K display,
the single most consequential decision about how this game feels — a sharp image or a
locked frame rate — was being made by a constant in `main.ts`.

The settings screen now carries a graphics block, and it comes **first**:

| row | what it actually costs |
|---|---|
| **DISPLAY RESOLUTION** (engine EN-046) | the swapchain. The only knob that touches the fixed 4K tail (TSR upscale + final composite = 5.4 ms). **0.8 turns ~53 fps gameplay into a locked 60.** Costs overall sharpness, HUD included. |
| **RENDER RESOLUTION** | the G-buffer; TSR reconstructs back up to the display. Costs scene detail; the HUD and the final image stay sharp. |
| SHADOWS / AMBIENT OCCLUSION / REFLECTIONS / GLOBAL ILLUMINATION / BLOOM | ~0.1–0.6 ms each |

Two resolution sliders rather than one "quality" number, because they trade against
**different** things and a single number would have to lie about one of them. Both
apply live, both persist, and `applyGraphicsSettings()` runs at boot *after* the
hardcoded defaults, so the player's choice is the last word. (MOBILE keeps its own
profile: a phone has no settings screen and no headroom to give away.)

**Bug found and fixed on the way: a corrupt `settings.json` bricked the game.**
SH-037 promised "missing/corrupt file → defaults, never a crash". It did not deliver:
Perry's `JSON.parse` *aborts the process* on malformed input — there is no exception
to catch — so the guard has to happen before the parse. The realistic corruption is a
**BOM**: anything that writes the file with a Windows text editor (or PowerShell's
`Set-Content -Encoding utf8`) prepends U+FEFF, and the game dies on next launch with
`JSON parse error: expected value at line 1 column 1`. Which is exactly how this was
found. The loader now strips leading BOM/whitespace and requires a whole `{...}`
object before parsing.

**Also fixed:** the menu title was nailed to `sh * 0.5 - 200` while the list is
centred — so adding rows grew the list upward straight through it. The title is
anchored to the top of the list now.

---

## SH-046 — Character fidelity: PBR uplift + a better player model 🟡 *(uplift shipped 2026-07-13; the new player model needs you)*

**Why:** the characters were the weakest surface in frame. The terrain has
triplanar PBR *and* a detail normal; every alien and the player had a **base colour
texture and nothing else** — no normal map, no roughness map, flat `roughness 0.9,
metallic 0`. They read as matte toys standing on a real world.

### Part 1 — PBR uplift ✅ *(shipped)*

**The maps were on disk the whole time.** The Unvanquished source ships authored
`_n` (normal) and `_s` (specular) for **every** character; `tools/convert-aliens-anim.ts`
only ever read the diffuse. Now it reads all three.

- `_n` → glTF `normalTexture`. (No TANGENT attribute needed — the engine
  reconstructs a TBN from screen-space derivatives; SH-014 proved this.)
- `_s` → glTF `metallicRoughnessTexture`. **These are not the same thing.** A
  Quake-lineage spec map stores specular *intensity*; glTF wants *roughness* in
  green and *metalness* in blue. Mapping intensity straight to gloss — my first
  attempt — drove bright texels to roughness ~0 and the battlesuit came out
  **looking wet**. The mapping is now deliberately conservative: roughness spans
  1.0 → 0.35, never a mirror. The point is surface *variation*, which there was
  none of; it is not to make anything glossy.
- The **battlesuit alone** gets metalness from the spec map. It is armour plate,
  and a dielectric with a tight white highlight reads as wet plastic — metalness is
  what makes it read as metal, because the reflection gets tinted by the base
  colour instead of staying white. The aliens stay fully dielectric: metallic
  chitin would look like tinfoil.
- The `_adv` upgrade skins have no `_n`/`_s` of their own (they are recolours of
  the base on the same mesh and UVs), so they borrow the base skin's maps.

Cost: ~0.5 MB per model. All 8 models, every material, now carry both maps.

### Part 1b — texture resolution: we were downsampling the art by 4-8x ✅ *(2026-07-13)*

`TEX_MAX` in the converter was **512**. The Unvanquished source art is **2048²
(player)** and **4096² (aliens)**. Every character had been shipped at a fraction of
its authored detail, on models the camera is rarely more than a few metres from.

Now 1024 for the aliens and **2048 for the player** (it is on screen 100% of the
time and earns more). That is 4x the texels on the aliens and 16x on the player.

**Cost: none that matters.** 53 fps before, 53 fps after — this was never
fill-bound, it was texture-starved. Models grew 28 MB -> 65 MB on disk.

Between this and the normal/spec maps (Part 1), the characters now carry roughly
**64x the surface information** they did this morning, and not one byte of it was
downloaded — it was all sitting in `vendor/`.

### Part 2 — a better player character ❌ *won't-do (searched 2026-07-13, with an API key)*

Searched Sketchfab properly (authenticated, Download API), across `cc0` / `by` /
`by-sa`, filtered to **downloadable + animated**, over ten character queries.
**43 candidates. None is an upgrade.** The honest tally:

- The realistic-ish ones ship **3-5 animations** ("Infantryman" 48k verts / 3 anims;
  "Animated Astronaut" 31k / 4; "Stylized Sci-Fi Officer" 89k / 5).
- The ones with real animation counts are **low-poly stylized** ("Business Man" 25
  anims / 2.4k verts; "Futuristic soldier (Free)" 18 anims / 3.7k verts).
- The one high-poly, well-animated hit is a **Black Myth: Wukong rip** — someone
  else's IP, licence label notwithstanding. Not touching it.

**The battlesuit has 34 purpose-built clips** — idle, walk, run, four strafes, five
crouch states, jump, land, pain, die, attack, plus per-weapon pose deltas. Swapping
it for a 4-animation astronaut would trade a complete locomotion set for a prettier
T-pose. Retargeting a CC0 animation library (KayKit, Quaternius UAL2) onto a new
mesh is the only way round that, and it is a Blender-rigging project, not an
afternoon.

This is exactly what `docs/asset-sourcing.md` predicted: the free ecosystem is rich
in humanoid animation *libraries* and stylized low-poly monsters, and thin in
precisely what we already have. **Keep the bsuit.** The uplift above is the better
buy, and it is done.

The player is on screen 100% of the time and is the model most worth replacing.
Per `docs/asset-sourcing.md`, the plan is a realistic CC0/CC-BY humanoid from
**Sketchfab** (its Download API serves **glTF/GLB directly** — no conversion),
animated from **KayKit** (161 anims) or **Quaternius UAL2** (130+), both **CC0,
glTF, and redistributable in a GPL repo**.

**What I need from you** — I cannot get past either gate:
- **Sketchfab requires OAuth.** Give me an API token and I can search, filter by
  licence, and pull GLBs directly. Otherwise pick a model and drop the `.glb` in.
- **itch.io returns 403 to scripted downloads**, so KayKit needs a manual grab.

**Reconsider first, honestly:** with the uplift landed, the battlesuit now reads as
real armour. It may no longer be the weakest thing in frame. Look at it before
spending on a replacement.

---

## SH-047 — The body turns to face where it moves ✅ *(shipped 2026-07-15)*

**Why:** the player model always faced camera-forward, so strafing read as the
character sliding sideways while staring ahead — and the forward walk clip's feet
pointed the wrong way relative to the travel.

**What shipped.** The facing offset is `atan2(moveX, -moveZ)` — literally the
movement direction relative to the camera. The requested angles fall straight out
of it because WASD already quantises movement: A/D → 90°, the W-diagonals → 45°,
W or idle → forward. Eased along the shortest arc (so S+A → S+D turns the near
way), and kept as an offset RELATIVE to the camera so looking around does not drag
the body with it. Aiming down sights forces forward — you are pointing the gun,
not walking.

Because the body faces its travel, the forward walk/run/crouch clips are always
the correct clip: the directional strafe clips the model ships (`run_left`,
`crouch_right`, …) are not needed.

**Verified** with a forced strafe + the HUD readout: D moved the player to world
+X with the body in right-facing profile; W+D moved it on a true 45° diagonal.

---

## SH-048 — Crouch 🟡 *(shipped 2026-07-15 — speed + pose; capsule NOT resized)*

**Why:** the only speed states were walk and sprint. Crouch is the third — the
deliberate, quiet one.

**What shipped.** Hold **C** (Ctrl was already dodge). `CROUCH_MUL` 0.45 takes
4.5 → ~2.0 m/s, and the crouch clips play (`crouch` idle / `crouch_forward`
moving — one clip covers every heading thanks to SH-047). Crouch **wins over
sprint**: you cannot do both, and holding crouch is the more deliberate intent.

**Outstanding, stated plainly:** the physics capsule is **not** resized, so crouch
does not shrink the hitbox and does not let you fit under low geometry. Harmless
today — the arena has none — but it means crouch is not yet a *tactical* choice,
only a movement one. Needs `setCharacterShape`. No touch or gamepad binding yet.

**Verified** through the real C key (not a forced flag): 4.50 → **2.03 m/s**,
`crouch=1`, mutually exclusive with sprint.

---

## SH-049 — Front end: splash, loading screen, main menu ✅ *(shipped 2026-07-14)*

> **Numbering note.** This work was written as "SH-046" in the code and collided
> with the existing SH-046 (character fidelity) — two different tickets, one
> number. Renumbered to SH-049 on 2026-07-15; the code comments now match.

**Why:** boot was a **black, frozen window for ~8 seconds**, then a snap to a
"press any key" title. That freeze is the first thing a player ever experiences
and it read as a hang.

**What shipped** (`src/boot.ts`, `MENU_MAIN` in `menu.ts`):
- **Splash** — owns its own loop, so it is the one part of boot that animates
  smoothly. Skippable; a splash you cannot skip is one you resent by the third
  launch.
- **Loading screen with REAL progress.** There is no async loader (EN-032), so
  nothing pretends: `bootStage()` is called between groups of synchronous loads
  and draws a frame each time. Weights are **measured milliseconds**, not
  guesses — the bar would otherwise lurch, which reads as a broken loader.
- **Main menu** — PLAY / LEVEL SELECT / SETTINGS / QUIT over the live arena,
  reusing `menu.ts`'s existing focus model rather than being a second screen to
  keep working. Settings and level select were previously reachable only from
  *pause*, i.e. only after starting a run.
- The gameplay HUD is now gated on being in a run. It used to draw the health bar
  and ammo over the menu — the tell that the "title screen" was just the game
  with input switched off.

**What this measured, and it is the useful part:** boot is ~7.9 s of loading and
**`the aliens` is 5.5 s of it (61%)** — `initEnemyPool()` loads a ModelAnimation
per enemy SLOT, not per kind. That is the one number to attack if boot time is
ever worth fixing.

> **Corrected 2026-07-16, when it WAS attacked (EN-055):** the stage number was
> right, the attribution was wrong. Sub-timed: the per-slot ModelAnimation
> parses were **43 ms** — `load_gltf_animation` never decodes images. The 4.9 s
> was seven SERIAL `loadModel` calls doing PNG decode on the main thread. Fixed
> by decoding all character GLBs in parallel worker threads (`stageModels`,
> after engine PR #107 repaired the staged commit path) + EN-055 instances for
> the per-slot handles. Boot measured **8,702 → 4,372 ms**; `the aliens`
> 5,098 → 214 ms. The remaining boot is `the marine` (~1.8 s — it hosts the
> whole parallel batch, bounded by the 22 MB player GLB) and ~1.4 s of world/
> terrain/grass stages; overlapping the stage batch with those stages is the
> next lever if boot is ever worth attacking again.

**Also fixed here:** an unconditional `if (isKeyPressed(Key.ESCAPE)) break;` at
the bottom of the frame loop — a dev-quit binding that predated the pause menu.
It fired on every ESC regardless of state, so Escaping out of the settings screen
*killed the process*. ESC now means pause in a run and back in a menu; QUIT is a
menu row.

---

## SH-050 — The ground, the house and the grass stop being cartoons ✅ *(shipped 2026-07-15)*

**Why:** the report was "the grass is too cartoonish (big), the house has no real
textures, and the riverbank should be a natural brown, not too simple". All three
were true, and all three had the same root cause: **everything the player stands
on or next to was synthesised, while the trees next to it were photographed.**
Round 5 gave the forest real scanned bark and leaf cards; the ground, the
riverbank and the building never got that pass, so they sat in the same frame at
two different fidelities and lost.

### What shipped

**Terrain (closes ASSET-TODO T1).** The four splat layers are real CC0 Poly Haven
photoscans instead of two octaves of value noise:

| layer | scan | real size |
|---|---|---|
| 0 grass_lush | `forrest_ground_01` | 2.0 m |
| 1 grass_dry | `withered_grass` | 2.0 m |
| 2 dirt — **the riverbank** | `brown_mud_dry` | 1.3 m |
| 3 rock | `cliff_side` | 1.83 m |

SH-009 promised the swap would be a file drop and it genuinely was — the layer
ORDER was already the ABI. The procedural generators stay as the fallback for a
checkout without `assets/textures/external/`. **Normals are now MEASURED**, which
matters more than the 512→1024 bump: the old ones were Sobel'd from albedo
luminance, which assumes dark = deep — false for grass, so the relief fought the
light.

**Each layer tiles at its scan's real physical size.** The unused 4th component of
each layer tint now carries the source's extent in metres. One shared UV scale had
the 1.3 m mud stretched to 2.86 m — a pebble 54% too big is exactly what reads as
"toy".

**Building.** Was two octaves of noise over flat sandstone plus a mortar stripe —
i.e. *variation*, not *material*: nothing underneath the noise to resolve. Now two
photoscan slices picked by face direction (which the shader already computed for
its noise projection), with measured normals and **real roughness** (the MR array
slot is free here; terrain's holds the splat map):

- slice 0 WALL ← `concrete_wall_008` (board-formed concrete)
- slice 1 SLAB ← `concrete_floor_02` (floors + roof terrace)

Floors and walls used to be the same beige noise, so the roof terrace read as a
wall lying down.

**Grass.** Blades were 12.4 cm wide and 55 cm tall at ~7/m² — a leaf, not a blade,
and you could count them. Now 3.6 cm / 34 cm at ~21/m² (40k → 120k).

Round-9 widened the mesh (0.045→0.062) to stop distant blades aliasing into
speckle, and that fix was real — but it was paid for by *every blade at every
distance* to solve a problem that only exists past ~9 m, where the shader's
distance ramp already had it covered. So: narrow the mesh, and widen the ramp
(1.6→3.4, starting at 6 m) so the far field still gets its pixel. The anti-grit
constraint is intact; it is just no longer charged to the blades you are standing
in.

**Grass colour, re-tuned against a ground that is now a photograph.** Measured
mean albedo: ground `0.568 0.529 0.365` (saturation 0.36, red-dominant) vs blade
tip `0.286 0.467 0.137` (saturation **0.71**, green-dominant). Twice the
saturation of the soil it grows from, biased the opposite way. Against flat colour
stops that passed; against a photograph it is a neon spike in dirt — the most
cartoonish thing left in frame the moment the terrain got real. The old base also
broke the palette rule the terrain generator states in its own header ("green
stays close to red"): r 0.30 vs g 0.42. Now `0.44 0.45 0.38`.

### Bug found and fixed on the way

**SH-010's detail normal has been a flat no-op since it shipped.** `fbm` read
`vnoise(x * f / SIZE * SIZE, ...)`, which parses as `((x*f)/SIZE)*SIZE` — exactly
`x*f`. With integer pixel coords in, every sample landed on a lattice point and
the hash wraps at period `f`, where `(x*f) % f` is 0 for every x. Every texel of
every octave returned `hash(0,0)`. The output was a uniform `(127,127,255)` — the
precise encoding of "flat". A no-op normal map does not look broken, it looks like
nothing, which is why the "last order of magnitude of ground detail" pass has been
doing nothing for its whole life. Detail strength was retuned (0.35 → 0.22)
because the old value was tuned against a texture that did nothing.

### Measured, not assumed

- Grass 40k → 120k: **26.64 → 26.21 fps**. 0.4 fps for 3x the blades — the
  engine's grass-tile culling means what is on screen sets the price, not what is
  scattered. The old note's "past ~40k the scatter saturates" was never measured
  and is wrong: it places 120000/120000 (there is a boot log for it now).
- Textures 512 → 1024, same binary, only the PNGs swapped: **26.69 → 26.50 fps**.
  ~37 MB more VRAM, no measurable frame time.
- Whole change end to end, title screen: **27 → 26 fps.**

### Traps recorded (see `assets/textures/external/SOURCES.md`)

1. **Poly Haven names lie about colour.** `brown_mud` and `brown_mud_02` are
   *grey*. The brief said "natural brown"; picking by name ships the opposite.
2. **Judge a texture at the tiling it will really get, not at 2x2.** The walls
   first shipped `plaster_stone_wall_01` — fine at 2x2, and a stamped GRID of
   identical stones across a 24 x 8 m facade (10 x 4 tiles), worse than the flat
   colour it replaced. Sparse distinctive features cannot survive repetition.
   Board-formed concrete can: its seams and tie-holes are *supposed* to repeat at
   ~2 m.
3. `macro` is a **reserved word in WGSL** — the module fails to parse. (Recorded
   in round 4, re-learned here.)

**Not changed: the trees.** They already have real scanned textures from round 5
(Poly Haven `pine_bark` + ambientCG `LeafSet004`). Nothing to do.

**New tools:** `bun tools/fetch-external-textures.ts` (idempotent; `--force` to
re-download) and `bun tools/build-building-textures.ts`.

---

## SH-051 — Enemies can't kill you through a ceiling ✅ *(death bug 2026-07-15; CLIMBING SHIPPED 2026-07-16 — `src/flow.ts`)*

> **The climbing half landed: a flow field over the building's floors.**
> `flow.ts` builds a 0.5 m grid per floor level (levels + links derived from
> nav.ts's stair flights), BFS-floods it from the player's cell, and travelling
> enemies follow the field — which turns corners by construction. Wall circles
> stand down for field-followers (they fenced the mount and fought the field);
> the grid's Y-aware wall test is their collision instead. STAIRTEST, the same
> A/B that proved the original bug: enemies now cross the ground floor, mount,
> climb, and melee the player upstairs — `above=2-3, maxEnemyY=3.90,
> nearest3D=0.6, hpMin=76` (was 0 / 0.20 / ~9 m / 100 forever). Ground combat
> verified unchanged via AITEST. Four probe-led fixes are documented in the
> module: stair mass is height-aware in the graph; walls near mounts test at
> pad 0 (the real mount is a 0.5 m gap no padded cell fits); onFlight's height
> tolerance must not hijack walkers standing BESIDE the wedge at ground level;
> separation is skipped while climbing. Upstairs is now contested space.

**Reported:** "enemies can attack me from a lower floor, they dont go up stairs.
so I die without them being even physically near me."

Both halves were true, and they had **three independent root causes** — none of
which was pathfinding, which is what made this worth digging into rather than
guessing.

### 1. Melee measured distance in 2D ✅ FIXED

`director.ts` computed `const dist = Math.sqrt(dx*dx + dz*dz)` — **XZ only**, and
`pp.y` was never read anywhere in the AI. That is the right number for steering
(you walk around a building in plan) and it was ALSO being used as the melee
range, where it is catastrophically wrong: an enemy on the ground floor directly
beneath a player on the first floor has `dist ~= 0`, so it clawed them through
3.7 m of concrete.

Melee now also requires vertical proximity, feet-to-feet (`playerPosition()`
returns the capsule CENTRE — the soles are 0.95 below it, so mixing the two
silently hands out a metre of free reach).

**Measured, via the STAIRTEST harness — the A/B is the point, because a probe
that cannot fail proves nothing:**

| | result |
|---|---|
| vertical gate ON | `hpMin=100` — never hit |
| vertical gate OFF | **`hpMin=76`** — 24 damage, from enemies 3.7 m below |

### 2. Enemies were pinned to the terrain ✅ FIXED

`enY[i] = terrainHeightAt(nx, nz)`. The heightfield has no idea the house exists,
so an enemy could not stand on a floor **at all** — the building was, to the AI,
a flat patch of ground with walls scribbled on it. New `src/nav.ts` adds
`surfaceHeightAt(x, z, curY)`: terrain plus any building box whose top is within
`STEP_UP` (0.5 m) of where the walker already is. That gate is the whole trick —
it makes a 0.31 m tread climbable and a 3.7 m slab solid ceiling, with no physics
query.

### 3. The staircase was classified as a wall ✅ FIXED

The obstacle builder in `main.ts` rings ground-level wall boxes with repulsion
circles. Its filter is `yLo <= 0.7 && yHi >= 1.2 && thin <= 0.6` — and a stair
step is a thin box rising from the floor past knee height, which is *exactly* a
wall. **9 of the 12 steps in each flight matched**, so the staircase was fenced
off with 0.7 m repulsion circles and nothing could ever use it. (The old comment
claimed the filter deliberately kept "stair-adjacent pieces". It was keeping the
stairs themselves.)

Climbability is not a property of one box — a step is climbable only because of
the step below it — so it cannot be detected locally. It is now **authored**: the
24 step entities carry a `stair` tag (second tag, so `building` still drives the
paint category), surfaced as `MESH_IS_STAIR`. `nav.ts` derives the flights from
it by adjacency flood-fill, and the boot log prints what it found:

```
[nav] flight 0: floor y=0.20 -> y=3.90  tread A (-10.1,-8.2) -> B (-13.4,-8.2)
[nav] flight 1: floor y=3.90 -> y=7.60  tread A (-10.1,-18.2) -> B (-13.4,-18.2)
```

They chain (0 delivers to 3.90, which is 1's boarding level), so the roof is
reachable with no path graph. That log earned its keep immediately: the first cut
grouped steps by "shares an axis" and merged both staircases into one 10 m
diagonal flight, because this house stacks its flights at the SAME x values.

### What does NOT work: they still don't climb 🟡

Enemies now route from under the player to the stair **foot** — ~10 m of correct
navigation, verified — and then hover at `x ~ -10.9` without mounting. The cause
is geometric, and it is not a nudge away:

- The house's steps start **0.5 m from the east wall**, which is solid at ground
  level along its whole length (the openings there are window sills, 1.4 m tall).
- A wall repels to `thin + 0.55 + bodyR` ≈ **1.3 m** for the big kinds.
- So the only climbable tread (the lowest, 0.51 m) sits *inside* the wall's
  repulsion field. Approaching from the side instead means meeting the wedge at
  step 2+ (1.12 m up), which is correctly unclimbable from the ground.

Two things were tried and **reverted** rather than left in:

- **Tightening the wall circles** (`thin + 0.15` at 0.4 m spacing — which seals a
  wall just as well; the 0.55 is padding for ~1 m circle spacing, not a body
  allowance, since `bodyR` is added separately). It did not fix mounting, and
  re-tuning every enemy-vs-wall interaction in the game is not a free change to
  make on the way past. The note stays in `main.ts` for whoever picks this up.
- **Greedy tangential avoidance** around the stair wedge. It rounds a convex
  obstacle in principle, but at the stair's south face both perpendiculars score
  within noise of each other and it dithers.

**The honest read: this needs real pathfinding** (a nav grid + flow field over
the walkable surface, per floor), not another local rule. Every local rule tried
here failed for the same reason — the route in is a corner, and greedy seeks do
not turn corners. The groundwork it would need is now in place (`nav.ts` knows
the walkable boxes, the floors and the flights).

**Consequence to be aware of:** upstairs is now *safe* rather than lethal. That is
strictly better than the reported bug — an unfair death is worse than a dull one —
but it is a camping spot until the pathfinding lands.

### Also worth knowing

- Enemy **projectiles were never part of this bug**: SH-042 already raycasts them
  against the world (`Layer.NON_MOVING`), so ranged kinds cannot shoot through a
  floor. Only melee could.
- `tools/gen-building.ts` is **stale** — it emits `h_slab_f0`-style ids and a
  3 m/10-step stairwell at (-15,-10). The shipped house v2 (`h_slab_a`,
  `h_stair_a_*`, floors at 0.20/3.90/7.60) did not come from it. Do not "fix" the
  world by re-running that tool.

## SH-052 — The living soundscape: river, wind loops, creature locomotion ✅ *(shipped 2026-07-16)*

**Why:** "we want 3D sounds for the wind, the river, the animals/spiders
crawling closer." The engine could only fire-and-forget (`playSound3D`), so
the wind was a retrigger timer, the river was silent, and every enemy but the
tyrant approached without a sound.

Built on EN-062 (live spatial voices — looping, moveable, per-voice
volume/pitch/low-pass, real distance model, equal-power pan, air absorption,
rear head-shadow cue, doppler; also FIXED mirrored stereo and the ~9%-sharp
44.1k-on-48k playback):

- **River** (`initRiverAmbience`/`updateRiverAmbience`): one looping emitter
  per water volume, positioned every frame at the closest point of the
  volume's rectangle to the player — a line source faked with a point source
  that always stays abreast of you. Rectangles come from the world file:
  move the river in the editor and its sound moves. refDist ≈ channel
  half-width (the bank IS full volume).
- **Wind**: the three forest-centroid sources are true loops now (retrigger
  timer deleted), detuned 0.94/1.0/1.07 so the treeline decorrelates. Volume
  still rides the live wind amplitude; distance/pan/absorption are engine-side.
- **Creature locomotion**, two layers:
  - *Steps*: every kind runs the tyrant's stride accumulator now
    (`KIND_STRIDE` per kind, tyrant's 2.2 unchanged); non-tyrants fire
    positional chitin skitters (light bank = dretch/mantis, heavy =
    marauder/dragoon/advs), gated on actually moving.
  - *Crawl bed*: a pool of 4 looping voices assigned to the nearest MOVING
    enemies within 28 m (O(n²) top-k, allocation-free, slot-stable so voices
    never teleport between owners). Pitch per kind (small = fast ticking).
    The thing you haven't seen is audible closing in BETWEEN its steps.
    Self-gating: no qualifying enemies → all slots silent, menus included.
- **Assets**: `river_loop`, `skitter_light1-4`, `skitter_heavy1-4`,
  `crawl_loop` — synthesised stand-ins in `gen-sfx.ts` (appended AFTER the
  existing emits: one global seeded noise stream, insertion order is the
  diff-stability contract). Old files byte-identical. ASSET-TODO A7-A9.

Verified with an AITEST probe build (numeric counters, not ears): 351
skitter steps over 50 s of live combat, crawl slots assigning/releasing as
enemies moved and parked (a dretch standing at 1.5 m goes silent — the
moving gate at work), wind voices 5/6/7, river voice 8, zero errors, no
command-ring pressure. Probe reverted; shipped-config build boots clean.

## SH-052b — The river is a real creek now (and it has width) ✅ *(shipped 2026-07-16, follow-up to SH-052)*

**Why:** "the water sounds fake." It did — the SH-052 stand-in built its babble
from falling sine chirps, and synthetic water is the one ambience the ear
always catches. Water needed a recording, not a better formula.

- `river_loop.wav` is now a **32 s seamless cut of a real babbling brook**
  (Bolt "Immersive Creek — Ambisonic Recordings of Undisturbed Creeks in
  Vermont", Sonniss GDC 2024 bundle — the same accepted license line as
  `splash1.wav`; source extracted to gitignored `vendor/sonniss/`).
- The cut is **scripted and reproducible**: `convert-audio.ts` grew
  `startAt` + `loopFade` (equal-power tail-over-head cross-fade, chunk-aware
  WAV patching — ffmpeg slips a LIST chunk before `data`). The 33.5 s window
  at 49 s was picked by scanning every candidate window for minimum RMS +
  brightness variance (level-constant, no birds, no handling) — score 0.144.
  Loop verified numerically: seam first-difference 0.034 vs body max 0.31 —
  the wrap is quieter than the material's own deltas. No clipping.
- **Width**: one point emitter reads as a speaker in a field. Each water
  volume now runs a detuned trio — main at the closest bank point plus two
  flankers ±8 m up/downstream along the channel axis (0.96/1.05, clamped to
  the rectangle). Turn your head on the bank and the water has extent.
- `gen-sfx.ts` no longer emits a river. Removing it shifted the shared
  seeded-noise stream, so skitter*/crawl_loop regenerated (equivalent
  variants, committed together) — the "re-run reproduces the repo" contract
  holds. A river emit must never be re-added there: it would clobber the
  recording.

## SH-052c — "I still hear white noise": the wind bed, run to ground ✅ *(shipped 2026-07-17)*

**Diagnosis.** Two compounding causes, one a SH-052 regression:
1. `ambient_wind.wav` was a fixed 700-6500 Hz bandpass × a volume LFO —
   filtered white noise that only got louder and quieter. A static spectrum
   is exactly what the ear files under "white noise", however it is dressed.
2. SH-052 deleted the authored "gone by 40 m" window in favour of the
   engine's physical rolloff — right call for a recording, wrong for a synth
   bed: the inverse model's long tail spread a faint hiss carpet over the
   WHOLE arena, including the open field that used to be silent.

**Fix, both halves:**
- The generator moves the SPECTRUM with the gust now: two decorrelated
  registers (350-1800 bough murmur, 1800-8500 leaf sizzle) whose balance
  rides a slow gust envelope (brightness ∝ gust^1.8), plus leaf-flutter
  grains (9-17 Hz AM bursts) planted only where the gust is strong, plus a
  seeded slow wander so passes never repeat. 24 s loop (was 16). Verified
  numerically, not by ear: brightness-vs-level r = 0.95 across the loop
  (v1 ≈ 0 by construction); seam delta 0.23 vs body max 0.53; no clipping.
- `updateWindAmbience` re-applies the authored window on top of the engine
  rolloff: full inside ~27 m of a source, silent past 45 m. The engine keeps
  pan/absorption/close-range; the game shapes the far field.

Sonniss part 1of9 has no usable wind-in-trees recording (checked), so the
stand-in stays a stand-in — but an honest one. ASSET-TODO A3 updated with
the drop-in requirements for a real recording (must keep a seamless loop —
cut it with convert-audio's loopFade). Skitter/crawl regenerated again
(shared seed stream; same determinism contract as SH-052b).

## SH-052d — Wind left out; a real way to test the 3D audio ✅ *(shipped 2026-07-17)*

Two decisions, one commit.

**Wind is out.** Two rebuilds could not make a spectral-only, always-on synth
bed stop reading as white noise (and the user heard it both times — that is
the only ground truth that matters for audio). The system stays live and
dormant: `sfxWind = NO_SOUND` in `initAudioMix`, so every wind path
early-returns as it does for a missing file. One line brings it back when a
real canopy recording lands (ASSET-TODO A3). River, footsteps, creatures,
reverb zones are untouched.

**`--audiotest orbit|flyby|river`** — a deterministic way to HEAR the
spatialisation, because judging it during a firefight is not judging it:
- `orbit` — a looping voice (the river loop; broadband, so it reveals BOTH
  pan and the rear low-pass) circles the listener at 6 m, one lap ~8 s. You
  should hear it sweep L → behind (darker) → R → front, continuously, and
  the pan tracks the camera when you turn.
- `flyby` — the voice flies 35 m ahead → through you → 35 m behind at
  ~14 m/s on a loop: doppler up on approach, down past you, plus the
  front/back timbre flip.
- `river` — free-walk with the river as the ONLY source and a
  distance-to-nearest-bank readout on the HUD, to correlate what you hear
  with where the bank is.
Waves are suppressed in every mode; orbit/flyby silence the river so the
probe is the single source; `river` skips the probe. Top-centre HUD line
shows the mode + live geometry. Dormant unless the flag is passed (same
contract as the other harnesses); verified live — probe voice id 8, orbit
angle advancing, all three modes + the normal no-flag path boot clean.

---

## SH-054 — The shooter runs in the browser (WASM + WebGPU) ✅ *(shipped 2026-07-18, PR #38)*

Registered after the fact: the work landed without an entry here. `tools/build-web.sh`
produces `dist/web`; the frame body runs through `runGame(gameFrame)` (blocking loop on
native, rAF on web). Notes: `CLAUDE.md`, "Web (browser, WASM + WebGPU)". Engine side: EN-063.

## SH-055 — AAA plan, Phase 0: bugs and hygiene ✅ *(shipped 2026-11-14)*

The first phase of `docs/aaa-plan.md`, which came out of the 2026-11-14 audit. (The November
overhaul itself — original cast, regenerated sounds, release tooling, MIT — was committed the
same day as `3d814a0` and has no ticket of its own.)

| Plan item | What changed | Checked how |
|---|---|---|
| 0.1 HUD clipping | Desktop and web lay the HUD out against a 1080-unit-tall space (`src/main.ts`), and the ammo line is measured and right-anchored (`src/hud.ts`) | COMBATSHOT capture at 3456x2168: the whole line is on screen. The scaled path (uiScale != 1) is the mobile one; not seen on a 4K-at-100% desktop here |
| 0.2 Cannon unreachable | First arena unlocks the chaingun, any later one the cannon; the banner names the weapon | read, compiled; not played to a victory |
| 0.3 Arena select | Relaunches into the chosen arena behind a LOADING cover, via the new engine `restartApp()` | temporary build: picked arena_03 from arena_02, the process came back up with arena_03's world. **iOS / tvOS / Android cannot relaunch an app and still ask the player to reopen it** — a true in-process reload stays open |
| 0.4 Foot-slide | Clip speeds measured in Blender (walk 1.7, run 3.25, crouch-walk 0.5 m/s); normal movement now uses the run clip at 1.4x instead of the walk clip clamped at 1.8x of a needed 2.8x | measured + compiled; **crouch still slides** (the clip is 4x too slow for the 2.0 m/s crouch) until the Trooper gets a faster one |
| 0.5 Weapon sounds | `chain_fire`, `cannon_fire`, `explosion` generated; one sound per weapon, the rifle alternates two | boots with the files loaded; **nobody has listened to the new sounds yet** |
| 0.6 Ranged line of sight | A ray against the static world gates the wind-up | read, compiled; not observed in play |
| 0.7 Explosion death path | Self-damage only while a run is live, and reported like any other hit | read, compiled |
| 0.8 Footstep surfaces | water / concrete (house footprint) / dirt (river bank, painted dirt-mud-rock layers) / grass; `step_concrete1-4` generated | read, compiled; not listened to |
| 0.9 Touch + pad | Touch gains AIM, DASH, DUCK and pause; the pad crouches on right-stick click | compiled; **not tried on a device or with a pad** |
| 0.10 Colossus slam | 0.6 s rooted wind-up, lands on whoever is still in reach | temporary build: wind-up 0.62 s, hit for 35, stepping 6 m away during the wind-up made it miss |
| 0.11 Android script | Refuses to run with uncommitted asset changes | `bash -n`; the guard itself not exercised |
| 0.12 Bundle exclusions | One list, `tools/release/assets_bundle.py`, used by TestFlight, web and Android | pruning tested on a throwaway tree; no full web/Android/TestFlight build was made |
| 0.13 GPL leftovers | Unvanquished models, their converters and three old music files deleted from the tree | game boots and plays without them |
| 0.14 Docs | README rewritten, July documents bannered as historical, enemy names migrated in the world files (old names still accepted) | boots with the migrated arenas |
| 0.15 Leftovers | Dead constants, stale comments, the retired colour-blind key | compiled |

Engine: `restartApp()` / `bloom_restart_app` on all nine platform crates.

## SH-056 — AAA plan, Phase 1: the player on screen ✅ *(landed 2026-11-14; jump and weapon-swap clips open)*

What could be done without new animation clips. Judged from the new PLAYERSHOT harness
(`src/main.ts`): the Trooper from the side, front and behind in 13 states.

| Plan item | What changed | Checked how |
|---|---|---|
| 1.3 Aim offset | The three spine joints lean with the camera pitch (engine EN-064 `animSetJointRotation`) | PLAYERSHOT: rifle rises looking up, drops looking down |
| 1.3 Weapon in hand | The weapon is drawn with its pistol grip on the weapon socket (it used to hang from the end of the stock); the off hand is pulled onto the handguard by two-bone IK (`animSetIK`), released for reload and dodge | PLAYERSHOT close-ups from three sides, rifle only |
| 1.3 Hands | `studio_import.py --grip` closes the fingers in every clip (the Text2Motion clips leave them flat); Trooper rebuilt with it | same close-ups |
| 1.1 stand-in | Only the run clip carries the rifle properly; idle, walk and both crouch clips are hunched with the gun arm stretched out. Everything but the run now takes torso and arms from the run clip on the masked layer | PLAYERSHOT before/after |
| 1.4 Shoulder camera | The orbit pivots beside the head (0.95 m from the hip, 0.62 m aiming), V / RB / a touch button swaps sides, a wall beside the player shortens the offset; shots converge on what the crosshair is over | COMBATSHOT frames; swap and wall case **not played** |
| 1.5 Dodge | 0.25 s of invulnerability: a claw spends its cooldown on air, bolts pass through | read, compiled; **not played** |
| 1.6 Crouch | Capsule 1.84 m to 1.20 m with the feet fixed, standing up refused under a roof, camera drops 0.45 m, crouch speed 2.0 to 1.2 m/s (what the clip can cover with planted feet) | PLAYERSHOT crouch frames; roof case not exercised (no low geometry in either arena) |
| Phase 0 leftover | The melee damage arc pointed away from the attacker (`director.ts`); fixed | read against the projectile path |

Second pass, same day, after Ralph chose Tripo Text2Motion for the clips ("spend as much as you
need to"): 16 clips generated on the Trooper rig (380 credits; prompts and outcome in
`art/source/trooper_clips.md`), 13 of them in the model.

| Plan item | What changed | Checked how |
|---|---|---|
| 1.1 Clip set | idle, walk, walk_back, strafe_left / right, sprint, crouch_idle / walk, roll, hit_front / back, death_back / front, plus the old run | every clip rendered from the side in Blender before wiring; PLAYERSHOT |
| 1.2 Strafe blend | Aiming or firing squares the body to the camera; walk or walk_back is the base clip and the two sidesteps are mixed in by input (`animSetBlend`, phase-locked). Travel directions of the four clips measured in Blender | PLAYERSHOT: strafe right from behind, strafe left from the front, advancing, backing up |
| 1.2 Speeds | Aiming / firing moves at half speed (2.25 m/s: the walk set covers about 1 m/s); crouch back up to 1.8 m/s on the new 0.9 m/s crouch-walk | measured clip speeds; **the feel is not played** |
| 1.5 Roll | The dodge is a 0.7 s shoulder roll (10.5 to 2.5 m/s, about 4.5 m, 0.45 s invulnerable), body turned into the roll, weapon following the hand | PLAYERSHOT early and late in the roll |
| 1.3 Reload | The off hand travels handguard, magazine well, belt, magazine well, handguard by IK, timed to each weapon's reload | PLAYERSHOT mid-reload, rifle only |
| Hit reaction | A hit plays the front or back flinch on the upper-body layer for 0.75 s | PLAYERSHOT |
| Death | Falls backward when hit from the front, forward when hit from behind; the weapon stays in the hand | PLAYERSHOT falling and down |

Still open: a jump clip (the generated one barely leaves the ground, so a jump still plays the
gait), a weapon-swap animation, turn-in-place, and nothing here has been played by a person:
every check above is a still frame.

Engine: EN-064 (`animSetBlend`, `animSetJointRotation`, `animSetIK`, `animSetIKPole`, `animTime`).

---

## SH-057 — AAA plan, Phase 2: combat that can be read and mastered ✅ *(landed 2026-11-14; not played, tuning open)*

Checked with two new harnesses in `src/main.ts`. **P2TEST** scripts one situation per feature
and prints numbers (`P2 ...` lines) and pictures. **P2BOT** lets a stand-in play a whole run:
it stands at the spawn, turns to the nearest creature it could see and holds the trigger.
Neither is a person playing.

| Plan item | What changed | Checked how |
|---|---|---|
| 2.1 Perception | A creature has to see the player (range per kind 26-40 m, a 150 degree cone while unaware, a clear line: one ray per creature every 0.2 s), hear them (crouch silent, walk 5 m, run 9 m, sprint 16 m, a shot 30-50 m, a blast 60 m; a wall takes 40%) or be touched or shot. Alerted, it rouses others within 12 m and pauses 0.3-0.5 s before acting. Five seconds without perceiving and it goes back to hunting the last place it knew. Spawned creatures hunt a guess within ten metres of the player and re-guess every 9-13 s, so a wave cannot stall. HUD: UNSEEN / HUNTED n under the wave line | P2TEST: a Ravager walking away at 12 m stayed unaware of a silent player (`aware=0`), one rifle shot alerted it (`aware=1`). P2BOT: waves cleared |
| 2.2 Telegraphed melee | Every melee attack is wind-up (0.34-0.80 s by kind, rooted, turning with the player for the first two thirds then committed), active frames (0.14-0.24 s: a disc in front of the body is the hit shape, one hit per strike), recovery (0.45-1.2 s). The Bruiser's charge is its active window. The attack clip is restarted per strike and played so its blow (measured per rig) lands as the active frames open. Tell: attack voice, a flare and light at the head that build through the wind-up, a swing sound as it goes | P2TEST: wind-up 0.52 s, 16 damage on the active frames and not before, second strike rolled away from with health unchanged |
| 2.3 Locational damage | `src/hitshapes.ts`: head sphere, torso capsule, two capsules per arm and leg and a weak-point sphere, riding each creature's live skeleton. Hitscan and bolts test those and the static world separately; the physics boxes are body-sized and only block the player. Limb x0.7, body x1, head x2 (x2.5 rifle, x1.5 chaingun), weak point x2.5 and triple toward a stagger: Bruiser and Colossus belly from the front, Bombard launcher tubes. Shots into a Bruiser's or Colossus's back glance (x0.5, sparks, ricochet). HP and weapon damage x10. Larger tick marker and a crack for a critical hit | P2TEST: rays at head / chest / foot / beside / weak point / from behind reported 2 / 1 / 0 / miss / 3 / 4 as expected for all seven kinds (after fixing the Colossus, whose head sits inside its chest capsule); rifle steered onto a Ravager's head did 25 a round and killed in 3 |
| 2.4 Hit reactions | Decision: authored deaths, not ragdoll. From the front it is thrown onto its back; from behind or by a headshot it crumples (the "fall" clip entered one second in); a blast or a blow of 45+ throws a light creature along the hit, on an arc, to slide to a stop. Every hit jolts the spine along the shot for a quarter second (`animSetJointRotation`); heavies stagger off the existing meter | compiled and run in both harnesses; **the look of the jolt and of the thrown bodies was not reviewed frame by frame** |
| 2.5 Group behaviour | Attack tokens: two creatures mid-attack at once (three in the last wave); Bruiser, Colossus and a darting Stalker do not queue. Token-less light kinds, and any on cooldown, circle 1.6 m outside their reach. Ranged kinds that lose their shot for a second close in and circle, reversing every two seconds. The flow field reaches 10 m past the house (was 2 m) and routes on the same floor whenever a wall is on the straight line | P2TEST: eight Skitters round the player, never more than 2 mid-attack. STAIRTEST: creatures still climb to a player on the first floor |
| 2.6 Swarms | `tools/gen/strip_joints.py` removes finger, toe-end and head-top joints from the seven creature GLBs (66 to 23 joints; weights go to the nearest kept parent; clips, order and durations unchanged). Pool is per kind: 8 Skitters, 5 Stalkers, 5 Ravagers, 3 Bruisers, 2 Colossi, 4 Spitters, 3 Bombards = 30 bodies, 757 of 1024 joint matrices. 12 alive at once. Waves grew (arena_02 22 to 35 creatures, arena_03 25 to 39), the last one opening with eight Skitters | P2TEST: eight Skitters on screen at 40 fps (4K, M1 Max); P2BOT: see below |
| 2.7 Player kit | Health regenerates to 40 after 5 s unhurt; kills drop a field dressing (+30) with a chance by kind, doubled when the player is under 40. Rifle-butt strike (F / LB / HIT): 45 damage in a 2.2 m arc, knocks back and stuns. Grenade (G / Back / NADE): 2 carried of 4, 2 s fuse, bounces, 160 at the centre of 6 m; every ammo crate gives one. Vault: jump while moving into something 0.35-1.25 m high | P2TEST: strike killed 2 of 8 Skitters, grenade 3 of 6, vault carried the Trooper over the house crate. Found on the way: every prop's collider sat half its height into the floor; lifted |
| 2.8 Weapon identity | Recoil follows a ten-step pattern per weapon and the view comes back between bursts by whatever the player did not pull back themselves. Hitscan falloff (rifle full to 30 m, 60% at 55 m; chaingun full to 14 m, 40% at 38 m). Rifle: first aimed round has no spread, best headshots. Blaster: bolts pass through one body. Chaingun: cone tightens from 5.5 to 1.6 degrees as it fires, walking is 40% slower spun up. Weapon switch takes 0.35 s and the new one comes up from the ground. Pickups are an ammo crate with the weapon turning above it | pickups in a P2TEST frame; **recoil, falloff and the quirks were compiled and read, not felt** |
| 2.9 Gamepad aim | Rotational assist (the view follows half of a near-crosshair target's angular motion while moving or steering), bullet magnetism (1.2 degrees from the hip, 2.1 aiming), both pad-only and behind a new PAD AIM ASSIST switch with the old slowdown; AIMING SENSITIVITY slider (default 0.7x) for every device | compiled; **no pad was connected** |

P2BOT, both arenas (M1 Max, 3456x2168): Outdoor Plaza cleared in 105 s, 35 kills, 12 alive at
most, never more than 2 mid-attack, 18 hits taken by a stand-in that never moves; Riverbend Ravine
in 100 s, 39 kills, 8 hits. Frame rate 35-50 with 10-12 creatures alive. The first bot runs found
three faults that the scripted checks had not: creatures leaning on a wall the "wall in the way"
test had stepped over, a Ravager parked in the house's south door, and shots at a creature
clawing at the player missing because the aim ray began 1.6 m past the Trooper. All fixed.
COMBATSHOT, PLAYERSHOT and STAIRTEST still run; COMBATSHOT's blind fire between two creatures
now hits 3 of 33 where the old boxes caught most of it, which is the hit shapes working.

Sounds: six new effects from `tools/gen/sfx.py` (swing, crit_hit, melee_hit, grenade_throw,
grenade_bounce, heal).


---

## SH-058 — AAA plan, Phase 3: world art and lighting ✅ *(landed 2026-11-14; judged from stills, not walked)*

Checked with the SCENESHOT harness (fixed views, now one table per arena, indoors and upstairs
included) and with P2BOT on all three arenas. Stills only: nothing here was judged in motion.

| Plan item | What changed | Checked how |
|---|---|---|
| 3.1 Ground | Twelve Tripo models through `process_static.py` (boulder, outcrop, river stone, fallen log, stump, concrete barrier, sandbag wall, shelf, locker, generator, work light, burnt-out truck). `tools/gen/dress_arena.py` places them as world entities with yaw and box colliders measured from the model, and paints `terrain.layers`: forest floor under trees and logs, a mud trail from the spawn round the pickups, worn patches, scree round rocks. `src/flora.ts` scatters five kinds of plant card at load (ferns under trees, reeds where the ground meets the water, flowers in the open, weeds against anything standing, shrubs toward the edge) through one instanced material. Props turn with their yaw, collide as turned boxes, and creatures steer round them. | Captures of all three arenas. Per arena: about 40 placed props, 40-64 river stones, 270-430 ferns, 150 shrubs, 230 reeds, 700 flowers, 520 weeds. The 10 m rule was not measured. |
| 3.2 Horizon | 2,400 tree cards on the hills outside the arena (an orthographic render of the game's own tree, `tools/blender/tree_impostor.py`), in copses that thin with distance, starting 50 m out. The skirt's ground is shaded as wooded hillside. Haze is per arena. | Captures toward each edge. |
| 3.3 River | The swell is lower and dies at the banks, so the surface no longer saws through them. Banks are shaped per side (shoreline 1.9-4.3 m from the centre line) and the drawn water overhangs the volume, so the shoreline is where ground meets surface. Lit foam drifts wherever the water is shallow, including round stones standing in it. Wet mud, a pebble line, stones and reeds along the shore. One shader now serves a river along X and one along Z, and the terrain's mud band follows the river of the arena it is in (it was arena 1's position in every arena). | Captures along and across both rivers and the creek. |
| 3.4 House | Brick takes soot, re-pointed and lime-bloomed areas at scales the 3 m scan cannot line up with. Ceilings are plaster (they were the floor scan smeared at a grazing angle). Shelves, lockers and work lights indoors. The house and the ground are lit by the world's point lights, with indoor faces taking a third of the sky light. A second building type: a single-storey concrete guard post (`wall_slice=1`), dressed by `house_trim.py`, which now handles any number of storeys and any wall thickness. | Captures inside both floors of the house and round the guard post. A debug pass confirmed the lamps reach the shader; their gain was then raised. |
| 3.5 Light and grade | Each world has a `look` entity (`tools/gen/set_look.py`): sky variant, tonemap, saturation, exposure key, fog, shafts, cloud shadow, vignette. `tools/gen/grade_sky.py` grades the panorama into afternoon, mist and dusk. Arena 1 is late afternoon, arena 2 a grey misty morning, arena 3 dusk. AgX tonemap everywhere. Settings rows for menu background blur, motion blur and dynamic resolution. | Side by side captures of ACES and AgX, and of the three arenas. Depth of field while aiming was captured, found to blur the whole frame, and removed. Motion blur and dynamic resolution were not looked at. |
| 3.6 Characters | A soft contact disc under every creature and under the Trooper; a darker tint for seven seconds after wading; creatures darken toward red-brown as they lose health. | The combat capture. No emissive work. |
| 3.7 Third arena | `arena_04` "Checkpoint" (`tools/gen/gen_arena_04.py`): a valley road at dusk, a creek with a ford, the guard post and its yard, the truck, a barrier chicane, five work lights. 42 creatures in three waves. | P2BOT: cleared in 145 s, 42 kills, 12 alive at most, 28 hits taken. |

P2BOT on the final build (M1 Max, 3456x2168): Outdoor Plaza 101 s, 35 kills, 16 hits; Riverbend
Ravine 119 s, 39 kills, 23 hits; Checkpoint 145 s, 42 kills, 28 hits. 37-43 fps in the scene
captures, as before the phase (38). STAIRTEST: six creatures still reach the first floor.

The bot found three faults again. The new arena's spawn was under the ground and the player fell
for ever (spawns are now placed on the terrain). A Skitter and then a Bruiser stood pressed
against the truck for a whole run: a long prop is a row of obstacle circles, which is a wall, and
a walker heading straight into a wall had nothing to slide on. Walkers now go round on their own
side when a circle eats most of a step, and the circles sit close enough that the row has no
notches to catch in.

Found on the way: the bit-mixing hash `environment.ts` uses for its moisture noise returned
nearly constant values when compiled by Perry (multiplying past 2^53 and wrapping with `| 0`);
`flora.ts` uses a Park-Miller hash that stays exact. The grass's moisture patches use the old
one and are probably flatter than intended: not fixed here.

Tripo: 660 credits (twelve generations at 55), twelve exports downloaded. Concept images and the
five plant photographs came from the Codex image tool.

---

## SH-059 — AAA plan, Phase 4: UI and front end ✅ *(landed 2026-11-14; judged from captures and a scripted key test, not used by a person)*

Checked with two harnesses in `src/main.ts`. UISHOT opens every screen through `menu.ts`'s own
entry points and captures it (19 pictures: title, six settings tabs, arena select, credits, the
title and a settings tab in German, the arena select in French, the HUD plain / hit at low health
with subtitles / with pad glyphs in the red-green-safe palette / with the wave card and unlock
banner, pause, both results screens). MENUTEST drives the real key path with injected keys and
logs 14 checks, all passing on the final build: title, settings, tab switch, a capture starting,
a key binding, a swap when the key was already taken, back to the title, PLAY, the rebound keys
working in the run, the results screen opening by itself after a death, its first row restarting
the run, pause, and MAIN MENU returning to the title.

| Plan item | What changed | Checked how |
|---|---|---|
| 4.1 HUD | Redrawn with the UI kit. Centre: crosshair with a dark under-stroke, three hit markers told apart by shape (ticks; ticks in a ring for a critical; ticks flying outward with a skull for a kill), reload / charge / spool meters, a reload prompt on an empty magazine. Edges: a damage vignette, a wedge pointing at the source of each hit, chevrons for creatures striking or closing from outside the view. Top: a compass strip with a pip per creature, wave pips, the count left with a bar, an eye with UNSEEN / HUNTED BY n. Top left: score, the points of the last kill rising off it, the combo with its drain bar. Bottom left: health in ten segments with the regeneration notch and a chunk that lingers where health was just lost, the dodge cooldown. Bottom right: weapon silhouette (rendered from the game's own models), magazine as pips, reserve, the four weapon slots with locks, grenades, glyph prompts. Banners for a wave starting, a wave cleared and a weapon unlocked animate in. | UISHOT captures 12-15. The kill marker, the threat chevrons and the banners' motion were not captured. |
| 4.2 Menus | Title with an emblem, the arena's picture and best score; pause; a results screen (verdict, up to three stars on a win, eight numbers, kills per kind, PLAY AGAIN / NEXT ARENA / ARENAS / MAIN MENU) that opens 2.3 s after a death and 3.4 s after a win; arena select as picture cards; credits. Rows slide in on every screen change. Eight interface sounds (six new, synthesised by `tools/gen/ui_sfx.py`): move, select, back, tab, slider tick, toggle, error, start. MAIN MENU leaves a run for the title. | UISHOT 00, 07, 08, 16-18; MENUTEST. Sounds were not listened to. |
| 4.3 Settings | Six tabs built from one row table (`addRow` in `menu.ts`): GAME, CONTROLS, BINDINGS, VIDEO, AUDIO, ACCESSIBILITY. New: difficulty, language, HUD size, compass, stick dead zone and response curve, vibration, quality presets (low / medium / high / ultra / custom), window mode, vsync, frame-rate limit, per-action rebinding for keyboard / mouse and pad (`src/binds.ts`: a key already in use is swapped, Delete clears, Esc cancels, reset to defaults; pause and the menu keys are fixed). Phones and the browser read the video settings now: their fixed profile became the file's defaults there, and a settings file from before is not trusted for video on those platforms (`meta.v`). | UISHOT 01-06; MENUTEST for the bindings. A saved "windowed" boots into a window (one run). Presets, vsync and the frame-rate limit were not exercised; the limit row says so while vertical sync is on, because the engine only applies its limit when the display is not pacing the frames. |
| 4.4 Accessibility | Subtitles for eight sound events, three sizes, optional dark plate. Four palettes (standard, red-green safe, blue-yellow safe, high contrast) that re-colour every HUD and menu element, because colours are chosen by meaning (`UI.col(UI.C_DANGER, ..)`). Hold / toggle for aim, sprint and now crouch. Aim assist is a strength from 0 to 100% (it was a switch) and scales the slowdown, the rotation and the magnetism together. | UISHOT 06, 13, 14. |
| 4.5 Localization | `tools/gen/strings_table.py` holds 190 strings in English, German, French and Spanish and writes `src/strings.ts`; nothing the player reads in the HUD or menus is a literal any more. First run starts in the system language when it is one of the four. | UISHOT 09-11 (umlauts and accents render). Translations are mine and were not reviewed by native speakers. |
| 4.6 Glyphs | Keys are keycaps with the key's name, mouse buttons a mouse with the button filled, pad buttons discs / bumpers / triggers / sticks / a D-pad with the arm marked. Every hint is drawn from the binding table, so a rebound key changes its hint everywhere. | UISHOT 03, 12, 14. |

Found on the way. **Esc never paused the game on desktop:** the key press that opened the pause
menu was still "pressed" when the menu updated a few lines later in the same frame, and closed it
again (the same code was there before this phase). A screen now ignores input on the frame it
opens. Esc inside settings opened from pause used to drop straight into the fight; the open menu
owns Esc now. The engine's `drawTexturePro` origin is an absolute pivot, not raylib's offset into
the rectangle (`UI.sprRot` wraps it). Screenshots are skipped while the game window is covered
("surface acquire occluded" in the log): a harness run with missing pictures means that.

Gameplay regression: P2BOT cleared arena_02 on the final build in 101 s with 35 kills (the same
as before the phase), reading its input through the new binding table.

Cost: nothing bought. The atlas is drawn by a script, the weapon silhouettes are Blender renders
of the game's models, the six sounds are synthesised, the arena pictures are crops of Phase 3
captures.

---

## SH-060 — AAA plan, Phase 6 slices A-C: encounters, progression, objectives and onboarding ✅ *(landed 2026-11-14; run by a stand-in, not played; slice D open)*

Ralph's decisions: escalating survival with a meta layer (not a campaign), credits earned in runs
as the currency, slices A to C now and slice D (boss, two weapons, two arenas, which costs Tripo
credits) later. Phase 5 was skipped to get here.

Checked with three harnesses. UISHOT (27 captures a run; run in all three arenas, because the
objective waves differ): the 14 menu screens including ARMOURY and SERVICE RECORD, a locked arena
card, the results screen with credits, the tutorial card, an elite, each objective wave from
outside and inside. MENUTEST: 22 checks through the real key path, all passing; the eight new
ones answer a tutorial step with the dodge key, see the next step follow, skip the rest with
Backspace, open the armoury from the title, step to the next weapon, leave by BACK, open the
service record and leave by Escape. P2BOT, a stand-in that holds the trigger and is PUT at each
objective (it does not walk), cleared all ten waves of each arena on the final code:

| Arena | Time | Kills | Objective waves |
|---|---|---|---|
| arena_02 Outdoor Plaza | 379 s | 142 | hold: 40 s banked, the wave took 52 s |
| arena_03 Riverbend Ravine | 537 s | 174 | nests: three destroyed, the wave took 134 s |
| arena_04 Checkpoint | 698 s | 236 | hold, then nests: the nest wave took 173 s and 74 kills |

Health is held full for the stand-in, so these say the waves flow and end, not that they can be
survived. It took 55 hits in arena_02 and 396 to 782 in the later arenas.

| Slice | What changed | Checked how |
|---|---|---|
| A. Spawn choreography | `tools/gen/gen_waves.py` writes each arena's ten waves as GROUPS (`size:pattern:gap`). `startGroup` in `src/director.ts` picks a group's spawn point(s) the moment it starts, from the player's position and the camera's direction: front, ambush (behind), flank (alternating the two points furthest to either side), far, near (not closer than 14 m), surround, and `round`, the old behaviour, which is what a wave without `groups` still gets. No group arrives within 9 m of the player. A group waits out its gap unless two or fewer creatures are left. The tool adds four spawn points per arena (eight in all), chosen for distance from the others and tested against water, slope, trees, props and walls. | The bot run: every wave started, spawned and ended. Which point each group used was not logged or watched. |
| A. Elites | `!` after a name in the wave list. One flag per slot (`enElite`): 2.4x health, 1.3x damage (blows and bolts), 16% larger (model and hit shapes), flushed red with its own point light, three times the flinch lockout, triple score, a field dressing every time, a larger accent pip on the compass and an `ELITES: n` line. One or two per wave from wave 6, more in the later arenas. | One capture (a creature flagged and stood in front of the camera in the harness). The bot killed the waves that contain them. |
| A. Ten waves | 127 / 141 / 149 creatures listed per arena (objective waves repeat their list). Attack tokens rise at waves 4 and 8. The break between waves is 3.5 s (was 2.5). | Bot. |
| B. Profile | `src/profile.ts`, `profile.json` (`"v": 1`), loaded after the settings. Credits; `upgrades.w<weapon>t<track>`; `stars.a<arena>`; lifetime runs, wins, deaths, kills (and per kind), elites, objectives, shots, hits, critical hits, best combo, seconds, credits earned; a bit mask of hints shown; the tutorial flag. Vetted before parsing like settings.json. A first profile gives one star to every arena that already has a best score. Banked once per run in `director.bankRun`; never under a harness (`DIR.bank`). | A hand-written profile was loaded for the captures (balance, upgrade levels, stars, the record screen's numbers all showed as written; the rifle's magazine read 35 in the HUD with one magazine level). No run was banked by a real player: `commitRun` and the file it writes were not exercised end to end. |
| B. Upgrades | Per weapon: damage +10% x3, magazine +5 / +3 / +20 / +1 rounds x3, reload -10% x3 (400 / 900 / 1600 credits), and one perk at 2500: rifle MARKSMAN (head and weak-point hits +35%), blaster OVERCHARGE (bolts 25% faster, through one more body), chaingun STABILISER (spins up in half the time, no slower walk), cannon SHAPED CHARGE (blast 30% wider, half the damage to yourself). Weapon numbers are read through `WPN.damageOf / magSize / pierceOf / projSpeedOf / aoeOf / critMul`. | The magazine upgrade was seen in the HUD. Damage, reload and the four perks were not measured. Buying was not exercised: the key test stops short of it so that it cannot spend a real profile's credits. |
| B. Screens | ARMOURY (weapon strip with silhouettes, what the weapon does now, four rows with level pips and price, red when unaffordable, locked weapons greyed) and SERVICE RECORD (twelve numbers, kills per kind, stars and best per arena, BACK and a two-press RESET PROGRESS) from the title; ARMOURY also from the results screen, which shows what the run earned and the balance. Arena cards show stars and, when locked, a padlock and the stars needed (0 / 1 / 3); NEXT ARENA only appears when it is open. | Captures; the key test for navigation. RESET PROGRESS was not pressed. |
| C. Hold | `objective` entity `role=hold` at the arena's generator (moved up to 5 m so most of the ring is open ground). 6.5 m ring of twelve stakes with lamps that turn green clockwise as seconds are banked; seconds outside drain at 0.35 a second; 40 / 45 / 50 seconds by arena. The wave's list repeats until it is done, then what is left has to be killed. HUD: what to do, a percentage and bar, a marker with distance on the compass. +400 points. | Captures from outside and inside (the count rose, the light turned). The bot, put in the ring, banked 40 of 40 and the wave ended. |
| C. Nests | Three `role=nest` sites. Each grows a nest (`prop_nest.glb`, procedural, `tools/blender/build_nest.py`) with 420 health that pushes up out of the ground and breeds the wave's list; bullets, bolts and blasts hurt it (`objective.rayNests`, `blastNests`); at most nine creatures alive. +150 a nest, +400 for the last. | One capture in arena_03 (the nest stands in the world; it reads as a dark mound). The bot destroyed all three in arena_03 and arena_04. The first runs stalled or crawled: see below. |
| C. Tutorial | `src/tutor.ts`. Five prompts before wave 1 of the first arena for a profile that has not seen it: move, aim and fire, reload, dodge, grenade or strike. Each is answered by doing it; the countdown waits; a step moves on by itself after 14 s; Backspace (or the pad's view button) skips. | One capture; the key test for answer, advance and skip. Not the whole sequence by hand. |
| C. Hints | Six one-time lines (low health, first elite, first hold, first nests, a new weapon, an empty reserve), each a bit in the profile. GAME > TUTORIAL AND HINTS switches both off. | Not seen on screen in a run: the harness forces one to capture the panel. |

Found on the way.

- **A creature could stay wedged for a whole wave.** The first ten-wave bot run stalled on wave 6:
  a Ravager from one of the new spawn points was following the house's flow field, which does
  not know about trees, through the centre line of a trunk, and the slide that takes creatures
  round trunks had nothing tangential to keep. Older than this phase; the corner spawns and a
  player who never left the south bank hid it. A creature that wants to move and has not covered
  35 cm in a second and a half now steps a right angle to its course for a second, the other way
  each time (`director.ts`, "nothing stays stuck").
- **`src/main.ts` stopped compiling** part-way through (`unknown type { double, i64 }`). It is a
  Perry code-generation fault that the size of the module tips over, not anything in the line
  being added; three theories about a trigger were wrong. Every build now sets
  `PERRY_LLVM_INPROCESS=0`. `docs/perry-quirks.md` #6.
- **The last creature of a wave could wander for ever.** In the Checkpoint arena the bot's first
  run never finished wave 10: one Skitter that did not know where the player was walked against
  the building for fifteen minutes. The stuck-breaker now doubles its sidestep each time it
  fails in a row (1.6 s each way, then 3.2, up to 6.4), and when nothing more is coming, three or
  fewer are left and none has been aware for twenty seconds, they are told where the player is.
- **A shot aimed at a nest could pass beside it.** The crosshair converged on creatures and the
  world, not on nests, so from over the shoulder the muzzle's line went to the ground behind.
  The bot hit a nest with 8% of its shots in the first run. Nests are in the aim ray now.
- **One bot run in arena_03 ended without a result**: its log stops at 600 s in the nest wave
  with the window covered and no error. Not reproduced; the rerun finished.
- **The additive glow card cannot mark a place in daylight.** Its shader ignores the tint's
  colour and is faint against a sunlit scene; the first two versions of the hold ring were
  invisible.
- **A harness run could write the player's save.** Bot and test runs no longer bank a best
  score, credits or stars.

Cost: nothing bought. The nest is built by a script; no new sounds (a nest uses the flesh-impact
and explosion sounds).

---

## SH-061 — AAA plan, Phase 6 slice D: two arenas, two weapons, a boss ✅ *(landed 2026-11-14 with the three Tripo models; not played, hit shapes and hand positions estimated)*

What is in, all of it without spending:

| Part | What changed | Checked how |
|---|---|---|
| Arena 5, Quarry | `tools/gen/gen_arena_open.py arena_05`: a pit with three benches and two ramps, a drainage stream to the east, trees on the rim only. Painted as cut rock and packed dirt by `dress_arena.py` (the grass thins on both, which is what makes it a pit). Overcast noon. Nests on wave 4, a hold on wave 7. | SCENESHOT (8 views). P2BOT cleared ten waves: 480 s, 206 kills. |
| Arena 6, Brood Hollow | A sunk clearing forty metres across with a broken rim, forest outside, a creek. Night: a new graded sky (`grade_sky.py night`, `sky_variant=4`), a weak cold moon, six work lights. A hold on wave 4, nests on wave 7, the boss on wave 10. | SCENESHOT. P2BOT cleared ten waves before the boss existed: 686 s, 175 kills. The night grade was darkened after those pictures and not looked at again. |
| Scattergun | Weapon 5: ten pellets in a 5.5 degree cone (tighter aimed), 11 damage each, almost nothing past 20 m, six in the magazine. Perk CHOKE: a 35% tighter cone. Unlocked by clearing arena 3. | The bot fought two waves with it (`--weapon 5`): it kills, slowly at its range. Model and hand positions are the blaster's. |
| Lance | Weapon 6: one round of 150 that passes through up to four bodies, no falloff, a 1.25 s cycle, five in the magazine. Perk CAPACITOR: cycles a third faster. Unlocked by clearing arena 4. | `--weapon 6`: 16 kills in 55 s. Model and hand positions are the rifle's. Piercing through several bodies was not observed, only that it fires and kills. |
| Six weapons | `binds.ts` (two actions added at the end, keys 5 and 6, no pad button), the HUD's slots, the armoury's strip, the profile's upgrade table, the unlock rule (one weapon per arena cleared, in order). Silhouettes for the two are keyed from the concept images. | UISHOT (armoury, HUD), MENUTEST 22 of 22. |
| The Matriarch | Kind 7, one body, 2400 health (`K_BOSS` in `enemies.ts`, `bossSpecial` in `director.ts`). Walks and strikes like a faster Colossus. Phase 1: a fan of five slow bolts, twice. Phase 2 (two thirds health): seven bolts three times, and she calls up three skitters. Phase 3 (one third): a third faster, an elite stalker among the summons, and a slam when the player is within nine metres that a roll goes through. Each special has a rooted wind-up; a phase change staggers her for 1.6 s. A health bar with the two thresholds marked. | The bot, started at the boss wave (`--wave 10`), killed her twice (59 s and 63 s, with its health held full and every round aimed at the neck); the log shows all three phases, a volley, and the summons arriving. Nobody has SEEN her: the one picture taken has her out of frame. The slam was not observed. |

Found on the way.

- **Three glass panes hung in the air in every arena but the first.** They were drawn at the
  first arena's house coordinates whatever was loaded. Now only there.
- **A seven-entry table indexed by kind crashes the game the moment an eighth kind is alive**
  (`TypeError: Expected number for native f64 parameter`, from the creature-loop pitch table in
  `audio-mix.ts`). Every per-kind table outside `enemies.ts` has been widened; a new one must
  be too.

**The models (later the same day, Ralph's approval).** Tripo Studio, 250 credits: three
generations, the Matriarch's retopology to 60,000 triangles, her rig and three Text2Motion clips
(run, attack, death); workspace ids, prompts and the per-step costs are in `art/source/README.md`.
`tools/gen/build_cast.sh enemy_matriarch` builds her (4.5 m, nine clips, 23 joints, normal map
baked from the 1.9M-triangle original); `process_static.py` the two weapons (20,000 triangles
each). The stand-ins are gone. Her weak point is the cluster of brood sacs on her upper back: a
sphere behind the neck that the torso shields from the front. Checked: model and clip sheets in
Blender; one bot run of the boss wave with the lance (won in 50 s; pictures show her standing
over the Trooper with both arms raised, the lance in the Trooper's hands, the health bar and
the PHASE 3 flash). **Estimated, not measured:** her hit-shape radii and offsets (read off the
model's proportions) and the two weapons' hand, grip and magazine positions (read off the model
sheets); PLAYERSHOT was not run for them. Her death clip falls backward although the prompt
said forward, and is kept.

Open: a look at the boss fight by a person; her hit shapes and the two weapons' hand positions
tuned against pictures; sounds for all of it (Phase 5).

---

## SH-062 — AAA plan, Phase 7: performance and production ◐ *(2026-11-14; measured on one Mac, 60 fps not reached; crash capture, platforms and store forms open)*

Phase 5 (audio and VFX depth) is still skipped. This is what could be done for Phase 7 from
one macOS machine without touching the engine.

**Harnesses from the command line.** Every `const X = false` harness flag in `src/main.ts` is
now `HARNESS === 'x'`, set by `./main --harness <name>` (lower-case flag name: `selftest`,
`aitest`, `menutest`, `uishot`, `sceneshot`, `playershot`, `p2test`, `p2bot`, `combatshot`,
`fpsprobe`, `perftest`, `perfstages`, and the older probes). No source edit, no second binary.
Any harness switches off banking and the tutorial (`HARNESS !== ''`).

**`tools/check.sh`.** Static checks, build, boot (SELFTEST leaves by itself), AI (AITEST:
at least 10 samples, 2 kinds, 3 distinct states), menus (MENUTEST: every `x=N (want M)` line).
`--bot` adds a whole stand-in run, `--perf` the frame rates, `--static` stops after the first
step, `--no-build` uses the binary that is there. It copies `settings.json`, `profile.json`
and `level.txt` aside and restores them on exit. Reads logs only, so a covered window does
not fail it. Ran clean: static, build, boot in 19 s, AI 42 samples, menus 22 of 22.

**`tools/check_static.py`** (also `.github/workflows/check.yml`, every push and pull request):
five worlds parse, 1,512 entities have a model reference and drawn ones exist, one primary
spawn each, 50 waves name known creatures, patterns and types and add up, objective waves have
their sites, 145 literal asset paths exist, `src/strings.ts` matches its table, 23 `KIND_*`
tables have eight entries, the player's files and `.env` are untracked, nothing is over 95 MB.
Checked against a clean export of the repository as well as the working folder; the first
run on GitHub passed in 33 s.

**Performance.** See the plan for the table. New default: dynamic resolution on for a fresh
desktop install (`SET_AUTO_RES` 1; off and hidden on phones and web). An existing
`settings.json` keeps what it has. Measured with the settings file moved aside: a fight went
from a mean of 36 fps to 45. New measurement aids: `--dbg-off grass|grasshalf|planar|flora|trees`,
`--autores 1` with `--harness fpsprobe`; the probe now runs uncapped and prints the pixel size.
Fixed: `perfstages` panicked the engine on Metal (Mailbox present mode).

**Bundle audit.** `tools/release/bundle_audit.py`: 463 MB plain, 1,601 MB with ASTC models.

**Legal.** `assets/TERMS.md`; `tools/release/PrivacyInfo.xcprivacy` (no tracking, nothing
collected, file-timestamp reason C617.1, boot-time reason 35F9.1, chosen from the symbols the
macOS binary imports), copied into the iOS, tvOS and macOS bundles by `release.py`.

**Not done / not verified.**
- 60 fps. About 18 ms of GPU time per frame does not respond to any game setting.
- No release build was made, so the privacy manifest's place in the bundle is untested, and
  the reasons were chosen from the macOS binary, not the iOS one.
- The dynamic-resolution default was judged by frame rate only; nobody looked at the picture
  it gives at the low end of its range.
- `--bot` and the web checks are not part of the default check.
- 7.3 entirely; 7.4 beyond the audit; age rating and store text.

---

## SH-063 — AAA plan, Phase 5: audio and VFX depth ✅ *(landed 2026-11-15 except new music; judged from captures and file measurements, not heard)*

**Bug found on the way: every particle in the game was invisible.** `particle.wgsl` rebuilt a
screen UV from the clip position and un-projected the scene depth through `inv_proj`; the
result came out in front of every particle, so the soft-fade factor was 0 everywhere. Decals
(another shader) were unaffected, which is why bullet holes and splats showed and nothing
else did. Found because the new explosion lit the ground and left a scorch mark with no
fireball between them. Now: depth by fragment pixel, linearised with `proj[2][2]` and
`proj[3][2]`, as `water.wgsl` does. Confirmed in captures, day and night.

**New module `src/sfx.ts`**: weapon reports and mechanisms, casings, dry fire, swap, staged
reload, impact materials (`surfaceAt`, `impact`), creature idle / alert / spawn / boss / spit
/ acid, occlusion (`vox`), three ambience loops, flash lights. Every file optional, every
caller falls back to the old sound when one is missing. `src/audio-mix.ts`: wind re-enabled,
six tails, the intensity ladder (`updateMusicIntensity` takes aware count, peak, boss),
`bossBlend`. `src/vfx.ts`: ten new pools, `emitImpactMat`, `emitSpawn`, `emitTrail`,
`emitAcid`, `emitShockRing`, alpha-blended pools (a negative intensity), `setDaylight`.

**Sounds.** 87 files from ElevenLabs (`tools/gen/sfx.py`, fifth pass), about 136 seconds,
about 1,500 credits (the account showed 13,190 used before and 14,707 after, of 40,000).
Three came back empty or under 0.1 s and were regenerated with louder prompts.

**Harness.** `./main --harness vfxshot`: explosion at three moments, one impact per material,
spawn / slam ring / acid, then `surfaceAt` at known places and the material handles.
arena_02: ground 0, tree 1, water 4, house 2, stump 1 as wanted; arena_06: barrel 3.

**Checked.** `tools/check.sh` passes (static, build, boot, AI, 22 menu checks). Stand-in:
arena_02 ten waves won in 401 s (379 before), boss wave with the lance won in 64 s (50 to 63
before), no runtime error in either log. Fight frame rate 36.0 fps (36.3 before).

**Not done / not verified.**
- Nothing was heard. See the plan's Phase 5 "carried forward".
- No music was made.
- The stand-in with the cannon never hurt the boss in 150 s. Not investigated: the stand-in
  most likely cannot use a charge weapon (it holds the trigger). The cannon was not otherwise
  changed here, but nobody has confirmed it still fires for a person.
- Dry fire, swap, staged reload, casings, the idle and alert calls and occlusion were never
  observed happening: the code paths ran without error in the stand-in runs, and that is all.
- The ambience mix indoors, and the boss bed slot, have no test.


## SH-064 — Lamps that cast shadows on the house and the ground ✅ *(2026-11-15, branch feat/local-light-shadows; needs engine EN-068; judged from stills, not played)*

The work lights and the house's lamps (the world file's `lights`) lit walls, floors and the
terrain with no shadow: nothing in front of a lamp threw one, and a lamp lit the next room
through the wall. Both came from the same place: the house and the terrain are drawn by the
game's own shaders, which loop over the engine's point lights and had nothing to sample.

**What changed.** The world's lamps are submitted with `addPointLightWithShadow` (engine
EN-068) and `building.wgsl` and `terrain.wgsl` multiply each light by
`local_light_shadow(i, position, normal)` from the new include `common/local_shadows.wgsl`.
The engine keeps a shadow cube (six depth maps, 512 texels a side) for up to four lamps,
those nearest the camera and in view. Everything that casts a sun shadow casts a lamp shadow:
the house itself, props, trees, the Trooper, creatures, pickups. Muzzle flashes, explosion
flashes, the hold ring and the creature lights stay unshadowed (they come and go in a frame,
and a shadow cube takes three frames to build).

**When it is on.** Desktop, with the sun's shadows on, on the high and ultra presets and on
custom (`menu.ts` `applyLampShadows`); off on low and medium. Phones and the browser never:
the engine refuses there and the shaders compile against a stub that returns "lit".
`--lamp-shadows 0` / `1` forces it for one launch.

**Cost** (M1 Max, native output, interleaved off/on runs in arena_04; two runs of the same
build differ by about 0.4 ms): title screen at render scale 0.5, 17.29 ms off and 17.54 ms on;
a `perftest` fight, 27.56 / 28.31 and 23.09 / 23.42 ms; the same fight with the camera turning
(`--spin 1`, new), 22.17 / 22.16, 21.42 / 21.61 and 21.63 / 21.57 ms. About 0.3 ms in a
fight. More where the Trooper stands in the reach of several lamps: the SCENESHOT tour of
arena_04 (the new lamp views, a jump every 50 frames) averaged 20.78 ms a frame off and
21.27 ms on, the tour of arena_06 20.10 and 20.15.

**What it looks like** (SCENESHOT, three new views in arena_04 and two in arena_06; the first
of each puts one stalker in the lamp's light). The guard house's east room: the Trooper's,
the crate's and the creature's shadows on wall and floor. Its west room: dark except through
the doorway, where the lamp used to light it through the partition. Outdoors: the tripod's
shadow and, behind every work light, the shadow of its own heads (the light sits half a
metre in front of them). No acne and no detached shadows in any capture looked at.

**Side effects to know about.**
- The house in arena_02 is darker indoors, on the ceilings most of all: they were lit through
  the floor by the lamps of the storey below. The interior lamps have not been re-balanced.
- Outdoors the effect is small. The grass is not lit by lamps at all (its shader has no lamp
  loop), so a lamp's pool, and any shadow in it, shows only on the bare ground between tufts.
- Creatures, props and the Trooper are drawn by the engine's own shader, which does not sample
  these shadows: they are still lit by a lamp through a wall.

**Harness changes.** SCENESHOT prints `SCENEFPS view=N fps=...` before each capture.
`--spin 1` turns the camera during `perftest`.

## SH-065 — Lamp shadows on creatures, the Trooper and props ✅ *(2026-11-15, branch feat/scene-lamp-shadows; needs engine EN-069; judged from stills, not played)*

SH-064 left one thing: everything the engine's own shader draws (creatures, the Trooper,
weapons, props) was still lit by a lamp through a wall and took no lamp shadow. Engine EN-069
closes it inside the engine; the game needs no code for it. Whenever lamp shadows are on (the
same presets and `--lamp-shadows 0|1` as SH-064) the models take them too.

**What it looks like** (SCENESHOT, arena_04). New view 10: the guard house's west room, looking
away from the partition wall the east room's lamp stands behind, with the Trooper and one
stalker. Before, the Trooper's back, the stalker, the table, the shelf and the crate were
lit warm from behind through the wall in a dark room; after, they sit in the room's own light.
View 8 (east room, in the lamp's light): the crate is now in the Trooper's shadow, the stalker
is lit on the lamp's side, no acne on either. View 11 (outdoors): the generator and the plants
behind the work light's own heads are a little darker.

**Cost.** Not measurable: `perftest` in arena_04, three interleaved rounds, 22.9 ms off,
22.8 ms on, 22.6 ms on with the models left out (numbers in engine EN-069).

**Harness.** SCENESHOT's arena_04 table has the new view at index 10; the outdoor lamp view is
now 11 and the view toward the sun 12 (still the last). `BLOOM_LOCAL_LIGHT_SHADOWS=material`
in the environment gives the SH-064 picture on the same build.

**Not looked at.** arena_02's house interior and arena_06 with this change; a fight indoors;
anything in motion.

## SH-066 — Follow-ups to the engine items: settings rows, harness hygiene ◐ *(2026-11-15; rows seen in captures, the display row tried once from the command line)*

- **Three video rows** (desktop): LAMP SHADOWS and LIT FOG (toggles, part of the quality
  presets: low switches both off, medium the lamps only) and DISPLAY (one option per attached
  display, hidden while there is one). `settings.json` keys `litFog`, `lampShadows`, `monitor`
  (-1 = not chosen). A file from before the rows keeps lamp shadows where it had them (high,
  ultra, custom). The fog row acts at once: `main.ts` watches the setting and calls
  `applyFogMedium`, which sets the flat haze, the lit fog and the shaft strength together.
  `--vfog flip` exercises that switch (on, off at frame 15, on at frame 100) and
  `--monitor 0..3` opens one launch on a display.
- **A saved display needs the engine's pull request #230**: without it the move at boot races
  the fullscreen animation and the window ends up nowhere (every frame skipped as occluded).
- **Command-line overrides are for one launch** (`SET.override`): `--render-scale`,
  `--output-scale`, `--pt`, `--monitor`. A save during that launch (menutest, an arena change)
  used to write them into the player's file.
- **`--harness fpsprobe` exits** after its one line. `tools/.testout/` exists in a fresh clone
  (perftest and menutest write there and nothing created it).
- **Pickups are drawn near the camera only** (`PICKUP_WEAPON_FAR2`, `PICKUP_CRATE_FAR2` in
  `combat.ts`: the weapon inside 45 m, the crate inside 80 m, the glow card always). A pickup
  is a 24,000-triangle crate under a turning 30,000 to 40,000-triangle weapon, redrawn into
  every shadow map each frame. Not timed: the saving is below what two runs can tell apart.
- **Plaza house lamps** raised a little after lamp shadows (`light_house_g1` 2.4 to 2.6,
  `g2` 2.2 to 2.4, `f1` 2.0 to 2.8 and warmer). With shadows the ground floor measured 5%
  darker and the first floor 14% darker and greyer, because the ground-floor lamps used to light
  the first floor's ceiling through the slab. The raise moved the captures by about 2%: the
  exposure adapts, so what is left is the tone of the first floor, and that is the correct one.
- **Creature pools NOT raised**, on two measurements. `--harness crowdshot` (84 extra
  creatures in view) runs at 8 to 10 fps against 57 without them, so a creature in view costs
  about a millisecond, and four more alive at once would take a fight from 57 to about 45 fps.
  And `--harness crowdshot --crowd 42` crashes the engine with global illumination on its
  hardware-ray path: the buffer of traced vertices passes 128 MB and
  `renderer/pt_dynamic_skin.rs` binds it whole (`pt_skin_bg`, "exceeds
  max_*_buffer_binding_size"). The pool of 31 stays under it. Both have to be dealt with in
  the engine before `KIND_POOL` / `MAX_CONCURRENT` go up.

## SH-067 — Photoreal environment pass: real trees, real grass, re-balanced light ◐ *(2026-11-15; judged from stills in all five arenas, not in motion; frame rate not re-measured cleanly)*

Ralph: "the trees and colors all look a bit cartoonish". What was wrong, found one capture at a
time, and what changed. Needs engine EN-071 (pull request #234).

- **Crowns were pale mint whatever their texture.** The engine gave leaf cards the full sky
  reflection. `setCutoutEnvSpecular(0.2)`.
- **The trees were balls of 470 big cards.** Replaced by three converted Poly Haven trees
  (`tools/blender/tree_from_scan.py`, `tools/gen/build_trees.sh`): real boles and branching,
  about 1,250 cards of photographed leaf sprays each, 8,000 to 8,700 triangles (the old ones
  had 11,000 to 13,000). Trunk colliders and the camera's canopy sizes follow the new models.
- **Cards seen edge on were streaks.** `setCutoutEdgeFade(0.14, 0.30)`, and three card
  orientations so something always faces the camera.
- **Grass was five times brighter than leaves and lit evenly root to tip**; the ground under it
  was near white. Blade base colour 0.37 / 0.49 / 0.25 to 0.098 / 0.128 / 0.038, roots get 30%
  of the sky, the terrain's lush and dry tints darkened.
- **The meadow was ribbons on bare ground.** Three new card kinds photographed from scanned
  plants (`tools/blender/plant_card.py`): 11,500 grass clumps, 2,600 tall grass, 420 herbs
  (`src/flora.ts`). The generated fern, shrub and weed pictures are tinted down to sit with them.
- **Plaza light**: ambient 0.45 to 0.17, sun 1.6 to 2.9, environment 1.0 to 0.58, haze 0.020 to
  0.005, so shade is dark and sun patches are bright. The other four arenas keep their values.

**Not done / not known.** Frame rate: interleaved Plaza captures read about 45 fps with the old
trees and 38 to 40 with the new ones before the cards were trimmed, on a machine with a load
average above 30; no clean number exists for the final state. The outer hills and the far tree
line are still flat cards on plain ground. Shrubs, ferns, weeds, reeds and flowers are still
generated pictures. Nothing was looked at in motion (wind on the new cards, the edge fade's
dither while turning). Phones, web and Android were not run; the plant cards are scaled down or
off there. The sources are downloaded by the build script, not stored.

**Trunks, same day (Ralph: "now it's mainly the stems").** Every trunk was pale ash grey whatever
its texture: tinting the wood pure red gave pink. The cause was the same as on the leaves, the
sky's mirror reflection, several times brighter than the bark's own colour. The wood materials
now carry a flat glTF occlusion map (`--wood-sky`, 0.25) that takes the sky's share down. Also:
the bole's colour and normal maps at 4K (`fetch_polyhaven.py --trunk-4k`), 6,000 to 7,000 trunk
triangles, a warm tint, a darker foot, the many-stemmed tree sunk 0.45 m so its scanned ground
slab is under the terrain, and a ring of tall grass round every foot. The three models are 42
to 47 MB each now (were 25 to 29).
