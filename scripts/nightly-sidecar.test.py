#!/usr/bin/env python3
# agent-watermark: model=haiku-5.5; effort=high; duration=20m; seat=claude-code; date=2026-10-12
"""Offline tests for nightly-sidecar.py: manifest parsing, version order, isolation, seeding.

Run with: python3 scripts/nightly-sidecar.test.py
"""

import base64
import hashlib
import importlib.util
import os
import plistlib
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("nightly-sidecar.py")
spec = importlib.util.spec_from_file_location("nightly_sidecar", SCRIPT)
sidecar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sidecar)

MANIFEST = """version: '0.0.46-nightly.20261012.3021'
files:
  - url: T3-Code-0.0.46-nightly.20261012.3021-arm64.zip
    sha512: q1B/ATnw0rnueRi3ZKsCxdUd3ay9FAcptaiKd3Yey/5zmqqiKMalhYXy5lI+w4gKDPLqzginxfLc867WGYCqUw==
    size: 154766168
  - url: T3-Code-0.0.46-nightly.20261012.3021-arm64.dmg
    sha512: B/lCY29VHG4PvPz1Ce8yG1YkGPJrgNn8VwqG2I8XMHLO+IyNaxdCD0K0VugfPDjHFGfZ/f+G2KA1denz3W4hlQ==
    size: 163236513
  - url: T3-Code-0.0.46-nightly.20261012.3021-x64.dmg
    sha512: SicI0lLYh88Sq4w/W9cfuNHsPUcozJsKNIQyGA6mxxmrlwzRuDVWyz1h3TgFpNgMvAmKV6VCqA4pEenRv7KOcw==
    size: 172488054
releaseDate: '2026-10-12T15:00:23.774Z'
"""


class ManifestTests(unittest.TestCase):
    def test_parses_version_release_date_and_files(self):
        manifest = sidecar.parse_nightly_mac_yml(MANIFEST)
        self.assertEqual(manifest["version"], "0.0.46-nightly.20261012.3021")
        self.assertEqual(manifest["release_date"], "2026-10-12T15:00:23.774Z")
        self.assertEqual(len(manifest["files"]), 3)
        self.assertTrue(all(isinstance(item["size"], int) for item in manifest["files"]))

    def test_selects_the_single_arm64_dmg(self):
        dmg = sidecar.arm64_dmg(sidecar.parse_nightly_mac_yml(MANIFEST))
        self.assertEqual(dmg["url"], "T3-Code-0.0.46-nightly.20261012.3021-arm64.dmg")
        self.assertEqual(dmg["size"], 163236513)
        self.assertTrue(dmg["sha512"].startswith("B/lCY29V"))

    def test_base64_values_keep_their_slashes_and_equals(self):
        dmg = sidecar.arm64_dmg(sidecar.parse_nightly_mac_yml(MANIFEST))
        self.assertTrue(dmg["sha512"].endswith("hlQ=="))

    def test_rejects_entries_with_path_separators_or_missing_size(self):
        bad = MANIFEST.replace("  - url: T3-Code-0.0.46-nightly.20261012.3021-x64.dmg", "  - url: ../evil-arm64.dmg")
        with self.assertRaises(ValueError):
            sidecar.parse_nightly_mac_yml(bad)
        missing = MANIFEST.replace("    size: 172488054", "")
        with self.assertRaises(ValueError):
            sidecar.parse_nightly_mac_yml(missing)

    def test_rejects_a_manifest_without_exactly_one_arm64_dmg(self):
        manifest = sidecar.parse_nightly_mac_yml(MANIFEST.replace("arm64.dmg", "arm64.zip"))
        with self.assertRaises(ValueError):
            sidecar.arm64_dmg(manifest)


