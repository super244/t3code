/* agent-watermark: model=opus-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-09 */
/* agent-watermark: model=gemini-4-argon; effort=medium; duration=8m; seat=antigravity; date=2026-10-16 */
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

export type ThreadVerificationCategory = "test" | "typecheck" | "lint" | "build" | "check";

export interface ThreadVerificationReceipt {
  readonly category: ThreadVerificationCategory;
  readonly command: string;
  readonly turnId: string | null;
  readonly createdAt: string;
  readonly outcome: "recorded" | "error_in_turn";
}

export type ThreadReadinessStatus = "ready" | "needs_verification" | "blocked";

export interface ThreadReadiness {
  readonly status: ThreadReadinessStatus;
  readonly score: number;
  readonly basis: string;
  readonly reasons: string[];
}

export interface ThreadHandoffBlockers {
  readonly unresolvedErrors: Array<{
    readonly turnId: string | null;
    readonly summary: string;
    readonly createdAt: string;
  }>;
  readonly pendingApprovals: string[];
  readonly unimplementedPlans: Array<{
    readonly id: string;
    readonly createdAt: string;
    readonly preview: string;
  }>;
  readonly missingOrErroredCheckpoints: Array<{
    readonly turnId: string;
    readonly status: string;
  }>;
}

export interface ThreadHandoffBundle {
  readonly schemaVersion: "t3.thread-handoff/1";
  readonly generatedAt: string;
  readonly thread: {
    readonly id: string;
    readonly projectId: string;
    readonly projectTitle: string | null;
    readonly title: string;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly model: {
      readonly instanceId: string;
      readonly model: string;
    };
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly durationSeconds: number;
  };
  readonly summary: {
    readonly firstPrompt: string | null;
    readonly latestAnswer: string | null;
    readonly turnCount: number;
    readonly messageCount: number;
    readonly toolCallCount: number;
    readonly approvalCount: number;
    readonly errorCount: number;
    readonly checkpointCount: number;
  };
  readonly fileChanges: ThreadFileChange[];
  readonly totals: {
    readonly filesChanged: number;
    readonly additions: number;
    readonly deletions: number;
  };
  readonly verification: ThreadVerificationReceipt[];
  readonly blockers: ThreadHandoffBlockers;
  readonly readiness: ThreadReadiness;
}

export type ThreadHandoffThreadInput = ThreadReportInput["thread"] & {
  readonly id?: string;
  readonly projectId?: string;
  readonly latestTurn?: OrchestrationThread["latestTurn"];
  readonly session?: OrchestrationThread["session"];
};

export interface ThreadHandoffOptions {
  readonly projectTitle?: string | null;
  readonly now?: Date;
}

function classifyVerificationCategory(command: string): ThreadVerificationCategory | null {
  if (!CHECK_COMMAND.test(command)) return null;
  if (/\b(typecheck|tsc)\b/i.test(command)) return "typecheck";
  if (/\b(test|tests|vitest|jest|pytest|unittest|cargo test|go test)\b/i.test(command))
    return "test";
  if (/\b(lint|eslint|oxlint|ruff|mypy)\b/i.test(command)) return "lint";
  if (/\b(build)\b/i.test(command)) return "build";
  return "check";
}

function extractActivityCommand(
  activity: ThreadReportInput["thread"]["activities"][number],
): string {
  const summary = activity.summary.trim();
  if (summary) return summary;
  if (
    typeof activity.payload === "object" &&
    activity.payload !== null &&
    "command" in activity.payload &&
    typeof (activity.payload as { command?: unknown }).command === "string"
  ) {
    return ((activity.payload as { command: string }).command ?? "").trim();
  }
  return "";
}

/**
 * Build a deterministic, machine-verifiable Thread Handoff Bundle (`t3.thread-handoff/1`)
 * from an orchestration thread's real turns, checkpoints, tool receipts, and blockers.
 */
