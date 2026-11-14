// Stone / plaster material for building walls + slabs.
//
// SH-050 — REAL TEXTURES. This used to be two octaves of value noise over a
// flat sandstone colour, plus a procedural mortar line every 3 m. That gave the
// surface variation, which is not the same thing as material: there was nothing
// underneath the noise to resolve, so the house read as a beige box with
// stripes while standing in a forest of scanned bark and leaves.
//
// Now it samples two CC0 photoscan slices, picked by which way the face points:
//
//   slice 0  WALL   brick_wall_006    — brick infill (2026-11; was board-formed concrete)
//   slice 1  SLAB   concrete_floor_02 — floors, roof terrace, and the concrete frame and trim
//   slice 2  METAL  metal_plate_02    — steel window linings, awnings, downpipes
//
// Which one a box wears comes in on vertex colour .r (environment.ts, bakeBox): 1 = by face
// direction as described below, 0 = concrete on every face, 0.5 = steel.
//
// The wall/slab split is the reason to bother. Every face used to get identical
// beige noise, so the roof terrace read as a wall lying down. Face direction
// was ALREADY being computed here to project the noise; it now also picks the
// material, which costs nothing and is what a floor being a floor looks like.
//
// PROJECTION: world-space planar, not full triplanar. The building is axis-
// aligned boxes (see BUILDING_VERTS in environment.ts), so the dominant face
// plane IS the exact projection — a 3-tap triplanar blend would spend 3x the
// taps to reproduce what one tap already gets right. This is the one place that
// shortcut is honest; terrain cannot take it, because terrain has slopes.

#include "material_abi.wgsl"
#include "common/pbr.wgsl"
#include "common/shadows.wgsl"
#include "common/clouds.wgsl"

// Array slices — the ABI shared with tools/build-building-textures.ts. Change
// these and that tool's SLICES order together, or the house gets a concrete
// facade and plaster floors.
const SLICE_WALL: i32 = 0;
const SLICE_SLAB: i32 = 1;
const SLICE_METAL: i32 = 2;

struct BldgParams {
  // xyz = base TINT, multiplied into the sampled albedo (the scan carries the
  // colour now; this only nudges it). w = macro tone-variation strength.
  base:   vec4<f32>,
  band:   vec4<f32>,  // xyz band colour, w band tightness (higher = sharper line)
  // x = macro noise freq, y = band_period (m),
  // z = WALL scan size (m), w = SLAB scan size (m) — real-world extents, so
  // each slice tiles at 1:1 physical scale. These two were dead fields ("roof_dim,
  // unused") before SH-050.
  knobs:  vec4<f32>,
  // x = normal-map strength (1.0 = the scan's measured relief, as authored),
  // y/z/w reserved.
  misc:   vec4<f32>,
};
@group(2) @binding(11) var<uniform> bp: BldgParams;

struct VsOut {
  @invariant @builtin(position) clip_pos:     vec4<f32>,
  @location(0)       world_pos:    vec3<f32>,
  @location(1)       world_normal: vec3<f32>,
  // EN-022 — clip positions for motion vectors.
  @location(2)       curr_clip:    vec4<f32>,
  @location(3)       prev_clip:    vec4<f32>,
  @location(4)       code:         f32,
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
  out.code         = in.color.r;
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
  let p = in.world_pos;
  let absn = abs(n);

  // Pick the face plane. This chooses THREE things at once: the UV projection,
  // which material slice the face gets, and how a tangent normal maps back to
  // world space. The axis pairs match terrain.wgsl's triplanar convention
  // (zy / xz / xy) so the tangent->world mapping below is the same swizzle it
  // uses, rather than a second convention to keep straight.
  var sample_uv: vec2<f32>;
  var slice:     i32;
  var size_m:    f32;
  var is_slab:   bool;
  if (absn.y > absn.x && absn.y > absn.z) {
    sample_uv = p.xz;                         // top / bottom — floors, roof terrace
    slice     = SLICE_SLAB;
    size_m    = bp.knobs.w;
    is_slab   = true;
  } else if (absn.x > absn.z) {
    sample_uv = p.zy;                         // east / west walls
    slice     = SLICE_WALL;
    size_m    = bp.knobs.z;
    is_slab   = false;
  } else {
    sample_uv = p.xy;                         // north / south walls
    slice     = SLICE_WALL;
    size_m    = bp.knobs.z;
    is_slab   = false;
  }