class VersionTests(unittest.TestCase):
    def test_orders_by_date_then_build_number(self):
        self.assertGreater(
            sidecar.version_key("0.0.46-nightly.20261012.3021"),
            sidecar.version_key("0.0.46-nightly.20261003.2632"),
        )
        self.assertGreater(
            sidecar.version_key("v0.0.46-nightly.20261004.2652"),
            sidecar.version_key("0.0.46-nightly.20261004.2648"),
        )

    def test_rejects_non_nightly_versions(self):
        for value in ["0.0.45-preview.20261011.custom15", "latest", "", None]:
            with self.assertRaises(ValueError):
                sidecar.version_key(value)

    def test_is_newer_treats_unknown_installed_versions_as_older(self):
        self.assertTrue(sidecar.is_newer("0.0.46-nightly.20261012.3021", "0.0.46-nightly.20261003.2632"))
        self.assertFalse(sidecar.is_newer("0.0.46-nightly.20261003.2632", "0.0.46-nightly.20261012.3021"))
        self.assertTrue(sidecar.is_newer("0.0.46-nightly.20261012.3021", None))
        self.assertTrue(sidecar.is_newer("0.0.46-nightly.20261012.3021", "0.0.45-preview.20261011.custom15"))

    def test_normalizes_tags_to_versions(self):
        self.assertEqual(
            sidecar.normalize_version("v0.0.46-nightly.20261012.3021"),
            "0.0.46-nightly.20261012.3021",
        )


def release(tag, dmg=True, prerelease=True, draft=False):
    """A GitHub API release dict; dmg adds the mac arm64 DMG asset the channel requires."""
    version = tag.removeprefix("v")
    assets = []
    if dmg:
        name = f"T3-Code-{version}-arm64.dmg"
        assets.append(
            {"name": name, "browser_download_url": f"https://github.com/pingdotgg/t3code/releases/download/{tag}/{name}"}
        )
    return {"tag_name": tag, "prerelease": prerelease, "draft": draft, "assets": assets}


class ReleaseSelectionTests(unittest.TestCase):
    def test_picks_the_newest_nightly_prerelease(self):
        releases = [
            release("v0.0.45", prerelease=False),
            release("v0.0.46-nightly.20261003.2632"),
            release("v0.0.46-nightly.20261012.3021"),
            release("v0.0.46-nightly.20261013.3100", draft=True),
            release("v0.0.44-nightly.20261020.9999", prerelease=False),
        ]
        picked = sidecar.pick_latest_nightly(releases)
        self.assertEqual(picked["tag_name"], "v0.0.46-nightly.20261012.3021")

    def test_returns_none_without_nightlies(self):
        self.assertIsNone(sidecar.pick_latest_nightly([release("v0.0.45", prerelease=False)]))

    def test_pins_the_real_pick_and_no_update_when_installed_equals_latest(self):
        # Preview has a DMG and was published later; android-nightly has no DMG.
        releases = [
            release("v0.0.46-nightly.20261003.2632"),
            release("v0.0.46-nightly.20261012.3021"),
            release("v0.0.46-preview.20261010.2909"),
            release("android-nightly", dmg=False),
        ]
        picked = sidecar.pick_latest_nightly(releases)
        self.assertEqual(picked["tag_name"], "v0.0.46-nightly.20261012.3021")
        latest = sidecar.release_facts(picked)["version"]
        self.assertFalse(sidecar.is_newer(latest, "0.0.46-nightly.20261012.3021"))
        self.assertTrue(sidecar.is_newer(latest, "0.0.46-nightly.20261003.2632"))

    def test_skips_nightlies_without_an_arm64_dmg_and_orders_by_build_within_a_day(self):
        releases = [
            release("v0.0.46-nightly.20261013.3100", dmg=False),
            release("v0.0.46-nightly.20261012.999"),
            release("v0.0.46-nightly.20261012.1000"),
        ]
        self.assertEqual(sidecar.pick_latest_nightly(releases)["tag_name"], "v0.0.46-nightly.20261012.1000")

    def test_order_key_is_date_then_build(self):
        self.assertEqual(sidecar.version_key("v0.0.46-nightly.20261012.3021"), (20261012, 3021))
        self.assertFalse(sidecar.is_newer("0.0.46-nightly.20261012.3021", "0.0.46-nightly.20261012.3021"))
        self.assertTrue(sidecar.is_newer("0.0.46-nightly.20261012.1000", "0.0.46-nightly.20261012.999"))
        self.assertFalse(sidecar.is_newer("0.0.46-nightly.20261012.999", "0.0.46-nightly.20261012.1000"))

    def test_refuses_download_urls_outside_the_upstream_release_path(self):
        self.assertTrue(
            sidecar.checked_download_url(
                "https://github.com/pingdotgg/t3code/releases/download/v1/x.dmg"
            )
        )
        with self.assertRaises(ValueError):
            sidecar.checked_download_url("https://example.com/x.dmg")


