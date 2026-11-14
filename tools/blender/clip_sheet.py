"""Contact sheet of one animation clip of a game character: N evenly spaced frames in a row.

  blender -b -P tools/blender/clip_sheet.py -- <model.glb> <out.png> [--clip slash] [--frames 12]
        [--cell 320] [--view front|side|quarter]

Used to choose trims (studio_import.py --trim "clip=start:end") and to check facing: the shooter's
characters face glTF +X (Blender +X), so the `front` camera looks down -X at the model.
Prints each frame's time in seconds, in sheet order.
"""
import bpy, sys, math, os
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
src, dst = a[0], a[1]
opt = lambda k, d: type(d)(a[a.index(k) + 1]) if k in a else d
clip, frames, cell, view = opt("--clip", ""), opt("--frames", 12), opt("--cell", 320), opt("--view", "quarter")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in [o for o in sc.objects if o.type == "MESH" and o.name.startswith("Icosphere")]:
    bpy.data.objects.remove(o)   # the glTF importer's bone-shape helper
meshes = [o for o in sc.objects if o.type == "MESH"]

arm.data.pose_position = "REST"
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
pts = [m.evaluated_get(dg).matrix_world @ v.co for m in meshes for v in m.evaluated_get(dg).data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
h = hi.z - lo.z
arm.data.pose_position = "POSE"

act = next((x for x in bpy.data.actions if x.name == clip), None) if clip else None
if clip and act is None:
    sys.exit(f"no clip {clip!r}; have {[x.name for x in bpy.data.actions]}")
ad = arm.animation_data or arm.animation_data_create()
for t in ad.nla_tracks:
    t.mute = True
if act:
    ad.action = act
    if hasattr(ad, "action_slot") and act.slots:
        ad.action_slot = act.slots[0]
f0, f1 = act.frame_range if act else (1, 1)
fps = sc.render.fps / sc.render.fps_base

cam_d = bpy.data.cameras.new("cam"); cam_d.type = "ORTHO"; cam_d.ortho_scale = h * 1.6
cam = bpy.data.objects.new("cam", cam_d); sc.collection.objects.link(cam); sc.camera = cam
centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z + h * 0.5))
direction = {"front": Vector((1, 0, 0.12)), "side": Vector((0, -1, 0.12)), "quarter": Vector((1, -0.8, 0.35))}[view]
cam.location = centre + direction.normalized() * h * 6
cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
sun_d = bpy.data.lights.new("sun", "SUN"); sun_d.energy = 3.0
sun = bpy.data.objects.new("sun", sun_d); sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
world = bpy.data.worlds.new("w"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.22, 0.22, 0.24, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sc.world = world
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in type(sc.render).bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
sc.render.resolution_x = sc.render.resolution_y = cell
sc.render.image_settings.file_format = "PNG"

tmp = bpy.app.tempdir
tiles, times = [], []
for i in range(frames):
    f = f0 + (f1 - f0) * (i / max(1, frames - 1))
    sc.frame_set(int(round(f)))
    p = os.path.join(tmp, f"sheet_{i:03d}.png")
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    tiles.append(p); times.append(round((f - f0) / fps, 2))

sheet = bpy.data.images.new("sheet", cell * frames, cell, alpha=False)
px = [0.0] * (cell * frames * cell * 4)
for i, p in enumerate(tiles):
    im = bpy.data.images.load(p)
    t = list(im.pixels)
    for y in range(cell):
        row = t[y * cell * 4:(y + 1) * cell * 4]
        o = (y * cell * frames + i * cell) * 4
        px[o:o + cell * 4] = row
sheet.pixels.foreach_set(px)
sheet.filepath_raw = dst; sheet.file_format = "PNG"; sheet.save()
print("SHEET", clip or "(rest)", "seconds:", times, "->", dst)
