#!/usr/bin/env python3
"""Architectural dressing for the box-built house of a world file.

  tools/gen/house_trim.py assets/worlds/arena_02.world.json

The house is authored as collider boxes (walls split round their openings, slabs, parapet,
stairs). On their own they render as a bare box with holes. This writes `building_trim`
entities next to them: a concrete frame (plinth, corner and bay pilasters, a course at each
slab, parapet coping), a steel lining with glazing bars in every window, a steel door frame,
window sills, awnings over the doors, downpipes and a roof mast. They are DRAWN (baked into the
building mesh by src/environment.ts) and nothing else: no collider, no nav, no keep-out, so no
bullet, camera or creature notices them. Everything is derived from the wall boxes, so it
follows the house if the walls are edited; re-run after such an edit. Existing `ht_*` entities
are replaced.

userData: kind=building_trim, halfExtents="x, y, z", slice=concrete|metal.
"""
import json, sys

path = sys.argv[1]
w = json.load(open(path))
ents = [e for e in w["entities"] if not e["id"].startswith("ht_")]


def he(e):
    return [float(v) for v in e["userData"]["halfExtents"].split(",")]


walls = []   # (facade, along, half_along, y, hy)
for e in ents:
    n = e["name"]
    if not (n.startswith("h_") and n[2] in "snew" and n[3] == "_" and n[4] == "f"):
        continue
    p, h = e["transform"]["position"], he(e)
    f = n[2]
    walls.append((f, p[0] if f in "sn" else p[2], h[0] if f in "sn" else h[2], p[1], h[1], p, h))
if not walls:
    sys.exit("no h_<facade>_f<floor>_<n> wall boxes in " + path)

# Outer face of each facade and the footprint.
face = {}
for f in "snew":
    b = [x for x in walls if x[0] == f]
    p, h = b[0][5], b[0][6]
    face[f] = {"s": p[2] + h[2], "n": p[2] - h[2], "e": p[0] + h[0], "w": p[0] - h[0]}[f]
X0, X1, Z0, Z1 = face["w"], face["e"], face["n"], face["s"]
OUT = {"s": 1, "n": -1, "e": 1, "w": -1}
# wall thickness, measured (the house is 0.6 m, the guard post of arena 04 is 0.3 m)
T = round(2 * min(min(x[6][0], x[6][2]) for x in walls), 3)
floors = sorted({round(x[3] - x[4], 2) for x in walls if x[4] > 1.0})     # wall bottoms: 0.2, 3.9
tops = sorted({round(x[3] + x[4], 2) for x in walls if x[4] > 1.0})       # wall tops: 3.4, 7.1
parapet_top = max(e["transform"]["position"][1] + he(e)[1] for e in ents if e["name"].startswith("h_par_"))
roof_top = max(e["transform"]["position"][1] + he(e)[1] for e in ents if e["name"].startswith("h_roof_"))

out = []


def box(cx, cy, cz, hx, hy, hz, slice_):
    i = len(out)
    out.append({
        "id": f"ht_{i:03d}", "name": f"ht_{i:03d}", "modelRef": "assets/models/_gizmo_box.glb", "prefabRef": None,
        "transform": {"position": [round(cx, 4), round(cy, 4), round(cz, 4)], "rotation": [0, 0, 0], "scale": [1, 1, 1]},
        "tint": None, "tags": ["trim"],
        "userData": {"kind": "building_trim", "halfExtents": f"{hx:.3f}, {hy:.3f}, {hz:.3f}", "slice": slice_},
    })


def on_face(f, along, y, half_along, hy, depth_c, half_depth, slice_):
    """A box on facade f: `along` the wall, `depth_c` metres OUTWARD from the outer face."""
    d = face[f] + OUT[f] * depth_c
    if f in "sn":
        box(along, y, d, half_along, hy, half_depth, slice_)
    else:
        box(d, y, along, half_depth, hy, half_along, slice_)


span = {"s": (X0, X1), "n": (X0, X1), "e": (Z0, Z1), "w": (Z0, Z1)}

# Openings: a sill box and a lintel box sharing a centre are a window; a lone lintel is a door.
openings = []   # (facade, along, half, y0, y1, is_door)
for f in "snew":
    for fl, (y_lo, y_hi) in enumerate(zip(floors, tops)):
        small = {}
        for x in walls:
            if x[0] == f and x[4] < 1.0 and y_lo - 0.01 <= x[3] <= y_hi + 0.01:
                small.setdefault(round(x[1], 2), []).append(x)
        for along, bs in small.items():
            bs.sort(key=lambda x: x[3])
            if len(bs) == 2:
                openings.append((f, along, bs[0][2], bs[0][3] + bs[0][4], bs[1][3] - bs[1][4], False))
            else:
                openings.append((f, along, bs[0][2], y_lo, bs[0][3] - bs[0][4], True))

