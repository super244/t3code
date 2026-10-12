/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  classifyUpstreamAsset,
  emptyUpstreamStatus,
  fetchUpstreamStatus,
  isNewerUpstreamRelease,
  parseUpstreamReleases,
  selectUpstreamRelease,
} from "./upstream.ts";
const raw = (tag: string, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  html_url: `https://github.com/pingdotgg/t3code/releases/tag/${tag}`,
  assets: [],
  ...extra,
});
afterEach(() => vi.unstubAllGlobals());
describe("upstream release selection", () => {
  it("selects the newest stable and nightly independently of API order", () => {
    const releases = parseUpstreamReleases([
      raw("v0.0.50-nightly.20261002", { prerelease: true }),
      raw("v0.0.9"),
      raw("v0.0.50-nightly.20261003", { prerelease: true }),
      raw("v0.0.49"),
      raw("v99.0.0", { draft: true }),
    ]);
    expect(selectUpstreamRelease(releases, "stable")?.tagName).toBe("v0.0.49");
    expect(selectUpstreamRelease(releases, "nightly")?.tagName).toBe("v0.0.50-nightly.20261003");
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
