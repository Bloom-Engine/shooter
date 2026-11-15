# AAA plan (2026-11-14)

Where the game stands after the November overhaul, and the ordered work to close the gap to a
shipped AAA third-person shooter. Source: the 2026-11-14 audit (code read of every `src/` module,
the July audit docs, and 12 captured frames from the COMBATSHOT and SCENESHOT harnesses on an
M1 Max at 3456x2168).

**Starting point.** One run is 5-8 minutes: two arenas, three waves each (22 and 25 enemies),
seven enemy kinds, four weapons. The game-feel layer (shake, hit-stop, flinch, FOV kick, rumble) is
the most finished part. The renderer is no longer the main gap. The gaps, in order of how visible
they are: player animation, world art, combat depth, UI, audio/VFX variety, content volume.

**How to read this.** Phases are ordered by perceived quality gained per unit of work. Each item
has an acceptance test. `[bug]` items are defects, the rest are missing or shallow features.
"Verified" means re-checked on 2026-11-14; "reported" means found by code reading and not yet
reproduced in play. Sizes are for one person with the current tooling. Ticket ids are not assigned
here; register items in `docs/tickets.md` (next free: SH-061) as they are picked up.

**Rule carried over from July:** no performance win may cost visual quality at default settings.

---

## Phase 0 - Bugs and hygiene - DONE 2026-11-14 (ticket SH-055)

Landed in one pass; `docs/tickets.md` SH-055 records what changed per item and how each was
checked. The table below is the plan as written. Three things are NOT closed by it and carry
forward:

- **0.3 on iOS, tvOS and Android.** The arena select relaunches the game (engine `restartApp()`),
  which those platforms do not allow, so they still ask the player to reopen the app. The real fix
  is an in-process world reload: the world tables in `src/world-runtime.ts` become reloadable state
  and the engine gains a teardown path for colliders, scatters and GI proxies. Weeks, not days.
- **0.4 crouch.** The crouch-walk clip is authored for 0.5 m/s against a 2.0 m/s crouch; it still
  slides. Needs a faster clip (1.1) or a slower crouch.
- **Not verified by play or by ear:** the new sounds, the touch buttons, the pad crouch, the
  line-of-sight gate and the cannon unlock were compiled and read, not played.

Also noticed while in there, not fixed: the melee damage-direction arc (`src/director.ts`, the
`hitYaw` line) is computed from the enemy-to-player vector while the projectile arc uses the
direction back to the source, so one of the two points the wrong way. Check in play.

| # | Item | Where | State | Done when |
|---|------|-------|-------|-----------|
| 0.1 | `[bug]` HUD ammo line runs off the right edge ("R reload" is cut) on a 16:10 display; desktop has no UI scale, so all HUD text is tiny at high resolution | `src/hud.ts:215-224`, 2D pass in `src/main.ts:1542` | verified in every captured frame | Desktop HUD is laid out in the same ~1000-unit logical space as mobile; right-anchored text is measured, not offset by a constant; checked at 16:9, 16:10, 21:9 |
| 0.2 | `[bug]` The cannon can never be unlocked: victory always unlocks the chaingun, and the banner text is hardcoded | `src/director.ts:851`, `src/hud.ts:304`, `src/weapons.ts:20` | verified | Clearing arena_02 unlocks the chaingun, arena_03 the cannon (or the reverse; pick one and fix the comment); banner names the weapon actually unlocked |
| 0.3 | `[bug]` Level select tells the player to restart the game | `src/hud.ts:343-350`, `src/main.ts:1731` | reported | Choosing an arena reloads the world in-process behind a loading screen |
| 0.4 | `[bug]` Walk and crouch foot-slide: the playback rate needs 2.8x and is clamped at 1.8x | `src/main.ts:979`, `:2550` | reported | Authored speeds re-measured from the clips (`clip_sheet.py`); feet planted at walk, run and crouch speed in a side-on capture |
| 0.5 | `[bug]` Rifle, chaingun and cannon all play the rifle sample; the cannon explosion plays the blaster shot; `rifle_fire.wav` is loaded and never used | `src/combat.ts:191`, `:330`, `src/main.ts:194` | reported | One distinct fire sound per weapon and a real explosion sound (generate with `tools/gen/sfx.py`) |
| 0.6 | `[bug]` Ranged enemies fire with no line-of-sight test (the comment says "clear-ish line", the code checks range only) | `src/director.ts:598-599` | reported | A ray test gates the shot; a Spitter behind the house holds fire |
| 0.7 | `[bug]` `explode()` can kill the player outside the `playing` gate and without the death feedback | `src/combat.ts:209-223` | reported | Self-damage death goes through the same path as any other death |
| 0.8 | `[bug]` Footsteps only distinguish river from everything else; the four dirt samples never play and concrete sounds like grass | `src/main.ts:2067` | reported | Surface comes from the terrain splat layer outdoors and the building footprint indoors |
| 0.9 | `[bug]` Touch has no pause, aim, dodge or crouch; crouch has no gamepad binding | `src/input.ts:331-333`, `:404-415` | reported | Every action reachable on every input device |
| 0.10 | `[bug]` The tyrant never enters its windup although the HUD caption announces a slam | `src/director.ts:510-528`, `src/hud.ts:31` | reported | Folded into 2.2 |
| 0.11 | `[risk]` `tools/build-android.sh:75` runs `git checkout -- assets`, which discards any uncommitted asset work | verified | The script restores only the files Perry is known to truncate, or refuses to run on a dirty `assets/` |
| 0.12 | `[risk]` Web and Android builds copy the whole `assets/` tree, including the GPLv3 legacy models and ASTC duplicates; only `release.py` prunes | `tools/build-web.sh:87`, `tools/build-android.sh` | reported | One shared exclusion list used by all three build paths |
| 0.13 | `[risk]` GPLv3 legacy files in an MIT repo: `enemy_{dretch,mantis,marauder,adv_marauder,dragoon,tyrant}.glb`, `player_bsuit.glb`, plus `menu.ogg`/`game.ogg`/`ambient.ogg` of unrecorded origin | `assets/LICENSE.md` | verified | Files and their converters (`tools/convert-*.ts`) deleted from the tree. Needs Ralph's yes; history keeps them either way |
| 0.14 | Stale docs: `README.md` describes the Unvanquished game; `docs/ASSET-TODO.md`, `docs/audit-2026-07-16.md` and parts of `docs/tickets.md` predate the new cast; SH-053/054 are missing from the registry; wave configs still use the legacy kind names | | reported | README rewritten; old audits marked historical at the top; kind names migrated in the world files and `src/world-runtime.ts:451` |
| 0.15 | Small leftovers: unused `WALK_BOB_*`/`ATTACK_LUNGE_AMP` (`src/enemies.ts:126`), the "violet tint" comment, boot label "the marine", the retired `SET_COLORBLIND` key still written, recoil recovery claimed in the `weapons.ts` header but absent | | reported | Removed or made true |

