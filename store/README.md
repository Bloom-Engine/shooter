# App Store listing

The listing of Bloom Shooter (App Store Connect app 6834091121) for iOS/iPadOS, macOS and tvOS,
in the 13 languages of Bloom Jump (`../jump/store`): en, de, es, fr, it, ja, ko, pt-BR, th, tr,
vi, id, zh-Hans. The game's own text is in four of them (en, de, fr, es); the listing says so.
Binaries go up with `tools/release/release.py` (docs/RELEASE.md); this folder is everything else.

```
store/
  metadata/source.json     listing copy per language (name, subtitle, keywords, promo, description)
  metadata/captions.json   screenshot captions per language, keyed by shot id
  tools/asc_store.py       App Store Connect: configure / text / shots / attach / check
  tools/capture.sh         raw captures from the game's picture harnesses
  tools/frame_screenshots.py   capture -> captioned store screenshot, per device and language
  screenshots/raw/<shot>.jpg   the chosen capture for each shot id (see SHOTS in the framer)
  screenshots/raw/captures/    capture.sh output (git-ignored)
  screenshots/out/             framed output (git-ignored)
```

## Order of work

```sh
python3 store/tools/asc_store.py configure   # once: category, age rating, price, territories...
python3 store/tools/asc_store.py text        # after editing source.json
store/tools/capture.sh                       # needs a built ./main, the desktop session
#   pick a capture per shot id into store/screenshots/raw/<shot>.jpg
python3 store/tools/frame_screenshots.py     # all devices x languages (JPEG, exact sizes)
python3 store/tools/asc_store.py shots       # replaces each language's set per display
python3 tools/release/release.py --bump major    # 1.0.0 builds (the store versions are 1.0.0)
python3 store/tools/asc_store.py attach <build>  # once the builds are VALID
python3 store/tools/asc_store.py check       # what is still missing
```

Nothing here submits for review; that is a button in App Store Connect.

## Decisions on record

- **Name.** "Bloom Shooter" is taken by another developer's app in es-ES, fr-FR, it, ja, pt-BR
  and id (Apple refuses the localization). Those six use "Bloom Shooter: Alien Swarm".
- **Same as Jump:** free, every territory plus new ones, copyright "2026 Skelpo GmbH", privacy
  and support URL `https://www.skelpo.com/en/privacy` (tvOS gets it as privacy text), content
  rights "uses third-party content" (CC0 scans, OFL font).
- **Category** Games / Action. **Age rating** comes out at 12+: frequent/intense fantasy
  violence, frequent/intense guns, infrequent/mild horror; everything else none
  (`AGE_RATING` in asc_store.py).
- **Review notes** (how to play, controller needed on Apple TV) are set on all three versions.
  The App Review contact (name, phone, email) is not: fill it in once in App Store Connect.
- **App Privacy** has no API: in App Store Connect, App Privacy -> "Data Not Collected" ->
  Publish. The game sends nothing anywhere (crash reports stay on disk).

## Screenshots

Eight shots in store order (`SHOTS` in frame_screenshots.py, captions in captions.json):
fight, boss, arenas, night, weapons, objective, armory, world. Each is the capture full bleed,
cropped to the device (iPhone 6.9" 2868x1320, iPad 13" 2752x2064, Mac 2880x1800, Apple TV
1920x1080), with the caption on a dark band at the top in the game's UI face (Rajdhani; Arial
Unicode for scripts it lacks). Upper case where the script has case; Turkish keeps its dotted I.

Captures come from `./main --harness storeshot` (src/main.ts), which `capture.sh` runs per arena:
a real run from a chosen wave (`--wave N`, with a score to match) and weapon (`--weapon N`), staged
for the camera. Each take turns the player down the most open line of sight (an objective wave:
facing a nest, or inside the hold ring), stands the wave's live creatures 7-11 m along it, charging,
and captures the moment twice, with and without the HUD. The store set uses the HUD-less frames
(the 2.17:1 iPhone and 4:3 iPad crops would cut the HUD's corners). Menus (arenas, armory) come
from UISHOT and are framed INSET (whole, below the caption: `None` focus in SHOTS).
`STORE_BIN=<binary>` makes capture.sh run a build other than ./main.

Chosen for 1.0 (2026-11-15), from `screenshots/raw/captures/`:
01-fight arena_04 wave 8 chaingun take 05 · 02-boss arena_06 wave 10 take 04 ·
03-arenas UISHOT 07 · 04-night arena_06 wave 9 take 05 · 05-weapons arena_05 wave 5 lance take 05 ·
06-objective arena_03 wave 4 (nests) take 05 · 07-armory UISHOT 12 · 08-world arena_05 wave 5 take 00.
The two menu shots are in English in every language (the game has four; the captions carry the rest).

Disk: a native capture is ~15 MB as PNG; capture.sh converts each run to JPEG at once.
