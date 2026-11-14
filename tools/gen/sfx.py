#!/usr/bin/env python3
"""Creature, player and weapon-impact sounds via the ElevenLabs sound-effects API.

  tools/gen/sfx.py              generate every effect that is missing from the done-list
  tools/gen/sfx.py --force      regenerate all
  tools/gen/sfx.py alien2_pain  only the named ones (regenerates them)
  tools/gen/sfx.py --list       names only

These replace the files that were converted from Unvanquished (GPLv3): every creature voice,
the player's pain and death, flesh impact, ricochets, plus three older files of unrecorded
origin. Same file names, so the game code does not change. Writes
assets/sounds/<name>.wav as 16-bit mono 44.1 kHz PCM (the engine's WAV decoder takes 8/16-bit
PCM only; mono because positional sounds must not carry baked-in panning). One-shots are
trimmed of leading/trailing silence, levelled and limited to -2 dB.

A generated name is recorded in assets/sounds/.generated so a plain run does not regenerate it.
Needs ELEVENLABS_API_KEY in .env (git-ignored). Never prints the key.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets/sounds")
DONE = os.path.join(OUT, ".generated")
NO = "Single isolated sound effect, dry, close microphone, no music, no speech, no background."

# The five creature voices, in the game's voice order (src/main.ts: alien<voice>_*):
VOICES = [
    ("a small wiry alien scavenger the size of a dog: thin, shrill, raspy, chittering voice", 0.9),
    ("a tall gaunt alien ambush hunter: dry hissing, clicking, insect-like rasp with a high shriek", 1.0),
    ("a muscular alien predator the size of a large man: wet guttural snarl and bark, mid-pitched", 1.1),
    ("a huge heavy alien brute like a gorilla crossed with a rhinoceros: deep chesty bellow and grunt", 1.3),
    ("a towering alien colossus: enormous, very deep, rumbling, resonant roar that shakes the ground", 1.7),
]
SFX = {}   # name: (seconds, prompt)
for i, (who, k) in enumerate(VOICES):
    SFX[f"alien{i}_attack"] = (round(0.9 * k, 1), f"Short aggressive attack vocalisation of {who}, one sudden lunge snarl. {NO}")
    SFX[f"alien{i}_pain"] = (round(0.8 * k, 1), f"Short pain yelp of {who}, hit by a bullet, one sharp cry cut short. {NO}")
    SFX[f"alien{i}_die1"] = (round(1.6 * k, 1), f"Death cry of {who}: one long falling wail that gurgles and fades out. {NO}")
    SFX[f"alien{i}_die2"] = (round(1.4 * k, 1), f"Death sound of {who}: a choked shriek, then a rattling last breath. {NO}")
    SFX[f"alien{i}_die3"] = (round(1.5 * k, 1), f"Death sound of {who}: an abrupt cry breaking into a wet collapsing groan. {NO}")
SFX.update({
    "dretch_attack": (0.8, f"A quick vicious bite: jaws snapping shut with a wet crunch and a short animal snarl. {NO}"),
    "impact_flesh":  (0.7, f"A bullet hitting thick wet flesh: one sharp meaty thud with a small splatter. {NO}"),
    "ricochet1":     (0.9, f"A bullet ricocheting off rock: sharp crack followed by a high whining whizz flying away. {NO}"),
    "ricochet2":     (0.9, f"A bullet glancing off metal: bright metallic ping and a short descending whine. {NO}"),
    "player_pain1":  (1.0, f"A man takes a heavy hit and grunts loudly in pain, one strained 'ugh', voice close as if inside a helmet. {NO}"),
    "player_pain2":  (0.9, f"A man in a sealed combat helmet cries out sharply in pain, strained, muffled by the helmet. {NO}"),
    "player_die1":   (1.8, f"A man in a sealed combat helmet gives a last agonised cry that collapses into a fading exhale, muffled by the helmet. {NO}"),
    "player_die2":   (1.6, f"A man in a sealed combat helmet chokes, gasps and falls silent, muffled by the helmet. {NO}"),
    "pickup":        (0.7, f"Picking up a weapon: a firm mechanical clack of metal and polymer with a short satisfying confirmation click. {NO}"),
    "rifle_fire":    (0.8, f"One shot from a compact military assault rifle, punchy crack with a short tail, outdoors. {NO}"),
    # --- second pass (2026-11-13): these replaced the synthesised placeholders of tools/gen-sfx.ts
    "reload_start":  (0.6, f"A rifle magazine being released and pulled out: metallic click and slide. {NO}"),
    "reload_end":    (0.6, f"A rifle magazine slammed in and the bolt racked: two firm mechanical clacks. {NO}"),
    "ui_move":       (0.5, f"A menu navigation blip for a military game interface: a soft low electronic tick with a short rounded tail, clearly audible. {NO}"),
    "ui_select":     (0.5, f"A short confident interface confirm sound, low mechanical thunk with a subtle tone. {NO}"),
    "rifle_tail":    (1.4, f"The echo tail of a single rifle shot rolling away across an open valley, no initial crack, only the decaying reverberation. {NO}"),
    "blaster_tail":  (1.0, f"The decaying electric hiss and ring after an energy pistol shot, no initial shot, only the fading tail. {NO}"),
    "chain_tail":    (1.6, f"A rotary machine gun spinning down after firing: barrels whirring to a stop with fading echo. {NO}"),
    "cannon_tail":   (2.6, f"The long deep rumbling echo after a heavy cannon blast rolling across hills, no initial blast, only the decaying thunder. {NO}"),
    # --- third pass (2026-11-14): one fire sound per weapon and a real explosion. Until now the
    # chaingun and the cannon fired the rifle sample and the cannon's blast was the blaster shot.
    "chain_fire":    (0.5, f"One single shot from a heavy rotary machine gun: a short, fat, mechanical bark with a hard metallic clack, very short tail. {NO}"),
    "cannon_fire":   (1.2, f"A heavy energy cannon discharging one charged shot: a deep concussive thump with a crackling electric snap and a low bass punch. {NO}"),
    "explosion":     (2.0, f"A large explosion at medium distance outdoors: a hard initial crack, a deep booming body, then debris and dirt raining down. {NO}"),
    "step_heavy1":   (0.8, f"One enormous heavy footfall of a giant creature landing on soft earth: deep ground-shaking thud with a little debris. {NO}"),
    # --- fourth pass (2026-11-14, plan Phase 2): the claw swing every melee attack makes as it
    # goes active, the critical-hit confirm, and the player's new kit.
    "swing":         (0.5, f"A fast heavy swing through the air: one sharp airy whoosh of a large clawed arm slashing past, no impact. {NO}"),
    "crit_hit":      (0.5, f"A bullet punching through bone: one sharp wet crack with a short bright snap on top, very short. {NO}"),
    "melee_hit":     (0.6, f"A rifle stock smashing into a body: one hard dull thud of wood and metal on flesh and armour with a short grunt of impact. {NO}"),
    "grenade_throw": (0.7, f"A grenade pin pulled and the grenade thrown: a small metallic click and ping, then a short cloth whoosh of an arm. {NO}"),
    "grenade_bounce":(0.5, f"A steel hand grenade bouncing once on hard ground: one dull metallic clunk and a short rattle. {NO}"),
    "heal":          (0.8, f"A field medical injector used: a short pneumatic hiss and click followed by a soft rising tone of relief. {NO}"),
})
for i in range(1, 5):
    SFX[f"step_grass{i}"] = (0.5, f"One single footstep of a booted soldier on dry grass, variation {i}: short soft crunch and rustle. {NO}")
    SFX[f"step_concrete{i}"] = (0.5, f"One single footstep of a booted soldier on a bare concrete floor indoors, variation {i}: short hard tap with a slight scuff. {NO}")
    SFX[f"step_dirt{i}"] = (0.5, f"One single footstep of a booted soldier on packed dirt and gravel, variation {i}: short gritty crunch. {NO}")
    SFX[f"skitter_light{i}"] = (0.5, f"One quick light claw scrabble of a small creature on hard dirt, variation {i}: a short dry scratchy tick. {NO}")
    SFX[f"skitter_heavy{i}"] = (0.5, f"One heavy clawed footfall of a large creature on dirt, variation {i}: a dull thump with claws scraping. {NO}")
# Loops: requested as seamless loops and levelled quieter, to sit under everything else.
LOOPS = {
    "crawl_loop":    (4.0, "Continuous close sound of many clawed feet scuttling and scraping over dry earth, steady, no music, no voices."),
    "ambient_wind":  (22.0, "Steady gentle wind blowing over an open grassy river valley with distant rustling leaves, calm, no birds, no music, no voices."),
}
for _n, _v in LOOPS.items():
    SFX[_n] = _v


def env_key():
    for line in open(os.path.join(ROOT, ".env")):
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("ELEVENLABS_API_KEY missing in .env")


def request(key, body):
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
        data=json.dumps(body).encode(), method="POST",
        headers={"xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def generate(key, name):
    seconds, prompt = SFX[name]
    body = {"text": prompt, "duration_seconds": max(0.5, seconds), "prompt_influence": 0.5}
    loop = name in LOOPS
    data = None
    if loop:
        try:
            data = request(key, dict(body, loop=True, model_id="eleven_text_to_sound_v2"))
        except urllib.error.HTTPError as e:
            print(f"  {name}: loop request refused ({e.code}); generating without the loop flag", flush=True)
    if data is None:
        data = request(key, body)
    dst = os.path.join(OUT, name + ".wav")
    tmp = dst + ".raw.mp3"
    open(tmp, "wb").write(data)
    if loop:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-af",
                        "loudnorm=I=-23:TP=-2,aresample=44100", "-ac", "1", "-c:a", "pcm_s16le", dst], check=True)
        os.remove(tmp)
        print(f"  {name}.wav  loop", flush=True)
        return
    af = ("silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
          "silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
          "afade=t=in:d=0.004,loudnorm=I=-16:TP=-1.5,alimiter=limit=0.79:level=false,aresample=44100")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-af", af,
                    "-ac", "1", "-c:a", "pcm_s16le", dst], check=True)
    os.remove(tmp)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dst],
                         capture_output=True, text=True).stdout.strip()
    print(f"  {name}.wav  {float(dur):.2f} s", flush=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--list" in sys.argv:
        print("\n".join(SFX)); return
    done = set(open(DONE).read().split()) if os.path.exists(DONE) else set()
    names = args or [n for n in SFX if "--force" in sys.argv or n not in done]
    unknown = [n for n in names if n not in SFX]
    if unknown:
        sys.exit(f"unknown: {', '.join(unknown)}")
    key = env_key()
    failed = []
    for n in names:
        try:
            generate(key, n)
            done.add(n)
            open(DONE, "w").write("\n".join(sorted(done)) + "\n")
        except urllib.error.HTTPError as e:
            failed.append(n)
            print(f"  {n}: HTTP {e.code} {e.read()[:200].decode(errors='replace')}", flush=True)
        except Exception as e:   # noqa: BLE001 - report and keep going
            failed.append(n)
            print(f"  {n}: {e}", flush=True)
    print(f"{len(names) - len(failed)} generated" + (f", FAILED: {', '.join(failed)}" if failed else ""))


if __name__ == "__main__":
    main()
