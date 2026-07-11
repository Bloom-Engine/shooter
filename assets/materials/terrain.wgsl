// Tier 2a — terrain colour variation. Replaces the flat-green
// drawModel path with a material that mixes three grass stops by
// world-XZ noise, slope-tints toward dirt-brown on steep faces,
// and height-tints toward sun-bleached pale on ridges.
//
// Driven entirely from PerView (sun direction, camera) and
// user_params (colour stops + thresholds). No textures yet — the
// noise is a 2-octave hash function in the fragment.
//
// Phase 6 hot-reloadable: edit this file at runtime to retune.

#include "material_abi.wgsl"
#include "common/pbr.wgsl"
#include "common/shadows.wgsl"

struct TerrainParams {
  grass_dry:  vec4<f32>,  // xyz rgb, w unused
  grass_mid:  vec4<f32>,
  grass_deep: vec4<f32>,
  dirt:       vec4<f32>,
  // x = noise_freq (wraps per metre), y = slope_threshold (cos),
  // z = ridge_height (m), w = pale_strength
  knobs:      vec4<f32>,
  // Round-4 — x = river centre z (m), y = river half-width incl. bank
  // fade start, z = bank fade width, w = waterline y (bed blend fades
  // out above it).
  river:      vec4<f32>,
};
@group(2) @binding(11) var<uniform> tp: TerrainParams;

