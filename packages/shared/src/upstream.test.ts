/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
/* agent-watermark: model=haiku-5.5; effort=high; duration=55m; seat=claude-code; date=2026-10-12 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  buildUpstreamNightlyStatus,
  classifyUpstreamAsset,
  nightlyOrderKey,
  emptyUpstreamStatus,
  fetchUpstreamStatus,
  isNewerUpstreamRelease,
  nightlyIsolation,
  parseUpstreamReleases,
  selectUpstreamRelease,
  type UpstreamNightlyInstall,
} from "./upstream.ts";
const raw = (tag: string, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  html_url: `https://github.com/pingdotgg/t3code/releases/tag/${tag}`,
  assets: [],
  ...extra,
});
/** A mac arm64 DMG asset as the GitHub API reports it for a release tag. */
const macDmg = (tag: string) => {
  const name = `T3-Code-${tag.slice(1)}-arm64.dmg`;
  return {
    name,
    browser_download_url: `https://github.com/pingdotgg/t3code/releases/download/${tag}/${name}`,
    size: 1,
  };
};

afterEach(() => vi.unstubAllGlobals());
describe("upstream release selection", () => {
  it("selects the newest stable and nightly independently of API order", () => {
    const releases = parseUpstreamReleases([
      raw("v0.0.50-nightly.20261002.1001", {
        prerelease: true,
        assets: [macDmg("v0.0.50-nightly.20261002.1001")],
      }),
      raw("v0.0.9"),
      raw("v0.0.50-nightly.20261003.1002", {
        prerelease: true,
        assets: [macDmg("v0.0.50-nightly.20261003.1002")],
      }),
      raw("v0.0.49"),
      raw("v99.0.0", { draft: true }),
    ]);
    expect(selectUpstreamRelease(releases, "stable")?.tagName).toBe("v0.0.49");
    expect(selectUpstreamRelease(releases, "nightly")?.tagName).toBe(
      "v0.0.50-nightly.20261003.1002",
    );
  });
  it("uses semantic ordering and does not compare unknown client versions lexically", () => {
    const release = parseUpstreamReleases([raw("v0.0.40")])[0]!;
    expect(isNewerUpstreamRelease(release, "0.0.4")).toBe(true);
    expect(isNewerUpstreamRelease(release, "0.0.40")).toBe(false);
    expect(isNewerUpstreamRelease(release, "0.0.41")).toBe(false);
    expect(isNewerUpstreamRelease(release, "dev")).toBe(false);
  });
  it("rejects malformed responses and untrusted download links", () => {
    expect(() => parseUpstreamReleases({ message: "rate limited" })).toThrow("invalid");
    expect(
      parseUpstreamReleases([null, raw("v1.0.0", { html_url: "javascript:alert(1)" })]),
    ).toEqual([]);
    const parsed = parseUpstreamReleases([
      raw("v1.0.0", {
        assets: [
          null,
          { name: "app-arm64.dmg", browser_download_url: "https://example.com/app.dmg" },
          {
            name: "app-arm64.dmg",
            browser_download_url:
              "https://github.com/pingdotgg/t3code/releases/download/v1.0.0/app-arm64.dmg",
            size: 20,
          },
        ],
      }),
    ]);
    expect(parsed[0]?.assets).toHaveLength(1);
    expect(parsed[0]?.assets[0]?.platform).toBe("mac-arm64");
  });
  it("does not classify platform metadata as an installable download", () => {
    expect(classifyUpstreamAsset("latest-linux.yml")).toBe("other");
    expect(classifyUpstreamAsset("app-arm64.dmg.blockmap")).toBe("other");
    expect(classifyUpstreamAsset("app.AppImage")).toBe("linux");
    expect(classifyUpstreamAsset("app.msi")).toBe("windows");
  });
  it("retains releases while refreshing commits on a partial API failure", async () => {
    const previous = {
      ...emptyUpstreamStatus("0.0.40"),
      checkedAt: "2026-10-01T00:00:00Z",
      releases: parseUpstreamReleases([raw("v0.0.49")]),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/releases")
          ? new Response("unavailable", { status: 500 })
          : Response.json([
              {
                sha: "abcdef012345",
                html_url: "https://github.com/pingdotgg/t3code/commit/abcdef012345",
                commit: { message: "fix: recover (#42)", author: { name: "Tester" } },
              },
            ]),
      ),
    );
    const result = await fetchUpstreamStatus(previous);
    expect(result.latestRelease?.tagName).toBe("v0.0.49");
    expect(result.recentCommits[0]?.prNumber).toBe(42);
    expect(result.error).toContain("500");
    expect(result.checkedAt).toBe(previous.checkedAt);
  });
  it("sends bounded parallel requests and reports invalid JSON", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) => new Response("not JSON", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await fetchUpstreamStatus(emptyUpstreamStatus("0.0.40"));
    expect(result.error).toBeTruthy();
    expect(result.checkedAt).toBe("");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });
});

