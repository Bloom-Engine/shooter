"""Read and write a world file in the formatting it already has (arena_02 is indented, arena_03
compact), so a tool's diff shows only what it changed. Shared by the tools in this folder."""
import json


def path_of(arena):
    return arena if arena.endswith(".json") else f"assets/worlds/{arena}.world.json"


def load(arena):
    raw = open(path_of(arena)).read()
    w = json.loads(raw)
    w["__compact"] = not raw.startswith("{\n")
    return w


def save(arena, w):
    compact = w.pop("__compact", False)
    text = json.dumps(w, separators=(",", ":")) if compact else json.dumps(w, indent=2)
    open(path_of(arena), "w").write(text)


GIZMO = "assets/models/_gizmo_box.glb"   # the schema wants a modelRef on every entity


def entity(eid, kind, pos=(0, 0, 0), model=GIZMO, rot=(0, 0, 0), scale=(1, 1, 1), tags=(), **user):
    ud = {"kind": kind}
    ud.update({k: str(v) for k, v in user.items()})
    return {"id": eid, "name": eid, "modelRef": model, "prefabRef": None,
            "transform": {"position": list(pos), "rotation": list(rot), "scale": list(scale)},
            "tint": None, "tags": list(tags), "userData": ud}


def drop(w, pred):
    """Remove every entity for which pred(entity) is true; returns how many went."""
    n = len(w["entities"])
    w["entities"] = [e for e in w["entities"] if not pred(e)]
    return n - len(w["entities"])
