// SH-021 instanced grass blade material. One canonical 6-vert
// cross-quad blade is drawn N times via the EN-001 instanced
// pipeline. Per-instance pos / rot_y / scale / tint arrive on
// vertex locations 7–10; wind comes from the global PerFrame.wind
// UBO (EN-013); cascade sun shadows from sample_sun_shadow
// (EN-016).
//
// Canonical mesh layout (model space) — Round-4: two-segment tapered
// blades with a bow (root pair → narrower mid pair → tip point, per
// crossed plane; 10 verts, 36 indices). See GRASS_BLADE_VERTS in
// main.ts for the authoritative table. color.r is the tip weight
// (0 root → 0.55 mid → 1 tip). The cross shape covers any horizontal
// viewing angle even with backface culling on (the Opaque bucket rule
// for instanced pipelines).
//
// This file is the SOLE source of truth. It used to be duplicated inline in
// main.ts as a binary-only fallback and the two drifted (the copy had to be
// hand-patched during EN-022), so SH-005 deleted the copy: environment.ts now
// does `compileMaterialInstanced(readFile('assets/materials/grass_instanced.wgsl'))`.
// There is nothing to keep in sync — edit here and relaunch.

#include "material_abi.wgsl"
#include "common/shadows.wgsl"
#include "common/clouds.wgsl"
#include "common/pbr.wgsl"

struct GrassParams {
  // xyz = canonical base hue (multiplied by per-instance tint),
  // w = transmission strength (sun behind blade boost).
  base: vec4<f32>,
};
@group(2) @binding(11) var<uniform> grass: GrassParams;

// Instanced vertex layout — extends the standard 0..6 attributes
// with EN-001's per-instance attributes at 7..10.
struct InstancedVertexInput {
  @location(0)  position:        vec3<f32>,
  @location(1)  normal:          vec3<f32>,
  @location(2)  color:           vec4<f32>,
  @location(3)  uv:              vec2<f32>,
  @location(4)  joints:          vec4<f32>,
  @location(5)  weights:         vec4<f32>,
  @location(6)  tangent:         vec4<f32>,
  @location(7)  instance_pos:    vec3<f32>,
  @location(8)  instance_rot_y:  f32,
  @location(9)  instance_scale:  f32,
  @location(10) instance_tint:   vec4<f32>,
};

struct VsOut {
  @invariant @builtin(position) clip_pos:     vec4<f32>,
  @location(0)       world_pos:    vec3<f32>,
  @location(1)       world_normal: vec3<f32>,
  @location(2)       blade_tint:   vec3<f32>,
  @location(3)       tip_weight:   f32,
  // EN-022 — clip positions for motion vectors.
  @location(4)       curr_clip:    vec4<f32>,
  @location(5)       prev_clip:    vec4<f32>,
  @location(6)       dist_fade:    f32,
};

