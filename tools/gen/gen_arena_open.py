#!/usr/bin/env python3
"""Arenas 05 and 06 (plan Phase 6, slice D): two open arenas with no building.

  tools/gen/gen_arena_open.py arena_05     # "Quarry": a stepped stone pit under an overcast noon
  tools/gen/gen_arena_open.py arena_06     # "Brood Hollow": a crater in the forest, at night

then, for each:

  tools/gen/dress_arena.py <id>            # banks, rocks, hardware, lamps, paint
  bun tools/build-terrain.ts assets/worlds/<id>.world.json assets/models/terrain_<name>.glb
  tools/gen/gen_waves.py <id>              # ten waves, spawn points, objective sites
  tools/gen/set_look.py <id> ...           # the look (recorded in LOOK below; this tool prints it)

Like gen_arena_04.py this only SEEDS a level: once the world file exists the editor owns it,
and re-running this overwrites editor work. Neither arena adds a model: the terrain carries the
shape and the Phase 3 props dress it.

QUARRY. Three benches step down from the rim to a flat floor, joined by two ramps; a drainage
channel runs north-south along the east side. Long sight lines across the pit, height to hold
on the benches, almost no trees inside it: the ranged kinds matter here.

BROOD HOLLOW. A round clearing forty metres across, sunk two metres, ringed by a low rim with
four gaps; forest outside the rim, a creek on the west. It is the arena the boss is fought in,
so the middle is open and the cover is at the edge. Lit by the moon and by work lights.
"""
import json, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import worldio

OUT = sys.argv[1]
HALF, N = 40, 128
CELL = 2 * HALF / (N - 1)
CFG = {
    "arena_05": dict(seed=0xC5, name="Arena 05 - Quarry", terrain="terrain_quarry", creek_x=31.5, spawn=(0, 31),
                     trees=46),
    "arena_06": dict(seed=0xC6, name="Arena 06 - Brood Hollow", terrain="terrain_hollow", creek_x=-29.0,
                     spawn=(0, 30), trees=78),
}[OUT]
rng = random.Random(CFG["seed"])

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


CREEK_X, CREEK_HW, CREEK_BED, CREEK_BANK = CFG["creek_x"], 2.5, -0.55, 2.4


def creek(x, h):
    ax = abs(x - CREEK_X)
    if ax < CREEK_HW + CREEK_BANK:
        if ax <= CREEK_HW:
            return min(h, CREEK_BED)
        s = smooth(0, 1, (ax - CREEK_HW) / CREEK_BANK)
        return CREEK_BED * (1 - s) + h * s
    return h


# ---- Quarry: a rounded-rectangle pit; `d` is the distance in from the rim line
PIT = (-4.0, -2.0, 25.0, 23.0)            # centre x, z, half x, half z of the rim
BENCH_W, BENCH_H = 5.5, 1.25              # each bench: this wide, this much lower
RAMPS = ((-4.0, 21.0, 0.0), (-29.0, -2.0, 1.5708))   # x, z, direction (0 = runs along z): south and west ramps


def quarry(x, z):
    cx, cz, hx, hz = PIT
    rough = (vnoise((x + HALF) / 6.0, (z + HALF) / 6.0) - 0.5) * 1.6 + (vnoise((x + HALF) / 2.2, (z + HALF) / 2.2) - 0.5) * 0.35
    rim = 4.0 + rough * 0.6
    d = min(hx - abs(x - cx), hz - abs(z - cz))          # > 0 inside the pit
    if d <= 0:
        # outside: the ground rises a little away from the rim
        h = rim + smooth(0, 14, -d) * 1.2 + rough * 0.5 * smooth(0, 8, -d)
        # east of the pit the ground falls away to the drainage channel, so the channel is a
        # stream in a dip and not a four-metre trench
        fall = smooth(22.5, 28.0, x)
        return creek(x, h * (1 - fall) + (0.55 + rough * 0.15) * fall)
    # inside: three benches, each riser a slope 2.2 m long (walkable), then the floor
    step = d / BENCH_W
    k = min(3, int(step))
    frac = step - k
    riser = 2.2 / BENCH_W
    drop = k * BENCH_H + (smooth(0, riser, frac) * BENCH_H if k < 3 else 0)
    h = rim - drop + rough * 0.12
    # the two ramps: a straight grade from the rim to the floor, 5 m wide
    for rx, rz, rdir in RAMPS:
        along = (z - rz) if rdir == 0.0 else (x - rx)
        across = (x - rx) if rdir == 0.0 else (z - rz)
        inward = -along if rdir == 0.0 else along      # south ramp runs north (-z); west ramp runs east (+x)
        if abs(across) < 4.0 and -2 < inward < 3 * BENCH_W + 4:
            t = smooth(0, 3 * BENCH_W + 2, inward)
            grade = rim - t * 3 * BENCH_H
            wgt = 1 - smooth(2.5, 4.0, abs(across))
            h = h * (1 - wgt) + grade * wgt
    return creek(x, h)


