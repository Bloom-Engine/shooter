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
| 0 | Architecture | SH-025, SH-005, SH-026 | ✅ **CLOSED** — enemy system extracted to `src/enemies.ts` |
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

## SH-025 — Split `main.ts` into modules ✅ *(enemy system extracted 2026-07-12)*

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

## SH-027 — Real weapon models ✅ *(shipped — Unvanquished MD3 → glTF; v2 hand-bone attach still gated on EN-033)*

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

## SH-034 — Locomotion & animation blending ✅ *(shipped — EN-028 mixer landed: crossfades, upper-body attack mask, speed-synced walk)*

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

## SH-036 — Dynamic music intensity 🔴 *(code live; genuinely blocked on real music — the ONE asset I could not synthesise. ASSET-TODO A4)*

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

**Blocker:** asset (stems).

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

## SH-040 — Level pipeline & selection ✅ *(shipped — arena manifest + level select)*

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

## SH-042 — Content expansion: +2 weapons, +2 enemy kinds ✅ *(shipped — 4 weapons, 7 kinds, 2 of them RANGED)*

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

## SH-043 — Accessibility & localization scaffolding ✅ *(shipped — `src/strings.ts`, shake slider, colourblind-safe hit cues)*

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
