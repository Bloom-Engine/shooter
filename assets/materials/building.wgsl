// Stone / plaster material for building walls + slabs. Replaces
// the flat beige drawCube path. Sampled-noise variation + slight
// horizontal banding (every ~3 m, suggests floor-edge mortar
// lines) gives the surfaces enough detail to read as material
// instead of solid colour.

#include "material_abi.wgsl"

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
};

@vertex
fn vs_main(in: VertexInput) -> VsOut {
  var out: VsOut;
  let world = draw.model * vec4<f32>(in.position, 1.0);
  out.world_pos    = world.xyz;
  out.world_normal = normalize((draw.model * vec4<f32>(in.normal, 0.0)).xyz);
  out.clip_pos     = view.view_proj * world;
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

  // Horizontal band lines every `band_period` metres. Use a
  // sharp cosine pulse — the higher band.w, the thinner the line.
  let band_phase = cos(in.world_pos.y * 6.28318 / bp.knobs.y);
  let band_t     = pow(max(band_phase, 0.0), bp.band.w * 8.0);
  let albedo     = mix(speckled, bp.band.rgb, band_t * 0.6);

  // Lambert vs the engine sun + ambient, with the same cloud-shadow
  // modulation as terrain + grass. Walls dim to match the ground
  // when overcast patches drift over them.
  let sun_dir = normalize(-view.sun_dir.xyz);
  let n_dot_l = max(dot(n, sun_dir), 0.0);
  let cp = in.world_pos.xz * 0.025 + vec2<f32>(frame.time * 0.5, frame.time * 0.15);
  let cn = value_noise(cp);
  let cloud  = mix(0.55, 1.0, smoothstep(0.35, 0.78, cn));
  let direct = view.sun_color.rgb * n_dot_l * cloud;
  let lit    = albedo * (view.ambient.rgb * 0.55 + direct);

  var out: OpaqueOut;
  out.hdr      = vec4<f32>(lit, 1.0);
  out.material = vec2<f32>(0.0, 0.78);  // non-metal, mid-roughness stone
  out.velocity = vec2<f32>(0.0, 0.0);
  out.albedo   = vec4<f32>(albedo, 1.0);
  return out;
}
