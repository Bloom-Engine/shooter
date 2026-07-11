# External texture sources

All assets in this folder are **CC0 (public domain)** — no attribution
required, compatible with this repo's GPLv3 distribution. Provenance
recorded for hygiene:

| Folder | Asset | Source | License |
|---|---|---|---|
| `pine_bark/` | Pine Bark (diff / nor_gl / rough, 1K + 2K JPG) | https://polyhaven.com/a/pine_bark | CC0 |
| `forrest_ground_01/` | Forest Ground 01 (diff / nor_gl / rough, 2K JPG) | https://polyhaven.com/a/forrest_ground_01 | CC0 |
| `leafset/LeafSet004/` | Leaf Set 004 (Color + Opacity, 2K PNG) | https://ambientcg.com/view?id=LeafSet004 | CC0 |

Consumed by `tools/build-props.ts`:
- `pine_bark` 1K maps embed directly (as `image/jpeg`) into the tree GLB
  trunk material.
- `LeafSet004` Color+Opacity are composited into the leaf-card cutout
  texture (`externalLeafCard`) — real scanned leaves stamped into
  branch-cluster cards.
- `forrest_ground_01` is downloaded for the upcoming terrain splat pass
  (EN-014 texture arrays); not consumed yet.

If this folder is missing, `build-props.ts` silently falls back to the
procedural textures — a fresh checkout still builds.
