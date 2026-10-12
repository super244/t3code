/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=4m; seat=codex; date=2026-10-01 */
import { UsageDay, USAGE_CONTRACT_VERSION } from "@t3tools/contracts";
import { mergeUsage } from "@t3tools/shared/usageMerge";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  write: vi.fn(),
  deleted: vi.fn(),
  share: vi.fn(),
}));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: class {
    readonly uri: string;
    constructor(cache: string, name: string) {
      this.uri = `${cache}/${name}`;
    }
    get exists() {
      return mocks.files.has(this.uri);
    }
    create() {
      mocks.files.set(this.uri, "");
    }
    write(content: string) {
      mocks.write(content);
      mocks.files.set(this.uri, content);
    }
    delete() {
      mocks.deleted(this.uri);
      mocks.files.delete(this.uri);
    }
  },
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "unique" }));
vi.mock("../../lib/attachmentDownload", () => ({ shareLocalAttachment: mocks.share }));

import { shareUsageReport } from "./shareUsageReport";

const report = {
  merged: {
    ...mergeUsage([], USAGE_CONTRACT_VERSION),
    daily: [
      {
        day: "2026-10-01",
        totalTokens: 10,
        costUsd: 1,
        byProvider: new Map([["codex" as const, { totalTokens: 10, costUsd: 1 }]]),
      },
    ],
  },
  window: {
    sinceDay: UsageDay.make("2026-10-01"),
    untilDay: UsageDay.make("2026-10-01"),
    timeZone: "America/Vancouver",
  },
  windowLabel: "Oct 1",
  metric: "cost" as const,
  selectedProvider: "codex" as const,
  selectedEnvironmentIds: ["machine"],
  exportedAt: "2026-10-01T12:00:00Z",
  providers: [{ provider: "codex" as const, label: "Codex" }],
};

beforeEach(() => {
  mocks.files.clear();
  mocks.write.mockReset();
  mocks.deleted.mockReset();
  mocks.share.mockReset();
  mocks.share.mockResolvedValue(undefined);
});

describe("native usage report sharing", () => {
  it.each(["json", "csv"] as const)(
    "writes %s with correct content, name and MIME before sharing, then removes only its source",
    async (format) => {
      const signal = new AbortController().signal;
      mocks.share.mockImplementation(async ({ uri, attachment, sourceIdentifier }) => {
        expect(attachment).toEqual({
          name: `t3-usage-codex-2026-10-01.${format}`,
          mimeType: format === "json" ? "application/json" : "text/csv",
        });
        expect(sourceIdentifier).toBe("export-control");
        const content = mocks.files.get(uri)!;
        if (format === "json")
          expect(JSON.parse(content).periods[0].byProvider.codex).toEqual({
            totalTokens: 10,
            costUsd: 1,
          });
        else expect(content).toContain('"2026-10-01",10,1,10,1');
        expect(mocks.deleted).not.toHaveBeenCalled();
      });
      await shareUsageReport({ report, format, signal, sourceIdentifier: "export-control" });
      expect(mocks.share).toHaveBeenCalledTimes(1);
      expect(mocks.deleted).toHaveBeenCalledTimes(1);
      expect(mocks.files.size).toBe(0);
    },
  );

  it("does no work for a cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await shareUsageReport({ report, format: "json", signal: controller.signal });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it("keeps the source until a pending cache copy settles after cancellation", async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const copied = Promise.withResolvers<void>();
    mocks.share.mockImplementation(() => {
      started.resolve();
      return copied.promise;
    });
    const task = shareUsageReport({ report, format: "json", signal: controller.signal });
    await started.promise;
    controller.abort();
    expect(mocks.deleted).not.toHaveBeenCalled();
    copied.resolve();
    await task;
    expect(mocks.files.size).toBe(0);
  });

  it.each([
    "Saving and sharing files is unavailable on this device.",
    "Could not prepare the attachment for sharing.",
  ])("cleans up and preserves actionable errors: %s", async (message) => {
    mocks.share.mockRejectedValue(new Error(message));
    await expect(
      shareUsageReport({ report, format: "csv", signal: new AbortController().signal }),
    ).rejects.toThrow(message);
    expect(mocks.files.size).toBe(0);
    expect(mocks.deleted).toHaveBeenCalledTimes(1);
  });

  it("cleans up a partially written file without attempting sharing", async () => {
    mocks.write.mockImplementation(() => {
      throw new Error("No disk space");
    });
    await expect(
      shareUsageReport({ report, format: "csv", signal: new AbortController().signal }),
    ).rejects.toThrow("No disk space");
    expect(mocks.share).not.toHaveBeenCalled();
    expect(mocks.files.size).toBe(0);
  });
});
