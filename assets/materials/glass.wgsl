// Phase 10 glass material — Schlick Fresnel + sky reflection + faint
// scene-colour refraction. Fresnel-driven alpha so face-on is mostly
// transparent and grazing angles go near-opaque from the sky reflection.
//
// Loaded via compileMaterialFromFile('refractive') so it participates
// in the Phase 6 hot-reload watcher.

#include "material_abi.wgsl"
#include "common/pbr.wgsl"

struct GlassVsOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) world_pos:    vec3<f32>,
  @location(1) world_normal: vec3<f32>,
  @location(2) screen_uv:    vec2<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> GlassVsOut {
  var out: GlassVsOut;
  let world  = draw.model * vec4<f32>(in.position, 1.0);
  out.world_pos    = world.xyz;
  out.world_normal = normalize((draw.model * vec4<f32>(in.normal, 0.0)).xyz);
  out.clip_pos     = view.view_proj * world;
  out.screen_uv    = out.clip_pos.xy / out.clip_pos.w * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
  return out;
}

@fragment
fn fs_main(in: GlassVsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.world_normal);
  let v = normalize(view.camera_pos.xyz - in.world_pos);

  // Subtle refraction — glass bends light far less than water (0.008 vs 0.04).
  let refract_uv = clamp(in.screen_uv + n.xy * 0.008,
                         vec2<f32>(0.001), vec2<f32>(0.999));
  let refracted  = textureSampleLevel(scene_color_tex, scene_color_samp, refract_uv, 0.0).rgb;

  // Sharp sky reflection — clear glass is near-mirror-smooth.
  let r   = reflect(-v, n);
  let sky = sample_env(r, 0.5);

  // Glass F0 ≈ 0.04. Schlick.
  let cos_theta = max(dot(n, v), 0.0);
  let fresnel   = 0.04 + (1.0 - 0.04) * pow(1.0 - cos_theta, 5.0);

  // Faint cyan tint — window glass is never perfectly neutral.
  let tinted = refracted * vec3<f32>(0.92, 0.96, 0.98);
  let glass  = mix(tinted, sky, fresnel);

  // Alpha rides the Fresnel curve: face-on transparent, grazing opaque.
  let alpha = 0.25 + 0.75 * fresnel;
  return vec4<f32>(glass, alpha);
}
