# Perry 0.5.x codegen/runtime quirks

Reproducible bugs observed while building this shooter. Most affect
`bloom/world` in the engine and force us to hardcode world data in
TypeScript until they're fixed; #5 is a runtime memory-safety bug that
crashed the shipped game.

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

## 5. `split()` + `parseFloat()` overread heap allocations (EN-020)

**Symptom.** Access violation (c0000005) with empty stderr, no WER
event on some paths — the game dies silently or freezes (last
presented frame stays on screen, input looks dead). Faulting reads
land just past the end of a heap page (`0x…FFF8`-style addresses).
Layout-sensitive: a relink can hide or resurface it, which made it
look "unreproducible" for a whole audit round.

**Trigger.** Running a string through `split()` and `parseFloat()`
every frame. Perry's runtime scanners read a word past the end of
their own exact-sized slice allocations; with enough fresh
allocations per second, one eventually lands flush against an
unmapped page. The shooter hit it via `getProfilerOverlay()` /
`getProfilerFrameHistory()` (F3 overlay): 6/6 crashes within 7–29 s
of overlay time, in two different link layouts. One-shot parses
(e.g. the engine's OBJ text loader) carry the same risk per call,
just with lottery odds instead of per-frame odds.

**Workaround.** Never parse packed text across the FFI on a hot
path. The engine now exposes a numeric profiler ABI
(`bloom_profiler_row_count/_label/_cpu_us/_gpu_us`, `_hist_*`) and
`getProfilerOverlay`/`getProfilerFrameHistory` are rewritten on it —
numbers cross as f64, label strings cross whole and are only drawn.
Engine-allocated FFI strings are also tail-padded 16 zero bytes
(defense for engine-side allocations only — padding cannot protect
Perry-internal slices, which is why the ABI change was required).
If you add an FFI that returns data for per-frame consumption:
return numbers, not delimited text.

## Impact on the shooter's design

The combination of 1, 3 and 4 means we can't use `bloom/world`'s
`loadWorld` or runtime `JSON.parse` at all. The shipped answer is the
**build-time world generator**: `assets/worlds/arena_02.world.json`
is authored in the standard engine schema (the editor round-trips
it), and every `npm run dev` / `npm run world` runs
`tools/build-world.ts` under **bun** (real JS — Perry never parses
the JSON), which emits Perry-safe parallel flat arrays at
`src/generated/world.ts`. The runtime reads geometry, lighting,
spawners, pickups, water and the wave plan exclusively from that
generated module. Adding an entity kind = a bucket in
`tools/build-world.ts` + consuming the arrays in `main.ts`.

Quirk #5 shapes the FFI surface the same way: per-frame data crosses
as numbers (see the engine's `bloom_profiler_row_*` ABI), never as
delimited text.

## Verifying a Perry fix

For quirks 1–4: point the generator pipeline at a runtime
`JSON.parse` path in a scratch branch and see whether entities load
with correct counts (`.length` populated) and no startup segfault
with a reachable `throw` in scope. For quirk #5: return a
`"1.23|4.56\n"`-style blob from any FFI and `split`+`parseFloat` it
every frame — on a broken runtime this AVs within a minute (see
engine `docs/tickets.md` § EN-020 for the validated repro numbers).