# 1. Plinth, broken at the doors.
PL = 0.07
for f in "snew":
    a0, a1 = span[f][0] - PL, span[f][1] + PL
    cuts = sorted((o[1] - o[2] - 0.09, o[1] + o[2] + 0.09) for o in openings if o[0] == f and o[5] and o[3] < 1.0)
    cur = a0
    for c0, c1 in cuts + [(a1, a1)]:
        if c0 - cur > 0.05:
            on_face(f, (cur + c0) / 2, 0.30, (c0 - cur) / 2, 0.32, PL / 2, PL / 2 + 0.01, "concrete")
        cur = c1

# 2. A course at every slab edge and 3. parapet coping.
for k in range(len(tops)):          # any number of storeys
    y0 = tops[k] - 0.04
    y1 = (floors[k + 1] if k + 1 < len(floors) else roof_top) + 0.04
    for f in "snew":
        on_face(f, sum(span[f]) / 2, (y0 + y1) / 2, (span[f][1] - span[f][0]) / 2 + 0.10, (y1 - y0) / 2, 0.045, 0.055, "concrete")
for f in "snew":
    on_face(f, sum(span[f]) / 2, parapet_top + 0.04, (span[f][1] - span[f][0]) / 2 + 0.08, 0.05, -0.16, 0.30, "concrete")

# 4. Pilasters: both ends of every facade, and wherever a bay boundary clears the openings.
PW = 0.26
for f in "snew":
    a0, a1 = span[f]
    spots = [a0 + PW - 0.06, a1 - PW + 0.06]
    n_bays = max(1, round((a1 - a0) / 7.5))
    for k in range(1, n_bays):
        want = a0 + (a1 - a0) * k / n_bays
        best = None
        for off in [i * 0.25 for i in range(0, 13)]:
            for cand in (want + off, want - off):
                if all(abs(cand - o[1]) > o[2] + PW + 0.25 for o in openings if o[0] == f):
                    best = cand; break
            if best is not None:
                break
        if best is not None:
            spots.append(best)
    for s in spots:
        on_face(f, s, (0.0 + parapet_top) / 2, PW, parapet_top / 2, 0.03, 0.04, "concrete")

# 5. Openings: steel lining, glazing bars, sills.
FR = 0.045
for f, along, half, y0, y1, door in openings:
    mid_d = -T / 2                      # centre of the wall thickness, measured outward from the face
    hd = T / 2 + 0.035                  # the lining stands 3.5 cm proud on both sides
    on_face(f, along - half + FR, (y0 + y1) / 2, FR, (y1 - y0) / 2, mid_d, hd, "metal")
    on_face(f, along + half - FR, (y0 + y1) / 2, FR, (y1 - y0) / 2, mid_d, hd, "metal")
    on_face(f, along, y1 - FR, half, FR, mid_d, hd, "metal")
    if not door:
        on_face(f, along, y0 + FR, half, FR, mid_d, hd, "metal")
        on_face(f, along, y0 - 0.045, half + 0.14, 0.05, 0.02, 0.13, "concrete")          # sill
        on_face(f, along, (y0 + y1) / 2, 0.022, (y1 - y0) / 2, -0.16, 0.025, "metal")     # glazing bars
        for t in (0.36, 0.68):
            on_face(f, along, y0 + (y1 - y0) * t, half, 0.02, -0.16, 0.025, "metal")
    else:
        # awning: a steel sheet on two brackets
        on_face(f, along, y1 + 0.42, half + 0.45, 0.025, 0.55, 0.57, "metal")
        for s in (-1, 1):
            on_face(f, along + s * (half + 0.30), y1 + 0.22, 0.025, 0.18, 0.30, 0.30, "metal")

# 6. Downpipes on the two long facades, and a mast on the roof.
for f in "sn":
    for a in (span[f][0] + 1.05, span[f][1] - 1.05):
        on_face(f, a, (0.1 + roof_top) / 2, 0.05, (roof_top - 0.1) / 2, 0.13, 0.05, "metal")
        for y in [v for v in (1.2, 3.0, 5.2) if v < roof_top - 0.6] + [roof_top - 0.3]:
            on_face(f, a, y, 0.075, 0.03, 0.09, 0.09, "metal")
mx, mz = X0 + 1.6, Z0 + 1.6
box(mx, roof_top + 2.4, mz, 0.035, 2.4, 0.035, "metal")
box(mx, roof_top + 0.06, mz, 0.22, 0.06, 0.22, "metal")
box(mx, roof_top + 4.3, mz, 0.45, 0.02, 0.02, "metal")
box(mx, roof_top + 3.9, mz, 0.02, 0.02, 0.32, "metal")

w["entities"] = ents + out
raw = open(path).read()
open(path, "w").write(json.dumps(w, indent=2) if raw.startswith("{\n") else json.dumps(w, separators=(",", ":")))
print(f"{path}: {len(openings)} openings ({sum(1 for o in openings if o[5])} doors), {len(out)} trim boxes")
