/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-03 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=6m; seat=antigravity; date=2026-10-02 */
import { describe, expect, it } from "vite-plus/test";

import {
  CURATED_PROMPT_PRESETS,
  filterPromptPresets,
  filterSavedPrompts,
  type PromptPreset,
} from "./promptPresets.ts";

describe("promptPresets", () => {
  it("includes all standard curated presets", () => {
    expect(CURATED_PROMPT_PRESETS.length).toBeGreaterThanOrEqual(7);
    const ids = CURATED_PROMPT_PRESETS.map((p: PromptPreset) => p.id);
    expect(ids).toContain("clean-refactor");
    expect(ids).toContain("unit-tests");
    expect(ids).toContain("security-audit");
    expect(ids).toContain("performance-optimize");
    expect(ids).toContain("explain-architecture");
    expect(ids).toContain("daily-task");
    expect(ids).toContain("24h-digest");
  });

  it("filters presets by category", () => {
    const quality = filterPromptPresets(CURATED_PROMPT_PRESETS, { category: "quality" });
    expect(quality.length).toBeGreaterThanOrEqual(3);
    for (const p of quality) {
      expect(p.category).toBe("quality");
    }

    const refactor = filterPromptPresets(CURATED_PROMPT_PRESETS, { category: "refactor" });
    expect(refactor.length).toBeGreaterThanOrEqual(1);
    expect(refactor[0]?.id).toBe("clean-refactor");
  });

  it("filters presets by search query", () => {
    const results = filterPromptPresets(CURATED_PROMPT_PRESETS, { query: "security" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((p: PromptPreset) => p.id === "security-audit")).toBe(true);
  });

  it("returns all presets when category is 'all' and query is empty", () => {
    const results = filterPromptPresets(CURATED_PROMPT_PRESETS, { category: "all", query: "" });
    expect(results.length).toBe(CURATED_PROMPT_PRESETS.length);
  });
});

describe("saved prompt search", () => {
  const entries = [
    { id: "text", title: "Security", prompt: "Audit the queue and handler" },
    { id: "file", prompt: "", files: [{ name: "Release Report.pdf" }] },
    {
      id: "image",
      prompt: "Compare",
      attachments: [{ name: "after.png" }],
      droppedImageNames: ["before.png"],
    },
  ];
  it("matches words across title and prompt and preserves source identity", () => {
    const result = filterSavedPrompts(entries, "  QUEUE   security  ");
    expect(result).toEqual([entries[0]]);
    expect(result[0]).toBe(entries[0]);
    expect(entries).toHaveLength(3);
  });
  it("finds attachment-only entries and names of missing attachments", () => {
    expect(filterSavedPrompts(entries, "report release")).toEqual([entries[1]]);
    expect(filterSavedPrompts(entries, "before.png")).toEqual([entries[2]]);
    expect(filterSavedPrompts(entries, "after.png")).toEqual([entries[2]]);
  });
  it("preserves blank-query order and returns an empty result for unmatched words", () => {
    expect(filterSavedPrompts(entries, "   ")).toBe(entries);
    expect(filterSavedPrompts(entries, "security missingword")).toEqual([]);
  });
  it("normalizes fullwidth input and searches multiline prompts", () => {
    expect(
      filterSavedPrompts([{ prompt: "Review\ntests and queue" }], "ＴＥＳＴＳ queue"),
    ).toHaveLength(1);
  });
});
