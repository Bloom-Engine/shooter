"""Build the nest a nest wave grows (plan Phase 6): a mound of fused egg sacs, about 2.6 m across
and 1.9 m tall, origin at the base centre, +Y up in the export.

    blender -b -P tools/blender/build_nest.py -- assets/models/prop_nest.glb [--size 2.6] [--bake 2048]

Entirely procedural (no source model, nothing bought): metaballs fused into one skin, two
octaves of displacement, then a low mesh that takes a normal map, base colour and roughness
baked from the detailed one. Deterministic: the same seed gives the same nest.
"""
import bpy, bmesh, math, os, random, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
dst = os.path.abspath(argv[0])
opt = lambda k, d: type(d)(argv[argv.index(k) + 1]) if k in argv else d
SIZE = opt("--size", 2.6)
BAKE = opt("--bake", 2048)
rng = random.Random(opt("--seed", 5))

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def only_select(*objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


# ---- the shape: a broad mound, a ring of sacs on it, a few more piled on top
mb = bpy.data.metaballs.new("nest_mb")
mb.resolution = 0.07
mb.threshold = 0.6
ob = bpy.data.objects.new("nest_mb", mb)
sc.collection.objects.link(ob)


def ball(x, y, z, r, sx=1.0, sy=1.0, sz=1.0):
    e = mb.elements.new(type="ELLIPSOID")
    e.co = (x, y, z)
    e.radius = r
    e.size_x, e.size_y, e.size_z = sx, sy, sz


ball(0, 0, 0.15, 1.25, 1.0, 1.0, 0.55)
for i in range(7):
    a = i / 7 * math.tau + rng.uniform(-0.25, 0.25)
    d = rng.uniform(0.62, 0.86)
    ball(math.cos(a) * d, math.sin(a) * d, rng.uniform(0.35, 0.55), rng.uniform(0.42, 0.56),
         1.0, 1.0, rng.uniform(1.05, 1.35))
for i in range(4):
    a = i / 4 * math.tau + 0.6 + rng.uniform(-0.3, 0.3)
    d = rng.uniform(0.25, 0.42)
    ball(math.cos(a) * d, math.sin(a) * d, rng.uniform(0.85, 1.05), rng.uniform(0.40, 0.50),
         1.0, 1.0, rng.uniform(1.1, 1.4))
ball(0.05, -0.04, 1.42, 0.44, 1.0, 1.0, 1.35)
for i in range(9):                                  # roots running out along the ground
    a = i / 9 * math.tau + rng.uniform(-0.2, 0.2)
    d = rng.uniform(0.98, 1.22)
    ball(math.cos(a) * d, math.sin(a) * d, 0.06, rng.uniform(0.40, 0.50), 1.7, 0.75, 0.5)
    mb.elements[-1].rotation = (math.cos(a / 2), 0, 0, math.sin(a / 2))

only_select(ob)
bpy.ops.object.convert(target="MESH")
hi = bpy.context.view_layer.objects.active
hi.name = "nest_hi"
bpy.ops.object.shade_smooth()

sub = hi.modifiers.new("sub", "SUBSURF"); sub.levels = 2
for name, scale, strength, kind in (("big", 0.8, 0.20, "CLOUDS"), ("fine", 0.13, 0.05, "VORONOI")):
    tex = bpy.data.textures.new(name, kind)
    tex.noise_scale = scale
    d = hi.modifiers.new(name, "DISPLACE"); d.texture = tex; d.strength = strength; d.mid_level = 0.5
only_select(hi)
for m in list(hi.modifiers):
    bpy.ops.object.modifier_apply(modifier=m.name)

# Cut off what hangs below the ground, close the cut, stand it on z = 0 and scale to size.
bm = bmesh.new(); bm.from_mesh(hi.data)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0.0),
                       plane_no=(0, 0, 1), clear_inner=True)
bm.to_mesh(hi.data); bm.free()
w = max(hi.dimensions.x, hi.dimensions.y)
hi.scale = (SIZE / w,) * 3
bpy.ops.object.transform_apply(scale=True)

# ---- the detailed mesh's surface: dark wet hide in the folds, bone-pale ridges, sickly sacs
mat = bpy.data.materials.new("nest_hi")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
geo = nt.nodes.new("ShaderNodeNewGeometry")
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.47; ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
ramp.color_ramp.elements[1].position = 0.60; ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
nt.links.new(geo.outputs["Pointiness"], ramp.inputs["Fac"])
noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 2.2
noise.inputs["Detail"].default_value = 6
vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.inputs["Scale"].default_value = 9
hide = nt.nodes.new("ShaderNodeMixRGB")            # folds -> ridges
hide.inputs["Color1"].default_value = (0.030, 0.020, 0.018, 1)
hide.inputs["Color2"].default_value = (0.20, 0.13, 0.09, 1)
nt.links.new(ramp.outputs["Color"], hide.inputs["Fac"])
sacs = nt.nodes.new("ShaderNodeValToRGB")          # patches of sac skin, by noise
sacs.color_ramp.elements[0].position = 0.47; sacs.color_ramp.elements[0].color = (0, 0, 0, 1)
sacs.color_ramp.elements[1].position = 0.56; sacs.color_ramp.elements[1].color = (1, 1, 1, 1)
nt.links.new(noise.outputs["Fac"], sacs.inputs["Fac"])
sacmix = nt.nodes.new("ShaderNodeMixRGB")
nt.links.new(sacs.outputs["Color"], sacmix.inputs["Fac"])
nt.links.new(hide.outputs["Color"], sacmix.inputs["Color1"])
sacmix.inputs["Color2"].default_value = (0.40, 0.46, 0.06, 1)
veins = nt.nodes.new("ShaderNodeMixRGB"); veins.blend_type = "MULTIPLY"
veins.inputs["Fac"].default_value = 0.55
nt.links.new(sacmix.outputs["Color"], veins.inputs["Color1"])
nt.links.new(vor.outputs["Distance"], veins.inputs["Color2"])
nt.links.new(veins.outputs["Color"], bsdf.inputs["Base Color"])
rough = nt.nodes.new("ShaderNodeMapRange")
rough.inputs["To Min"].default_value = 0.28; rough.inputs["To Max"].default_value = 0.62
nt.links.new(ramp.outputs["Color"], rough.inputs["Value"])
nt.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
hi.data.materials.append(mat)

