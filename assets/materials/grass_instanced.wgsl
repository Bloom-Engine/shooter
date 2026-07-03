// SH-021 instanced grass blade material. One canonical 6-vert
// cross-quad blade is drawn N times via the EN-001 instanced
// pipeline. Per-instance pos / rot_y / scale / tint arrive on
// vertex locations 7–10; wind comes from the global PerFrame.wind
// UBO (EN-013); cascade sun shadows from sample_sun_shadow
// (EN-016).
//
// Canonical mesh layout (model space):
//   v0 (-w, 0, 0) normal=+Z color.r=0  // root left, plane 1
//   v1 (+w, 0, 0) normal=+Z color.r=0  // root right, plane 1
//   v2 ( 0, h, 0) normal=+Z color.r=1  // tip, plane 1
//   v3 ( 0, 0,-w) normal=+X color.r=0  // root left, plane 2
//   v4 ( 0, 0,+w) normal=+X color.r=0  // root right, plane 2
//   v5 ( 0, h, 0) normal=+X color.r=1  // tip, plane 2
// 12 indices = 4 triangles (front + back of each plane). The cross
// shape covers any horizontal viewing angle even with backface
// culling on (the Opaque bucket rule for instanced pipelines).
//
// IMPORTANT: this file is the source of truth, but the engine's
// `compileMaterialInstanced` takes a WGSL string (not a path), so
// `main.ts` inlines an identical copy. Until a from-file variant
// lands they need to stay in sync.

#include "material_abi.wgsl"
#include "common/shadows.wgsl"
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
  @builtin(position) clip_pos:     vec4<f32>,
  @location(0)       world_pos:    vec3<f32>,
  @location(1)       world_normal: vec3<f32>,
  @location(2)       blade_tint:   vec3<f32>,
  @location(3)       tip_weight:   f32,
};

@vertex
fn vs_main(in: InstancedVertexInput) -> VsOut {
  var out: VsOut;

  // Scale + Y-axis rotate the canonical local position.
  let scaled = in.position * in.instance_scale;
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
  out.blade_tint   = grass.base.rgb * in.instance_tint.rgb;
  return out;
}

// Drifting cloud-shadow noise — same as terrain.wgsl / tree.wgsl
// so all ground materials share the same overcast pattern.
fn cloud_shadow(world_xz: vec2<f32>, t: f32) -> f32 {
  let p = world_xz * 0.025 + vec2<f32>(t * 0.5, t * 0.15);
  let i = floor(p);
  let f = fract(p);
  let h00 = fract(sin(dot(i,                       vec2<f32>(127.1, 311.7))) * 43758.5453);
  let h10 = fract(sin(dot(i + vec2<f32>(1.0, 0.0), vec2<f32>(127.1, 311.7))) * 43758.5453);
  let h01 = fract(sin(dot(i + vec2<f32>(0.0, 1.0), vec2<f32>(127.1, 311.7))) * 43758.5453);
  let h11 = fract(sin(dot(i + vec2<f32>(1.0, 1.0), vec2<f32>(127.1, 311.7))) * 43758.5453);
  let u  = f * f * (3.0 - 2.0 * f);
  let nz = mix(mix(h00, h10, u.x), mix(h01, h11, u.x), u.y);
  return mix(0.55, 1.0, smoothstep(0.35, 0.78, nz));
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
  let cloud  = cloud_shadow(in.world_pos.xz, frame.time);
  let shadow = sample_sun_shadow(in.world_pos);
  let direct = view.sun_color.rgb * direct_w * cloud * shadow;

  // Tip blades catch more sun (real grass: tips bleached, roots
  // shadowed).
  let albedo = in.blade_tint * (0.7 + 0.3 * in.tip_weight);

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
  out.velocity = vec2<f32>(0.0, 0.0);
  out.albedo   = vec4<f32>(albedo, 1.0);
  return out;
}