  // Phase 3.4 - a second building type. bp.misc.z = 1 makes the WALLS board-formed concrete
  // (the slab scan) instead of brick: the guard post of arena 04.
  if (!is_slab && bp.misc.z > 0.5) {
    slice  = SLICE_SLAB;
    size_m = bp.knobs.w;
  }

  // Material override for trim boxes. The PROJECTION stays the face's own; `is_slab` keeps
  // meaning "horizontal face" for the weathering and the tangent mapping below.
  let is_metal = in.code > 0.25 && in.code < 0.75;
  let is_trim  = in.code < 0.75;
  if (is_metal) {
    slice  = SLICE_METAL;
    size_m = 2.0;
  } else if (is_trim) {
    slice  = SLICE_SLAB;
    size_m = bp.knobs.w;
  }

  // Tiles-per-metre from the slice's real scan size — 1:1 physical scale.
  let s  = 1.0 / max(size_m, 0.01);
  let uv = sample_uv * s;

  let tex_near = textureSample(albedo_array, albedo_array_samp, uv, slice).rgb;
  // Distance anti-tiling (2026-11, photoreal pass), as in terrain.wgsl: a 24 m facade shows the
  // 2 m scan twelve times, and from across the plaza that reads as wallpaper. Far away the same
  // scan is cross-faded with a copy 4.3 times larger, offset so its seams never line up.
  // Blurred six mips down: only the scan's broad tone patches survive. A SHARP enlargement
  // turned every brick into a metre-long block from across the plaza.
  let tex_far  = textureSampleBias(albedo_array, albedo_array_samp, uv * 0.37 + vec2<f32>(0.37, 0.61), slice, 3.0).rgb;
  let far_t    = smoothstep(10.0, 45.0, distance(view.camera_pos.xyz, p)) * 0.8;
  // Brick and steel take the near tap alone (a regular bond enlarged is a different wall);
  // concrete keeps the cross-fade.
  let tex      = select(tex_near, mix(tex_near, tex_far, far_t), slice == SLICE_SLAB);

  // Macro tone break-up. The scan tiles every ~2 m; without a low-frequency
  // multiply on top, a 24 m facade announces that period as a grid. Same trick
  // terrain.wgsl uses, and the reason the two-octave noise SURVIVED the texture
  // swap instead of being deleted with the rest of the procedural material.
  let nz = value_noise(sample_uv * bp.knobs.x) * 0.7
         + value_noise(sample_uv * bp.knobs.x * 2.5) * 0.3;
  // `macro_v`, not `macro` — the latter is a WGSL reserved keyword and the
  // parser rejects the module outright (terrain.wgsl names it the same way for
  // the same reason).
  let macro_v  = mix(1.0 - bp.base.w * 0.18, 1.0 + bp.base.w * 0.18, nz);
  // Steel is painted dark and takes no warm wall tint; the concrete frame is a shade lighter
  // than the floor scan so it reads against the brick.
  var mat_tint = bp.base.rgb;
  if (is_metal) { mat_tint = vec3<f32>(0.42, 0.45, 0.46); }
  else if (is_trim) { mat_tint = vec3<f32>(1.12, 1.10, 1.04); }
  // Concrete walls (the guard post): the floor scan is a dark screed; a wall cast against
  // boards is paler and a little warm.
  else if (!is_slab && bp.misc.z > 0.5) { mat_tint = vec3<f32>(1.75, 1.68, 1.55); }
  var speckled = tex * mat_tint * macro_v;
  // Phase 3.4 - the brick is one 3 m scan, and macro tone alone still left a facade of
  // identical panels. Walls get what a real one collects over decades, at scales the scan's
  // period cannot line up with: areas of darker, sootier brick, areas re-pointed lighter and
  // greyer, and a lime bloom low on the wall. Brick only (trim and steel keep their scan).
  if (!is_slab && !is_trim && bp.misc.z < 0.5) {
    let patch_a = value_noise(sample_uv * 0.21 + vec2<f32>(3.7, 9.2));
    let patch_b = value_noise(sample_uv * 0.55 + vec2<f32>(11.3, 2.1));
    let soot    = smoothstep(0.52, 0.80, patch_a);
    let repoint = smoothstep(0.58, 0.82, patch_b) * (1.0 - soot);
    let grey    = dot(speckled, vec3<f32>(0.33, 0.34, 0.33));
    speckled = mix(speckled, speckled * vec3<f32>(0.66, 0.64, 0.66), soot * 0.75);
    speckled = mix(speckled, mix(speckled, vec3<f32>(grey), 0.45) * 1.14, repoint * 0.7);
    let bloom_n = value_noise(vec2<f32>(sample_uv.x * 1.4, sample_uv.y * 3.1));
    let lime    = smoothstep(0.55, 0.85, bloom_n) * (1.0 - smoothstep(0.6, 2.4, p.y - 0.2));
    speckled = mix(speckled, vec3<f32>(grey * 1.25 + 0.06), lime * 0.35);
  }
  // Ceilings (the underside of a slab) were the floor scan seen at a grazing angle from below,
  // which the sampler smears into dark streaks. A ceiling is whitewashed plaster: one pale tone
  // with water stains spreading from the walls and a few hairline cracks, all from noise that
  // needs no sharp texel.
  let is_ceiling = is_slab && n.y < -0.5 && !is_trim;
  if (is_ceiling) {
    let stain_n = value_noise(p.xz * 0.6) * 0.6 + value_noise(p.xz * 1.9 + 4.4) * 0.4;
    let stain   = smoothstep(0.50, 0.80, stain_n);
    // Hairline cracks: the zero line of one noise, kept only where a second says so, so they
    // are short and few instead of contour lines across the whole ceiling.
    let crack_n = abs(value_noise(p.xz * 2.3 + 8.8) - 0.5);
    let crack   = (1.0 - smoothstep(0.002, 0.007, crack_n))
                * smoothstep(0.62, 0.72, value_noise(p.xz * 0.5 + 1.9));
    var plaster = vec3<f32>(0.66, 0.65, 0.61) * (0.93 + 0.14 * value_noise(p.xz * 7.0));
    plaster = mix(plaster, vec3<f32>(0.44, 0.40, 0.31), stain * 0.55);
    plaster = plaster * (1.0 - crack * 0.35);
    speckled = plaster;
  }

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
  // WALLS ONLY. The band is a function of world Y, and a floor or roof face has
  // CONSTANT world Y — so every texel of it lands at the same point in the band
  // period and the entire slab tints uniformly (or not) depending on where its
  // height happens to fall. That was live before SH-050 and read as an
  // inexplicably darker roof. A mortar line is a wall feature; scope it to walls.
  // 2026-11: off. The concrete courses at each slab are real geometry now, and a painted line
  // across brickwork is wrong.
  let band_t     = select(band_edge * band_cov, 0.0, is_slab) * 0.0;
  // 0.6 -> 0.35: the band used to be drawn over flat colour and was the only
  // thing on the wall. Over a real plaster scan it competes with the material,
  // and a hard painted stripe is exactly the "simple" read we are removing.
  let banded     = mix(speckled, bp.band.rgb, band_t * 0.35);

