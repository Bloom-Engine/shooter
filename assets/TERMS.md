# Terms the generated assets were made under

Written 2026-11-14 (plan Phase 7.5). `LICENSE.md` says what ships and where it came from; this
file says which provider terms each kind of generated asset depends on, and what has to be true
for the game to be sold. It is a record, not legal advice, and the provider pages are summaries
of terms that change: read the terms themselves before a paid release.

**Every row below turns on one fact this repository cannot prove: which plan the account was
on when the asset was generated.** Ralph has to confirm the four "plan at the time" entries and
keep a receipt or screenshot for each; once confirmed, write the plan and date into the table.

| What | Made with | When | Rule that matters | Plan at the time |
|---|---|---|---|---|
| Characters, weapons, furniture (`models/enemy_*`, `player_trooper`, `weapon_*`, `prop_{barrel,crate,table,chair,bed}`) | Tripo Studio | November 2026 | Paid plans: private models, commercial use. Free plan: models are public, CC BY 4.0, and Tripo's terms (5.2.1) keep the rights. Rights follow the plan active at generation. | TO CONFIRM (the account held about 16,000 credits on 2026-11-14, which the free plan does not grant) |
| Creature, player and impact sounds (`tools/gen/sfx.py`) | ElevenLabs sound effects API | 2026 | Paid plans include a commercial licence. The free plan is non-commercial only, and attribution does not change that. Generated effects may not be resold as a sound library. | Starter (paid) on 2026-11-15, read from the account API, which covers the 87 files of the fifth pass. TO CONFIRM for the earlier passes (July to 14 November 2026). |
| Music (six tracks, `music/SUNO-PROMPTS.md`) | Suno | 2026-07-13 | Songs made while on Pro or Premier carry commercial use rights, kept after the subscription ends. Songs made on the free plan are non-commercial, credited to Suno, and a later subscription does not upgrade them. | TO CONFIRM |
| Concept images (`art/style/`), leaf, plant, smoke and decal source images | OpenAI image generation through the Codex CLI | November 2026 | OpenAI's terms assign its rights in the output to the user; commercial use is allowed within the usage policies. | TO CONFIRM (account type) |

Sources read on 2026-11-14:
[Tripo, commercial use](https://www.tripo3d.ai/help/privacy-policy/can-i-use-models-commercially),
[Tripo, how to use models commercially](https://www.tripo3d.ai/help/privacy-policy/how-to-use-tripo-models-commercially),
[ElevenLabs, publishing generated content](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform/llms.txt),
[Suno, ownership](https://help.suno.com/en/articles/2416769),
[OpenAI terms of use](https://openai.com/policies/terms-of-use/).
Tripo's two help pages do not agree with each other on free-plan output; the stricter reading is
the one recorded above.

## Not generated

- **Terrain, building and bark textures**: Poly Haven and ambientCG scans, CC0. No conditions.
  List: `textures/external/SOURCES.md`.
- **Some sounds**: Sonniss GDC 2024 bundle, royalty-free for use in a game, no attribution
  required; the files may not be redistributed as sounds. This repository is public and holds
  them as game assets: check that the bundle's licence allows that before adding more.
  List: `sounds/SOURCES.md`.
- **Sky** (`env/outdoor*.hdr`): copied from the Bloom engine's Bistro example, and its origin
  is NOT settled. That example's README says the Bistro content is CC BY 4.0 (attribution
  required); the folder the file sits in carries an MIT licence from NVIDIA GameWorks. Neither
  is credited in the game. Find out which applies and add the credit line, or replace the file
  with a Poly Haven sky (CC0), before a release.
- **Font** (`fonts/Rajdhani-SemiBold.ttf`): SIL Open Font License, `fonts/OFL.txt`; credited in the game.

## What follows from generated origin

- **Copyright.** Where a work has no human author, most jurisdictions (the US Copyright Office
  explicitly) grant no copyright. The provider can hand over its own rights; it cannot create a
  right the law withholds. Assume the generated models, sounds and music can be copied by
  others, and that the protectable parts of this game are its code, its design and the
  human-made arrangement of those assets.
- **The MIT licence on this repository** covers the generated assets only as far as the user's
  rights in them go. If any "plan at the time" above turns out to be a free plan, that asset
  must be regenerated on a paid plan or removed before the game is sold, and the MIT claim over
  it in `LICENSE.md` is wrong until then.
- **Store forms.** Apple and Google do not currently ask whether assets are generated. Steam
  does (the content survey has an AI disclosure section): the answer is yes, pre-generated, for
  models, sounds, music and concept art.