# ---- the low mesh
only_select(hi)
bpy.ops.object.duplicate()
lo = bpy.context.view_layer.objects.active
lo.name = "prop_nest"
dec = lo.modifiers.new("dec", "DECIMATE"); dec.ratio = min(1.0, 5000 / max(1, len(lo.data.polygons)))
bpy.ops.object.modifier_apply(modifier="dec")
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.quads_convert_to_tris()
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.shade_smooth()

lo.data.materials.clear()
lm = bpy.data.materials.new("prop_nest")
lm.use_nodes = True
lt = lm.node_tree
lb = lt.nodes["Principled BSDF"]


def target(suffix, colour):
    img = bpy.data.images.new(f"nest_{suffix}", BAKE, BAKE, alpha=False)
    if not colour:
        img.colorspace_settings.name = "Non-Color"
    node = lt.nodes.new("ShaderNodeTexImage"); node.image = img
    return img, node


img_n, tex_n = target("normal", False)
img_c, tex_c = target("basecolor", True)
img_r, tex_r = target("rough", False)
lo.data.materials.append(lm)

sc.render.engine = "CYCLES"
sc.cycles.samples = 8
sc.cycles.device = "CPU"
bk = sc.render.bake
bk.use_selected_to_active = True
bk.cage_extrusion = SIZE * 0.03
bk.max_ray_distance = SIZE * 0.12
bk.margin = 16


def bake_to(node, btype, **kw):
    only_select(hi, lo, active=lo)
    lt.nodes.active = node
    bpy.ops.object.bake(type=btype, **kw)


def emit(socket):
    """Route what feeds `socket` of the detailed material into an emission, so an EMIT bake
    captures it without lighting. Returns the undo."""
    out = nt.nodes["Material Output"]
    em = nt.nodes.new("ShaderNodeEmission")
    src = bsdf.inputs[socket].links[0].from_socket
    nt.links.new(src, em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])

    def undo():
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        nt.nodes.remove(em)
    return undo


bake_to(tex_n, "NORMAL", normal_space="TANGENT")
for socket, node in (("Base Color", tex_c), ("Roughness", tex_r)):
    undo = emit(socket)
    bake_to(node, "EMIT")
    undo()

# glTF metallic-roughness: G = roughness, B = metallic (none).
n = BAKE * BAKE
r = [0.0] * (n * 4); img_r.pixels.foreach_get(r)
orm = [1.0] * (n * 4)
orm[1::4] = r[0::4]
orm[2::4] = [0.0] * n
img_orm = bpy.data.images.new("nest_rm", BAKE, BAKE, alpha=False)
img_orm.colorspace_settings.name = "Non-Color"
img_orm.pixels.foreach_set(orm)
tex_orm = lt.nodes.new("ShaderNodeTexImage"); tex_orm.image = img_orm
sep = lt.nodes.new("ShaderNodeSeparateColor")
lt.links.new(tex_orm.outputs["Color"], sep.inputs["Color"])
lt.links.new(sep.outputs["Green"], lb.inputs["Roughness"])
lt.links.new(sep.outputs["Blue"], lb.inputs["Metallic"])
lt.links.new(tex_c.outputs["Color"], lb.inputs["Base Color"])
nmap = lt.nodes.new("ShaderNodeNormalMap")
lt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
lt.links.new(nmap.outputs["Normal"], lb.inputs["Normal"])
lt.nodes.remove(tex_r)
for img in (img_n, img_c, img_orm):
    img.filepath_raw = os.path.join(bpy.app.tempdir, img.name + ".png"); img.file_format = "PNG"; img.save()

bpy.data.objects.remove(hi)
only_select(lo)
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, export_yup=True,
                          export_apply=True, export_image_format="JPEG", export_jpeg_quality=92,
                          export_materials="EXPORT", export_vertex_color="NONE", export_tangents=True)
co = [v.co for v in lo.data.vertices]
print("NEST wrote", dst, "tris", sum(len(p.vertices) - 2 for p in lo.data.polygons), "bbox(blender)",
      [round(min(c[i] for c in co), 3) for i in range(3)], [round(max(c[i] for c in co), 3) for i in range(3)])
