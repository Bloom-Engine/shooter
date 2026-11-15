"""Turn a film-resolution tree (every leaf a mesh, millions of polygons) into a game tree.

  blender -b -P tools/blender/tree_from_scan.py -- <in.gltf> <out.glb> [--scale 1.9] [--cards 2600]
        [--tile 0.34] [--trunk-tris 9000] [--branch-tris 16000] [--seed 1] [--work <dir>]

The source is a Poly Haven tree (CC0): three materials, trunk (a scanned bole with its own
texture), branches (tiling bark) and leaves (one small mesh per leaf, about two million polygons).
A game cannot draw two million polygons 88 times, and decimating leaves destroys them. So, the way
film trees become game trees:

  - the trunk and the branches are kept as meshes and decimated (thin twigs are dropped: they are
    in the leaf pictures);
  - the crown is cut into small cells. For 16 of them the real leaves and twigs in that cell are
    photographed straight on (an orthographic render of a thin slab: colour with a little local
    shadow, coverage, and the leaves' normals) into a 4 x 4 atlas;
  - every cell with leaves in it gets two crossed cards showing one of the 16 pictures, lying in
    the plane the cell's leaves actually lie in. The crown therefore keeps the real tree's
    silhouette, its gaps and its layering;
  - each card and each piece of wood carries, as vertex colour, how much open sky reaches that
    place through the rest of the crown (marched through the leaf density). The engine multiplies
    vertex colour into albedo, which is what makes the inside of the crown dark.

What the game relies on (src/main.ts, src/environment.ts, src/camera.ts):
  - origin at the trunk base, +Y up, metres;
  - exactly THREE primitives: trunk, branches, leaves (TREE_GLB_PARTS in src/main.ts);
  - the leaf material is alpha MASK and double sided.
Prints CANOPY y0 / y1 / r for the tables in src/camera.ts and TRUNK r for the collider.
"""
import bpy, bmesh, sys, os, math, json, struct, random
import numpy as np
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index("--") + 1:]
src, dst = os.path.abspath(a[0]), os.path.abspath(a[1])
opt = lambda k, d: type(d)(a[a.index(k) + 1]) if k in a else d
SCALE = opt("--scale", 1.9)
N_CARDS = opt("--cards", 2600)
TILE = opt("--tile", 0.34)            # metres of the SOURCE tree one leaf picture covers
TRUNK_TRIS = opt("--trunk-tris", 9000)
BRANCH_TRIS = opt("--branch-tris", 16000)
SEED = opt("--seed", 1)
WOOD = opt("--wood", 0.85)            # bark brightness (the scanned boles are pale)
# ... and its hue: the scans are a cool ash grey that reads as bare concrete beside the leaves
WOOD_SKY = opt("--wood-sky", 0.25)       # how much of the sky the wood sees (see the occlusion map at the end)
WOOD_TINT = tuple(float(x) for x in opt("--wood-tint", "1.0,0.88,0.74").split(","))
# A card is drawn LARGER than the piece of tree its picture shows. These trees have leaflets of
# 1.5 cm; at fight distances a leaf was under three pixels and the reconstruction filter smeared
# the crown into streaks. Magnified, the same sprays read as leaves. (Every game tree does this.)
CARD = opt("--card", 0.52)
ACROSS = opt("--across", 0.6)
UNDER = opt("--under", 0.5)           # share of cells that also get a card seen from underneath
WORK = os.path.abspath(opt("--work", os.path.join(os.path.dirname(dst), "..", "..", "tools", ".cache", "tree_work")))
os.makedirs(WORK, exist_ok=True)
name = os.path.splitext(os.path.basename(dst))[0]
rng = random.Random(SEED)
GRID, TPX = 4, 512                    # atlas tiles per side, pixels per tile
THICK = opt("--thick", 0.20)          # depth of the slab one picture shows: thin, or a picture is a solid mat of leaves

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
whole = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="MATERIAL")
bpy.ops.object.mode_set(mode="OBJECT")
parts = {}
for o in [o for o in scene.objects if o.type == "MESH"]:
    mn = o.data.materials[0].name.lower()
    key = "leaves" if "lea" in mn else ("branches" if "branch" in mn else "trunk")
    parts[key] = o
    print("PART", key, o.data.materials[0].name, len(o.data.polygons))
