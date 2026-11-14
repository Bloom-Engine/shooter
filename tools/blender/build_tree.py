"""Build one broadleaf tree for the shooter: a branching trunk with photoreal bark and leaf-cluster cards.

  blender -b -P tools/blender/build_tree.py -- <out.glb> --leaf <branch_rgba.png> [--seed 1]
        [--height 7.5] [--fork 3.3] [--spread 1.0] [--bark assets/textures/external/bark_willow_02/bark_willow_02]

The skeleton is grown, not sculpted: a leaning trunk with root flare that runs to the top of the crown
and from --fork metres up carries scaffold limbs, each carrying secondary branches and twigs (three levels), all as tapered
tubes with bark UVs in metres. A leaf cluster (two crossed cards showing a photographed branch tip,
stem at the bottom) sits on every twig and along the outer part of every branch, pointing the way
its twig grows. Leaf normals point away from the crown centre, the usual foliage trick: the crown
then shades as one rounded volume instead of a pile of flat cards.

What the game relies on (src/main.ts, src/environment.ts, src/camera.ts):
  - origin at the trunk base, +Y up, metres; trunk radius about 0.26 m at chest height and clear of
    branches below the fork (the trunk collider is a box 0.26 x 3.2 m, scaled per instance);
  - exactly TWO primitives, bark then leaves (TREE_GLB_PARTS in src/environment.ts);
  - the leaf material is alpha MASK and double sided (wind flutter applies to MASK materials);
  - no vertex colours.
Prints CANOPY y0 / y1 / r for the tables in src/camera.ts.
"""
import bpy, bmesh, sys, math, random, json, struct, os
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index("--") + 1:]
dst = a[0]
opt = lambda k, d: type(d)(a[a.index(k) + 1]) if k in a else d
seed, height, fork, spread = opt("--seed", 1), opt("--height", 7.5), opt("--fork", 3.3), opt("--spread", 1.0)
leaf_png = os.path.abspath(opt("--leaf", ""))
bark = os.path.abspath(opt("--bark", "assets/textures/external/bark_willow_02/bark_willow_02"))
rng = random.Random(seed)
R0 = 0.27                      # trunk radius at chest height
UP = Vector((0, 0, 1))

branches = []                  # (points, radii, sides)
clusters = []                  # (position, direction, size)


def perp(v):
    p = v.cross(Vector((1, 0, 0)))
    if p.length < 1e-3:
        p = v.cross(Vector((0, 1, 0)))
    return p.normalized()


def grow(start, direction, length, r_start, r_end, depth, steps):
    """One branch as a polyline that wanders a little and bends back toward the light."""
    pts, rad = [start.copy()], [r_start]
    d = direction.normalized()
    p = start.copy()
    seg = length / steps
    for i in range(steps):
        wander = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * (0.10 + 0.05 * depth)
        lift = UP * (0.10 if depth else 0.0)             # limbs curve upward, the trunk only leans
        droop = -UP * (0.05 * depth * (i / steps))      # thin wood sags toward its tip
        d = (d + wander + lift + droop).normalized()
        p = p + d * seg
        pts.append(p.copy())
        t = (i + 1) / steps
        rad.append(r_start + (r_end - r_start) * t ** 0.8)
    branches.append((pts, rad, (16, 8, 6, 5)[min(depth, 3)]))
    return pts, rad


def children(pts, rad, depth, count, start_t, angle, length, azimuth0):
    """Side branches along a parent, spiralling round it (137.5 degrees apart, as on a real shoot)."""
    for c in range(count):
        t = start_t + (1 - start_t) * (c + rng.uniform(0.2, 0.8)) / count
        f = t * (len(pts) - 1)
        i = min(int(f), len(pts) - 2)
        pos = pts[i].lerp(pts[i + 1], f - i)
        axis = (pts[i + 1] - pts[i]).normalized()
        side = Matrix.Rotation(azimuth0 + c * math.radians(137.5) + rng.uniform(-0.3, 0.3), 4, axis) @ perp(axis)
        ang = math.radians(angle + rng.uniform(-12, 12))
        d = (axis * math.cos(ang) + side * math.sin(ang)).normalized()
        r = rad[i] * (0.62 if depth == 1 else 0.55)
        ln = length * (1.0 - 0.45 * t) * rng.uniform(0.8, 1.15)
        yield pos, d, ln, r


# Trunk: ONE tube from the roots to the top of the crown, tapering all the way. (It used to stop
# at the fork with a flat cap, and the limbs started there at half its radius: a pollarded post
# with a ring round its top.) Scaffold limbs leave it between the fork height and three quarters
# of the way up, each starting at a radius the trunk still has at that height.
lean = Vector((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 1)).normalized()
crown = height - fork
trunk_pts, trunk_rad = grow(Vector((0, 0, 0)), lean, height * 0.97, R0 * 1.06, 0.03, 0, 16)
# keep the bole thick up to the fork, then taper faster through the crown
for i in range(len(trunk_rad)):
    z = trunk_pts[i].z
    if z <= fork:
        trunk_rad[i] = R0 * (1.06 - 0.22 * z / fork)
    else:
        t = (z - fork) / max(crown, 0.1)
        trunk_rad[i] = max(0.03, R0 * 0.84 * (1 - t) ** 1.25)
