// Android's terrain (the low tier, SH-069). Same bindings, parameters, vertex stage and layer
// rules as terrain.wgsl; the fragment does a fraction of the work, because on a Pixel 4a
// (Adreno 618) the full one cost about 70 ms of a 230 ms frame:
//   - one planar (XZ) tap per layer instead of three triplanar taps plus a blurred far tap,
//     and only for layers that carry weight here (most pixels need one or two);
//   - the dominant layer's normal from one tap, no detail normal;
//   - three single-octave noises instead of eight three-octave ones;
//   - no cloud shadows, no lamp shadow lookups.
// The masks, tints, splat map, wooded skirt, wet bank and lighting terms are the full shader's,
// so the ground keeps its layout and colour. main.ts loads this file on Android only.

#include "material_abi.wgsl"
#include "common/pbr.wgsl"
#include "common/shadows.wgsl"
#include "common/local_shadows.wgsl"
#include "common/clouds.wgsl"

struct TerrainParams {
  // Per-layer tint (xyz), so the palette stays tunable without regenerating art.
  //
  // SH-050 — .w is each layer's SOURCE SIZE IN METRES: the real-world extent the
  // photoscan covers, straight off Poly Haven's `dimensions`. It is not a knob,
  // it is a measurement, and it is what lets every layer tile at 1:1 physical
  // scale despite being scanned at different sizes (2.0 m of grass, 1.3 m of
  // mud). One shared UV scale meant the mud's pebbles came out 54% oversized —
  // and a pebble that is not pebble-sized is exactly what reads as "toy".
  //
  // A world that authors `terrain.layers` overrides the TEXTURES but not these:
  // an authored layer gets the built-in size for its slot. Same caveat the tints
  // have always had.
  tint_lush: vec4<f32>,
  tint_dry:  vec4<f32>,
  tint_dirt: vec4<f32>,
  tint_rock: vec4<f32>,
  // x = macro noise freq, y = slope threshold (cos), z = ridge height (m),
  // w = pale strength
  knobs:     vec4<f32>,
  // x = river centre line (world z for a river along X, world x for one along Z),
  // y = half-width of the bed, NEGATIVE when the river runs along Z, z = bank fade width,
  // w = waterline y
  river:     vec4<f32>,
  // x = GLOBAL tiling multiplier (1.0 = every layer at its true physical size;
  // <1 stretches, which trades texel density for a longer repeat period),
  // y = detail UV scale, z = detail strength, w = normal strength
  scales:    vec4<f32>,
  // Splat-map UV transform: u = p.x * x + y, v = p.z * z + w. Precomputed on the
  // CPU from the terrain's origin, cell size and grid width so the shader does
  // not need any of them.
  splat_uv:  vec4<f32>,
};
@group(2) @binding(11) var<uniform> tp: TerrainParams;

