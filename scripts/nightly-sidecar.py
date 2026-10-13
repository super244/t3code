#!/usr/bin/env python3
# agent-watermark: model=haiku-5.5; effort=high; duration=55m; seat=claude-code; date=2026-10-12
"""Run upstream T3 Code Nightly beside the fork's Alpha without sharing its state.

Subcommands:
  check     Latest upstream nightly and the installed Nightly app. Read-only.
  install   Download and verify the nightly arm64 DMG, then swap in an isolated copy.
  rollback  Swap back to the bundle that the last install replaced.

Isolation: the upstream desktop app takes its T3 home from T3CODE_HOME and keeps its
state under $T3CODE_HOME/userdata. Finder launches do not inherit a shell environment,
so the installed bundle carries T3CODE_HOME and T3CODE_DISABLE_AUTO_UPDATE in
Info.plist LSEnvironment, which LaunchServices applies to Finder launches. The bundle
also gets its own CFBundleIdentifier. Nothing under ~/.t3/userdata is written, moved
or deleted; --seed reads it through SQLite read-only mode and VACUUM INTO.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import plistlib
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

REPO = "pingdotgg/t3code"
API_RELEASES = f"https://api.github.com/repos/{REPO}/releases"
RELEASE_PREFIX = f"https://github.com/{REPO}/releases/download/"
APP_NAME = "T3 Code (Nightly).app"
APP_BASE = "T3 Code (Nightly)"
SHARED_BUNDLE_ID = "com.t3tools.t3code"
SIDECAR_BUNDLE_ID = "com.t3tools.t3code.nightly-sidecar"
TARGET = Path("/Applications") / APP_NAME
BACKUPS = TARGET.parent / ".t3-nightly-upgrades"
STAGING = TARGET.parent / ".t3-nightly-staged"
CACHE = Path.home() / "Library" / "Caches" / "t3code-nightly-sidecar"
SHARED_HOME = Path.home() / ".t3"
SIDECAR_HOME = Path.home() / ".t3-nightly"
SEED_FILES = ("state.sqlite", "statev2.sqlite")
TRUE_VALUES = {"1", "true", "yes", "on"}
STAMP_RE = re.compile(r"-(\d{8}T\d{6}\d{6})Z\.app$")


class SidecarError(Exception):
    """A refusal or failure that the caller should see as JSON on stdout."""

    def __init__(self, message, exit_code=2):
        super().__init__(message)
        self.exit_code = exit_code


NIGHTLY_RELEASE_TAG = re.compile(r"v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+")


def version_key(version):
    """(date, build) order of an upstream nightly version or tag such as v0.0.46-nightly.20261012.3021.

    Preview prereleases and android-nightly are rejected, so semver prerelease-string
    order never decides which nightly is newest.
    """
    match = re.fullmatch(r"v?\d+\.\d+\.\d+-nightly\.(\d{8})\.(\d+)", version or "")
    if not match:
        raise ValueError(f"Not an upstream nightly version: {version!r}")
    return (int(match.group(1)), int(match.group(2)))


def normalize_version(tag):
    version_key(tag)
    return tag.removeprefix("v")


def unquote(value):
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    return value


def parse_nightly_mac_yml(text):
    """Parse the small nightly-mac.yml that electron-builder writes. No YAML dependency."""
    version = None
    release_date = None
    files = []
    current = None
    in_files = False
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith(" "):
            in_files = False
            current = None
            key, _, value = line.partition(":")
            value = unquote(value.strip())
            if key == "version":
                version = value
            elif key == "releaseDate":
                release_date = value
            elif key == "files":
                in_files = True
            continue
        if not in_files:
            continue
        item = line.strip()
        if item.startswith("- "):
            current = {}
            files.append(current)
            item = item[2:].strip()
        if current is None or ":" not in item:
            raise ValueError(f"Unexpected nightly-mac.yml line: {raw!r}")
        key, _, value = item.partition(":")
        current[key.strip()] = unquote(value.strip())
    if not version:
        raise ValueError("nightly-mac.yml has no version.")
    normalized = []
    for entry in files:
        name = entry.get("url", "")
        sha512 = entry.get("sha512", "")
        size = entry.get("size", "")
        if not name or "/" in name or not sha512 or not size.isdigit():
            raise ValueError(f"Incomplete nightly-mac.yml file entry: {entry!r}")
        normalized.append({"url": name, "sha512": sha512, "size": int(size)})
    return {"version": version, "release_date": release_date, "files": normalized}


def arm64_dmg(manifest):
    matches = [entry for entry in manifest["files"] if entry["url"].endswith("-arm64.dmg")]
    if len(matches) != 1:
        raise ValueError(f"Expected one arm64 DMG in nightly-mac.yml, found {len(matches)}.")
    return matches[0]


def has_arm64_dmg(release):
    return any(
        isinstance(asset, dict) and str(asset.get("name", "")).endswith("-arm64.dmg")
        for asset in release.get("assets", [])
    )


def pick_latest_nightly(releases):
    """Newest non-draft nightly prerelease with a mac arm64 DMG, ordered by (date, build), or None."""
    candidates = []
    for release in releases:
        tag = release.get("tag_name") or ""
        if release.get("draft") or not release.get("prerelease"):
            continue
        if not NIGHTLY_RELEASE_TAG.fullmatch(tag) or not has_arm64_dmg(release):
            continue
        key = version_key(tag)
        candidates.append((key, release))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[0])[1]


def release_facts(release):
    tag = release["tag_name"]
    assets = {
        asset.get("name", ""): asset.get("browser_download_url", "")
        for asset in release.get("assets", [])
        if isinstance(asset, dict)
    }
    return {
        "tag": tag,
        "version": normalize_version(tag),
        "published_at": release.get("published_at") or "",
        "html_url": release.get("html_url") or "",
        "assets": assets,
    }


def checked_download_url(url):
    if not url.startswith(RELEASE_PREFIX):
        raise ValueError(f"Refusing a download outside the upstream release path: {url}")
    return url


def isolation(info):
    """Whether an Info.plist keeps this Nightly's state away from ~/.t3."""
    environment = info.get("LSEnvironment") or {}
    raw_home = environment.get("T3CODE_HOME")
    home = None
    if isinstance(raw_home, str) and raw_home.strip():
        candidate = Path(raw_home.strip())
        if candidate.is_absolute():
            home = candidate
    home_isolated = home is not None and os.path.realpath(home) != os.path.realpath(
        SHARED_HOME
    )
    auto_update_disabled = str(
        environment.get("T3CODE_DISABLE_AUTO_UPDATE", "")
    ).strip().lower() in TRUE_VALUES
    return {
        "home": str(home) if home is not None else None,
        "auto_update_disabled": auto_update_disabled,
        "isolated": home_isolated and auto_update_disabled,
    }