# ---- Brood Hollow: a sunk round clearing with a rim that has four gaps
BOWL_R, BOWL_DEPTH = 20.0, 2.0


def hollow(x, z):
    r = math.hypot(x, z + 2.0)
    rough = (vnoise((x + HALF) / 6.5, (z + HALF) / 6.5) - 0.5) * 2.0 + (vnoise((x + HALF) / 2.4, (z + HALF) / 2.4) - 0.5) * 0.4
    outside = 2.6 + rough * 0.8 + smooth(26, 38, r) * 1.0
    floor = 2.6 - BOWL_DEPTH + rough * 0.10
    h = floor + (outside - floor) * smooth(BOWL_R - 4.5, BOWL_R + 1.5, r)
    # the rim: a low bank just outside the bowl, broken at the four diagonals
    ang = math.atan2(x, -(z + 2.0))
    gap = min(abs(((ang - a + math.pi) % (2 * math.pi)) - math.pi) for a in (0.79, 2.36, -0.79, -2.36))
    bank = math.exp(-((r - (BOWL_R + 3.0)) / 2.2) ** 2) * 1.1 * smooth(0.16, 0.42, gap)
    return creek(x, h + bank)


height_at_raw = quarry if OUT == "arena_05" else hollow


def height_at(x, z):
    return round(height_at_raw(x, z), 4)


heights = [height_at(-HALF + i * CELL, -HALF + j * CELL) for j in range(N) for i in range(N)]

# ---- entities ----------------------------------------------------------------------------
E = []
sx, sz = CFG["spawn"]
E.append(worldio.entity("spawn_1", "player_spawn", (sx, round(height_at(sx, sz) + 1.0, 2), sz), tags=["logic"], primary=1, yaw=0))
E.append(worldio.entity("terrain_ground", "static_mesh", (0, 0, 0), f"assets/models/{CFG['terrain']}.glb", tags=["terrain"]))
for eid, pos, he in (("wall_boundary_n", (0, 3, -HALF), "40, 6, 0.5"), ("wall_boundary_s", (0, 3, HALF), "40, 6, 0.5"),
                     ("wall_boundary_e", (HALF, 3, 0), "0.5, 6, 40"), ("wall_boundary_w", (-HALF, 3, 0), "0.5, 6, 40")):
    e = worldio.entity(eid, "collider_box", pos, tags=["static"], halfExtents=he)
    e["userData"]["static"] = "1"
    E.append(e)

