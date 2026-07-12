// SH-009 / SH-010 — splat-mapped PBR terrain.
//
// What this replaces: three colour stops blended by a hash-noise, with NO
// textures at any scale. Below ~1 m the ground had no detail at all — press the
// camera to the floor and you saw a smooth gradient. It was the single most
// jarring "this looks 2010" surface in the game, and it is also the surface the
// player looks at most.
//
// Four layers, sampled TRIPLANAR (world-XZ projection alone smears to nothing
// on a cliff face, which is exactly where the rock layer lives), blended by the
// masks the old shader was already computing — slope, height, noise,
// distance-to-water — now routed to texture weights instead of colour stops.
//
// Layer order is the ABI, set by tools/build-terrain-textures.ts:
//   0 grass_lush   1 grass_dry   2 dirt   3 rock
// Arrays: albedo at @binding(14), normal at @binding(15) (EN-014).
// A fifth texture — the shared detail normal — rides layer 0 of the MR array
// slot, since nothing else needs it.

#include "material_abi.wgsl"
#include "common/pbr.wgsl"
#include "common/shadows.wgsl"
#include "common/clouds.wgsl"

struct TerrainParams {
  // Per-layer tint, so the palette stays tunable without regenerating art.
  tint_lush: vec4<f32>,
  tint_dry:  vec4<f32>,
  tint_dirt: vec4<f32>,
  tint_rock: vec4<f32>,
  // x = macro noise freq, y = slope threshold (cos), z = ridge height (m),
  // w = pale strength
  knobs:     vec4<f32>,
  // x = river centre z, y = river half-width, z = bank fade width,
  // w = waterline y
  river:     vec4<f32>,
  // x = macro UV scale (tiles/metre), y = detail UV scale, z = detail strength,
  // w = normal strength
  scales:    vec4<f32>,
};
@group(2) @binding(11) var<uniform> tp: TerrainParams;

