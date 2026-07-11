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

// Round-3 — bilinear sample of the impulse field. The field is a
// non-filterable R32Float at 0.5 m/texel; the nearest-neighbour
// textureLoad the shader used before rendered every splat as hard
// half-metre squares (the "pixelated fading" while wading). wgpu
// won't filter R32Float, so the 2×2 lerp is done by hand.
fn sample_impulse(world_xz: vec2<f32>) -> f32 {
  let dims = vec2<f32>(textureDimensions(impulse_tex));
  let uv   = clamp(world_xz / 128.0 + vec2<f32>(0.5), vec2<f32>(0.0), vec2<f32>(1.0));
  let p    = uv * dims - vec2<f32>(0.5);
  let base = vec2<i32>(floor(p));
  let f    = p - floor(p);
  let hi   = vec2<i32>(dims) - vec2<i32>(1);
  let lo   = vec2<i32>(0);
  let v00  = textureLoad(impulse_tex, clamp(base,                    lo, hi), 0).r;
  let v10  = textureLoad(impulse_tex, clamp(base + vec2<i32>(1, 0),  lo, hi), 0).r;
  let v01  = textureLoad(impulse_tex, clamp(base + vec2<i32>(0, 1),  lo, hi), 0).r;
  let v11  = textureLoad(impulse_tex, clamp(base + vec2<i32>(1, 1),  lo, hi), 0).r;
  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  // Round-3 — impulse splashes agitate the surface: they boost the
  // micro-normal weight locally (chop where something disturbed the
  // water) instead of painting flat white (the old 85% white mix).
  let imp      = clamp(sample_impulse(in.world_pos.xz), 0.0, 1.0);

  // Tier 4 — perturb the per-vertex normal with a fragment-level
  // micro-normal so close-range water reads as crinkled.
  let micro    = micro_normal(in.world_pos.xz, frame.time);
  let n_base   = normalize(in.world_normal);
  let micro_w  = clamp(water_params.knobs.w + imp * 0.45, 0.0, 0.8);
  let n        = normalize(mix(n_base, micro, micro_w));
  let v        = normalize(view.camera_pos.xyz - in.world_pos);

  // Round-2 fix: derive screen UV from the fragment position instead of
  // a per-vertex perspective-divided varying — the varying interpolates
  // linearly across the 1 m grid cells and lands on the wrong snapshot
  // texel at grazing distances, exactly where the look was worst.
  // @builtin(position) in the fragment stage is window pixels at the
  // render extent, which is also the snapshot resolution.
  let scr_dims  = vec2<f32>(textureDimensions(scene_color_tex));
  let screen_uv = in.clip_pos.xy / scr_dims;

  // Phase 4c — shoreline fade. Compute depth + water column FIRST
  // so Tier 4's Beer-Lambert absorption can use it.
  //
  // Round-3 fix: do NOT unproject through view.inv_proj — the engine's
  // perspective is GL-convention and mat4_invert of it produces garbage
  // unprojections (the same failure that collapsed the shadow cascades;
  // see docs/shadow-cascade-and-ssao-fixes.md). The column this block
  // used to compute was ~0 everywhere, which silently zeroed the
  // absorption, caustics, shore fade AND the old rim — a root cause of
  // the uniform "milk film" look. Instead linearize the two depths
  // straight from the projection constants:
  //   z_clip = A·z_view + B·w,  w_clip = -z_view
  //   → z_view = -B / (d + A),  A = proj[2][2], B = proj[3][2]
  // (The ABI's linearize_depth helper remaps d*2-1 first, which is
  // wrong for this engine's depth range — don't use it here.)
  let depth_ix   = vec2<i32>(in.clip_pos.xy);
  let scene_d    = textureLoad(scene_depth_tex, depth_ix, 0);
  let proj_a     = view.proj[2][2];
  let proj_b     = view.proj[3][2];
  let floor_z    = -proj_b / (scene_d + proj_a);
  let surf_z     = -proj_b / (in.clip_pos.z + proj_a);
  // Both z are negative (camera looks down -Z); bed is farther → more
  // negative → column = surf - floor > 0 metres of water along the ray.
  let column     = max(surf_z - floor_z, 0.0);

  // Refraction — perturb screen UV by wave normal xz; the offset
  // scales with column so deep water bends light more.
  let refr_offset = clamp(column * 0.05, 0.0, 0.06);
  let refract_uv  = clamp(screen_uv + n.xz * refr_offset, vec2<f32>(0.001), vec2<f32>(0.999));
  var refracted   = textureSampleLevel(scene_color_tex, scene_color_samp, refract_uv, 0.0).rgb;

  // Caustics — sun-rays focused on the river bed by the wavy water
  // surface above. Three sin lobes at different angles + speeds
  // combine into a moving interference pattern; max() creates
  // sharp bright lines instead of soft blobs. Modulated by column
  // so dry land never gets caustics, and faded at extreme depth
  // where in real water diffraction would scatter them.
  let cp = in.world_pos.xz;
  let s1 = sin((cp.x + cp.y) * 3.7 + frame.time * 1.2);
  let s2 = sin((cp.x - cp.y) * 5.1 + frame.time * 0.9);
  let s3 = sin( cp.x          * 4.3 + frame.time * 1.5);
  let caustic   = max(s1, max(s2, s3)) * 0.5 + 0.5;       // 0..1
  let caustic_t = smoothstep(0.0, 0.05, column) * (1.0 - smoothstep(0.6, 1.5, column));
  // Round-3: gain 1.4 → 0.5 — at 1.4 the caustics brightened the bed up
  // to 2.4× and were a big part of the milky wash.
  refracted = refracted * mix(1.0, 1.0 + caustic * 0.5, caustic_t);

  // Tier 4 — Beer-Lambert absorption. Refracted scene colour fades
  // exponentially through the water column, replaced by the tint
  // colour (interpreted as the asymptotic deep-water colour). Red
  // dies fast, blue persists → physically the look of greenish-
  // blue depth.
  let trans      = exp(-water_params.absorption.rgb * column);
  let absorbed   = refracted * trans + water_params.deep_tint.rgb * (1.0 - trans);

  // Sky reflection from the engine env — with two round-2 grazing-angle
  // fixes (audit F2: the river measured 16-23% BRIGHTER than the sky):
  // (1) lift the reflected ray off the horizon before sampling; the
  //     GGX-prefiltered mip around v≈0.5 is a flat pale wash that does
  //     not exist in the actual sky above the horizon;
  // (2) cap Schlick at 0.60 — re-lands the 2026-06-20 calibration lost
  //     in the round-1 merge, so grazing water keeps body colour
  //     instead of going over-unity mirror.
  let r_raw = reflect(-v, n);
  let r     = normalize(vec3<f32>(r_raw.x, max(r_raw.y, 0.08), r_raw.z));
  let sky   = sample_env(r, water_params.knobs.z);

  // Round-3 — planar reflections (EN-011). The probe mirror-renders the
  // cached-model world (trees / house / banks) across the water plane
  // each frame; alpha 0 where no geometry was written, so the sky env
  // shows through the gaps. Without this the water only ever reflected
  // the featureless prefiltered sky — nothing anchored it to the scene.
  let refl_uv = clamp(screen_uv + n.xz * 0.08, vec2<f32>(0.001), vec2<f32>(0.999));
  let planar  = textureSampleLevel(planar_reflection_tex, planar_reflection_samp, refl_uv, 0.0);
  let refl    = mix(sky, planar.rgb, planar.a);

  // Schlick Fresnel — F0 ≈ 0.02 for water, capped (see above).
  let cos_theta = max(dot(n, v), 0.0);
  let fresnel   = min(0.02 + (1.0 - 0.02) * pow(1.0 - cos_theta, 5.0), 0.60);
  var water     = mix(absorbed, refl, fresnel);

  // Foam on wave crests (slope proxy: low n.y), faded toward grazing
  // views — without the fade the whole far half of the river picks up
  // a uniform white film from wave flanks (measured ~5% of the audit's
  // "milk stripe" luma).
  let crestness = clamp(1.0 - n.y, 0.0, 1.0);
  let foam      = smoothstep(0.08, 0.25, crestness)
                * smoothstep(0.06, 0.35, cos_theta);
  water = mix(water, vec3<f32>(0.95, 0.98, 1.0), foam * water_params.knobs.x);

  // Shoreline rim: bright where the water column is thin.
  let shore_t = smoothstep(0.0, 0.15, column);
  let rim     = (1.0 - shore_t) * water_params.knobs.y;
  water = mix(water, vec3<f32>(0.96, 0.99, 1.0), rim);

  // Phase 7 / Round-3 — impulse wake foam. The normal agitation above
  // carries most of the effect; this is just a soft churned-water
  // brightening, capped well below white so it never reads as paint.
  water = mix(water, vec3<f32>(0.88, 0.93, 0.95), imp * 0.22);

  // Round-3 — sun glint: tight Blinn specular from the sun direction.
  // sample_env at any useful LOD blurs the sun disc into a wash, so a
  // direct term is what actually sells the surface as water. Additive
  // HDR, applied after all the mixes so foam / wake can't dim it.
  let l       = normalize(view.sun_dir.xyz);
  let h       = normalize(l + v);
  let n_dot_h = max(dot(n, h), 0.0);
  let glint   = pow(n_dot_h, 380.0) * view.sun_dir.w;
  water = water + view.sun_color.rgb * glint * 1.5;

  // Round-3 — the shader already composites the refracted scene colour
  // itself, so hardware alpha-blending the same background in AGAIN
  // just washes the surface out (the milky-film look). Own the pixel
  // (alpha ≈ 1) and only fade alpha over the first 15 cm of water
  // column so the shoreline still dissolves smoothly into the bank.
  let alpha = 0.97 * shore_t;
  return vec4<f32>(water, alpha);
}
