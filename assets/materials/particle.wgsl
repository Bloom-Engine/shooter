// EN-026 / SH-033 — instanced particle billboards.
//
// One draw call per particle system. The engine simulates and writes the
// instance buffer; this shader only has to turn each instance into a
// camera-facing quad and sample the atlas.
//
// Per-instance inputs (see engine src/vfx):
//   @location(7)  instance_pos    world position
//   @location(8)  instance_rot_y  billboard roll, radians
//   @location(9)  instance_scale  size in metres
//   @location(10) instance_tint   rgba, alpha already faded by the sim
//   @location(11) instance_extra  (age01, atlas frame, velocity-stretch metres)
//
// Additive bucket: the result is ADDED to the HDR scene. That is right for
// smoke/sparks/flash/blood in a bright outdoor scene — it never darkens, and
// it needs no back-to-front sort, which is what makes thousands of quads cheap.

#include "material_abi.wgsl"

struct ParticleParams {
  // x = texture-array layer, y = additive-intensity multiplier (NEGATIVE: an alpha-blended
  // pool, and its brightness is the absolute value),
  // z = soft-fade distance in metres, w = flipbook grid (0 = one image; 4 = a 4 x 4 sheet
  // played once over the particle's life, neighbouring frames blended).
  //
  // The layer is per-MATERIAL, not per-instance: each particle system draws
  // with its own look anyway, so one material per look costs one draw call and
  // saves the per-instance frame plumbing. instance_extra.y stays free for
  // flipbook animation within a layer if a future effect wants it.
  cfg: vec4<f32>,
};
@group(2) @binding(11) var<uniform> pp: ParticleParams;

struct InstancedVertexInput {
  @location(0)  position:       vec3<f32>,
  @location(1)  normal:         vec3<f32>,
  @location(2)  color:          vec4<f32>,
  @location(3)  uv:             vec2<f32>,
  @location(4)  joints:         vec4<f32>,
  @location(5)  weights:        vec4<f32>,
  @location(6)  tangent:        vec4<f32>,
  @location(7)  instance_pos:   vec3<f32>,
  @location(8)  instance_rot_y: f32,
  @location(9)  instance_scale: f32,
  @location(10) instance_tint:  vec4<f32>,
  @location(11) instance_extra: vec3<f32>,
};

struct VsOut {
  @invariant @builtin(position) clip_pos: vec4<f32>,
  @location(0)       uv:       vec2<f32>,
  @location(1)       tint:     vec4<f32>,
  @location(2)       view_z:   f32,
  @location(3)       screen_uv: vec2<f32>,
  @location(4)       age:      f32,
};

