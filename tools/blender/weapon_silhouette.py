# Side-on silhouette of a weapon model for the HUD: white on transparent, orthographic, the
# barrel (+Z in the game's weapon convention) pointing right.
#
#   blender -b -P tools/blender/weapon_silhouette.py -- in.glb out.png [width height]
#
# The picture is shaded a little (a grey ramp from a top light) so the silhouette keeps its
# inner lines when the HUD tints it; tools/gen/ui_atlas.py packs the result.
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
W = int(argv[2]) if len(argv) > 2 else 768
H = int(argv[3]) if len(argv) > 3 else 288

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']

lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        p = o.matrix_world @ Vector(c)
        for i in range(3):
            lo[i] = min(lo[i], p[i]); hi[i] = max(hi[i], p[i])
ctr = (lo + hi) * 0.5
size = hi - lo
# glTF +Z (the barrel) arrives in Blender as -Y; glTF +Y (up) as +Z. Find the long axis.
long_axis = 0 if size.x > size.y else 1

mat = bpy.data.materials.new('sil')
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial')
em = nt.nodes.new('ShaderNodeEmission')
geo = nt.nodes.new('ShaderNodeNewGeometry')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeMapRange')
ramp.inputs[1].default_value = -1.0
ramp.inputs[2].default_value = 1.0
ramp.inputs[3].default_value = 0.62
ramp.inputs[4].default_value = 1.0
nt.links.new(geo.outputs['Normal'], sep.inputs[0])
nt.links.new(sep.outputs['Z'], ramp.inputs[0])
nt.links.new(ramp.outputs[0], em.inputs['Color'])
nt.links.new(em.outputs[0], out.inputs['Surface'])
for o in meshes:
    o.data.materials.clear()
    o.data.materials.append(mat)

cam_d = bpy.data.cameras.new('c')
cam_d.type = 'ORTHO'
cam = bpy.data.objects.new('c', cam_d)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
length = size[long_axis]
height = size.z
cam_d.ortho_scale = max(length * 1.04, height * 1.04 * W / H)
if long_axis == 1:
    # barrel along -Y: look from +X so -Y is on the right
    cam.location = ctr + Vector((10, 0, 0))
    cam.rotation_euler = (math.radians(90), 0, math.radians(90))
else:
    cam.location = ctr + Vector((0, -10, 0))
    cam.rotation_euler = (math.radians(90), 0, 0)

sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
sc.render.film_transparent = True
sc.render.resolution_x = W
sc.render.resolution_y = H
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'
sc.render.filepath = dst
bpy.ops.render.render(write_still=True)
print('silhouette', dst, 'long axis', long_axis, 'size', tuple(round(v, 3) for v in size))
