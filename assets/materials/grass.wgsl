// Tier 2b grass blade material. Single static mesh holds N
// scattered blade quads (built once at startup from a
// deterministic-seed RNG sampled against the heightmap). Per-vertex
// data carries a "blade tip" weight in `color.r` so the wind sway
// only displaces the upper part; `color.g` encodes a per-blade hue
// jitter so adjacent blades aren't identical.
//
// Output is opaque-bucket so the deferred pipeline runs SSAO + sun
// shadows on it. The mesh emits both front and back triangles per
// quad so backface culling doesn't punch holes in the lawn.

#include "material_abi.wgsl"

struct GrassParams {
  // x = wind dir x (normalised), y = wind dir z, z = wind amp
  // (max sway in metres at the blade tip), w = wind freq (rad/s).
  wind:    vec4<f32>,
  // x = base hue r, y = base hue g, z = base hue b, w = jitter amount
  base:    vec4<f32>,
};
@group(2) @binding(11) var<uniform> grass: GrassParams;

struct VsOut {
  @builtin(position) clip_pos:    vec4<f32>,
  @location(0)       world_pos:   vec3<f32>,
  @location(1)       world_normal: vec3<f32>,
  @location(2)       blade_tint:  vec3<f32>,
  @location(3)       tip_weight:  f32,
};

@vertex
fn vs_main(in: VertexInput) -> VsOut {
  var out: VsOut;

  // Pre-displacement world position (used to derive wind phase
  // per-blade — same XZ everywhere for vertices of one blade gives
  // each blade its own coherent sway).
  let base_world = (draw.model * vec4<f32>(in.position, 1.0)).xyz;

  // Wind phase based on world XZ + time. Different blades end up
  // at different phases naturally because the XZ varies.
  let phase   = dot(base_world.xz, grass.wind.xy * 0.6) + frame.time * grass.wind.w;
  let sway    = sin(phase) * grass.wind.z;
  // tip_weight (0 at root, 1 at tip) lives in the vertex's red
  // channel — only the top of the blade moves.
  let tip     = in.color.r;
  let displace = vec3<f32>(grass.wind.x, 0.0, grass.wind.y) * sway * tip;

  let local    = in.position + displace;
  let world    = draw.model * vec4<f32>(local, 1.0);
  out.world_pos    = world.xyz;
  out.world_normal = normalize((draw.model * vec4<f32>(in.normal, 0.0)).xyz);
  out.clip_pos     = view.view_proj * world;
  out.tip_weight   = tip;

  // Per-blade hue jitter encoded in color.g (set once per blade in
  // the build-time scatter so adjacent blades read as distinct).
  let jitter = (in.color.g - 0.5) * grass.base.w;
  out.blade_tint = grass.base.rgb + vec3<f32>(jitter * 0.6, jitter, jitter * 0.4);

  return out;
}

@fragment
fn fs_main(in: VsOut) -> OpaqueOut {
  let n = normalize(in.world_normal);
  // Lambert against PerView's directional sun + fixed ambient mul.
  let sun_dir = normalize(-view.sun_dir.xyz);
  let n_dot_l = max(dot(n, sun_dir), 0.0);
  let direct  = view.sun_color.rgb * n_dot_l;

  // Tip blades catch more sun (real grass: tips are sun-bleached,
  // bottoms shadowed). Brighten by tip_weight.
  let albedo = in.blade_tint * (0.7 + 0.3 * in.tip_weight);
  let lit    = albedo * (view.ambient.rgb * 0.55 + direct);

  var out: OpaqueOut;
  out.hdr      = vec4<f32>(lit, 1.0);
  out.material = vec2<f32>(0.0, 0.92);
  out.velocity = vec2<f32>(0.0, 0.0);
  out.albedo   = vec4<f32>(albedo, 1.0);
  return out;
}
