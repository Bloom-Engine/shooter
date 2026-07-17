// EN-027 / SH-033 — instanced surface decals (bullet holes, scorch, blood).
//
// A decal here is an oriented "sticker" quad, not a deferred projection box:
// one instanced draw for the whole ring, in the Cutout bucket so it writes the
// G-buffer, receives sun shadow, and depth-tests against the world like any
// other opaque surface. The honest limitation is that it cannot wrap around a
// corner — see decals.rs for why that trade is the right one for bullet holes
// and blood on flat ground.
//
// Per-instance inputs:
//   @location(7)  instance_pos    world position (already lifted off the surface)
//   @location(8)  instance_rot_y  roll about the surface normal
//   @location(9)  instance_scale  size in metres
//   @location(10) instance_tint   rgba, alpha already faded by lifetime
//   @location(11) instance_extra  (atlas frame, normal azimuth, normal elevation)
//
// The surface normal is packed as two angles because the instance stride has
// exactly one rotation slot and a decal needs a full orientation. Two angles
// is a unit vector; unpacking is two sin/cos.

#include "material_abi.wgsl"
#include "common/shadows.wgsl"

struct DecalParams {
  // x = unused (layer comes per-instance), y = alpha cutoff, zw = unused
  cfg: vec4<f32>,
};
@group(2) @binding(11) var<uniform> dp: DecalParams;

struct InstancedVertexInput {
  @location(0)  position:       vec3<f32>,
  @location(1)  normal:         vec3<f32>,
  @location(2)  color:          vec4<f32>,
  @location(3)  uv:             vec2<f32>,
  @location(4)  joints:         vec4<f32>,
  @location(5)  weights:        vec4<f32>,
  @location(6)  tangent:        vec4<f32>,
  @location(7)  instance_pos:   vec3<f32>,
  @location(8)  instance_rot_y: f32,
  @location(9)  instance_scale: f32,
  @location(10) instance_tint:  vec4<f32>,
  @location(11) instance_extra: vec3<f32>,
};

struct VsOut {
  @invariant @builtin(position) clip_pos:  vec4<f32>,
  @location(0)       uv:        vec2<f32>,
  @location(1)       tint:      vec4<f32>,
  @location(2)       world_pos: vec3<f32>,
  @location(3)       world_nrm: vec3<f32>,
  @location(4)       curr_clip: vec4<f32>,
  @location(5)       prev_clip: vec4<f32>,
  // Every decal type shares one ring and one draw call, so unlike particles
  // the array layer has to travel per-instance. Flat: it is an index, and
  // interpolating it across the quad would sample between two textures.
  @location(6) @interpolate(flat) layer: i32,
};

@vertex
fn vs_main(in: InstancedVertexInput) -> VsOut {
  var out: VsOut;

  // Unpack the normal from (azimuth, elevation).
  let az = in.instance_extra.y;
  let el = in.instance_extra.z;
  let n  = vec3<f32>(sin(el) * cos(az), cos(el), sin(el) * sin(az));

  // Tangent basis around the normal. Pick the reference axis away from n so
  // the cross product never degenerates on a floor decal (n = +Y).
  let ref_up = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(n.y) > 0.99);
  var t = normalize(cross(ref_up, n));
  var b = cross(n, t);

  // Roll about the normal, so repeated hits on the same wall don't look
  // rubber-stamped.
  let c = cos(in.instance_rot_y);
  let s = sin(in.instance_rot_y);
  let t2 = t * c + b * s;
  let b2 = b * c - t * s;

  let corner = in.position.xy * in.instance_scale;
  let world  = in.instance_pos + t2 * corner.x + b2 * corner.y;

  out.world_pos = world;
  out.world_nrm = n;
  out.clip_pos  = view.view_proj * vec4<f32>(world, 1.0);

  out.uv    = in.uv;
  out.layer = i32(in.instance_extra.x);
  out.tint  = in.instance_tint;
  // Decals are static once placed, so previous == current position; the only
  // motion is the camera's, which prev_view_proj carries.
  out.curr_clip = out.clip_pos;
  out.prev_clip = view.prev_view_proj * vec4<f32>(world, 1.0);
  return out;
}

@fragment
fn fs_main(in: VsOut) -> OpaqueOut {
  let tex = textureSample(albedo_array, albedo_array_samp, in.uv, in.layer);
  let a   = tex.a * in.tint.a;
  // Cutout: no blending, so anything under the threshold has to go. Without
  // this the quad's transparent corners would paint opaque black squares.
  if (a < dp.cfg.y) {
    discard;
  }

  let n = normalize(in.world_nrm);
  let l = normalize(view.sun_dir.xyz);
  let shadow = sample_sun_shadow_n(in.world_pos, n);
  let ndl    = max(dot(n, l), 0.0);

  let albedo = tex.rgb * in.tint.rgb;
  // Lit like any other surface, so a bullet hole in shadow is *in shadow*
  // rather than glowing off the wall.
  let ambient = view.ambient.rgb * view.ambient.a;
  let lit = albedo * (ambient + view.sun_color.rgb * ndl * shadow);

  var out: OpaqueOut;
  out.hdr      = vec4<f32>(lit, 1.0);
  out.material = vec2<f32>(0.0, 0.85);   // non-metal, fairly rough
  out.velocity = abi_motion_vector(in.curr_clip, in.prev_clip);
  out.albedo   = vec4<f32>(albedo, 1.0);
  return out;
}
