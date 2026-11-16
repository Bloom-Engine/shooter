#!/usr/bin/env python3
"""Build Bloom Shooter for iOS, tvOS and macOS, sign for the App Store, upload to TestFlight.

  tools/release/release.py                     next build number, all three platforms
  tools/release/release.py --bump minor        also bump the marketing version (0.1.0 -> 0.2.0)
  tools/release/release.py --only ios,macos    a subset
  tools/release/release.py --no-upload         build + sign + package only (dist/)

Every upload lands in TestFlight; the internal group created by `asc.py testers`
(hasAccessToAllBuilds) gets each build automatically once Apple finishes processing.

Everything is built locally from the Perry checkout in PERRY_HOME and ../engine (no Perry Hub).
See docs/RELEASE.md.
"""
import argparse, os, plistlib, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GAME = ROOT
# The Perry source checkout that built the compiler AND the device runtimes
# (tools/release/build_toolchain.sh). Override with PERRY_HOME.
PERRY_HOME = Path(os.environ.get("PERRY_HOME", "/Users/amlug/projects/perry/worktrees/perry-main-latest"))
PERRY = PERRY_HOME / "target/release/perry"
BLOOM = (ROOT / "../engine").resolve()
TOML = GAME / "perry.toml"
WORK = GAME / "build/release"
DIST = ROOT / "dist"
ICONS = ROOT / "icons"
sys.path.insert(0, str(Path(__file__).parent))
import asc  # noqa: E402

APP = "BloomShooter"
DISPLAY = "Bloom Shooter"
BUNDLE_ID = asc.BUNDLE_ID
ID_APPLE_DIST = "Apple Distribution: Skelpo GmbH ({team})"
ID_MAC_APP = "3rd Party Mac Developer Application: Skelpo GmbH ({team})"
ID_MAC_INSTALLER = "3rd Party Mac Developer Installer: Skelpo GmbH ({team})"

PLATFORMS = {
    #          perry target  sdk          altool -t   actool platform  min OS
    "ios":   ("ios",        "iphoneos",  "ios",      "iphoneos",      "17.0"),
    "tvos":  ("tvos",       "appletvos", "appletvos", "appletvos",    "17.0"),
    "macos": ("macos",      "macosx",    "macos",    "macosx",        "13.0"),
}


def run(cmd, **kw):
    print("  $", " ".join(str(c) for c in cmd) if isinstance(cmd, list) else cmd, flush=True)
    return subprocess.run(cmd, check=True, **kw)


def out(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout.strip()


# ------------------------------------------------------------------ versioning
def read_version():
    t = TOML.read_text()
    return (re.search(r'^version = "([^"]+)"', t, re.M).group(1),
            int(re.search(r"^build_number = (\d+)", t, re.M).group(1)))


def write_version(version, build):
    t = TOML.read_text()
    t = re.sub(r'^version = "[^"]+"', f'version = "{version}"', t, count=1, flags=re.M)
    t = re.sub(r"^build_number = \d+", f"build_number = {build}", t, count=1, flags=re.M)
    TOML.write_text(t)


def bump(version, part):
    major, minor, patch = (int(x) for x in version.split("."))
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


# ------------------------------------------------------------------ asset catalogs
def png(src, dest, size):
    dest.parent.mkdir(parents=True, exist_ok=True)
    run(["sips", "-s", "format", "png", "-z", str(size[1]), str(size[0]), str(src), "--out", str(dest)],
        stdout=subprocess.DEVNULL)


def write_json(path, obj):
    import json
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2))


INFO = {"author": "xcode", "version": 1}


def catalog_ios(cat):
    s = cat / "AppIcon.appiconset"
    png(ICONS / "icon-1024.png", s / "icon-1024.png", (1024, 1024))
    write_json(s / "Contents.json", {"images": [{"filename": "icon-1024.png", "idiom": "universal",
                                                "platform": "ios", "size": "1024x1024"}], "info": INFO})
    return ["--app-icon", "AppIcon"]


