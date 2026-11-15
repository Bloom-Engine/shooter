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
# --- fifth pass (2026-11-15, plan Phase 5): audio depth. Three shots per weapon, the mechanism
# and the casing, a voice for the three kinds that borrowed one, an idle and an alert call for
# all eight, one impact set per material, the boss, the nests.
VOICES5 = VOICES + [
    ("a bloated alien spitter with a throat sac: wet, gargling, bubbling, phlegmy voice", 1.0),
    ("a squat armoured alien artillery beast: hollow, booming, resonant, like a huge bullfrog in a drum", 1.3),
    ("a gigantic alien brood mother four metres tall: layered, monstrous, a deep roar with a high shrieking overtone", 1.9),
]
for i in (5, 6, 7):
    who, k = VOICES5[i]
    SFX[f"alien{i}_attack"] = (round(0.9 * k, 1), f"Short aggressive attack vocalisation of {who}, one sudden lunge snarl. {NO}")
    SFX[f"alien{i}_pain"] = (round(0.8 * k, 1), f"Short pain yelp of {who}, hit by a bullet, one sharp cry cut short. {NO}")
    SFX[f"alien{i}_die1"] = (round(1.6 * k, 1), f"Death cry of {who}: one long falling wail that gurgles and fades out. {NO}")
    SFX[f"alien{i}_die2"] = (round(1.4 * k, 1), f"Death sound of {who}: a choked shriek, then a rattling last breath. {NO}")
    SFX[f"alien{i}_die3"] = (round(1.5 * k, 1), f"Death sound of {who}: an abrupt cry breaking into a wet collapsing groan. {NO}")
for i, (who, k) in enumerate(VOICES5):
    SFX[f"alien{i}_idle"] = (round(1.1 * k, 1), f"Quiet idle vocalisation of {who}, calm and unaware: low breathing and a soft curious murmur, not aggressive. {NO}")
    SFX[f"alien{i}_alert"] = (round(0.9 * k, 1), f"Alert call of {who} that has just spotted prey: one sudden rising bark of recognition, a warning to the pack. {NO}")
