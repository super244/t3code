/* agent-watermark: model=opus-5.5; effort=high; duration=65m; seat=claude-code; date=2026-10-05 */
/**
 * Handoff continues a thread on another provider. A thread's provider is fixed
 * once its session starts, so a handoff is a new thread in the same checkout
 * whose first message is a brief built from the source thread.
 *
 * Like race, a handoff needs no storage of its own: the new thread's title
 * starts with `↪ ` and its first message opens with a marker line naming the
 * source thread, which is enough to draw the link both ways.
 */

export const HANDOFF_TITLE_PREFIX = "↪ ";
const HANDOFF_MARKER_PATTERN = /^\[Handoff from thread ([^\]\s]+)\]/;

export const HANDOFF_BRIEF_MAX_CHARS = 14_000;
const MESSAGE_CLIP_CHARS = 1_200;
const FIRST_REQUEST_CLIP_CHARS = 3_000;
const PLAN_CLIP_CHARS = 3_000;
const MAX_CHANGED_FILES = 40;

export interface HandoffMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
}

export interface HandoffChangedFile {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
}

// VCS status counts lines from `git diff`, which never sees untracked files, so a
// new file arrives as +0 −0. Printing that would tell the next agent it is empty.
function hasLineCounts(file: HandoffChangedFile): boolean {
  return file.insertions > 0 || file.deletions > 0;
}

function changedFileLine(file: HandoffChangedFile): string {
  return hasLineCounts(file)
    ? `- \`${file.path}\` +${file.insertions} −${file.deletions}`
    : `- \`${file.path}\` (no line counts: new, binary or mode-only)`;
}

export interface HandoffBriefInput {
  readonly sourceThreadId: string;
  readonly sourceTitle: string;
  /** e.g. "Claude · Sonnet 5.5". */
  readonly sourceAgentLabel: string;
  readonly messages: ReadonlyArray<HandoffMessage>;
  readonly latestPlan?: string | null;
  readonly changedFiles?: ReadonlyArray<HandoffChangedFile> | null;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly lastError?: string | null;
  /** What the user wants the new agent to do next; defaults to finishing the task. */
  readonly note?: string | null;
}

export function buildHandoffTitle(sourceTitle: string): string {
  const base = sourceTitle.startsWith(HANDOFF_TITLE_PREFIX)
    ? sourceTitle.slice(HANDOFF_TITLE_PREFIX.length)
    : sourceTitle;
  return `${HANDOFF_TITLE_PREFIX}${base.trim() || "Handoff"}`;
}

export function isHandoffTitle(title: string): boolean {
  return title.startsWith(HANDOFF_TITLE_PREFIX);
}

/** The thread a handoff brief continues, read from its marker line. */
export function parseHandoffSource(firstMessageText: string | null | undefined): string | null {
  const match = HANDOFF_MARKER_PATTERN.exec((firstMessageText ?? "").trimStart());
  return match ? match[1]! : null;
}

/**
 * When the thread being handed off was itself a handoff, its first message is
 * a brief. Carry that brief's original request forward instead of quoting the
 * whole brief inside the new one.
 */
const CHAINED_NOTE = "(This task has already been handed off before.)";

function originalRequestOf(firstUserText: string, depth = 0): { text: string; chained: boolean } {
  if (depth > 8 || parseHandoffSource(firstUserText) === null) {
    return { text: firstUserText, chained: depth > 0 };
  }
  const match = /## Original request\n([\s\S]*?)(?:\n## |$)/.exec(firstUserText);
  if (!match) return { text: firstUserText, chained: true };
  const unquoted = match[1]!
    .split("\n")
    .filter((line) => line.trim() !== CHAINED_NOTE)
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n")
    .trim();
  // Briefs written before unwrapping existed quote the whole earlier brief.
  return unquoted ? originalRequestOf(unquoted, depth + 1) : { text: firstUserText, chained: true };
}

