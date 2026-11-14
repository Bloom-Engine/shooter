"""Four views of a static game model in a row, with the world axes drawn at the model's origin.

  blender -b -P tools/blender/model_sheet.py -- <model.glb> <out.png> [--cell 420]

Views, left to right: from glTF +X (right side), from glTF +Z (front), from above, three-quarter.
Axis bars at the origin: red = glTF +X, green = glTF +Y (up), blue = glTF +Z. A weapon must show
its barrel running along the blue bar away from the origin; a prop must sit on the origin.
"""
import bpy, sys, math, os
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
src, dst = a[0], a[1]
cell = int(a[a.index("--cell") + 1]) if "--cell" in a else 420

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == "MESH"]
pts = [m.matrix_world @ v.co for m in meshes for v in m.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre, size = (lo + hi) / 2, max(hi - lo)


def bar(direction, colour):
    bpy.ops.mesh.primitive_cylinder_add(radius=size * 0.006, depth=size * 0.35)
    o = bpy.context.active_object
    o.location = direction * size * 0.175
    o.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    m = bpy.data.materials.new("axis"); m.use_nodes = True
    n = m.node_tree.nodes["Principled BSDF"]
    n.inputs["Base Color"].default_value = colour + (1,)
    n.inputs["Emission Color"].default_value = colour + (1,)
    n.inputs["Emission Strength"].default_value = 2.0
    o.data.materials.append(m)


# glTF +X = Blender +X, glTF +Y = Blender +Z, glTF +Z = Blender -Y.
bar(Vector((1, 0, 0)), (1.0, 0.1, 0.1))
bar(Vector((0, 0, 1)), (0.1, 1.0, 0.1))
bar(Vector((0, -1, 0)), (0.15, 0.3, 1.0))

cam_d = bpy.data.cameras.new("cam"); cam_d.type = "ORTHO"; cam_d.ortho_scale = size * 1.25
cam = bpy.data.objects.new("cam", cam_d); sc.collection.objects.link(cam); sc.camera = cam
sun_d = bpy.data.lights.new("sun", "SUN"); sun_d.energy = 3.5
sun = bpy.data.objects.new("sun", sun_d); sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(35))
world = bpy.data.worlds.new("w"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.25, 0.25, 0.27, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.2
sc.world = world
engines = [e.identifier for e in type(sc.render).bl_rna.properties["engine"].enum_items]
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
sc.render.resolution_x = sc.render.resolution_y = cell
sc.render.image_settings.file_format = "PNG"

views = [Vector((1, 0, 0.001)), Vector((0, -1, 0.001)), Vector((0.001, -0.001, 1)), Vector((1, -1, 0.6))]
tiles = []
for i, d in enumerate(views):
    cam.location = centre + d.normalized() * size * 5
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    p = os.path.join(bpy.app.tempdir, f"view_{i}.png")
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    tiles.append(p)

n = len(tiles)
sheet = bpy.data.images.new("sheet", cell * n, cell, alpha=False)
px = [0.0] * (cell * n * cell * 4)
for i, p in enumerate(tiles):
    t = list(bpy.data.images.load(p).pixels)
    for y in range(cell):
        o = (y * cell * n + i * cell) * 4
        px[o:o + cell * 4] = t[y * cell * 4:(y + 1) * cell * 4]
sheet.pixels.foreach_set(px)
sheet.filepath_raw = dst; sheet.file_format = "PNG"; sheet.save()
print("MODEL", os.path.basename(src), "bbox gltf x", round(lo.x, 3), round(hi.x, 3), "y", round(lo.z, 3), round(hi.z, 3),
      "z", round(-hi.y, 3), round(-lo.y, 3), "->", dst)