---

## Phase 1 - The player on screen - LANDED 2026-11-14 (ticket SH-056)

**State.** All six items have landed; `docs/tickets.md` SH-056 has the per-item record. The
Trooper has 14 clips (a second Text2Motion batch), a strafe blend while aiming or firing, a roll
with i-frames, an IK reload, hit reactions, two deaths, the torso aim offset, the off-hand grip, the
shoulder camera and the crouch capsule. Engine EN-064 supplied the blend, joint-rotation and IK
calls. **Carried forward:** a jump clip, a weapon-swap animation, turn-in-place, and a play-through:
the phase gate asks for a 30-second capture, and what exists is still frames from the PLAYERSHOT
harness. The clips are Text2Motion, not motion capture: legs are good, arm poses vary, and the game
hides that by layering one clip's upper body over every gait.

The player's back fills the middle of every frame, and it has five clips. This is the largest single
gap.

1.1 **Animation set.** The Trooper is on the Mixamo skeleton, so the missing clips can be retargeted
rather than generated: rifle idle/aim, strafe left/right/back, sprint, jump start/loop/land, roll,
reload, weapon swap, hit reaction (front/back), death (two), fire additive. Extend
`tools/gen/build_cast.sh` and the clip index table. *Done when* every player action in
`src/player.ts` has its own clip and none plays the walk pose as a stand-in.

1.2 **Locomotion blending.** Eight-way strafe blend while aiming (the body currently turns to face
movement, `src/main.ts:2499`), speed-matched blend walk to run, turn-in-place.

1.3 **Upper-body layer and aim offset.** The enemies already have an upper-body attack layer over
locomotion (`src/main.ts:2616`); give the player the same, with a pitch aim offset so the torso and
rifle follow the camera. Replace the camera-oriented weapon (`src/combat.ts:466`) with the weapon
riding the hand, plus left-hand IK onto the foregrip (needs the engine's bone-socket query, shipped
as EN-033, and a two-bone IK solve - check whether the engine has one).

1.4 **Shoulder camera.** Lateral offset so the player is off-centre and the crosshair is clear,
shoulder swap on a key, collision pull-in that keeps the offset. `src/camera.ts:124`.

1.5 **Dodge as a real move.** Roll clip, invulnerability window, stamina or cooldown shown in the
HUD. Today it is a slide with no i-frames (`isDodging` has no consumer in `director.ts`).

1.6 **Crouch that works.** Resize the capsule (`src/player.ts:59`, open since SH-048).

*Phase gate:* a 30-second capture of walk, strafe-aim, fire, reload, roll and death that reads as a
character, not a statue with a gun.

---

## Phase 2 - Combat that can be read and mastered - LANDED 2026-11-14 (ticket SH-057)

**State.** All nine items have code behind them; `docs/tickets.md` SH-057 has the per-item record
and how each was checked (the P2TEST and P2BOT harnesses in `src/main.ts`: numbers in a log and
still frames, plus a whole run played by a stand-in). **None of it has been played by a person,**
and tuning is where this phase is least finished: sight and hearing distances, wind-up lengths,
token counts, recoil patterns and damage numbers are first guesses that ran, not values anyone
has felt. **Decisions taken** (the plan left them open): deaths are authored clips chosen by the
blow, not ragdolls (2.4); swarms came from stripping the creature rigs to 23 joints, not from
raising the engine's limit (2.6); the vault is a scripted mantle with no clip of its own (2.7);
each weapon got a handling quirk, not an alt-fire (2.8). **Carried forward:**