@vertex
fn vs_main(in: InstancedVertexInput) -> VsOut {
  var out: VsOut;

  // Round-9 anti-grit: sub-pixel-thin distant blades scintillate through
  // the 0.5 render-scale TSR and read as grit. Widen blades with camera
  // distance so they stay >= ~1 internal pixel; dist_fade lets the
  // fragment stage flatten per-blade contrast at range too.
  //
  // SH-050 — ramp 1.6 -> 3.4, and it starts closer (9 m -> 6 m). This is the
  // other half of narrowing the base blade by 3.4x: the far field still needs
  // its ~1 internal pixel, and now the ONLY thing supplying it is this ramp
  // rather than a permanently fat mesh. Near blades keep their true width; the
  // widening is spent exactly where the aliasing is, which is what Round-9
  // wanted and paid for everywhere.
  //
  // The far end is not a cheat: past ~40 m a blade is sub-pixel, so a wider card
  // at lower contrast (see dist_fade in the fragment stage) is a better estimate
  // of the meadow's average colour than a needle that flickers between grass and
  // ground every frame.
  let d_cam = length(view.camera_pos.xz - in.instance_pos.xz);
  let fade  = smoothstep(6.0, 42.0, d_cam);
  let wide  = 1.0 + fade * 3.4;

  // Scale + Y-axis rotate the canonical local position.
  let scaled = vec3<f32>(in.position.x * wide, in.position.y, in.position.z * wide)
             * in.instance_scale;
  let cy = cos(in.instance_rot_y);
  let sy = sin(in.instance_rot_y);
  let rotated = vec3<f32>(
     cy * scaled.x + sy * scaled.z,
     scaled.y,
    -sy * scaled.x + cy * scaled.z,
  );

  // Wind sway. color.r encodes tip weight (0 at root → 1 at tip)
  // so only the upper part swings. Per-blade XZ phase + frame.time
  // desync neighbouring blades from a single sine.
  let tip   = in.color.r;
  let phase = dot(in.instance_pos.xz, frame.wind.xy * 0.6)
            + frame.time * frame.wind.w;
  let sway  = sin(phase) * frame.wind.z * tip;
  let displaced = rotated + vec3<f32>(frame.wind.x, 0.0, frame.wind.y) * sway;

  // Add per-instance world position.
  let world = displaced + in.instance_pos;

  // Rotate the normal too (uniform scale preserves direction).
  let n_rot = vec3<f32>(
     cy * in.normal.x + sy * in.normal.z,
     in.normal.y,
    -sy * in.normal.x + cy * in.normal.z,
  );

  out.world_pos    = world;
  out.world_normal = normalize(n_rot);
  out.clip_pos     = view.view_proj * vec4<f32>(world, 1.0);
  out.tip_weight   = tip;
  out.dist_fade    = fade;
  out.blade_tint   = grass.base.rgb * in.instance_tint.rgb;

  // EN-022 — previous-frame position: same sway one frame back
  // (PerFrame.delta_time), projected by the previous VP. Sub-pixel
  // blades finally carry real motion vectors so TAA's motion clamp
  // engages (the audit's thin-grass shimmer mechanism).
  let t_prev  = frame.time - frame.delta_time;
  let phase_p = dot(in.instance_pos.xz, frame.wind.xy * 0.6)
              + t_prev * frame.wind.w;
  let sway_p  = sin(phase_p) * frame.wind.z * tip;
  let world_p = rotated
              + vec3<f32>(frame.wind.x, 0.0, frame.wind.y) * sway_p
              + in.instance_pos;
  out.curr_clip = out.clip_pos;
  out.prev_clip = view.prev_view_proj * vec4<f32>(world_p, 1.0);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> OpaqueOut {
  let n = normalize(in.world_normal);
  let v = normalize(view.camera_pos.xyz - in.world_pos);
  let l = normalize(view.sun_dir.xyz);

  // Wrap-lambert (SH-011) so the back side doesn't go pure black.
  let wrap     = 0.5;
  let n_dot_l  = (dot(n, l) + wrap) / (1.0 + wrap);
  let direct_w = max(n_dot_l, 0.0);

  // Transmission term: sun behind the blade, viewed toward the
  // camera, gives the luminous backlit-leaf glow real grass shows.
  let back  = max(dot(-n, l), 0.0);
  let view_align = max(dot(v, -l), 0.0);
  let trans = pow(back, 2.0) * pow(view_align, 1.5);

  // Cloud + cascade sun shadow (EN-016).
  //
  // The cloud term now comes from the engine's shared deck (common/clouds.wgsl)
  // — the same field the sky pass draws its puffs from — instead of the private
  // fast-scrolling noise that used to live here. The old one darkened the grass
  // under clouds that were not there, while the terrain the grass grows out of
  // and the trees standing in it ignored the whole business.
  let cloud  = cloud_shadow_at(in.world_pos, l, frame.wind.xy, frame.time, frame.cloud);
  let shadow = sample_sun_shadow(in.world_pos);
  let direct = view.sun_color.rgb * direct_w * cloud * shadow;

  // Round-4 — strong root→tip gradient (real grass: roots sit in
  // shadowed olive-dark, tips are sun-bleached toward straw). The
  // squared tip weight keeps the lower half dark and lets the top
  // quarter bloom.
  // Round-9 anti-grit: at range that gradient plus per-blade tint jitter
  // alias into speckle. Flatten the gradient and converge on one meadow
  // tone as dist_fade rises — near grass keeps the full contrast, the
  // far field reads as a soft carpet.
  let tip_soft = mix(in.tip_weight * in.tip_weight, 0.42, in.dist_fade * 0.85);
  let root_col = in.blade_tint * vec3<f32>(0.42, 0.50, 0.38);
  let tip_col  = in.blade_tint * vec3<f32>(1.12, 1.08, 0.72);
  var albedo   = mix(root_col, tip_col, tip_soft);
  let meadow   = grass.base.rgb * vec3<f32>(0.78, 0.90, 0.55);
  albedo       = mix(albedo, meadow, in.dist_fade * 0.55);

  // Transmission tint — slightly warmer than albedo for the
  // luminous-leaf look. Strength is grass.base.w.
  let trans_color = albedo * vec3<f32>(1.10, 1.20, 0.85) * grass.base.w;

  // Sky-fill: HDR irradiance sampled straight up — thin blades respond to
  // the sky dome, and a fixed direction avoids per-blade ambient flicker
  // from the ±normal card sides. Small flat floor on top.
  let fill = sample_env_diffuse(vec3<f32>(0.0, 1.0, 0.0)) + view.ambient.rgb * 0.20;
  let lit = albedo * (fill + direct)
          + trans  * trans_color * cloud;

  var out: OpaqueOut;
  out.hdr      = vec4<f32>(lit, 1.0);
  out.material = vec2<f32>(0.0, 0.92);
  // EN-022 — real motion vectors, including per-blade sway.
  out.velocity = abi_motion_vector(in.curr_clip, in.prev_clip);
  out.albedo   = vec4<f32>(albedo, 1.0);
  return out;
}
