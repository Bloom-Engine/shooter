#!/usr/bin/env bash
set -e

# ──────────────────────────────────────────────
# Bloom Shooter — Android build script
#
# Cross-compiles the Perry game to an arm64 .so, drops it into the Gradle
# project's jniLibs, syncs the asset tree, and builds (optionally installs +
# launches) the APK. Modeled on ../jump/build-android.sh.
#
# The shooter has no procedural asset step — its assets are committed binaries
# (GLBs / textures / audio / worlds), so instead of regenerating we rsync the
# real assets/ tree. `perry compile --target android` can truncate the source
# assets while bundling, so we restore them from git afterward (they are all
# tracked at HEAD) before the rsync.
# ──────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# ── NDK / SDK environment ────────────────────
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$ANDROID_HOME/ndk/30.0.14904198}"
# CMake's built-in Android support (used when the engine's build.rs drives the
# Jolt cmake build) locates the NDK via ANDROID_NDK_ROOT / ANDROID_NDK — it does
# NOT read ANDROID_NDK_HOME. Without these the Jolt configure aborts with
# "Neither the NDK or a standalone toolchain was found."
export ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"
export ANDROID_NDK="$ANDROID_NDK_HOME"
# Prefer Ninja for the Jolt build (present via Homebrew); avoids the Unix
# Makefiles generator probe.
export CMAKE_GENERATOR="${CMAKE_GENERATOR:-Ninja}"
NDK_BIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin"

export CC_aarch64_linux_android="$NDK_BIN/aarch64-linux-android24-clang"
export CXX_aarch64_linux_android="$NDK_BIN/aarch64-linux-android24-clang++"
export AR_aarch64_linux_android="$NDK_BIN/llvm-ar"

LLVM_STRIP="$NDK_BIN/llvm-strip"

# ── Parse flags ──────────────────────────────
INSTALL=0
RUN=0
BUILD_TYPE="assembleDebug"
APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"

for arg in "$@"; do
    case "$arg" in
        --install) INSTALL=1 ;;
        --run)     INSTALL=1; RUN=1 ;;
        --release)
            BUILD_TYPE="assembleRelease"
            APK_PATH="android/app/build/outputs/apk/release/app-release.apk"
            ;;
        # The Google Play upload: a signed release bundle (.aab) with the assets as the
        # install-time asset pack `gamedata`. Needs --version-code (higher than every upload
        # before it); the upload key comes from the login keychain (docs/RELEASE.md).
        --bundle) BUNDLE=1 ;;
        --version-code=*) VERSION_CODE="${arg#*=}" ;;
        --version-name=*) VERSION_NAME="${arg#*=}" ;;
    esac
done
BUNDLE="${BUNDLE:-0}"
GRADLE_PROPS=()
if [ "$BUNDLE" -eq 1 ]; then
    if [ -z "${VERSION_CODE:-}" ]; then
        echo "ERROR: --bundle needs --version-code=N (higher than the last Play upload)" >&2
        exit 1
    fi
    export BLOOM_UPLOAD_KEYSTORE="${BLOOM_UPLOAD_KEYSTORE:-$HOME/.android/keystores/bloom-shooter-upload.jks}"
    if [ ! -f "$BLOOM_UPLOAD_KEYSTORE" ]; then
        echo "ERROR: no upload keystore at $BLOOM_UPLOAD_KEYSTORE (docs/RELEASE.md, Google Play)" >&2
        exit 1
    fi
    if [ -z "${BLOOM_UPLOAD_STORE_PASSWORD:-}" ]; then
        BLOOM_UPLOAD_STORE_PASSWORD="$(security find-generic-password -s bloom-shooter-upload -a upload -w)" || {
            echo "ERROR: upload key password not in the keychain (service bloom-shooter-upload)" >&2; exit 1; }
        export BLOOM_UPLOAD_STORE_PASSWORD
    fi
    BUILD_TYPE="bundleRelease"
    APK_PATH="android/app/build/outputs/bundle/release/app-release.aab"
    GRADLE_PROPS=(-PplayBundle -PversionCode="$VERSION_CODE" -PversionName="${VERSION_NAME:-1.0.0}")
fi

# ── Paths ────────────────────────────────────
SO_OUTPUT="bloom_shooter"
JNILIBS_DIR="android/app/src/main/jniLibs/arm64-v8a"
ASSETS_SRC="assets"
# Staged in the asset pack's folder: the Play bundle ships it as the pack, a debug APK takes it
# into the app (android/app/build.gradle.kts).
ASSETS_DST="android/gamedata/src/main/assets/assets"
PACKAGE="com.bloomengine.shooter"
ACTIVITY="com.bloomengine.shooter.BloomActivity"

# ── Step 0: Refuse to run over uncommitted asset work ─
# Step 2 below runs `git checkout -- assets` to undo Perry's truncation, and that
# would silently throw away any modified sound, model or texture. (In November
# 2026 the whole regenerated asset set sat uncommitted next to this script.)
if [ -n "$(git status --porcelain -- "$ASSETS_SRC")" ]; then
    echo "ERROR: $ASSETS_SRC/ has uncommitted changes:" >&2
    git status --short -- "$ASSETS_SRC" | head -10 >&2
    echo "This build restores $ASSETS_SRC/ from git afterwards and would discard them." >&2
    echo "Commit or stash them first." >&2
    exit 1