function clip(text: string, limit: number): string {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit).trimEnd()}… [clipped ${clean.length - limit} chars]`;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

/**
 * Builds the first message of the handoff thread. Sections are dropped from
 * the oldest conversation turns first so the brief always fits the cap and
 * always keeps the original request, the checkout state and the next step.
 */
export function buildHandoffBrief(input: HandoffBriefInput): string {
  const messages = input.messages.filter((message) => message.text.trim().length > 0);
  const firstRequest = messages.find((message) => message.role === "user");
  const rest = firstRequest ? messages.slice(messages.indexOf(firstRequest) + 1) : messages;
  const lastAssistant = messages.toReversed().find((message) => message.role === "assistant");

  const head = [
    `[Handoff from thread ${input.sourceThreadId}]`,
    "",
    `You are taking over a task that another agent (${input.sourceAgentLabel}) was working on in this same checkout, in the thread "${input.sourceTitle}". Continue from where it stopped. Do not start over or undo its work unless it is wrong.`,
  ];

  const original = firstRequest ? originalRequestOf(firstRequest.text) : null;
  const request = original
    ? [
        "",
        "## Original request",
        ...(original.chained ? [CHAINED_NOTE] : []),
        quote(clip(original.text, FIRST_REQUEST_CLIP_CHARS)),
      ]
    : [];

  const plan = input.latestPlan?.trim()
    ? ["", "## Latest plan", clip(input.latestPlan, PLAN_CLIP_CHARS)]
    : [];

  // null means the checkout status was not available, which is not the same as clean.
  const files = input.changedFiles ?? [];
  const checkout: string[] = ["", "## Work already in the checkout"];
  const where = [
    input.branch ? `branch \`${input.branch}\`` : null,
    input.worktreePath ? `worktree \`${input.worktreePath}\`` : null,
  ].filter(Boolean);
  if (where.length > 0) checkout.push(`You are on ${where.join(", ")}.`);
  if (files.length > 0) {
    const insertions = files.reduce((sum, file) => sum + file.insertions, 0);
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
    // A total that silently leaves out new files would understate the work.
    const total = files.every(hasLineCounts) ? ` (+${insertions} −${deletions})` : "";
    checkout.push(
      `${files.length} uncommitted file${files.length === 1 ? "" : "s"} changed${total}:`,
    );
    for (const file of files.slice(0, MAX_CHANGED_FILES)) {
      checkout.push(changedFileLine(file));
    }
    if (files.length > MAX_CHANGED_FILES) {
      checkout.push(`- …and ${files.length - MAX_CHANGED_FILES} more`);
    }
    checkout.push("Inspect them with `git status` and `git diff` before changing anything.");
  } else if (input.changedFiles === null || input.changedFiles === undefined) {
    checkout.push(
      "Check `git status` and `git diff` for the current state before changing anything.",
    );
  } else {
    checkout.push("No uncommitted changes. Check `git log` for anything it committed.");
  }

  const stopped: string[] = ["", "## Where it stopped"];
  if (input.lastError?.trim()) {
    stopped.push(`The previous agent failed with: ${clip(input.lastError, 600)}`);
  }
  if (lastAssistant) {
    stopped.push("Its last message:", quote(clip(lastAssistant.text, MESSAGE_CLIP_CHARS)));
  } else if (!input.lastError?.trim()) {
    stopped.push("It had not replied yet.");
  }

  const next = [
    "",
    "## Your next step",
    input.note?.trim() ||
      "Review the current state, finish the original request, and tell me what you changed and what is left.",
  ];

  const fixed = [...head, ...request, ...plan, ...checkout, ...stopped, ...next];
  const fixedLength = fixed.join("\n").length;

  // The conversation fills whatever room is left, newest turns first.
  const budget = HANDOFF_BRIEF_MAX_CHARS - fixedLength - 200;
  const turns: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const message of rest.toReversed()) {
    if (message === lastAssistant) continue;
    const speaker =
      message.role === "user" ? "User" : message.role === "assistant" ? "Agent" : "System";
    const entry = `**${speaker}:** ${clip(message.text, MESSAGE_CLIP_CHARS)}`;
    if (used + entry.length + 2 > budget) {
      omitted += 1;
      continue;
    }
    turns.unshift(entry);
    used += entry.length + 2;
  }
  const conversation =
    turns.length > 0 || omitted > 0
      ? [
          "",
          "## Conversation so far",
          ...(omitted > 0
            ? [`(${omitted} earlier message${omitted === 1 ? "" : "s"} omitted)`]
            : []),
          ...turns.flatMap((turn) => [turn, ""]),
        ]
      : [];

  const brief = [...head, ...request, ...plan, ...conversation, ...checkout, ...stopped, ...next]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return brief.length > HANDOFF_BRIEF_MAX_CHARS ? clip(brief, HANDOFF_BRIEF_MAX_CHARS) : brief;
}

export interface HandoffThreadLike {
  readonly id: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly title: string;
  readonly worktreePath: string | null;
  readonly createdAt: string;
  readonly archivedAt?: string | null;
}

/**
 * Threads that continue `source`: handoff-titled threads in the same project
 * and checkout, created after it, whose title continues the source's title.
 */
export function findHandoffsFrom<T extends HandoffThreadLike>(
  source: HandoffThreadLike,
  threads: ReadonlyArray<T>,
): T[] {
  const expected = buildHandoffTitle(source.title);
  return threads
    .filter(
      (thread) =>
        thread.id !== source.id &&
        !thread.archivedAt &&
        thread.environmentId === source.environmentId &&
        thread.projectId === source.projectId &&
        thread.worktreePath === source.worktreePath &&
        thread.createdAt >= source.createdAt &&
        thread.title === expected,
    )
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

/* ------------------------------------------------------------------ review */

/**
 * Review is a handoff that reads instead of writes: a second provider looks at
 * the work in the same checkout and reports findings, which can then be sent
 * back to the original thread as a follow-up turn.
 */
export const REVIEW_TITLE_PREFIX = "Review · ";
const REVIEW_MARKER_PATTERN = /^\[Review of thread ([^\]\s]+)\]/;
const FINDINGS_MARKER_PATTERN = /^\[Review findings from thread ([^\]\s]+)\]/;
const FINDINGS_CLIP_CHARS = 8_000;