- **A third death per kind and real flinch clips (2.4).** The cast has two usable deaths (thrown
  on its back, crumpling where it stands) and one pain clip; direction comes from a procedural
  spine jolt. More needs Tripo Text2Motion on seven rigs (about 20 credits a clip, one download
  per rig): Ralph's call.
- **Ragdoll for this skeleton, and more than 1024 joint matrices (engine).** Both still open; the
  limit is a 64 KiB uniform buffer, so raising it means a storage buffer. The game no longer
  needs it for the current pool (757 of 1024 used).
- **Cover (2.7)** was left out as the plan said.
- **Vault, jump and melee have no clips.** The vault and the jump borrow the crouch and the gait;
  the rifle-butt strike is a spine twist and a swung weapon.
- **Perception does not cross floors honestly.** A creature hunting blind inside the flow grid is
  routed toward the player, not toward its guess, whenever the house is in the way.
- **Touch and pad bindings for the strike and the grenade** were added and not tried on a device.

2.1 **Perception.** Sight cone plus hearing radius, with idle, alerted, searching states. Enemies
currently read the player position every frame (`src/director.ts:335`).

2.2 **Telegraphed melee.** Every melee kind gets windup, active frames and recovery, with a hit
shape that exists only during the active frames. Damage today lands the instant range and cooldown
allow (`src/director.ts:731`). Pair with 1.5 so the dodge answers it.

2.3 **Locational damage.** Head, body and limb shapes per kind in place of the single box
(`src/enemies.ts:285`); a weak point per heavy; hit-marker and sound variants for a critical hit.
Rescale HP and damage (today 3-20 HP against 1-8 damage) to leave room for falloff.

2.4 **Hit reactions.** Directional flinch clips, stagger on heavies, a death chosen by hit direction.
Decide on ragdoll: fix it for this skeleton in the engine, or author three deaths per kind.

2.5 **Group behaviour.** Attack tokens so only N enemies attack at once, flank and surround roles,
ranged kinds that reposition when they lose line of sight. Use the flow field outdoors too, not only
across floors (`src/director.ts:383`).

2.6 **Swarms.** The 1024 joint-matrix limit caps the pool at two bodies per kind. Two routes, not
exclusive: strip finger and toe joints from the creature rigs at import (66 to about 30 joints,
which more than doubles the pool with no engine change), and raise the limit in the engine. *Done
when* a wave can field eight Skitters at once.

2.7 **Player kit.** In this order: health recovery (pickups or partial regen), melee strike, one
grenade, vault over low obstacles. Cover is a larger commitment; decide separately.

2.8 **Weapon identity.** Authored recoil patterns with recovery, damage falloff, an alt-fire or
handling quirk per weapon, modelled pickups in place of the bobbing cubes (`src/combat.ts:543`).

2.9 **Gamepad aim.** Rotational aim assist and bullet magnetism on top of the existing slowdown
(`src/input.ts:445`), separate ADS sensitivity.

---

## Phase 3 - World art and lighting - LANDED 2026-11-14 (ticket SH-058)

**State.** All seven items have work behind them; `docs/tickets.md` SH-058 has the per-item record.
Judged from still captures (the SCENESHOT harness, now with a view table per arena) and by the
P2BOT stand-in clearing all three arenas. **No person has walked through it,** and nothing was
looked at in motion: wind on the new plants, the foam drifting, the river from a moving camera.
**Decisions taken:** time of day comes from grading the one sky panorama per arena, not from the
engine's physical sky (tried: a near-black zenith and banded clouds); lamps light the house and
the ground from inside the game's own shaders, unshadowed (the engine's shadowed spot and point
lights exist now but only shadow what its scene shader draws, which is neither the house nor the
terrain); small plants and the far tree line are instanced cards, rocks and hardware are Tripo
models (660 credits, twelve models). **Carried forward:**

- **Depth of field while aiming (3.5).** Tried and removed: the engine's blur had no in-focus
  band at fight distances and softened the target with everything else. It now only blurs the
  world behind menus and end screens. Motion blur and dynamic resolution are settings rows,
  off by default, and nobody has looked at either.
- **Volumetric fog (3.5).** The engine has none. The ravine's mist is the height fog, thicker.
- **Shadows from indoor lamps, and visible bounce (3.4).** The lamps of the world file cast
  shadows on the house and the ground since SH-064 (2026-11-15): walls stop a lamp, and
  furniture, the Trooper and the creatures throw shadows from it. Judged from stills only. The
  house's ceilings are darker for it (they were lit through the floor by the lamps below), and
  nobody has re-balanced the interior lamps. Characters and props are still lit by a lamp
  through a wall, and indoors still take the open sky's ambient light. No visible bounce.
