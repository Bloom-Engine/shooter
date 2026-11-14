"""Bring a rigged + animated GLB exported from Tripo Studio (web) in line with the API pipeline's assets.

  blender -b -P tools/blender/studio_import.py -- in.glb out.glb --height <m> [--tex 2048] [--deg 0] [--tag-weapon]
        [--rename "key=name,..."] [--trim "clip=start:end,..."] [--loop "clip,..."] [--drop-clips "a,b"]

Shooter conventions (src/enemies.ts, src/main.ts): characters face glTF +X, so a Studio export
(which faces glTF +Z, Blender -Y) needs --deg 90; feet at the origin; no vertex colours (the
engine multiplies COLOR_0 into albedo). --tag-weapon adds the `tag_weapon` joint the player's gun
is placed at, as a child of the right hand.

Studio exports differ from the API's: arbitrary scale, clips in the order they were added, 4k textures.
This scales the character so its rest-pose height is <m>, optionally turns it about the vertical axis,
sorts the animation clips by name (the game addresses clips by index, and the API delivers them sorted),
downsizes textures to <tex> px and drops Tripo's helper sphere.
"""
import bpy, sys, math
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
src, dst = a[0], a[1]
opt = lambda k, d: type(d)(a[a.index(k) + 1]) if k in a else d
height, tex, deg = opt("--height", 0.0), opt("--tex", 2048), opt("--deg", 0.0)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]

# A static root bone above the hips. With root motion off (the shooter's setting) the engine pins
# the translation of skin joint 0 to its rest value. On a Mixamo rig joint 0 is the hips, so a
# death would lie down at standing hip height and a crouch could not lower the body. With "Root"
# as joint 0 the pin lands on a bone that never moves and the hips keep their authored motion
# (the clips are exported "in place", so that motion is the vertical drop and a little sway).
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
tops = [b for b in arm.data.edit_bones if b.parent is None]
if not any(b.name == "Root" for b in tops):
    root = arm.data.edit_bones.new("Root")
    root.head = (0.0, 0.0, 0.0)
    root.tail = (0.0, 0.0, 0.1 * max(0.1, tops[0].length / 0.1 * 0.1))
    root.use_deform = False
    for b in tops:
        b.use_connect = False
        b.parent = root
bpy.ops.object.mode_set(mode="OBJECT")

for m in meshes:   # the engine multiplies COLOR_0 into albedo: drop any vertex colours
    for ca in list(m.data.color_attributes):
        m.data.color_attributes.remove(ca)

# Rest-pose height from the evaluated mesh bounds.
arm.data.pose_position = "REST"
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
zs = []
for m in meshes:
    e = m.evaluated_get(dg)
    zs += [(e.matrix_world @ v.co).z for v in e.data.vertices]
h0 = max(zs) - min(zs)
k = height / h0 if height > 0 else 1.0
print("STUDIO height", round(h0, 4), "-> scale", round(k, 4))

roots = [o for o in bpy.context.scene.objects if o.parent is None]
for o in roots:
    o.rotation_mode = "XYZ"
    o.rotation_euler.z += math.radians(deg)
    o.scale = o.scale * k
    o.location = o.location * k
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
arm.data.pose_position = "POSE"

if "--tag-weapon" in a:
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    hand = next(b for b in arm.data.edit_bones if b.name.replace("mixamorig:", "").replace("mixamorig", "") == "RightHand")
    tag = arm.data.edit_bones.new("tag_weapon")
    palm = hand.head + (hand.tail - hand.head) * 0.75        # the grip sits in the palm, not at the wrist
    tag.head = palm
    tag.tail = palm + (hand.tail - hand.head).normalized() * 0.05
    tag.parent = hand; tag.use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")
    print("STUDIO tag_weapon under", hand.name)

# Applying scale to an armature does not scale its location keys: fix them.
if k != 1.0:
    def fcurves(act):   # Blender 5: layered actions (layers > strips > channelbags)
        for L in act.layers:
            for s in L.strips:
                for cb in s.channelbags:
                    yield from cb.fcurves
    for act in bpy.data.actions:
        for fc in fcurves(act):
            if fc.data_path.endswith("location"):
                for p in fc.keyframe_points:
                    p.co.y *= k; p.handle_left.y *= k; p.handle_right.y *= k

