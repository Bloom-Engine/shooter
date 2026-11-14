#!/usr/bin/env python3
"""Dress an arena (plan 3.1 / 3.3): shape the river banks, place rocks, logs and stumps, paint
the ground. Everything it writes goes into the world file, so the editor can move it afterwards.

  tools/gen/dress_arena.py <arena_id> [--seed N] [--no-banks] [--no-props] [--no-paint]

Re-runnable: it removes what it placed before (entities whose id starts with `dress_`) and
repaints all four splat layers from scratch. Run `bun tools/build-terrain.ts <world> <glb>`
afterwards when the banks changed, because the terrain's drawn mesh is built from the heights.

1. BANKS. The channel was a ruler-straight trench 5 m wide with the water plane ending in mid-air
   over its bed. Each side now gets its own shoreline, 1.9 to 4.3 m from the centre line, with the
   bed ramping up to 16 cm above the water there; ground further out that lay below the water
   level is lifted. The drawn water plane is 5 m wider than the water volume (environment.ts), so
   the shoreline is wherever the ground crosses the surface.
2. PROPS. `static_mesh` entities with `yaw` (degrees, which the game draws and collides with) and
   box colliders measured from the model, scaled. `obst=1` makes the creatures steer round them.
   River stones are drawn only.
3. PAINT. terrain.layers, in the game's slot order (lush grass, forest floor, mud, rock):
   forest floor under every tree and log, a mud trail from the spawn round the pickups, worn
   patches where things stand, rock scree round boulders and along the shore.
"""
import json, math, os, random, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import worldio