const installedNightly = (version: string): UpstreamNightlyInstall => ({
  appPath: "/Applications/T3 Code (Nightly).app",
  version,
  bundleId: "com.t3tools.t3code.nightly-sidecar",
  home: "/Users/luca/.t3-nightly",
  autoUpdateDisabled: true,
  isolated: true,
});

describe("upstream nightly status", () => {
  const sharedHome = "/Users/luca/.t3";
  const installed = (version: string): UpstreamNightlyInstall => ({
    appPath: "/Applications/T3 Code (Nightly).app",
    version,
    bundleId: "com.t3tools.t3code.nightly-sidecar",
    home: "/Users/luca/.t3-nightly",
    autoUpdateDisabled: true,
    isolated: true,
  });
  const nightlies = parseUpstreamReleases([
    raw("v0.0.46-nightly.20261003.2632", {
      prerelease: true,
      assets: [macDmg("v0.0.46-nightly.20261003.2632")],
    }),
    raw("v0.0.46-nightly.20261012.3021", {
      prerelease: true,
      assets: [macDmg("v0.0.46-nightly.20261012.3021")],
    }),
    raw("v0.0.45"),
  ]);

  it("reports the newest nightly and whether it beats the installed one", () => {
    const status = buildUpstreamNightlyStatus({
      releases: nightlies,
      installed: installed("0.0.46-nightly.20261003.2632"),
      installBlockedReason: null,
    });
    expect(status.latestRelease?.tagName).toBe("v0.0.46-nightly.20261012.3021");
    expect(status.updateAvailable).toBe(true);
    expect(status.canInstall).toBe(true);
    expect(status.installBlockedReason).toBeNull();
  });

  it("is up to date when the installed nightly matches or is newer", () => {
    const same = buildUpstreamNightlyStatus({
      releases: nightlies,
      installed: installed("0.0.46-nightly.20261012.3021"),
      installBlockedReason: null,
    });
    const newer = buildUpstreamNightlyStatus({
      releases: nightlies,
      installed: installed("0.0.46-nightly.20261013.3100"),
      installBlockedReason: null,
    });
    expect(same.updateAvailable).toBe(false);
    expect(newer.updateAvailable).toBe(false);
  });

  it("offers an update when nothing is installed and keeps the install blocker", () => {
    const status = buildUpstreamNightlyStatus({
      releases: nightlies,
      installed: null,
      installBlockedReason: "Run from a T3 Code checkout to install Nightly.",
    });
    expect(status.updateAvailable).toBe(true);
    expect(status.canInstall).toBe(false);
    expect(status.installBlockedReason).toBe("Run from a T3 Code checkout to install Nightly.");
  });

  it("has no latest nightly without nightly prereleases", () => {
    const status = buildUpstreamNightlyStatus({
      releases: parseUpstreamReleases([raw("v0.0.45")]),
      installed: null,
      installBlockedReason: null,
    });
    expect(status.latestRelease).toBeNull();
    expect(status.updateAvailable).toBe(false);
  });

  it("isolates only when home leaves ~/.t3 and the updater is off", () => {
    expect(
      nightlyIsolation({
        environment: {
          T3CODE_HOME: "/Users/luca/.t3-nightly/",
          T3CODE_DISABLE_AUTO_UPDATE: "true",
        },
        sharedHome,
      }),
    ).toEqual({ home: "/Users/luca/.t3-nightly", autoUpdateDisabled: true, isolated: true });
    expect(
      nightlyIsolation({
        environment: { T3CODE_HOME: "/Users/luca/.t3", T3CODE_DISABLE_AUTO_UPDATE: "true" },
        sharedHome,
      }).isolated,
    ).toBe(false);
    expect(
      nightlyIsolation({ environment: { T3CODE_HOME: "/Users/luca/.t3-nightly" }, sharedHome })
        .isolated,
    ).toBe(false);
    expect(nightlyIsolation({ environment: { MallocNanoZone: "0" }, sharedHome })).toEqual({
      home: null,
      autoUpdateDisabled: false,
      isolated: false,
    });
  });

  it("treats a T3CODE_HOME that resolves to the shared home as not isolated", () => {
    // Lexical "." and ".." segments and doubled slashes still name ~/.t3.
    const updater = { T3CODE_DISABLE_AUTO_UPDATE: "true" };
    for (const home of [
      "/Users/luca/.t3/userdata/..",
      "/Users/luca//.t3/",
      "/Users/luca/./.t3",
      "/Users/luca/x/../.t3",
    ]) {
      expect(
        nightlyIsolation({ environment: { T3CODE_HOME: home, ...updater }, sharedHome }).isolated,
      ).toBe(false);
    }
  });

  it("starts with no shared-state or nightly facts until the server fills them in", () => {
    expect(emptyUpstreamStatus("0.0.40")).toMatchObject({ sharedState: null, nightly: null });
  });
});