class IsolationTests(unittest.TestCase):
    def info(self, **environment):
        return {"CFBundleIdentifier": sidecar.SIDECAR_BUNDLE_ID, "LSEnvironment": environment}

    def test_isolated_when_home_is_elsewhere_and_updater_is_off(self):
        state = sidecar.isolation(
            self.info(T3CODE_HOME="/Users/luca/.t3-nightly", T3CODE_DISABLE_AUTO_UPDATE="true")
        )
        self.assertTrue(state["isolated"])
        self.assertEqual(state["home"], "/Users/luca/.t3-nightly")

    def test_not_isolated_without_the_environment_block(self):
        self.assertFalse(sidecar.isolation({"CFBundleIdentifier": "com.t3tools.t3code"})["isolated"])

    def test_not_isolated_when_home_is_the_shared_home(self):
        state = sidecar.isolation(
            self.info(T3CODE_HOME=str(sidecar.SHARED_HOME), T3CODE_DISABLE_AUTO_UPDATE="true")
        )
        self.assertFalse(state["isolated"])

    def test_not_isolated_with_a_relative_home_or_without_the_updater_switch(self):
        self.assertFalse(
            sidecar.isolation(self.info(T3CODE_HOME="relative/home", T3CODE_DISABLE_AUTO_UPDATE="true"))[
                "isolated"
            ]
        )
        self.assertFalse(
            sidecar.isolation(self.info(T3CODE_HOME="/Users/luca/.t3-nightly"))["isolated"]
        )

    def test_sidecar_info_isolates_a_shared_bundle_and_keeps_other_keys(self):
        original = {
            "CFBundleIdentifier": sidecar.SHARED_BUNDLE_ID,
            "CFBundleShortVersionString": "0.0.46-nightly.20261003.2632",
            "LSEnvironment": {"MallocNanoZone": "0"},
        }
        updated = sidecar.sidecar_info(original, Path("/Users/luca/.t3-nightly"))
        self.assertEqual(updated["CFBundleIdentifier"], sidecar.SIDECAR_BUNDLE_ID)
        self.assertEqual(updated["LSEnvironment"]["MallocNanoZone"], "0")
        self.assertEqual(updated["CFBundleShortVersionString"], "0.0.46-nightly.20261003.2632")
        self.assertTrue(sidecar.isolation(updated)["isolated"])
        self.assertEqual(original["LSEnvironment"], {"MallocNanoZone": "0"})

    def test_plist_round_trip_keeps_the_isolation_verdict(self):
        updated = sidecar.sidecar_info(
            {"CFBundleIdentifier": sidecar.SHARED_BUNDLE_ID}, Path("/Users/luca/.t3-nightly")
        )
        reloaded = plistlib.loads(plistlib.dumps(updated, fmt=plistlib.FMT_XML))
        self.assertTrue(sidecar.isolation(reloaded)["isolated"])


