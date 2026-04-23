# tools/

Offline scripts for converting Unvanquished source assets to Bloom
runtime formats, plus a few diagnostic utilities for debugging glTF
output. Run with `bun` from the shooter repo root (not via Perry —
these scripts use Node's `child_process` and `fs`).

## One-time setup

```sh
# Clone the Unvanquished asset packs we depend on.
git clone https://github.com/UnvanquishedAssets/UnvanquishedAssets vendor/unvanquished
cd vendor/unvanquished
git submodule update --init --depth 1 \
    pkg/res-players_src.dpkdir \
    pkg/res-weapons_src.dpkdir \
    pkg/res-ambient_src.dpkdir \
    pkg/tex-tech_src.dpkdir
cd ../..

# Required tools on $PATH:
#   - bun (for these scripts)
#   - ffmpeg (audio)
#   - sips (macOS built-in; resizes PNG textures)
```

## Converters

| Script                       | Purpose                                                    |
|------------------------------|------------------------------------------------------------|
| `convert-aliens-anim.ts`     | The main one. Parses all 5 alien IQEs and emits skinned + animated `.glb`s with 18-24 animations each. Applies Z-up → Y-up via X90 rotation on root joints + vertices. |
| `convert-arena.ts`           | Builds `arena.glb` programmatically — 6 textured quads (floor + 4 walls + ceiling), UV-tiled, using tex-tech panel textures. |
| `convert-aliens.ts`          | Older static-only version, superseded by `convert-aliens-anim.ts`. Kept as the simplest working reference for IQE → glTF with multi-primitive meshes. |

## Diagnostics

| Script                       | Purpose                                                    |
|------------------------------|------------------------------------------------------------|
| `validate-glb.ts <path>`     | Runs Khronos `gltf-validator` and prints errors / warnings. |
| `inspect-glb.ts <path>`      | Compact summary of scene roots, node count, mesh attributes, skin + animation counts. |
| `dump-nodes.ts <path>`       | One line per node with name + mesh/skin flags + children. Useful for comparing against a reference GLB. |
| `diag-skin.ts [<path>]`      | For each joint, prints `|rest_world · IBM − I|_∞`. A good IBM should be numerically close to identity (≲ 1e-7). |

## Typical regeneration flow

```sh
bun tools/convert-aliens-anim.ts
bun tools/convert-arena.ts
bun tools/validate-glb.ts assets/models/enemy_dretch.glb    # sanity check
```

Assets regenerated in `assets/models/` should be bit-close to the
committed ones (deterministic modulo float noise in the IBMs).
