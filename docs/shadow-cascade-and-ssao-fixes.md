# Shadow "moving dark patch" + SSAO flicker — post-mortem & fixes

_2026-07-08/09. Long investigation into a user-reported "flickering dark
pixelated thing that moves when the camera moves." It turned out to be **three
independent bugs** stacked on top of each other. All three are fixed in the
engine; this doc records the symptoms, the false trails, the real root causes,
and the fixes so we never re-derive them._

The single most important finding: **the big "moving shadow" was NOT ambient
occlusion or GI or terrain acne — it was a collapsed shadow-cascade fit.** See
Fix 3 (the deep one).

---

## How it was diagnosed (tooling)

Two things made this tractable; keep them:

- **F5–F8 live toggles** (`src/main.ts`): F5 SSGI, F6 SSAO, F7 SSR, F8 shadows,
  with a yellow status bar top-left. Toggling one pass at a time isolated each
  symptom to its owning pass in a single run.
- **Native F12 screenshot** (`engine .../windows/src/lib.rs`) → writes
  `screenshot_<ms>.png` in the working dir. This is the reliable capture path on
  Windows (the Perry-side `takeScreenshot` FFI is unreliable). Screenshots were
  read back directly to diagnose.
- **Shader debug visualisations**: temporarily overriding `terrain.wgsl`'s
  `out.hdr` to tint by the sun-shadow term / by which clip coordinate was out of
  the cascade frustum / by `|lndc.xy|` magnitude. `terrain.wgsl` is
  `compileMaterialFromFile` (runtime-loaded), so these needed **no rebuild** —
  just re-run. This is how the collapsed cascade was finally caught.
- **stderr probe**: an `eprintln!` in `compute_cascade_vps` printed the fitted
  radius / corners. Engine stderr shows in the launching terminal (same place as
  the `bloom: F12 ...` lines), so the user could paste values back.

---

## Fix 1 — SSAO **contact shadows** were the sharp pixelated flicker

**Symptom.** A dark, "very pixelated" flicker over the grass, present even with a
completely static camera. Turning F6 (SSAO) off removed it.

**Root cause.** SSAO output is two terms multiplied: a soft *horizon AO* (the `R`
channel — blurred + temporally accumulated) and a separate **contact shadow**
(the `G` channel — a 12-step screen-space ray-march toward the sun, **half-res,
unblurred, with NO temporal accumulation**, and NOT scaled by `ssao_radius`/
`ssao_strength`). Over the dense wind-animated instanced grass, that march hits
swaying blades slightly differently every frame → a sharp, half-res, flickering
dark layer that TAA can't damp (AO is applied *after* TAA in the composite pass).

This is also why the first tuning attempts did nothing: radius/strength only
touch the `R` channel; the flicker lived entirely in `G`.

**Fix.** Gate the contact-shadow march off:
`const CONTACT_SHADOWS_ENABLED: bool = false;` in
`engine/native/shared/src/renderer/shaders/ao.rs` (the `if (n_dot_l > 0.1)`
block). Contact shadows are a minor polish effect and are fundamentally
ill-suited to dense animated foliage; re-enable only behind foliage-aware
gating.

---

## Fix 2 — SSAO **radius/strength** over-darkened the grass

**Symptom.** A broad, blotchy dark wash over the whole grass field (separate from
the sharp flicker of Fix 1).

**Root cause.** `ssao_radius` **default is `2.0` in WORLD-SPACE METRES** (the
field/​setter docs wrongly said "UV units ~0.006" — stale from a pre-refactor),
and the GTAO shader clamped the *screen* radius up to **0.25 of the viewport (a
quarter of the screen)**. Over 20k instanced grass blades that pulls thousands of
blades into every AO sample.

**Fix** (`ao.rs` + `renderer/mod.rs`):
- Screen-radius clamp `0.25 → 0.05` (a local contact term, not a scene-wide wash).
- Default `ssao_strength` `1.0 → 0.7`.
- Corrected the misleading "UV units" docs to "world-space metres".

---

## Fix 3 — The "moving dark patch" was a **collapsed shadow-cascade fit** (the deep one)