def sidecar_info(info, home):
    """Info.plist for an isolated copy: own bundle id, own home, updater off."""
    updated = dict(info)
    updated["CFBundleIdentifier"] = SIDECAR_BUNDLE_ID
    environment = dict(info.get("LSEnvironment") or {})
    environment["T3CODE_HOME"] = str(home)
    environment["T3CODE_DISABLE_AUTO_UPDATE"] = "true"
    updated["LSEnvironment"] = environment
    return updated


def installed_facts(app=TARGET):
    plist_path = app / "Contents" / "Info.plist"
    if not plist_path.is_file():
        return None
    info = plistlib.loads(plist_path.read_bytes())
    state = isolation(info)
    return {
        "app_path": str(app),
        "version": info.get("CFBundleShortVersionString"),
        "bundle_id": info.get("CFBundleIdentifier"),
        **state,
    }


def is_newer(candidate, installed):
    """True when candidate sorts after installed. An unknown installed version counts as older."""
    try:
        return version_key(candidate) > version_key(installed)
    except (TypeError, ValueError):
        return True


def running(app):
    """True when a process runs from this bundle. Reads process paths only."""
    result = subprocess.run(
        ["ps", "-axo", "pid=,comm="], check=True, capture_output=True, text=True
    )
    prefix = str(app / "Contents") + "/"
    return any(
        line.strip().partition(" ")[2].strip().startswith(prefix)
        for line in result.stdout.splitlines()
    )


def open_read_only(database):
    """Read-only connection that never creates -wal or -shm beside the database.

    SQLite creates those companions when a WAL database is opened without them, even
    read-only. A live WAL (non-empty -wal) needs the normal read-only open; otherwise
    immutable mode reads the main file and touches nothing else in the directory.
    """
    wal = database.with_name(database.name + "-wal")
    live_wal = wal.is_file() and wal.stat().st_size > 0
    mode = "mode=ro" if live_wal else "mode=ro&immutable=1"
    uri = "file:" + urllib.parse.quote(str(database)) + "?" + mode
    return sqlite3.connect(uri, uri=True)