for img in bpy.data.images:
    if img.size[0] > tex:
        img.scale(tex, tex * img.size[1] // img.size[0])
        print("STUDIO texture", img.name, "->", tex)

# Text2Motion clips are named after their prompt: --rename "FirstWord=name,..." renames by first word.
if "--rename" in a:
    ren = dict(p.split("=", 1) for p in a[a.index("--rename") + 1].split(","))
    # A key matches a clip by its first word, or, failing that, as a phrase anywhere in the
    # prompt text (several prompts may open with the same word, e.g. "A soldier ...").
    for act in bpy.data.actions:
        if " " not in act.name:
            continue
        w = act.name.split(" ")[0]
        key = w if w in ren else next((k for k in ren if " " in k and k.lower() in act.name.lower()), None)
        if key:
            print("STUDIO clip", repr(act.name[:40]), "->", ren[key])
            act.name = ren[key]

# Sorted clip order: the exporter writes NLA tracks / actions alphabetically when mode is ACTIONS
# only if we order them; push each action onto its own track in name order.
ad = arm.animation_data or arm.animation_data_create()
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
ad.action = None
# --trim "clip=start:end,..." (seconds; either side may be empty) keeps only that part of a clip;
# --drop-clips "a,b" leaves clips out.
trim = {}
if "--trim" in a:
    for p in a[a.index("--trim") + 1].split(","):
        n, r = p.split("=", 1); s, e = r.split(":")
        trim[n] = (float(s) if s else None, float(e) if e else None)
dropc = set(a[a.index("--drop-clips") + 1].split(",")) if "--drop-clips" in a else set()
fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base

# --loop "clip,..." : find the most seamless loop inside a clip that was not authored to loop
# (a 5 s Text2Motion run restarts with a visible hitch). The pose at every frame is compared with
# every later one (bone rotations, and the frame after each, so the motion direction matches too);
# the best pair at least 0.7 s and at most 3 s apart becomes the trim.
if "--loop" in a:
    scene = bpy.context.scene
    bones = [b for b in arm.pose.bones if not b.name.lower().endswith("_end")]
    for name in a[a.index("--loop") + 1].split(","):
        act = bpy.data.actions.get(name)
        if act is None:
            print("STUDIO loop: no clip", name); continue
        ad.action = act
        if hasattr(ad, "action_slot") and act.slots:
            ad.action_slot = act.slots[0]
        f0, f1 = (int(round(x)) for x in act.frame_range)
        poses = []
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            poses.append([b.matrix_basis.to_quaternion() for b in bones])

        def dist(i, j):
            return sum(1.0 - abs(p.dot(q)) for p, q in zip(poses[i], poses[j]))

        lo_n, hi_n = int(0.7 * fps), int(3.0 * fps)
        best = None
        for i in range(int(0.3 * fps), len(poses) - lo_n - 1):          # skip the settle-in at the start
            for j in range(i + lo_n, min(i + hi_n, len(poses) - 1)):
                d = dist(i, j) + dist(i + 1, j + 1)
                # a longer loop hides repetition better: allow it to cost a little more
                score = d - 0.0008 * (j - i)
                if best is None or score < best[0]:
                    best = (score, i, j, d)
        if best:
            _, i, j, d = best
            trim[name] = ((f0 + i) / fps, (f0 + j) / fps)
            print("STUDIO loop", name, "%.2f - %.2f s (%.2f s cycle), seam error %.4f" % ((f0 + i) / fps, (f0 + j) / fps, (j - i) / fps, d))
    ad.action = None
# --active "clip,..." : keep only the stretch of a clip where the body is actually moving. A 5 s
# Text2Motion attack is typically one strike followed by seconds of standing; looped as it is, the
# creature would mostly stand. The window covers every frame whose pose speed is above a quarter
# of the clip's peak, padded a little, between 0.8 and 2.6 s long. Prints the peak speed so a clip
# that never really moves can be spotted (and the preset strike used instead).
if "--active" in a:
    scene = bpy.context.scene
    bones = [b for b in arm.pose.bones if not b.name.lower().endswith("_end")]
    for name in a[a.index("--active") + 1].split(","):
        act = bpy.data.actions.get(name)
        if act is None:
            print("STUDIO active: no clip", name); continue
        ad.action = act
        if hasattr(ad, "action_slot") and act.slots:
            ad.action_slot = act.slots[0]
        f0, f1 = (int(round(x)) for x in act.frame_range)
        poses = []
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            poses.append([b.matrix_basis.to_quaternion() for b in bones])
        speed = [sum(1.0 - abs(p.dot(q)) for p, q in zip(poses[i], poses[i + 1])) for i in range(len(poses) - 1)]
        k = max(1, int(0.12 * fps))                                  # smooth over about 0.12 s
        sm = [sum(speed[max(0, i - k):i + k + 1]) / len(speed[max(0, i - k):i + k + 1]) for i in range(len(speed))]
        peak = max(sm)
        hot = [i for i, v in enumerate(sm) if v > 0.25 * peak]
        i0, i1 = hot[0], hot[-1]
        pad = int(0.15 * fps)
        i0, i1 = max(0, i0 - pad), min(len(sm), i1 + pad)
        lo_n, hi_n = int(0.8 * fps), int(2.6 * fps)
        if i1 - i0 > hi_n:                                           # too long: the densest hi_n frames
            best = max(range(i0, i1 - hi_n + 1), key=lambda s0: sum(sm[s0:s0 + hi_n]))
            i0, i1 = best, best + hi_n
        if i1 - i0 < lo_n:
            mid = (i0 + i1) // 2
            i0 = max(0, mid - lo_n // 2); i1 = min(len(sm), i0 + lo_n)
        trim[name] = ((f0 + i0) / fps, (f0 + i1) / fps)
        print("STUDIO active", name, "%.2f - %.2f s, peak speed %.4f, mean in window %.4f" %
              ((f0 + i0) / fps, (f0 + i1) / fps, peak, sum(sm[i0:i1]) / max(1, i1 - i0)))
    ad.action = None

for act in sorted(bpy.data.actions, key=lambda x: x.name):
    if act.name in dropc:
        continue
    f0, f1 = act.frame_range
    if act.name in trim:
        s, e = trim[act.name]
        if s is not None: f0 = max(f0, s * fps)
        if e is not None: f1 = min(f1, e * fps)
        act.use_frame_range = True
        act.frame_start, act.frame_end = f0, f1
        print("STUDIO trim", act.name, round(f0 / fps, 2), "-", round(f1 / fps, 2), "s")
    t = ad.nla_tracks.new(); t.name = act.name
    st = t.strips.new(act.name, int(f0), act)
    st.action_frame_start, st.action_frame_end = f0, f1
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True, export_skins=True,
                          export_animations=True, export_animation_mode="NLA_TRACKS", export_anim_slide_to_zero=True,
                          export_image_format="JPEG", export_jpeg_quality=88)
print("STUDIO wrote", dst)
