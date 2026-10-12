/* agent-watermark: model=haiku-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-12 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  findNightlySidecarCheckout,
  nightlyInstallBlockedReason,
  nightlyInstallFromInfo,
  parseNightlyInstallRequest,
} from "./upstreamNightly.ts";

const sharedHome = NodePath.join(NodeOS.homedir(), ".t3");

describe("nightlyInstallFromInfo", () => {
  it("reads an isolated Nightly bundle from its Info.plist values", () => {
    expect(
      nightlyInstallFromInfo(
        {
          CFBundleShortVersionString: "0.0.46-nightly.20261012.3021",
          CFBundleIdentifier: "com.t3tools.t3code.nightly-sidecar",
          LSEnvironment: {
            T3CODE_HOME: "/Users/luca/.t3-nightly",
            T3CODE_DISABLE_AUTO_UPDATE: "true",
          },
        },
        sharedHome,
      ),
    ).toEqual({
      appPath: "/Applications/T3 Code (Nightly).app",
      version: "0.0.46-nightly.20261012.3021",
      bundleId: "com.t3tools.t3code.nightly-sidecar",
      home: "/Users/luca/.t3-nightly",
      autoUpdateDisabled: true,
      isolated: true,
    });
  });

  it("reports the shared upstream bundle as not isolated", () => {
    const installed = nightlyInstallFromInfo(
      {
        CFBundleShortVersionString: "0.0.46-nightly.20261003.2632",
        CFBundleIdentifier: "com.t3tools.t3code",
        LSEnvironment: { MallocNanoZone: "0" },
      },
      sharedHome,
    );
    expect(installed).toMatchObject({
      bundleId: "com.t3tools.t3code",
      home: null,
      isolated: false,
    });
  });

  it("returns null when the bundle has no version", () => {
    expect(
      nightlyInstallFromInfo({ CFBundleIdentifier: "com.t3tools.t3code" }, sharedHome),
    ).toBeNull();
  });
});

describe("findNightlySidecarCheckout", () => {
  it("finds the checkout root from a nested directory and ignores trees without the script", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "nightly-checkout-"));
    try {
      const nested = NodePath.join(root, "apps", "server", "src");
      NodeFS.mkdirSync(nested, { recursive: true });
      NodeFS.mkdirSync(NodePath.join(root, "scripts"));
      NodeFS.writeFileSync(NodePath.join(root, "scripts", "nightly-sidecar.py"), "");
      NodeFS.writeFileSync(NodePath.join(root, "apps", "server", "package.json"), "{}");
      expect(findNightlySidecarCheckout(nested)).toBe(root);

      const bare = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "nightly-bare-"));
      try {
        expect(findNightlySidecarCheckout(bare)).toBeNull();
      } finally {
        NodeFS.rmSync(bare, { recursive: true, force: true });
      }
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("nightlyInstallBlockedReason", () => {
  it("explains why this server cannot install Nightly", () => {
    expect(nightlyInstallBlockedReason({ platform: "linux", checkout: "/repo" })).toBe(
      "Installing Nightly needs macOS.",
    );
    expect(nightlyInstallBlockedReason({ platform: "darwin", checkout: null })).toContain(
      "scripts/nightly-sidecar.py",
    );
    expect(nightlyInstallBlockedReason({ platform: "darwin", checkout: "/repo" })).toBeNull();
  });
});

describe("parseNightlyInstallRequest", () => {
  it("defaults to the latest nightly without seeding when there is no body", () => {
    expect(parseNightlyInstallRequest(undefined)).toEqual({ tag: null, seed: false });
  });

  it("accepts a nightly tag and a seed flag", () => {
    expect(
      parseNightlyInstallRequest({ tag: "v0.0.46-nightly.20261012.3021", seed: true }),
    ).toEqual({ tag: "v0.0.46-nightly.20261012.3021", seed: true });
    expect(parseNightlyInstallRequest({ tag: "0.0.46-nightly.20261012.3021" })).toEqual({
      tag: "0.0.46-nightly.20261012.3021",
      seed: false,
    });
  });

  it("rejects anything that is not a nightly tag or a boolean seed", () => {
    expect(parseNightlyInstallRequest({ tag: "--allow-downgrade" })).toBeNull();
    expect(parseNightlyInstallRequest({ tag: "v0.0.45" })).toBeNull();
    expect(parseNightlyInstallRequest({ seed: "yes" })).toBeNull();
    expect(parseNightlyInstallRequest(["v0.0.46-nightly.20261012.3021"])).toBeNull();
  });
});