SFX.update({
    "rifle_fire3":   (0.8, f"One shot from a compact military assault rifle, sharp dry crack with a short tail, slightly different take, outdoors. {NO}"),
    "blaster_fire2": (0.6, f"One shot from a futuristic energy pistol: a short tight electric zap with a hard snap at the front. {NO}"),
    "blaster_fire3": (0.6, f"One shot from a futuristic energy pistol: a short bright plasma crack with a small descending tone. {NO}"),
    "chain_fire2":   (0.5, f"One single shot from a heavy rotary machine gun: a short fat mechanical bark, slightly brighter take, very short tail. {NO}"),
    "chain_fire3":   (0.5, f"One single shot from a heavy rotary machine gun: a short deep punchy bark with a metallic clank, very short tail. {NO}"),
    "cannon_fire2":  (1.2, f"A heavy energy cannon discharging one charged shot: a deep concussive boom with an electric crackle and sub-bass punch, different take. {NO}"),
    "cannon_fire3":  (1.2, f"A heavy energy cannon discharging one charged shot: a thunderous thump followed by a short sizzling electric tail. {NO}"),
    "scatter_fire1": (0.9, f"One blast from a heavy pump-action combat shotgun, outdoors: a huge wide boom with a hard crack, short tail. {NO}"),
    "scatter_fire2": (0.9, f"One blast from a heavy combat shotgun, outdoors: a deep punchy boom, slightly different take, short tail. {NO}"),
    "scatter_fire3": (0.9, f"One blast from a heavy combat shotgun, outdoors: a sharp cracking boom with a thump in the chest, short tail. {NO}"),
    "lance_fire1":   (1.0, f"One shot from a magnetic rail rifle: a rising capacitor whine cut by a violent supersonic crack and an electric snap. {NO}"),
    "lance_fire2":   (1.0, f"One shot from a magnetic rail rifle: a piercing high-voltage crack with a tearing whip through the air. {NO}"),
    "lance_fire3":   (1.0, f"One shot from a magnetic rail rifle: a hard metallic slam and a bright electric crack, slightly different take. {NO}"),
    "scatter_tail":  (1.6, f"The echo of a shotgun blast rolling away across open country, no initial blast, only the decaying boom. {NO}"),
    "lance_tail":    (1.6, f"The fading electric ring and distant crack echo after a rail rifle shot, no initial shot, only the decaying tail. {NO}"),
    "mech_rifle":    (0.5, f"The mechanism of an assault rifle cycling once: a quick metallic bolt clack, very short, no gunshot. {NO}"),
    "mech_pump":     (0.6, f"A pump-action shotgun being racked once: slide back and forward, two firm clacks, no gunshot. {NO}"),
    "mech_energy":   (0.6, f"An energy weapon recharging after a shot: a short rising capacitor whine ending in a soft click. {NO}"),
    "dry_fire":      (0.5, f"The trigger of an empty rifle pulled: one dry metallic click of the hammer on an empty chamber. {NO}"),
    "swap1":         (0.6, f"A soldier switching weapons: a rifle slung on its strap and another raised, cloth rustle and a firm metal clack. {NO}"),
    "swap2":         (0.6, f"A weapon pulled out of a holster and readied: loud cloth and polymer slide followed by a firm metallic locking click. {NO}"),
    "reload_mid":    (0.5, f"A full rifle magazine pushed into the magazine well: one solid click as it seats. {NO}"),
    "reload_cell_out": (0.7, f"A spent energy cell ejected from a futuristic weapon: a release click and a short hiss of venting gas. {NO}"),
    "reload_cell_in":  (0.8, f"A fresh energy cell locked into a futuristic weapon: a heavy clunk followed by a short rising power-up hum. {NO}"),
    "shell_dirt1":   (0.6, f"One small brass bullet casing landing on dry dirt: a soft dull tick and a tiny roll. {NO}"),
    "shell_dirt2":   (0.6, f"One small brass bullet casing dropping into grass and earth: a muted tick, barely a bounce. {NO}"),
    "shell_hard1":   (0.7, f"One small brass bullet casing bouncing on a concrete floor: bright metallic tinkling, two or three bounces. {NO}"),
    "shell_hard2":   (0.7, f"One small brass bullet casing bouncing on stone: a bright ping and a short rattle to rest. {NO}"),
    "spawn1":        (1.0, f"A creature bursting up out of the ground: earth cracking and soil thrown aside with a wet tearing sound. {NO}"),
    "spawn2":        (1.0, f"A creature clawing its way out of a burrow: dirt and stones scattering, a heavy scrape. {NO}"),
    "elite_growl":   (1.6, f"A large dominant alien predator announcing itself: a long low threatening growl that swells and ends in a snap of jaws. {NO}"),
    "boss_roar":     (3.2, f"The enraged roar of a gigantic alien brood mother four metres tall: a huge layered bellow rising into a shriek, shaking the air. {NO}"),
    "boss_slam":     (1.6, f"A gigantic creature slamming both arms into the ground: a massive deep impact with cracking earth and falling debris. {NO}"),
    "boss_summon":   (2.2, f"A gigantic alien brood mother calling her young: a long pulsing ululating shriek with wet clicking underneath. {NO}"),
    "spit_fire":     (0.6, f"An alien creature spitting a glob of acid: a wet forceful hawk and a spat projectile leaving. {NO}"),
    "lob_fire":      (0.8, f"An alien artillery creature launching a heavy organic projectile from its back: a deep hollow thoomp with a wet slap. {NO}"),
    "acid_hit":      (0.8, f"A glob of acid splattering on the ground: a wet slap followed by a short fizzing sizzle. {NO}"),
    "nest_hit":      (0.6, f"A bullet striking a fleshy alien egg nest: a wet squelching thud into membrane and slime. {NO}"),
    "nest_burst":    (1.6, f"A large fleshy alien nest bursting apart: a wet ripping pop, fluid gushing and pieces slapping the ground. {NO}"),
    "explosion2":    (2.0, f"A large explosion at close range outdoors: a sharp violent crack, a heavy bass boom, then earth and stones pattering down. {NO}"),
    "explosion3":    (2.0, f"A grenade explosion outdoors: a hard dry bang with a short deep thump and debris scattering. {NO}"),
    "impact_flesh2": (0.6, f"A bullet hitting thick wet alien flesh: a meaty slap with a small squelch, different take. {NO}"),
    "impact_flesh3": (0.6, f"A bullet punching into a tough leathery hide: one dull thud with a wet tear. {NO}"),
})
for i in (1, 2):
    SFX[f"impact_dirt{i}"] = (0.5, f"A bullet striking dry earth, variation {i}: a short dull thud with a spray of soil and grit. {NO}")
    SFX[f"impact_wood{i}"] = (0.5, f"A bullet striking a wooden plank or tree trunk, variation {i}: a sharp crack with splinters flying. {NO}")
    SFX[f"impact_stone{i}"] = (0.5, f"A bullet smashing into a brick wall, variation {i}: a loud hard crack and a burst of crumbling masonry and falling grit. {NO}")
    SFX[f"impact_metal{i}"] = (0.5, f"A bullet striking a steel plate, variation {i}: a hard ringing clang, very short. {NO}")
    SFX[f"impact_water{i}"] = (0.6, f"A bullet striking the surface of a river, variation {i}: a sharp plunging splash with a small spray. {NO}")

# Loops: requested as seamless loops and levelled quieter, to sit under everything else.
LOOPS = {
    "crawl_loop":    (4.0, "Continuous close sound of many clawed feet scuttling and scraping over dry earth, steady, no music, no voices."),
    "ambient_wind":  (22.0, "Steady gentle wind blowing over an open grassy river valley with distant rustling leaves, calm, no birds, no music, no voices."),
    "amb_birds":     (22.0, "Daytime countryside ambience: sparse songbirds calling from distant trees, a few insects, very calm, no wind noise, no music, no voices, no water."),
    "amb_night":     (22.0, "Night ambience in a remote hollow: steady crickets and night insects with an occasional distant owl-like call, calm, no wind noise, no music, no voices."),
    "amb_room":      (12.0, "Room tone inside an empty concrete building: a very quiet low hum and faint air movement, almost silent, no music, no voices."),
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