def migration_head(database):
    """Highest migration id recorded in a state database, read without writing."""
    if not database.is_file():
        return None
    connection = open_read_only(database)
    try:
        row = connection.execute(
            "SELECT MAX(migration_id) FROM effect_sql_migrations"
        ).fetchone()
    except sqlite3.Error:
        return None
    finally:
        connection.close()
    return row[0] if row else None


def seed_home(source_home, dest_home):
    """Copy the shared state databases into an isolated home with VACUUM INTO.

    The source is opened read-only and never written. Existing destination files
    are kept, so a re-run never replaces the isolated app's own history.
    """
    source_dir = source_home / "userdata"
    dest_dir = dest_home / "userdata"
    results = []
    for name in SEED_FILES:
        source = source_dir / name
        dest = dest_dir / name
        if not source.is_file():
            results.append({"file": name, "status": "missing-source"})
            continue
        if dest.exists():
            results.append({"file": name, "status": "kept-existing"})
            continue
        dest_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = dest_dir / f".{name}.{os.getpid()}.tmp"
        temporary.unlink(missing_ok=True)
        connection = open_read_only(source)
        try:
            connection.execute("VACUUM INTO ?", (str(temporary),))
        except sqlite3.Error:
            temporary.unlink(missing_ok=True)
            raise
        finally:
            connection.close()
        os.chmod(temporary, 0o600)
        os.replace(temporary, dest)
        results.append({"file": name, "status": "copied", "bytes": dest.stat().st_size})
    return results


