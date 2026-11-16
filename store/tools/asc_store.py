#!/usr/bin/env python3
"""App Store listing for Bloom Shooter, through the App Store Connect API.

  asc_store.py configure [--dry-run]   app-level settings (once per app, safe to repeat):
        category, age rating, content rights, price (free), availability (all territories),
        copyright, version string, privacy policy and support URLs
  asc_store.py text [--dry-run]        name + subtitle (app level) and description, keywords,
        promotional text (each platform's editable version), all languages of
        store/metadata/source.json; creates missing localizations
  asc_store.py attach <build> [--version V]   attach build number <build> of version V to the
        iOS, macOS and tvOS versions (and set its export compliance)
  asc_store.py shots [--lang en] [--platform IOS]   upload store/screenshots/out/ (made by
        frame_screenshots.py), replacing each language's set for that display
  asc_store.py check                   what is still missing before "Submit for Review"

Credentials: the ASC_* values of the repo's .env, read by tools/release/asc.py.
Nothing here submits for review.

Mirrors ../jump/store/tools (asc_push_metadata.py, asc_set_urls.py), which bypass `fastlane
deliver` for text because deliver's metadata step crashes on a version without a review
detail object.
"""
import hashlib, json, os, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "release"))
import asc  # noqa: E402  (load_env, api, get_all)

SRC = json.loads((ROOT / "store" / "metadata" / "source.json").read_text())
LANGS = SRC["languages"]
PLATFORMS = ["IOS", "MAC_OS", "TV_OS"]
EDITABLE = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED",
            "INVALID_BINARY"}
DRY = "--dry-run" in sys.argv

# Same answers as Bloom Jump where the question is the same.
VERSION = "1.0.0"                       # must equal the builds' CFBundleShortVersionString
COPYRIGHT = "2026 Skelpo GmbH"
PRIVACY_URL = "https://www.skelpo.com/en/privacy"
SUPPORT_URL = "https://www.skelpo.com/en/privacy"   # Jump uses the privacy page for both
PRIMARY_CATEGORY = "GAMES"
SUBCATEGORY = "GAMES_ACTION"
CONTENT_RIGHTS = "USES_THIRD_PARTY_CONTENT"         # CC0 scans (Poly Haven), licensed fonts
# Age rating questionnaire. Fantasy creatures shot with guns, some blood on them, a night arena
# and a monster boss; nothing else applies (no chat, no web, no purchases, no ads).
AGE_RATING = {
    "violenceCartoonOrFantasy": "FREQUENT_OR_INTENSE",
    "violenceRealistic": "NONE",
    "violenceRealisticProlongedGraphicOrSadistic": "NONE",
    "gunsOrOtherWeapons": "FREQUENT_OR_INTENSE",
    "horrorOrFearThemes": "INFREQUENT_OR_MILD",
    "matureOrSuggestiveThemes": "NONE",
    "profanityOrCrudeHumor": "NONE",
    "sexualContentOrNudity": "NONE",
    "sexualContentGraphicAndNudity": "NONE",
    "alcoholTobaccoOrDrugUseOrReferences": "NONE",
    "medicalOrTreatmentInformation": "NONE",
    "gamblingSimulated": "NONE",
    "contests": "NONE",
    "gambling": False,
    "lootBox": False,
    "advertising": False,
    "messagingAndChat": False,
    "userGeneratedContent": False,
    "unrestrictedWebAccess": False,
    "parentalControls": False,
    "ageAssurance": False,
    "healthOrWellnessTopics": False,
    "socialMedia": False,
}
REVIEW_NOTES = (
    "Bloom Shooter is a single-player third-person wave shooter. No account, no network, "
    "no purchases. Start: PLAY on the title screen, pick an arena, the first wave begins. "
    "iPhone/iPad: left half of the screen moves, right half looks, buttons on the right edge "
    "fire, aim, jump, reload; pause is the top-right button. Mac: WASD + mouse (Esc pauses), "
    "or a game controller. Apple TV: a paired extended game controller (Xbox, PlayStation "
    "or MFi) is required to play.")


