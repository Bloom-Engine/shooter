# AAA round 1 — feel, VFX, audio, structure

What landed against the gap audit (`docs/tickets.md`), what is verified, and
what is honestly still open. Written 2026-07-12.

## The thesis

The audit's finding was that the renderer is past diminishing returns while the
things a player *feels* had no support at all. This round builds those systems.
The renderer was not touched except to fix a bug it turned out to have.

## Engine (see engine `docs/tickets.md`)

| Ticket | What shipped |
|---|---|
| EN-028 | Animation mixer: crossfade (smoothstepped, hemisphere-corrected nlerp), one masked layer (attack drives the spine while the legs keep walking), opt-in root motion with correct delta across the loop wrap. The engine now owns clip time — a crossfade is impossible otherwise, because the *outgoing* clip has to keep advancing. |
| EN-033 | Bone sockets. `joint_matrices` is skinning-space and useless for attaching props; the pre-inverse-bind world transforms are kept and exposed. |
| EN-026 | Particle system. SoA pool, swap-remove, gravity/drag/floor-bounce, curves over normalized age. Native because the alternative isn't: instance data crosses the FFI one float at a time, so 2k particles would be ~24k calls/frame against a budget of ~240. Game↔engine traffic is now O(spawn events). |
| EN-027 | Decals. Oriented sticker quads through the instanced cutout path rather than a new deferred pass. They cannot wrap a corner — the honest limitation, and invisible on bullet holes and blood. |
| EN-029 | Audio buses (SFX/music/UI) with a duck envelope, a Schroeder reverb on a per-sound send, and a per-voice one-pole low-pass (the occlusion primitive). `wet = 0` bypasses the whole reverb path, so it costs nothing until asked for. |
| EN-031 | Windows XInput polling turned out to be **already wired** — the ticket's suspicion was wrong. What was missing is rumble, which now ships. |
| EN-014 | **Bug fix.** See below. |

### The bug that ate an afternoon

`set_user_params` rebuilt a material's bind group with the 1×1 **stub** texture
array hardcoded on bindings 14/15/16. So the natural order —

```ts
setMaterialTextureArray(m, ALBEDO, arr);   // bind the art
setMaterialParams(m, [...]);               // ...and silently lose it
```

— left the material sampling the stub. No error, no validation warning; the
pixels just never appeared. The particle and decal pools were full, the instance
buffers were being written, the draws were dispatched, and the screen was empty.

Two lessons worth keeping:

1. **Diagnose by bisection, not by staring.** Logging live pool counts split
   "the sim is broken" from "the draw is broken" in one run. Forcing the
   fragment shader to a constant colour then split "the draw is broken" from
   "the fragment is broken" in one more. Each step was a single build.
2. **Silent-empty is the worst failure mode an API can have.** The fix ships
   with an end-to-end regression test that renders and reads the pixel back —
   asserting the *link* survives would have passed even with the bug, because
   the link always survived; it was the bind group that lost it.

## Game

| Ticket | State |
|---|---|
| SH-027 weapon models | **Shipped.** `tools/build-weapons.ts` generates 4 GLBs (rifle/blaster/chaingun/cannon) with documented muzzle points. The `drawCube` guns are gone. The gun rides the skeleton's `tag_weapon` socket. |
| SH-028 weapon mechanics | **Shipped.** Timed reload, magazine + reserve, spread that blooms while you hold the trigger and recovers when you stop, camera recoil with horizontal wander, shoulder-aim (orbit 6.0 → 2.6 m, spread ×0.4). All weapons are rows in a stat table. |
| SH-029 camera & screen feedback | **Shipped.** Trauma-based shake (amplitude = trauma², so it composes), hit-stop on kills, FOV kick, directional damage flinch + HUD arc, low-health grading, landing dip. |
| SH-030 hit reactions | **Shipped.** Light kinds flinch on any hit (with a lockout so full-auto can't stun-lock); heavies need enough damage inside a window to stagger, so a tyrant shrugs off a rifle. |
| SH-032 sprint + dodge | **Shipped.** Dodge commits the player for 0.25 s — a decision, not a free boost. |
| SH-033 combat VFX | **Shipped.** Muzzle flash + smoke + shell casings, tracers every 3rd round, sparks and dust on hard impacts, ichor on flesh, bullet holes and blood splats that persist, explosion set for the cannon. |
| SH-034 locomotion | **Shipped.** Playback rate is driven by actual speed — the fix that kills foot-sliding — plus crossfades and the upper-body attack layer. |
| SH-003 footsteps | **Code shipped, assets missing.** Distance-accumulated so cadence follows sprint for free; falls back to silence per file. See ASSET-TODO A1. |
| SH-035/036 audio | **Code shipped, assets missing.** Buses, ducking on damage, reverb that rises near the building, weapon tails. Tails and music stems are ASSET-TODO A2/A4. |
| SH-037 settings | **Shipped.** `settings.json`, parsed once at boot; video/audio/controls/accessibility/meta. |
| SH-038 menus | **Shipped.** Pause + settings, one focus model across mouse, keyboard, gamepad and touch. |
| SH-039 gamepad | **Shipped.** Full mapping, response curve, aim slowdown near targets, rumble. |
| SH-041 meta loop | **Shipped.** Score, combo with decay, wave report card, persisted bests, weapon unlock. |
| SH-042 content | **Partial.** Chaingun + lucifer cannon (charge, AoE, self-damage) are in as stat rows. The 2 new enemy kinds need the vendor submodule (ASSET-TODO M2). |
| SH-043 accessibility | **Partial.** Shake slider, colourblind-safe hit confirmation (white tick + sound, not a red tint), damage direction as a *position*. Localization table not done. |

## Verified how

`COMBATSHOT` harness in `main.ts` (dormant; set to `true` to re-run): auto-starts
a fight, spawns enemies, holds the trigger, and logs live pool counts.
`tools/shot-window.ps1` captures the game's own window rect — **not** the
desktop, which would otherwise catch whatever else is on screen, and which was
also a 2560×1440 crop of the 4K screen until the capture was made DPI-aware.

Confirmed on screen: blood particles on a struck alien, a green ichor splat
decal persisting on the ground, the weapon in the player's hand, the reload bar,
mag/reserve readout, spread-driven crosshair. Frame rate in combat: ~32 fps at
4K/TSR on the 760M iGPU (unchanged — the VFX budget did not register).

## Known-broken, filed

- **`takeScreenshot()` does nothing on Windows.** The TS call never reaches the
  native FFI: no `bloom: screenshot requested` log, no file. Every harness that
  "captured" via this path has been capturing nothing. Filed as EN-038.
- **`drawModelRotated` has no pitch**, so the weapon cannot tilt with the aim.
  Fine in third person at normal angles; a full-transform immediate draw is
  EN-039.
- `findJoint`'s substring fallback resolved `'hand'` to `IKhand.L` (an IK target
  near the pelvis) and parked the gun inside the player's body. Sockets fail
  silently; name them exactly.
