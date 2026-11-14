#!/usr/bin/env python3
"""Write an arena's encounter plan (plan Phase 6, slice A and C): ten choreographed waves, four
more spawn points, and the objective sites. Everything goes into the world file.

  python3 tools/gen/gen_waves.py <arena_id> [--seed N]

Re-runnable: it replaces the `wave_config` plan, the spawners it added (`spawner_x*`) and the
objective entities (`obj_*`). The four authored spawners are left alone.

THE WAVE FORMAT (`wave_config.userData.waves`, an escaped JSON string, read once at load by
src/world-runtime.ts):

  {"count": 9, "enemy": "skitter,skitter,stalker!,...", "groups": "5:surround:0,2:far:4,2:ambush:8",
   "type": "kill" | "hold" | "nests", "secs": 40}

  enemy    one name per creature, in spawn order; a trailing ! makes it an ELITE.
  groups   size:pattern:gap. The creatures of a group arrive together from the spawn point(s) the
           pattern picks AT THAT MOMENT, relative to where the player stands and looks:
             front     the point most in front of the camera
             ambush    the point most behind it
             flank     alternating between the points furthest to the left and to the right
             far       the furthest point (ranged kinds: a line behind the melee)
             near      the nearest point that is not on top of the player
             surround  one after another round every point
             round     the old behaviour: point n modulo the count
           gap is the seconds after the previous group STARTED; a group also starts early when
           the field is nearly clear, so a fast player is not left waiting.
  type     kill: the wave ends when everything is dead.
           hold: stand in the ring at the `obj_hold` entity until `secs` seconds are banked;
                 the list repeats until then.
           nests: the `obj_nest_*` entities breed the list, repeating, until all are destroyed.

A wave without `groups` is one `round` group, which is exactly the pre-Phase-6 behaviour, so an
older world file plays as it did.
"""
import json, math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import worldio