def api(method, path, body=None):
    if DRY and method != "GET":
        print(f"    [dry] {method} {path} {json.dumps(body)[:160] if body else ''}")
        return {"data": {}}
    return asc.api(method, path, body)


def app_id():
    return SRC["_meta"]["app_id_apple"]


def editable_info():
    infos = asc.api("GET", f"/v1/apps/{app_id()}/appInfos")["data"]
    for i in infos:
        if i["attributes"]["state"] in EDITABLE:
            return i
    return infos[0]


def editable_versions():
    out = {}
    for v in asc.api("GET", f"/v1/apps/{app_id()}/appStoreVersions?limit=50")["data"]:
        a = v["attributes"]
        if a["platform"] in PLATFORMS and a["appStoreState"] in EDITABLE and a["platform"] not in out:
            out[a["platform"]] = v
    return out


def patch(type_, id_, attrs, rels=None):
    body = {"data": {"type": type_, "id": id_, "attributes": attrs}}
    if rels:
        body["data"]["relationships"] = rels
    return api("PATCH", f"/v1/{type_}/{id_}", body)


# --------------------------------------------------------------------------- configure
def has_price():
    try:
        return bool(asc.api("GET", f"/v1/apps/{app_id()}/appPriceSchedule?include=manualPrices").get("included"))
    except SystemExit:          # 404 until a schedule is made
        return False


def set_price_free():
    if has_price():
        print("  price: a price schedule exists already, left alone")
        return
    pts = asc.get_all(f"/v1/apps/{app_id()}/appPricePoints?filter[territory]=USA&limit=200")
    free = next(p for p in pts if float(p["attributes"]["customerPrice"]) == 0.0)
    api("POST", "/v1/appPriceSchedules", {
        "data": {"type": "appPriceSchedules", "relationships": {
            "app": {"data": {"type": "apps", "id": app_id()}},
            "baseTerritory": {"data": {"type": "territories", "id": "USA"}},
            "manualPrices": {"data": [{"type": "appPrices", "id": "${free}"}]}}},
        "included": [{"type": "appPrices", "id": "${free}", "attributes": {"startDate": None},
                      "relationships": {"appPricePoint": {"data": {"type": "appPricePoints",
                                                                   "id": free["id"]}}}}]})
    print("  price: free (base territory USA)")


def set_availability():
    try:
        asc.api("GET", f"/v1/apps/{app_id()}/appAvailabilityV2")
        print("  availability: set already, left alone")
        return
    except SystemExit:
        pass
    terr = asc.get_all("/v1/territories?limit=200")
    inc = [{"type": "territoryAvailabilities", "id": f"${{t{i}}}",
            "attributes": {"available": True},
            "relationships": {"territory": {"data": {"type": "territories", "id": t["id"]}}}}
           for i, t in enumerate(terr)]
    api("POST", "/v2/appAvailabilities", {
        "data": {"type": "appAvailabilities", "attributes": {"availableInNewTerritories": True},
                 "relationships": {
                     "app": {"data": {"type": "apps", "id": app_id()}},
                     "territoryAvailabilities": {"data": [{"type": x["type"], "id": x["id"]} for x in inc]}}},
        "included": inc})
    print(f"  availability: all {len(terr)} territories, and new ones")


