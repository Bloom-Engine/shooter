"""Render a tree model to one RGBA card for the far tree line (plan 3.2).

  blender -b -P tools/blender/tree_impostor.py -- <tree.glb> <out.png> [--size 1024]

Orthographic, from the side, transparent film. Lit softly from above and in front so the crown
keeps its volume; the game's card shader lights it again with the arena's sun, so the bake is
kept flat (strong sky, weak sun). The tree fills the frame with its base on the bottom edge
and its trunk on the vertical centre line, which is what `src/flora.ts` assumes.
"""
import bpy, sys, math
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
src, dst = a[0], a[1]
size = int(a[a.index("--size") + 1]) if "--size" in a else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
for o in obs:
    for c in o.bound_box:
        p = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
h = hi.z - lo.z
half = max(h, hi.x - lo.x, hi.y - lo.y) / 2
print("TREE extents: height %.2f, frame %.2f wide" % (h, 2 * half))

cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; cam.ortho_scale = 2 * half
co = bpy.data.objects.new("c", cam); bpy.context.scene.collection.objects.link(co)
co.location = (0, -60, lo.z + half); co.rotation_euler = (math.radians(90), 0, 0)
bpy.context.scene.camera = co

sun = bpy.data.lights.new("s", "SUN"); sun.energy = 1.6; sun.angle = math.radians(20)
so = bpy.data.objects.new("s", sun); bpy.context.scene.collection.objects.link(so)
so.rotation_euler = (math.radians(50), 0, math.radians(25))
w = bpy.data.worlds.new("w"); bpy.context.scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.1

sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.samples = 48; sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = size
sc.view_settings.view_transform = "Standard"
sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
sc.render.filepath = dst
bpy.ops.render.render(write_still=True)
