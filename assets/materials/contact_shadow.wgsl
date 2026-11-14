// Phase 3.6 - a soft dark disc under a character's feet. The sun shadow says where the light
// is; this says where the feet are, which is what stops a figure looking pasted onto the
// ground in shade, indoors and at dusk, where there is no sun shadow to read.
// Drawn on a thin unit slab; per-draw tint alpha is the strength.

#include "material_abi.wgsl"

struct VsOut {
  @invariant @builtin(position) clip_pos: vec4<f32>,
  @location(0) local_pos: vec3<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VsOut {
  var out: VsOut;
  out.clip_pos  = draw.mvp * vec4<f32>(in.position, 1.0);
  out.local_pos = in.position;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let r = length(in.local_pos.xz) / 0.5;
  let f = clamp(1.0 - r, 0.0, 1.0);
  let a = f * f * (3.0 - 2.0 * f) * draw.model_tint.a;
  return vec4<f32>(0.0, 0.0, 0.0, a);
}
