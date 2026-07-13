# Music prompts — ASSET-TODO A4 / SH-036

Six pieces. Everything the game needs, and nothing it doesn't.

The game's music system is already built and running (`src/audio-mix.ts`,
`updateMusicIntensity`). It is inert only because both intensity states currently
point at the same file, so clearing a wave changes nothing you can hear. Drop the
six WAVs named below into `assets/music/` and it comes alive with no code change.

---

## The one rule that matters

**CALM and COMBAT must be the same key and the same tempo.**

The game does not cut between them. It **crossfades over ~2 seconds** while both
are playing, whenever a wave starts or ends. If the two tracks are in different
keys, that 2-second overlap is two songs fighting — it will sound broken, and no
amount of mixing fixes it afterwards.

So both tracks are locked to:

- **Key: D minor**
- **Tempo: 120 BPM**, 4/4 (one bar = 2.0 s)

The three stingers should also sit in **D minor** so they land *on top of*
whichever bed is playing rather than clashing with it.

Write both beds so they are the *same piece at two intensities* — same root, same
harmonic bones — not two different songs. Think "layers pulled in and out", which
is exactly what the crossfade is faking.

---

## What the game does with each file

| File | Role | When it plays |
|---|---|---|
| `music_calm.wav` | Bed, low intensity | Between waves, and whenever no enemies are alive. Auto-attenuated a further ~35% by the mixer, so **do not** pre-quieten it. |
| `music_combat.wav` | Bed, high intensity | A wave is active with enemies alive. Crossfaded in over ~2 s. |
| `sting_wave_clear.wav` | Stinger | The moment the last enemy of a wave dies. |
| `sting_death.wav` | Stinger | The player dies. |
| `sting_victory.wav` | Stinger | The final wave is cleared — the run is won. |
| `music_menu.wav` | Bed | Title screen / menus. *(Optional — replaces the existing `assets/sounds/menu.wav`.)* |

The beds **loop forever**. The stingers are **one-shots played over the bed**, not
replacements for it — the bed keeps going underneath, so a stinger must not be a
full arrangement or it will collide with the music already playing.

---

## Format

- **WAV, 44.1 kHz, 16-bit, stereo.**
- Beds: **60–90 s**, and **seamlessly loopable** (see "Making it loop" below).
- Stingers: **2–4 s**, ending in silence (a natural decay/tail, not a hard cut).

Suno exports MP3 by default. Take the **WAV** download if your plan offers it,
otherwise convert once — do not re-encode an MP3 twice.

---

## The prompts

Suno's "Custom" mode: paste the **Style** text into the style box, leave the
lyrics box **empty**, and turn **Instrumental ON** for every one of these. There
are no vocals anywhere in this game.

---

### 1. `music_calm.wav` — between waves

> **Style:**
> Instrumental sci-fi ambient score, 120 BPM, D minor. Sparse and watchful, not
> peaceful — the feeling of reloading in the open with something still out there.
> Slow evolving synth pad, a low sustained drone, distant metallic reverb hits.
> A single clean guitar or plucked synth figure, widely spaced, repeating with
> variations. Deep sub-bass pulse every two bars. No drum kit, no percussion
> groove. Cinematic, restrained, lots of air and space. Steady unchanging tempo,
> loopable, no build, no drop, no ending — it should sound like it could go on
> forever.

**Why it's written that way:** it plays while the player is walking around picking
up ammo. If it resolves, or builds to anything, it will announce a climax that
isn't coming and undercut the real one.

---

### 2. `music_combat.wav` — a wave is live

> **Style:**
> Instrumental sci-fi combat score, 120 BPM, D minor. Same harmonic world as a
> calm ambient bed but fully driven: pounding tribal-industrial percussion, hard
> kick on every beat, aggressive low synth ostinato pulsing in eighth notes,
> distorted bass. Snarling brass stabs and dissonant string clusters on top.
> Relentless and propulsive, urgent but not chaotic. Steady unchanging tempo,
> loopable, no intro, no outro, no build, no drop — full intensity from the first
> bar to the last.

**Why:** the crossfade can start at *any* moment. A track with an intro spends its
first eight bars being quiet exactly when the player is being charged by three
aliens.

**Keep the same root note and chord movement as the calm bed.** The ideal is that
you could play both at once and it would sound like one piece.

---

### 3. `sting_wave_clear.wav` — the wave is dead

> **Style:**
> Instrumental. A short 3-second cinematic sting in D minor. Tension releasing:
> a rising brass and synth swell resolving upward onto a clean, open, sustained
> chord that rings out and decays into silence. Hopeful but tired — a breath out,
> not a fanfare. Sparse. No drums, no groove, no loop. Ends in silence.

**Why:** it plays *over* the music, which is at that moment crossfading from combat
to calm. Anything busy or percussive will fight both beds at once.

---

### 4. `sting_death.wav` — the player dies

> **Style:**
> Instrumental. A short 3-second cinematic sting in D minor. Sudden collapse: a
> low brass and cello note falling downward, a dissonant cluster, a deep hit with
> a long dark reverb tail decaying into silence. Bleak, final, heavy. No drums,
> no melody, no loop. Ends in silence.

---

### 5. `sting_victory.wav` — the run is won

> **Style:**
> Instrumental. A short 4-second cinematic sting in D minor resolving to D major.
> Triumphant but hard-won and understated: a rising brass and choir-pad swell
> landing on a bright sustained major chord with a long shimmering tail. Earned
> and weary, not a jingle. No drums, no loop. Ends in silence.

**Why D minor → D major:** it's the only place in the whole soundtrack that
resolves. Save it for the one moment that deserves it.

---

### 6. `music_menu.wav` — title screen *(optional)*

> **Style:**
> Instrumental sci-fi main-menu theme, slow, D minor. Brooding and atmospheric,
> with a sense of scale and quiet dread. Deep synth pad, slow low strings, a
> distant lonely melodic motif on a bell or high synth. Wide reverb, unhurried.
> No percussion. Loopable, no ending.

---

## Making it loop (the part Suno won't do for you)

Suno writes *songs* — they start, they end. The beds must not. After you download:

1. Open the WAV in Audacity (free) or any editor.
2. Find a chunk from the middle where the arrangement is at full strength and cut
   it **on the bar line**. At 120 BPM a bar is exactly **2.0 s**, so cut a length
   that is a multiple of 2.0 s — **64.0 s (32 bars)** is a good target.
3. Crossfade the loop seam: copy the last ~1 s, fade it out over the tail, and
   mix it over a fade-in at the head. (The wind ambience in
   `tools/gen-sfx.ts` does exactly this trick if you want to see it in code.)
4. Play it on repeat for two minutes. If you can hear where it joins, move the cut.

**Both beds must be the same length**, or they will drift apart over a long run and
the crossfade will land in a different part of the bar every time.

If you'd rather not do the editing: send me the raw Suno WAVs and I'll cut, loop
and seam them — that part is scriptable and I can verify the seam automatically.

---

## Checking it worked

Drop the files in `assets/music/` and play. Then:

- Clear a wave → the music should **audibly relax within ~2 seconds**, and the
  wave-clear sting should land on top of it.
- The next wave spawning should **re-escalate** it, just as smoothly.
- Take damage → the music ducks under the hit (that's the mixer, already working).
- Die → the death sting.
- Win the last wave → the victory sting.

If the crossfade sounds like two songs colliding, the two beds are not in the same
key — that's the failure mode to listen for, and it's fixable only by regenerating.