arena = sys.argv[1]
opt = lambda k, d: type(d)(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
SEED = opt("--seed", 7)
rng = random.Random(SEED * 1000 + sum(map(ord, arena)))

# Hand-placed pieces per arena: (model, x, z, yaw degrees, scale).
EXTRA = {
    "arena_02": [
        ("prop_sandbags", -17.2, 1.6, 0, 1.0), ("prop_sandbags", -25.0, 1.9, 8, 1.0),
        ("prop_barrier", 3.5, -7.0, 24, 1.0), ("prop_barrier", 6.0, -5.6, 31, 1.0),
        ("prop_generator", -6.6, -5.2, 90, 1.0), ("prop_worklight", -7.4, -2.6, 200, 1.0),
        ("log_fallen", 9.5, 4.0, -18, 1.0),
        # indoors (the house spans x -33..-9, z -21..-5; floors at y 0.2 and 3.9)
        ("prop_shelf", -32.35, -12.0, 90, 1.0, 0.2), ("prop_locker", -27.5, -20.4, 0, 1.0, 0.2),
        ("prop_shelf", -23.5, -20.4, 0, 1.0, 0.2), ("prop_worklight", -11.0, -18.6, 135, 1.0, 0.2),
        ("prop_locker", -32.35, -16.0, 90, 1.0, 3.9), ("prop_shelf", -19.5, -20.4, 0, 1.0, 3.9),
        ("prop_worklight", -30.5, -6.6, 40, 1.0, 3.9),
    ],
    "arena_03": [
        ("prop_barrier", 7.5, 22.0, 80, 1.0), ("prop_sandbags", 9.8, 19.6, 20, 1.0),
        ("prop_generator", 12.5, 23.5, 0, 1.0), ("prop_worklight", 11.0, 25.2, 250, 1.0),
        ("log_fallen", -8.0, 6.0, 64, 1.0), ("log_fallen", 6.5, -9.0, -30, 1.1),
    ],
    "arena_04": [
        # the road: a burnt-out truck and a chicane of barriers east of it
        ("prop_wreck", -3.0, 4.6, 14, 1.0), ("prop_barrier", 7.5, 6.5, 4, 1.0),
        ("prop_barrier", 11.6, 3.6, -6, 1.0), ("prop_barrier", 16.2, 6.4, 12, 1.0),
        # the yard in front of the guard post (x 2..14, z -16..-8; door on the south face)
        ("prop_sandbags", 5.4, -5.6, 0, 1.0), ("prop_sandbags", 10.8, -5.4, 0, 1.0),
        ("prop_sandbags", -9.0, -3.0, 70, 1.0), ("prop_sandbags", -17.2, 2.6, 90, 1.0),
        ("prop_generator", 15.8, -9.4, 90, 1.0), ("prop_worklight", 15.0, -6.0, 215, 1.0),
        ("prop_worklight", 1.6, 8.6, 160, 1.0), ("prop_worklight", -15.5, 9.6, 250, 1.0),
        ("prop_worklight", 20.5, 0.5, 280, 1.0),
        # indoors (floor at y 0.2)
        ("prop_shelf", 4.4, -15.4, 0, 1.0, 0.2), ("prop_locker", 13.35, -12.2, 90, 1.0, 0.2),
        ("prop_worklight", 11.2, -14.8, 320, 1.0, 0.2),
    ],
}
# World lights with no lamp to come from: removed, now that the ground and the house are lit by
# point lights too (a warm pool on the grass at noon with nothing above it reads as a bug).
DROP_LIGHTS = {"arena_04": (),
               "arena_02": ("light_plaza_n", "light_plaza_s", "light_hill_ne"),
               "arena_03": ("light_saddle_n", "light_saddle_s", "light_spawn")}
# Scattered nature: model -> (count, min scale, max scale, clearance radius in metres at scale 1)
NATURE = {
    "rock_boulder": (7, 0.7, 1.35, 1.3), "rock_outcrop": (5, 0.8, 1.3, 1.7),
    "log_fallen": (4, 0.85, 1.15, 1.9), "stump": (9, 0.8, 1.4, 0.7),
}
# What the creatures steer round and how much of the model's bounds the collider keeps.
SHRINK = {"rock_boulder": 0.72, "rock_outcrop": 0.78, "log_fallen": 0.9, "stump": 0.62,
          "prop_worklight": 0.35, "prop_wreck": 0.9}
SINK = {"rock_boulder": 0.10, "rock_outcrop": 0.12, "log_fallen": 0.06, "stump": 0.04, "rock_stone": 0.30}

w = worldio.load(arena)
T = w["terrain"]
N, CS = T["width"], T["cellSize"]
OX, OY, OZ = T["origin"]
H = T["heights"]
ents = w["entities"]
kind = lambda e: e.get("userData", {}).get("kind")


def hraw(i, j):
    return H[min(max(j, 0), N - 1) * N + min(max(i, 0), N - 1)]


def height(x, z, src=None):
    g = src or H
    fx, fz = (x - OX) / CS, (z - OZ) / CS
    fx, fz = min(max(fx, 0), N - 1.001), min(max(fz, 0), N - 1.001)
    i, j = int(fx), int(fz)
    tx, tz = fx - i, fz - j
    a, b = g[j * N + i], g[j * N + i + 1]
    c, d = g[(j + 1) * N + i], g[(j + 1) * N + i + 1]
    return OY + (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz


def smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def hash1(n):
    s = math.sin(n * 127.1 + SEED * 13.7) * 43758.5453
    return s - math.floor(s)


def noise1(x):
    i = math.floor(x)
    f = x - i
    u = f * f * (3 - 2 * f)
    return hash1(i) * (1 - u) + hash1(i + 1) * u


def noise2(x, z):
    i, j = math.floor(x), math.floor(z)
    fx, fz = x - i, z - j
    ux, uz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    h = lambda a, b: hash1(a * 57.0 + b * 131.0)
    return (h(i, j) * (1 - ux) + h(i + 1, j) * ux) * (1 - uz) + (h(i, j + 1) * (1 - ux) + h(i + 1, j + 1) * ux) * uz


# ---- the river --------------------------------------------------------------------------
water = w["water"][0] if w.get("water") else None
if water:
    ALONG_X = water["size"][0] >= water["size"][2]
    RC = water["center"][2] if ALONG_X else water["center"][0]      # centre line coordinate
    WATER_Y = water["center"][1] + water.get("surfaceHeight", 0.05)  # what environment.ts draws at
    RHALF = (water["size"][0] if ALONG_X else water["size"][2]) / 2


def flow_coords(x, z):
    """(along, across) in metres; across is signed."""
    return (x, z - RC) if ALONG_X else (z, x - RC)


def shore(along, side):
    """Distance of the shoreline from the centre line on one side (side = +1 / -1)."""
    o = 31.7 if side > 0 else 77.3
    n = noise1(along * 0.085 + o) * 0.65 + noise1(along * 0.31 + o * 2.0) * 0.35
    return 1.9 + 2.4 * n


if water and "--no-banks" not in sys.argv:
    old = list(H)
    BED = min(old)
    for j in range(N):
        for i in range(N):
            x, z = OX + i * CS, OZ + j * CS
            al, ac = flow_coords(x, z)
            a = abs(ac)
            if a > 9.5 or abs(al) > RHALF + 2:
                continue
            # How much of a channel there is at this station (it fades out at the arena ends).
            centre = height(al, RC, old) if ALONG_X else height(RC, al, old)
            chan = smooth(0.0, 0.35, WATER_Y - centre)
            if chan <= 0:
                continue
            s = shore(al, 1 if ac >= 0 else -1)
            e = old[j * N + i]
            lip = WATER_Y + 0.16
            ripple = (noise2(x * 0.9, z * 0.9) - 0.5) * 0.07
            if a <= s + 0.5:
                # Bed, then the ramp up to the lip. A shelf a hand deep under the shoreline keeps
                # the first half metre of water shallow enough to see the bed and take foam.
                t = smooth(s - 1.7, s + 0.5, a)
                new = BED + (lip - BED) * t + ripple * t
            else:
                keep = 1.0 - smooth(6.0, 9.0, a)
                new = max(e, lip * keep + e * (1 - keep)) if e < lip else e
                new += ripple * (1.0 - smooth(s + 0.5, s + 2.0, a))
            H[j * N + i] = round(e + (new - e) * chan, 4)
    moved = 0
    for e in ents:
        if kind(e) in ("prop_tree", "weapon_pickup", "enemy_spawner") or (
                kind(e) == "static_mesh" and "collider" in e["userData"] and "terrain" not in e["tags"]
                and "building" not in e["tags"]):
            p = e["transform"]["position"]
            d = height(p[0], p[2]) - height(p[0], p[2], old)
            if abs(d) > 0.01:
                p[1] = round(p[1] + d, 4)
                moved += 1
    print(f"banks: shaped, {moved} entities re-seated")


# ---- props ------------------------------------------------------------------------------
def glb_bounds(path):
    with open(path, "rb") as f:
        f.seek(12)
        n = struct.unpack("<I", f.read(4))[0]
        f.read(4)
        g = json.loads(f.read(n))
    lo, hi = [1e9] * 3, [-1e9] * 3
    for m in g["meshes"]:
        for p in m["primitives"]:
            a = g["accessors"][p["attributes"]["POSITION"]]
            lo = [min(lo[k], a["min"][k]) for k in range(3)]
            hi = [max(hi[k], a["max"][k]) for k in range(3)]
    return lo, hi


BOUNDS = {}


def bounds(model):
    if model not in BOUNDS:
        BOUNDS[model] = glb_bounds(f"assets/models/{model}.glb")
    return BOUNDS[model]


def keep_clear(x, z, r):
    """True if a prop of radius r may NOT stand here."""
    if max(abs(x), abs(z)) > 37 - r:
        return True
    for e in ents:
        k = kind(e)
        p = e["transform"]["position"]
        d = math.hypot(p[0] - x, p[2] - z)
        if k == "player_spawn" and d < 5.5 + r: return True
        if k == "weapon_pickup" and d < 2.6 + r: return True
        if k == "enemy_spawner" and d < 4.5 + r: return True
        if k == "prop_tree" and d < 1.3 + r: return True
        if k == "static_mesh":
            if "terrain" in e["tags"]:
                continue
            he = [float(v) for v in e["userData"].get("halfExtents", "0.5,0.5,0.5").split(",")]
            m = 2.2 if "building" in e["tags"] else 0.9
            if abs(p[0] - x) < he[0] + m + r and abs(p[2] - z) < he[2] + m + r:
                return True
    if water:
        al, ac = flow_coords(x, z)
        if abs(al) < RHALF + 3 and abs(ac) < shore(al, 1 if ac >= 0 else -1) + 1.3 + r:
            return True
    hs = [height(x + dx, z + dz) for dx, dz in ((r, 0), (-r, 0), (0, r), (0, -r))]
    return max(hs) - min(hs) > 0.55 * max(r, 0.8)


def place(model, x, z, yaw, scale, idx, collide=True, y=None):
    lo, hi = bounds(model)
    hy = (hi[1] - lo[1]) * scale
    indoors = y is not None
    if y is None:
        y = height(x, z) - hy * SINK.get(model, 0.0)
    user = {"yaw": round(yaw, 1)}
    if collide:
        k = SHRINK.get(model, 0.92)
        hx, hz = (hi[0] - lo[0]) / 2 * scale * k, (hi[2] - lo[2]) / 2 * scale * k
        hyc = hy / 2 * (0.86 if model in SHRINK else 1.0)
        user.update(collider="box", halfExtents=f"{hx:.3f}, {hyc:.3f}, {hz:.3f}")
        if not indoors:           # indoors the creatures follow the flow field between the walls
            user["obst"] = 1
    if model == "prop_worklight":
        # The lamp it carries: a world light at the heads, a little in front of them.
        a = math.radians(yaw)
        w["lights"].append({"id": f"dress_light_{idx}", "name": f"dress_light_{idx}", "kind": "point",
                            "position": [round(x + math.sin(a) * 0.5, 3), round(y + 1.72 * scale, 3),
                                         round(z + math.cos(a) * 0.5, 3)],
                            "color": [1.0, 0.93, 0.80], "intensity": 3.2, "range": 12.0})
    e = worldio.entity(f"dress_{model}_{idx}", "static_mesh", (round(x, 3), round(y, 3), round(z, 3)),
                       f"assets/models/{model}.glb", (0, 0, 0), (scale, scale, scale), ["prop"], **user)
    ents.append(e)
    return e


if "--no-props" not in sys.argv:
    gone = worldio.drop(w, lambda e: e["id"].startswith("dress_"))
    ents = w["entities"]
    n_placed = 0
    w["lights"] = [l for l in w.get("lights", [])
                   if not l["id"].startswith("dress_") and l["id"] not in DROP_LIGHTS.get(arena, ())]
    for item in EXTRA.get(arena, []):
        model, x, z, yaw, sc = item[:5]
        place(model, x, z, yaw, sc, n_placed, y=item[5] if len(item) > 5 else None)
        n_placed += 1
    for model, (count, s0, s1, rad) in NATURE.items():
        done = tries = 0
        while done < count and tries < 4000:
            tries += 1
            x, z = rng.uniform(-36, 36), rng.uniform(-36, 36)
            sc = round(rng.uniform(s0, s1), 2)
            if keep_clear(x, z, rad * sc):
                continue
            place(model, x, z, rng.uniform(0, 360), sc, n_placed)
            n_placed += 1
            done += 1
        if done < count:
            print(f"  only {done}/{count} {model}")
    # River stones: clusters on and just off both shorelines. Drawn only.
    if water:
        st = 0
        al = -RHALF + 2
        while al < RHALF - 2:
            al += rng.uniform(1.6, 5.5)
            side = rng.choice((1, -1))
            for _ in range(rng.choice((1, 2, 2, 3, 4))):
                a2 = al + rng.uniform(-0.9, 0.9)
                ac = side * (shore(a2, side) + rng.uniform(-1.3, 0.5))
                x, z = (a2, RC + ac) if ALONG_X else (RC + ac, a2)
                place("rock_stone", x, z, rng.uniform(0, 360), round(rng.uniform(0.5, 1.9), 2), n_placed, collide=False)
                n_placed += 1
                st += 1
        # A few stand mid-channel, where the water breaks round them.
        for _ in range(7):
            a2 = rng.uniform(-RHALF + 4, RHALF - 4)
            ac = rng.uniform(-1.2, 1.2)
            x, z = (a2, RC + ac) if ALONG_X else (RC + ac, a2)
            e = place("rock_stone", x, z, rng.uniform(0, 360), round(rng.uniform(1.1, 1.8), 2), n_placed, collide=False)
            e["transform"]["position"][1] = round(WATER_Y - 0.20 * e["transform"]["scale"][0], 3)
            n_placed += 1
        print(f"props: removed {gone}, placed {n_placed} ({st} shore stones)")
    else:
        print(f"props: removed {gone}, placed {n_placed}")

# ---- paint ------------------------------------------------------------------------------
if "--no-paint" not in sys.argv:
    L = [[0.0] * (N * N) for _ in range(4)]          # lush, forest floor, mud, rock

    def blob(layer, x, z, r_in, r_out, amount, ragged=0.35):
        i0, i1 = int((x - r_out - OX) / CS), int((x + r_out - OX) / CS) + 1
        j0, j1 = int((z - r_out - OZ) / CS), int((z + r_out - OZ) / CS) + 1
        for j in range(max(j0, 0), min(j1 + 1, N)):
            for i in range(max(i0, 0), min(i1 + 1, N)):
                px, pz = OX + i * CS, OZ + j * CS
                d = math.hypot(px - x, pz - z) + (noise2(px * 0.8, pz * 0.8) - 0.5) * 2 * ragged * r_out
                v = amount * (1.0 - smooth(r_in, r_out, d))
                if v > L[layer][j * N + i]:
                    L[layer][j * N + i] = v

    def wet(x, z):
        if not water:
            return False
        al, ac = flow_coords(x, z)
        return abs(al) < RHALF + 1 and abs(ac) < shore(al, 1 if ac >= 0 else -1) + 0.2

    def inside_building(x, z):
        for e in ents:
            if kind(e) == "static_mesh" and "building" in e["tags"]:
                p = e["transform"]["position"]
                he = [float(v) for v in e["userData"].get("halfExtents", "0.5,0.5,0.5").split(",")]
                if abs(p[0] - x) < he[0] + 0.2 and abs(p[2] - z) < he[2] + 0.2:
                    return True
        return False

    def trail(a, b, width, amount):
        n = max(2, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 0.35))
        nx, nz = -(b[1] - a[1]), (b[0] - a[0])
        ln = math.hypot(nx, nz) or 1.0
        for k in range(n + 1):
            t = k / n
            sway = (noise1(t * 4.0 + a[0] * 0.37 + b[1] * 0.11) - 0.5) * 2.4 * math.sin(t * math.pi)
            x = a[0] + (b[0] - a[0]) * t + nx / ln * sway
            z = a[1] + (b[1] - a[1]) * t + nz / ln * sway
            if wet(x, z) or inside_building(x, z):
                continue
            blob(2, x, z, width * 0.5, width * 1.25, amount * (0.75 + 0.25 * noise1(k * 0.21)), 0.25)

    for e in ents:
        p = e["transform"]["position"]
        k = kind(e)
        sc = e["transform"]["scale"][0]
        if k == "prop_tree":
            blob(1, p[0], p[2], 1.2 * sc, 3.6 * sc, 0.9, 0.5)
        elif k == "static_mesh" and e["id"].startswith("dress_"):
            m = e["modelRef"]
            if "rock_boulder" in m or "rock_outcrop" in m:
                blob(3, p[0], p[2], 0.9 * sc, 2.3 * sc, 0.8, 0.5)
                blob(2, p[0], p[2], 1.4 * sc, 3.0 * sc, 0.45, 0.5)
            elif "log_fallen" in m or "stump" in m:
                blob(1, p[0], p[2], 1.0 * sc, 2.6 * sc, 0.95, 0.5)
            elif "rock_stone" in m:
                blob(3, p[0], p[2], 0.3 * sc, 1.0 * sc, 0.7, 0.4)
            else:
                blob(2, p[0], p[2], 1.2, 2.4, 0.8, 0.4)
        elif k == "weapon_pickup":
            blob(2, p[0], p[2], 0.9, 2.1, 0.85)
        elif k == "enemy_spawner":
            blob(2, p[0], p[2], 1.6, 3.6, 0.7)
        elif k == "player_spawn":
            blob(2, p[0], p[2], 1.4, 3.0, 0.8)

    spawn = next((e["transform"]["position"] for e in ents if kind(e) == "player_spawn"), [0, 0, 0])
    todo = [e["transform"]["position"] for e in ents if kind(e) == "weapon_pickup"]
    at = (spawn[0], spawn[2])
    while todo:                                   # nearest-neighbour round of the pickups
        nxt = min(todo, key=lambda p: math.hypot(p[0] - at[0], p[2] - at[1]))
        todo.remove(nxt)
        trail(at, (nxt[0], nxt[2]), 0.8, 0.9)
        at = (nxt[0], nxt[2])
    for e in ents:                                # fainter game trails in from each spawner
        if kind(e) == "enemy_spawner":
            p = e["transform"]["position"]
            trail((p[0], p[2]), (spawn[0] * 0.3, spawn[2] * 0.3), 0.55, 0.6)

    # Mud wins over forest floor, rock over both; then cap the sum at 1.
    for c in range(N * N):
        r, d = L[3][c], L[2][c]
        d *= 1 - r
        f = L[1][c] * (1 - r) * (1 - d)
        s = r + d + f
        if s > 1:
            r, d, f = r / s, d / s, f / s
        L[3][c], L[2][c], L[1][c] = round(r, 3), round(d, 3), round(f, 3)
    ids = ["grass_lush", "forest_floor", "mud", "rock"]
    tex = ["grass_lush", "grass_dry", "dirt", "rock"]
    T["layers"] = [{"id": ids[i], "textureRef": f"assets/textures/terrain_{tex[i]}_albedo.png",
                    "weights": L[i], "tileScale": 1} for i in range(4)]
    cov = sum(1 for c in range(N * N) if L[1][c] + L[2][c] + L[3][c] > 0.05)
    print(f"paint: {100.0 * cov / (N * N):.1f}% of the ground painted")

worldio.save(arena, w)
