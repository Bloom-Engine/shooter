# External texture sources

Every **committed** asset in this folder is **CC0 (public domain)** — no
attribution required, compatible with this repo's GPLv3 distribution.
Provenance recorded for hygiene:

| Folder | Asset | Source | License |
|---|---|---|---|
| `pine_bark/` | Pine Bark (diff / nor_gl / rough, 1K + 2K JPG) | https://polyhaven.com/a/pine_bark | CC0 |
| `forrest_ground_01/` | Forest Ground 01 (diff / nor_gl / rough, 2K JPG) | https://polyhaven.com/a/forrest_ground_01 | CC0 |
| `leafset/LeafSet004/` | Leaf Set 004 (Color + Opacity, 2K PNG) | https://ambientcg.com/view?id=LeafSet004 | CC0 |
| `withered_grass/` | Withered Grass (diff / nor_gl, 2K JPG) | https://polyhaven.com/a/withered_grass | CC0 |
| `brown_mud_dry/` | Brown Mud Dry (diff / nor_gl, 2K JPG) | https://polyhaven.com/a/brown_mud_dry | CC0 |
| `cliff_side/` | Cliff Side (diff / nor_gl, 2K JPG) | https://polyhaven.com/a/cliff_side | CC0 |
| `concrete_wall_008/` | Concrete Wall 008 (diff / nor_gl / rough, 2K JPG) | https://polyhaven.com/a/concrete_wall_008 | CC0 |
| `concrete_floor_02/` | Concrete Floor 02 (diff / nor_gl / rough, 2K JPG) | https://polyhaven.com/a/concrete_floor_02 | CC0 |

Re-fetch any of these with `bun tools/fetch-external-textures.ts` (it skips
what is already on disk; `--force` re-downloads). The list of sets, their
resolutions and their real-world sizes live in that tool.

## ShareTextures leaf atlases — LOCAL ONLY, deliberately not committed

`robinia/RobiniaViscosa_2-4K/` and `platanus/PlatanusOccidentalis_1-2K/`
(the branch atlases `build-props.ts` stamps into the prop_tree2/prop_tree3
leaf cards) come from ShareTextures:

- https://www.sharetextures.com/ — search "Robinia Viscosa" (4K) and
  "Platanus Occidentalis" (2K) atlas packs.

**Their license is NOT plain CC0.** ShareTextures grants CC0 terms *only for
direct downloads from their site*, and separately forbids redistributing the
files "on other websites … or as part of collections" and any automated
downloading. That means:

- the raw packs **must not be committed** to this public repo (they were,
  from rounds 5–7 until 2026-07-16; untracked since) and are gitignored;
- `fetch-external-textures.ts` deliberately does **not** cover them —
  download them by hand from the pages above into the two folders;
- the **baked leaf-card textures inside `prop_tree2.glb`/`prop_tree3.glb`
  are fine to ship**: they are transformed derivatives used in the product
  (allowed for commercial work, no attribution required), not a
  redistribution of the packs.

Without the two folders on disk, `build-props.ts` falls back to the
`LeafSet004` compositor (CC0) and then to procedural cards — a fresh
checkout still rebuilds every prop.

## What consumes them

`tools/build-props.ts`:
- `pine_bark` 1K maps embed directly (as `image/jpeg`) into the tree GLB
  trunk material.
- `LeafSet004` Color+Opacity are composited into the leaf-card cutout
  texture (`externalLeafCard`) — real scanned leaves stamped into
  branch-cluster cards.

`tools/build-terrain-textures.ts` (SH-050) — the four splat layers.
**`forrest_ground_01` is finally consumed**; this file recorded it as
"downloaded for the upcoming terrain splat pass, not consumed yet" from the
day it landed until SH-050:
- layer 0 `grass_lush` ← `forrest_ground_01`
- layer 1 `grass_dry`  ← `withered_grass`
- layer 2 `dirt`       ← `brown_mud_dry` (the riverbank)
- layer 3 `rock`       ← `cliff_side`

`tools/build-building-textures.ts` (SH-050) — the building's two slices:
- slice 0 `wall` ← `concrete_wall_008`
- slice 1 `slab` ← `concrete_floor_02` (floors + roof terrace)

If this folder is missing, both terrain and building builders fall back to
their procedural / flat stand-ins and `build-props.ts` falls back to its
procedural textures — a fresh checkout still builds.

## REAL-WORLD SIZE IS LOAD-BEARING

Each set is a scan of a known physical extent (Poly Haven's `dimensions`), and
the shaders scale each layer by its own size so everything tiles at 1:1 —
`brown_mud_dry` is 1.3 m, `forrest_ground_01` is 2.0 m. **If you swap a source,
carry its size across**: `sizeM` in the builder AND the matching field in
`TERRAIN_PARAMS` (main.ts) / `BUILDING_PARAMS` (environment.ts). Get it wrong
and the new texture arrives at the old one's scale, which is precisely what
makes a photoscan read as fake.

## Two traps, both paid for once

1. **Names lie about colour.** `brown_mud` and `brown_mud_02` are *grey*. The
   riverbank brief was explicitly "natural brown"; picking by name would have
   shipped grey mud. Download the diffuse and look at it.
2. **Judge a texture at the tiling it will really get.** The walls first shipped
   `plaster_stone_wall_01`, which is lovely at 2x2 and reads as a stamped GRID of
   identical stones across a 24 x 8 m facade (10 x 4 tiles) — worse than the flat
   colour it replaced. Sparse distinctive features cannot survive repetition;
   uniform or architecturally-repeating ones (board-formed concrete) can.
