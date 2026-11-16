// Android's card shader (the low tier, SH-069): card_instanced.wgsl plus one rule. An instance
// whose tint alpha is above 1 is an IN-ARENA tree's impostor, and the alpha is the distance (m)
// inside which the real tree model is drawn instead (main.ts LOW_TIER_TREE_DIST); there the card
// collapses to nothing in the vertex stage. Every other card has alpha 1 and is unchanged.
// Only the far-tree material on Android uses this file (flora.ts).

// Phase 3.1 / 3.2 - instanced foliage cards: ferns, shrubs, reeds, flowers, weeds, and the far
// tree line on the hills outside the arena. One material, one texture array; a mesh says which
// slice it wears in its vertex colour, so six plant kinds are six draws of the same pipeline.
//
// Vertex colour: r = sway weight (0 at the root, 1 at the tip), b = slice / 10.
// The fragment discards below the alpha cutoff, so this is an opaque G-buffer material with
// holes (no sorting, depth and motion vectors like everything else).

#include "material_abi.wgsl"
#include "common/shadows.wgsl"
#include "common/clouds.wgsl"
#include "common/pbr.wgsl"

struct CardParams {
  tint:  vec4<f32>,   // rgb multiplies the texture, w = backlit transmission strength
  knobs: vec4<f32>,   // x = alpha cutoff, y = wind scale, z = distance (m) where cards start to
                      // flatten toward their mean colour (0 = never), w = self-shadow depth
};
@group(2) @binding(11) var<uniform> card: CardParams;

struct InstancedVertexInput {
  @location(0)  position:        vec3<f32>,
  @location(1)  normal:          vec3<f32>,
  @location(2)  color:           vec4<f32>,
  @location(3)  uv:              vec2<f32>,
  @location(4)  joints:          vec4<f32>,
  @location(5)  weights:         vec4<f32>,
  @location(6)  tangent:         vec4<f32>,
  @location(7)  instance_pos:    vec3<f32>,
  @location(8)  instance_rot_y:  f32,
  @location(9)  instance_scale:  f32,
  @location(10) instance_tint:   vec4<f32>,
};

struct VsOut {
  @invariant @builtin(position) clip_pos: vec4<f32>,
  @location(0) world_pos:    vec3<f32>,
  @location(1) world_normal: vec3<f32>,
  @location(2) tint:         vec3<f32>,
  @location(3) uv_slice:     vec3<f32>,
  @location(4) curr_clip:    vec4<f32>,
  @location(5) prev_clip:    vec4<f32>,
  @location(6) height01:     f32,
};

fn sway_at(ipos: vec3<f32>, t: f32, w: f32) -> vec3<f32> {
  let phase = dot(ipos.xz, frame.wind.xy * 0.6) + t * frame.wind.w;
  let gust  = sin(phase) + 0.35 * sin(phase * 2.3 + ipos.x);
  return vec3<f32>(frame.wind.x, 0.0, frame.wind.y) * (gust * frame.wind.z * w * card.knobs.y);
}

@vertex
fn vs_main(in: InstancedVertexInput) -> VsOut {
  var out: VsOut;
  let scaled = in.position * in.instance_scale;
  let cy = cos(in.instance_rot_y);
  let sy = sin(in.instance_rot_y);
  let rotated = vec3<f32>(cy * scaled.x + sy * scaled.z, scaled.y, -sy * scaled.x + cy * scaled.z);
  let w = in.color.r * in.instance_scale;
  let world = rotated + in.instance_pos + sway_at(in.instance_pos, frame.time, w);
  let n_rot = vec3<f32>(cy * in.normal.x + sy * in.normal.z, in.normal.y, -sy * in.normal.x + cy * in.normal.z);
  out.world_pos    = world;
  out.world_normal = normalize(n_rot);
  out.clip_pos     = view.view_proj * vec4<f32>(world, 1.0);
  out.tint         = card.tint.rgb * in.instance_tint.rgb;
  out.uv_slice     = vec3<f32>(in.uv, in.color.b * 10.0);
  out.height01     = in.color.r;
  let world_p = rotated + in.instance_pos + sway_at(in.instance_pos, frame.time - frame.delta_time, w);
  out.curr_clip = out.clip_pos;
  out.prev_clip = view.prev_view_proj * vec4<f32>(world_p, 1.0);
  if (in.instance_tint.a > 1.0) {
    let to_cam = view.camera_pos.xz - in.instance_pos.xz;
    if (dot(to_cam, to_cam) < in.instance_tint.a * in.instance_tint.a) {
      out.clip_pos  = vec4<f32>(0.0, 0.0, 2.0, 1.0);   // beyond the far plane: clipped
      out.curr_clip = out.clip_pos;
      out.prev_clip = out.clip_pos;
    }
  }
  return out;
}

@fragment
fn fs_main(in: VsOut) -> OpaqueOut {
  let slice = i32(in.uv_slice.z + 0.5);
  let tex = textureSample(albedo_array, albedo_array_samp, in.uv_slice.xy, slice);
  if (tex.a < card.knobs.x) { discard; }

  let v = normalize(view.camera_pos.xyz - in.world_pos);
  let l = normalize(view.sun_dir.xyz);
  let n = normalize(in.world_normal);

  var albedo = tex.rgb * in.tint;
  // Lower in the plant is deeper in its own shade.
  albedo = albedo * mix(1.0 - card.knobs.w, 1.0, smoothstep(0.0, 0.6, in.height01));

  let wrap     = 0.6;
  let direct_w = max((dot(n, l) + wrap) / (1.0 + wrap), 0.0);
  let back     = pow(max(dot(v, -l), 0.0), 2.0) * card.tint.w;

  let cloud  = cloud_shadow_at(in.world_pos, l, frame.wind.xy, frame.time, frame.cloud);
  let shadow = sample_sun_shadow(in.world_pos);
  let direct = view.sun_color.rgb * direct_w * cloud * shadow;
  let fill   = sample_env_diffuse(vec3<f32>(0.0, 1.0, 0.0)) + view.ambient.rgb * 0.20;
  let lit    = albedo * (fill + direct)
             + albedo * vec3<f32>(1.10, 1.20, 0.80) * view.sun_color.rgb * back * cloud * shadow;

  var out: OpaqueOut;
  out.hdr      = vec4<f32>(lit, 1.0);
  out.material = vec2<f32>(0.0, 0.85);
  out.velocity = abi_motion_vector(in.curr_clip, in.prev_clip);
  out.albedo   = vec4<f32>(albedo, 1.0);
  return out;
}
