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
  // Tier 4 layout: separate Beer-Lambert absorption coefficient
  // from the deep-water colour. Red absorbs fastest, blue slowest
  // → typical absorption is something like (0.55, 0.10, 0.05).
  // `deep_tint` is the asymptotic colour at full extinction
  // (greenish-blue for natural water).
  absorption: vec4<f32>,  // xyz extinction per metre, w unused
  deep_tint:  vec4<f32>,  // xyz deep colour, w unused
  knobs:      vec4<f32>,  // x = foam, y = rim, z = sky LOD, w = micro_normal_strength
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

// Tier 4 — sub-metre normal perturbation in the FRAGMENT, not
// the vertex. Lets the surface read as crinkled at close range
// without needing dense tessellation. Three quick sin-noise lobes
// at different scales + speeds combine into a normal jitter.
fn micro_normal(world_xz: vec2<f32>, t: f32) -> vec3<f32> {
  let p1 = world_xz * 1.7 + vec2<f32>( 0.4 * t,  0.2 * t);
  let p2 = world_xz * 3.1 + vec2<f32>(-0.3 * t,  0.5 * t);
  let p3 = world_xz * 6.2 + vec2<f32>( 0.6 * t, -0.4 * t);
  let nx = sin(p1.x) * 0.5 + sin(p2.y) * 0.3 + sin(p3.x) * 0.15;
  let nz = cos(p1.y) * 0.5 + cos(p2.x) * 0.3 + cos(p3.y) * 0.15;
  return normalize(vec3<f32>(nx, 4.0, nz));  // bias toward +Y
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  // Tier 4 — perturb the per-vertex normal with a fragment-level
  // micro-normal so close-range water reads as crinkled.
  let micro    = micro_normal(in.world_pos.xz, frame.time);
  let n_base   = normalize(in.world_normal);
  let n        = normalize(mix(n_base, micro, water_params.knobs.w));
  let v        = normalize(view.camera_pos.xyz - in.world_pos);

  // Phase 4c — shoreline fade. Compute depth + water column FIRST
  // so Tier 4's Beer-Lambert absorption can use it.
  let depth_dims = textureDimensions(scene_depth_tex);
  let depth_ix   = vec2<i32>(in.screen_uv * vec2<f32>(depth_dims));
  let scene_d    = textureLoad(scene_depth_tex, depth_ix, 0);
  let ndc_xy     = vec2<f32>(in.screen_uv.x * 2.0 - 1.0, 1.0 - in.screen_uv.y * 2.0);
  let floor_v    = view.inv_proj * vec4<f32>(ndc_xy, scene_d, 1.0);
  let surf_v     = view.inv_proj * vec4<f32>(ndc_xy, in.clip_pos.z, 1.0);
  let floor_z    = floor_v.z / floor_v.w;
  let surf_z     = surf_v.z / surf_v.w;
  let column     = max(surf_z - floor_z, 0.0);

  // Refraction — perturb screen UV by wave normal xz; the offset
  // scales with column so deep water bends light more.
  let refr_offset = clamp(column * 0.05, 0.0, 0.06);
  let refract_uv  = clamp(in.screen_uv + n.xz * refr_offset, vec2<f32>(0.001), vec2<f32>(0.999));
  let refracted   = textureSampleLevel(scene_color_tex, scene_color_samp, refract_uv, 0.0).rgb;

  // Tier 4 — Beer-Lambert absorption. Refracted scene colour fades
  // exponentially through the water column, replaced by the tint
  // colour (interpreted as the asymptotic deep-water colour). Red
  // dies fast, blue persists → physically the look of greenish-
  // blue depth.
  let trans      = exp(-water_params.absorption.rgb * column);
  let absorbed   = refracted * trans + water_params.deep_tint.rgb * (1.0 - trans);

  // Sky reflection from the engine env.
  let r   = reflect(-v, n);
  let sky = sample_env(r, water_params.knobs.z);

  // Schlick Fresnel — F0 ≈ 0.02 for water.
  let cos_theta = max(dot(n, v), 0.0);
  let fresnel   = 0.02 + (1.0 - 0.02) * pow(1.0 - cos_theta, 5.0);
  var water     = mix(absorbed, sky, fresnel);

  // Foam on wave crests (slope proxy: low n.y).
  let crestness = clamp(1.0 - n.y, 0.0, 1.0);
  let foam      = smoothstep(0.08, 0.25, crestness);
  water = mix(water, vec3<f32>(0.95, 0.98, 1.0), foam * water_params.knobs.x);

  // Shoreline rim: bright where the water column is thin.
  let shore_t = smoothstep(0.0, 0.15, column);
  let rim     = (1.0 - shore_t) * water_params.knobs.y;
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
