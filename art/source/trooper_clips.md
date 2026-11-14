# Trooper clip set (plan 1.1, ticket SH-056)

Text2Motion prompts for the player rig in Tripo Studio (workspace `e2d0829b-a51f-4f5f-804a-7c7878774b16`,
Animate tab). One clip each, 5 s. The first words are what `tools/gen/build_cast.sh` matches on, so
keep them. Lessons from the first five clips (only the run came out holding the rifle): say where
both hands are in every prompt, name the body parts and the path they travel, ask for big movements,
do not describe the character.

Every prompt ends with the same hold sentence:

> Both hands hold a rifle the whole time: the right hand at the right shoulder, the left hand
> forward under the barrel, elbows down, back straight and upright, head up.

| clip name | prompt opening (then the hold sentence) |
|---|---|
| idle | Stands guard in place with feet shoulder width apart, knees slightly bent, breathing calmly, shifting weight a little. |
| walk | Marches forward at a steady walking pace with normal strides. |
| walk_back | Steps backward at a steady walking pace, facing forward the whole time. |
| strafe_left | Sidesteps to the left at a steady pace, chest and head facing forward the whole time, feet crossing over. |
| strafe_right | Sidesteps to the right at a steady pace, chest and head facing forward the whole time, feet crossing over. |
| sprint | Dashes forward at full speed with long strides, leaning the body forward, rifle held across the chest. |
| crouch_idle | Crouches low in place on bent knees, heels on the ground, holding still and breathing. |
| crouch_walk | Creeps forward in a low crouch on bent knees with short quick steps. |
| jump | Leaps straight up with both feet, knees tuck in the air, then lands on both feet with bent knees and stands back up. |
| roll | Dives forward into a fast shoulder roll across the ground, tucking the head, and comes back up onto the feet. |
| reload | Swaps the rifle magazine while standing: the left hand lets go of the barrel, drops to the belt at the left hip, comes back up to the middle of the rifle and pushes upward, then returns under the barrel. The right hand keeps the rifle at the right shoulder. |
| swap | Slings the rifle: both hands lower the rifle down to the right hip, pause, then bring it back up to the right shoulder. |
| hit_front | Flinches from a blow to the chest: the upper body jerks backward, one step back, then recovers to standing. |
| hit_back | Stumbles from a blow to the back: the upper body jerks forward, one step forward, then recovers to standing. |
| death_back | Shot in the chest, jerks backward, staggers one step, knees buckle, collapses onto the back with arms falling to the sides, then lies completely still. |
| death_front | Shot from behind, pitches forward, drops to both knees, falls face down onto the ground, then lies completely still. |

**Outcome (2026-11-14).** All sixteen generated first time. Legs and hips are good throughout;
the arm pose still varies from clip to clip, which is why the game layers the run clip's torso and
arms over every gait. Used: idle, walk, walk_back, both strafes, sprint, both crouches, roll, both
hits, both deaths. Left out by `build_cast.sh`: `jump` (barely leaves the ground: re-prompt it),
`swap` (nothing plays it yet) and `reload` (the hand went to the helmet; the game drives the
reload with the off hand's IK instead). The first batch's `run` stays.

To add or redo a clip: generate it in the Animate tab, Export GLB 4k with skeleton on, every
animation selected and "Animation stay in Place" on, `tools/gen/collect_rig.sh player_trooper`, add
its opening words to the `--rename` list in `build_cast.sh`, rebuild, and re-number the
`PLAYER_ANIM_*` table in `src/main.ts` (clips are addressed by sorted name). Judge it with
`tools/blender/clip_sheet.py --view side` before wiring it.
