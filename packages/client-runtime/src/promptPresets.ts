/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-03 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=5m; seat=antigravity; date=2026-10-02 */
export type PromptPresetCategory = "refactor" | "quality" | "workflow" | "exploration";

export interface PromptPreset {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: PromptPresetCategory;
  readonly prompt: string;
}

export const CURATED_PROMPT_PRESETS: ReadonlyArray<PromptPreset> = [
  {
    id: "clean-refactor",
    title: "Clean & Modernize",
    description: "Refactor legacy or redundant patterns into concise, modern idioms",
    category: "refactor",
    prompt:
      "Review the selected files or module. Identify redundant logic, outdated patterns, and tight coupling. Safely refactor while preserving exact behavior, and verify with tests.",
  },
  {
    id: "unit-tests",
    title: "Comprehensive Unit Tests",
    description: "Generate rigorous tests with boundary conditions and edge cases",
    category: "quality",
    prompt:
      "Write comprehensive unit tests for this functionality. Cover standard cases, edge conditions, invalid inputs, and error handling. Ensure 100% test pass rate.",
  },
  {
    id: "security-audit",
    title: "Security & Vulnerability Audit",
    description: "Audit code for injection, auth bypasses, and sanitization issues",
    category: "quality",
    prompt:
      "Perform a security analysis on this module. Inspect input sanitization, authentication/authorization checks, sensitive data leakage, and dependency risks. Provide concrete patches.",
  },
  {
    id: "performance-optimize",
    title: "Optimize Performance",
    description: "Profile bottlenecks, reduce memory allocations and latency",
    category: "quality",
    prompt:
      "Profile and optimize the performance of this implementation. Identify slow loops, unneeded re-renders, expensive allocations, or blocking I/O, and implement high-efficiency improvements.",
  },
  {
    id: "explain-architecture",
    title: "Architecture & Flow Walkthrough",
    description: "Deep explanation of architectural choices, data flow, and components",
    category: "exploration",
    prompt:
      "Provide an architectural walkthrough of this system. Detail the data flow, lifecycle of requests, state management, key abstractions, and extension points.",
  },
  {
    id: "daily-task",
    title: "Highest-Priority Task",
    description: "Pick and implement the next highest priority item on the roadmap",
    category: "workflow",
    prompt:
      "Inspect the project issue backlog or roadmap. Pick the highest-priority scoped task, design a clean implementation plan, and build it with tests and documentation.",
  },
  {
    id: "24h-digest",
    title: "24-Hour Repo Digest",
    description: "Summarize commits, changes, and active PRs across the last 24h",
    category: "workflow",
    prompt:
      "Analyze git commits, recent branch merges, and PR updates from the last 24 hours. Summarize key achievements, breaking changes, and remaining work.",
  },
];

export function filterPromptPresets(
  presets: ReadonlyArray<PromptPreset>,
  options: {
    readonly category?: PromptPresetCategory | "all";
    readonly query?: string;
  },
): ReadonlyArray<PromptPreset> {
  const terms = searchTerms(options.query ?? "");
  const category = options.category ?? "all";

  return presets.filter((preset) => {
    if (category !== "all" && preset.category !== category) return false;
    return matchesTerms([preset.title, preset.description, preset.prompt, preset.category], terms);
  });
}

interface SearchablePrompt {
  readonly prompt: string;
  readonly title?: string;
  readonly attachments?: ReadonlyArray<{ readonly name: string }>;
  readonly files?: ReadonlyArray<{ readonly name: string }>;
  readonly droppedImageNames?: ReadonlyArray<string>;
  readonly unreadableImageNames?: ReadonlyArray<string>;
}
function searchTerms(query: string): string[] {
  return query.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean);
}
function matchesTerms(fields: readonly string[], terms: readonly string[]): boolean {
  const text = fields.join(" ").normalize("NFKC").toLowerCase();
  return terms.every((term) => text.includes(term));
}
/** Search text and attachment names without changing library order or entry identity. */
export function filterSavedPrompts<T extends SearchablePrompt>(
  entries: readonly T[],
  query: string,
): readonly T[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return entries;
  return entries.filter((entry) =>
    matchesTerms(
      [
        entry.prompt,
        entry.title ?? "",
        ...(entry.attachments ?? []).map((item) => item.name),
        ...(entry.files ?? []).map((item) => item.name),
        ...(entry.droppedImageNames ?? []),
        ...(entry.unreadableImageNames ?? []),
      ],
      terms,
    ),
  );
}