describe("nightly channel ordering", () => {
  const nightly = "v0.0.46-nightly.20261012.3021";
  const releases = parseUpstreamReleases([
    raw("v0.0.46-nightly.20261003.2632", {
      prerelease: true,
      assets: [macDmg("v0.0.46-nightly.20261003.2632")],
    }),
    raw(nightly, { prerelease: true, assets: [macDmg(nightly)] }),
    // Newer-looking to semver string order and published later, but not a nightly.
    raw("v0.0.46-preview.20261010.2909", {
      prerelease: true,
      published_at: "2026-10-14T00:00:00Z",
      assets: [macDmg("v0.0.46-preview.20261010.2909")],
    }),
    raw("android-nightly", { prerelease: true, published_at: "2026-10-15T00:00:00Z" }),
    // A nightly tag without a mac arm64 DMG is not installable, so it is never the pick.
    raw("v0.0.46-nightly.20261013.3100", {
      prerelease: true,
      published_at: "2026-10-16T00:00:00Z",
    }),
  ]);

  it("picks the newest nightly by (date, build), ignoring preview tags, android-nightly and assetless nightlies", () => {
    expect(selectUpstreamRelease(releases, "nightly")?.tagName).toBe(nightly);
  });

  it("reports no update when the installed nightly equals the latest", () => {
    const status = buildUpstreamNightlyStatus({
      releases,
      installed: installedNightly("0.0.46-nightly.20261012.3021"),
      installBlockedReason: null,
    });
    expect(status.latestRelease?.tagName).toBe(nightly);
    expect(status.updateAvailable).toBe(false);
  });

  it("reports no update when the installed nightly is newer than every installable release", () => {
    const status = buildUpstreamNightlyStatus({
      releases,
      installed: installedNightly("0.0.46-nightly.20261013.3100"),
      installBlockedReason: null,
    });
    expect(status.updateAvailable).toBe(false);
  });

  it("reports an update only when the latest nightly is newer by (date, build)", () => {
    const status = buildUpstreamNightlyStatus({
      releases,
      installed: installedNightly("0.0.46-nightly.20261003.2632"),
      installBlockedReason: null,
    });
    expect(status.updateAvailable).toBe(true);
  });

  it("orders equal dates by build number, not lexically", () => {
    expect(nightlyOrderKey("v0.0.46-nightly.20261012.999")).toEqual([20261012, 999]);
    const sameDay = parseUpstreamReleases([
      raw("v0.0.46-nightly.20261012.999", {
        prerelease: true,
        assets: [macDmg("v0.0.46-nightly.20261012.999")],
      }),
      raw("v0.0.46-nightly.20261012.1000", {
        prerelease: true,
        assets: [macDmg("v0.0.46-nightly.20261012.1000")],
      }),
    ]);
    expect(selectUpstreamRelease(sameDay, "nightly")?.tagName).toBe(
      "v0.0.46-nightly.20261012.1000",
    );
  });
});
