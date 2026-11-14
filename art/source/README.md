# Tripo Studio sources

Raw exports from Tripo Studio (studio.tripo3d.ai, Ralph's account). The GLBs here are git-ignored
(large); re-export them from the workspaces below. Concepts and prompts: `art/style/photoreal/<name>/`.

Pipeline per model (see CLAUDE.md "Asset pipeline"): concept front view -> Generate (HD Model, H3.1,
Ultra mesh, 4K, PBR, Triangle, 2,000,000) -> Retopo (Smart Mesh off, Triangle, 60000) -> Rig
(Humanoid, Mixamo) -> Animate -> Export GLB 4k, skeleton on, all animations, in place.
The 1.9M-triangle original for the normal bake: History -> oldest entry -> "Save as a New Model" -> Export GLB 4k.

Workspace URLs: `studio.tripo3d.ai/workspace/{generate|retopology|rigging|animate}/<id>`

| model | id | notes |
|---|---|---|
| enemy_ravager | adb500c1-d8bd-477c-b3ed-2eeb43cc09a3 | original mesh clone: ab627972-3363-4d25-9797-2eb613f8545f |
| enemy_skitter | ab52bf0c-b977-4981-92e2-211d051f981c | clone: 1b7ba049-5583-4bf9-8d00-ab874554a67c |
| enemy_stalker | 7baa501b-a2f5-4deb-a732-711995eda0e5 | clone: 372d672d-9dd5-416d-99ce-3114a7cbe220 |
| enemy_spitter | 7ecf27c5-b4fa-4cf1-9f28-e2dde9680976 | clone: 437faab2-3e6f-4160-9dbe-b6b4c5bef129 |
| enemy_bruiser | 2c991580-2654-4536-8387-9c994d58ef13 | clone: 509da137-fe50-4ee2-bcc2-4b0d3bc2eb46 |
| enemy_bombard | 3ee3eb17-1f1c-4289-979e-403ac88a12f9 | clone: 2e7bc554-3ab1-4df7-86d6-adf0c90f08f4 |
| enemy_colossus | 589f6170-c8f5-4fa7-b41f-c4d0455f08a6 | clone: 940c819c-adff-429a-b00c-97659f1b6157 |
| player_trooper | e2d0829b-a51f-4f5f-804a-7c7878774b16 | 5 Text2Motion rifle clips; clone: a0342089-39e3-4cfb-a5a3-5a8ec8b86ab5 |
| weapon_rifle | 4a482aa9-e876-4976-9c4c-935ce3385f46 | static |
| weapon_blaster | d534b695-30c4-4c63-9911-b31f843d10eb | static |
| weapon_chaingun | eadf6c4e-a2af-4db7-8e89-2a95bcf6fa14 | static |
| weapon_cannon | b711b3d8-f4e6-4ef1-8e25-2fd4688c928a | static |
| prop_barrel | 74ea8a90-66cf-4b24-8939-abeafb79c291 | static |
| prop_crate | 61a93d5a-836e-4840-a29a-1bfd843f788d | static |
| prop_table | bcf96e2b-8517-4c7b-9135-43af1212fc7d | static |
| prop_chair | 992ecbc7-c090-4cad-b434-748868e4fbb9 | static |
| prop_bed | 65c748ce-f658-49e7-93fb-50a4b122078b | static |

Creature clips (all rigs): presets idle, run, walk, slash, hit_to_body_01, fall, plus the Text2Motion
death clip made on the Ravager ("Hit hard in the chest, the creature jerks backward, staggers one step,
its knees buckle and it collapses heavily onto its back, arms falling to the sides, then lies completely
still on the ground, dead.") reused from the account's AI Animation library. Import with
`tools/gen/make_character.sh <name> <height> --rename "Hit=death"` (heights: skitter 0.8, stalker 1.7,
ravager 1.9, spitter 1.9, bruiser 2.4, bombard 2.4, colossus 3.5, trooper 1.85).

Credits: 1,575 spent on 2026-11-12/13 (17 generations, 8 retopologies, 8 rigs, 22 Text2Motion clips).

Per-creature Text2Motion clips (5 s each; the phrases `tools/gen/build_cast.sh` matches on are the
opening words): a run and an attack for each of the seven creatures, plus a second, more forceful
attack for the Skitter ("Furious melee attack with big fast movements ...") and the Bruiser
("Heavy overhead hammer blow with big movements ..."), whose first takes were a near-static guard
pose. Lesson for prompts: name the body parts and the path they travel ("from high above the head
to the left hip"), ask for "big movements", and do not describe the creature. Re-exports with the
added clips are filed as `<name>_studio-2.glb`, `-3.glb` (`tools/gen/collect_rig.sh`).
Tripo's export sometimes reports nothing for a minute or does not deliver at all: wait for the
file, verify which model it is (vertex count / texture name), and repeat if it never arrives.

Trooper import: `tools/gen/make_character.sh player_trooper 1.85 --tag-weapon --rename "sneaks forward=crouch_walk,walks forward=walk,stands still=idle,stays crouched=crouch_idle,sprints forward=run"`.
Creatures also take `--trim "slash=1.0:2.6,death=0.6:3.0"` (the strike itself; the death from the stagger).

Static models (`<name>_hd.glb` here, the dense export) -> `assets/models/<name>.glb`:
`blender -b -P tools/blender/process_static.py -- <in> <out> --kind weapon --size <length>` with lengths
rifle 0.92, blaster 0.45, chaingun 1.05, cannon 1.00 (30k triangles, 2048 bakes), and
`--kind prop --size <height>` with barrel 0.95, crate 1.0, table 0.8 `--long x`, chair 0.9,
bed 0.6 `--long x --length 1.9` (12-16k triangles, 2048 bakes).
Check any result with `tools/blender/model_sheet.py` (four views with axes) or `clip_sheet.py`.