export function buildThreadHandoffBundle(
  thread: ThreadHandoffThreadInput,
  options: ThreadHandoffOptions = {},
): ThreadHandoffBundle {
  const turns = threadTurns(thread);
  const fileChanges = threadFileChanges(thread.checkpoints);
  const additions = fileChanges.reduce((sum, f) => sum + f.additions, 0);
  const deletions = fileChanges.reduce((sum, f) => sum + f.deletions, 0);

  const firstPrompt =
    turns
      .flatMap((t) => t.prompts)
      .at(0)
      ?.trim() || null;
  const latestAnswer =
    turns
      .flatMap((t) => t.answers)
      .at(-1)
      ?.trim() || null;

  const toolCallCount = thread.activities.filter((a) => a.tone === "tool").length;
  const approvalCount = thread.activities.filter((a) => a.tone === "approval").length;
  const errorCount = thread.activities.filter((a) => a.tone === "error").length;

  const erroredTurnIds = new Set<string>();
  for (const activity of thread.activities) {
    if (activity.tone === "error" && activity.turnId !== null) {
      erroredTurnIds.add(activity.turnId);
    }
  }
  if (thread.latestTurn?.state === "error" && thread.latestTurn.turnId) {
    erroredTurnIds.add(thread.latestTurn.turnId);
  }

  const verification: ThreadVerificationReceipt[] = [];
  for (const activity of thread.activities) {
    if (activity.tone !== "tool" && activity.kind !== "command") continue;
    const command = extractActivityCommand(activity);
    if (!command) continue;
    const category = classifyVerificationCategory(command);
    if (!category) continue;
    const outcome: ThreadVerificationReceipt["outcome"] =
      activity.turnId !== null && erroredTurnIds.has(activity.turnId)
        ? "error_in_turn"
        : "recorded";
    verification.push({
      category,
      command: command.replace(/\n+/g, " "),
      turnId: activity.turnId,
      createdAt: activity.createdAt,
      outcome,
    });
  }

  // Determine unresolved errors: any loose error (turnId === null) or any error in a turn
  // that was not superseded by a subsequent clean completed turn.
  let lastCleanTurnIndex = -1;
  turns.forEach((turn, idx) => {
    if (
      turn.key !== "pending" &&
      turn.errors.length === 0 &&
      !erroredTurnIds.has(turn.key) &&
      (turn.answers.length > 0 || turn.tools.length > 0)
    ) {
      lastCleanTurnIndex = idx;
    }
  });
  const unresolvedTurnKeys = new Set(
    turns.slice(lastCleanTurnIndex + 1).map((t) => t.key),
  );

  const unresolvedErrors: Array<{
    readonly turnId: string | null;
    readonly summary: string;
    readonly createdAt: string;
  }> = [];
  for (const activity of thread.activities) {
    if (activity.tone !== "error") continue;
    if (activity.turnId === null || unresolvedTurnKeys.has(activity.turnId)) {
      unresolvedErrors.push({
        turnId: activity.turnId,
        summary: activity.summary.trim(),
        createdAt: activity.createdAt,
      });
    }
  }
  if (
    unresolvedErrors.length === 0 &&
    (thread.latestTurn?.state === "error" || thread.session?.status === "error")
  ) {
    unresolvedErrors.push({
      turnId: thread.latestTurn?.turnId ?? null,
      summary:
        thread.session?.lastError?.trim() || "Latest turn or session is in error state",
      createdAt: thread.updatedAt,
    });
  }

  const pendingApprovals = turns
    .filter((t, idx) => idx === turns.length - 1 && t.answers.length === 0)
    .flatMap((t) => t.approvals);

  const unimplementedPlans = thread.proposedPlans
    .filter((plan) => !plan.implementedAt)
    .map((plan) => ({
      id: plan.id,
      createdAt: plan.createdAt,
      preview:
        plan.planMarkdown
          .trim()
          .split("\n")
          .find((line) => line.trim().length > 0)
          ?.replace(/^#+\s*/, "")
          .slice(0, 120) ?? "Proposed plan",
    }));

  const missingOrErroredCheckpoints = thread.checkpoints
    .filter((cp) => cp.status !== "ready")
    .map((cp) => ({
      turnId: cp.turnId,
      status: cp.status,
    }));

  const hasErroredCheckpoint = thread.checkpoints.some((cp) => cp.status === "error");
  const hasTurnOrSessionError =
    thread.latestTurn?.state === "error" || thread.session?.status === "error";

  const reasons: string[] = [];
  let status: ThreadReadinessStatus = "ready";

  if (unresolvedErrors.length > 0 || hasErroredCheckpoint || hasTurnOrSessionError) {
    status = "blocked";
    if (unresolvedErrors.length > 0) {
      reasons.push(
        `${unresolvedErrors.length} unresolved error${unresolvedErrors.length === 1 ? "" : "s"} (${unresolvedErrors[0]!.summary})`,
      );
    }
    if (hasErroredCheckpoint) {
      reasons.push("One or more checkpoints reported status=error");
    }
    if (hasTurnOrSessionError && unresolvedErrors.length === 0) {
      reasons.push("Latest turn or session is in error state");
    }
  } else if (fileChanges.length > 0 && verification.length === 0) {
    status = "needs_verification";
    reasons.push(
      `${fileChanges.length} file${fileChanges.length === 1 ? "" : "s"} modified (+${additions} −${deletions}) with 0 verification commands recorded`,
    );
  }

  if (missingOrErroredCheckpoints.some((cp) => cp.status === "missing")) {
    reasons.push("One or more checkpoints are missing diff refs");
    if (status === "ready") status = "needs_verification";
  }
  if (pendingApprovals.length > 0) {
    reasons.push(
      `${pendingApprovals.length} pending approval${pendingApprovals.length === 1 ? "" : "s"} awaiting operator response`,
    );
    if (status === "ready") status = "needs_verification";
  }
  if (unimplementedPlans.length > 0) {
    reasons.push(
      `${unimplementedPlans.length} proposed plan${unimplementedPlans.length === 1 ? "" : "s"} not yet marked implemented`,
    );
  }
  if (reasons.length === 0) {
    if (fileChanges.length > 0 && verification.length > 0) {
      reasons.push(
        `${fileChanges.length} file${fileChanges.length === 1 ? "" : "s"} checkpointed and ${verification.length} verification command${verification.length === 1 ? "" : "s"} recorded with 0 unresolved errors`,
      );
    } else {
      reasons.push("Clean thread state with 0 unresolved errors");
    }
  }

  let score = 100;
  if (status === "blocked") {
    score = 45;
    if (unresolvedErrors.length > 1) score -= Math.min(20, (unresolvedErrors.length - 1) * 10);
    if (hasErroredCheckpoint) score -= 15;
    score = Math.max(10, Math.min(49, score));
  } else if (status === "needs_verification") {
    score = 70;
    if (fileChanges.length > 0 && verification.length === 0) score -= 5;
    if (missingOrErroredCheckpoints.length > 0) score -= 10;
    if (pendingApprovals.length > 0) score -= 5;
    score = Math.max(50, Math.min(79, score));
  } else {
    score = 100;
    if (unimplementedPlans.length > 0) score -= 8;
    if (turns.length === 0) score -= 10;
    score = Math.max(80, Math.min(100, score));
  }

  const basis = `Derived from ${turns.length} turn${turns.length === 1 ? "" : "s"}, ${fileChanges.length} changed file${fileChanges.length === 1 ? "" : "s"}, ${verification.length} verification command${verification.length === 1 ? "" : "s"}, ${unresolvedErrors.length} unresolved error${unresolvedErrors.length === 1 ? "" : "s"}, and ${thread.checkpoints.length} checkpoint${thread.checkpoints.length === 1 ? "" : "s"}`;

  const durationMs = Date.parse(thread.updatedAt) - Date.parse(thread.createdAt);
  const durationSeconds =
    Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 1000) : 0;

  return {
    schemaVersion: "t3.thread-handoff/1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    thread: {
      id: thread.id ?? "thread",
      projectId: thread.projectId ?? "project",
      projectTitle: options.projectTitle ?? null,
      title: thread.title,
      branch: thread.branch ?? null,
      worktreePath: thread.worktreePath ?? null,
      model: {
        instanceId: thread.modelSelection.instanceId,
        model: thread.modelSelection.model,
      },
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      durationSeconds,
    },
    summary: {
      firstPrompt,
      latestAnswer,
      turnCount: turns.length,
      messageCount: thread.messages.length,
      toolCallCount,
      approvalCount,
      errorCount,
      checkpointCount: thread.checkpoints.length,
    },
    fileChanges,
    totals: {
      filesChanged: fileChanges.length,
      additions,
      deletions,
    },
    verification,
    blockers: {
      unresolvedErrors,
      pendingApprovals,
      unimplementedPlans,
      missingOrErroredCheckpoints,
    },
    readiness: {
      status,
      score,
      basis,
      reasons,
    },
  };
}

