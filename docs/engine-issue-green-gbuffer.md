# Post-mortem: "everything 3D renders green" on Perry-compiled macOS

**Fixed upstream** in Bloom engine commit
[`0137335`](https://github.com/Bloom-Engine/engine/commit/0137335).
Kept here as a record of how we bisected it — the debugging approach
(gltf-validator, bisect of post-FX passes, reading bloom's renderer
source) transfers to future "works in garden, breaks in shooter"
bugs.

## Symptom
When a Perry-compiled game uses `beginMode3D` + any 3D draw calls on macOS, the 3D viewport fills with solid bright green (≈ `rgb(0,255,0)`) regardless of:
- `clearBackground(any_color)` — tested with pure red, pure blue, custom dark — all produce green
- `drawCube(...)`, `drawSphere(...)`, `drawModel(...)` — no geometry visible

2D passes (`drawRect`, `drawText`, `drawCircle`, `measureText`) render correctly.

## Root cause
`native/shared/src/renderer/mod.rs:7563` clears the `material_rt_view` MRT attachment to:
```rust
load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.0, g: 1.0, b: 0.0, a: 0.0 }),
```
That's the material G-buffer (metallic/roughness encoding), not a color target. Its hardcoded green is reaching the final swapchain — the composition pass appears to be missing, using the wrong attachment, or this debug MRT is accidentally bound to the present surface.

## Repro
First Perry-compiled game to exercise the 3D pass heavily. Happens after any `loadModel` call — but also reproduces with zero geometry: just `clearBackground + beginMode3D + endMode3D + drawText(HUD)` → 3D area is green, text overlays correctly.

Minimal repro:
```ts
import { initWindow, beginDrawing, endDrawing, clearBackground,
         beginMode3D, endMode3D, vec3 } from 'bloom';
initWindow(1024, 640, 'repro');
while (true) {
  beginDrawing();
  clearBackground({ r: 0, g: 0, b: 250, a: 255 });  // pure blue — renders green
  beginMode3D({ position: vec3(0,0,0), target: vec3(0,0,-1),
                up: vec3(0,1,0), fovy: 60, projection: 0 });
  endMode3D();
  endDrawing();
}
```

## Impact
Blocks all 3D development on macOS under Perry. Physics, input, raycast, gameplay all work — we just can't see the scene. Verified via self-test harness: a shot fired headlessly registered `shots 1/1` on HUD but no visual feedback in-viewport.

## Environment
- perry 0.5.158
- engine HEAD = `9d368dc` (post Jolt migration)
- macOS 26.4 (Darwin 25.4.0), Apple M1 Pro, MacBookPro18,2
- First reproduced while building a shooter test-game

## Update 2026-04-22: root cause found — debug marker in `fs_main_3d`

The bloom-vs-no-bloom correlation was misleading. The real bug: `fs_main_3d` in `native/shared/src/renderer/shaders.rs:191` hardcodes `vec4<f32>(0.0, 1.0, 0.0, 1.0) // DEBUG: green if pipeline_3d renders this` as its HDR-color output. That discards the computed `lit` / `tex_color` / `in.color` and writes pure green for every immediate-mode 3D draw (drawCube, drawSphere, drawModel via pipeline_3d).

The shooter uses `drawCube` for walls/floor, so every wall fragment wrote green into `hdr_rt`, which then propagated through the rest of the pipeline. The reason turning bloom off *appeared* to fix it was post-tonemap brightness differences making the green "read" less saturated; the scene was never actually being rendered correctly.

Introduced in commit `879c42fb` ("fix(renderer): shadows — NaN opacity, ortho NDC range, pipeline bugs") on 2026-04-15, left behind when the shadow debugging wrapped up.

Fix: restore the pre-debug expression —

```wgsl
vec4<f32>(tex_color.rgb * in.color.rgb * lit, tex_color.a * in.color.a)
```

Verified by rebuilding the shooter with `setBloomEnabled(true)` + SELFTEST screenshot: sky, walls, dretch model, and HUD all render correctly with bloom on.

The defensive `material_rt` clear-to-transparent change remains in place as a small cleanup; it wasn't the cause but avoids a confusing "green" appearance in future frame captures of that G-buffer.

## Also noted while debugging (smaller, possibly related Perry bugs)
- `return { ok: flag, errors }` object-shorthand inside `validateWorld` yields `{ok: false, errors: []}` at the callsite even when `errors.length === 0` — `ok` field is corrupted.
- `JSON.parse(worldJson).entities.length` reads as `undefined` — arrays from JSON.parse don't have a populated `.length`.
- Functions whose control flow contains `throw new Error(...)` segfault at program start (SIGSEGV near `0xfffffffffffffff9`). Affects `loadWorld`. Workaround: avoid throws in the reachable graph.