top = trunk_pts[-1]


def trunk_at(z):
    for i in range(len(trunk_pts) - 1):
        if trunk_pts[i + 1].z >= z:
            f = (z - trunk_pts[i].z) / max(trunk_pts[i + 1].z - trunk_pts[i].z, 1e-4)
            return trunk_pts[i].lerp(trunk_pts[i + 1], f), trunk_rad[i] + (trunk_rad[i + 1] - trunk_rad[i]) * f
    return trunk_pts[-1], trunk_rad[-1]


n_limbs = rng.choice((5, 6, 6, 7))
limbs = []
az0 = rng.uniform(0, math.tau)
for k in range(n_limbs):
    t = k / (n_limbs - 1)
    z = fork + crown * (0.02 + 0.62 * t) + rng.uniform(-0.15, 0.15)
    pos, r_here = trunk_at(z)
    az = az0 + k * math.radians(137.5) + rng.uniform(-0.3, 0.3)
    tilt = math.radians(rng.uniform(48, 68) - 22 * t)          # low limbs reach out, high ones climb
    d = Vector((math.cos(az) * math.sin(tilt), math.sin(az) * math.sin(tilt), math.cos(tilt)))
    ln = crown * rng.uniform(0.62, 0.80) * (1.0 - 0.45 * t) * (0.85 + 0.25 * spread)
    limbs.append(grow(pos, d, ln, r_here * rng.uniform(0.50, 0.62), 0.03, 1, 7))
limbs.append((trunk_pts[9:], trunk_rad[9:]))                   # the leader carries branches too

for pts, rad in limbs:
    for pos, d, ln, r in children(pts, rad, 1, rng.randint(5, 7), 0.25, 55, crown * 0.36 * spread, rng.uniform(0, 6.28)):
        spts, srad = grow(pos, d, ln, max(r, 0.03), 0.014, 2, 5)
        for tpos, td, tln, tr in children(spts, srad, 2, rng.randint(4, 6), 0.2, 50, ln * 0.55, rng.uniform(0, 6.28)):
            tpts, trad = grow(tpos, td, tln, max(tr, 0.012), 0.006, 3, 3)
            # clusters at the twig tip and along it, each pointing along the twig
            for tt in (1.0, 0.45):
                j = min(int(tt * (len(tpts) - 1)), len(tpts) - 2)
                clusters.append((tpts[j + 1] if tt == 1.0 else tpts[j].lerp(tpts[j + 1], 0.5),
                                 (tpts[j + 1] - tpts[j]).normalized(), rng.uniform(0.85, 1.25)))
        clusters.append((spts[-1], (spts[-1] - spts[-2]).normalized(), rng.uniform(1.0, 1.35)))
    clusters.append((pts[-1], (pts[-1] - pts[-2]).normalized(), rng.uniform(1.1, 1.4)))

# ---------------------------------------------------------------- bark mesh
bm = bmesh.new()
uv = bm.loops.layers.uv.new("UVMap")
BARK_TILE = 2.15    # metres of bark per texture repeat (the scan's real size)


def tube(pts, rad, sides, flare=False):
    n = len(pts)
    frames = []
    t0 = (pts[1] - pts[0]).normalized()
    u = perp(t0)
    for i in range(n):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        u = (u - t * u.dot(t)).normalized()          # parallel transport: no twisting between rings
        frames.append((t, u, t.cross(u)))
    rings, dist, d = [], [], 0.0
    for i in range(n):
        if i:
            d += (pts[i] - pts[i - 1]).length
        r = rad[i]
        if flare:                                     # roots: the bottom 0.6 m widens toward the ground
            r *= 1.0 + 0.42 * max(0.0, 1.0 - pts[i].z / 0.9) ** 2
        t, u, v = frames[i]
        ring = []
        for s in range(sides):
            ang = math.tau * s / sides
            wob = 1.0 + (0.05 * math.sin(3 * ang + i * 1.7) if sides >= 8 else 0.0)   # not a perfect circle
            if flare:                                 # five root buttresses that fade out by 0.9 m
                wob += 0.16 * max(0.0, 1.0 - pts[i].z / 0.9) ** 2 * (0.5 + 0.5 * math.sin(5 * ang + 0.7))
            ring.append(bm.verts.new(pts[i] + (u * math.cos(ang) + v * math.sin(ang)) * r * wob))
        rings.append(ring); dist.append(d)
    wraps = max(1, round(math.tau * rad[0] / BARK_TILE))
    for i in range(n - 1):
        for s in range(sides):
            s2 = (s + 1) % sides
            f = bm.faces.new((rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s]))
            f.smooth = True
            f.material_index = 0
            uvs = ((s / sides, dist[i]), ((s + 1) / sides, dist[i]), ((s + 1) / sides, dist[i + 1]), (s / sides, dist[i + 1]))
            for loop, (uu, vv) in zip(f.loops, uvs):
                loop[uv].uv = (uu * wraps, vv / BARK_TILE)
    tip = bm.verts.new(pts[-1] + frames[-1][0] * rad[-1])    # close the end
    for s in range(sides):
        f = bm.faces.new((rings[-1][s], rings[-1][(s + 1) % sides], tip))
        f.smooth = True
        for loop in f.loops:
            loop[uv].uv = (0.5 * wraps, dist[-1] / BARK_TILE)