- **Damage and decals on the house (3.4).** Variation is procedural (soot, re-pointing, lime
  bloom, a plastered ceiling); there are no broken corners, holes or posters.
- **Emissive eyes and visor (3.6).** Not done: it needs an emissive map per character. What
  landed is a contact shadow under every figure, a darker wet look after wading, and creatures
  darkening as they are hurt.
- **The 10 m rule (3.1)** ("no 10 m square without a second object type") was not measured.
- **Phones, the web build and Android** were not run. Plant counts are scaled down there and
  Android draws no small plants; the card shader has only been compiled by the desktop backend.
- **The editor** has not opened the dressed worlds. The new keys (`look`, `yaw`, `obst`) are
  plain userData and should pass through; that is an expectation, not a test.

The original findings and items, for the record:

Observed in the captures: a bare horizon of green hills, a river with a sawtooth mesh edge and a
flat brown bank stripe, a brick box whose interior has a smeared ceiling texture and no light of
its own, visible brick tiling, one tree silhouette family, no ground clutter.

3.1 **Dress the ground.** Rocks, bushes, ferns, fallen logs, leaf litter and flowers through the
existing pipeline (`process_static.py`) and scatter; paths and worn patches painted in the splat
layers. Target: no 10 m square without a second object type.

3.2 **Horizon.** Distant tree line, far hills with a second material, haze. The skirt is currently
one grass colour.

3.3 **River.** Smooth the mesh edge, blend the bank with wet mud, stones and reeds, add foam at
the shore and around obstacles, depth-based colour.

3.4 **The house.** Break up the tiling (macro variation, decals, damage, trim variety); fix the
ceiling UVs; furnish the interior; add interior lights with shadows (spot lights are engine EN-034,
still unbuilt) and visible bounce. More than one building type across arenas.

3.5 **Lighting and grade.** A chosen time of day per arena instead of flat noon, a colour-grading
pass, and the engine features that have no call site yet: `setTonemap`, `setDepthOfField` (aim and
menus), `setMotionBlurEnabled`, `setAutoResolution`. Volumetric fog under the canopy if the engine
can supply it.

3.6 **Character shading.** Characters use one material. Emissive eyes or visor, wetness after the
river, blood and dirt accumulation are cheap ways to stop them looking pasted on; contact shadows
or capsule AO to ground them.

3.7 **Third arena** (owed since SH-040) built with everything above, as the acceptance test.

---

## Phase 4 - UI and front end - LANDED 2026-11-14 (ticket SH-059)

**State.** All six items have work behind them; `docs/tickets.md` SH-059 has the per-item record.
Judged from the UISHOT harness (19 captures: every menu screen, the HUD in its states, both results
screens, German and French) and the MENUTEST harness (14 scripted checks through the real key
path: rebinding, a swap on conflict, the results screen opening by itself, pause, return to the
title). **Nobody has used it with a hand on a mouse or a pad,** and nothing was looked at in
motion: the row animations, the banners, the counting score. **Decisions taken:** the UI kit is the
game's own (`src/ui.ts`: an atlas of white shapes tinted through a palette of meanings), not the
engine's EN-030, which is still open; glyphs are drawn from the binding table, with one pad set
(the Xbox letters), because the engine does not say which pad is connected; languages are English,
German, French and Spanish, generated from one table; the font stays Rajdhani, which covers Latin
and Latin Extended only. **Carried forward:**

- **In-process arena reload (4.2 / 0.3).** Unchanged: choosing an arena still relaunches the game
  behind a loading cover, and phones, tablets and TV boxes still ask the player to reopen it. It
  needs the world tables to become reloadable state and an engine teardown path for colliders,
  scatters and GI proxies.
- **Resolution list and monitor choice (4.3).** The engine offers a full-screen toggle and an
  output scale, not a list of modes; the rows are WINDOW (full screen / windowed) and DISPLAY
  RESOLUTION (50-100% of native). A saved "windowed" was booted once and came up in a window;
  switching back and forth from the row was not tried.
- **Phones, the web build and Android.** They now read the video settings (their old fixed
  profile became the file's defaults there), and the HUD has a phone layout (smaller, the weapon
  block between the stick and the buttons). None of it was run on a device or in a browser.
- **A pad.** No controller was connected: pad glyphs were drawn by forcing them in the harness,
  and pad rebinding, the dead zone and the response curve were compiled and read, not tried.
- **Wider script coverage (4.5).** No Cyrillic, Greek or CJK: that needs a second font. Engine
  EN-059 (UTF-8 files read as Latin-1) is still open; the string table lives in source, which is
  why it is not affected. The boot screen's stage labels are still English only.
- **Subtitles are for sounds, not speech (4.4).** The game has no dialogue. Eight sound events
  are named (wind-up, a creature's alert shriek, the howl before a wave, heartbeat, explosion,
  dry click, field dressing, the silence of a cleared arena).
