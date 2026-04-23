# Perry 0.5.158 codegen quirks

Three reproducible bugs observed while building this shooter. All of
them affect `bloom/world` in the engine and force us to hardcode
world data in TypeScript until they're fixed.

## 1. Reachable `throw new Error` segfaults at startup

**Symptom.** SIGSEGV (`EXC_BAD_ACCESS` at `0xfffffffffffffff9`) during
program init. Only one frame on the crashing thread. Happens during
Perry's generated setup, before the game loop runs.

**Trigger.** Calling — or merely importing — any function whose
control flow contains `throw new Error(...)`. This includes
`bloom/world`'s `loadWorld` (two throws inside it) and any game-side
helper that throws. The throw doesn't need to execute; it just needs
to be in the reachable call graph.

**Likely cause.** Perry's auto-optimise pass picks `panic = "abort"`
when no `catch_unwind` callers are reachable. When throws are in
scope, `catch_unwind` is linked in, and something on that code path
is miscompiled.

**Workaround.** Do not call `throw` anywhere reachable. Use status
fields on return structs:

```ts
// BAD — crashes at startup
function mustParse(s: string): WorldData {
  const data = JSON.parse(s);
  if (!data.entities) throw new Error('bad world');
  return data;
}

// GOOD — no throws reachable
interface Result { ok: boolean; data: WorldData | null; error: string }
function tryParse(s: string): Result {
  const data = JSON.parse(s);
  if (!data.entities) return { ok: false, data: null, error: 'bad world' };
  return { ok: true, data, error: '' };
}
```

## 2. Object-shorthand returns corrupt fields

**Symptom.** `validateWorld(validJson)` returns `{ ok: false, errors:
[] }` — contradictory, since its implementation is literally
`return { ok: errors.length === 0, errors }` with `errors.length === 0`.

**Trigger.** A function ends with `return { key1: expr, key2 }` (ES6
property shorthand mixed with a computed field) and the caller reads
a boolean field whose value disagrees with what was computed.

**Workaround.** Use explicit key syntax everywhere:

```ts
// BAD — Perry may corrupt `ok` at the callsite
function validate(xs: string[]) {
  const errors: string[] = /* … */;
  return { ok: errors.length === 0, errors };
}

// GOOD
function validate(xs: string[]) {
  const errors: string[] = /* … */;
  const ok = errors.length === 0;
  return { ok: ok, errors: errors };
}
```

## 3. Module-scope state writes don't propagate across module boundaries

**Symptom.** A function in `./camera-tp.ts` mutates a module-level
variable (either `let` scalar reassignment or `const` array index
write). When another module calls it repeatedly and then reads the
state, the reads return the initial value — as if the writes never
happened.

We confirmed this three ways:

1. `let camX = 0; export function update() { camX = player.x; }
   export function getX() { return camX; }` — getX always returns 0.
2. `const CAM = [0,0,0]; export function update(x) { CAM[0] = x; }
   export function getX() { return CAM[0]; }` — same behaviour,
   getX returns 0.
3. Inlining the same state + mutation into the calling module (the
   game's `main.ts`) works correctly — index-assigned `const` arrays
   persist across frames.

**Workaround.** Keep mutable state in the module that actually needs
to read it. Our third-person camera is defined inline in
`src/main.ts` as a 9-element `const CAM` array (yaw, pitch,
camXYZ, tgtXYZ, initialised flag) with the orbit math unrolled in
the game loop. Helper modules are fine for stateless logic — camera
math + input aggregation could live in a module — but any state that
must update over time needs to be local to its reader.

## 4. `JSON.parse` arrays have no `.length`

**Symptom.** `const data = JSON.parse(text); data.entities.length`
returns `undefined`. Any `for (let i = 0; i < data.entities.length;
i++)` loop runs zero times. Silently loads no entities.

**Trigger.** Reading `.length` on an array produced by JSON.parse.
Indexing (`data.entities[0]`) works correctly; it's just the length
that's not populated on the resulting array-like object.

**Workaround.** Don't read world data from JSON files on Perry.
Hardcode level geometry in TypeScript (`src/main.ts` does this for
the arena walls, wave composition, pickup positions). The
`assets/worlds/arena_01.world.json` is kept as a reference for when
the editor pipeline eventually works.

## Impact on the shooter's design

The combination of 1 and 3 means we can't use `bloom/world`'s
`loadWorld` at all. For now the shooter keeps world structure in
`src/main.ts`:

```ts
const debugBoxes: DebugBox[] = [ /* floor + 4 walls */ ];
const wavePlan     = [3, 6, 10];
const WAVE_KINDS   = [ /* flat concat of per-wave kind sequences */ ];
const spawnerX     = [-18, 18, -18, 18];
const spawnerZ     = [-18, -18, 18, 18];
const pickupX      = [-18, 18, -18, 18];
const pickupZ      = [18, -18, -18, 18];
const pickupKind   = [PICKUP_RIFLE, PICKUP_BLASTER, PICKUP_RIFLE, PICKUP_BLASTER];
```

Once Perry's JSON behaviour is fixed, the plan is to move this into
`assets/worlds/arena_01.world.json` (same schema as Bloom Garden)
and load it via a wrapper that reads the file + validates without
throws.

## Verifying a Perry fix

Flip `SELFTEST = true` in `src/main.ts`, force-spawn a test scenario,
and screenshot. If `loadWorld` starts working, restoring the
JSON-driven path is a ~30 LOC change in `main.ts` — the JSON file
already exists.