leaves, branches, trunk = parts["leaves"], parts["branches"], parts["trunk"]
# The bole's colour and normal map at 4K when they have been downloaded next to the 2K ones
# (tools/gen/fetch_polyhaven.py --trunk-4k): at 2K a trunk beside the player is 200 texels a metre.
for n in trunk.data.materials[0].node_tree.nodes:
    if n.type == "TEX_IMAGE" and n.image:
        p4 = bpy.path.abspath(n.image.filepath).replace("_2k.", "_4k.")
        if p4 != bpy.path.abspath(n.image.filepath) and os.path.exists(p4):
            cs = n.image.colorspace_settings.name
            n.image = bpy.data.images.load(p4); n.image.colorspace_settings.name = cs
            print("TRUNK 4K", os.path.basename(p4))

# Stand the bole up. These trees lean, and the game's trunk collider is an upright box on the
# origin: a bole that leaves it half a metre up is cover you can shoot through. Shear the whole
# tree so the bole at chest height stands over its foot (a shear keeps every height, so the
# crown simply shifts with it).
STRAIGHT = opt("--straighten", 1.0)
tv = np.empty(len(trunk.data.vertices) * 3, np.float32); trunk.data.vertices.foreach_get("co", tv); tv = tv.reshape(-1, 3)
z0 = float(tv[:, 2].min())
foot = tv[tv[:, 2] < z0 + 0.15].mean(0)
zc = 1.4 / SCALE
band = tv[np.abs(tv[:, 2] - z0 - zc) < 0.12]
if len(band) and STRAIGHT > 0:
    lean = (band.mean(0) - foot)[:2] / zc * STRAIGHT
    sh = Matrix.Identity(4); sh[0][2] = -float(lean[0]); sh[1][2] = -float(lean[1])
    sh = Matrix.Translation((0, 0, z0)) @ sh @ Matrix.Translation((0, 0, -z0))
    for o in (leaves, branches, trunk):
        o.data.transform(sh); o.data.update()
    print("LEAN removed: %.2f m per m" % float(np.linalg.norm(lean)))