struct VsOut {
  @invariant @builtin(position) clip_pos:     vec4<f32>,
  @location(0)       world_pos:    vec3<f32>,
  @location(1)       world_normal: vec3<f32>,
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
  // EN-022 — static geometry: previous world == current world, so the motion
  // vector is pure camera reprojection.
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
fn fbm2(p: vec2<f32>) -> f32 {
  return value_noise(p) * 0.6 + value_noise(p * 2.7) * 0.3 + value_noise(p * 6.1) * 0.1;
}

fn n1(p: vec2<f32>) -> f32 { return value_noise(p); }

fn layer_scale(size_m: f32) -> f32 {
  return tp.scales.x / max(size_m, 0.01);
}

/// One planar tap with explicit gradients, so it may sit behind the per-layer weight test.
fn tap_albedo(layer: i32, uv: vec2<f32>, gx: vec2<f32>, gy: vec2<f32>) -> vec3<f32> {
  return textureSampleGrad(albedo_array, albedo_array_samp, uv, layer, gx, gy).rgb;
}

@fragment
fn fs_main(in: VsOut) -> OpaqueOut {
  let n = normalize(in.world_normal);
  let p = in.world_pos;
  let s_lush = layer_scale(tp.tint_lush.w);
  let s_dry  = layer_scale(tp.tint_dry.w);
  let s_dirt = layer_scale(tp.tint_dirt.w);
  let s_rock = layer_scale(tp.tint_rock.w);

  let nz     = n1(p.xz * tp.knobs.x);
  let up     = clamp(n.y, 0.0, 1.0);
  let rock_w = 1.0 - smoothstep(tp.knobs.y, tp.knobs.y + 0.18, up);
  let moisture = n1(p.xz * 0.022);
  let dry_w    = smoothstep(0.45, 0.75, moisture);

  let across = select(p.z, p.x, tp.river.y < 0.0);
  let half_w = abs(tp.river.y);
  let dzr   = abs(across - tp.river.x) + (nz - 0.5) * 2.2;
  let bed_x = 1.0 - smoothstep(half_w, half_w + tp.river.z, dzr);
  let bed_y = 1.0 - smoothstep(tp.river.w + 0.05, tp.river.w + 0.45, p.y + (nz - 0.5) * 0.25);
  let dirt_w = clamp(bed_x * bed_y + smoothstep(0.62, 0.85, nz) * 0.35, 0.0, 1.0);
  let shingle = bed_x * smoothstep(tp.river.w - 0.30, tp.river.w + 0.02, p.y)
              * (1.0 - smoothstep(tp.river.w + 0.10, tp.river.w + 0.34, p.y)) * 0.5;
  let wet = bed_x * (1.0 - smoothstep(tp.river.w + 0.02, tp.river.w + 0.20, p.y));

  var w_lush = (1.0 - dry_w);
  var w_dry  = dry_w;
  var w_dirt = dirt_w;
  var w_rock = clamp(rock_w + shingle * 0.85, 0.0, 1.0);
  let grass_left = max(0.0, 1.0 - w_dirt - w_rock);
  w_lush = w_lush * grass_left;
  w_dry  = w_dry  * grass_left;
  w_dirt = w_dirt * max(0.0, 1.0 - w_rock);
  let wsum = max(w_lush + w_dry + w_dirt + w_rock, 0.0001);
  w_lush /= wsum; w_dry /= wsum; w_dirt /= wsum; w_rock /= wsum;

  let suv = vec2<f32>(p.x * tp.splat_uv.x + tp.splat_uv.y,
                      p.z * tp.splat_uv.z + tp.splat_uv.w);
  let sp = textureSample(mr_array, albedo_array_samp, suv, 0);
  let cov = clamp(sp.r + sp.g + sp.b + sp.a, 0.0, 1.0);
  if (cov > 0.0) {
    let ssum = max(sp.r + sp.g + sp.b + sp.a, 0.0001);
    w_lush = mix(w_lush, sp.r / ssum, cov);
    w_dry  = mix(w_dry,  sp.g / ssum, cov);
    w_dirt = mix(w_dirt, sp.b / ssum, cov);
    w_rock = mix(w_rock, sp.a / ssum, cov);
  }

  // Gradients in uniform control flow (the taps below sit behind weight tests).
  let gx = dpdx(p.xz);
  let gy = dpdy(p.xz);
  var albedo = vec3<f32>(0.0);
  if (w_lush > 0.01) { albedo += tap_albedo(0, p.xz * s_lush, gx * s_lush, gy * s_lush) * tp.tint_lush.rgb * w_lush; }
  if (w_dry  > 0.01) { albedo += tap_albedo(1, p.xz * s_dry,  gx * s_dry,  gy * s_dry)  * tp.tint_dry.rgb  * w_dry; }
  if (w_dirt > 0.01) { albedo += tap_albedo(2, p.xz * s_dirt, gx * s_dirt, gy * s_dirt) * tp.tint_dirt.rgb * w_dirt; }
  if (w_rock > 0.01) { albedo += tap_albedo(3, p.xz * s_rock, gx * s_rock, gy * s_rock) * tp.tint_rock.rgb * w_rock; }

  let cam_d = distance(view.camera_pos.xyz, p);
  let far = smoothstep(10.0, 45.0, cam_d) * 0.8;
  let meadow_far = smoothstep(18.0, 60.0, cam_d) * (w_lush + w_dry);
  albedo = mix(albedo, albedo * vec3<f32>(0.70, 0.84, 0.50), meadow_far);

  let out_d  = max(abs(p.x), abs(p.z));
  let wooded = smoothstep(38.0, 50.0, out_d);
  let copse  = n1(p.xz * 0.035 + vec2<f32>(9.1, 3.3));
  albedo = mix(albedo, albedo * mix(vec3<f32>(0.24, 0.33, 0.22), vec3<f32>(0.46, 0.54, 0.32), copse)
                              * (0.72 + 0.56 * nz), wooded);
  albedo = albedo * mix(1.0, 0.52, wet);
  albedo = albedo * (0.86 + 0.28 * moisture);
  let ridge_t = smoothstep(0.0, max(tp.knobs.z, 0.001), p.y);
  albedo = albedo + vec3<f32>(0.10, 0.09, 0.06) * ridge_t * tp.knobs.w * (1.0 - wooded);

  // Dominant layer's normal, one planar tap.
  var layer = 0;
  var s_n = s_lush;
  if (w_rock > 0.5) { layer = 3; s_n = s_rock; }
  else if (w_dirt > 0.4) { layer = 2; s_n = s_dirt; }
  else if (w_dry > 0.5) { layer = 1; s_n = s_dry; }
  let t = textureSampleGrad(normal_array, albedo_array_samp, p.xz * s_n, layer, gx * s_n, gy * s_n).rgb * 2.0 - 1.0;
  var nrm = normalize(vec3<f32>(t.x, 0.0, t.y) + n);
  nrm = normalize(mix(n, nrm, tp.scales.w * (1.0 - far)));

  let sun_dir = normalize(view.sun_dir.xyz);
  let n_dot_l = max(dot(nrm, sun_dir), 0.0);
  let sun_shadow = sample_sun_shadow_n(p, n);
  let direct = view.sun_color.rgb * n_dot_l * sun_shadow;
  let fill   = sample_env_diffuse(nrm) + view.ambient.rgb * 0.20;
  var local = vec3<f32>(0.0);
  let pl_n = min(u32(view.point_light_count.x), 24u);
  for (var i = 0u; i < pl_n; i = i + 1u) {
    let lp = view.point_lights[i].position;
    let lv = lp.xyz - p;
    let d  = length(lv);
    if (d < lp.w) {
      let k = 1.0 - d / lp.w;
      local = local + view.point_lights[i].color.rgb
            * (view.point_lights[i].color.w * k * k * max(dot(nrm, lv / max(d, 0.001)), 0.0));
    }
  }
  let lit = albedo * (fill + direct + local);
  let rough = mix(mix(0.95, 0.72, w_rock) - w_dirt * bed_y * 0.25, 0.22, wet * 0.85);

  var out: OpaqueOut;
  out.hdr      = vec4<f32>(lit, 1.0);
  out.material = vec2<f32>(0.0, clamp(rough, 0.18, 1.0));
  out.velocity = abi_motion_vector(in.curr_clip, in.prev_clip);
  out.albedo   = vec4<f32>(albedo, 1.0);
  return out;
}
