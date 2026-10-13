/* agent-watermark: model=haiku-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-12 */
import { describe, expect, it } from "vite-plus/test";

import {
  groupThreadsByProject,
  isEditableScanTarget,
  threadProjectGroupKey,
  nextScanIndex,
  projectGroupStatusLabels,
  resolveScanKey,
  scanEmptyMessage,
} from "./threadListScan.logic";

interface Row {
  readonly id: string;
  readonly project: string;
  readonly status: "approval" | "input" | "working" | "monitoring" | "failed" | "ready";
}

const rows: Row[] = [
  { id: "a", project: "vault", status: "working" },
  { id: "b", project: "t3", status: "ready" },
  { id: "c", project: "vault", status: "input" },
  { id: "d", project: "server", status: "ready" },
  { id: "e", project: "t3", status: "approval" },
  { id: "f", project: "vault", status: "failed" },
];

describe("threadProjectGroupKey", () => {
  const logical = new Map([
    ["local:p1", "repo:t3"],
    ["remote:p9", "repo:t3"],
  ]);

  it("gives two checkouts of one logical project the same group", () => {
    const threads = [
      { id: "a", environmentId: "local", projectId: "p1", status: "ready" as const },
      { id: "b", environmentId: "remote", projectId: "p9", status: "working" as const },
    ];
    const groups = groupThreadsByProject(threads, {
      projectKeyOf: (thread) => threadProjectGroupKey(thread, logical),
      statusOf: (thread) => thread.status,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ projectKey: "repo:t3", workingCount: 1 });
    expect(groups[0]?.threads.map((thread) => thread.id)).toEqual(["a", "b"]);
  });

  it("keeps a project outside the logical list under its own key", () => {
    expect(threadProjectGroupKey({ environmentId: "local", projectId: "p2" }, logical)).toBe(
      "local:p2",
    );
  });
});

describe("groupThreadsByProject", () => {
  it("groups by project in first-appearance order and keeps each group's row order", () => {
    const groups = groupThreadsByProject(rows, {
      projectKeyOf: (row) => row.project,
      statusOf: (row) => row.status,
    });
    expect(groups.map((group) => group.projectKey)).toEqual(["vault", "t3", "server"]);
    expect(groups[0]?.threads.map((row) => row.id)).toEqual(["a", "c", "f"]);
    expect(groups[1]?.threads.map((row) => row.id)).toEqual(["b", "e"]);
  });

  it("counts working and awaiting threads from real status, not from the title", () => {
    const groups = groupThreadsByProject(rows, {
      projectKeyOf: (row) => row.project,
      statusOf: (row) => row.status,
    });
    const byKey = new Map(groups.map((group) => [group.projectKey, group]));
    expect(byKey.get("vault")).toMatchObject({ workingCount: 1, awaitingCount: 1 });
    expect(byKey.get("t3")).toMatchObject({ workingCount: 0, awaitingCount: 1 });
    expect(byKey.get("server")).toMatchObject({ workingCount: 0, awaitingCount: 0 });
  });

  it("returns no groups for an empty list", () => {
    expect(
      groupThreadsByProject<Row>([], {
        projectKeyOf: (row) => row.project,
        statusOf: (row) => row.status,
      }),
    ).toEqual([]);
  });
});

describe("projectGroupStatusLabels", () => {
  it("reports only the live counts that are non-zero", () => {
    expect(projectGroupStatusLabels({ workingCount: 2, awaitingCount: 1 })).toEqual([
      "2 working",
      "1 waiting",
    ]);
    expect(projectGroupStatusLabels({ workingCount: 0, awaitingCount: 1 })).toEqual(["1 waiting"]);
    expect(projectGroupStatusLabels({ workingCount: 0, awaitingCount: 0 })).toEqual([]);
  });
});

describe("scanEmptyMessage", () => {
  it("says which query matched nothing", () => {
    expect(scanEmptyMessage({ query: "  usage  ", matchCount: 0 })).toBe(
      "No threads match “usage”",
    );
  });

  it("stays silent with no query or when something matched", () => {
    expect(scanEmptyMessage({ query: "   ", matchCount: 0 })).toBeNull();
    expect(scanEmptyMessage({ query: "usage", matchCount: 3 })).toBeNull();
  });
});

describe("nextScanIndex", () => {
  it("steps and clamps at both ends instead of wrapping", () => {
    expect(nextScanIndex(0, 3, 1)).toBe(1);
    expect(nextScanIndex(2, 3, 1)).toBe(2);
    expect(nextScanIndex(0, 3, -1)).toBe(0);
  });

  it("starts from the matching edge when nothing is highlighted", () => {
    expect(nextScanIndex(-1, 3, 1)).toBe(0);
    expect(nextScanIndex(-1, 3, -1)).toBe(2);
  });

  it("returns -1 for an empty list", () => {
    expect(nextScanIndex(0, 0, 1)).toBe(-1);
  });
});

describe("isEditableScanTarget", () => {
  it("treats text fields and editors as typing", () => {
    expect(isEditableScanTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableScanTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableScanTarget({ isContentEditable: true })).toBe(true);
    expect(
      isEditableScanTarget({
        tagName: "DIV",
        closest: (selector) => (selector.includes(".cm-editor") ? {} : null),
      }),
    ).toBe(true);
  });

  it("does not treat plain controls or missing targets as typing", () => {
    expect(isEditableScanTarget({ tagName: "BUTTON", closest: () => null })).toBe(false);
    expect(isEditableScanTarget(null)).toBe(false);
  });
});

describe("resolveScanKey", () => {
  const row = { tagName: "DIV", closest: () => null };
  const composer = { tagName: "DIV", isContentEditable: true };

  it("focuses search on slash from anywhere that is not a text field", () => {
    expect(
      resolveScanKey({ key: "/", hasModifier: false, target: row, focusOnRow: false }),
    ).toEqual({
      type: "focus-search",
    });
  });

  it("never takes a key typed into a composer or a field", () => {
    expect(
      resolveScanKey({ key: "/", hasModifier: false, target: composer, focusOnRow: true }),
    ).toEqual({
      type: "none",
    });
    expect(
      resolveScanKey({ key: "j", hasModifier: false, target: composer, focusOnRow: true }),
    ).toEqual({
      type: "none",
    });
  });

  it("moves between rows with j, k and the arrows only while a row holds focus", () => {
    expect(resolveScanKey({ key: "j", hasModifier: false, target: row, focusOnRow: true })).toEqual(
      {
        type: "move",
        delta: 1,
      },
    );
    expect(
      resolveScanKey({ key: "ArrowUp", hasModifier: false, target: row, focusOnRow: true }),
    ).toEqual({
      type: "move",
      delta: -1,
    });
    expect(
      resolveScanKey({ key: "k", hasModifier: false, target: row, focusOnRow: false }),
    ).toEqual({
      type: "none",
    });
  });

  it("leaves modified keys to the shortcut layer", () => {
    expect(resolveScanKey({ key: "/", hasModifier: true, target: row, focusOnRow: true })).toEqual({
      type: "none",
    });
  });
});
