/* agent-watermark: model=opus-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-09 */
import type { OrchestrationThread } from "@t3tools/contracts";

/**
 * A thread as a Markdown document someone else can read: what was asked,
 * what the agent ran, what it changed and what it said, turn by turn.
 *
 * Pure: everything comes from the thread's own read model (messages,
 * activities, checkpoints, plans), so web and mobile render the same text.
 * `report` is the full record; `pr` is a pull-request description built from
 * the same facts — the last answer as the summary, the changed files, and the
 * commands that look like checks.
 */
export type ThreadReportFormat = "report" | "pr";

export interface ThreadReportInput {
  readonly thread: Pick<
    OrchestrationThread,
    | "title"
    | "modelSelection"
    | "branch"
    | "worktreePath"
    | "createdAt"
    | "updatedAt"
    | "messages"
    | "activities"
    | "checkpoints"
    | "proposedPlans"
  >;
  readonly projectTitle?: string | null;
  readonly format?: ThreadReportFormat;
  readonly now?: Date;
}

export interface ThreadFileChange {
  readonly path: string;
  readonly kind: string;
  readonly additions: number;
  readonly deletions: number;
}

const CHECK_COMMAND =
  /\b(test|tests|vitest|jest|pytest|unittest|cargo test|go test|typecheck|tsc|lint|eslint|oxlint|ruff|mypy|check|build)\b/i;

/** Files changed across every checkpoint, summed per path; the latest kind wins. */
export function threadFileChanges(
  checkpoints: ThreadReportInput["thread"]["checkpoints"],
): ThreadFileChange[] {
  const byPath = new Map<string, ThreadFileChange>();
  for (const checkpoint of checkpoints) {
    if (checkpoint.status !== "ready") continue;
    for (const file of checkpoint.files) {
      const prior = byPath.get(file.path);
      byPath.set(file.path, {
        path: file.path,
        kind: file.kind,
        additions: (prior?.additions ?? 0) + file.additions,
        deletions: (prior?.deletions ?? 0) + file.deletions,
      });
    }
  }
  return [...byPath.values()].toSorted((a, b) => a.path.localeCompare(b.path));
}

