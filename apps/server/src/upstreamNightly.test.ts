/* agent-watermark: model=haiku-5.5; effort=high; duration=65m; seat=claude-code; date=2026-10-12 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  findNightlySidecarCheckout,
  nightlyInstallBlockedReason,
  nightlyInstallFromInfo,
  parseNightlyInstallBody,
  parseNightlyInstallRequest,
  readBuildSourceCheckout,
  resolveNightlySidecarCheckout,
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

describe("parseNightlyInstallBody", () => {
  it("treats an empty body as the defaults and parses a JSON body", () => {
    expect(parseNightlyInstallBody("")).toEqual({ tag: null, seed: false });
    expect(parseNightlyInstallBody("  \n")).toEqual({ tag: null, seed: false });
    expect(parseNightlyInstallBody('{"seed":true}')).toEqual({ tag: null, seed: true });
  });

  it("refuses malformed JSON instead of installing the latest nightly", () => {
    expect(parseNightlyInstallBody('{"seed":')).toBeNull();
    expect(parseNightlyInstallBody("not json")).toBeNull();
  });
});

describe("nightlyInstallFromInfo with a symlinked home", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
  });

  it("does not call a symlink to the shared home isolated, as the sidecar does", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "nightly-alias-"));
    roots.push(root);
    const shared = NodePath.join(root, ".t3");
    NodeFS.mkdirSync(shared);
    const alias = NodePath.join(root, "nightly");
    NodeFS.symlinkSync(shared, alias);
    const info = (home: string) => ({
      CFBundleShortVersionString: "0.0.46-nightly.20261012.3021",
      CFBundleIdentifier: "com.t3tools.t3code.nightly-sidecar",
      LSEnvironment: { T3CODE_HOME: home, T3CODE_DISABLE_AUTO_UPDATE: "true" },
    });

    expect(nightlyInstallFromInfo(info(alias), shared)).toMatchObject({ isolated: false });
    expect(nightlyInstallFromInfo(info(NodePath.join(root, ".t3-nightly")), shared)).toMatchObject({
      isolated: true,
    });
  });
});

describe("resolveNightlySidecarCheckout", () => {
  const roots: string[] = [];
  const tempDir = (prefix: string) => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
    roots.push(dir);
    return dir;
  };
  const makeCheckout = (prefix: string) => {
    const root = tempDir(prefix);
    NodeFS.mkdirSync(NodePath.join(root, "scripts"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, "scripts", "nightly-sidecar.py"), "");
    NodeFS.mkdirSync(NodePath.join(root, "apps", "server"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, "apps", "server", "package.json"), "{}");
    return root;
  };
  const recordBuild = (repoRoot: string) => {
    const buildDir = tempDir("nightly-build-");
    NodeFS.writeFileSync(
      NodePath.join(buildDir, "build-source.json"),
      JSON.stringify({ repoRoot }),
    );
    return buildDir;
  };
  const outside = () => tempDir("nightly-outside-");

  afterEach(() => {
    for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
  });

  it("prefers the working-directory checkout over the env override and the build record", () => {
    const fromCwd = makeCheckout("nightly-cwd-");
    const fromEnv = makeCheckout("nightly-env-");
    const fromBuild = makeCheckout("nightly-record-");
    expect(
      resolveNightlySidecarCheckout({
        cwd: NodePath.join(fromCwd, "apps", "server"),
        env: { T3CODE_SOURCE_CHECKOUT: fromEnv },
        buildDir: recordBuild(fromBuild),
      }),
    ).toBe(fromCwd);
  });

  it("uses T3CODE_SOURCE_CHECKOUT when the working directory is not a checkout", () => {
    const fromEnv = makeCheckout("nightly-env-");
    const fromBuild = makeCheckout("nightly-record-");
    expect(
      resolveNightlySidecarCheckout({
        cwd: outside(),
        env: { T3CODE_SOURCE_CHECKOUT: fromEnv },
        buildDir: recordBuild(fromBuild),
      }),
    ).toBe(fromEnv);
  });

  it("skips an env override that has no sidecar script and falls back to the build record", () => {
    const fromBuild = makeCheckout("nightly-record-");
    const notACheckout = outside();
    expect(
      resolveNightlySidecarCheckout({
        cwd: outside(),
        env: { T3CODE_SOURCE_CHECKOUT: notACheckout },
        buildDir: recordBuild(fromBuild),
      }),
    ).toBe(fromBuild);
    expect(
      resolveNightlySidecarCheckout({
        cwd: outside(),
        env: { T3CODE_SOURCE_CHECKOUT: "relative/checkout" },
        buildDir: recordBuild(fromBuild),
      }),
    ).toBe(fromBuild);
  });

  it("uses the build record for a packaged app, and refuses it once the script is gone", () => {
    const fromBuild = makeCheckout("nightly-record-");
    const buildDir = recordBuild(fromBuild);
    expect(resolveNightlySidecarCheckout({ cwd: outside(), env: {}, buildDir })).toBe(fromBuild);
    NodeFS.rmSync(NodePath.join(fromBuild, "scripts", "nightly-sidecar.py"));
    expect(resolveNightlySidecarCheckout({ cwd: outside(), env: {}, buildDir })).toBeNull();
  });

  it("returns null when no candidate holds the sidecar", () => {
    expect(
      resolveNightlySidecarCheckout({ cwd: outside(), env: {}, buildDir: outside() }),
    ).toBeNull();
  });

  it("ignores a malformed or relative build record", () => {
    const buildDir = outside();
    NodeFS.writeFileSync(NodePath.join(buildDir, "build-source.json"), "{not json");
    expect(readBuildSourceCheckout(buildDir)).toBeNull();
    NodeFS.writeFileSync(
      NodePath.join(buildDir, "build-source.json"),
      JSON.stringify({ repoRoot: "relative/path" }),
    );
    expect(readBuildSourceCheckout(buildDir)).toBeNull();
  });
});