def cmd_configure():
    aid = app_id()
    patch("apps", aid, {"contentRightsDeclaration": CONTENT_RIGHTS})
    print(f"  content rights: {CONTENT_RIGHTS}")
    info = editable_info()
    patch("appInfos", info["id"], {}, {
        "primaryCategory": {"data": {"type": "appCategories", "id": PRIMARY_CATEGORY}},
        "primarySubcategoryOne": {"data": {"type": "appCategories", "id": SUBCATEGORY}}})
    print(f"  category: {PRIMARY_CATEGORY} / {SUBCATEGORY}")
    ar = asc.api("GET", f"/v1/appInfos/{info['id']}/ageRatingDeclaration")["data"]
    patch("ageRatingDeclarations", ar["id"], AGE_RATING)
    print("  age rating questionnaire answered")
    set_price_free()
    set_availability()
    for plat, v in editable_versions().items():
        attrs = {"copyright": COPYRIGHT, "releaseType": "AFTER_APPROVAL"}
        if v["attributes"]["versionString"] != VERSION:
            attrs["versionString"] = VERSION
        patch("appStoreVersions", v["id"], attrs)
        print(f"  {plat}: version {VERSION}, copyright '{COPYRIGHT}'")
        ensure_review_notes(v["id"])
    print("Done." if not DRY else "Dry run: nothing changed.")


def ensure_review_notes(version_id):
    try:
        rd = asc.api("GET", f"/v1/appStoreVersions/{version_id}/appStoreReviewDetail")["data"]
    except SystemExit:
        rd = None
    if rd:
        patch("appStoreReviewDetails", rd["id"], {"notes": REVIEW_NOTES, "demoAccountRequired": False})
    else:
        api("POST", "/v1/appStoreReviewDetails", {"data": {
            "type": "appStoreReviewDetails",
            "attributes": {"notes": REVIEW_NOTES, "demoAccountRequired": False},
            "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": version_id}}}}})


# --------------------------------------------------------------------------- text
FAILED = []


def upsert(have, locale, type_, attrs, rel_name, rel):
    try:
        return _upsert(have, locale, type_, attrs, rel_name, rel)
    except SystemExit as e:          # asc.api exits on an HTTP error: note it, go on
        detail = next((ln.split(":", 1)[1].strip(' ",') for ln in str(e).splitlines()
                       if '"detail"' in ln), str(e).splitlines()[0])
        FAILED.append(f"{type_} {locale}: {detail}")
        print(f"  ! {locale}: {detail}")


def _upsert(have, locale, type_, attrs, rel_name, rel):
    if locale in have:
        return patch(type_, have[locale], attrs)
    return api("POST", f"/v1/{type_}", {"data": {
        "type": type_, "attributes": {**attrs, "locale": locale},
        "relationships": {rel_name: {"data": {"type": rel[0], "id": rel[1]}}}}})


def cmd_text():
    info = editable_info()
    locs = asc.api("GET", f"/v1/appInfos/{info['id']}/appInfoLocalizations?limit=50")["data"]
    have = {l["attributes"]["locale"]: l["id"] for l in locs}
    for code, d in LANGS.items():
        upsert(have, d["apple_locale"], "appInfoLocalizations",
               {"name": d["name"], "subtitle": d["subtitle"],
                # privacyPolicyText is what tvOS shows (no browser); Jump sets the URL as text.
                "privacyPolicyUrl": PRIVACY_URL, "privacyPolicyText": PRIVACY_URL},
               "appInfo", ("appInfos", info["id"]))
    print(f"app info: name, subtitle, privacy URL for {len(LANGS)} languages")
    for plat, v in editable_versions().items():
        vl = asc.api("GET", f"/v1/appStoreVersions/{v['id']}/appStoreVersionLocalizations?limit=50")["data"]
        vhave = {l["attributes"]["locale"]: l["id"] for l in vl}
        for code, d in LANGS.items():
            # whatsNew is refused on a first version, so it is not sent.
            upsert(vhave, d["apple_locale"], "appStoreVersionLocalizations",
                   {"description": d["description"], "keywords": d["keywords"],
                    "promotionalText": d["promo"], "supportUrl": SUPPORT_URL},
                   "appStoreVersion", ("appStoreVersions", v["id"]))
        print(f"{plat}: description, keywords, promo, support URL for {len(LANGS)} languages")
    if FAILED:
        print(f"{len(FAILED)} refused:"); [print("  " + f) for f in FAILED]
    print("Done." if not DRY else "Dry run: nothing changed.")