  // ---- weathering (2026-11, photoreal pass) --------------------------------
  // A clean scan on a box reads as a model of a building. What makes concrete read as a
  // building that has stood outside is where the dirt is: splash-back and damp at the foot of
  // every wall, and dark run-off streaks hanging from the top of each storey where water
  // sheets off the slab edge. Both are functions of world position only, so they are stable
  // under TAA and cost three noise taps. WALLS ONLY; slabs get a faint pooled-water mottle.
  let along   = sample_uv.x;                      // metres along the wall (p.z or p.x)
  var weathered = banded;
  if (is_metal) {
    // Rust bleeding down from the top edge of each piece is in the scan; leave it alone.
  } else if (!is_slab) {
    // Ground grime: strongest at the footing (floor level is y = 0.2), gone by about 1.4 m,
    // with a ragged upper edge.
    let foot_n  = value_noise(vec2<f32>(along * 0.9, p.y * 2.3));
    let foot    = 1.0 - smoothstep(0.15, 1.1 + foot_n * 0.6, p.y - 0.2);
    let grime   = vec3<f32>(0.30, 0.27, 0.20);    // damp earth, slightly green-brown
    weathered   = mix(weathered, weathered * grime * 1.9, foot * 0.55);

    // Run-off streaks: narrow vertical bands (high frequency along the wall, very low
    // vertically) that start at each storey's slab edge (every 3.7 m) and fade downward.
    let storey  = fract((p.y - 0.2) / 3.7);       // 0 at a floor, 1 just under the next slab
    let from_top = 1.0 - storey;                  // 0 right under the slab edge
    let streak_n = value_noise(vec2<f32>(along * 5.5, p.y * 0.22))
                 * value_noise(vec2<f32>(along * 1.3 + 7.1, p.y * 0.08));
    let streak  = smoothstep(0.22, 0.55, streak_n) * (1.0 - smoothstep(0.0, 0.75, from_top));
    weathered   = weathered * (1.0 - streak * 0.38);
    // A thin dark line directly under each slab edge, where dirt collects.
    let lip     = 1.0 - smoothstep(0.0, 0.035, from_top);
    weathered   = weathered * (1.0 - lip * 0.25);
  } else {
    let pool_n  = value_noise(p.xz * 0.45) * value_noise(p.xz * 1.7 + 3.3);
    weathered   = weathered * (1.0 - smoothstep(0.25, 0.6, pool_n) * 0.16);
  }
  let albedo     = weathered;