arena = sys.argv[1]
opt = lambda k, d: type(d)(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
rng = random.Random(opt("--seed", 11) * 1000 + sum(map(ord, arena)))

# How much harder each arena is than the first: extra bodies and elites.
TIER = {"arena_02": 0, "arena_03": 1, "arena_04": 2}.get(arena, 1)
# Which waves (0-based) are objective waves, per arena.
OBJECTIVES = {
    "arena_02": {3: "hold"},
    "arena_03": {3: "nests"},
    "arena_04": {3: "hold", 7: "nests"},
}.get(arena, {3: "hold"})

SK, ST, RV, BR, CO, SP, BO = "skitter", "stalker", "ravager", "bruiser", "colossus", "spitter", "bombard"


def g(pattern, gap, *kinds):
    out = []
    for k in kinds:
        if isinstance(k, tuple):
            out += [k[0]] * k[1]
        else:
            out.append(k)
    return (pattern, gap, out)


# The base plan (arena tier 0). Per-kind pool sizes cap what can be alive at once
# (src/enemies.ts KIND_POOL: 8 skitters, 5 stalkers, 5 ravagers, 3 bruisers, 2 colossi,
# 4 spitters, 3 bombards) and the director holds a spawn back until a body is free.
WAVES = [
    [g("front", 0, (SK, 4)), g("flank", 6, ST, ST)],
    [g("surround", 0, (SK, 5)), g("far", 4, SP, SP), g("ambush", 8, ST, ST)],
    [g("flank", 0, RV, RV), g("near", 3, (SK, 6)), g("far", 9, SP, SP)],
    [g("near", 0, (SK, 5)), g("far", 5, SP, SP), g("flank", 8, ST, ST, RV), g("ambush", 9, (SK, 3))],
    [g("front", 0, BR, (SK, 4)), g("ambush", 7, (ST, 3)), g("far", 5, SP, SP), g("flank", 8, RV, RV)],
    [g("surround", 0, ST + "!", (SK, 6)), g("far", 6, BO), g("flank", 7, RV, RV), g("ambush", 9, ST, ST)],
    [g("flank", 0, BR, BR), g("near", 4, (SK, 6)), g("far", 6, BO, SP, SP), g("ambush", 9, RV + "!", RV)],
    [g("front", 0, CO), g("surround", 3, (SK, 8)), g("far", 8, (SP, 3)), g("flank", 10, BR + "!", RV)],
    [g("ambush", 0, (ST, 4)), g("flank", 5, (RV, 3), RV + "!"), g("far", 6, BO, BO, SP),
     g("near", 6, (SK, 6)), g("front", 9, BR, BR)],
    [g("front", 0, CO + "!", CO), g("surround", 4, (SK, 8)), g("far", 7, BO, BO, SP, SP),
     g("flank", 9, BR, BR, RV, RV), g("ambush", 10, (ST, 3), ST + "!")],
]
# What an objective wave breeds, on repeat, until the objective is done.
HOLD_LIST = [g("near", 0, (SK, 4)), g("flank", 6, ST, ST), g("far", 5, SP), g("ambush", 7, SK, SK, RV)]
NEST_LIST = [g("round", 0, (SK, 3)), g("round", 5, ST, SK), g("round", 5, SP), g("round", 6, RV, SK)]
NEST_LIST_LATE = [g("round", 0, (SK, 3), ST), g("round", 5, RV, RV), g("round", 5, SP, BO),
                  g("round", 6, BR, SK, SK)]


def tiered(groups, wave_i):
    """A harder arena: a skitter or two more in the first group, a spitter more from wave 5,
    and one more elite in waves 6 and 9."""
    out = [(p, gp, list(k)) for p, gp, k in groups]
    if TIER >= 1:
        out[0][2].extend([SK] * TIER)
    if TIER >= 1 and wave_i >= 4:
        for p, gp, k in out:
            if p == "far":
                k.append(SP)
                break
    if TIER >= 2 and wave_i in (5, 8):
        for p, gp, k in out:
            for i, name in enumerate(k):
                if name in (RV, ST) and not name.endswith("!"):
                    k[i] = name + "!"
                    break
            else:
                continue
            break
    return out


plan = []
for i, groups in enumerate(WAVES):
    typ = OBJECTIVES.get(i, "kill")
    if typ == "hold":
        groups = HOLD_LIST
    elif typ == "nests":
        groups = NEST_LIST_LATE if i >= 6 else NEST_LIST
    groups = tiered(groups, i)
    names = [n for _, _, ks in groups for n in ks]
    wave = {"count": len(names), "enemy": ",".join(names),
            "groups": ",".join(f"{len(ks)}:{p}:{gp}" for p, gp, ks in groups), "type": typ}
    if typ == "hold":
        wave["secs"] = 40 + 5 * TIER
    plan.append(wave)

# ---- the world -----------------------------------------------------------------------------
w = worldio.load(arena)
ents = w["entities"]
kind = lambda e: e["userData"].get("kind")
T = w["terrain"]
N, CS = T["width"], T["cellSize"]
OX, OY, OZ = T["origin"]
H = T["heights"]
water = w.get("water") or []
SURFACE = max([wt["center"][1] + wt.get("surfaceHeight", 0) for wt in water], default=-99)


def height(x, z):
    fx, fz = (x - OX) / CS, (z - OZ) / CS
    fx, fz = min(max(fx, 0), N - 1.001), min(max(fz, 0), N - 1.001)
    i, j = int(fx), int(fz)
    tx, tz = fx - i, fz - j
    a, b = H[j * N + i], H[j * N + i + 1]
    c, d = H[(j + 1) * N + i], H[(j + 1) * N + i + 1]
    return OY + (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz


worldio.drop(w, lambda e: e["id"].startswith("spawner_x") or e["id"].startswith("obj_"))
ents = w["entities"]
spawn = next(e for e in ents if kind(e) == "player_spawn")["transform"]["position"]


def blocked(x, z, r):
    """True if nothing of radius r should be put here: off the map, in the water, on a slope,
    or on top of something that stands there."""
    if max(abs(x), abs(z)) > 36:
        return True
    hs = [height(x + dx, z + dz) for dx, dz in ((0, 0), (r, 0), (-r, 0), (0, r), (0, -r))]
    if min(hs) < SURFACE + 0.35:
        return True
    if max(hs) - min(hs) > 0.5 * max(r, 1.0):
        return True
    for e in ents:
        k = kind(e)
        p = e["transform"]["position"]
        if k == "prop_tree" and math.hypot(p[0] - x, p[2] - z) < 1.6 + r:
            return True
        if k in ("static_mesh", "collider_box"):
            if "terrain" in e["tags"]:
                continue
            he = [float(v) for v in e["userData"].get("halfExtents", "0.5,0.5,0.5").split(",")]
            m = 2.5 if ("building" in e["tags"] or k == "collider_box") else 1.0
            if abs(p[0] - x) < he[0] + m + r and abs(p[2] - z) < he[2] + m + r:
                return True
    return False


# ---- four more spawn points: round the edge, as far from the existing ones as they will go
points = [(e["transform"]["position"][0], e["transform"]["position"][2])
          for e in ents if kind(e) == "enemy_spawner"]
cands = []
for deg in range(0, 360, 6):
    for rad in (33, 30, 27):
        a = math.radians(deg)
        x, z = max(-34, min(34, rad * math.sin(a) * 1.25)), max(-34, min(34, -rad * math.cos(a) * 1.25))
        if blocked(x, z, 1.8) or math.hypot(x - spawn[0], z - spawn[2]) < 17:
            continue
        cands.append((x, z))
added = 0
for n in range(4):
    best, best_d = None, 0
    for c in cands:
        d = min(math.hypot(c[0] - p[0], c[1] - p[1]) for p in points)
        if d > best_d:
            best, best_d = c, d
    if best is None or best_d < 9:
        break
    points.append(best)
    y = round(height(*best) + 0.5, 2)
    ents.append(worldio.entity(f"spawner_x{n}", "enemy_spawner", (round(best[0], 1), y, round(best[1], 1)),
                               tags=("logic",)))
    added += 1

# ---- the hold site: the generator that already stands in every arena
types = set(OBJECTIVES.values())
if "hold" in types:
    gens = [e for e in ents if "prop_generator" in e["modelRef"]]
    if gens:
        p = gens[0]["transform"]["position"]
        hx, hz = p[0], p[2]
    else:
        hx, hz = spawn[0] * 0.3, spawn[2] * 0.3
    # Centre the ring within five metres of the generator, wherever the most of its
    # circumference is open ground (in the Checkpoint arena the generator stands against a wall).
    R = 6.5
    best, best_n = (hx, hz), -1
    for dx10 in range(-50, 51, 5):
        for dz10 in range(-50, 51, 5):
            cx, cz = hx + dx10 / 10, hz + dz10 / 10
            if math.hypot(cx - hx, cz - hz) > 5.0:
                continue
            n = sum(0 if blocked(cx + R * math.sin(i / 12 * math.tau), cz - R * math.cos(i / 12 * math.tau), 0.4)
                    else 1 for i in range(12))
            n -= 0.02 * math.hypot(cx - hx, cz - hz)
            if n > best_n:
                best, best_n = (cx, cz), n
    hx, hz = best
    ents.append(worldio.entity("obj_hold", "objective", (round(hx, 1), round(height(hx, hz), 2), round(hz, 1)),
                               tags=("logic",), role="hold", radius=R))
    print(f"hold site at ({hx:.1f}, {hz:.1f})")

# ---- three nest sites: open ground, well apart, not where the player starts
if "nests" in types:
    sites = []
    for tries in range(4000):
        x, z = rng.uniform(-27, 27), rng.uniform(-27, 27)
        if blocked(x, z, 2.2) or math.hypot(x - spawn[0], z - spawn[2]) < 16:
            continue
        if any(math.hypot(x - s[0], z - s[1]) < 17 for s in sites):
            continue
        if any(math.hypot(x - p[0], z - p[1]) < 6 for p in points):
            continue
        sites.append((x, z))
        if len(sites) == 3:
            break
    for i, (x, z) in enumerate(sites):
        ents.append(worldio.entity(f"obj_nest_{i}", "objective", (round(x, 1), round(height(x, z), 2), round(z, 1)),
                                   tags=("logic",), role="nest"))
    print("nest sites:", [(round(x, 1), round(z, 1)) for x, z in sites])
    if len(sites) < 3:
        sys.exit("could not find three nest sites")

cfg = next(e for e in ents if kind(e) == "wave_config")
cfg["userData"]["waves"] = json.dumps(plan)
worldio.save(arena, w)
total = sum(p["count"] for p in plan)
print(f"{arena}: {len(plan)} waves, {total} creatures listed (objective lists repeat), "
      f"{added} spawn points added ({len(points)} in all), tier {TIER}")
for i, p in enumerate(plan):
    print(f"  {i + 1:2d} {p['type']:5s} {p['count']:2d}  {p['groups']}")