if OUT == "arena_05":
    spawners = (("spawner_north", (-4, -34)), ("spawner_west", (-35, 4)), ("spawner_floor", (-4, -4)), ("spawner_ne", (16, -33)))
    pickups = (("pickup_rifle_spawn", 3.5, 27.0, "rifle"), ("pickup_rifle_floor", -8.0, 2.0, "rifle"),
               ("pickup_blaster_floor", 3.0, -8.0, "blaster"), ("pickup_rifle_bench_w", -22.0, -10.0, "rifle"),
               ("pickup_blaster_bench_n", 4.0, -20.0, "blaster"), ("pickup_rifle_rim_e", 21.0, 24.5, "rifle"))
    cover = (("cov_floor_1", "prop_crate", -6.0, -5.0), ("cov_floor_2", "prop_crate", -4.9, -5.6), ("cov_floor_3", "prop_barrel", -7.2, -4.2),
             ("cov_floor_4", "prop_crate", 2.0, 4.0), ("cov_floor_5", "prop_barrel", 3.0, 4.6), ("cov_bench_1", "prop_crate", -18.0, 8.0),
             ("cov_bench_2", "prop_crate", 10.0, -16.5), ("cov_bench_3", "prop_barrel", 11.0, -17.2), ("cov_rim_1", "prop_crate", -10.0, 26.0),
             ("cov_rim_2", "prop_barrel", -9.0, 26.6))
else:
    spawners = (("spawner_north", (0, -35)), ("spawner_east", (35, -4)), ("spawner_sw", (-24, 26)), ("spawner_ne", (26, -27)))
    pickups = (("pickup_rifle_spawn", 3.5, 25.0, "rifle"), ("pickup_rifle_w", -14.0, 0.0, "rifle"),
               ("pickup_blaster_e", 14.0, -4.0, "blaster"), ("pickup_rifle_n", 0.0, -17.0, "rifle"),
               ("pickup_blaster_s", -3.0, 13.0, "blaster"), ("pickup_rifle_ne", 16.0, -18.0, "rifle"))
    cover = (("cov_s_1", "prop_crate", -5.0, 15.5), ("cov_s_2", "prop_crate", -3.9, 16.1), ("cov_s_3", "prop_barrel", -6.1, 16.4),
             ("cov_e_1", "prop_crate", 16.5, 2.0), ("cov_e_2", "prop_barrel", 17.3, 2.8), ("cov_w_1", "prop_crate", -16.5, -6.0),
             ("cov_w_2", "prop_crate", -17.4, -5.2), ("cov_n_1", "prop_barrel", 5.0, -19.5), ("cov_n_2", "prop_crate", 6.0, -19.0))

for eid, (x, z) in spawners:
    E.append(worldio.entity(eid, "enemy_spawner", (x, round(height_at(x, z) + 1, 2), z), tags=["logic"]))
for eid, x, z, weapon in pickups:
    E.append(worldio.entity(eid, "weapon_pickup", (x, round(height_at(x, z) + 0.7, 2), z), tags=["logic"], weapon=weapon))
for eid, glb, x, z in cover:
    he = {"prop_crate": "0.500, 0.500, 0.500", "prop_barrel": "0.350, 0.550, 0.350"}[glb]
    E.append(worldio.entity(eid, "static_mesh", (x, round(max(height_at(x, z), 0.0), 3), z), f"assets/models/{glb}.glb",
                            tags=["prop"], collider="box", halfExtents=he))

# Trees. Quarry: on the rim only. Hollow: outside the bowl, thinning toward it.
variants = ["prop_tree.glb", "prop_tree2.glb", "prop_tree3.glb"]
placed, tries, pts = 0, 0, []
while placed < CFG["trees"] and tries < 9000:
    tries += 1
    x, z = rng.uniform(-37.5, 37.5), rng.uniform(-37.5, 37.5)
    if abs(x - CREEK_X) < CREEK_HW + 2.4: continue
    if math.hypot(x - sx, z - sz) < 7: continue
    if OUT == "arena_05":
        cx, cz, hx, hz = PIT
        d = min(hx - abs(x - cx), hz - abs(z - cz))
        if d > -2.5: continue                                   # nothing in the pit or on its lip
        if any(abs((x - rx) if rd == 0.0 else (z - rz)) < 6 and math.hypot(x - rx, z - rz) < 12 for rx, rz, rd in RAMPS): continue
    else:
        r = math.hypot(x, z + 2.0)
        if r < BOWL_R + 4.5: continue
        if rng.random() > 0.35 + 0.65 * smooth(BOWL_R + 4, BOWL_R + 14, r): continue
    if any(math.hypot(x - p[0], z - p[1]) < 3.1 for p in pts): continue
    if any(math.hypot(x - s[1][0], z - s[1][1]) < 4.5 for s in spawners): continue
    pts.append((x, z))
    placed += 1
    dry = rng.random()
    e = worldio.entity(f"tree_{placed:04d}", "prop_tree", (round(x, 4), round(height_at(x, z), 4), round(z, 4)),
                       "assets/models/" + variants[placed % 3], (0, round(rng.uniform(0, 6.2832), 4), 0),
                       (round(0.95 + rng.random() * 0.5, 4),) * 3, ["prop", "tree"])
    e["tint"] = [round(0.92 + dry * 0.14, 4), round(1.02 + (1 - dry) * 0.06, 4), round(0.86 + (1 - dry) * 0.08, 4), 1]
    E.append(e)

