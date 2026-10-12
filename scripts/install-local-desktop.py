#!/usr/bin/env python3
# agent-watermark: model=gpt-6.1-sol; effort=high; duration=19m; seat=codex; date=2026-10-08
"""Install a built custom Alpha ZIP with a retained rollback bundle; never quit it."""

import argparse
import json
import os
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

APP = "T3 Code (Alpha).app"
BUNDLE_ID = "com.t3tools.t3code"


def bundle_info(path):
    return plistlib.loads((path / "Contents/Info.plist").read_bytes())


def version_key(version):
    match = re.fullmatch(
        r"(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d{8})\.custom(\d+))?", version
    )
    if not match:
        raise ValueError(f"Unrecognized custom Alpha version: {version}")
    return tuple(int(value or 0) for value in match.groups())


def running(path):
    # Process names only; no provider prompts or environment values are read.
    result = subprocess.run(
        ["ps", "-axo", "pid=,comm="], check=True, capture_output=True, text=True
    )
    prefix = str(path / "Contents") + "/"
    return any(
        line.strip().partition(" ")[2].strip().startswith(prefix)
        for line in result.stdout.splitlines()
    )


def inspect_archive(path):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [item.filename.rstrip("/") for item in entries]
        if len(set(names)) != len(names) or not entries or len(entries) > 20000:
            raise ValueError("Unexpected or duplicate ZIP entries.")
        if sum(item.file_size for item in entries) > 2_000_000_000:
            raise ValueError("Expanded desktop bundle exceeds 2 GB.")
        for entry in entries:
            parts = PurePosixPath(entry.filename).parts
            if (
                not parts
                or parts[0] != APP
                or any(part in (".", "..") for part in parts)
            ):
                raise ValueError(f"Unexpected bundle path: {entry.filename}")
            if entry.flag_bits & 1:
                raise ValueError("Encrypted bundle entries are not supported.")
            if stat.S_ISLNK(entry.external_attr >> 16):
                link = archive.read(entry).decode("utf-8")
                joined = os.path.normpath(
                    str(PurePosixPath(entry.filename).parent / link)
                )
                if link.startswith("/") or not joined.startswith(APP + "/"):
                    raise ValueError(f"Symlink leaves the app bundle: {entry.filename}")
        info = plistlib.loads(archive.read(f"{APP}/Contents/Info.plist"))
        if (
            info.get("CFBundleIdentifier") != BUNDLE_ID
            or info.get("CFBundleExecutable") != "T3 Code (Alpha)"
        ):
            raise ValueError("Archive is not the expected custom Alpha app.")
        version_key(info["CFBundleShortVersionString"])
        return info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show the upgrade plan without extracting or installing",
    )
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This installer requires macOS.")
    target = Path("/Applications") / APP
    try:
        info = inspect_archive(args.archive)
        before = bundle_info(target) if target.exists() else None
        if before and before.get("CFBundleIdentifier") != BUNDLE_ID:
            raise ValueError("The destination belongs to a different application.")
        if before and version_key(info["CFBundleShortVersionString"]) < version_key(
            before["CFBundleShortVersionString"]
        ):
            raise ValueError("Refusing to downgrade the installed custom Alpha build.")
        active = running(target)
        plan = {
            "destination": str(target),
            "installed_version": before.get("CFBundleShortVersionString")
            if before
            else None,
            "new_version": info["CFBundleShortVersionString"],
            "requires_quit": active,
            "rollback": "Existing bundle retained in /Applications/.t3-local-upgrades",
            "state": "Existing server data and t3code-v2-alpha profile retained",
        }
        if args.dry_run:
            print(json.dumps(plan, indent=2))
            return 0
        if active:
            raise ValueError(
                "Close T3 Code (Alpha), then run this command again. Nightly may stay open. Nothing was installed."
            )
        with tempfile.TemporaryDirectory(
            prefix=".t3-install-", dir=target.parent
        ) as temporary:
            scratch = Path(temporary)
            snapshot = scratch / "snapshot.zip"
            shutil.copyfile(args.archive, snapshot)
            if inspect_archive(snapshot) != info:
                raise ValueError("The archive changed while preparing the upgrade.")
            extracted = scratch / "unpacked"
            subprocess.run(
                ["ditto", "-x", "-k", str(snapshot), str(extracted)],
                check=True,
                capture_output=True,
            )
            stage = extracted / APP
            subprocess.run(
                ["codesign", "--verify", "--deep", "--strict", str(stage)],
                check=True,
                capture_output=True,
            )
            if running(target):
                raise ValueError(
                    "Alpha opened while preparing the upgrade. Close it and run this command again."
                )
            if (bundle_info(target) if target.exists() else None) != before:
                raise ValueError(
                    "The installed app changed while preparing the upgrade. Run the command again."
                )
            backup = None
            if before:
                backups = target.parent / ".t3-local-upgrades"
                backups.mkdir(mode=0o700, exist_ok=True)
                stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%fZ")
                backup = (
                    backups
                    / f"T3 Code Alpha-{before['CFBundleShortVersionString']}-{stamp}.app"
                )
                target.rename(backup)
            try:
                stage.rename(target)
            except OSError:
                if backup:
                    backup.rename(target)
                raise
            print(
                json.dumps(
                    {
                        **plan,
                        "installed": True,
                        "backup": str(backup) if backup else None,
                    },
                    indent=2,
                )
            )
            print("Open T3 Code (Alpha) normally to use the new build.")
        return 0
    except (
        OSError,
        ValueError,
        zipfile.BadZipFile,
        subprocess.CalledProcessError,
    ) as error:
        detail = (
            error.stderr.decode(errors="replace").strip()
            if isinstance(error, subprocess.CalledProcessError)
            and isinstance(error.stderr, bytes)
            else str(error)
        )
        print(detail, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
