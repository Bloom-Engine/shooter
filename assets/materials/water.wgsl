// Phase 9 water material — Gerstner waves + Fresnel-blended refraction
// + sky reflection + foam + Phase 4c shoreline fade + Phase 7 impulse
// ripples. Driven by a WaterParams UBO at @group(2) @binding(11) so
// shooter game code can tweak constants live (Phase 5).
//
// Phase 6: this file is loaded via `compileMaterialFromFile` and
// participates in the engine's hot-reload watcher. Editing it while
// the game is running re-compiles the pipeline; failures are logged
// but the previous pipeline keeps running.

#include "material_abi.wgsl"
#include "common/pbr.wgsl"

struct WaterParams {
  tint:  vec4<f32>,  // xyz = absorption tint, w = absorption mix
  knobs: vec4<f32>,  // x = foam strength, y = rim brightness, z = sky LOD, w = -
};
@group(2) @binding(11) var<uniform> water_params: WaterParams;

struct VsOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) world_pos:    vec3<f32>,
  @location(1) world_normal: vec3<f32>,
  @location(2) screen_uv:    vec2<f32>,
};

fn gerstner(
  pos: vec2<f32>, dir: vec2<f32>, wavelength: f32,
  steepness: f32, time: f32,
  tangent_accum:  ptr<function, vec3<f32>>,
  binormal_accum: ptr<function, vec3<f32>>,
) -> vec3<f32> {
  let k = 6.28318 / wavelength;
  let c = sqrt(9.81 / k);
  let f = k * (dot(dir, pos) - c * time);
  let a = steepness / k;
  let cos_f = cos(f);
  let sin_f = sin(f);
  (*tangent_accum) = (*tangent_accum) + vec3<f32>(
    -dir.x * dir.x * steepness * sin_f,
     dir.x * steepness * cos_f,
    -dir.x * dir.y * steepness * sin_f,
  );
  (*binormal_accum) = (*binormal_accum) + vec3<f32>(
    -dir.x * dir.y * steepness * sin_f,
     dir.y * steepness * cos_f,
    -dir.y * dir.y * steepness * sin_f,
  );
  return vec3<f32>(dir.x * a * cos_f, a * sin_f, dir.y * a * cos_f);
}

@vertex
fn vs_main(in: VertexInput) -> VsOut {
  var out: VsOut;
  var local = in.position;
  let world_xz = (draw.model * vec4<f32>(local, 1.0)).xz;
  let t = frame.time;
  var tangent  = vec3<f32>(1.0, 0.0, 0.0);
  var binormal = vec3<f32>(0.0, 0.0, 1.0);
  local = local + gerstner(world_xz, normalize(vec2<f32>( 1.0,  0.3)), 5.0, 0.25, t, &tangent, &binormal);
  local = local + gerstner(world_xz, normalize(vec2<f32>( 0.4,  1.0)), 3.5, 0.20, t, &tangent, &binormal);
  local = local + gerstner(world_xz, normalize(vec2<f32>(-0.5,  0.8)), 2.2, 0.15, t, &tangent, &binormal);
  let normal = normalize(cross(binormal, tangent));
  let world  = draw.model * vec4<f32>(local, 1.0);
  out.world_pos    = world.xyz;
  out.world_normal = normalize((draw.model * vec4<f32>(normal, 0.0)).xyz);
  out.clip_pos     = view.view_proj * world;
  out.screen_uv    = out.clip_pos.xy / out.clip_pos.w * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.world_normal);
  let v = normalize(view.camera_pos.xyz - in.world_pos);

  // Refraction — perturb screen UV by wave normal xz.
  let refract_uv = clamp(in.screen_uv + n.xz * 0.04, vec2<f32>(0.001), vec2<f32>(0.999));
  let refracted  = textureSampleLevel(scene_color_tex, scene_color_samp, refract_uv, 0.0).rgb;

  // Sky reflection from the engine env.
  let r   = reflect(-v, n);
  let sky = sample_env(r, water_params.knobs.z);

  // Schlick Fresnel.
  let cos_theta = max(dot(n, v), 0.0);
  let fresnel   = 0.02 + (1.0 - 0.02) * pow(1.0 - cos_theta, 5.0);

  // Absorption — tint + mix factor from user_params.
  let tinted = mix(water_params.tint.xyz, refracted, water_params.tint.w);
  var water  = mix(tinted, sky, fresnel);

  // Foam on wave crests.
  let crestness = clamp(1.0 - n.y, 0.0, 1.0);
  let foam      = smoothstep(0.08, 0.25, crestness);
  water = mix(water, vec3<f32>(0.95, 0.98, 1.0), foam * water_params.knobs.x);

  // Phase 4c — shoreline fade.
  let depth_dims = textureDimensions(scene_depth_tex);
  let depth_ix   = vec2<i32>(in.screen_uv * vec2<f32>(depth_dims));
  let scene_d    = textureLoad(scene_depth_tex, depth_ix, 0);
  let ndc_xy     = vec2<f32>(in.screen_uv.x * 2.0 - 1.0, 1.0 - in.screen_uv.y * 2.0);
  let floor_v    = view.inv_proj * vec4<f32>(ndc_xy, scene_d, 1.0);
  let surf_v     = view.inv_proj * vec4<f32>(ndc_xy, in.clip_pos.z, 1.0);
  let floor_z    = floor_v.z / floor_v.w;
  let surf_z     = surf_v.z / surf_v.w;
  let column     = max(surf_z - floor_z, 0.0);
  let shore_t    = smoothstep(0.0, 0.15, column);
  let rim        = (1.0 - shore_t) * water_params.knobs.y;
  water = mix(water, vec3<f32>(0.96, 0.99, 1.0), rim);

  // Phase 7 — impulse ripples.
  let imp_uv   = clamp(in.world_pos.xz / 128.0 + vec2<f32>(0.5), vec2<f32>(0.0), vec2<f32>(0.999));
  let imp_dims = textureDimensions(impulse_tex);
  let imp_ix   = vec2<i32>(imp_uv * vec2<f32>(imp_dims));
  let imp      = textureLoad(impulse_tex, imp_ix, 0).r;
  let imp_mix  = clamp(imp * 1.2, 0.0, 1.0);
  water = mix(water, vec3<f32>(0.96, 0.99, 1.0), imp_mix * 0.85);

  let alpha = mix(0.45, 0.92, shore_t);
  return vec4<f32>(water, alpha);
}