struct VsOut {
  @builtin(position) clip_pos:     vec4<f32>,
  @location(0)       world_pos:    vec3<f32>,
  @location(1)       world_normal: vec3<f32>,
  // EN-022 — clip positions for motion vectors.
  @location(2)       curr_clip:    vec4<f32>,
  @location(3)       prev_clip:    vec4<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VsOut {
  var out: VsOut;
  let world = draw.model * vec4<f32>(in.position, 1.0);
  out.world_pos    = world.xyz;
  out.world_normal = normalize((draw.model * vec4<f32>(in.normal, 0.0)).xyz);
  out.clip_pos     = view.view_proj * world;
  // EN-022 — static geometry: previous world == current world, so the
  // motion vector is pure camera reprojection.
  out.curr_clip    = out.clip_pos;
  out.prev_clip    = view.prev_view_proj * world;
  return out;
}

// Cheap 2D hash → noise. Not pretty but fine for a colour mask.
fn hash21(p: vec2<f32>) -> f32 {
  let q = vec3<f32>(p.x * 127.1, p.y * 311.7, 0.0);
  return fract(sin(dot(q, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453);
}
fn value_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);  // smoothstep
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm2(p: vec2<f32>) -> f32 {
  return value_noise(p) * 0.6 + value_noise(p * 2.7) * 0.3 + value_noise(p * 6.1) * 0.1;
}

@fragment
fn fs_main(in: VsOut) -> OpaqueOut {
  let n = normalize(in.world_normal);

  // Two-octave noise at the configured frequency.
  let nz = fbm2(in.world_pos.xz * tp.knobs.x);

  // Three-stop mix: dry @ 0, mid @ 0.5, deep @ 1. Smooth.
  var grass = mix(tp.grass_dry.rgb, tp.grass_mid.rgb,  smoothstep(0.0, 0.5, nz));
  grass     = mix(grass,             tp.grass_deep.rgb, smoothstep(0.5, 1.0, nz));

  // Slope mix toward dirt. Below threshold of n.y we read as steep
  // and dirt dominates.
  let up_dot   = clamp(n.y, 0.0, 1.0);
  let slope_t  = smoothstep(tp.knobs.y, tp.knobs.y + 0.15, up_dot);
  var surface  = mix(tp.dirt.rgb, grass, slope_t);

  // Round-4 — macro moisture patches (~45 m wavelength): dry
  // straw-olive sweeps + slightly darker lush pockets, so the field
  // stops reading as one uniform green lawn. Loosely matches the
  // grass blades' moisture tinting (they use the same idea at
  // scatter time).
  let patch_n  = fbm2(in.world_pos.xz * 0.022);
  let dry_t    = smoothstep(0.52, 0.78, patch_n);
  let wet_t    = smoothstep(0.42, 0.18, patch_n);
  surface = mix(surface, surface * vec3<f32>(1.30, 1.12, 0.62), dry_t * 0.55);
  surface = mix(surface, surface * vec3<f32>(0.80, 0.92, 0.82), wet_t * 0.35);

  // Round-4 — riverbed: blend to wet mud inside the river channel,
  // gated on world height so only the carved bed (below the
  // waterline) and a thin damp bank strip take it. Pebble-scale
  // noise keeps the mud from being one flat brown.
  let dzr      = abs(in.world_pos.z - tp.river.x);
  let bed_x    = 1.0 - smoothstep(tp.river.y, tp.river.y + tp.river.z, dzr);
  let bed_y    = 1.0 - smoothstep(tp.river.w, tp.river.w + 0.35, in.world_pos.y);
  let bed_t    = bed_x * bed_y;
  let pebble   = value_noise(in.world_pos.xz * 3.1);
  let mud      = vec3<f32>(0.23, 0.17, 0.11) * (0.75 + pebble * 0.5);
  surface = mix(surface, mud, bed_t);

  // Height tint — pale near ridges. Use world.y / ridge_height as
  // the lerp control, capped.
  let ridge_t  = smoothstep(0.0, max(tp.knobs.z, 0.001), in.world_pos.y);
  let pale     = surface + vec3<f32>(0.20, 0.18, 0.12) * ridge_t * tp.knobs.w;
  let final_albedo = mix(surface, pale, ridge_t * tp.knobs.w);

  // Direct lighting — Lambert against PerView's sun + ambient.
  // PerView.sun_dir.xyz is the direction the light TRAVELS toward
  // the surface, so flip for the to-light vector. Skip the .w
  // intensity multipliers — ambient.w lives elsewhere in the
  // engine for some passes and the values match expectations
  // already with rgb-only.
  // Direct lighting — Lambert against PerView's sun + ambient.
  // PerView.sun_dir.xyz is the direction the light TRAVELS toward
  // the surface, so flip for the to-light vector.
  let sun_dir = normalize(view.sun_dir.xyz);
  let n_dot_l = max(dot(n, sun_dir), 0.0);

  // Cloud shadows — large-scale scrolling noise on world XZ
  // multiplied into the sun contribution. Mid-grey biased so most
  // ground stays lit; deep dips read as overcast pockets drifting
  // across the field. Frequency 0.025 = ~40 m wavelength; speed
  // 0.5 m/s along (+x, +z*0.3).
  let cp = in.world_pos.xz * 0.025 + vec2<f32>(frame.time * 0.5, frame.time * 0.15);
  let cn = fbm2(cp);
  let cloud = mix(0.55, 1.0, smoothstep(0.35, 0.78, cn));

  // Cascaded sun shadow (building / trees / enemies now cast onto the
  // terrain). Normal-offset variant — the constant depth bias alone
  // acnes on hillsides once the terrain self-casts.
  let sun_shadow = sample_sun_shadow_n(in.world_pos, n);

  let direct  = view.sun_color.rgb * n_dot_l * cloud * sun_shadow;
  // Sky-fill: HDR irradiance by the terrain normal (slopes facing away
  // from the sky darken naturally) + a small flat-ambient floor.
  let fill    = sample_env_diffuse(n) + view.ambient.rgb * 0.20;
  let lit     = final_albedo * (fill + direct);

  var out: OpaqueOut;
  out.hdr      = vec4<f32>(lit, 1.0);
  out.material = vec2<f32>(0.0, 0.95);
  // EN-022 — real motion vectors: lets TAA's motion-adaptive clamp
  // engage on the terrain (audit F8's shimmer mechanism).
  out.velocity = abi_motion_vector(in.curr_clip, in.prev_clip);
  out.albedo   = vec4<f32>(final_albedo, 1.0);
  return out;
}
