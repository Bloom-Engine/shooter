# Engine fix: multiple skinned models per frame

**Fixed** in a local engine change to `native/shared/src/renderer/`
while debugging "player marine disappears ~3 seconds after death +
R-restart." Not yet upstreamed. Record here so the shooter's asset
and gameplay assumptions stay consistent with the engine version we
build against.

## Symptom

Start a round → player marine visible, animates correctly. Die,
press R to restart → marine still visible for a moment, then vanishes
the instant the first wave's dretches spawn (~2.5 s). The debug
beacon sphere stayed put where the capsule was, confirming the
player itself was still alive — only the skinned mesh was gone.

Additionally: the FIRST dretch to spawn appeared tinted with the
player's color even though it was passed a `WHITE` tint. This was
not a tint leak; it was the same underlying bug reading the wrong
joint data (see Root cause).

## Root cause

The renderer had **one** global uniform-buffer binding for joint
matrices:

```rust
// native/shared/src/renderer/mod.rs (before)
pub pending_joint_matrices: Option<Vec<[[f32; 4]; 4]>>,
// 128 × mat4 = 8192 bytes
let joint_data = vec![0u8; 8192];
```

```wgsl
// vs_main_3d (before)
struct JointMatrices { matrices: array<mat4x4<f32>, 128>, };
@group(3) @binding(0) var<uniform> joints: JointMatrices;
```

Every `updateModelAnimation(handle, ...)` call ended up in
`set_joint_matrices_scaled` which **overwrote** `pending_joint_matrices`.
At `end_frame`, `flush_joint_matrices` wrote whichever pose was last
set into the single 128-slot buffer. All skinned draws in that
frame then sampled that one pose.

Frame layout in the shooter (simplified):

```
updateModelAnimation(player)   // pending = player's 70 matrices
drawModel(player)              // queued — vertices reference joints 0..69
for each live enemy:
  updateModelAnimation(enemy)  // pending = OVERWRITTEN with enemy's ~30 matrices
  drawModel(enemy)             // queued — vertices reference joints 0..29
end_frame → flush: writes ENEMY's 30 matrices into slots 0..29;
            slots 30..127 zeroed.
```

Player vertices weighted to joints ≥ 30 then skinned against a zero
matrix → collapsed to the origin → mesh not visible from the TP
camera. Any player vertex weighted entirely to joints 0..29 happened
to follow the dretch's pose. The first dretch *looked* correctly
posed (its own joints landed at the right slots) but still inherited
distortion in edge cases because `set_joint_matrices_scaled` also
baked the caller's position+scale+rotation into each matrix — when
the "last pose" written didn't correspond to the draw's model
transform, the result read as wrongly-located or wrongly-tinted
geometry.

## Fix (local patch)

Give each skinned draw its own slice of a larger joint buffer and
offset that draw's vertex joint indices to point into its slice.

1. **Bigger joint buffer.** 128 slots → 1024 slots. `1024 × 64 = 65 536 B`
   is the default wgpu `max_uniform_buffer_binding_size`, so this
   fits without raising any device limits.

2. **Per-frame queue instead of single slot.** `pending_joint_matrices:
   Option<Vec<Mat>>` becomes `pending_skin_groups: Vec<Vec<Mat>>`
   plus a frame-lifetime accumulator `frame_joint_data: Vec<Mat>`.
   `set_joint_matrices` / `set_joint_matrices_scaled` append to the
   queue instead of overwriting.

3. **Consume-and-offset at submit time.** In `draw_model_mesh_tinted`
   (which is the code path for skinned models — `cache_model_if_static`
   bails for them), detect `mesh_skinned = any vertex has weight > 0`.
   If so, pop the front of `pending_skin_groups`, remember the current
   length of `frame_joint_data` as `joint_offset`, extend the
   accumulator with the popped matrices, and add `joint_offset` to
   every vertex's `joints.xyzw` on the way into `vertices_3d`.

4. **Flush the accumulator.** `flush_joint_matrices` writes the full
   `frame_joint_data` into the joint buffer (padded with zeros to
   1024 slots), then clears both the accumulator and any leftover
   pending groups.

The shader needs **no offset arithmetic** — vertex joint indices
now carry the offset baked in. Only the array size changed:
`array<mat4x4<f32>, 1024>`.

## FIFO pairing assumption

The fix relies on `updateModelAnimation(h)` and `drawModel(h)` being
called 1:1 in the same order, with no interleaving of a different
skinned handle between them. That matches every current caller
(garden + shooter). If a game ever calls `updateModelAnimation` twice
without a matching `drawModel`, the first staged pose becomes stale
and `flush_joint_matrices` drops it — benign but worth knowing.

If the FIFO assumption turns out to break in practice, the next
iteration would key staged poses by an explicit skin-handle (one
returned from `updateModelAnimation`) instead of position in the
queue.

## Capacity

1024 slots divided among a typical shooter frame:

- Player marine (`player_bsuit.glb`): 70 joints
- Each dretch (`enemy_dretch.glb` etc.): ~25–35 joints

Budget for one frame ≈ 70 + 10 × 30 = 370 slots. Comfortable
headroom. A game with more or heavier skinned characters could
raise the limit, but would need to check the adapter's
`max_uniform_buffer_binding_size` before going past 64 KB.

## Files touched

- `native/shared/src/renderer/mod.rs` — struct fields, buffer size,
  `draw_model_mesh_tinted`, `flush_joint_matrices`,
  `set_joint_matrices[_scaled]`.
- `native/shared/src/renderer/shaders.rs` — `JointMatrices` array
  size from 128 to 1024.

No FFI surface changes, no vertex layout changes, no new uniforms.

## Verifying

Easy repro with the shooter:

1. `SELFTEST = true` in `src/main.ts`.
2. The selftest block manually spawns one dretch at (-6, 0, -6) on
   frame 5 and screenshots at frame 30.
3. Before the fix the screenshot shows only the dretch, with the
   marine either invisible or visibly distorted. After the fix both
   characters render with their own correct skeletons.