@vertex
fn vs_main(in: InstancedVertexInput) -> VsOut {
  var out: VsOut;

  // Camera basis, pulled straight out of the view matrix rows. Billboarding
  // against the *view* (not the camera-to-particle vector) keeps a burst of
  // particles co-planar, which is what stops them shearing against each other
  // as the camera turns.
  let right = vec3<f32>(view.view[0][0], view.view[1][0], view.view[2][0]);
  let up    = vec3<f32>(view.view[0][1], view.view[1][1], view.view[2][1]);

  // Unit quad in [-0.5, 0.5]; roll it, then scale.
  var corner = in.position.xy;
  let c = cos(in.instance_rot_y);
  let s = sin(in.instance_rot_y);
  corner = vec2<f32>(c * corner.x - s * corner.y, s * corner.x + c * corner.y);

  var offset = (right * corner.x + up * corner.y) * in.instance_scale;

  // Velocity stretch: extra.z is how far the particle travels in the stretch
  // window, so elongating along the *view-projected* velocity turns a round
  // spark into a streak without needing a separate mesh. Zero for everything
  // that isn't a tracer, so this is free.
  let stretch = in.instance_extra.z;
  if (stretch > 0.001) {
    // Rebuild an approximate velocity direction from the roll — the sim packs
    // no direction, but a stretched particle only needs to be long along its
    // own travel, and roll is set from it at spawn.
    let dir = normalize(right * cos(in.instance_rot_y) + up * sin(in.instance_rot_y));
    offset = offset + dir * corner.y * stretch;
  }

  let world = in.instance_pos + offset;
  let clip  = view.view_proj * vec4<f32>(world, 1.0);

  out.clip_pos = clip;
  out.view_z   = clip.w;
  out.screen_uv = clip.xy / clip.w * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
  out.uv   = in.uv;
  out.tint = in.instance_tint;
  out.age  = in.instance_extra.x;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  // Texture ARRAY, not a 2D texture: the engine's per-material bind group
  // hardwires a white stub into the plain 2D slots, so binding 14 (the albedo
  // array) is the only route a custom material has to its own art.
  var tex = textureSample(albedo_array, albedo_array_samp, in.uv, i32(pp.cfg.x));
  // Flipbook (plan 5.6): the sheet is grid x grid frames, read left to right, top to bottom.
  // Both samples are taken outside any branch on a varying (derivatives stay defined).
  let grid = max(pp.cfg.w, 1.0);
  let frames = grid * grid;
  let fpos = clamp(in.age, 0.0, 0.999) * (frames - 1.0);
  let f0 = floor(fpos);
  let f1 = min(f0 + 1.0, frames - 1.0);
  let uv0 = (vec2<f32>(f0 % grid, floor(f0 / grid)) + in.uv) / grid;
  let uv1 = (vec2<f32>(f1 % grid, floor(f1 / grid)) + in.uv) / grid;
  let s0 = textureSampleLevel(albedo_array, albedo_array_samp, uv0, i32(pp.cfg.x), 0.0);
  let s1 = textureSampleLevel(albedo_array, albedo_array_samp, uv1, i32(pp.cfg.x), 0.0);
  if (pp.cfg.w > 1.5) { tex = mix(s0, s1, fpos - f0); }
  var rgb = tex.rgb * in.tint.rgb;
  var a   = tex.a * in.tint.a;

  // Soft particles. A billboard intersecting the ground otherwise shows a hard
  // straight seam where the quad cuts the geometry — the single biggest tell
  // that a "puff" is a flat card. Fade out as the quad approaches whatever is
  // behind it.
  //
  // Read the depth the way water.wgsl does: by the fragment's own pixel, linearised with the
  // projection's two terms. (Until 2026-11-15 this rebuilt a screen UV from the clip position
  // and un-projected it through inv_proj; that came out in front of every particle, `soft`
  // was 0 everywhere and NO particle in the game was visible: no muzzle flash, smoke, blood
  // or sparks. Nothing reported it, because the pools were full and the draws were issued.)
  let sd      = textureLoad(scene_depth_tex, vec2<i32>(in.clip_pos.xy), 0);
  let proj_a  = view.proj[2][2];
  let proj_b  = view.proj[3][2];
  let scene_m = proj_b / (sd + proj_a);              // metres in front of the eye
  let part_m  = proj_b / (in.clip_pos.z + proj_a);
  let fade_d  = max(pp.cfg.z, 0.001);
  let soft    = clamp((scene_m - part_m) / fade_d, 0.0, 1.0);
  a = a * soft;

  // Additive: premultiply by alpha ourselves, since there is no dst alpha to
  // blend against. Intensity > 1 pushes into HDR so bloom picks up the hot
  // cores (sparks, muzzle flash) instead of clipping flat white.
  // cfg.y < 0 marks a pool compiled into the ALPHA-BLENDED bucket (dust, dark smoke, chips:
  // things that must be able to darken what is behind them, which adding light cannot do).
  // The blend there is src-alpha / one-minus-src-alpha, so the colour goes out unmultiplied.
  if (pp.cfg.y < 0.0) {
    return vec4<f32>(rgb * (-pp.cfg.y), a);
  }
  return vec4<f32>(rgb * a * pp.cfg.y, a);
}