  // ---- normal -------------------------------------------------------------
  // Tangent -> world by the same swizzle the face plane chose, matching
  // terrain.wgsl's whiteout convention. This is what makes the stones in the
  // plaster catch the sun as relief instead of reading as a photo pasted on a
  // flat box.
  let t = textureSample(normal_array, albedo_array_samp, uv, slice).rgb * 2.0 - 1.0;
  var nw: vec3<f32>;
  if (is_slab) {
    nw = vec3<f32>(t.x, 0.0, t.y);
  } else if (absn.x > absn.z) {
    nw = vec3<f32>(0.0, t.y, t.x);
  } else {
    nw = vec3<f32>(t.x, t.y, 0.0);
  }
  let nrm = normalize(n + nw * bp.misc.x);

  // Lambert vs the engine sun + ambient, with the same cloud-shadow
  // modulation as terrain + grass. Walls dim to match the ground
  // when overcast patches drift over them.
  let sun_dir = normalize(view.sun_dir.xyz);
  let n_dot_l = max(dot(nrm, sun_dir), 0.0);
  // The engine's shared cloud deck (it was a private scrolling noise that matched no cloud).
  let cloud  = cloud_shadow_at(in.world_pos, sun_dir, frame.wind.xy, frame.time, frame.cloud);
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
  // Indoors the sky is mostly hidden. A face is indoors when it lies inside the house's
  // footprint (bp.band: centre x, centre z, half x, half z) below the roof (bp.misc.y) and is a
  // ceiling, a floor, or a wall whose normal points toward the middle of the house. Without
  // this every room was lit like the field outside and the lamps had nothing to do.
  let to_c    = vec2<f32>(bp.band.x, bp.band.y) - p.xz;
  let in_foot = abs(to_c.x) < bp.band.z - 0.05 && abs(to_c.y) < bp.band.w - 0.05;
  let inward  = dot(n.xz, to_c) > 0.0;
  let indoors = in_foot && p.y < bp.misc.y - 0.3 && (is_slab || inward);
  let fill   = (sample_env_diffuse(nrm) + view.ambient.rgb * 0.20) * select(1.0, 0.34, indoors);
  // Phase 3.4 - lamps. The house had no light of its own: indoors was sky fill through the
  // windows and nothing else. Every point light the game submits (the lamps inside, the work
  // lights outside, muzzle flashes) now lights these walls, floors and ceilings. Unshadowed:
  // a face turned away from the lamp gets nothing, which is what keeps a room's lamp off the
  // outside of its own walls and off the floor above.
  var local = vec3<f32>(0.0);
  let pl_n = min(u32(view.point_light_count.x), 24u);
  for (var i = 0u; i < pl_n; i = i + 1u) {
    let lp   = view.point_lights[i].position;
    let lv   = lp.xyz - in.world_pos;
    let d    = length(lv);
    if (d < lp.w) {
      let k   = 1.0 - d / lp.w;
      let ndl = max(dot(nrm, lv / max(d, 0.001)), 0.0);
      // x2.5: these lamps are authored for the engine's own shading, which is brighter at range
      local = local + view.point_lights[i].color.rgb * (view.point_lights[i].color.w * k * k * ndl * 2.5);
    }
  }
  let lit    = albedo * (fill + direct + local);

  // Roughness from the scan's measured map (glTF ORM convention: G = rough)
  // instead of one constant 0.78 for every surface of the building. Damp and
  // dry patches of plaster catch the sun differently, and that variation is
  // most of what separates a surface from a picture of one. The floor slab
  // brings its own — polished concrete is not plaster.
  let rough = select(textureSample(mr_array, albedo_array_samp, uv, slice).g, 0.92, is_ceiling);

  var out: OpaqueOut;
  out.hdr      = vec4<f32>(lit, 1.0);
  out.material = vec2<f32>(select(0.0, 0.55, is_metal), clamp(rough, 0.15, 1.0));
  // EN-022 — real motion vectors (see terrain.wgsl).
  out.velocity = abi_motion_vector(in.curr_clip, in.prev_clip);
  out.albedo   = vec4<f32>(albedo, 1.0);
  return out;
}
