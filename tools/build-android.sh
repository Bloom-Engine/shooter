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
    esac
done

# ── Paths ────────────────────────────────────
SO_OUTPUT="bloom_shooter"
JNILIBS_DIR="android/app/src/main/jniLibs/arm64-v8a"
ASSETS_SRC="assets"
ASSETS_DST="android/app/src/main/assets/assets"
PACKAGE="com.bloomengine.shooter"
ACTIVITY="com.bloomengine.shooter.BloomActivity"

# ── Step 1: Compile with Perry ───────────────
# PERRY_BIN lets a patched/worktree perry be used (e.g. the ELF-TLS build).
# PERRY_ANDROID_TARGET_JSON (read by perry itself) opts into the has-thread-local
# custom target + -Zbuild-std that fixes the bionic 128-pthread-key GC crash.
echo "==> Compiling with Perry (target: android)... [${PERRY_BIN:-perry}]"
"${PERRY_BIN:-perry}" compile --target android src/main.ts -o "$SO_OUTPUT"

# ── Step 2: Restore any assets Perry truncated while bundling ─
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
    --exclude '.DS_Store' --exclude '*.md' \
    "$ASSETS_SRC/" "$ASSETS_DST/"

# ── Step 5: Build APK ───────────────────────
echo "==> Building APK ($BUILD_TYPE)..."
cd android
./gradlew "$BUILD_TYPE"
cd ..

echo "==> APK: $APK_PATH"

# ── Step 6: Install (optional) ──────────────
if [ "$INSTALL" -eq 1 ]; then
    echo "==> Installing APK on device..."
    adb install -r "$APK_PATH"
fi

# ── Step 7: Launch (optional) ───────────────
if [ "$RUN" -eq 1 ]; then
    echo "==> Launching $PACKAGE..."
    adb shell am start -n "$PACKAGE/$ACTIVITY"
fi

echo "==> Done."