class HashTests(unittest.TestCase):
    def test_sha512_matches_the_manifest_encoding(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "payload.bin"
            payload = b"nightly payload" * 1000
            path.write_bytes(payload)
            expected = base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")
            self.assertEqual(sidecar.file_sha512_base64(path), expected)
            sidecar.verify_file(path, len(payload), expected)

    def test_verify_rejects_size_and_digest_mismatches(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "payload.bin"
            path.write_bytes(b"abc")
            digest = base64.b64encode(hashlib.sha512(b"abc").digest()).decode("ascii")
            with self.assertRaises(ValueError):
                sidecar.verify_file(path, 4, digest)
            with self.assertRaises(ValueError):
                sidecar.verify_file(path, 3, digest[:-4] + "AAAA")


class SeedTests(unittest.TestCase):
    def make_source(self, root):
        userdata = root / "userdata"
        userdata.mkdir(parents=True)
        database = userdata / "state.sqlite"
        connection = sqlite3.connect(database)
        connection.execute("CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY, name TEXT)")
        connection.executemany(
            "INSERT INTO effect_sql_migrations VALUES (?, ?)",
            [(1, "OrchestrationEvents"), (51, "ProjectionThreadMessageContext"), (53, "PullRequestFilesViewed")],
        )
        connection.commit()
        connection.close()
        (userdata / "statev2.sqlite").write_bytes(b"")
        return userdata

    def test_seed_copies_with_vacuum_into_and_never_writes_the_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source_home = Path(directory) / "shared"
            dest_home = Path(directory) / "isolated"
            userdata = self.make_source(source_home)
            before = {path.name: (path.stat().st_mtime_ns, path.read_bytes()) for path in userdata.iterdir()}
            results = sidecar.seed_home(source_home, dest_home)
            after = {path.name: (path.stat().st_mtime_ns, path.read_bytes()) for path in userdata.iterdir()}
            self.assertEqual(before, after)
            self.assertEqual(sorted(path.name for path in userdata.iterdir()), ["state.sqlite", "statev2.sqlite"])
            copied = {item["file"]: item["status"] for item in results}
            self.assertEqual(copied, {"state.sqlite": "copied", "statev2.sqlite": "copied"})
            self.assertEqual(sidecar.migration_head(dest_home / "userdata" / "state.sqlite"), 53)

    def test_seed_creates_no_wal_companions_beside_a_closed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source_home = Path(directory) / "shared"
            dest_home = Path(directory) / "isolated"
            userdata = self.make_source(source_home)
            names_before = sorted(path.name for path in userdata.iterdir())
            sidecar.seed_home(source_home, dest_home)
            self.assertEqual(sorted(path.name for path in userdata.iterdir()), names_before)

    def test_seed_keeps_existing_destination_files(self):
        with tempfile.TemporaryDirectory() as directory:
            source_home = Path(directory) / "shared"
            dest_home = Path(directory) / "isolated"
            self.make_source(source_home)
            (dest_home / "userdata").mkdir(parents=True)
            (dest_home / "userdata" / "state.sqlite").write_bytes(b"own history")
            results = sidecar.seed_home(source_home, dest_home)
            self.assertEqual((dest_home / "userdata" / "state.sqlite").read_bytes(), b"own history")
            statuses = {item["file"]: item["status"] for item in results}
            self.assertEqual(statuses["state.sqlite"], "kept-existing")

    def test_migration_head_is_none_for_missing_or_foreign_databases(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(sidecar.migration_head(Path(directory) / "missing.sqlite"))
            empty = Path(directory) / "empty.sqlite"
            sqlite3.connect(empty).close()
            self.assertIsNone(sidecar.migration_head(empty))


class BackupNamingTests(unittest.TestCase):
    def test_latest_backup_ignores_displaced_bundles_and_orders_by_stamp(self):
        with tempfile.TemporaryDirectory() as directory:
            original_backups = sidecar.BACKUPS
            sidecar.BACKUPS = Path(directory)
            try:
                for name in [
                    "T3 Code (Nightly)-0.0.46-nightly.20261003.2632-20261010T100000000001Z.app",
                    "T3 Code (Nightly)-0.0.46-nightly.20261004.2648-20261011T100000000001Z.app",
                    "T3 Code (Nightly)-displaced-20261012T100000000001Z.app",
                ]:
                    (Path(directory) / name).mkdir()
                latest = sidecar.latest_backup()
                self.assertEqual(
                    latest.name,
                    "T3 Code (Nightly)-0.0.46-nightly.20261004.2648-20261011T100000000001Z.app",
                )
            finally:
                sidecar.BACKUPS = original_backups


if __name__ == "__main__":
    unittest.main(verbosity=2)