# --------------------------------------------------------------------------- attach
def cmd_attach(build_no, version):
    vers = editable_versions()
    for plat, v in vers.items():
        bs = asc.api("GET", f"/v1/builds?filter[app]={app_id()}&filter[version]={build_no}"
                            f"&filter[preReleaseVersion.version]={version}"
                            f"&filter[preReleaseVersion.platform]={plat}&limit=5")["data"]
        if not bs:
            print(f"{plat}: no build {version} ({build_no}) uploaded"); continue
        b = bs[0]
        if b["attributes"]["processingState"] != "VALID":
            print(f"{plat}: build {build_no} is {b['attributes']['processingState']}, try later"); continue
        if b["attributes"].get("usesNonExemptEncryption") is None:
            patch("builds", b["id"], {"usesNonExemptEncryption": False})
        api("PATCH", f"/v1/appStoreVersions/{v['id']}/relationships/build",
            {"data": {"type": "builds", "id": b["id"]}})
        print(f"{plat}: build {version} ({build_no}) attached")


# --------------------------------------------------------------------------- shots
# frame_screenshots.py device folder -> (platform, App Store display type). The 6.9" iPhone
# size is filed under APP_IPHONE_67 and the 13" iPad under APP_IPAD_PRO_3GEN_129: that is how
# the API names those slots; smaller devices reuse them.
DISPLAYS = {"iphone_6_9": ("IOS", "APP_IPHONE_67"), "ipad_13": ("IOS", "APP_IPAD_PRO_3GEN_129"),
            "mac": ("MAC_OS", "APP_DESKTOP"), "apple_tv": ("TV_OS", "APP_APPLE_TV")}
SHOT_DIR = ROOT / "store" / "screenshots" / "out"


