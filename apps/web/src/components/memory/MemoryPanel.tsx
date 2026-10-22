/* agent-watermark: model=opus-5.5; effort=high; duration=25m; seat=claude-code; date=2026-10-22 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  MEMORY_TEXT_MAX_CHARS,
  type EnvironmentId,
  type MemoryEntry,
  type ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { searchMemory } from "@t3tools/shared/memory";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon, BrainIcon, PencilIcon, Trash2Icon, UserIcon } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { memoryEnvironment } from "../../state/memory";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { RaceSelect } from "../race/RaceComposer";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";

const GLOBAL = "global";

export interface MemoryPanelProject {
  readonly id: ProjectId;
  readonly title: string;
}

function failureMessage(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "The memory server did not answer.";
}

/**
 * Persistent memory on one environment: what every new agent session starts
 * with, who saved it, and the way to add, correct or delete it. With
 * `projectId` it shows that project's memory and global memory (the project
 * home page); without, every project's (Settings → Memory).
 */
export function MemoryPanel({
  environmentId,
  projects,
  projectId = null,
}: {
  environmentId: EnvironmentId;
  projects: ReadonlyArray<MemoryPanelProject>;
  projectId?: ProjectId | null;
}) {
  const list = useEnvironmentQuery(
    memoryEnvironment.list({
      environmentId,
      input: projectId ? { projectId } : {},
    }),
  );
  const [query, setQuery] = useState("");
  const entries = useMemo(() => searchMemory(list.data?.entries ?? [], query), [list.data, query]);
  const projectTitle = useMemo(
    () => new Map(projects.map((project) => [project.id as string, project.title])),
    [projects],
  );

  const groups = useMemo(() => {
    const byKey = new Map<string, MemoryEntry[]>();
    for (const entry of entries) {
      const key = entry.scope === "global" ? GLOBAL : (entry.projectId ?? GLOBAL);
      byKey.set(key, [...(byKey.get(key) ?? []), entry]);
    }
    const keys = [...byKey.keys()].toSorted((left, right) => {
      // The project in focus first, then global, then the others by name.
      const rank = (key: string) => (key === projectId ? 0 : key === GLOBAL ? 1 : 2);
      return (
        rank(left) - rank(right) ||
        (projectTitle.get(left) ?? left).localeCompare(projectTitle.get(right) ?? right)
      );
    });
    return keys.map((key) => ({
      key,
      title:
        key === GLOBAL
          ? "Everywhere"
          : key === projectId
            ? "This project"
            : (projectTitle.get(key) ?? "A removed project"),
      entries: byKey.get(key) ?? [],
    }));
  }, [entries, projectId, projectTitle]);

  const scopeOptions = useMemo(
    () => [
      ...(projectId ? [{ value: projectId as string, label: "This project" }] : []),
      { value: GLOBAL, label: "Everywhere (every project)" },
      ...(projectId
        ? []
        : projects.map((project) => ({ value: project.id as string, label: project.title }))),
    ],
    [projectId, projects],
  );

  const total = list.data?.entries.length ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <MemoryComposer
        environmentId={environmentId}
        scopeOptions={scopeOptions}
        defaultScope={projectId ?? GLOBAL}
      />
      {total > 3 ? (
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search memory"
          aria-label="Search memory"
          className="max-w-sm"
        />
      ) : null}
      {list.error ? (
        <p className="text-sm text-destructive">Memory could not be read: {list.error}</p>
      ) : list.data === null ? (
        <p className="text-sm text-muted-foreground">Reading memory…</p>
      ) : total === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing remembered yet. Agents save facts here with their <code>remember</code> tool, and
          you can add your own above. Every new agent session in{" "}
          {projectId ? "this project" : "a project"} starts with it.
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No memory matches “{query}”.</p>
      ) : (
        groups.map((group) => (
          <section
            key={group.key}
            aria-label={group.title}
            className="flex min-w-0 flex-col gap-1.5"
          >
            <h3 className="text-xs font-medium text-muted-foreground">
              {group.title} <span className="tabular-nums">· {group.entries.length}</span>
            </h3>
            <ul className="flex min-w-0 flex-col divide-y divide-border/60 rounded-xl border border-border/70 bg-card/40">
              {group.entries.map((entry) => (
                <MemoryRow key={entry.id} environmentId={environmentId} entry={entry} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function MemoryComposer({
  environmentId,
  scopeOptions,
  defaultScope,
}: {
  environmentId: EnvironmentId;
  scopeOptions: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  defaultScope: string;
}) {
  const save = useAtomCommand(memoryEnvironment.save, { reportFailure: false });
  const [text, setText] = useState("");
  const [scope, setScope] = useState(defaultScope);
  const [saving, setSaving] = useState(false);
  const trimmed = text.trim();
  const scopeValue = scopeOptions.some((option) => option.value === scope) ? scope : defaultScope;

  async function submit() {
    if (!trimmed || saving) return;
    setSaving(true);
    const result = await save({
      environmentId,
      input:
        scopeValue === GLOBAL
          ? { scope: "global", text: trimmed }
          : { scope: "project", projectId: scopeValue as ProjectId, text: trimmed },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      const message = failureMessage(result);
      if (message)
        toastManager.add({ type: "error", title: "Not remembered", description: message });
      return;
    }
    setText("");
  }

  return (
    <form
      className="flex min-w-0 flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        maxLength={MEMORY_TEXT_MAX_CHARS}
        rows={2}
        placeholder="Something every agent should know, e.g. “Run tests with npm test; never push to main.”"
        aria-label="New memory"
      />
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <div className="w-56 min-w-0">
          <RaceSelect
            ariaLabel="Memory scope"
            value={scopeValue}
            options={scopeOptions}
            onChange={setScope}
          />
        </div>
        <Button type="submit" size="sm" disabled={!trimmed || saving}>
          <BrainIcon /> {saving ? "Saving…" : "Remember"}
        </Button>
      </div>
    </form>
  );
}

function MemoryRow({ environmentId, entry }: { environmentId: EnvironmentId; entry: MemoryEntry }) {
  const navigate = useNavigate();
  const save = useAtomCommand(memoryEnvironment.save, { reportFailure: false });
  const remove = useAtomCommand(memoryEnvironment.remove, { reportFailure: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function commitEdit() {
    const text = draft?.trim();
    if (!text || busy) return;
    if (text === entry.text) {
      setDraft(null);
      return;
    }
    setBusy(true);
    const result = await save({
      environmentId,
      input: {
        id: entry.id,
        scope: entry.scope,
        projectId: entry.projectId,
        text,
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      const message = failureMessage(result);
      if (message) toastManager.add({ type: "error", title: "Not saved", description: message });
      return;
    }
    setDraft(null);
  }

  async function forget() {
    const confirmed =
      (await requestConfirmDialog(`Forget this memory?\n\n${entry.text}`, {
        variant: "destructive",
      })) ?? window.confirm(`Forget this memory?\n\n${entry.text}`);
    if (!confirmed) return;
    setBusy(true);
    const result = await remove({ environmentId, input: { id: entry.id } });
    setBusy(false);
    if (result._tag === "Failure") {
      const message = failureMessage(result);
      if (message)
        toastManager.add({ type: "error", title: "Not forgotten", description: message });
    }
  }

  const SourceIcon = entry.source === "agent" ? BotIcon : UserIcon;
  return (
    <li className="group flex min-w-0 items-start gap-2.5 px-3 py-2.5">
      <SourceIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
      <div className="min-w-0 flex-1">
        {draft === null ? (
          <p className="text-sm whitespace-pre-wrap break-words">{entry.text}</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            <Textarea
              value={draft}
              autoFocus
              rows={2}
              maxLength={MEMORY_TEXT_MAX_CHARS}
              aria-label="Edit memory"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                if (event.key === "Escape") setDraft(null);
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void commitEdit();
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void commitEdit()}>
                Save
              </Button>
            </div>
          </div>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {entry.source === "agent" ? (entry.author ?? "An agent") : "You"}
          {entry.threadId ? (
            <>
              {" · "}
              <button
                type="button"
                className="underline-offset-2 hover:text-foreground hover:underline"
                onClick={() =>
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(
                      scopeThreadRef(environmentId, ThreadId.make(entry.threadId!)),
                    ),
                  })
                }
              >
                from its thread
              </button>
            </>
          ) : null}
          {" · "}
          {formatRelativeTimeLabel(entry.updatedAt)}
        </p>
      </div>
      {draft === null ? (
        <div className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100 focus-within:opacity-100">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Edit memory"
            disabled={busy}
            onClick={() => setDraft(entry.text)}
          >
            <PencilIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Forget memory"
            disabled={busy}
            onClick={() => void forget()}
          >
            <Trash2Icon />
          </Button>
        </div>
      ) : null}
    </li>
  );
}
