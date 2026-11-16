# Google Play

Bloom Shooter on Google Play: package `com.bloomengine.shooter`, free, no ads, no in-app purchases.

```
android/play/
  build_listing.py     listing text (13 locales) + graphics, from the App Store copy (store/metadata)
  metadata/<locale>/   title, short and full description (committed); images/ (git-ignored, rebuilt)
  upload.sh            bundle or listing to Play (fastlane supply, Play Developer API)
android/gamedata/      the install-time asset pack the bundle carries the game's assets in
```

## Build

```sh
tools/build-android.sh --bundle --version-code=N [--version-name=1.0.0] [--install]
```

`--version-code` must be higher than every upload before it (1 was the first). The result is
`android/app/build/outputs/bundle/release/app-release.aab`, signed with the upload key.
`--install` puts the bundle on the connected phone the way Play would (bundletool), asset pack
included. The phone then has the release signature, so a debug `--install` afterwards needs
`adb uninstall com.bloomengine.shooter` first.

What makes the bundle Play-ready:
- **Target API 36** (Play's rule for new apps and updates since 2026-08-31). `compileSdk` 36 on
  Android Gradle plugin 8.8.2 prints a "newer plugin recommended" warning; it builds.
- **Size.** The base module is ~15 MB, under the 200 MB limit. The assets (~435 MB compressed)
  are the install-time asset pack `gamedata`, under the 1.5 GB per-pack limit. Play installs it
  with the app, and its files appear in the AssetManager as before. On the phone the game then
  holds the assets twice, once in the pack and once extracted to `filesDir`; letting the engine
  read from the pack directly would halve that.
- **16 KB pages.** The native library's LOAD segments are 16 KB aligned (Play requires it for
  API 35+; check with `llvm-readelf -lW libbloom_shooter.so`).
- arm64-v8a only. Every 64-bit phone Play serves this game to has it.

## Upload key

`~/.android/keystores/bloom-shooter-upload.jks` (alias `upload`, RSA 4096, made 2026-11-16).
The password is in the login keychain: service `bloom-shooter-upload`, account `upload`.
SHA-256: `09:D7:84:F3:91:E9:FF:D1:1C:B4:E2:D0:80:FB:4E:42:03:85:9A:A1:00:15:80:25:A0:8D:2D:28:43:7D:1A:93`.
Back both up somewhere safe. With Play App Signing, Google holds the key users' devices check.
This one only proves an upload is ours, and Play support can reset a lost upload key, but that
takes days.

## Play Console, once (no API for these)

1. **Create app**: name Bloom Shooter, default language English (United States), Game, Free.
2. **App content**:
   - Privacy policy: `https://www.skelpo.com/en/privacy`.
   - Ads: no.
   - App access: all functionality available without special access.
   - Content rating (IARC questionnaire), category Game. Answer as on the App Store (12+ there):
     - violence: yes, against non-human fantasy creatures, frequent, no blood or gore against
       humans;
     - weapons: realistic-looking guns used against the creatures;
     - fear / horror: mild;
     - no sex, no drugs, no gambling, no profanity, no user interaction or sharing, no location,
       no digital purchases.
   - Target audience: 13 and over. Not designed for children.
   - Data safety: no data collected, no data shared. The game sends nothing anywhere; crash
     reports stay on the device.
   - Government app, financial features, health: no.
3. **Store settings**: category Action (by hand). Contact email `info@skelpo.com` and website
   `https://www.skelpo.com` are set through the API (edits.details), as on Bloom Jump.
4. **Store listing**: `upload.sh listing` fills it in all 13 languages. By hand, the main
   listing needs the same five things: title, short and full description, icon, feature
   graphic, and two or more phone screenshots.
5. **API access**: nothing to set up. `upload.sh` uses the account-wide service-account key
   Bloom Jump publishes with (`publish@searchbird-483214.iam.gserviceaccount.com`, the JSON in
   `~/projects/gscmaster.com/`); it reaches every app in the developer account, new ones too.
6. **First release**: `upload.sh bundle internal` (a draft on the internal track; version 1 went
   up this way on 2026-11-16 and was rolled out to the internal track through the API; testers
   are an email list in Play Console). Then Countries/regions,
   review, roll out. Production needs the app content above complete. A personal developer
   account made after November 2023 also needs a closed test with 12 testers for 14 days first;
   an organisation account does not.

## State (2026-11-16)

Every Play Console setup task is done: all App content declarations, the content rating
(PEGI 12, USK 16; violence against humans and fantasy creatures, often close up, fantastical
setting, mild ichor blood on creatures, frequent scary elements), category Action, the listing
in 13 languages. Version 1.0.0 is live on Internal testing for the email list "Bloom Shooter
internal"; opt in at https://play.google.com/apps/internaltest/4700784802029688558.
Internal testing needs no review. Production 1.0.0 (version code 2) (full rollout, 178 countries plus rest of
world) was sent for review the same day, together with the listing and all declarations.
A never-published app's first production release can only be a draft through the API; it was
saved and submitted in Play Console. Managed publishing is off, so approval publishes it.

Version code 1 failed Play's pre-review check, "Invalid data safety declaration (Email address
not declared)", although the app has no permissions at all, not even INTERNET: the scan read
unused androidx.core code (ContextCompat's account-service map, PatternsCompat's e-mail pattern)
as e-mail collection. The app needs no dependencies; keep `dependencies {}` empty, or turn on R8
(`isMinifyEnabled`) if one is ever added, so dead library code does not ship.

## Screenshots

`build_listing.py` frames the App Store captures (`store/screenshots/raw`, desktop renders) at
Play's phone (1920x1080) and tablet (1920x1200, 2560x1600) sizes, captioned per language. A
low-tier phone (Pixel 4a class) draws a much plainer picture than these: no shadows, fewer
trees, lower resolution. Captures from a phone would show players what such a phone gets.