- **Colour-blind palettes re-colour the HUD and menus only,** not the world (blood, muzzle
  flash, the creatures' own colours). They were chosen from published safe pairs and not checked
  with a simulator.
- **Difficulty** is three multipliers (damage taken, creature health, points). The values are
  first guesses nobody has played.
- **Radar.** The plan offered "compass or radar"; this is a compass strip with a pip per creature.

The original items, for the record. (Engine EN-030, the UI widget layer, was listed as a partial
blocker: at the time everything was rectangles and one font.)

4.1 **HUD art pass.** Weapon silhouette and ammo pips, a framed health display, designed damage
direction arc and vignette, kill and critical hit-marker variants, off-screen threat markers, a
compass or radar, wave and objective tracker, animated transitions.

4.2 **Menus.** Designed title, in-game arena reload (0.3), results screen with stats, credits,
transitions and sound on every interaction.

4.3 **Settings.** Rebinding for keys and pad, resolution and window mode, vsync and fps cap, quality
presets, HUD scale, difficulty, separate ADS sensitivity, deadzone and curve. Mobile and web
currently ignore the graphics settings (`src/main.ts:516`).

4.4 **Accessibility.** Subtitles with size options, colour-blind palettes (the row was retired),
hold/toggle everywhere, aim-assist strength.

4.5 **Localization.** A string table (`src/strings.ts`, open since SH-043) and a font with wider
coverage. Engine EN-059 (UTF-8 read as Latin-1) must close first.

4.6 **Glyphs.** Button art per device in place of the text hint `[Y switch  X reload]`.

---

## Phase 5 - Audio and VFX depth - LANDED 2026-11-15 (ticket SH-063)

**State.** Done after Phases 6 and 7, not before them. `docs/tickets.md` SH-063 has the record.
**Nobody has listened to any of it.** The sounds were checked by length, level and spectrum,
the effects from captures (the new VFXSHOT harness, day and night), and the wiring by the
check script and two stand-in runs. Every level in `src/sfx.ts` is a first guess.

**The find of the phase: no particle in the game was visible.** The particle shader's
soft-fade read the scene depth wrongly and faded every particle to nothing: muzzle flash,
smoke, blood, sparks, dust, casings, tracers, since some engine change after SH-033. The
pools were full and the draws were issued, so nothing reported it, and no earlier capture was
ever looked at for it. Fixed in `assets/materials/particle.wgsl` (depth read the way
`water.wgsl` reads it). Every effect older than this phase is therefore being seen for the
first time too, and was tuned blind: the muzzle smoke was cut from five puffs a shot to two
because it hid the Trooper's head.

| Item | What landed |
|---|---|
| 5.1 Weapons | Three reports per weapon (eighteen), never the same twice running, pitch spread per shot. The mechanism after the shot (bolt, pump a beat later, capacitor). A casing landing on soft or hard ground. Dry click. Swap. Reload in three stages for the magazine weapons and its own two-stage set for the energy weapons; a cancelled reload makes no end sound. Tails for the scattergun and the lance. |
| 5.2 Creatures | Voices of their own for the Spitter, the Bombard and the Matriarch. An idle murmur from creatures that have not noticed the player, an alert call from the one that has (one at a time). A sound and thrown earth when one comes up. A growl for an elite. The Matriarch's roar, slam and summon. Spit, lob and acid-landing sounds. Every vocal is low-passed when a wall stands between it and the camera (one ray per vocal). |
| 5.3 Impacts | `SFX.impact` asks what a round hit (earth, wood, masonry, metal, water: from the terrain, the water volumes, the trees, the building footprint and each prop's model) and plays that material's two sounds and its particles. Three flesh sounds. |
| 5.4 Ambience | The wind bed is back on (its spectrum is not white noise any more; kept low). Birds by day, insects at night, room tone indoors, mixed by the arena's sky and the enclosure. |
| 5.5 Music | **Code only.** A four-rung intensity ladder on the two existing beds (calm, tense, combat, peak), fast up and slow down, a breath out of the music as a wave starts, and a slot for a boss bed. **Music added the same day**: Ralph regenerated all seven tracks in Suno (calm loop 141 s, combat 111 s, menu 47 s, a 68 s boss theme, three stingers). Cut and levelled by the numbers, not by ear; whether calm and combat share a key is not confirmed (`assets/music/SUNO-PROMPTS.md`, top). |
| 5.6 VFX | A sixteen-frame fireball flipbook (drawn by `tools/gen/vfx_flipbook.py`, played by particle age with frame blending). A light on every explosion and acid burst. Dark smoke that stays, embers, thrown earth and chips. An alpha-blended particle mode (dust, chips, clods, casings and dark smoke can now be darker than what is behind them), dimmed at night. Trails behind the player's and the creatures' projectiles. Spawn and slam effects. A real water splash in place of the ichor pool. |

**Carried forward:**

- **Listening.** All of it. Most at risk: the levels of the eighteen reports against each
  other, the idle murmurs' frequency (one every 2 to 5 seconds), the ambience beds' levels,
  whether the wind still reads as noise, and whether muffling sounds right.
- **Music**: longer beds, a boss theme, more states than two beds can give (Suno, by Ralph).
- **Per-material impacts are guessed from position**, not from what the ray hit: the engine's
  ray returns no material. A crate inside the house is metal; the house's steel window
  linings are masonry; grass and dirt share one set.
- **Not built:** lit particles (they are unlit and scaled by one time-of-day number), ribbon
  or mesh trails, fire that burns on, gibs or dismemberment, interior birds/insects
  occlusion beyond the enclosure mix, more than one room tone.
- **Trails and casings cost pool space**, not measured beyond the fight frame rate, which did
  not move (36 fps before and after on the M1 Max at the old default).
- **Subtitles** were not extended to the new sounds.
- **Other platforms**: not run. The flipbook texture is 2048 square (5 MB).

---

## Phase 6 - A game around the fight - LANDED 2026-11-14 (SH-060 slices A-C, SH-061 slice D)

**Decisions (Ralph, 2026-11-14).** Escalating survival with a meta layer, not a campaign.
Upgrades are bought with credits earned in runs. Built in four slices; A to C landed without
spending anything, D (the boss, two more weapons, two more arenas) needs Tripo credits and is
not started. Phase 5 was skipped on the way here, so everything below arrives with the sounds
and effects the game already had. (Phase 5 landed afterwards, 2026-11-15: SH-063.)

**State.** `docs/tickets.md` SH-060 has the record. Judged from the UISHOT harness (27 captures
per arena run), the MENUTEST harness (22 scripted checks through the real key path) and P2BOT
runs. **Nobody has played it.** A stand-in that is PUT at each objective proves the waves flow
and end; it says nothing about whether a hold is tense, a flank is fair, or ten waves are too
many. Every number added here (elite multipliers, upgrade prices and steps, star thresholds,
hold seconds, nest health, the arena star gates) is a first guess.

| Slice | What landed |
|---|---|
| A. Encounters | Ten waves per arena (was three). A wave is a list of groups, and each group's pattern picks its spawn point(s) when it starts, from where the player stands and looks: front, ambush, flank, far, near, surround (`tools/gen/gen_waves.py`, `startGroup` in `src/director.ts`). Eight spawn points per arena (were four corners). Elites: a flagged creature of an existing kind, 2.4x health, 1.3x damage, 16% larger, red glow, flinches a third as often, pays triple, always drops a field dressing. |
| B. Progression | `profile.json` (versioned, separate from settings): credits, four upgrade tracks per weapon (damage, magazine, reload, one perk each), stars per arena, lifetime numbers. ARMOURY and SERVICE RECORD screens. Arenas open by total stars (0 / 1 / 3). A run pays a tenth of its score, 150 for a win, 200 per new star. |
| C. Objectives and onboarding | HOLD (bank seconds inside a ring of stakes at the arena's generator) and NESTS (three nests that breed until shot apart); arena_02 has a hold wave, arena_03 a nest wave, arena_04 both. A five-step tutorial before the first wave of the first arena, answered by doing each thing, skippable, once per profile. Six one-time hints. One setting switches both. |

**Carried forward:**

- **Length and difficulty are untuned.** The stand-in needed 6, 9 and 12 minutes for the three
  arenas with its health held full, and took several hundred hits in the later two. A nest wave
  ran over two minutes and, in arena_04, 74 kills. A person will be slower.
- **Slice D: volume (SH-061).** In: arenas 5 (Quarry, overcast noon) and 6 (Brood Hollow,
  night); the scattergun and the lance; the boss, the Matriarch, with three phases, on wave 10
  of Brood Hollow. The three models came from Tripo for 250 credits. Estimated and not yet
  tuned against pictures: her hit shapes, the two weapons' hand positions. The plan's second
  boss was cut. Volume now: 5 arenas x 10 waves, 6 weapons, 1 boss.
- **Escort objectives.** Left out on purpose: they need a companion that paths, and a weak
  escort is worse than none.
- **The nest is procedural** (`tools/blender/build_nest.py`): a fused mound with a baked
  procedural skin. It reads as a nest and it is not at the level of the generated cast. A
  Tripo model would replace `assets/models/prop_nest.glb` with no code change.
- **The hold ring is twelve stakes with lamps**, drawn with engine primitives, because the
  additive glow material is one warm colour and too faint in daylight. A ground decal or a
  proper beam needs a material of its own.
- **Elites have no sound of their own and no name plate**; they are told apart by size, colour,
  glow and a larger pip on the compass.
- **Upgrades cannot be refunded**, and there is one profile, not slots. RESET PROGRESS (two
  presses) wipes it.
- **The tutorial has no touch prompts**: on a phone it shows the words without glyphs and each
  step moves on by itself after 14 seconds. Not run on a phone.
- **Stars before Phase 6.** A profile is created from the old best scores: an arena with a
  score counts as one star, so nobody is locked out of what they had reached.
- **Perry.** `src/main.ts` now only compiles with `PERRY_LLVM_INPROCESS=0`
  (`docs/perry-quirks.md` #6). Every build script sets it; only the macOS native build was run.
  Not reported upstream yet.
- **Not built here:** iOS, tvOS, Android, web, Windows.

The plan's original text for this phase, for reference: structure (survival or campaign),
encounters (objectives, elites, a boss, spawn choreography), progression (upgrades, unlock tree,
difficulty modes, stats, profiles, a versioned save), onboarding (tutorial, contextual prompts),
a volume target of 5 arenas x 10 waves, 2 bosses, 6 weapons; co-op and voiced narrative out of
scope.

---

## Phase 7 - Performance and production - PARTLY LANDED 2026-11-14 (ticket SH-062)

**State.** What one macOS machine and this repository could do is done; what needs the engine,
another device or a decision is listed as open. `docs/tickets.md` SH-062 has the record.

| Item | State |
|---|---|
| 7.1 Re-measure | **Measured on the M1 Max only; the 60 fps target is NOT met.** Numbers below. Dynamic resolution is now ON for a fresh desktop install. |
| 7.2 Automated checks | **Done locally, static part in CI.** Harnesses start with `./main --harness <name>`, no source edit. `tools/check.sh` runs static checks, build, boot, AI and menus (about 4 minutes) and puts the player's files back. GitHub runs the static checks on every push. The build and the windowed checks cannot run on a hosted runner. The two web checks are not wired in. |
| 7.3 Crash and telemetry | **Not started.** Crash capture is engine work on every platform but Windows. |
| 7.4 Platforms | **Bundle audit only.** `tools/release/bundle_audit.py`. Nothing else: no Perry patches upstreamed, no Windows packaging, Android and tvOS untouched. |
| 7.5 Legal | **Recorded, not cleared.** `assets/TERMS.md` names the provider terms and four facts only Ralph can confirm. `PrivacyInfo.xcprivacy` is written and copied into the Apple bundles by `release.py`; no release build has been made with it. Age rating and store text: not written. |

**7.1 numbers** (M1 Max, 3456 x 2168, arena_02, 80,000 grass tufts, the machine also busy
with other builds, so read them as plus or minus 3 fps):

| Case | Before | Now |
|---|---|---|
| Title screen, render scale 0.75 (the old default) | 40 fps | 40 fps |
| Title screen, render scale 0.5 | 51 fps | 51 fps |
| Title screen, dynamic resolution (the new default) | - | 51 fps |
| A fight (waves 1-2, up to six creatures), mean of 35 windows | 36 fps | 45 fps |
| Same, worst window | 31 fps | 34 fps |

What the measuring showed, and what it did not:

- **The frame is limited by the graphics card, not the game code**: 24 ms on the GPU, 3 ms of
  engine CPU.
- **No single thing owns it.** With the render scale at 0.5, removing one thing at a time
  moved the frame from about 20 ms by: shadows 2.3 ms, trees 1.9, grass 1.6, global illumination
  1.6, ambient occlusion 0.9, water reflection 0.5, flora and bloom nothing. Everything off
  at a quarter of the resolution is still 18.4 ms. So about 18 ms does not depend on
  resolution or on any switch the game has. Where it goes is not known: the engine's
  per-pass GPU times overlap on this GPU (they sum to several times the frame) and cannot
  be added up.
- **Lowering the output resolution did not help** (0.75 was slower than 1.0 in two runs).
  Unexplained.
- **So 60 fps here needs engine work**, not settings: a per-pass timing that can be trusted
  on Metal first, then whatever that shows. Grass LOD (EN-060) and character LODs were not
  tried; the removal test above caps what grass LOD could win at 1.6 ms.
- **Two bugs found by measuring**: the staged test asked for the Mailbox present mode, which
  Metal does not have, and the engine panicked (it uses AutoNoVsync now); and the frame-rate
  probe measured under vsync, so its numbers were multiples of the refresh interval.
- **Not measured**: any other machine, iOS, tvOS, Android, web, Windows; arenas 03 to 06; the
  boss wave; memory.

**7.4 bundle audit.** The assets a bundle ships weigh 463 MB with plain models (web, Android)
and 1,601 MB with ASTC models (the three Apple builds). The whole difference is the ASTC
copies: a model whose GLB is 5 MB (JPEG and PNG inside) is 68 MB as ASTC 4x4, because each
carries three 4K maps with mip chains. Ten furniture and weapon models are 690 MB of it. The
ASTC copies exist so a phone keeps textures compressed in memory; they cost download size.
Ways down, none taken because each changes how a model looks or loads and needs a device to
judge: 6x6 blocks for colour (`ASTC=6x6`, about 2.25 times smaller), 2K maps for the furniture
(four times smaller; `bloom-cook` has no resize option, so it would be done in Blender), plain
models on macOS. No file is shipped that nothing loads: the 51 files a name search could not
find are all loaded by constructed names.

**Carried forward:**

- 60 fps on the reference machine: **near it since the engine pass of 2026-11-15** (below), at 75% output resolution. Not met at native output.
- CI that builds and runs the game needs a self-hosted Mac runner with Perry and the engine.
- Crash capture off Windows; telemetry.
- Perry: quirk #6 (`PERRY_LLVM_INPROCESS=0`) and the release patches are still not upstream.
- The four plan confirmations and the sky's origin in `assets/TERMS.md`.
- Age rating, store description, screenshots.
- A release build that proves the privacy manifest is accepted.

---

## The engine pass of 2026-11-15 (engine ticket EN-065; on the engine's `main` since pull request #223, merge `96d4d87`)

Ralph asked for the engine items this plan called blocked. What it changed for the game:

| | Before | After |
|---|---|---|
| Title screen, render scale 0.5, native output | 20.8 ms (48 fps) | 18.6 ms (54 fps) |
| Title screen, render scale 0.5, 75% output | 30 ms (33 fps) | 14.1 ms (71 fps) |
| A fight, Ralph's settings (native, render 0.75, no auto-res) | 36 fps | about 41 fps |
| A fight, a FRESH install | 45 fps | 57 to 61 fps |

- **Two engine bugs were most of the "unexplained 18 ms".** The global-illumination cache
  rebaked its nearest level every frame (its "sun moved" test assumed a unit-length sun
  direction; ours is 0.998 long) and never baked the wider two. And a lower output resolution
  rebuilt every render target on every frame, so it was slower than native and anti-aliasing
  never accumulated: the Phase 7 note "lowering the output resolution did not help" was this.
- **A fresh desktop install on a panel past six megapixels now starts at 75% output**
  (`src/main.ts`, after `SET.loadSettings`). An existing `settings.json` is not touched:
  Ralph's own file still says native and no auto-resolution.
- **What the frame is made of now** (the engine's per-pass times add up since this pass): at
  native output about 8 ms is passes that run at output resolution (anti-aliasing,
  sharpening, exposure, composite, HUD), 4 ms the scene's depth pre-pass and main pass,
  2 ms the water's planar reflection, 2 ms shadows in a fight. No single remaining bug.
- **Ragdoll works on the cast** (three engine bugs: each body drove the wrong joint,
  neighbouring bones collided, limits were on world axes). `./main --harness combatshot
  --ragdoll 1` shows it. The authored deaths stay the default; nobody has compared them.
- **Depth of field has a sharp band** (`setDepthOfFieldRange`); the game does not use it
  while aiming yet. **Colour-grade tables** (`setColorGrade`) exist and are unused.
- **Crash reports**: a panic or fatal signal writes `crash-report.txt`; the next launch moves
  it to `crash-report.last.txt` and says so on stdout. No crash was provoked to prove it.
- **UTF-8 file reads (EN-059)** were already correct; the garbled arena name was in the file.
- **Monitors**: the engine lists displays and moves the game between them (`getMonitorCount`,
  `getMonitorName`, `setMonitor`; tried on this Mac's three displays, windowed and
  fullscreen). **The game has no settings row for it yet.** There is no list of display
  modes: output scale is the resolution control.
- **Pad family**: `getGamepadKind` says Xbox / PlayStation / Nintendo. The game still draws
  Xbox letters only (the atlas has no other glyph set), and no pad was connected to try it.
- **Not done in the engine, each for a stated reason:**
  - *Lamp shadows on the house and terrain.* Needs local-light shadow maps rendered through
    the engine's cascade pass (one 1,500-line function with its own caches) and a new
    binding in the material ABI that every material pipeline on every platform shares. Days
    of work that has to be judged by eye; not something to land blind.
  - *Volumetric fog.* The same class of work (a froxel volume, lit and shadowed).
  - *Grass LOD (EN-060).* Capped at 1.6 ms by measurement and bound by "no visible loss",
    which only a person looking at it can sign off.
  - *More than 1024 joint matrices.* Done afterwards (engine EN-066, branch
    `feat/joint-palette-storage`): the palette is pages of 1024, 16384 joints a frame, no
    shader changed. The game still uses 780; `--harness crowdshot` shows 2000.
- **This game's `main` needs those engine commits.** `src/main.ts` imports
  `setCrashReportPath`, which only the local engine has. Until they are pushed or merged,
  a build against the engine's `origin/main` fails.

## Engine work this plan depends on

| Need | Engine ticket | Blocks |
|------|---------------|--------|
| UI widget layer | EN-030 (re-opened) | 4.1, 4.2 |
| Spot lights that shadow material-path geometry (the house, the terrain) | EN-034 landed `addShadowedSpotLight` for scene-shader draws only | 3.4 |
| More than 1024 joint matrices | new | 2.6 |
| Two-bone IK, additive and layered clips for the player | to check | 1.3 |
| Ragdoll that survives the Mixamo skeleton | done, EN-065 | 2.4 |
| UTF-8 file reads | already correct (probed 2026-11-15) | 4.5 |
| Grass LOD | EN-060 | 7.1 |
| Volumetric fog, colour-grading LUT, a depth of field with a usable focus band | checked 2026-11-14: none of the three exists | 3.5 |

## Suggested order

Phase 0 now. Then Phase 1 and the telegraph/dodge pair (2.2 with 1.5) together, because they change
how every second of play looks and feels. Phase 3 can run in parallel since it is content, not code.
Phases 4 and 5 follow. Phase 6 starts with a decision, not with code.
