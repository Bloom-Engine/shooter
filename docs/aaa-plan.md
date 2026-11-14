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
here; register items in `docs/tickets.md` (next free: SH-060) as they are picked up.

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
- **Shadows from indoor lamps, and visible bounce (3.4).** Lamps are unshadowed: a face turned
  away gets nothing, which keeps a room's lamp off the far side of its walls, but furniture
  casts no lamp shadow. Characters and props indoors still take the open sky's ambient light.
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

## Phase 5 - Audio and VFX depth (3-5 weeks)

5.1 **Weapons.** Three or more variations per shot with pitch spread, mechanical and tail layers,
dry-fire, swap, reload stages, shell casings on the surface they land on.

5.2 **Creatures.** A voice set for each of the seven kinds (Spitter and Bombard share others'
today), plus idle, alert and spawn vocals.

5.3 **Impacts.** Per-material sound and particle sets (dirt, grass, wood, brick, metal, water,
flesh) in place of two classes.

5.4 **Ambience.** The wind bed is still muted (`src/audio-mix.ts:154`) although a new file exists:
re-enable and judge it. Birds, insects, interior room tone. Wire the unused `setOccluded`.

5.5 **Music.** Under three minutes exist. Longer beds, an intensity ladder with more than two
states, a boss theme, transitions on wave events.

5.6 **VFX.** Flipbook explosions and fire, a light on every explosion, lit particles, debris,
projectile trails with a mesh or ribbon, spawn effects, water splashes that are not the blood pool
(`src/vfx.ts:330`), gibs or dismemberment if the rating allows.

---

## Phase 6 - A game around the fight (months; needs design decisions first)

Everything above polishes eight minutes. AAA is also volume and structure. Decide the shape before
building:

- **Structure:** escalating survival with a meta layer, or a short authored campaign of linked
  arenas. The first fits the current code; the second needs objectives, checkpoints and scripting.
- **Encounters:** objectives beyond kill-all (hold, escort, destroy), elites and a boss with phases,
  spawn choreography in place of round-robin corners (`src/director.ts:155`).
- **Progression:** weapon upgrades, unlock tree, difficulty modes, persistent stats, profiles and a
  versioned save file.
- **Onboarding:** a tutorial beat and contextual prompts.
- **Volume target for a credible demo:** 5 arenas, 10 waves or 20 minutes each, 2 bosses, 6 weapons.
- **Out of scope unless decided otherwise:** co-op, narrative with voice acting.

---

## Phase 7 - Performance and production (runs alongside)

7.1 **Re-measure.** Nothing on record postdates the new cast and 80k grass. The harness reported
38 fps in a two-enemy fight and 47 fps on scenery on an M1 Max at 3456x2168. Run PERFTEST on every
target and write the numbers down. Target: 60 fps at default settings on the reference machine,
through dynamic resolution (`setAutoResolution`), grass LOD (EN-060) and character LODs.

7.2 **Automated checks.** No CI exists. Make the harnesses run from a command-line flag instead of
a source edit, then run boot, SELFTEST, AITEST and the two web checks on every push.

7.3 **Crash and telemetry.** Crash capture on every platform, not just Windows minidumps.

7.4 **Platforms.** Release builds depend on an unreleased Perry checkout with local patches;
upstream them. Windows has no packaging and an open boot crash (EN-058). Android is debug-grade.
tvOS needs a Siri Remote path. Bundles grew from 320 MB to about 832 MB; audit what ships.

7.5 **Legal.** Record the licence terms for Tripo, ElevenLabs, Suno and the image model output next
to `assets/LICENSE.md`; add `PrivacyInfo.xcprivacy`, age rating and store metadata.

---

## Engine work this plan depends on

| Need | Engine ticket | Blocks |
|------|---------------|--------|
| UI widget layer | EN-030 (re-opened) | 4.1, 4.2 |
| Spot lights that shadow material-path geometry (the house, the terrain) | EN-034 landed `addShadowedSpotLight` for scene-shader draws only | 3.4 |
| More than 1024 joint matrices | new | 2.6 |
| Two-bone IK, additive and layered clips for the player | to check | 1.3 |
| Ragdoll that survives the Mixamo skeleton | new | 2.4 |
| UTF-8 file reads | EN-059 | 4.5 |
| Grass LOD | EN-060 | 7.1 |
| Volumetric fog, colour-grading LUT, a depth of field with a usable focus band | checked 2026-11-14: none of the three exists | 3.5 |

## Suggested order

Phase 0 now. Then Phase 1 and the telegraph/dodge pair (2.2 with 1.5) together, because they change
how every second of play looks and feels. Phase 3 can run in parallel since it is content, not code.
Phases 4 and 5 follow. Phase 6 starts with a decision, not with code.