/**
 * Format a `ThreadHandoffBundle` into a compact, high-density operator handoff receipt
 * Markdown document with an embedded machine-readable `t3.thread-handoff/1` JSON block.
 */
export function formatThreadHandoffMarkdown(bundle: ThreadHandoffBundle): string {
  const badgeLabel =
    bundle.readiness.status === "ready"
      ? "READY"
      : bundle.readiness.status === "needs_verification"
        ? "NEEDS VERIFICATION"
        : "BLOCKED";

  const lines: string[] = [
    `# Thread Handoff Receipt: ${bundle.thread.title}`,
    "",
    `- **Readiness:** \`${badgeLabel}\` (${bundle.readiness.score}/100) — ${bundle.readiness.basis}`,
    bundle.thread.projectTitle ? `- **Project:** ${bundle.thread.projectTitle}` : null,
    `- **Agent:** ${bundle.thread.model.instanceId} · ${bundle.thread.model.model}`,
    bundle.thread.branch ? `- **Branch:** \`${bundle.thread.branch}\`` : null,
    bundle.thread.worktreePath ? `- **Worktree:** \`${bundle.thread.worktreePath}\`` : null,
    `- **Telemetry:** ${bundle.summary.turnCount} turn${bundle.summary.turnCount === 1 ? "" : "s"} · ${bundle.summary.toolCallCount} tool call${bundle.summary.toolCallCount === 1 ? "" : "s"} · ${bundle.totals.filesChanged} file${bundle.totals.filesChanged === 1 ? "" : "s"} (+${bundle.totals.additions} −${bundle.totals.deletions}) · ${bundle.verification.length} check${bundle.verification.length === 1 ? "" : "s"}`,
    "",
  ].filter((line): line is string => line !== null);

  if (bundle.summary.firstPrompt) {
    lines.push("## Objective", "", quote(bundle.summary.firstPrompt.slice(0, 1200)), "");
  }

  lines.push(
    "## Latest Outcome",
    "",
    bundle.summary.latestAnswer
      ? bundle.summary.latestAnswer.slice(0, 4000)
      : "_No final assistant response recorded yet._",
    "",
  );

  lines.push("## Readiness & Blockers", "");
  for (const reason of bundle.readiness.reasons) {
    lines.push(`- ${reason}`);
  }
  for (const err of bundle.blockers.unresolvedErrors) {
    lines.push(
      `- **Unresolved Error${err.turnId ? ` (${err.turnId})` : ""}:** ${err.summary}`,
    );
  }
  for (const approval of bundle.blockers.pendingApprovals) {
    lines.push(`- **Pending Approval:** ${approval}`);
  }
  for (const plan of bundle.blockers.unimplementedPlans) {
    lines.push(`- **Unimplemented Plan (${plan.id}):** ${plan.preview}`);
  }
  for (const cp of bundle.blockers.missingOrErroredCheckpoints) {
    lines.push(`- **Checkpoint (${cp.turnId}):** status=${cp.status}`);
  }
  lines.push("");

  lines.push("## File Changes", "", ...fileTable(bundle.fileChanges), "");

  lines.push("## Verification Receipts", "");
  if (bundle.verification.length > 0) {
    for (const receipt of bundle.verification) {
      const box = receipt.outcome === "recorded" ? "[x]" : "[!]";
      lines.push(
        `- ${box} \`[${receipt.category}]\` \`${receipt.command}\`${receipt.outcome === "error_in_turn" ? " _(error in turn)_" : ""}`,
      );
    }
  } else {
    lines.push("_No test, typecheck, lint, or build command was recorded in this thread._");
  }
  lines.push("");

  lines.push(
    "<details><summary>Machine-Readable Handoff JSON (t3.thread-handoff/1)</summary>",
    "",
    "```json",
    JSON.stringify(bundle, null, 2),
    "```",
    "",
    "</details>",
    "",
  );

  return lines.join("\n");
}

/** Filename-safe slug for exported handoff `.json` or `.md` artifacts. */
export function threadHandoffFilename(title: string, format: "json" | "md" = "json"): string {
  const slug =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 60) || "thread";
  return `${slug}-handoff.${format}`;
}