function duration(fromIso: string, toIso: string): string {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 1000) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function quote(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function fileTable(files: ThreadFileChange[]): string[] {
  if (files.length === 0) return ["_No file changes were checkpointed._"];
  const rows = ["| File | Change | + | − |", "| --- | --- | ---: | ---: |"];
  for (const f of files)
    rows.push(`| \`${f.path}\` | ${f.kind} | ${f.additions} | ${f.deletions} |`);
  return rows;
}

interface Turn {
  readonly key: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly prompts: string[];
  readonly answers: string[];
  readonly tools: string[];
  readonly errors: string[];
  readonly approvals: string[];
}

/** Messages and activities grouped by turn, in the order the turns began. */
export function threadTurns(thread: ThreadReportInput["thread"]): Turn[] {
  const turns = new Map<string, Turn>();
  const at = (key: string, iso: string): Turn => {
    const existing = turns.get(key);
    if (existing) {
      const updated: Turn = {
        ...existing,
        startedAt: iso < existing.startedAt ? iso : existing.startedAt,
        endedAt: iso > existing.endedAt ? iso : existing.endedAt,
      };
      turns.set(key, updated);
      return updated;
    }
    const fresh: Turn = {
      key,
      startedAt: iso,
      endedAt: iso,
      prompts: [],
      answers: [],
      tools: [],
      errors: [],
      approvals: [],
    };
    turns.set(key, fresh);
    return fresh;
  };
  // A user message opens the turn its turnId names, or — before the server
  // assigns one — the turn of the next message that carries an id.
  let pendingPrompts: string[] = [];
  for (const message of thread.messages) {
    if (!message.text.trim()) continue;
    if (message.turnId === null) {
      if (message.role === "user") pendingPrompts.push(message.text);
      continue;
    }
    const turn = at(message.turnId, message.createdAt);
    turn.prompts.push(...pendingPrompts);
    pendingPrompts = [];
    if (message.role === "user") turn.prompts.push(message.text);
    else if (message.role === "assistant") turn.answers.push(message.text);
  }
  for (const activity of thread.activities) {
    if (activity.turnId === null) continue;
    const turn = at(activity.turnId, activity.createdAt);
    if (activity.tone === "tool") turn.tools.push(activity.summary);
    else if (activity.tone === "error") turn.errors.push(activity.summary);
    else if (activity.tone === "approval") turn.approvals.push(activity.summary);
  }
  const ordered = [...turns.values()].toSorted((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (pendingPrompts.length) {
    const last = thread.messages.at(-1)?.createdAt ?? thread.updatedAt;
    ordered.push({
      key: "pending",
      startedAt: last,
      endedAt: last,
      prompts: pendingPrompts,
      answers: [],
      tools: [],
      errors: [],
      approvals: [],
    });
  }
  return ordered;
}

function header(input: ThreadReportInput): string[] {
  const { thread } = input;
  const facts = [
    input.projectTitle ? `**Project:** ${input.projectTitle}` : null,
    `**Agent:** ${thread.modelSelection.instanceId} · ${thread.modelSelection.model}`,
    thread.branch ? `**Branch:** \`${thread.branch}\`` : null,
    `**Started:** ${thread.createdAt}`,
    `**Last activity:** ${thread.updatedAt}`,
  ].filter((line): line is string => line !== null);
  return facts.map((line) => `- ${line}`);
}

function fullReport(input: ThreadReportInput): string {
  const { thread } = input;
  const turns = threadTurns(thread);
  const files = threadFileChanges(thread.checkpoints);
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  const tools = turns.reduce((n, t) => n + t.tools.length, 0);
  const errors = turns.reduce((n, t) => n + t.errors.length, 0);
  const lines: string[] = [
    `# ${thread.title}`,
    "",
    ...header(input),
    "",
    `${turns.length} turn${turns.length === 1 ? "" : "s"} · ${tools} tool call${tools === 1 ? "" : "s"} · ${files.length} file${files.length === 1 ? "" : "s"} changed (+${additions} −${deletions})${errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""}`,
    "",
    "## Files changed",
    "",
    ...fileTable(files),
    "",
  ];
  if (thread.proposedPlans.length) {
    lines.push("## Plans", "");
    for (const plan of thread.proposedPlans) {
      lines.push(
        `<details><summary>Plan from ${plan.createdAt}${plan.implementedAt ? " · implemented" : ""}</summary>`,
        "",
        plan.planMarkdown.trim(),
        "",
        "</details>",
        "",
      );
    }
  }
  const loose = thread.activities.filter((a) => a.turnId === null && a.tone === "error");
  if (loose.length) {
    lines.push("## Errors outside a turn", "");
    for (const error of loose)
      lines.push(`- ${error.createdAt.slice(0, 16).replace("T", " ")} — ${error.summary}`);
    lines.push("");
  }
  lines.push("## Turns", "");
  turns.forEach((turn, index) => {
    const took = duration(turn.startedAt, turn.endedAt);
    lines.push(
      `### ${index + 1}. ${turn.startedAt.slice(0, 16).replace("T", " ")}${took ? ` · ${took}` : ""}`,
      "",
    );
    for (const prompt of turn.prompts) lines.push(quote(prompt), "");
    if (turn.tools.length) {
      lines.push(
        `<details><summary>${turn.tools.length} tool call${turn.tools.length === 1 ? "" : "s"}</summary>`,
        "",
      );
      for (const tool of turn.tools) lines.push(`- ${tool.replace(/\n+/g, " ")}`);
      lines.push("", "</details>", "");
    }
    for (const approval of turn.approvals) lines.push(`- Approval: ${approval}`);
    for (const error of turn.errors) lines.push(`- **Error:** ${error}`);
    if (turn.approvals.length || turn.errors.length) lines.push("");
    const answer = turn.answers.at(-1);
    if (answer) lines.push(answer.trim(), "");
    else if (turn.key !== "pending") lines.push("_No answer was recorded for this turn._", "");
  });
  lines.push(
    "---",
    `_Exported from T3 Code${input.now ? ` at ${input.now.toISOString()}` : ""}._`,
    "",
  );
  return lines.join("\n");
}

function prDescription(input: ThreadReportInput): string {
  const { thread } = input;
  const turns = threadTurns(thread);
  const files = threadFileChanges(thread.checkpoints);
  const last = turns
    .flatMap((t) => t.answers)
    .at(-1)
    ?.trim();
  const firstPrompt = turns
    .flatMap((t) => t.prompts)
    .at(0)
    ?.trim();
  const checks = [
    ...new Set(turns.flatMap((t) => t.tools).filter((tool) => CHECK_COMMAND.test(tool))),
  ];
  const lines: string[] = [`## ${thread.title}`, ""];
  if (firstPrompt) lines.push("### Asked", "", quote(firstPrompt.slice(0, 1200)), "");
  lines.push(
    "### Summary",
    "",
    last ? last.slice(0, 4000) : "_The agent has not answered yet._",
    "",
  );
  lines.push("### Changes", "");
  if (files.length) {
    for (const f of files)
      lines.push(`- \`${f.path}\` (${f.kind}, +${f.additions} −${f.deletions})`);
  } else lines.push("_No file changes were checkpointed._");
  lines.push("");
  lines.push("### Verification", "");
  if (checks.length)
    for (const check of checks.slice(0, 12)) lines.push(`- ${check.replace(/\n+/g, " ")}`);
  else lines.push("_No test, lint or build command was recorded in this thread._");
  lines.push(
    "",
    `_Made with ${thread.modelSelection.instanceId} (${thread.modelSelection.model}) in T3 Code._`,
    "",
  );
  return lines.join("\n");
}

export function buildThreadReport(input: ThreadReportInput): string {
  return (input.format ?? "report") === "pr" ? prDescription(input) : fullReport(input);
}

/** A filename-safe slug of the thread title, for the downloaded `.md`. */
export function threadReportFilename(title: string, format: ThreadReportFormat = "report"): string {
  const slug =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 60) || "thread";
  return `${slug}${format === "pr" ? "-pr" : ""}.md`;
}