for i, (pts, rad, sides) in enumerate(branches):
    tube(pts, rad, sides, flare=(i == 0))
bark_verts = len(bm.verts)

# ---------------------------------------------------------------- leaf cards
CARD = 0.95          # metres: the photographed branch tip is about this long
crown_c = Vector((top.x, top.y, fork + crown * 0.55))
leaf_vert_ids = []
for pos, d, size in clusters:
    s = CARD * size
    side = perp(d)
    roll = rng.uniform(0, math.pi)
    for k in range(2):                                # two cards crossed about the twig
        w = Matrix.Rotation(roll + k * math.pi / 2, 4, d) @ side
        base = pos - d * (0.06 * s)                   # the stem end overlaps the wood a little
        quad = [base - w * (s / 2), base + w * (s / 2), base + w * (s / 2) + d * s, base - w * (s / 2) + d * s]
        vs = [bm.verts.new(q) for q in quad]
        f = bm.faces.new(vs)
        f.smooth = True
        f.material_index = 1
        for loop, c in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uv].uv = c
        leaf_vert_ids += vs

me = bpy.data.meshes.new("tree")
bm.verts.index_update()
leaf_ids = [v.index for v in leaf_vert_ids]
bm.to_mesh(me)
bm.free()
ob = bpy.data.objects.new("tree", me)
bpy.context.scene.collection.objects.link(ob)

# Crown-shaped normals on the leaves (bark keeps its geometric normals).
me.calc_loop_triangles() if hasattr(me, "calc_loop_triangles") else None
normals = [v.normal.copy() for v in me.vertices]
for i in leaf_ids:
    n = me.vertices[i].co - crown_c
    n.z *= 0.7
    normals[i] = (n.normalized() * 0.8 + UP * 0.2).normalized()
me.normals_split_custom_set_from_vertices(normals)


# ---------------------------------------------------------------- materials
def image(path, colour):
    img = bpy.data.images.load(path)
    if not colour:
        img.colorspace_settings.name = "Non-Color"
    return img


mb = bpy.data.materials.new("bark"); mb.use_nodes = True
nt = mb.node_tree; bsdf = nt.nodes["Principled BSDF"]
t = nt.nodes.new("ShaderNodeTexImage"); t.image = image(bark + "_diff_2k.jpg", True)
nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
t = nt.nodes.new("ShaderNodeTexImage"); t.image = image(bark + "_rough_2k.jpg", False)
nt.links.new(t.outputs["Color"], bsdf.inputs["Roughness"])
t = nt.nodes.new("ShaderNodeTexImage"); t.image = image(bark + "_nor_gl_2k.jpg", False)
nm = nt.nodes.new("ShaderNodeNormalMap"); nt.links.new(t.outputs["Color"], nm.inputs["Color"])
nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

ml = bpy.data.materials.new("leaves"); ml.use_nodes = True
nt = ml.node_tree; bsdf = nt.nodes["Principled BSDF"]
t = nt.nodes.new("ShaderNodeTexImage"); t.image = image(leaf_png, True)
nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
bsdf.inputs["Roughness"].default_value = 0.62
ml.use_backface_culling = False
me.materials.append(mb); me.materials.append(ml)

bpy.ops.object.select_all(action="DESELECT")
ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                          export_image_format="AUTO", export_vertex_color="NONE", export_tangents=True)

# The exporter writes the leaf material as BLEND; the game needs alpha MASK, double sided.
d = open(dst, "rb").read()
jl = struct.unpack("<I", d[12:16])[0]
j = json.loads(d[20:20 + jl])
for m in j["materials"]:
    if m["name"] == "leaves":
        m["alphaMode"] = "MASK"; m["alphaCutoff"] = 0.45; m["doubleSided"] = True
    else:
        m.pop("alphaMode", None)
order = [p["material"] for p in j["meshes"][0]["primitives"]]
assert [j["materials"][i]["name"] for i in order] == ["bark", "leaves"], order
js = json.dumps(j, separators=(",", ":")).encode()
js += b" " * (-len(js) % 4)
rest = d[20 + jl:]
open(dst, "wb").write(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + len(rest)) + struct.pack("<I", len(js)) + b"JSON" + js + rest)

lv = [me.vertices[i].co for i in leaf_ids]
print("TREE", os.path.basename(dst), "seed", seed, "branches", len(branches), "clusters", len(clusters),
      "tris", sum(len(p.vertices) - 2 for p in me.polygons), "bark verts", bark_verts)
print("CANOPY y0 %.2f y1 %.2f r %.2f" % (min(v.z for v in lv), max(v.z for v in lv), max(math.hypot(v.x, v.y) for v in lv)))