def upload_shot(set_id, path):
    data = path.read_bytes()
    r = api("POST", "/v1/appScreenshots", {"data": {
        "type": "appScreenshots", "attributes": {"fileName": path.name, "fileSize": len(data)},
        "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})
    if DRY:
        return
    shot = r["data"]
    for op in shot["attributes"]["uploadOperations"]:
        req = urllib.request.Request(op["url"], method=op["method"],
                                     data=data[op["offset"]:op["offset"] + op["length"]])
        for h in op.get("requestHeaders") or []:
            req.add_header(h["name"], h["value"])
        urllib.request.urlopen(req, timeout=120).read()
    patch("appScreenshots", shot["id"], {"uploaded": True,
                                          "sourceFileChecksum": hashlib.md5(data).hexdigest()})


def cmd_shots(only_lang, only_plat):
    vers = editable_versions()
    for dev, (plat, display) in DISPLAYS.items():
        if only_plat and plat != only_plat or plat not in vers:
            continue
        vl = asc.api("GET", f"/v1/appStoreVersions/{vers[plat]['id']}/appStoreVersionLocalizations?limit=50")["data"]
        by_loc = {l["attributes"]["locale"]: l["id"] for l in vl}
        for code, d in LANGS.items():
            if only_lang and code != only_lang:
                continue
            files = sorted((SHOT_DIR / dev / code).glob("*.jpg")) + sorted((SHOT_DIR / dev / code).glob("*.png"))
            loc_id = by_loc.get(d["apple_locale"])
            if not files or not loc_id:
                print(f"  {plat} {dev} {code}: {'no pictures' if not files else 'no localization (run text first)'}")
                continue
            sets = asc.api("GET", f"/v1/appStoreVersionLocalizations/{loc_id}/appScreenshotSets"
                                  f"?filter[screenshotDisplayType]={display}")["data"]
            if sets:
                set_id = sets[0]["id"]
                for old in asc.api("GET", f"/v1/appScreenshotSets/{set_id}/appScreenshots?limit=50")["data"]:
                    api("DELETE", f"/v1/appScreenshots/{old['id']}")
            else:
                set_id = api("POST", "/v1/appScreenshotSets", {"data": {
                    "type": "appScreenshotSets", "attributes": {"screenshotDisplayType": display},
                    "relationships": {"appStoreVersionLocalization": {"data": {
                        "type": "appStoreVersionLocalizations", "id": loc_id}}}}})["data"].get("id", "dry")
            for f in files[:10]:
                upload_shot(set_id, f)
            print(f"  {plat} {display} {d['apple_locale']}: {min(len(files), 10)} uploaded")


# --------------------------------------------------------------------------- check
def cmd_check():
    aid = app_id()
    todo = []
    app = asc.api("GET", f"/v1/apps/{aid}")["data"]["attributes"]
    if not app.get("contentRightsDeclaration"):
        todo.append("content rights declaration")
    info = editable_info()
    rel = asc.api("GET", f"/v1/appInfos/{info['id']}?include=primaryCategory")["data"]["relationships"]
    if not rel["primaryCategory"].get("data"):
        todo.append("primary category")
    locs = asc.api("GET", f"/v1/appInfos/{info['id']}/appInfoLocalizations?limit=50")["data"]
    got = {l["attributes"]["locale"]: l["attributes"] for l in locs}
    for d in LANGS.values():
        a = got.get(d["apple_locale"])
        if not a or not a.get("subtitle") or not a.get("privacyPolicyUrl"):
            todo.append(f"app info {d['apple_locale']}: subtitle / privacy URL")
    try:
        asc.api("GET", f"/v1/apps/{aid}/appAvailabilityV2")
    except SystemExit:
        todo.append("availability")
    if not has_price():
        todo.append("price")
    vers = editable_versions()
    for plat in PLATFORMS:
        v = vers.get(plat)
        if not v:
            todo.append(f"{plat}: no editable version"); continue
        a = v["attributes"]
        if a["versionString"] != VERSION:
            todo.append(f"{plat}: version string {a['versionString']} != {VERSION}")
        if not a.get("copyright"):
            todo.append(f"{plat}: copyright")
        if not asc.api("GET", f"/v1/appStoreVersions/{v['id']}/build").get("data"):
            todo.append(f"{plat}: no build attached")
        vl = asc.api("GET", f"/v1/appStoreVersions/{v['id']}/appStoreVersionLocalizations?limit=50"
                            "&include=appScreenshotSets")
        vgot = {l["attributes"]["locale"]: l for l in vl["data"]}
        for d in LANGS.values():
            l = vgot.get(d["apple_locale"])
            if not l or not l["attributes"].get("description") or not l["attributes"].get("keywords"):
                todo.append(f"{plat} {d['apple_locale']}: description / keywords"); continue
            sets = l["relationships"]["appScreenshotSets"].get("data") or []
            if not sets:
                todo.append(f"{plat} {d['apple_locale']}: screenshots")
        try:
            rd = asc.api("GET", f"/v1/appStoreVersions/{v['id']}/appStoreReviewDetail")["data"]
            r = rd["attributes"]
            if not (r.get("contactEmail") and r.get("contactPhone") and r.get("contactFirstName")):
                todo.append(f"{plat}: App Review contact (name, phone, email)")
        except SystemExit:
            todo.append(f"{plat}: App Review details")
    todo.append("App Privacy questionnaire (web only, no API): answer 'Data Not Collected', publish")
    print("Still to do before submitting:" if todo else "Nothing missing.")
    for t in todo:
        print("  - " + t)


if __name__ == "__main__":
    asc.load_env()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args or args[0] not in ("configure", "text", "attach", "shots", "check"):
        sys.exit(__doc__)
    if args[0] == "configure":
        cmd_configure()
    elif args[0] == "text":
        cmd_text()
    elif args[0] == "attach":
        ver = sys.argv[sys.argv.index("--version") + 1] if "--version" in sys.argv else VERSION
        cmd_attach(args[1], ver)
    elif args[0] == "shots":
        opt = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
        cmd_shots(opt("--lang"), opt("--platform"))
    else:
        cmd_check()
