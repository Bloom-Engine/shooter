#!/bin/bash
# Upload the Play bundle and/or the listing to Google Play (fastlane supply).
#
#   android/play/upload.sh bundle [track]    the .aab from build-android.sh --bundle, as a DRAFT
#                                            release on `track` (default internal)
#   android/play/upload.sh listing           text + graphics from android/play/build_listing.py
#
# Needs the Play Developer API key of a service account with access to this app in Play
# Console, at $PLAY_JSON_KEY. The default is the account-wide key Bloom Jump publishes with
# (publish@searchbird-483214, ~/projects/gscmaster.com/; never in the repo). The listing goes
# with the internal track's release because a new app has none on production. A draft release
# is reviewed and rolled out by hand in Play Console.
set -euo pipefail
cd "$(dirname "$0")/../.."
KEY="${PLAY_JSON_KEY:-$HOME/projects/gscmaster.com/searchbird-483214-a77c096cd7bb.json}"
[ -f "$KEY" ] || { echo "ERROR: no Play API key at $KEY (android/play/README.md)" >&2; exit 1; }
PKG=com.bloomengine.shooter
# The bundle is built in the Android worktree when there is one (as Ralph's builds are).
AAB="${AAB:-android/app/build/outputs/bundle/release/app-release.aab}"
[ -f "$AAB" ] || AAB="../shooter-android/android/app/build/outputs/bundle/release/app-release.aab"

case "${1:-}" in
  bundle)
    [ -f "$AAB" ] || { echo "ERROR: no bundle; run tools/build-android.sh --bundle --version-code=N" >&2; exit 1; }
    fastlane supply --package_name "$PKG" --json_key "$KEY" --aab "$AAB" \
      --track "${2:-internal}" --release_status draft \
      --skip_upload_metadata --skip_upload_images --skip_upload_screenshots \
      --skip_upload_changelogs
    ;;
  listing)
    python3 android/play/build_listing.py
    fastlane supply --package_name "$PKG" --json_key "$KEY" \
      --metadata_path android/play/metadata --skip_upload_apk --skip_upload_aab \
      --skip_upload_changelogs --sync_image_upload --track internal --release_status draft
    ;;
  *) sed -n 2,12p "$0"; exit 1 ;;
esac
