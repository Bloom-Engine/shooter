#!/usr/bin/env python3
"""Arena 04 - "Checkpoint" (plan 3.7, the arena owed since SH-040).

  tools/gen/gen_arena_04.py            # writes assets/worlds/arena_04.world.json
  tools/gen/dress_arena.py arena_04    # banks, rocks, the checkpoint's hardware, lamps, paint
  bun tools/build-terrain.ts assets/worlds/arena_04.world.json assets/models/terrain_checkpoint.glb
  tools/gen/house_trim.py assets/worlds/arena_04.world.json
  tools/gen/set_look.py arena_04 ...   # the dusk look (recorded at the bottom of this file)

A roadside checkpoint in a shallow valley at dusk. A dirt road runs east-west through the
middle and fords a creek on the west side; a single-storey concrete guard post stands north of
the road with a yard of barriers and sandbags in front of it. The second building type of the
game: board-formed concrete instead of brick (`wall_slice=1` on the look entity), one floor, no
stairs, wide slit windows that can be fired through.

Like gen-arena-03.ts this only SEEDS the level: once the world file exists the editor owns it,
and re-running this overwrites editor work.
"""
import json, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import worldio

OUT = "arena_04"
HALF, N = 40, 128
CELL = 2 * HALF / (N - 1)
rng = random.Random(0xC4)

# ---- terrain -----------------------------------------------------------------------------
G = 17
grid = [rng.random() for _ in range(G * G)]


