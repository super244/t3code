/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
vi.mock("../../branding", () => ({ APP_VERSION: "0.0.40" }));
import { checkUpstreamTrackerNow, useUpstreamTracker } from "./upstreamTracker";
import type { UpstreamStatus } from "@t3tools/shared/upstream";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("shared browser upstream tracker", () => {
  it("shares checks between mounted consumers, exposes failures, retries, and stops periodic checks on unmount", async () => {
    vi.useFakeTimers();
    const statuses: UpstreamStatus[] = [];
    const fetch = vi.fn(async (url: string) =>
      Response.json(
        url.includes("/releases")
          ? [
              {
                tag_name: "v0.0.49",
                name: "Release",
                draft: false,
                prerelease: false,
                assets: [],
                html_url: "https://github.com/pingdotgg/t3code/releases/tag/v0.0.49",
              },
            ]
          : [],
      ),
    );
    vi.stubGlobal("fetch", fetch);
    function Consumer() {
      const { status } = useUpstreamTracker();
      statuses.push(status);
      return null;
    }
    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(
        <>
          <Consumer />
          <Consumer />
        </>,
      );
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toMatchObject({ isChecking: false, hasNewRelease: true });
    fetch.mockImplementation(async () => new Response("rate limited", { status: 403 }));
    await act(async () => {
      await checkUpstreamTrackerNow();
    });
    expect(statuses.at(-1)?.error).toContain("403");
    expect(statuses.at(-1)?.latestRelease?.tagName).toBe("v0.0.49");
    const attempts = fetch.mock.calls.length;
    // Failed checks must not trigger an immediate effect/retry loop.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetch).toHaveBeenCalledTimes(attempts);
    fetch.mockImplementation(async () => Response.json([]));
    await act(async () => {
      await checkUpstreamTrackerNow();
    });
    expect(statuses.at(-1)?.error).toBeNull();
    await act(async () => {
      root.unmount();
    });
    const stoppedAt = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(fetch).toHaveBeenCalledTimes(stoppedAt);
  });
});
