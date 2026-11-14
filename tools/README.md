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

The Unvanquished converters (`convert-aliens-anim.ts`, `convert-aliens.ts`,
`convert-weapons.ts`) were removed on 2026-11-14 together with the models they
produced. The cast, weapons and props are built by `tools/gen/` and
`tools/blender/` now; see "Asset pipeline" in `../CLAUDE.md`.

## Diagnostics

| Script                       | Purpose                                                    |
|------------------------------|------------------------------------------------------------|
| `validate-glb.ts <path>`     | Runs Khronos `gltf-validator` and prints errors / warnings. |
| `inspect-glb.ts <path>`      | Compact summary of scene roots, node count, mesh attributes, skin + animation counts. |
| `dump-nodes.ts <path>`       | One line per node with name + mesh/skin flags + children. Useful for comparing against a reference GLB. |
| `diag-skin.ts [<path>]`      | For each joint, prints `|rest_world · IBM − I|_∞`. A good IBM should be numerically close to identity (≲ 1e-7). |

## Typical check

```sh
bun tools/validate-glb.ts assets/models/enemy_skitter.glb
```
