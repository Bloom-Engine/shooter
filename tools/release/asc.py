#!/usr/bin/env python3
"""App Store Connect helper for Bloom Shooter's TestFlight pipeline.

  asc.py setup     register the bundle id, create/download the iOS, tvOS and
                   Mac App Store provisioning profiles, report the app record
  asc.py testers   make sure an internal TestFlight group exists that gets
                   every build automatically
  asc.py status    latest builds per platform and their processing state
  asc.py next-build  print the next free build number (max uploaded + 1)

Credentials come from the environment (or the repo's git-ignored .env):
  ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (.p8), APPLE_TEAM_ID
"""
import json, os, sys, time, base64, urllib.request, urllib.error
from pathlib import Path

import jwt

ROOT = Path(__file__).resolve().parents[2]
BUNDLE_ID = "com.bloomengine.shooter"
APP_NAME = "Bloom Shooter"
PROFILE_DIR = Path.home() / ".perry"
PROFILES = {
    # platform -> (profile type, certificate types it accepts, file name)
    "ios":   ("IOS_APP_STORE",  ("DISTRIBUTION", "IOS_DISTRIBUTION"), "com_bloomengine_shooter_ios.mobileprovision"),
    "tvos":  ("TVOS_APP_STORE", ("DISTRIBUTION", "IOS_DISTRIBUTION"), "com_bloomengine_shooter_tvos.mobileprovision"),
    "macos": ("MAC_APP_STORE",  ("DISTRIBUTION", "MAC_APP_DISTRIBUTION"), "com_bloomengine_shooter_macos.provisionprofile"),
}


def load_env():
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    missing = [k for k in ("ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH") if not os.environ.get(k)]
    if missing:
        sys.exit(f"missing {', '.join(missing)} (set them in .env)")


def token():
    key = Path(os.path.expanduser(os.environ["ASC_KEY_PATH"])).read_text()
    now = int(time.time())
    return jwt.encode(
        {"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
        key, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})


def api(method, path, body=None):
    url = path if path.startswith("http") else "https://api.appstoreconnect.apple.com" + path
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None)
    req.add_header("Authorization", "Bearer " + token())
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} -> HTTP {e.code}\n{detail}")


def get_all(path):
    out, url = [], path
    while url:
        page = api("GET", url)
        out += page.get("data", [])
        url = page.get("links", {}).get("next")
    return out


def bundle_id_resource():
    found = [b for b in get_all(f"/v1/bundleIds?filter[identifier]={BUNDLE_ID}&limit=200")
             if b["attributes"]["identifier"] == BUNDLE_ID]
    if found:
        return found[0]
    print(f"registering bundle id {BUNDLE_ID}")
    return api("POST", "/v1/bundleIds", {"data": {"type": "bundleIds", "attributes": {
        "identifier": BUNDLE_ID, "name": APP_NAME, "platform": "UNIVERSAL"}}})["data"]


def app_resource():
    apps = api("GET", f"/v1/apps?filter[bundleId]={BUNDLE_ID}")["data"]
    return apps[0] if apps else None


def ensure_profile(platform, bundle, certs):
    ptype, cert_types, fname = PROFILES[platform]
    name = f"Bloom Shooter {platform} App Store"
    usable = [c for c in certs if c["attributes"]["certificateType"] in cert_types]
    if not usable:
        sys.exit(f"no {'/'.join(cert_types)} certificate in the team for {platform}")
    existing = [p for p in get_all(f"/v1/profiles?filter[name]={urllib.parse.quote(name)}&limit=200")
                if p["attributes"]["name"] == name]
    for p in existing:
        if p["attributes"]["profileState"] == "ACTIVE" and p["attributes"]["profileType"] == ptype:
            prof = p
            break
    else:
        for p in existing:   # expired/invalid: replace it
            api("DELETE", f"/v1/profiles/{p['id']}")
        print(f"creating {ptype} profile")
        prof = api("POST", "/v1/profiles", {"data": {"type": "profiles",
            "attributes": {"name": name, "profileType": ptype},
            "relationships": {
                "bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}},
                "certificates": {"data": [{"type": "certificates", "id": c["id"]} for c in usable]}}}})["data"]
    dest = PROFILE_DIR / fname
    dest.write_bytes(base64.b64decode(prof["attributes"]["profileContent"]))
    print(f"  {platform:6} {ptype:15} expires {prof['attributes']['expirationDate'][:10]} -> {dest}")


def cmd_setup():
    bundle = bundle_id_resource()
    print(f"bundle id {BUNDLE_ID}: {bundle['attributes']['platform']} (id {bundle['id']})")
    certs = [c for c in get_all("/v1/certificates?limit=200")
             if c["attributes"]["certificateType"] in ("DISTRIBUTION", "IOS_DISTRIBUTION", "MAC_APP_DISTRIBUTION")]
    for platform in PROFILES:
        ensure_profile(platform, bundle, certs)
    app = app_resource()
    if app:
        print(f"app record: {app['attributes']['name']} (Apple ID {app['id']})")
    else:
        print("app record: MISSING - create it in App Store Connect (see docs/RELEASE.md)")


def cmd_testers():
    app = app_resource() or sys.exit("no app record yet - create it in App Store Connect first")
    groups = get_all(f"/v1/apps/{app['id']}/betaGroups?limit=200")
    internal = [g for g in groups if g["attributes"]["isInternalGroup"]]
    for g in internal:
        if g["attributes"].get("hasAccessToAllBuilds"):
            print(f"internal group '{g['attributes']['name']}' already gets every build")
            break
    else:
        g = api("POST", "/v1/betaGroups", {"data": {"type": "betaGroups",
            "attributes": {"name": "Team", "isInternalGroup": True, "hasAccessToAllBuilds": True},
            "relationships": {"app": {"data": {"type": "apps", "id": app["id"]}}}}})["data"]
        print("created internal group 'Team' (gets every build automatically)")
    members = get_all(f"/v1/betaGroups/{g['id']}/betaTesters?limit=200")
    print(f"  {len(members)} tester(s): " + ", ".join(
        f"{m['attributes'].get('firstName') or ''} {m['attributes'].get('lastName') or ''}".strip() or "?" for m in members))


def builds(app):
    return api("GET", f"/v1/builds?filter[app]={app['id']}&limit=30&sort=-uploadedDate"
                      "&include=preReleaseVersion&fields[preReleaseVersions]=version,platform")


def cmd_status():
    app = app_resource() or sys.exit("no app record yet")
    resp = builds(app)
    prv = {p["id"]: p["attributes"] for p in resp.get("included", [])}
    for b in resp["data"]:
        a = b["attributes"]
        v = prv.get(b["relationships"]["preReleaseVersion"]["data"]["id"], {})
        print(f"{v.get('platform','?'):6} {v.get('version','?'):8} build {a['version']:>5}  "
              f"{a['processingState']:11} {a['uploadedDate'][:16]}")


def cmd_next_build():
    app = app_resource()
    nums = [int(b["attributes"]["version"]) for b in builds(app)["data"]
            if b["attributes"]["version"].isdigit()] if app else []
    print(max(nums, default=0) + 1)


if __name__ == "__main__":
    import urllib.parse
    load_env()
    cmds = {"setup": cmd_setup, "testers": cmd_testers, "status": cmd_status, "next-build": cmd_next_build}
    if len(sys.argv) != 2 or sys.argv[1] not in cmds:
        sys.exit(__doc__)
    cmds[sys.argv[1]]()
