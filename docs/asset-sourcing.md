# Where better models can actually come from

Researched 2026-07-13, after D3 ("the licence does not matter — this is a demo that
should be as good as it can possibly get").

## The constraint that decides everything, and it is not the one D3 answered

D3 freed us on *licence permissiveness*. It did **not** free us on
**redistribution**, and that is the binding constraint:

> **Our assets are committed to a git repo. That is redistributing them as
> standalone files.**

- **Mixamo** — the best free animation library in existence, and the obvious first
  answer — permits use in projects but **forbids redistributing the raw character
  and animation files as standalone assets**. A public repo full of `.glb` is
  exactly that. You also cannot sub-license Adobe's assets under GPLv3.
- So Mixamo is usable as a **tool** (rig/retarget locally, keep outputs out of the
  tree or fetch at build time), never as **repo content**.
- Every **CC0** source is free of this problem. CC-BY is fine too (attribution).

Anything we commit must be CC0, CC-BY, CC-BY-SA, or GPL. That is the filter.

## The finding worth sitting with

**The Unvanquished aliens are hard to beat for free.**

Five *distinct, non-humanoid* creatures, each with a complete game animation set,
at realistic fidelity, is precisely the asset class that essentially **does not
exist for free**. The free ecosystem is rich in:

- humanoid **animation libraries** (Mixamo, Quaternius UAL2, KayKit), and
- **stylized low-poly** monsters (Quaternius, KayKit, Kenney),

and thin in exactly what we already have. A PBR/texture uplift of the existing
alien meshes plus a genuinely good new **player character** may buy more visual
improvement per hour than any wholesale replacement.

## Sources that are real, current, and usable

| Source | Licence | Animated characters? | Format | How you get it |
|---|---|---|---|---|
| **Sketchfab** | per-model: CC0 / CC-BY / CC-BY-SA | **Yes — the only free source of *realistic* rigged creatures.** Quality varies; cherry-pick. | **glTF/GLB direct** (the Download API serves glTF/GLB/USDZ, not the original FBX) | Web download, or **Download API with OAuth** — filterable by licence + `animated`. Scriptable. |
| **Quaternius** | **CC0** | **Ultimate Monsters — 50 fully animated monsters.** Plus **Universal Animation Library 2** (130+ humanoid anims on a universal rig). | **glTF** | Direct download, no account. |
| **KayKit** (Kay Lousberg) | **CC0** | **161 humanoid animations**; Skeletons pack has 90+. Best free non-Mixamo humanoid anim set. | **glTF + FBX** | itch.io, no account. |
| **Anything World** | you declare `cc0`/`ccby`/`mit` on output | REST API that **auto-rigs AND animates an arbitrary mesh you upload — including non-humanoids.** | glTF | API, free monthly credits. |
| **AccuRig** (Reallusion) | free | Auto-rigger, **runs offline** — the clean alternative to uploading to Adobe. | FBX/USD | Free account to export. |
| **MetaHuman** | **licence changed mid-2025 — no longer Unreal-only**; free under $1M rev | Photoreal humans; **best-in-class player character, free.** Ships **no gameplay animations** — retarget onto its skeleton. | FBX → **needs a glTF conversion pass** | Web/Blender tooling. |
| **Mixamo** | **use yes, REDISTRIBUTION no** | ~100 characters + thousands of anims. Its "monsters" (Mutant, Warrok) are on the **humanoid rig**, so the whole library applies to them. | **FBX/Collada only — no glTF** | Manual web UI. **No API.** |

**Sketchfab has archive risk.** The Store closed and moved to Epic's Fab, and
**CC0 / CC-BY-SA / NC / ND models cannot migrate**. If we pick models there,
**download and commit them immediately.**

## Checked and rejected

- **Poly Haven** — CC0, has an API, but **static props/textures/HDRIs only. No
  characters, no rigs.** Excellent for environment; irrelevant here.
- **Kenney** — CC0, glTF, but ~3 animations per character. Below our bar.
- **Blender Studio** (Sprite Fright, Charge, Agent 327) — CC-BY, beautiful, and
  **not game-ready**: film rigs in `.blend`, no idle/walk/run/attack/death clips,
  no game topology. We would be authoring animation from scratch.
- **Other GPL game sets** (Xonotic, Red Eclipse, 0 A.D., SuperTuxKart) — all
  **lower quality than the Unvanquished assets we already ship.** Not an upgrade.
- **Ready Player Me** — **dead.** Domain no longer resolves; sunset Jan 2026.
- **Epic Paragon** — AAA heroes with full anim sets, free, *tempting* — but they
  are Epic first-party content historically labelled Unreal-only. **Could not
  confirm** non-Unreal use is permitted. Do not build on it without written
  clarification.
- **OpenGameArt** — CC0/CC-BY/GPL mix, a few gems, but rigs are often broken or
  unweighted. Cherry-pick only.

## Unverified — do not act on these without checking

- Whether **Paragon** is usable outside Unreal.
- **Meshy's** exact free-tier commercial terms (its free tier is reportedly
  non-commercial; this came from comparison articles, not its own pricing page).
- **Truebones** creature-mocap licence. (And be sceptical anyway: creature mocap is
  near-useless unless the monster's skeleton matches theirs.)
- The practical fidelity of a **MetaHuman → glTF** export — specifically that
  strand-based groom hair does **not** survive it; you would need hair cards.