def catalog_macos(cat):
    s = cat / "AppIcon.appiconset"
    images = []
    for pt in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            name = f"icon_{pt}x{pt}@{scale}x.png"
            png(ICONS / "icon-1024.png", s / name, (pt * scale, pt * scale))
            images.append({"filename": name, "idiom": "mac", "scale": f"{scale}x", "size": f"{pt}x{pt}"})
    write_json(s / "Contents.json", {"images": images, "info": INFO})
    return ["--app-icon", "AppIcon"]


def catalog_tvos(cat):
    brand = cat / "App Icon & Top Shelf Image.brandassets"

    def stack(name, size, scales):
        st = brand / f"{name}.imagestack"
        layers = []
        for layer, src in (("Front", "tv-front.png"), ("Back", "tv-back.png")):
            iset = st / f"{layer}.imagestacklayer" / "Content.imageset"
            imgs = []
            for sc in scales:
                fn = f"{layer.lower()}@{sc}x.png"
                png(ICONS / src, iset / fn, (size[0] * sc, size[1] * sc))
                imgs.append({"filename": fn, "idiom": "tv", "scale": f"{sc}x"})
            write_json(iset / "Contents.json", {"images": imgs, "info": INFO})
            write_json(st / f"{layer}.imagestacklayer" / "Contents.json", {"info": INFO})
            layers.append({"filename": f"{layer}.imagestacklayer"})
        write_json(st / "Contents.json", {"layers": layers, "info": INFO})

    def shelf(name, src, size):
        iset = brand / f"{name}.imageset"
        imgs = []
        for sc in (1, 2):
            fn = f"shelf@{sc}x.png"
            png(ICONS / src, iset / fn, (size[0] * sc, size[1] * sc))
            imgs.append({"filename": fn, "idiom": "tv", "scale": f"{sc}x"})
        write_json(iset / "Contents.json", {"images": imgs, "info": INFO})

    stack("App Icon", (400, 240), (1, 2))
    stack("App Icon - App Store", (1280, 768), (1,))
    shelf("Top Shelf Image", "topshelf.png", (1920, 720))
    shelf("Top Shelf Image Wide", "topshelf-wide.png", (2320, 720))
    write_json(brand / "Contents.json", {"assets": [
        {"filename": "App Icon - App Store.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "1280x768"},
        {"filename": "App Icon.imagestack", "idiom": "tv", "role": "primary-app-icon", "size": "400x240"},
        {"filename": "Top Shelf Image Wide.imageset", "idiom": "tv", "role": "top-shelf-image-wide", "size": "2320x720"},
        {"filename": "Top Shelf Image.imageset", "idiom": "tv", "role": "top-shelf-image", "size": "1920x720"},
    ], "info": INFO})
    return ["--app-icon", "App Icon & Top Shelf Image"]


def compile_catalog(platform, dest):
    """Compile icons into dest (the .app's resource dir); return the partial Info.plist."""
    _, _, _, act_platform, min_os = PLATFORMS[platform]
    cat = WORK / platform / "Assets.xcassets"
    shutil.rmtree(cat, ignore_errors=True)
    write_json(cat / "Contents.json", {"info": INFO})
    args = {"ios": catalog_ios, "tvos": catalog_tvos, "macos": catalog_macos}[platform](cat)
    partial = WORK / platform / "assetcatalog_info.plist"
    devices = {"ios": ["--target-device", "iphone", "--target-device", "ipad"],
               "tvos": ["--target-device", "tv"], "macos": ["--target-device", "mac"]}[platform]
    run(["xcrun", "actool", str(cat), "--compile", str(dest), "--platform", act_platform,
         "--minimum-deployment-target", min_os, *devices, *args,
         "--output-partial-info-plist", str(partial), "--errors", "--warnings",
         "--output-format", "human-readable-text"], stdout=subprocess.DEVNULL)
    return plistlib.loads(partial.read_bytes())


# ------------------------------------------------------------------ Info.plist
def sdk_keys(sdk):
    xv = out(["xcodebuild", "-version"]).split()
    sdk_ver = out(["xcrun", "--sdk", sdk, "--show-sdk-version"])
    sdk_build = out(["xcrun", "--sdk", sdk, "--show-sdk-build-version"])
    xcode = xv[1].split(".")
    dtxcode = f"{int(xcode[0]):02d}{xcode[1] if len(xcode) > 1 else '0'}{xcode[2] if len(xcode) > 2 else '0'}"
    return {
        "DTPlatformName": sdk, "DTPlatformVersion": sdk_ver, "DTSDKName": f"{sdk}{sdk_ver}",
        "DTSDKBuild": sdk_build, "DTPlatformBuild": sdk_build, "DTXcode": dtxcode,
        "DTXcodeBuild": xv[-1], "DTCompiler": "com.apple.compilers.llvm.clang.1_0",
        "BuildMachineOSBuild": out(["sw_vers", "-buildVersion"]),
    }


def finish_plist(plist_path, platform, version, build, icon_keys):
    p = plistlib.loads(plist_path.read_bytes()) if plist_path.exists() else {}
    _, sdk, _, _, min_os = PLATFORMS[platform]
    for k in ("CFBundleIcons", "CFBundleIcons~ipad", "CFBundleIconFile", "CFBundleIconName",
              "NSCameraUsageDescription", "NSMicrophoneUsageDescription"):
        p.pop(k, None)
    p.update(icon_keys)
    p.update(sdk_keys(sdk))
    p.update({
        "CFBundleIdentifier": BUNDLE_ID, "CFBundleName": DISPLAY, "CFBundleDisplayName": DISPLAY,
        "CFBundleExecutable": APP, "CFBundlePackageType": "APPL", "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleShortVersionString": version, "CFBundleVersion": str(build),
        "ITSAppUsesNonExemptEncryption": False,
        "LSApplicationCategoryType": "public.app-category.action-games",
    })
    if platform == "macos":
        min_os = binary_minos(plist_path.parent / "MacOS" / APP) or min_os
        p.update({"LSMinimumSystemVersion": min_os, "NSHighResolutionCapable": True,
                  "CFBundleSupportedPlatforms": ["MacOSX"], "NSPrincipalClass": "NSApplication"})
    else:
        p["MinimumOSVersion"] = min_os
        p["CFBundleSupportedPlatforms"] = ["iPhoneOS" if platform == "ios" else "AppleTVOS"]
        p["UIRequiresFullScreen"] = True
    if platform == "ios":
        land = ["UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"]
        p.update({"UIDeviceFamily": [1, 2], "UISupportedInterfaceOrientations": land,
                  "UISupportedInterfaceOrientations~ipad": land, "UIStatusBarHidden": True,
                  "GCSupportsControllerUserInteraction": True})
    if platform == "tvos":
        p.update({"UIDeviceFamily": [3], "GCSupportsControllerUserInteraction": True,
                  "UIRequiredDeviceCapabilities": ["arm64"]})   # App Store rejects a 64-bit binary without it (90502)
    plist_path.write_bytes(plistlib.dumps(p))


def binary_minos(exe):
    """The deployment target the linker stamped into the binary (LC_BUILD_VERSION)."""
    m = re.search(r"minos (\S+)", out(["vtool", "-show-build", str(exe)]))
    return m.group(1) if m else None


# ------------------------------------------------------------------ signing
def entitlements(platform, team, path):
    app_id = f"{team}.{BUNDLE_ID}"
    if platform == "macos":
        e = {"com.apple.security.app-sandbox": True, "com.apple.application-identifier": app_id,
             "com.apple.developer.team-identifier": team}
    else:
        e = {"application-identifier": app_id, "com.apple.developer.team-identifier": team,
             "get-task-allow": False, "beta-reports-active": True}
    path.write_bytes(plistlib.dumps(e))
    return path


def profile_path(platform):
    return Path.home() / ".perry" / asc.PROFILES[platform][2]


# ------------------------------------------------------------------ per platform
def compress_assets():
    """Make sure every model has its ASTC copy (<asset>.astc.glb, git-ignored); only stale ones are redone."""
    script = ROOT / "tools/gen/compress_assets.sh"
    if script.exists():
        run([str(script)])


# What a bundle's copy of assets/ keeps is decided in ONE place, shared with the web and Android
# builds: tools/release/assets_bundle.py.
from assets_bundle import prune_assets  # noqa: E402


# Platforms whose devices cannot hold the 4K model textures. An Apple TV 4K (2nd generation, 3 GB)
# ends an app at 2.1 GB: with the 4K ASTC models (1.75 GB of them) build 0.1.0 (6) was killed half
# way through loading (Jetsam report: per-process-limit at 2098 MB, 2026-11-15).
TEX_MAX = {"tvos": 1024}
# ... and whose GPU cannot draw the models' full triangle counts. Measured on that Apple TV
# (A12) with `--harness drawsweep`, 2026-11-16: of 64 ms of GPU time a frame the props were 18
# and the trees 13, at any resolution. A creature is 60k triangles, a crate 24k. The same cut
# the Android low tier gets (simplify_glb_meshes.py: creatures 30 %, weapons 50 %, props ~6000).
MESH_SIMPLIFY = {"tvos"}
COOK = BLOOM / "tools/bloom-cook/target/release/bloom-cook"


def small_models(models, max_px, simplify_meshes=False):
    """Replace every <model>.astc.glb in a bundle's models folder with one cut from textures
    capped at max_px. The small copies are kept in build/release/models-<max_px> and only
    redone when the model in assets/models is newer."""
    from concurrent.futures import ThreadPoolExecutor
    from shrink_glb_textures import shrink_glb
    from simplify_glb_meshes import ratio_for, simplify, triangles
    cache = WORK / (f"models-{max_px}" + ("-simple" if simplify_meshes else ""))
    cache.mkdir(parents=True, exist_ok=True)
    if not COOK.exists():
        run(["cargo", "build", "--release"], cwd=COOK.parents[2])

    def cook(src):
        done = cache / f"{src.stem}.astc.glb"
        if not done.exists() or done.stat().st_mtime < src.stat().st_mtime:
            tmp = cache / src.name
            shutil.copy(src, tmp)
            if simplify_meshes:   # before the textures: see simplify_glb_meshes.py
                ratio = ratio_for(tmp.name, triangles(tmp))
                if ratio < 0.98:
                    simplify(tmp, ratio)
            shrink_glb(tmp, max_px)
            subprocess.run([str(COOK), "glb-compress", str(tmp), str(done), "--astc", "4x4",
                            "--normal-astc", "4x4"], check=True, stdout=subprocess.DEVNULL)
            tmp.unlink()
        return done

    sources = sorted(p for p in (ROOT / "assets/models").glob("*.glb") if not p.name.endswith(".astc.glb"))
    print(f"  models with textures <= {max_px} px ({len(sources)}, cache: {cache.relative_to(ROOT)})", flush=True)
    with ThreadPoolExecutor(4) as pool:
        for done in pool.map(cook, sources):
            if (models / done.name.replace(".astc.glb", ".glb")).exists():
                shutil.copy(done, models / done.name)


def perry_compile(platform, out_path):
    compress_assets()
    target = PLATFORMS[platform][0]
    env = dict(os.environ)
    env.setdefault("PERRY_LLVM_INPROCESS", "0")   # docs/perry-quirks.md #6
    env.pop("PERRY_RUNTIME_DIR", None)   # device targets: perry finds target/<triple>/release itself
    if platform == "macos":
        env["PERRY_RUNTIME_DIR"] = str(PERRY_HOME / "target/release")
    if platform == "tvos":
        pin = re.search(r'channel = "([^"]+)"', (PERRY_HOME / "rust-toolchain.toml").read_text()).group(1)
        env["PERRY_PINNED_TOOLCHAIN"] = pin
        env["PATH"] = str(Path(__file__).parent / "shims") + os.pathsep + env["PATH"]
        # Bloom's allocator shim would shadow Perry's mimalloc one and crash the app at launch.
        run([sys.executable, str(Path(__file__).parent / "strip_alloc_shim.py"),
             str(BLOOM / "native/tvos/target/aarch64-apple-tvos/release/libbloom_tvos.a")])
    cmd =[str(PERRY), "compile", "src/main.ts", "-o", str(out_path), "--target", target]
    if platform != "macos":
        cmd += ["--features", "ios-game-loop"]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    log = WORK / f"{platform}-compile.log"
    print(f"  $ {' '.join(cmd)}  (log: {log.relative_to(ROOT)})", flush=True)
    with open(log, "w") as f:
        r = subprocess.run(cmd, cwd=GAME, env=env, stdout=f, stderr=subprocess.STDOUT)
    if r.returncode != 0:
        tail = "\n".join(log.read_text().splitlines()[-25:])
        sys.exit(f"perry compile failed for {platform}:\n{tail}")


# The privacy manifest App Store Connect asks for: no tracking, nothing collected, and the two
# "required reason" API families the binary links (file timestamps, system boot time).
PRIVACY = Path(__file__).parent / "PrivacyInfo.xcprivacy"


def build_apple_mobile(platform, version, build, team):
    d = WORK / platform
    perry_compile(platform, d / APP)
    app = d / f"{APP}.app"
    if not app.is_dir():
        sys.exit(f"expected {app}")
    if not (app / "assets").is_dir():
        sys.exit(f"{app} has no assets/")
    if platform in TEX_MAX:
        small_models(app / "assets/models", TEX_MAX[platform], platform in MESH_SIMPLIFY)
    prune_assets(app / "assets")
    icon_keys = compile_catalog(platform, app)
    finish_plist(app / "Info.plist", platform, version, build, icon_keys)
    shutil.copy(PRIVACY, app / "PrivacyInfo.xcprivacy")
    shutil.copy(profile_path(platform), app / "embedded.mobileprovision")
    for junk in app.rglob(".DS_Store"):
        junk.unlink()
    for junk in app.rglob(".gitkeep"):
        junk.unlink()
    ent = entitlements(platform, team, d / "entitlements.plist")
    run(["xattr", "-cr", str(app)])   # codesign rejects Finder info / provenance xattrs
    run(["codesign", "--force", "--sign", ID_APPLE_DIST.format(team=team), "--entitlements", str(ent),
         "--generate-entitlement-der", str(app)])
    run(["codesign", "--verify", "--strict", "--deep", str(app)])
    stage = d / "ipa"
    shutil.rmtree(stage, ignore_errors=True)
    (stage / "Payload").mkdir(parents=True)
    run(["ditto", str(app), str(stage / "Payload" / app.name)])
    ipa = DIST / f"{APP}-{platform}-{version}-{build}.ipa"
    ipa.unlink(missing_ok=True)
    run(["ditto", "-c", "-k", "--norsrc", str(stage), str(ipa)])
    return ipa


def build_macos(version, build, team):
    d = WORK / "macos"
    exe = d / APP
    perry_compile("macos", exe)
    app = d / f"{APP}.app"
    shutil.rmtree(app, ignore_errors=True)
    (app / "Contents/MacOS").mkdir(parents=True)
    res = app / "Contents/Resources"
    res.mkdir()
    shutil.copy(exe, app / "Contents/MacOS" / APP)
    run(["ditto", str(ROOT / "assets"), str(res / "assets")])
    prune_assets(res / "assets")
    for junk in list(res.rglob(".DS_Store")) + list(res.rglob(".gitkeep")):
        junk.unlink()
    icon_keys = compile_catalog("macos", res)
    finish_plist(app / "Contents/Info.plist", "macos", version, build, icon_keys)
    shutil.copy(PRIVACY, res / "PrivacyInfo.xcprivacy")
    shutil.copy(profile_path("macos"), app / "Contents/embedded.provisionprofile")
    ent = entitlements("macos", team, d / "entitlements.plist")
    run(["xattr", "-cr", str(app)])   # codesign rejects Finder info / provenance xattrs
    run(["codesign", "--force", "--sign", ID_MAC_APP.format(team=team), "--entitlements", str(ent),
         "--options", "runtime", str(app)])
    run(["codesign", "--verify", "--strict", "--deep", str(app)])
    pkg = DIST / f"{APP}-macos-{version}-{build}.pkg"
    pkg.unlink(missing_ok=True)
    run(["productbuild", "--component", str(app), "/Applications",
         "--sign", ID_MAC_INSTALLER.format(team=team), str(pkg)])
    return pkg


def upload(platform, artifact):
    run(["xcrun", "altool", "--upload-app", "-f", str(artifact), "-t", PLATFORMS[platform][2],
         "--apiKey", os.environ["ASC_KEY_ID"], "--apiIssuer", os.environ["ASC_ISSUER_ID"]])


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default="ios,tvos,macos")
    ap.add_argument("--bump", choices=["major", "minor", "patch"])
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--no-commit", action="store_true", help="don't commit/tag the build number bump")
    ap.add_argument("--build", type=int, help="use this build number (e.g. to re-ship platforms whose upload failed)")
    a = ap.parse_args()
    platforms = [p.strip() for p in a.only.split(",") if p.strip()]
    for p in platforms:
        if p not in PLATFORMS:
            sys.exit(f"unknown platform {p}")

    asc.load_env()
    team = os.environ.get("APPLE_TEAM_ID") or sys.exit("APPLE_TEAM_ID missing in .env")
    key = Path(os.path.expanduser(os.environ["ASC_KEY_PATH"]))
    altool_key = Path.home() / ".appstoreconnect/private_keys" / f"AuthKey_{os.environ['ASC_KEY_ID']}.p8"
    if not a.no_upload and not altool_key.exists():
        altool_key.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(key, altool_key)   # altool only looks for the key in fixed directories
    for p in platforms:
        if not profile_path(p).exists():
            sys.exit(f"missing {profile_path(p)}: run tools/release/asc.py setup")

    version, last = read_version()
    if a.bump:
        version = bump(version, a.bump)
    build = last + 1
    if a.build:
        build = a.build
    elif not a.no_upload:
        build = max(build, int(out([sys.executable, str(Path(__file__).parent / "asc.py"), "next-build"])))
    write_version(version, build)
    print(f"\n== Bloom Shooter {version} ({build}) -> {', '.join(platforms)}\n")

    WORK.mkdir(parents=True, exist_ok=True)
    DIST.mkdir(exist_ok=True)
    results = {}
    for p in platforms:
        print(f"\n== {p}: build + sign")
        results[p] = build_macos(version, build, team) if p == "macos" else build_apple_mobile(p, version, build, team)
        print(f"  -> {results[p].relative_to(ROOT)}")
    failed = []
    if not a.no_upload:
        for p in platforms:
            print(f"\n== {p}: upload to App Store Connect")
            try:
                upload(p, results[p])
            except subprocess.CalledProcessError:
                failed.append(p)   # keep going: the other platforms still ship
        if len(failed) == len(platforms):
            sys.exit(f"\nAll uploads failed ({', '.join(failed)}); nothing committed.")

    if not a.no_commit:
        # Commit only perry.toml, whatever else is staged or modified.
        run(["git", "-C", str(ROOT), "commit", "-m", f"Release {version} ({build}) to TestFlight: {', '.join(platforms)}",
             "--", str(TOML)])
        run(["git", "-C", str(ROOT), "tag", f"v{version}-{build}"])
    if failed:
        print(f"\nUPLOAD FAILED for {', '.join(failed)}: fix, then re-ship with "
              f"--only {','.join(failed)} --build {build} --no-commit")
    print(f"\nDone: {version} ({build}). Builds appear in TestFlight after Apple's processing (~5-30 min).")
    if not a.no_upload:
        print("Check with: tools/release/asc.py status")


if __name__ == "__main__":
    main()