e = worldio.entity("waves", "wave_config", tags=["logic"])
e["userData"]["waves"] = json.dumps([{"count": 6, "enemy": "skitter,skitter,stalker,skitter,skitter,skitter"}])
E.append(e)                                # a stub: tools/gen/gen_waves.py writes the real plan

ENV = {
    # Overcast noon: a high pale sun, a lot of sky light, soft shadows.
    "arena_05": {"skyColor": [0.66, 0.68, 0.72], "ambientColor": [0.78, 0.82, 0.90], "ambientIntensity": 0.62,
                 "sunDirection": [0.28, 0.86, 0.42], "sunColor": [1.0, 0.97, 0.90], "sunIntensity": 1.15,
                 "fogStart": 50, "fogEnd": 150, "fogColor": [0.76, 0.78, 0.80], "shadowsEnabled": True},
    # Night: the "sun" is a three-quarter moon, cold and weak; the work lights do the rest.
    "arena_06": {"skyColor": [0.05, 0.07, 0.13], "ambientColor": [0.34, 0.44, 0.72], "ambientIntensity": 0.30,
                 "sunDirection": [0.42, 0.62, -0.66], "sunColor": [0.62, 0.74, 1.0], "sunIntensity": 0.55,
                 "fogStart": 30, "fogEnd": 110, "fogColor": [0.07, 0.10, 0.17], "shadowsEnabled": True},
}[OUT]
world = {
    "schemaVersion": 2, "name": CFG["name"], "id": OUT,
    "bounds": {"min": [-HALF, -5, -HALF], "max": [HALF, 30, HALF]},
    "environment": ENV,
    "terrain": {"width": N, "depth": N, "cellSize": CELL, "origin": [-HALF, 0, -HALF], "heights": heights, "layers": []},
    "entities": E,
    "lights": [],
    "water": [{"id": "creek", "kind": "box", "center": [CREEK_X, 0, 0], "size": [2 * CREEK_HW, 1, 2 * HALF],
               "surfaceHeight": 0.05, "color": [0.16, 0.34, 0.50, 0.75] if OUT == "arena_05" else [0.06, 0.12, 0.20, 0.8],
               "waveAmplitude": 0.04, "waveSpeed": 1.3}],
    "rivers": [],
    "metadata": {"generator": "tools/gen/gen_arena_open.py", "seed": hex(CFG["seed"]), "date": "2026-11-14"},
    "__compact": True,
}
worldio.save(OUT, world)
LOOK = {
    "arena_05": "sky=0 sky_variant=2 tonemap=1 saturation=0.90 exposure_key=0.15 env_intensity=1.0 fog_density=0.022 "
                "fog_height=-0.5 fog_falloff=5 shafts=0.15 cloud_shadow=0.45 vignette=0.40",
    "arena_06": "sky=0 sky_variant=4 tonemap=1 saturation=0.88 exposure_key=0.075 env_intensity=0.55 fog_density=0.040 "
                "fog_height=-0.5 fog_falloff=4 shafts=0.20 cloud_shadow=0 vignette=0.55",
}[OUT]
print(f"[gen_arena_open] {OUT}: {len(E)} entities ({placed} trees), {N}x{N} terrain")
print(f"next: tools/gen/set_look.py {OUT} {LOOK}")