fi

# ── Step 1: Compile with Perry ───────────────
# PERRY_BIN lets a patched/worktree perry be used (e.g. the ELF-TLS build).
# PERRY_ANDROID_TARGET_JSON (read by perry itself) opts into the has-thread-local
# custom target + -Zbuild-std that fixes the bionic 128-pthread-key GC crash.
# docs/perry-quirks.md #6: Perry's in-process LLVM backend fails on src/main.ts; use its external one.
export PERRY_LLVM_INPROCESS="${PERRY_LLVM_INPROCESS:-0}"
echo "==> Compiling with Perry (target: android)... [${PERRY_BIN:-perry}]"
"${PERRY_BIN:-perry}" compile --target android src/main.ts -o "$SO_OUTPUT"

# ── Step 2: Restore any assets Perry truncated while bundling ─
# Only safe because Step 0 refused to start with uncommitted asset changes.
echo "==> Restoring source assets from git (if perry disturbed them)..."
git checkout -- "$ASSETS_SRC" 2>/dev/null || true

# ── Step 3: Strip and copy .so ───────────────
echo "==> Stripping .so..."
"$LLVM_STRIP" "$SO_OUTPUT"

echo "==> Copying .so to jniLibs..."
mkdir -p "$JNILIBS_DIR"
cp "$SO_OUTPUT" "$JNILIBS_DIR/libbloom_shooter.so"

# ── Step 4: Sync assets ──────────────────────
echo "==> Syncing assets ($(du -sh "$ASSETS_SRC" | cut -f1))..."
mkdir -p "$ASSETS_DST"
rsync -a --delete --checksum \
    --exclude '.DS_Store' --exclude '*.md' --exclude '*.astc.glb' \
    "$ASSETS_SRC/" "$ASSETS_DST/"
# A phone cannot hold the 4K maps (6.3 GB as RGBA8, ~1.6 GB as ASTC): cap them, then cut the ASTC
# copies from the small images (assets_bundle.py ships those under the plain names).
# The low tier's geometry budget: fewer triangles per creature, weapon and prop (trees and terrain
# are left alone). Before the texture step, so the ASTC copies are cut from the final meshes.
# Low-tier tree variants (<tree>_low.glb, half the leaf cards); the game loads them only on a
# low-tier GPU (src/tier.ts).
python3 tools/release/lowtier_trees.py "$ASSETS_DST/models" --keep 0.5
python3 tools/release/simplify_glb_meshes.py "$ASSETS_DST/models"
python3 tools/release/shrink_glb_textures.py "$ASSETS_DST/models" --max "${ANDROID_TEX_MAX:-1024}"
COOK=../engine/tools/bloom-cook/target/release/bloom-cook
[ -x "$COOK" ] || (cd ../engine/tools/bloom-cook && cargo build --release)
for glb in "$ASSETS_DST"/models/*.glb; do
    case "$glb" in *.astc.glb) continue ;; esac
    out="${glb%.glb}.astc.glb"
    [ "$out" -nt "$glb" ] || "$COOK" glb-compress "$glb" "$out" --astc 4x4 --normal-astc 4x4 >/dev/null
done
# Same exclusion list as the TestFlight and web bundles (tools/release/assets_bundle.py).
python3 tools/release/assets_bundle.py "$ASSETS_DST"

# ── Step 5: Build APK ───────────────────────
echo "==> Building APK ($BUILD_TYPE)..."
cd android
./gradlew "$BUILD_TYPE" "${GRADLE_PROPS[@]}"
cd ..

echo "==> APK: $APK_PATH"

# ── Step 6: Install (optional) ──────────────
if [ "$INSTALL" -eq 1 ] && [ "$BUNDLE" -eq 1 ]; then
    # What Play would install on this phone, asset pack included (bundletool).
    echo "==> Installing the bundle on the device (bundletool)..."
    APKS="android/app/build/outputs/bundle/release/app-release.apks"
    rm -f "$APKS"
    # bundletool takes a password as pass:<text> (visible in `ps`) or file:<path>.
    PWFILE="$(mktemp)"; chmod 600 "$PWFILE"
    printf '%s' "$BLOOM_UPLOAD_STORE_PASSWORD" > "$PWFILE"
    bundletool build-apks --bundle="$APK_PATH" --output="$APKS" --connected-device \
        --ks="$BLOOM_UPLOAD_KEYSTORE" --ks-key-alias=upload --ks-pass="file:$PWFILE" || { rm -f "$PWFILE"; exit 1; }
    rm -f "$PWFILE"
    bundletool install-apks --apks="$APKS"
elif [ "$INSTALL" -eq 1 ]; then
    echo "==> Installing APK on device..."
    adb install -r "$APK_PATH"
fi

# ── Step 7: Launch (optional) ───────────────
if [ "$RUN" -eq 1 ]; then
    echo "==> Launching $PACKAGE..."
    adb shell am start -n "$PACKAGE/$ACTIVITY"
fi

echo "==> Done."