**Symptom.** A large, soft, shapeless **dark region on the terrain that moved
_disproportionately_ to the camera** — a small camera move swung it wildly. Only
F8 (shadows) removed it. It was NOT stuck to any caster; it slid across the
ground.

**False trails (do not repeat):**
- Not SSGI (F5 off didn't remove it).
- Not the player/enemy casting (disabling the immediate + cached-model shadow
  casters didn't remove it).
- Not a caster/receiver cascade-VP mismatch (`refresh_shadow_uniforms`'
  `ShadowTail` layout matches `PerViewUniforms`' tail byte-for-byte).
- Not vertex displacement (terrain `vs_main` is plain `model * position`).
- Not "terrain shadow acne" — it *looked* like acne (needed an absurd ~1–2 m of
  bias to clear), but bias is a symptom, not the cause. Capping the pancake
  Z-range made it **worse**. This theory was wrong.

**Root cause (proven with the debug viz + stderr probe).** The near shadow
cascade's ortho covered only **~0.12 m** (should be ~10–22 m), so terrain a few
metres from the camera projected *outside its own cascade frustum* and
self-shadowed; because the cascade follows the camera, that false shadow swung
around as you moved.

Why the fit collapsed: `compute_cascade_vps` reconstructed each cascade's frustum
slice by building a "sub-projection", **inverting `sub_proj * camera_view`**, and
unprojecting the 8 NDC clip-cube corners. But `mat4_perspective` (`util.rs`) uses
the **OpenGL `[-1,1]` NDC-z convention** (`[2][2] = (far+near)/(near-far)`),
rendered into wgpu's `[0,1]` depth. Unprojecting that projection's NDC corners
handed the **near plane a negative homogeneous `w`** (`rawH0 = […, +30, −30]`
while the far corners had `+w`). Opposite-sign `w` means every corner divides
down onto the `z ≈ −1` plane → the 8 "world corners" bunch within ~0.12 m → the
bounding sphere (hence the ortho half-extent) collapses. Measured live:
`radius = 0.125` (varying), corners all `≈ (0.01, 0.01, −0.98)`.

**Fix** (`engine/native/shared/src/shadows.rs`, `compute_cascade_vps`). **Stop
inverting the projection.** Compute the frustum-slice corners **directly in view
space** from the FOV, then transform to world with the *affine* view inverse
(well-conditioned, convention-proof):

```rust
let inv_view      = mat4_invert(camera_view);      // affine → safe to invert
let half_w_per_d  = 1.0 / camera_proj[0][0];       // tan(fovy/2) * aspect
let half_h_per_d  = 1.0 / camera_proj[1][1];       // tan(fovy/2)
for &d in [c_near, c_far].iter() {
    let (hw, hh) = (d * half_w_per_d, d * half_h_per_d);
    for &(sx, sy) in [(-1,-1),(1,-1),(-1,1),(1,1)] {
        let vp = [sx*hw, sy*hh, -d, 1.0];          // view looks down -Z
        world_corners[..] = (inv_view * vp).xyz;   // rigid, w == 1
    }
}
```

Result: `radius` went `0.12 → ~22 m`, the ground is inside its cascades, and the
moving dark patch is gone. This is also convention-independent — it does not care
whether the projection is `[-1,1]` or `[0,1]`.

**Latent related bug (not the cause, but real):** `mat4_perspective` using the
OpenGL `[-1,1]` z-mapping while rendering into wgpu `[0,1]` wastes half the depth
range (near geometry below the harmonic-mean depth is clipped) and gives a
non-standard precision distribution. Left as-is for now (the camera renders fine
and the cascade fit no longer depends on it), but worth converting to a proper
`[0,1]` perspective eventually — it would need matching changes anywhere
`inv_proj` is used for reconstruction.

---

## Files touched (final)

- `engine/native/shared/src/shadows.rs` — cascade-fit rewrite (Fix 3).
- `engine/native/shared/src/renderer/shaders/ao.rs` — contact-shadow gate (Fix 1)
  + screen-radius clamp `0.25 → 0.05` (Fix 2).
- `engine/native/shared/src/renderer/mod.rs` — `ssao_strength` default `→ 0.7`
  and corrected `ssao_radius` docs (Fix 2).
- `src/main.ts` — F5–F8 debug toggle bar + status line (kept, intentional).