def base_image(mat):
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            l = n.inputs["Base Color"].links
            if l and l[0].from_node.type == "TEX_IMAGE":
                return l[0].from_node.image
    return next(n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE")


# ---------------------------------------------------------------- the crown as cells
lm = leaves.data
n = len(lm.polygons)
cen = np.empty(n * 3, np.float32); lm.polygons.foreach_get("center", cen); cen = cen.reshape(n, 3)
nor = np.empty(n * 3, np.float32); lm.polygons.foreach_get("normal", nor); nor = nor.reshape(n, 3)
area = np.empty(n, np.float32); lm.polygons.foreach_get("area", area)
lo, hi = cen.min(0), cen.max(0)
crown_c = (cen * area[:, None]).sum(0) / area.sum()


def cells_for(size):
    idx = np.floor((cen - lo) / size).astype(np.int64)
    dims = idx.max(0) + 1
    flat = (idx[:, 0] * dims[1] + idx[:, 1]) * dims[2] + idx[:, 2]
    return flat, dims


# pick the cell size that gives about N_CARDS cells with a useful amount of leaf in them
size = CARD * 0.4
for _ in range(24):
    flat, dims = cells_for(size)
    uniq, inv = np.unique(flat, return_inverse=True)
    a_cell = np.bincount(inv, weights=area)
    keep = a_cell > 0.12 * np.median(a_cell)
    if abs(keep.sum() - N_CARDS) < N_CARDS * 0.04:
        break
    size *= (keep.sum() / N_CARDS) ** (1 / 3)
flat, dims = cells_for(size)
uniq, inv = np.unique(flat, return_inverse=True)
nc = len(uniq)
a_cell = np.bincount(inv, weights=area)
keep = a_cell > 0.12 * np.median(a_cell)
c_cell = np.stack([np.bincount(inv, weights=cen[:, k] * area) for k in range(3)], 1) / a_cell[:, None]
d = cen - c_cell[inv]
cov = np.zeros((nc, 3, 3))
for i in range(3):
    for j in range(i, 3):
        cov[:, i, j] = cov[:, j, i] = np.bincount(inv, weights=d[:, i] * d[:, j] * area) / a_cell
w, v = np.linalg.eigh(cov)                       # ascending: v[:, :, 0] is the thin axis
out = c_cell - crown_c
out[:, 2] = out[:, 2] * 0.6 + 0.35 * np.linalg.norm(out, axis=1)      # outward, and a little up
out /= np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-6)
# Which way a card faces. NOT the plane its leaves lie in: leaves lie flat, a flat card seen from
# the ground is seen edge on, and its picture is squeezed into streaks (tried: the whole crown was
# brush strokes). A crown is looked at from outside and from underneath, so there are two families
# of card, each photographed from the side it will be seen from:
#   side  - upright, facing out of the crown and a little down toward someone on the ground;
#   under - lying flat, facing down: the ceiling of leaves seen from under the tree.
rh = c_cell - crown_c; rh[:, 2] = 0
tiny = np.linalg.norm(rh, axis=1) < 0.05
rs = np.random.RandomState(SEED)
rh[tiny] = rs.normal(size=(int(tiny.sum()), 3)) * [1, 1, 0]
rh /= np.maximum(np.linalg.norm(rh, axis=1, keepdims=True), 1e-6)
UPZ = np.array([0.0, 0.0, 1.0])


def basis(nrm):
    nrm = nrm / np.linalg.norm(nrm, axis=1, keepdims=True)
    u_ = np.cross(UPZ, nrm) if False else np.cross(np.broadcast_to(UPZ, nrm.shape), nrm)
    bad = np.linalg.norm(u_, axis=1) < 0.05
    u_[bad] = np.cross(nrm[bad], rh[bad])
    u_ /= np.linalg.norm(u_, axis=1, keepdims=True)
    return u_, np.cross(nrm, u_), nrm


# ... and a third, "across": upright like a side card but turned a quarter, so that from any
# direction one family faces the viewer. The engine thins a card out as it turns edge on
# (setCutoutEdgeFade); the other two families are what is left to see there.
FAM = {"side": basis(rh + UPZ * -0.18), "under": basis(-UPZ + rh * 0.30),
       "across": basis(np.cross(np.broadcast_to(UPZ, rh.shape), rh) + UPZ * -0.10)}
N_SIDE = 11                                       # of the 16 pictures; the rest are from underneath
print("CELLS size %.3f m  cells %d  kept %d" % (size, nc, keep.sum()))

