// Stone / plaster material for building walls + slabs. Replaces
// the flat beige drawCube path. Sampled-noise variation + slight
// horizontal banding (every ~3 m, suggests floor-edge mortar
// lines) gives the surfaces enough detail to read as material
// instead of solid colour.

#include "material_abi.wgsl"
#include "common/pbr.wgsl"
#include "common/shadows.wgsl"

struct BldgParams {
  base:   vec4<f32>,  // xyz base colour, w noise mix amount (0..1)
  band:   vec4<f32>,  // xyz band colour, w band tightness (higher = sharper line)
  knobs:  vec4<f32>,  // x = noise_freq, y = band_period (m), z = roof_dim, w = unused
};
@group(2) @binding(11) var<uniform> bp: BldgParams;

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
  // EN-022 — static geometry: camera-reprojection motion vector.
  out.curr_clip    = out.clip_pos;
  out.prev_clip    = view.prev_view_proj * world;
  return out;
}

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
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

@fragment
fn fs_main(in: VsOut) -> OpaqueOut {
  let n = normalize(in.world_normal);

  // Project the wall sample onto its dominant face plane so noise
  // is consistent across the wall regardless of which axis the
  // face faces. Use whichever pair (xy / xz / yz) has the
  // smallest normal component.
  var sample_uv: vec2<f32>;
  let absn = abs(n);
  if (absn.y > absn.x && absn.y > absn.z) {
    sample_uv = in.world_pos.xz;             // top / bottom faces
  } else if (absn.x > absn.z) {
    sample_uv = in.world_pos.yz;             // east / west walls
  } else {
    sample_uv = in.world_pos.xy;             // north / south walls
  }

  // Two-octave noise speckle.
  let nz = value_noise(sample_uv * bp.knobs.x) * 0.7
         + value_noise(sample_uv * bp.knobs.x * 2.5) * 0.3;
  let speckled = mix(bp.base.rgb, bp.base.rgb * 1.18, nz);

  // Horizontal mortar lines every `band_period` metres, analytically
  // antialiased. The old form — pow(max(cos(y·f),0), band.w·8) — was a
  // razor-sharp procedural pulse with no filtering. Re-evaluated each
  // frame at TAA-jittered sample positions on the half-res buffer, its
  // hard edges flipped pixels every frame: the reported gray-line
  // flicker crawling across the wall (worst up close, where the bands
  // are large). Here the line is a distance field antialiased over
  // exactly one pixel via fwidth, and it fades toward the wall colour
  // once a line packs below the pixel rate — so it stays rock-stable
  // at every distance and grazing angle.
  let band_coord = in.world_pos.y / bp.knobs.y;          // 1 unit per period
  let band_dist  = abs(fract(band_coord + 0.5) - 0.5) * 2.0;  // 0 at a line, 1 between
  let band_fw    = max(fwidth(band_coord), 1e-5);        // pixel footprint (periods)
  // Line half-width as a fraction of the period, matched to the old
  // pow(band.w·8) thickness.
  let band_hw    = 0.5 / (bp.band.w * 8.0 + 1.0);
  let band_edge  = 1.0 - smoothstep(band_hw - band_fw, band_hw + band_fw, band_dist);
  let band_cov   = clamp(band_hw / band_fw, 0.0, 1.0);   // fade when sub-pixel
  let band_t     = band_edge * band_cov;
  let albedo     = mix(speckled, bp.band.rgb, band_t * 0.6);

  // Lambert vs the engine sun + ambient, with the same cloud-shadow
  // modulation as terrain + grass. Walls dim to match the ground
  // when overcast patches drift over them.
  let sun_dir = normalize(view.sun_dir.xyz);
  let n_dot_l = max(dot(n, sun_dir), 0.0);
  let cp = in.world_pos.xz * 0.025 + vec2<f32>(frame.time * 0.5, frame.time * 0.15);
  let cn = value_noise(cp);
  let cloud  = mix(0.55, 1.0, smoothstep(0.35, 0.78, cn));
  // Cascaded sun shadow. The building both casts and receives now —
  // the normal-offset variant keeps its vertical walls acne-free
  // (a constant depth bias can't cover a wall's depth slope).
  let sun_shadow = sample_sun_shadow_n(in.world_pos, n);
  let direct = view.sun_color.rgb * n_dot_l * cloud * sun_shadow;
  // Sky-fill: convolved HDR irradiance sampled by the surface normal (env
  // intensity pre-applied) instead of a flat ambient constant — shadow-side
  // walls pick up directional sky colour + ground bounce from the HDRI
  // rather than reading flat grey. A small flat floor keeps interiors and
  // overhangs from going pitch black.
  let fill   = sample_env_diffuse(n) + view.ambient.rgb * 0.20;
  let lit    = albedo * (fill + direct);

  var out: OpaqueOut;
  out.hdr      = vec4<f32>(lit, 1.0);
  out.material = vec2<f32>(0.0, 0.78);  // non-metal, mid-roughness stone
  // EN-022 — real motion vectors (see terrain.wgsl).
  out.velocity = abi_motion_vector(in.curr_clip, in.prev_clip);
  out.albedo   = vec4<f32>(albedo, 1.0);
  return out;
}
