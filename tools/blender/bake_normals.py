"""Bake a tangent-space normal map for a game character from its high-detail original.

  blender -b -P tools/blender/bake_normals.py -- <hd.glb> <game.glb> <out_normal.png> [--size 4096]

The high-detail mesh (Tripo's 1.9M-triangle original, exported from the Studio version history)
is fitted to the game mesh's rest pose by bounding box, then Cycles bakes its surface normals,
geometry and its own normal map together, onto the game mesh's UVs. Put the result into the GLB
with tools/gen/glb_replace_image.py.

Adopted for the Storm cast on 2026-11-12. The fit is exact (median 0.1-0.2 mm) and a 4096
bake takes 18 s. Against Tripo's own 1024 map the render measured 5 % more detail on Jonah
and 10-13 % on the captain and the two sailors (crisper beards, cloth and metal). Each map
costs 22 MB of GPU memory as ASTC 4x4 instead of 1.4 MB.

Recipe per character (the *_hd.glb originals are git-ignored; re-export them from the oldest
entry of the Studio version history):
  blender -b -P tools/blender/bake_normals.py -- art/source/<n>_studio/<n>_hd.glb assets/<n>/<n>.glb /tmp/n.png
  (convert to JPEG quality 95, then)
  python3 tools/gen/glb_replace_image.py assets/<n>/<n>.glb out.glb normal n.jpg
After studio_import.py re-creates a character, the bake has to be repeated.
"""
import bpy, sys, mathutils
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
hd_path, game_path, out_path = argv[:3]
size = int(argv[argv.index("--size") + 1]) if "--size" in argv else 4096


def import_meshes(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before and o.type == "MESH" and len(o.data.polygons) > 500]


def bounds(objs):
    lo = mathutils.Vector((1e9, 1e9, 1e9)); hi = -lo
    for o in objs:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            lo = mathutils.Vector(map(min, lo, p)); hi = mathutils.Vector(map(max, hi, p))
    return lo, hi


bpy.ops.wm.read_factory_settings(use_empty=True)
game = import_meshes(game_path)
# Bake against the rest pose: the game file may be sitting on an animation frame.
for o in bpy.data.objects:
    if o.type == "ARMATURE":
        o.data.pose_position = "REST"
bpy.context.view_layer.update()
hd = import_meshes(hd_path)
print("BAKE game meshes", [(o.name, len(o.data.polygons)) for o in game], "hd", [(o.name, len(o.data.polygons)) for o in hd])

# Join each side into one object.
def join(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active

low = join(game)
high = join(hd)
# Detach both from parents, keeping world transforms, and freeze the game mesh as displayed.
for o in (low, high):
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
for m in list(low.modifiers):
    low.modifiers.remove(m)
bpy.context.view_layer.update()

glo, ghi = bounds([low]); hlo, hhi = bounds([high])
scale = (ghi.z - glo.z) / (hhi.z - hlo.z)
high.matrix_world = mathutils.Matrix.Translation((glo + ghi) / 2) @ mathutils.Matrix.Scale(scale, 4) @ mathutils.Matrix.Translation(-(hlo + hhi) / 2) @ high.matrix_world
bpy.context.view_layer.update()
height = ghi.z - glo.z

# How well do they coincide? Distance from game vertices to the high-detail surface.
dg = bpy.context.evaluated_depsgraph_get()
tree = BVHTree.FromObject(high, dg)
inv = high.matrix_world.inverted()
ds = sorted((tree.find_nearest(inv @ (low.matrix_world @ v.co))[3] or 9.0) * scale for v in list(low.data.vertices)[::37])
print(f"BAKE fit: scale {scale:.4f}, height {height:.3f} m, surface distance median {ds[len(ds)//2]*1000:.1f} mm, 95% {ds[int(len(ds)*0.95)]*1000:.1f} mm")

img = bpy.data.images.new("baked_normal", size, size, alpha=False, float_buffer=False)
img.colorspace_settings.name = "Non-Color"
for mat in low.data.materials:
    mat.use_nodes = True
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    mat.node_tree.nodes.active = node
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 4
scene.cycles.device = "CPU"
bake = scene.render.bake
bake.use_selected_to_active = True
# The two surfaces coincide to a fraction of a millimetre, and cloth layers lie a few
# millimetres apart, so rays start just outside the surface (a larger cage starts them
# outside the neighbouring layer) and may travel a little further inward.
bake.cage_extrusion = height * 0.0008
bake.max_ray_distance = height * 0.008
bake.margin = 16
bake.normal_space = "TANGENT"
bpy.ops.object.select_all(action="DESELECT")
high.select_set(True); low.select_set(True); bpy.context.view_layer.objects.active = low
bpy.ops.object.bake(type="NORMAL")
img.filepath_raw = out_path; img.file_format = "PNG"; img.save()
print("BAKE wrote", out_path, size)
