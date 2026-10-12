/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { checkUpstreamNow, getUpstreamStatus } from "./upstreamMonitor.ts";

const release = (tag: string) => ({
  tag_name: tag,
  name: tag,
  published_at: "2026-10-03T12:00:00Z",
  html_url: "https://github.com/pingdotgg/t3code/releases/tag/" + tag,
  assets: [],
  draft: false,
  prerelease: false,
});

afterEach(() => vi.unstubAllGlobals());

describe("upstream monitor", () => {
  it("does not advertise an older release as an update", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.includes("/releases") ? [release("v0.0.1")] : []),
      ),
    );
    expect((await checkUpstreamNow()).hasNewRelease).toBe(false);
  });

  it("keeps last successful release data when GitHub is rate limited", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.includes("/releases") ? [release("v99.0.0")] : []),
      ),
    );
    await checkUpstreamNow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 403 })),
    );
    const failed = await checkUpstreamNow();
    expect(failed.error).toContain("403");
    expect(failed.latestRelease?.tagName).toBe("v99.0.0");
    expect(failed.isChecking).toBe(false);
  });

  it("coalesces overlapping checks", async () => {
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const fetch = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetch);
    const first = checkUpstreamNow();
    const second = checkUpstreamNow();
    expect(getUpstreamStatus().isChecking).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    complete(Response.json([]));
    await Promise.all([first, second]);
    expect(getUpstreamStatus().isChecking).toBe(false);
  });
});
