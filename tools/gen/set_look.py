#!/usr/bin/env python3
"""Set an arena's time of day and grade.

  tools/gen/set_look.py <arena_id> key=value ...

Keys starting with `env.` go into the world's environment block (`env.sunDirection=0.5,0.4,0.3`,
`env.sunIntensity=1.4`); every other key goes into the world's one `look` entity, which
`src/main.ts` reads with `W.lookNum` (sky, rayleigh, mie, sky_sun, tonemap, saturation,
env_intensity, exposure_key, fog_density, fog_height, fog_falloff, shafts, cloud_shadow,
vignette, dof, ...). `key=` removes a look key. With no pairs it prints the current values.
"""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import worldio
arena = sys.argv[1]
w = worldio.load(arena)
look = next((e for e in w["entities"] if e.get("userData", {}).get("kind") == "look"), None)
if look is None:
    look = worldio.entity("look", "look", tags=["logic"])
    w["entities"].append(look)
for pair in sys.argv[2:]:
    k, v = pair.split("=", 1)
    if k.startswith("env."):
        w["environment"][k[4:]] = [float(x) for x in v.split(",")] if "," in v else float(v)
    elif v == "":
        look["userData"].pop(k, None)
    else:
        look["userData"][k] = v
if len(sys.argv) > 2:
    compact = w["__compact"]
    worldio.save(arena, w)
    w["__compact"] = compact
print(json.dumps(w["environment"]))
print(json.dumps(look["userData"]))