def github_json(url):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "t3code-nightly-sidecar"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def fetch_text(url):
    request = urllib.request.Request(
        checked_download_url(url), headers={"User-Agent": "t3code-nightly-sidecar"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def file_sha512_base64(path):
    digest = hashlib.sha512()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return base64.b64encode(digest.digest()).decode("ascii")


def verify_file(path, size, sha512):
    if path.stat().st_size != size:
        raise ValueError(f"{path.name} is {path.stat().st_size} bytes, expected {size}.")
    if file_sha512_base64(path) != sha512:
        raise ValueError(f"{path.name} does not match its sha512 in nightly-mac.yml.")


def download_verified(url, dest, size, sha512):
    if dest.exists():
        try:
            verify_file(dest, size, sha512)
            return dest
        except ValueError:
            dest.unlink()
    CACHE.mkdir(parents=True, exist_ok=True)
    temporary = dest.with_suffix(dest.suffix + ".part")
    request = urllib.request.Request(
        checked_download_url(url), headers={"User-Agent": "t3code-nightly-sidecar"}
    )
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as out:
        shutil.copyfileobj(response, out, length=1 << 20)
    verify_file(temporary, size, sha512)
    os.replace(temporary, dest)
    return dest


def resolve_release(tag):
    if tag:
        release = github_json(f"{API_RELEASES}/tags/v{normalize_version(tag)}")
    else:
        releases = github_json(f"{API_RELEASES}?per_page=30")
        release = pick_latest_nightly(releases)
        if release is None:
            raise SidecarError("No upstream nightly release was found.", exit_code=1)
    facts = release_facts(release)
    if not facts["version"] or not facts["tag"].startswith("v"):
        raise SidecarError(f"Unexpected nightly tag: {facts['tag']}", exit_code=1)
    return facts


def load_manifest(facts):
    url = facts["assets"].get("nightly-mac.yml")
    if not url:
        raise SidecarError(f"{facts['tag']} has no nightly-mac.yml asset.", exit_code=1)
    manifest = parse_nightly_mac_yml(fetch_text(url))
    if manifest["version"] != facts["version"]:
        raise SidecarError(
            f"nightly-mac.yml says {manifest['version']}, release says {facts['version']}.",
            exit_code=1,
        )
    entry = arm64_dmg(manifest)
    dmg_url = facts["assets"].get(entry["url"])
    if not dmg_url:
        raise SidecarError(f"{facts['tag']} has no asset named {entry['url']}.", exit_code=1)
    return {
        "version": manifest["version"],
        "release_date": manifest["release_date"],
        "dmg": {**entry, "download_url": checked_download_url(dmg_url)},
    }


def check_report():
    releases = github_json(f"{API_RELEASES}?per_page=30")
    release = pick_latest_nightly(releases)
    latest = None
    if release is not None:
        facts = release_facts(release)
        manifest = load_manifest(facts)
        latest = {
            "tag": facts["tag"],
            "version": facts["version"],
            "published_at": facts["published_at"],
            "html_url": facts["html_url"],
            "arm64_dmg": {
                "name": manifest["dmg"]["url"],
                "url": manifest["dmg"]["download_url"],
                "size": manifest["dmg"]["size"],
                "sha512": manifest["dmg"]["sha512"],
            },
        }
    installed = installed_facts()
    installed_version = installed["version"] if installed else None
    update_available = latest is not None and (
        installed is None or is_newer(latest["version"], installed_version)
    )
    return {
        "repo": REPO,
        "latest": latest,
        "installed": installed,
        "isolated": bool(installed and installed["isolated"]),
        "update_available": update_available,
        "shared_state": {
            "path": str(SHARED_HOME / "userdata" / "state.sqlite"),
            "migration_head": migration_head(SHARED_HOME / "userdata" / "state.sqlite"),
        },
        "sidecar_home": {
            "path": str(SIDECAR_HOME),
            "exists": SIDECAR_HOME.exists(),
        },
    }


def attach_dmg(dmg, mountpoint):
    subprocess.run(
        [
            "hdiutil",
            "attach",
            "-nobrowse",
            "-readonly",
            "-noautoopen",
            "-mountpoint",
            str(mountpoint),
            str(dmg),
        ],
        check=True,
        capture_output=True,
    )


def detach_dmg(mountpoint):
    result = subprocess.run(
        ["hdiutil", "detach", str(mountpoint), "-quiet"], capture_output=True
    )
    if result.returncode != 0:
        subprocess.run(["hdiutil", "detach", str(mountpoint), "-force", "-quiet"], check=False)


def stage_from_dmg(dmg, version, staging_root, home):
    """Copy the nightly app out of the DMG and make the isolated copy in staging.

    The DMG is mounted from a private directory under CACHE and always detached.
    """
    staging_root.mkdir(mode=0o700, exist_ok=True)
    mountpoint = Path(tempfile.mkdtemp(prefix="mount-", dir=CACHE))
    try:
        attach_dmg(dmg, mountpoint)
        apps = [
            path
            for path in mountpoint.iterdir()
            if path.suffix == ".app" and path.is_dir()
        ]
        if len(apps) != 1:
            raise SidecarError(f"Expected one app in the DMG, found {len(apps)}.", exit_code=1)
        source = apps[0]
        source_info = plistlib.loads((source / "Contents" / "Info.plist").read_bytes())
        if source_info.get("CFBundleIdentifier") != SHARED_BUNDLE_ID:
            raise SidecarError("The DMG app is not the upstream T3 Code bundle.", exit_code=1)
        if source_info.get("CFBundleShortVersionString") != version:
            raise SidecarError("The DMG app version does not match nightly-mac.yml.", exit_code=1)
        staged = staging_root / APP_NAME
        if staged.exists():
            shutil.rmtree(staged)
        subprocess.run(["ditto", str(source), str(staged)], check=True, capture_output=True)
    finally:
        detach_dmg(mountpoint)
        shutil.rmtree(mountpoint, ignore_errors=True)
    subprocess.run(["chmod", "-R", "u+w", str(staged)], check=True)
    plist_path = staged / "Contents" / "Info.plist"
    plist_path.write_bytes(
        plistlib.dumps(sidecar_info(source_info, home), fmt=plistlib.FMT_XML)
    )
    subprocess.run(
        ["codesign", "--force", "--deep", "--sign", "-", str(staged)],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["codesign", "--verify", "--deep", "--strict", str(staged)],
        check=True,
        capture_output=True,
    )
    return staged


def stamp_now():
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")


def cmd_check(_args):
    print(json.dumps(check_report(), indent=2))
    return 0


def cmd_install(args):
    if sys.platform != "darwin":
        raise SidecarError("The Nightly sidecar installer requires macOS.")
    facts = resolve_release(args.tag)
    manifest = load_manifest(facts)
    version = manifest["version"]
    installed = installed_facts()
    if (
        installed
        and installed["version"] not in (None, version)
        and not is_newer(version, installed["version"])
        and not args.allow_downgrade
    ):
        raise SidecarError(
            f"Refusing to replace {installed['version']} with older {version}. "
            "Pass --allow-downgrade to do it anyway."
        )
    cached = download_verified(
        manifest["dmg"]["download_url"],
        CACHE / manifest["dmg"]["url"],
        manifest["dmg"]["size"],
        manifest["dmg"]["sha512"],
    )
    seeded = []
    plan = {
        "target": str(TARGET),
        "installed_version": installed["version"] if installed else None,
        "new_version": version,
        "home": str(SIDECAR_HOME),
        "bundle_id": SIDECAR_BUNDLE_ID,
        "dmg": str(cached),
    }
    if installed and installed["isolated"] and installed["version"] == version:
        if args.seed:
            seeded = seed_home(SHARED_HOME, SIDECAR_HOME)
        print(
            json.dumps(
                {**plan, "installed": False, "reason": "already installed and isolated", "seed": seeded},
                indent=2,
            )
        )
        return 0
    # The staged copy is kept on a refusal so a re-run after quitting the app is the only step left.
    staged = stage_from_dmg(cached, version, STAGING, SIDECAR_HOME)
    if args.seed:
        seeded = seed_home(SHARED_HOME, SIDECAR_HOME)
    if running(TARGET):
        raise SidecarError(
            f"Quit T3 Code (Nightly), then run install again. Staged build kept at {staged}; "
            "nothing was replaced.",
            exit_code=2,
        )
    backup = None
    if TARGET.exists():
        BACKUPS.mkdir(mode=0o700, exist_ok=True)
        backup = BACKUPS / (
            f"{APP_BASE}-{installed['version'] if installed else 'unknown'}-{stamp_now()}.app"
        )
        TARGET.rename(backup)
    try:
        staged.rename(TARGET)
    except OSError:
        if backup:
            backup.rename(TARGET)
        raise
    shutil.rmtree(STAGING, ignore_errors=True)
    result = installed_facts() or {}
    print(
        json.dumps(
            {
                **plan,
                "installed": True,
                "bundle_id": result.get("bundle_id"),
                "home": result.get("home"),
                "isolated": result.get("isolated"),
                "auto_update_disabled": result.get("auto_update_disabled"),
                "backup": str(backup) if backup else None,
                "seed": seeded,
            },
            indent=2,
        )
    )
    return 0


def latest_backup():
    if not BACKUPS.is_dir():
        return None
    stamped = []
    for path in BACKUPS.iterdir():
        match = STAMP_RE.search(path.name)
        if (
            path.suffix == ".app"
            and match
            and path.name.startswith(APP_BASE + "-")
            and "-displaced-" not in path.name
        ):
            stamped.append((match.group(1), path))
    if not stamped:
        return None
    return max(stamped, key=lambda item: item[0])[1]


def cmd_rollback(_args):
    if sys.platform != "darwin":
        raise SidecarError("Rollback requires macOS.")
    backup = latest_backup()
    if backup is None:
        raise SidecarError(f"No Nightly backup in {BACKUPS}.")
    if running(TARGET):
        raise SidecarError("Quit T3 Code (Nightly), then run rollback again. Nothing was changed.")
    displaced = None
    if TARGET.exists():
        displaced = BACKUPS / f"{APP_BASE}-displaced-{stamp_now()}.app"
        TARGET.rename(displaced)
    try:
        backup.rename(TARGET)
    except OSError:
        # Put the bundle the user was running back, so a failed rollback changes nothing.
        if displaced is not None:
            displaced.rename(TARGET)
        raise
    restored = installed_facts() or {}
    print(
        json.dumps(
            {
                "restored": str(TARGET),
                "from": str(backup),
                "displaced": str(displaced) if displaced else None,
                "version": restored.get("version"),
                "bundle_id": restored.get("bundle_id"),
                "isolated": restored.get("isolated"),
            },
            indent=2,
        )
    )
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="Show the latest nightly and the installed app.")
    install = commands.add_parser("install", help="Install the isolated Nightly bundle.")
    install.add_argument("--tag", help="Release tag such as v0.0.46-nightly.20261012.3021.")
    install.add_argument("--seed", action="store_true", help="Copy shared threads into the isolated home.")
    install.add_argument("--allow-downgrade", action="store_true")
    commands.add_parser("rollback", help="Restore the bundle the last install replaced.")
    args = parser.parse_args(argv)
    handlers = {"check": cmd_check, "install": cmd_install, "rollback": cmd_rollback}
    try:
        return handlers[args.command](args)
    except SidecarError as error:
        print(json.dumps({"error": str(error)}, indent=2))
        return error.exit_code
    except (OSError, ValueError, subprocess.CalledProcessError, sqlite3.Error) as error:
        detail = (
            error.stderr.decode(errors="replace").strip()
            if isinstance(error, subprocess.CalledProcessError) and isinstance(error.stderr, bytes)
            else str(error)
        )
        print(json.dumps({"error": detail or type(error).__name__}, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(main())