struct VsOut {
  @builtin(position) clip_pos:     vec4<f32>,
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

/// Triplanar blend weights from the surface normal. Powered up so the
/// transition between projections is tight rather than a wide mush.
fn triplanar_weights(n: vec3<f32>) -> vec3<f32> {
  var w = abs(n);
  w = pow(w, vec3<f32>(4.0));
  return w / max(w.x + w.y + w.z, 0.0001);
}

/// Sample one array layer triplanar-projected in world space. Three taps; the
/// alternative (plain XZ) collapses to a smear of stretched pixels on every
/// vertical face, which is where the rock is.
fn tri_albedo(layer: i32, p: vec3<f32>, w: vec3<f32>, s: f32) -> vec3<f32> {
  let cx = textureSample(albedo_array, albedo_array_samp, p.zy * s, layer).rgb;
  let cy = textureSample(albedo_array, albedo_array_samp, p.xz * s, layer).rgb;
  let cz = textureSample(albedo_array, albedo_array_samp, p.xy * s, layer).rgb;
  return cx * w.x + cy * w.y + cz * w.z;
}

/// Triplanar normal, whiteout-blended: sample each plane's tangent normal,
/// swizzle it into world space, and sum. Cheaper than a full TBN per plane and
/// visually indistinguishable on terrain.
fn tri_normal(layer: i32, p: vec3<f32>, w: vec3<f32>, s: f32, n: vec3<f32>) -> vec3<f32> {
  let tx = textureSample(normal_array, albedo_array_samp, p.zy * s, layer).rgb * 2.0 - 1.0;
  let ty = textureSample(normal_array, albedo_array_samp, p.xz * s, layer).rgb * 2.0 - 1.0;
  let tz = textureSample(normal_array, albedo_array_samp, p.xy * s, layer).rgb * 2.0 - 1.0;
  let nx = vec3<f32>(0.0, tx.y, tx.x) + n;
  let ny = vec3<f32>(ty.x, 0.0, ty.y) + n;
  let nz = vec3<f32>(tz.x, tz.y, 0.0) + n;
  return normalize(nx * w.x + ny * w.y + nz * w.z);
}

@fragment
fn fs_main(in: VsOut) -> OpaqueOut {
  let n = normalize(in.world_normal);
  let p = in.world_pos;
  let w = triplanar_weights(n);
  let s = tp.scales.x;

  // ---- layer weights ------------------------------------------------------
  // Same masks the colour-stop version used; they just drive textures now.
  let nz    = fbm2(p.xz * tp.knobs.x);
  let up    = clamp(n.y, 0.0, 1.0);
  // Rock takes over on anything steep. This is the mask triplanar exists for.
  let rock_w = 1.0 - smoothstep(tp.knobs.y, tp.knobs.y + 0.18, up);

  // Dry/lush grass split by a macro moisture field (~45 m), so the field stops
  // reading as one uniform lawn.
  let moisture = fbm2(p.xz * 0.022);
  let dry_w    = smoothstep(0.45, 0.75, moisture);

  // Dirt in the riverbed and up the damp bank, gated on height so only the
  // carved channel takes it.
  let dzr   = abs(p.z - tp.river.x);
  let bed_x = 1.0 - smoothstep(tp.river.y, tp.river.y + tp.river.z, dzr);
  let bed_y = 1.0 - smoothstep(tp.river.w, tp.river.w + 0.5, p.y);
  let dirt_w = clamp(bed_x * bed_y + smoothstep(0.62, 0.85, nz) * 0.35, 0.0, 1.0);

  // Composite. Order matters: grass is the base, dirt paints over it, rock wins
  // outright on steep faces.
  var w_lush = (1.0 - dry_w);
  var w_dry  = dry_w;
  var w_dirt = dirt_w;
  var w_rock = rock_w;
  let grass_left = max(0.0, 1.0 - w_dirt - w_rock);
  w_lush = w_lush * grass_left;
  w_dry  = w_dry  * grass_left;
  w_dirt = w_dirt * max(0.0, 1.0 - w_rock);
  let wsum = max(w_lush + w_dry + w_dirt + w_rock, 0.0001);
  w_lush /= wsum; w_dry /= wsum; w_dirt /= wsum; w_rock /= wsum;

  // ---- albedo -------------------------------------------------------------
  var albedo = tri_albedo(0, p, w, s) * tp.tint_lush.rgb * w_lush
             + tri_albedo(1, p, w, s) * tp.tint_dry.rgb  * w_dry
             + tri_albedo(2, p, w, s) * tp.tint_dirt.rgb * w_dirt
             + tri_albedo(3, p, w, s) * tp.tint_rock.rgb * w_rock;

  // Macro variation — a low-frequency multiply so the tiling doesn't read as a
  // grid from the air. Without this, any tileable texture announces its period
  // the moment you get above it.
  let macro_v = fbm2(p.xz * 0.012);
  albedo = albedo * (0.86 + 0.28 * macro_v);

  // Height tint — pale, sun-bleached ridges.
  let ridge_t = smoothstep(0.0, max(tp.knobs.z, 0.001), p.y);
  albedo = albedo + vec3<f32>(0.10, 0.09, 0.06) * ridge_t * tp.knobs.w;

  // ---- normal -------------------------------------------------------------
  // Blend the dominant layer's normal (blending four normal maps by weight
  // washes them all out; picking by weight keeps the relief crisp).
  var nrm = n;
  if (w_rock > 0.5) {
    nrm = tri_normal(3, p, w, s, n);
  } else if (w_dirt > 0.4) {
    nrm = tri_normal(2, p, w, s, n);
  } else if (w_dry > 0.5) {
    nrm = tri_normal(1, p, w, s, n);
  } else {
    nrm = tri_normal(0, p, w, s, n);
  }
  nrm = normalize(mix(n, nrm, tp.scales.w));

  // SH-010 — detail normal at ~40x the macro scale, covering the last order of
  // magnitude (blade roots, grit) that a 512px macro texture cannot.
  let ds = tp.scales.y;
  let dt = textureSample(mr_array, albedo_array_samp, p.xz * ds, 0).rgb * 2.0 - 1.0;
  nrm = normalize(nrm + vec3<f32>(dt.x, 0.0, dt.y) * tp.scales.z);

  // ---- lighting -----------------------------------------------------------
  let sun_dir = normalize(view.sun_dir.xyz);
  let n_dot_l = max(dot(nrm, sun_dir), 0.0);

  // Cloud shadows — from the engine's shared deck (common/clouds.wgsl), the
  // same field the sky pass draws its puffs from. This used to be a private
  // fbm2 scroll: it darkened the ground under clouds that were not in the sky
  // above it, and it drifted ~80x faster than the ones that were.
  let cloud = cloud_shadow_at(p, sun_dir, frame.wind.xy, frame.time, frame.cloud);

  // Shadow receive uses the GEOMETRIC normal: the normal-offset bias is a
  // surface-position correction, and feeding it a texture-perturbed normal
  // makes the offset wander and the terrain self-acne.
  let sun_shadow = sample_sun_shadow_n(p, n);

  let direct = view.sun_color.rgb * n_dot_l * cloud * sun_shadow;
  let fill   = sample_env_diffuse(nrm) + view.ambient.rgb * 0.20;
  let lit    = albedo * (fill + direct);

  // Rock is a touch glossier than sod; wet riverbed dirt glossier still.
  let rough = mix(0.95, 0.72, w_rock) - w_dirt * bed_y * 0.25;

  var out: OpaqueOut;
  out.hdr      = vec4<f32>(lit, 1.0);
  out.material = vec2<f32>(0.0, clamp(rough, 0.25, 1.0));
  out.velocity = abi_motion_vector(in.curr_clip, in.prev_clip);
  out.albedo   = vec4<f32>(albedo, 1.0);
  return out;
}