def vnoise(u, v):
    u, v = min(G - 2, max(0, u)), min(G - 2, max(0, v))
    i, j = int(u), int(v)
    fu, fv = u - i, v - j
    su, sv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
    a, b, c, d = grid[j * G + i], grid[j * G + i + 1], grid[(j + 1) * G + i], grid[(j + 1) * G + i + 1]
    return (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv


def smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


CREEK_X, CREEK_HW, CREEK_BED, CREEK_BANK = -24.0, 2.5, -0.55, 2.4
POST = (8.0, -12.0, 6.0, 4.0)          # guard post: centre x, centre z, half x, half z


def road_z(x):
    """Centre line of the road: it swings a little as it crosses the valley."""
    return 3.0 + 2.2 * math.sin(x * 0.07 + 0.6)


def height_at(x, z):
    base = (vnoise((x + HALF) / 6.5, (z + HALF) / 6.5) - 0.5) * 2.6 \
         + (vnoise((x + HALF) / 2.4, (z + HALF) / 2.4) - 0.5) * 0.5
    # the valley: low along the road, rising to the north and south edges
    rise = smooth(10, 36, abs(z - 2)) * 2.4
    h = 0.45 + base * (0.35 + 0.65 * smooth(6, 26, abs(z - 2))) + rise
    # the road bed: a shallow flat-bottomed cut
    dr = abs(z - road_z(x))
    h = h * smooth(1.6, 5.0, dr) + 0.22 * (1 - smooth(1.6, 5.0, dr))
    # the guard post's pad and yard, level
    px, pz, phx, phz = POST
    pad = max(abs(x - px) - phx, abs(z - pz) - phz)
    h = h * smooth(1.0, 6.0, pad) + 0.02 * (1 - smooth(1.0, 6.0, pad))
    # the creek
    ax = abs(x - CREEK_X)
    if ax < CREEK_HW + CREEK_BANK:
        if ax <= CREEK_HW:
            h = min(h, CREEK_BED)
        else:
            s = smooth(0, 1, (ax - CREEK_HW) / CREEK_BANK)
            h = CREEK_BED * (1 - s) + h * s
    return round(h, 4)


heights = [height_at(-HALF + i * CELL, -HALF + j * CELL) for j in range(N) for i in range(N)]

# ---- entities ----------------------------------------------------------------------------
E = []
# On the ground: a spawn below the terrain falls through the heightfield for ever.
E.append(worldio.entity("spawn_1", "player_spawn", (0, round(height_at(0, 30) + 1.0, 2), 30), tags=["logic"], primary=1, yaw=0))
E.append(worldio.entity("terrain_ground", "static_mesh", (0, 0, 0), "assets/models/terrain_checkpoint.glb",
                        tags=["terrain"]))
for eid, pos, he in (("wall_boundary_n", (0, 3, -HALF), "40, 4, 0.5"), ("wall_boundary_s", (0, 3, HALF), "40, 4, 0.5"),
                     ("wall_boundary_e", (HALF, 3, 0), "0.5, 4, 40"), ("wall_boundary_w", (-HALF, 3, 0), "0.5, 4, 40")):
    e = worldio.entity(eid, "collider_box", pos, tags=["static"], halfExtents=he)
    e["userData"]["static"] = "1"
    E.append(e)

# The guard post. Walls are boxes split round their openings, named the way house_trim.py reads
# them: h_<facade>_f<floor>_<n>. Floor top at y 0.2, walls to 3.4, roof slab above.
PX, PZ, PHX, PHZ = POST
T = 0.3                                   # wall thickness
Y0, Y1 = 0.2, 3.4


def box(eid, cx, cy, cz, hx, hy, hz):
    E.append(worldio.entity(eid, "static_mesh", (round(cx, 3), round(cy, 3), round(cz, 3)), tags=["building"],
                            collider="box", halfExtents=f"{hx:.3f}, {hy:.3f}, {hz:.3f}"))


def wall(facade, fixed, a0, a1, openings):
    """One facade from a0 to a1 along its length. openings: (centre, width, y_bottom, y_top)."""
    n = [0]

    def piece(lo, hi, ylo, yhi):
        if hi - lo < 0.02 or yhi - ylo < 0.02:
            return
        n[0] += 1
        c, h = (lo + hi) / 2, (hi - lo) / 2
        cy, hy = (ylo + yhi) / 2, (yhi - ylo) / 2
        if facade in "sn":
            box(f"h_{facade}_f0_{n[0]}", c, cy, fixed, h, hy, T / 2)
        else:
            box(f"h_{facade}_f0_{n[0]}", fixed, cy, c, T / 2, hy, h)

    at = a0
    for c, wd, yb, yt in sorted(openings):
        piece(at, c - wd / 2, Y0, Y1)                 # solid up to the opening
        piece(c - wd / 2, c + wd / 2, Y0, yb)         # below it (nothing for a door)
        piece(c - wd / 2, c + wd / 2, yt, Y1)         # lintel
        at = c + wd / 2
    piece(at, a1, Y0, Y1)


box("h_floor", PX, 0.1, PZ, PHX, 0.1, PHZ)
box("h_roof_a", PX, Y1 + 0.15, PZ, PHX + 0.25, 0.15, PHZ + 0.25)
DOOR, SLIT = (0.2, 2.5), (1.25, 2.25)
wall("s", PZ + PHZ - T / 2, PX - PHX, PX + PHX, [(PX - 3.6, 2.2, *SLIT), (PX, 1.9, *DOOR), (PX + 3.6, 2.2, *SLIT)])
wall("n", PZ - PHZ + T / 2, PX - PHX, PX + PHX, [(PX - 3.0, 2.4, *SLIT), (PX + 3.0, 2.4, *SLIT)])
wall("w", PX - PHX + T / 2, PZ - PHZ + T, PZ + PHZ - T, [(PZ + 0.6, 1.7, *DOOR)])
wall("e", PX + PHX - T / 2, PZ - PHZ + T, PZ + PHZ - T, [(PZ, 2.6, *SLIT)])
# a low parapet round the roof (house_trim.py caps it with a coping)
RY = Y1 + 0.3
box("h_par_s", PX, RY + 0.2, PZ + PHZ + 0.1, PHX + 0.25, 0.2, 0.15)
box("h_par_n", PX, RY + 0.2, PZ - PHZ - 0.1, PHX + 0.25, 0.2, 0.15)
box("h_par_e", PX + PHX + 0.1, RY + 0.2, PZ, 0.15, 0.2, PHZ - 0.05)
box("h_par_w", PX - PHX - 0.1, RY + 0.2, PZ, 0.15, 0.2, PHZ - 0.05)
# a partition inside, with a gap at its south end: two rooms
box("h_part", PX + 1.6, (Y0 + Y1) / 2, PZ - 1.1, T / 2, (Y1 - Y0) / 2, PHZ - T - 1.1)

for eid, pos in (("spawner_north", (-4, 1, -34)), ("spawner_east_road", (34, 1, road_z(34))),
                 ("spawner_west_bank", (-34, 1, 12)), ("spawner_north_east", (28, 1, -28))):
    E.append(worldio.entity(eid, "enemy_spawner", (pos[0], round(height_at(pos[0], pos[2]) + 1, 2), round(pos[2], 2)),
                            tags=["logic"]))

for eid, x, z, weapon, y in (("pickup_rifle_spawn", 3.5, 23.0, "rifle", None), ("pickup_rifle_road", -7.0, 4.5, "rifle", None),
                             ("pickup_blaster_post", 10.6, -13.6, "blaster", 0.9), ("pickup_rifle_post", 4.0, -10.4, "rifle", 0.9),
                             ("pickup_blaster_ford", -18.5, 7.0, "blaster", None), ("pickup_rifle_east", 24.0, -4.0, "rifle", None)):
    py = y if y is not None else round(height_at(x, z) + 0.7, 2)
    E.append(worldio.entity(eid, "weapon_pickup", (x, py, z), tags=["logic"], weapon=weapon))

# Crates and drums: the yard, the roadside, inside the post.
for eid, glb, x, z, y in (("cov_yard_1", "prop_crate", 2.2, -5.6, None), ("cov_yard_2", "prop_crate", 3.3, -5.1, None),
                          ("cov_yard_3", "prop_barrel", 1.6, -4.4, None), ("cov_road_1", "prop_barrel", 12.5, 6.6, None),
                          ("cov_road_2", "prop_barrel", 13.4, 6.1, None), ("cov_road_3", "prop_crate", 12.9, 7.6, None),
                          ("cov_south_1", "prop_crate", -6.5, 15.5, None), ("cov_south_2", "prop_crate", -5.4, 16.2, None),
                          ("cov_post_1", "prop_crate", 12.6, -9.3, 0.2), ("cov_post_2", "prop_table", 5.2, -14.2, 0.2),
                          ("cov_post_3", "prop_chair", 6.6, -14.4, 0.2)):
    he = {"prop_crate": "0.500, 0.500, 0.500", "prop_barrel": "0.350, 0.550, 0.350",
          "prop_table": "0.750, 0.400, 0.400", "prop_chair": "0.250, 0.450, 0.250"}[glb]
    py = y if y is not None else max(height_at(x, z), 0.0)
    E.append(worldio.entity(eid, "static_mesh", (x, round(py, 3), z), f"assets/models/{glb}.glb", tags=["prop"],
                            collider="box", halfExtents=he))

# Trees: the valley sides and the creek's far bank; the road, the yard and the spawn stay open.
variants = ["prop_tree.glb", "prop_tree2.glb", "prop_tree3.glb"]
placed, tries, pts = 0, 0, []
while placed < 84 and tries < 6000:
    tries += 1
    x, z = rng.uniform(-37.5, 37.5), rng.uniform(-37.5, 37.5)
    if abs(x - CREEK_X) < CREEK_HW + 2.4: continue
    if abs(z - road_z(x)) < 5.5: continue
    if max(abs(x - PX) - PHX, abs(z - PZ) - PHZ) < 7.5: continue
    if math.hypot(x, z - 30) < 7: continue
    density = 0.25 + 0.75 * smooth(9, 24, abs(z - 2))
    if rng.random() > density: continue
    if any(math.hypot(x - p[0], z - p[1]) < 3.1 for p in pts): continue
    pts.append((x, z))
    placed += 1
    dry = rng.random()
    e = worldio.entity(f"tree_{placed:04d}", "prop_tree", (round(x, 4), round(height_at(x, z), 4), round(z, 4)),
                       "assets/models/" + variants[placed % 3], (0, round(rng.uniform(0, 6.2832), 4), 0),
                       (round(0.95 + rng.random() * 0.5, 4),) * 3, ["prop", "tree"])
    e["tint"] = [round(0.92 + dry * 0.14, 4), round(1.02 + (1 - dry) * 0.06, 4), round(0.86 + (1 - dry) * 0.08, 4), 1]
    E.append(e)

waves = [
    {"count": 8, "enemy": "skitter,skitter,stalker,skitter,spitter,skitter,stalker,skitter"},
    {"count": 13, "enemy": "skitter,skitter,ravager,stalker,spitter,skitter,bruiser,skitter,spitter,stalker,ravager,skitter,skitter"},
    {"count": 21, "enemy": "skitter,skitter,skitter,skitter,skitter,skitter,skitter,skitter,bruiser,bombard,ravager,spitter,"
                           "stalker,bombard,ravager,spitter,bruiser,stalker,ravager,colossus,colossus"},
]
e = worldio.entity("waves", "wave_config", tags=["logic"])
e["userData"]["waves"] = json.dumps(waves)
E.append(e)

world = {
    "schemaVersion": 2, "name": "Arena 04 - Checkpoint", "id": "arena_04",
    "bounds": {"min": [-HALF, -5, -HALF], "max": [HALF, 30, HALF]},
    "environment": {
        # Dusk: the sun is on the western ridge, straight down the road.
        "skyColor": [0.42, 0.40, 0.52], "ambientColor": [0.50, 0.58, 0.82], "ambientIntensity": 0.42,
        "sunDirection": [-0.86, 0.16, 0.22], "sunColor": [1.0, 0.62, 0.36], "sunIntensity": 1.5,
        "fogStart": 40, "fogEnd": 120, "fogColor": [0.62, 0.52, 0.50], "shadowsEnabled": True,
    },
    "terrain": {"width": N, "depth": N, "cellSize": CELL, "origin": [-HALF, 0, -HALF], "heights": heights, "layers": []},
    "entities": E,
    "lights": [],
    "water": [{"id": "creek", "kind": "box", "center": [CREEK_X, 0, 0], "size": [2 * CREEK_HW, 1, 2 * HALF],
               "surfaceHeight": 0.05, "color": [0.16, 0.34, 0.50, 0.75], "waveAmplitude": 0.04, "waveSpeed": 1.3}],
    "rivers": [],
    "metadata": {"generator": "tools/gen/gen_arena_04.py", "seed": "0xC4", "date": "2026-11-14"},
    "__compact": True,
}
worldio.save(OUT, world)
print(f"[gen_arena_04] {len(E)} entities ({placed} trees), {N}x{N} terrain")

# The dusk look (tools/gen/set_look.py arena_04 ...):
#   sky=0 tonemap=1 saturation=0.96 exposure_key=0.105 env_intensity=0.45 fog_density=0.030
#   fog_height=-0.5 fog_falloff=5 shafts=0.55 cloud_shadow=0.2 vignette=0.48 wall_slice=1
