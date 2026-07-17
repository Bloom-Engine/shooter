// Muzzle flash material — first consumer of Bucket::Additive.
// Drawn on a 1×1×1 cube; the fragment uses local-space distance from
// the cube's centre to fake a volumetric warm flash. Additive blend
// means the result is added on top of the HDR scene — anywhere the
// flash overlaps gets brighter, never darker.
//
// Per-draw tint alpha carries the flash intensity (driven by
// `muzzleFlashT / MUZZLE_FLASH_DUR` from the shooter game loop), so a
// single quick spike fades over ~0.08 s without per-frame uniform
// uploads.

#include "material_abi.wgsl"

struct VsOut {
  @invariant @builtin(position) clip_pos: vec4<f32>,
  @location(0) local_pos: vec3<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VsOut {
  var out: VsOut;
  out.clip_pos  = draw.mvp * vec4<f32>(in.position, 1.0);
  out.local_pos = in.position;  // for `genMeshCube(1, 1, 1)` this is in [-0.5, 0.5]
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  // Distance from cube centre, normalised so the unit-edge cube's
  // corners sit at ~1.0. 0.6 cutoff carves a ball out of the cube.
  let r = length(in.local_pos) / 0.5;
  let falloff = clamp(1.0 - r, 0.0, 1.0);
  let f2 = falloff * falloff;

  // Bright yellow-white core, warm-orange halo. Mix on falloff² so
  // the core stays small relative to the spread.
  let core = vec3<f32>(1.0, 0.95, 0.7);
  let halo = vec3<f32>(1.0, 0.45, 0.10);
  let tint = mix(halo, core, f2);

  // Per-draw alpha is the flash intensity (set by drawMeshWithMaterial's
  // tint.a). Multiply by ~6 so the additive contribution is HDR-bright
  // and tonemap turns it into a real-looking spike.
  let intensity = draw.model_tint.a * 6.0;
  return vec4<f32>(tint * f2 * intensity, 1.0);
}
