// Tree material with vertex-driven wind sway. Roots barely move,
// trunk midsection sways a bit, canopy sways most. Sway phase is
// per-tree (derived from world XZ origin) so adjacent trees don't
// move in lockstep, which would read as artificial.
//
// Used for both primitives of every tree GLB — render each tree
// twice with meshIdx 0 and meshIdx 1.

#include "material_abi.wgsl"
#include "common/pbr.wgsl"
#include "common/shadows.wgsl"

struct TreeParams {
  // x,y = wind direction (xz plane, normalised)
  // z   = max sway in metres at the canopy
  // w   = wind temporal frequency (rad/s)
  wind:   vec4<f32>,
  // Trunk colour (brown). Mixed with the per-draw leaf tint via
  // a vertical band so we can render all primitives with one
  // tint per tree — trunk colour is the same across every tree
  // and lives in this UBO, leaves come through draw.model_tint.
  trunk:  vec4<f32>,  // xyz rgb, w trunk_top_y (vertices below this read as trunk)
};
@group(2) @binding(11) var<uniform> tp: TreeParams;

struct VsOut {
  @builtin(position) clip_pos:     vec4<f32>,
  @location(0)       world_pos:    vec3<f32>,
  @location(1)       world_normal: vec3<f32>,
  // local-y of the vertex — used in fs to blend trunk vs leaf colour
  @location(2)       local_y:      f32,
};

@vertex
fn vs_main(in: VertexInput) -> VsOut {
  var out: VsOut;

  // Per-tree world-space origin = the model matrix's translation
  // column. Hash it to a phase so adjacent trees aren't synced.
  let origin_xz = vec2<f32>(draw.model[3].x, draw.model[3].z);
  let phase     = (origin_xz.x * 0.137 + origin_xz.y * 0.241);

  // Sway weight: roots stationary, canopy fully swaying. The
  // local-space height bsuit GLBs sit between y=0 and y≈1.5–2.5
  // depending on the tree variant; weight saturates around y=2.
  let h         = clamp(in.position.y * 0.55, 0.0, 1.0);
  let w         = h * h;  // quadratic so the canopy moves much more than mid trunk

  // Two-component sway: large slow lobe + small fast jitter, so it
  // reads as wind+rustle rather than a single sine.
  let big       = sin(frame.time * tp.wind.w        + phase);
  let small     = sin(frame.time * tp.wind.w * 2.7  + phase * 1.6) * 0.35;
  let sway_amt  = (big + small) * tp.wind.z * w;

  // Displace along world-space wind direction.
  let displace_world = vec3<f32>(tp.wind.x, 0.0, tp.wind.y) * sway_amt;
  let world_pos      = (draw.model * vec4<f32>(in.position, 1.0)).xyz + displace_world;
  let world_normal   = normalize((draw.model * vec4<f32>(in.normal, 0.0)).xyz);

  out.world_pos    = world_pos;
  out.world_normal = world_normal;
  out.clip_pos     = view.view_proj * vec4<f32>(world_pos, 1.0);
  out.local_y      = in.position.y;
  return out;
}

// Cloud-shadow same as the other world materials.
fn cloud_shadow(world_xz: vec2<f32>, t: f32) -> f32 {
  let p  = world_xz * 0.025 + vec2<f32>(t * 0.5, t * 0.15);
  let i  = floor(p);
  let f  = fract(p);
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
  // Blend trunk colour (UBO) and leaf colour (per-draw tint) by
  // vertex local-y. trunk_top_y is the cutoff height in model
  // space; everything below reads as trunk, above as leaves.
  // Tight blend band: the old ±0.20 smeared trunk brown across the lower
  // half of every canopy (muddy gradient blobs); ±0.06 keeps a short
  // natural transition right at the branch line.
  let trunk_t  = smoothstep(tp.trunk.w - 0.06, tp.trunk.w + 0.06, in.local_y);
  let albedo   = mix(tp.trunk.rgb, draw.model_tint.rgb, trunk_t);

  let sun_dir = normalize(view.sun_dir.xyz);
  let v       = normalize(view.camera_pos.xyz - in.world_pos);
  let n_dot_l = max(dot(n, sun_dir), 0.0);
  let cloud   = cloud_shadow(in.world_pos.xz, frame.time);
  // Cascaded sun shadow — trees shade themselves and each other now.
  // Leaves take it at reduced strength: a low-poly canopy's flat facets
  // terrace hard against their own blocky shadow-map silhouette (slat
  // stripes), and real foliage scatters enough light that full-depth
  // self-shadow reads wrong anyway. Round-2 (audit F3): the floor
  // deepens with distance — the flat 0.5 kept far crowns uniformly
  // half-lit, one third of why the backlit treeline measured +35%
  // brighter than the hills behind it. Facet terracing is sub-pixel
  // past ~15 m, so the deep floor is safe there.
  let sun_shadow_raw = sample_sun_shadow_n(in.world_pos, n);
  let cam_dist   = length(view.camera_pos.xyz - in.world_pos);
  let leaf_floor = mix(0.5, 0.15, smoothstep(15.0, 45.0, cam_dist));
  let sun_shadow = mix(sun_shadow_raw,
                       leaf_floor + (1.0 - leaf_floor) * sun_shadow_raw,
                       trunk_t);
  // sun_dir.w carries the sun intensity (1.1 in the shipped world);
  // dropping it tilted the fill:direct ratio toward the pale sky fill.
  let direct  = view.sun_color.rgb * view.sun_dir.w * n_dot_l * cloud * sun_shadow;
  // Backlit transmission — RIM-gated. A first cut applied it to the
  // whole camera-facing crown; on a backlit tree that is every visible
  // pixel (-n·sun > 0 exactly where the camera looks), which brightened
  // the very silhouettes the audit flagged. Real crowns glow at thin
  // edges only, so gate by silhouette proximity.
  let back       = max(dot(-n, sun_dir), 0.0);
  let view_align = max(dot(v, -sun_dir), 0.0);
  let rim        = pow(1.0 - abs(dot(n, v)), 2.0);
  let trans      = pow(back, 2.0) * pow(view_align, 1.5) * 0.6 * rim * trunk_t;
  let trans_col  = albedo * vec3<f32>(1.10, 1.20, 0.85);
  // Sky-fill: HDR irradiance by the surface normal, with a crown
  // self-occlusion proxy on the leaf band (audit F3): a solid canopy's
  // sides see far less sky than its top, but env irradiance by normal
  // alone gave every side facet ~half the sky dome — the core of why
  // backlit crowns measured +35% over the hills behind them. Tops keep
  // the full dome; sides drop to 35%.
  let crown_ao = mix(1.0, 0.35 + 0.65 * max(n.y, 0.0), trunk_t);
  let fill    = (sample_env_diffuse(n) + view.ambient.rgb * 0.20) * crown_ao;
  let lit     = albedo * (fill + direct)
              + trans_col * trans * view.sun_color.rgb * view.sun_dir.w
                * cloud * sun_shadow_raw;

  var out: OpaqueOut;
  out.hdr      = vec4<f32>(lit, 1.0);
  out.material = vec2<f32>(0.0, 0.85);
  out.velocity = vec2<f32>(0.0, 0.0);
  out.albedo   = vec4<f32>(albedo, 1.0);
  return out;
}