# how much open sky reaches each place through the rest of the crown
dens = np.zeros(tuple(dims + 2), np.float32)
ci = np.stack([uniq // (dims[1] * dims[2]), (uniq // dims[2]) % dims[1], uniq % dims[2]], 1) + 1
dens[ci[:, 0], ci[:, 1], ci[:, 2]] = a_cell / (size * size)          # leaf area per cell face: optical depth of one cell
DIRS = []
for el, cnt in ((85, 1), (55, 6), (25, 8)):
    for k in range(cnt):
        az = math.tau * (k + 0.5 * (el == 25)) / cnt
        DIRS.append((math.cos(math.radians(el)) * math.cos(az), math.cos(math.radians(el)) * math.sin(az), math.sin(math.radians(el)), math.sin(math.radians(el)) + 0.25))
K_EXT = 0.55


def sky_open(points):
    """Share of the sky dome that reaches each point (N x 3, source metres)."""
    p = np.asarray(points, np.float64)
    tot = np.zeros(len(p)); wsum = 0.0
    for dx, dy, dz, wt in DIRS:
        od = np.zeros(len(p))
        for s in range(1, 40):
            q = np.floor((p + np.array([dx, dy, dz]) * (s * size * 0.8) - lo) / size).astype(np.int64) + 1
            ok = ((q >= 0) & (q < np.array(dens.shape))).all(1)
            od[ok] += dens[q[ok, 0], q[ok, 1], q[ok, 2]] * 0.8
        tot += np.exp(-K_EXT * od) * wt; wsum += wt
    return tot / wsum


open_cell = sky_open(c_cell)
print("SKY open: min %.2f median %.2f max %.2f" % (open_cell[keep].min(), np.median(open_cell[keep]), open_cell[keep].max()))

# ---------------------------------------------------------------- photograph 16 cells
scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = TPX
scene.render.resolution_percentage = 100
scene.render.use_persistent_data = True
scene.render.image_settings.file_format = "OPEN_EXR"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "32"
scene.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("w"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
trunk.hide_render = True


def emit_material(src_mat, mode):
    m = bpy.data.materials.new(src_mat.name + "_" + mode); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial"); e = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(e.outputs[0], o.inputs["Surface"])
    if mode == "colour":
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = base_image(src_mat)
        ao = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao.inputs["Distance"].default_value = 0.05; ao.samples = 8
        ramp = nt.nodes.new("ShaderNodeMapRange")
        ramp.inputs["To Min"].default_value = 0.42; ramp.inputs["To Max"].default_value = 1.0
        nt.links.new(ao.outputs["AO"], ramp.inputs["Value"])
        mul = nt.nodes.new("ShaderNodeVectorMath"); mul.operation = "SCALE"
        nt.links.new(t.outputs["Color"], mul.inputs[0]); nt.links.new(ramp.outputs[0], mul.inputs["Scale"])
        nt.links.new(mul.outputs[0], e.inputs["Color"])
    else:
        g = nt.nodes.new("ShaderNodeNewGeometry")
        ma = nt.nodes.new("ShaderNodeVectorMath"); ma.operation = "MULTIPLY_ADD"
        ma.inputs[1].default_value = (0.5, 0.5, 0.5); ma.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(g.outputs["Normal"], ma.inputs[0]); nt.links.new(ma.outputs[0], e.inputs["Color"])
    return m


orig = {o: o.data.materials[0] for o in (leaves, branches)}
mats = {mode: {o: emit_material(orig[o], mode) for o in orig} for mode in ("colour", "normal")}
cam_d = bpy.data.cameras.new("c"); cam_d.type = "ORTHO"; cam_d.ortho_scale = TILE
cam_d.clip_start = 0.001; cam_d.clip_end = THICK + 0.002
cam = bpy.data.objects.new("c", cam_d); scene.collection.objects.link(cam); scene.camera = cam

# the 16 cells: leafy, flat enough to photograph, spread over the crown
def pick(score, count, taken):
    got = []
    for i in np.argsort(-score):
        if all(np.linalg.norm(c_cell[i] - c_cell[j]) > size * 2.5 for j in got + taken):
            got.append(int(i))
        if len(got) == count:
            break
    return got


p_side = pick(a_cell * keep * (0.25 + open_cell), N_SIDE, [])
p_under = pick(a_cell * keep * (1.2 - open_cell), GRID * GRID - N_SIDE, p_side)
protos = [(i, "side") for i in p_side] + [(i, "under") for i in p_under]


def read_exr(path):
    img = bpy.data.images.load(path)
    px = np.empty(TPX * TPX * 4, np.float32); img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(TPX, TPX, 4)


def bleed(rgb, alpha, rounds=48):
    """Spread known colour into the transparent texels so mip-mapping shows no dark fringe."""
    known = alpha > 0.5
    acc = rgb * known[..., None]
    for _ in range(rounds):
        s = np.zeros_like(acc); c = np.zeros(known.shape, np.float32)
        for ax, sh in ((0, 1), (0, -1), (1, 1), (1, -1)):
            s += np.roll(acc, sh, ax); c += np.roll(known, sh, ax)
        new = (~known) & (c > 0)
        acc[new] = s[new] / c[new][:, None]
        known = known | new
    acc[~known] = acc[known].mean(0) if known.any() else 0.2
    return acc


A = GRID * TPX
atlas_c = np.zeros((A, A, 4), np.float32); atlas_n = np.zeros((A, A, 3), np.float32)
cover = []
for t, (i, fam) in enumerate(protos):
    b1, b2, b3 = (ax[i] for ax in FAM[fam])
    R = Matrix((b1, b2, b3)).transposed().to_4x4()
    R.translation = Vector(c_cell[i]) + Vector(b3) * (THICK * 0.5)
    cam.matrix_world = R
    tiles = {}
    for mode in ("colour", "normal"):
        for o in orig:
            o.data.materials[0] = mats[mode][o]
        scene.render.filepath = os.path.join(WORK, "%s_%s_%02d.exr" % (name, mode, t))
        bpy.ops.render.render(write_still=True)
        tiles[mode] = read_exr(scene.render.filepath)
    al = np.clip(tiles["colour"][..., 3], 0, 1)
    col = tiles["colour"][..., :3] / np.maximum(al, 1e-4)[..., None]
    nw = tiles["normal"][..., :3] / np.maximum(tiles["normal"][..., 3], 1e-4)[..., None] * 2.0 - 1.0
    nt_ = np.stack([nw @ b1, nw @ b2, np.abs(nw @ b3)], -1)
    nt_[..., 2] = np.maximum(nt_[..., 2], 0.25)                       # no texel shades as if seen edge on
    nt_ /= np.maximum(np.linalg.norm(nt_, axis=-1, keepdims=True), 1e-6)
    # A picture ends where its square ends, and a crown made of squares shows it. Let each picture
    # end in a ragged outline of its own instead: leaves near the border survive or go as a whole
    # patch, never along a straight line.
    yy, xx = np.mgrid[0:TPX, 0:TPX] / (TPX - 1.0) * 2.0 - 1.0
    ph = [rng.uniform(0, 6.28) for _ in range(6)]
    wob = (np.sin(xx * 5.1 + ph[0]) * np.sin(yy * 4.3 + ph[1]) + 0.6 * np.sin(xx * 11.0 + ph[2]) * np.sin(yy * 9.4 + ph[3])
           + 0.4 * np.sin((xx + yy) * 17.0 + ph[4]) * np.sin((xx - yy) * 15.0 + ph[5]))
    edge = np.maximum(np.abs(xx), np.abs(yy)) * 0.6 + np.hypot(xx, yy) * 0.4 + wob * 0.07
    al = al * np.clip((0.93 - edge) / 0.06, 0.0, 1.0)
    col = bleed(col, tiles["colour"][..., 3]); nt_ = bleed(nt_, tiles["colour"][..., 3])
    ty, tx = divmod(t, GRID)
    atlas_c[ty * TPX:(ty + 1) * TPX, tx * TPX:(tx + 1) * TPX, :3] = col
    atlas_c[ty * TPX:(ty + 1) * TPX, tx * TPX:(tx + 1) * TPX, 3] = al
    atlas_n[ty * TPX:(ty + 1) * TPX, tx * TPX:(tx + 1) * TPX] = nt_ * 0.5 + 0.5
    cover.append(float((al > 0.5).mean()))
print("TILES coverage", " ".join("%.2f" % c for c in cover))
for o in orig:
    o.data.materials[0] = orig[o]


def to_image(arr, nm, colour):
    h, w_, ch = arr.shape
    img = bpy.data.images.new(nm, w_, h, alpha=(ch == 4), float_buffer=False)
    if ch == 3:
        arr = np.dstack([arr, np.ones((h, w_), np.float32)])
    if colour:                                    # linear -> sRGB bytes
        rgb = np.clip(arr[..., :3], 0, 1)
        arr = np.dstack([np.where(rgb < 0.0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - 0.055), arr[..., 3]])
    else:
        img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    img.filepath_raw = os.path.join(WORK, nm + ".png"); img.file_format = "PNG"; img.save()
    img = bpy.data.images.load(img.filepath_raw)
    if not colour:
        img.colorspace_settings.name = "Non-Color"
    return img


# Blender stores sRGB images as display values: write the colour atlas already encoded and load it back.
img_c = to_image(atlas_c, name + "_leaf_colour", True)
img_n = to_image(atlas_n, name + "_leaf_normal", False)

# ---------------------------------------------------------------- the wood, reduced
def reduce(ob, tris, min_island=0.0):
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    if min_island > 0:                           # drop loose twigs: they are in the leaf pictures
        bm_ = bmesh.new(); bm_.from_mesh(ob.data); bm_.verts.ensure_lookup_table()
        seen = set(); kill = []
        for v0 in bm_.verts:
            if v0.index in seen:
                continue
            stack, isl = [v0], []
            seen.add(v0.index)
            while stack:
                x = stack.pop(); isl.append(x)
                for e in x.link_edges:
                    y = e.other_vert(x)
                    if y.index not in seen:
                        seen.add(y.index); stack.append(y)
            xs = [p.co for p in isl]
            ext = max(max(c[k] for c in xs) - min(c[k] for c in xs) for k in range(3))
            if ext < min_island:
                kill += isl
        bmesh.ops.delete(bm_, geom=kill, context="VERTS")
        bm_.to_mesh(ob.data); bm_.free()
    cur = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if cur > tris:
        m = ob.modifiers.new("d", "DECIMATE"); m.ratio = tris / cur
        bpy.ops.object.modifier_apply(modifier="d")
    print("WOOD", ob.name, cur, "->", sum(len(p.vertices) - 2 for p in ob.data.polygons))


reduce(trunk, TRUNK_TRIS)
reduce(branches, BRANCH_TRIS, min_island=0.45)


def paint(ob, values, tint=(1.0, 1.0, 1.0)):
    """Vertex colour = how open the place is. The engine multiplies it into albedo."""
    me = ob.data
    col = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get("vertex_index", lv)
    c = values[lv]
    col.data.foreach_set("color", np.stack([c * tint[0], c * tint[1], c * tint[2], np.ones_like(c)], 1).astype(np.float32).ravel())
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = me.color_attributes.find("Col")


for ob in (trunk, branches):
    co = np.empty(len(ob.data.vertices) * 3, np.float32); ob.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    o_ = sky_open(co)
    shade = (0.50 + 0.50 * o_) * WOOD
    # the foot of the trunk stands in the grass and in its own shade: darker over the first 0.4 m
    shade *= 0.52 + 0.48 * np.clip((co[:, 2] - co[:, 2].min()) / 0.4, 0, 1) ** 0.7
    paint(ob, shade.astype(np.float32), WOOD_TINT)

# ---------------------------------------------------------------- the leaf cards
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
col_l = bm.loops.layers.color.new("Col")
ids = np.where(keep)[0]
a_rank = np.argsort(np.argsort(a_cell[ids])) / max(len(ids) - 1, 1)
cover = np.array(cover)
fam_tiles = {"side": list(range(N_SIDE)), "under": list(range(N_SIDE, GRID * GRID)), "across": list(range(N_SIDE))}
custom_n = []
n_cards = 0
for r, i in zip(a_rank, ids):
    c = Vector(c_cell[i])
    shade = 0.42 + 0.58 * float(open_cell[i]) ** 0.85
    shade *= rng.uniform(0.9, 1.08)
    hue = rng.uniform(-0.05, 0.05)                 # warmer or cooler than its neighbours
    vc = (min(1.0, shade * (1 + hue)), min(1.0, shade), min(1.0, shade * (1 - hue * 1.5)), 1.0)
    outw = Vector(out[i])
    for fam in ("side", "across", "under"):
        if fam != "side" and rng.random() > (UNDER if fam == "under" else ACROSS):
            continue
        tl = fam_tiles[fam]
        cr = np.argsort(np.argsort(cover[tl])) / max(len(tl) - 1, 1)      # leafier cell, leafier picture
        t = tl[int(np.argmin(np.abs(cr - np.clip(r + rng.uniform(-0.35, 0.35), 0, 1))))]
        ty, tx = divmod(t, GRID)
        u_ax, v_ax, n_ax = (Vector(ax[i]) for ax in FAM[fam])
        spin = Matrix.Rotation(rng.uniform(-0.5, 0.5) if fam != "under" else rng.uniform(0, math.tau), 3, n_ax)
        u_ax, v_ax = spin @ u_ax, spin @ v_ax
        if fam != "under":                         # not all in one row: turn each a little about the vertical
            yaw = Matrix.Rotation(rng.uniform(-0.45, 0.45), 3, Vector((0, 0, 1)))
            u_ax, v_ax, n_ax = yaw @ u_ax, yaw @ v_ax, yaw @ n_ax
        h = CARD * (0.92 + 0.30 * r) * rng.uniform(0.9, 1.1) / 2
        fu = rng.choice((1, -1))
        corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        vs = [bm.verts.new(c + u_ax * (cu * h) + v_ax * (cv * h)) for cu, cv in corners]
        f = bm.faces.new(vs); f.smooth = True; f.material_index = 0
        for loop, (cu, cv) in zip(f.loops, corners):
            loop[uvl].uv = ((tx + 0.5 + 0.5 * cu * fu * 0.985) / GRID, (ty + 0.5 + 0.5 * cv * 0.985) / GRID)
            loop[col_l] = vc
        for cu, cv in corners:                     # a card shades as a slightly domed piece of the crown
            nn = (n_ax * 0.35 + outw * 0.65) if fam == "side" else (outw * 0.8 + n_ax * (0.2 if fam == "under" else 0.0))
            custom_n.append((nn + (u_ax * cu + v_ax * cv) * 0.22).normalized())
        n_cards += 1
lme = bpy.data.meshes.new("leafcards"); bm.to_mesh(lme); bm.free()
lme.normals_split_custom_set_from_vertices(custom_n)
cards = bpy.data.objects.new("leafcards", lme); scene.collection.objects.link(cards)
ml = bpy.data.materials.new("leaves"); ml.use_nodes = True
nt = ml.node_tree; bsdf = nt.nodes["Principled BSDF"]
t = nt.nodes.new("ShaderNodeTexImage"); t.image = img_c
nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"]); nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
t = nt.nodes.new("ShaderNodeTexImage"); t.image = img_n
nm_ = nt.nodes.new("ShaderNodeNormalMap"); nt.links.new(t.outputs["Color"], nm_.inputs["Color"])
nt.links.new(nm_.outputs["Normal"], bsdf.inputs["Normal"])
bsdf.inputs["Roughness"].default_value = 0.55
ml.use_backface_culling = False
lme.materials.append(ml)
lme.color_attributes.active_color = lme.color_attributes["Col"]
lme.color_attributes.render_color_index = lme.color_attributes.find("Col")

# ---------------------------------------------------------------- one object, three primitives
trunk.data.materials[0].name = "trunk"; branches.data.materials[0].name = "branches"
bpy.data.objects.remove(leaves, do_unlink=True)
bpy.ops.object.select_all(action="DESELECT")
for o in (trunk, branches, cards):
    o.select_set(True)
bpy.context.view_layer.objects.active = trunk
bpy.ops.object.join()
tree = bpy.context.view_layer.objects.active
co = np.empty(len(tree.data.vertices) * 3, np.float32); tree.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
low = co[co[:, 2] < co[:, 2].min() + 0.25]
# --sink: some scans come with a slab of the ground they stood on; it goes under the terrain.
base = Vector((float(low[:, 0].mean()), float(low[:, 1].mean()), float(co[:, 2].min()) + 0.02 + opt("--sink", 0.0)))
tree.data.transform(Matrix.Scale(SCALE, 4) @ Matrix.Translation(-base))
tree.data.update()
bpy.ops.object.select_all(action="DESELECT"); tree.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                          export_image_format="AUTO", export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                          export_tangents=True)

d = open(dst, "rb").read()
jl = struct.unpack("<I", d[12:16])[0]
j = json.loads(d[20:20 + jl])
for m in j["materials"]:
    if m["name"] == "leaves":
        m["alphaMode"] = "MASK"; m["alphaCutoff"] = 0.42; m["doubleSided"] = True
    else:
        m.pop("alphaMode", None); m["doubleSided"] = False
prims = j["meshes"][0]["primitives"]
prims.sort(key=lambda p: ["trunk", "branches", "leaves"].index(j["materials"][p["material"]]["name"]))
assert [j["materials"][p["material"]]["name"] for p in prims] == ["trunk", "branches", "leaves"]
assert all("COLOR_0" in p["attributes"] for p in prims), "vertex colours did not export"
# Wood under a crown sees little of the sky, but the engine gives every surface the whole sky's
# mirror reflection unless a glTF occlusion map says otherwise. On bark that reflection was
# several times brighter than the bark's own colour: every trunk was pale ash grey whatever its
# texture (tinting the wood pure red gave pink). A flat occlusion map (one grey value, WOOD_SKY)
# takes it and the sky's diffuse share down together; the sun and the scene's ambient are untouched.
import zlib
def flat_png(v):
    raw = b"".join(b"\x00" + bytes([v, v, v]) * 4 for _ in range(4))
    chunk = lambda t, c: struct.pack(">I", len(c)) + t + c + struct.pack(">I", zlib.crc32(t + c) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
bin_len = struct.unpack("<I", d[20 + jl:24 + jl])[0]
bin_data = d[28 + jl:28 + jl + bin_len]
png = flat_png(int(round(WOOD_SKY * 255)))
bin_data += b"\x00" * (-len(bin_data) % 4)
j["bufferViews"].append({"buffer": 0, "byteOffset": len(bin_data), "byteLength": len(png)})
bin_data += png + b"\x00" * (-len(png) % 4)
j["buffers"][0]["byteLength"] = len(bin_data)
j["images"].append({"bufferView": len(j["bufferViews"]) - 1, "mimeType": "image/png", "name": "wood_sky"})
j["textures"].append({"source": len(j["images"]) - 1})
for m in j["materials"]:
    if m["name"] != "leaves":
        m["occlusionTexture"] = {"index": len(j["textures"]) - 1}
js = json.dumps(j, separators=(",", ":")).encode()
js += b" " * (-len(js) % 4)
open(dst, "wb").write(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(bin_data)) + struct.pack("<I", len(js)) + b"JSON" + js
                      + struct.pack("<I", len(bin_data)) + b"BIN\x00" + bin_data)

lc = (c_cell[ids] - np.array(base)) * SCALE
tr = co[(co[:, 2] - base.z > 0.2 / SCALE) & (co[:, 2] - base.z < 2.2 / SCALE) & (np.hypot(co[:, 0] - base.x, co[:, 1] - base.y) < 1.2 / SCALE)]
print("TREE", os.path.basename(dst), "cells", len(ids), "cards", n_cards, "tris",
      [acc["count"] // 3 for acc in (j["accessors"][p["indices"]] for p in prims)], "MB %.1f" % (os.path.getsize(dst) / 1e6))
print("CANOPY y0 %.2f y1 %.2f r %.2f" % (lc[:, 2].min(), lc[:, 2].max() + CARD * SCALE * 0.5,
                                         np.percentile(np.hypot(lc[:, 0], lc[:, 1]), 97)))
print("TRUNK r %.2f (game metres: the widest the wood gets within 2.2 m of the ground)" % (float(np.hypot(tr[:, 0] - base.x, tr[:, 1] - base.y).max()) * SCALE if len(tr) else 0))