export function buildReviewTitle(sourceTitle: string): string {
  const base = sourceTitle.replace(/^(↪ |Review · )+/, "").trim();
  return `${REVIEW_TITLE_PREFIX}${base || "Review"}`;
}

export function parseReviewSource(firstMessageText: string | null | undefined): string | null {
  const match = REVIEW_MARKER_PATTERN.exec((firstMessageText ?? "").trimStart());
  return match ? match[1]! : null;
}

/** The review thread whose findings a message carries, if it is a findings turn. */
export function parseFindingsSource(messageText: string | null | undefined): string | null {
  const match = FINDINGS_MARKER_PATTERN.exec((messageText ?? "").trimStart());
  return match ? match[1]! : null;
}

export interface ReviewBriefInput {
  readonly sourceThreadId: string;
  readonly sourceTitle: string;
  readonly sourceAgentLabel: string;
  readonly messages: ReadonlyArray<HandoffMessage>;
  readonly changedFiles?: ReadonlyArray<HandoffChangedFile> | null;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  /** What the reviewer should concentrate on. */
  readonly focus?: string | null;
}

export function buildReviewBrief(input: ReviewBriefInput): string {
  const messages = input.messages.filter((message) => message.text.trim().length > 0);
  const firstRequest = messages.find((message) => message.role === "user");
  const lastAssistant = messages.toReversed().find((message) => message.role === "assistant");
  const original = firstRequest ? originalRequestOf(firstRequest.text) : null;

  const lines = [
    `[Review of thread ${input.sourceThreadId}]`,
    "",
    `Review the work another agent (${input.sourceAgentLabel}) did in this checkout for the thread "${input.sourceTitle}". This is a read-only review: do not edit files, commit, or run commands that change state.`,
  ];
  if (original) {
    lines.push(
      "",
      "## What it was asked to do",
      quote(clip(original.text, FIRST_REQUEST_CLIP_CHARS)),
    );
  }
  if (lastAssistant) {
    lines.push("", "## What it says it did", quote(clip(lastAssistant.text, MESSAGE_CLIP_CHARS)));
  }
  lines.push("", "## Changes to review");
  const where = [
    input.branch ? `branch \`${input.branch}\`` : null,
    input.worktreePath ? `worktree \`${input.worktreePath}\`` : null,
  ].filter(Boolean);
  if (where.length > 0) lines.push(`You are on ${where.join(", ")}.`);
  const files = input.changedFiles;
  if (files && files.length > 0) {
    for (const file of files.slice(0, MAX_CHANGED_FILES)) {
      lines.push(changedFileLine(file));
    }
    if (files.length > MAX_CHANGED_FILES)
      lines.push(`- …and ${files.length - MAX_CHANGED_FILES} more`);
  }
  lines.push(
    "Read the changes with `git status` (new files appear only there), `git diff`, `git diff --staged` and `git log -5 -p` for anything already committed. Run read-only checks (tests, type checks) if they help.",
    "",
    "## Your report",
    "A numbered list of findings, most severe first. For each: severity (blocker, major or minor), `file:line`, what is wrong and why it matters, and the fix. Skip style nits unless they hide a bug. If nothing needs changing, say so plainly.",
  );
  if (input.focus?.trim()) lines.push("", `Focus on: ${input.focus.trim()}`);
  return lines.join("\n").trim();
}

/** The follow-up turn that carries a review's findings back to the original agent. */
export function buildFindingsMessage(input: {
  readonly reviewThreadId: string;
  readonly reviewerLabel: string;
  readonly findings: string;
  /** Set when the review turn errored or was interrupted before finishing. */
  readonly stoppedEarly?: boolean;
}): string {
  return [
    `[Review findings from thread ${input.reviewThreadId}]`,
    "",
    input.stoppedEarly
      ? `Another agent (${input.reviewerLabel}) started reviewing your changes in this checkout but stopped before finishing, so these findings may be incomplete:`
      : `Another agent (${input.reviewerLabel}) reviewed your changes in this checkout. Its findings:`,
    "",
    quote(clip(input.findings, FINDINGS_CLIP_CHARS)),
    "",
    "Fix the findings you agree with, explain any you reject, and tell me what changed.",
  ].join("\n");
}

/** Review threads of `source`: review-titled threads in the same checkout, created after it. */
export function findReviewsOf<T extends HandoffThreadLike>(
  source: HandoffThreadLike,
  threads: ReadonlyArray<T>,
): T[] {
  const expected = buildReviewTitle(source.title);
  return threads
    .filter(
      (thread) =>
        thread.id !== source.id &&
        !thread.archivedAt &&
        thread.environmentId === source.environmentId &&
        thread.projectId === source.projectId &&
        thread.worktreePath === source.worktreePath &&
        thread.createdAt >= source.createdAt &&
        thread.title === expected,
    )
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}
