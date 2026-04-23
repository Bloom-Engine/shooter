# Asset pipeline

All runtime art is generated offline by TypeScript scripts in `tools/`
from the Unvanquished source packs cloned under `vendor/unvanquished/`.
The converters produce glTF 2.0 `.glb` files that Bloom loads via
`loadModel` / `loadModelAnimation`. Audio is converted ad-hoc with
`ffmpeg`.

## Scripts

| Script                         | Inputs                              | Outputs                          |
|--------------------------------|-------------------------------------|----------------------------------|
| `convert-aliens-anim.ts`       | `level0.iqe … level4.iqe` + PNGs    | `enemy_dretch.glb` … `enemy_tyrant.glb` (skinned + animated) |
| `convert-arena.ts`             | 3 tex-tech `.png` (floor/wall/ceil) | `arena.glb` (6 textured quads, UV-tiled) |
| `convert-aliens.ts`            | same as anim version                | static T-pose GLBs (kept as reference) |
| `validate-glb.ts <path>`       | GLB                                  | glTF-validator issue report      |
| `inspect-glb.ts <path>`        | GLB                                  | human-readable node/mesh dump    |
| `diag-skin.ts <path>`          | GLB                                  | `|world·IBM − I|_∞` per joint    |

## IQE — Inter-Quake Export

Text format, line-oriented. Relevant tokens:

- `joint "<name>" <parent>` — hierarchy entries, one per joint, ordered.
  `<parent>` is `-1` for roots, else the index of an earlier joint.
- `pq tx ty tz qx qy qz qw` — translation + quaternion.
  - In the preamble (before any `animation`): joint rest pose, **parent-relative**.
  - Inside a `frame`: that joint's pose for that frame, parent-relative.
- `vp x y z`, `vn nx ny nz`, `vt u v` — vertex attributes, one per vertex
  in parallel streams. `vt` uses `(u, 1-v)` to match glTF's origin.
- `vb jointIdx0 weight0 [jointIdx1 weight1 …]` — up to N blend
  influences per vertex. IQE typically normalises these to sum to 1.
- `fm a b c` — triangle, three vertex indices.
- `mesh "<name>"` / `material "<path>"` — start a sub-mesh with a
  material. Multi-material models (marauder, tyrant) have two mesh
  blocks.
- `animation "<name>"` + `framerate <fps>` + `frame <n>` + 1 `pq` per
  joint per frame. Framerate varies per animation (60 for stand, 24
  for most others).

## Z-up → Y-up

IQE uses Quake's right-handed Z-up (positive Z is vertical). glTF is
right-handed Y-up. Naïve conversion of vertex + joint TRS independently
deforms the mesh at animation time because the keyframes remain in the
old basis. The converter does this instead:

1. **Vertices and normals**: apply `(x, y, z) → (x, z, -y)`.
   Determinant is +1 so triangle winding is preserved.
2. **Root joint rest pose** (`joints[j].parent < 0`): left-multiply the
   local TRS by X90 (−90° around X).
   - `t' = (x, z, -y)` (same as vertex)
   - `q' = X90_q · q_original` where `X90_q = (-√½, 0, 0, √½)`
3. **Root joint animation keyframes**: same X90 prefix applied to every
   frame's `pq`. Child joint keyframes pass through unchanged — their
   local transforms are already in the parent's (now Y-up) frame.
4. **IBMs**: plain inverse of the world rest matrix computed from the
   prefixed root + unmodified child locals.

At rest pose this gives `skin_matrix[j] = joint_world[j] · IBM[j] =
identity` for every joint, verified numerically by `diag-skin.ts`
(worst error ≈ 3.6e-8). Why not conjugate every joint (`X90 · local ·
X90⁻¹`)? Same math result in theory, but bloom's renderer applies a
Y-axis yaw rotation to each skin matrix separately
(`engine/native/shared/src/renderer/mod.rs:9851`). With full-hierarchy
conjugation, the per-joint Y-yaw composes incorrectly with the
conjugated joint rotations and the mesh shatters. Rooted X90 avoids
that: only the root joint's coordinate frame is rotated, and bloom's
yaw naturally stacks on top.

## glTF skeletal layout

`tools/convert-aliens-anim.ts` emits:

- One node per IQE joint with its local TRS from `pq`. Node indices
  `0..J-1` correspond to IQE joint indices `0..J-1`.
- One mesh node at index `J` with `mesh: 0, skin: 0`. No parent — glTF
  spec says skinned meshes must be root (`NODE_SKINNED_MESH_NON_ROOT`
  warning if not). Bloom's skeleton walker ignores parent transforms
  anyway.
- One skin with `joints: [0..J-1]` and `inverseBindMatrices` as a
  single MAT4 accessor. No explicit `skeleton` field — matches
  garden's Mixamo export.
- One animation per IQE `animation` block. Per animation, per joint,
  per frame: `translation` (VEC3) and `rotation` (VEC4) output
  accessors, all LINEAR interpolation, sharing a per-animation time
  input accessor.
- One material + texture + PNG image per `material` reference. Images
  are resized to 512×512 via macOS `sips` and embedded as PNG buffer
  views. Sampler uses `REPEAT` wrap so `convert-arena.ts` can tile
  UVs.
- JOINTS_0 is `UNSIGNED_SHORT VEC4`, WEIGHTS_0 is `FLOAT VEC4`.
  Weights truncated to top-4 by magnitude and renormalised so they
  sum to 1.0. Bloom reads `u16` joints and `f32` weights
  (`models.rs:1342`).

## Textures

The arena's 3 textures and the 5 alien diffuses are the only textures
we ship. All come from the tex-tech or res-players packs, all
downscaled to 512 px via `sips --resampleHeightWidthMax 512` before
embedding. Raw 4k textures would blow the GLBs up to ~16 MB each with
no visual improvement at the scale aliens are seen in game.

## Audio

Converted ad-hoc with `ffmpeg` — not scripted yet. The commands used:

```sh
V=vendor/unvanquished/pkg
ffmpeg -y -i "$V/res-weapons_src.dpkdir/sound/weapons/rocketpod/firing.flac"       -ac 1 -ar 44100                       assets/sounds/rifle_fire.wav
ffmpeg -y -i "$V/res-players_src.dpkdir/sound/player/human_bsuit/clank1.flac"     -ac 1 -ar 44100                       assets/sounds/dretch_attack.wav
ffmpeg -y -i "$V/res-players_src.dpkdir/sound/player/human_bsuit/step1.flac"      -ac 1 -ar 44100                       assets/sounds/pickup.wav
ffmpeg -y -i "$V/res-ambient_src.dpkdir/sound/ambient/drone1.flac"                -ac 2 -ar 44100 -c:a libvorbis -q 4   assets/sounds/ambient.ogg
```

These four SFX are repurposed from Unvanquished's human-battle-suit
and rocketpod samples — not a faithful sound design, just something
better than silence.

## Committed vs generated

Everything under `assets/` is committed so a fresh clone is playable
without the vendor setup. `vendor/`, `tools/.cache/`, and
`node_modules/` are gitignored. Regenerating assets produces
bit-identical outputs (modulo floating-point noise in the IBMs), so
the committed GLBs and the regenerated ones should stay in sync.
