/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-03 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=5m; seat=antigravity; date=2026-10-02 */
import { BookmarkIcon, FileIcon, FileTextIcon, SparklesIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import {
  CURATED_PROMPT_PRESETS,
  filterPromptPresets,
  filterSavedPrompts,
  type PromptPresetCategory,
} from "@t3tools/client-runtime/promptPresets";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "~/lib/utils";
import { type PromptStashEntry } from "../../promptStashStore";
import { ComposerBanner } from "./ComposerBanner";

import { promptLibraryKeyAction } from "./promptLibraryKeyboard";

const SNIPPET_MAX_CHARS = 90;

/** Images that did not make it into the entry, whatever the reason. */
function missingImageCount(entry: PromptStashEntry): number {
  return entry.droppedImageNames.length + (entry.unreadableImageNames?.length ?? 0);
}

function stashEntrySnippet(entry: PromptStashEntry): string {
  const trimmed = assistantCitationsToPlainText(entry.prompt).trim().replace(/\s+/g, " ");
  if (trimmed.length > 0) {
    return trimmed.length > SNIPPET_MAX_CHARS ? `${trimmed.slice(0, SNIPPET_MAX_CHARS)}…` : trimmed;
  }
  const imageCount = entry.attachments.length + entry.droppedImageNames.length;
  const fileCount = entry.files?.length ?? 0;
  const attachmentCount = imageCount + fileCount;
  if (attachmentCount === 0) {
    return "(empty)";
  }
  const label = imageCount > 0 && fileCount > 0 ? "attachment" : fileCount > 0 ? "file" : "image";
  return `(${attachmentCount} ${label}${attachmentCount === 1 ? "" : "s"})`;
}

/**
 * Attached banner listing the stashed prompts. Opened by the stash badge or ⌘S
 * when the empty composer cannot restore a single entry. Navigated with arrows,
 * restored with Enter, dismissed with Escape. The listener runs capture-phase
 * on window so it wins over the Lexical editor's handlers while the menu is open.
 */
export const ComposerStashMenu = memo(function ComposerStashMenu(props: {
  entries: ReadonlyArray<PromptStashEntry>;
  stashShortcutLabel: string | null;
  onRestore: (entry: PromptStashEntry) => void;
  onDelete: (entry: PromptStashEntry) => void;
  onClose: () => void;
}) {
  const { entries, stashShortcutLabel, onRestore, onDelete, onClose } = props;
  const drawerRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<"stash" | "presets">(
    entries.length > 0 ? "stash" : "presets",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<PromptPresetCategory | "all">("all");
  const [highlightedId, setHighlightedId] = useState<string | null>(entries[0]?.id ?? null);
  const [highlightedPresetId, setHighlightedPresetId] = useState<string | null>(
    CURATED_PROMPT_PRESETS[0]?.id ?? null,
  );

  const visibleEntries = useMemo(
    () => filterSavedPrompts(entries, searchQuery),
    [entries, searchQuery],
  );
  const visiblePresets = useMemo(
    () =>
      filterPromptPresets(CURATED_PROMPT_PRESETS, {
        category: selectedCategory,
        query: searchQuery,
      }),
    [selectedCategory, searchQuery],
  );

  const highlightedEntry =
    visibleEntries.find((entry) => entry.id === highlightedId) ?? visibleEntries[0];
  const highlightedPreset =
    visiblePresets.find((preset) => preset.id === highlightedPresetId) ?? visiblePresets[0];

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const drawer = drawerRef.current;
      if (
        (drawer && event.composedPath().includes(drawer)) ||
        (event.target instanceof Element &&
          event.target.closest('[data-prompt-stash-badge="true"]'))
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [onClose]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const targetType = target?.closest("[data-prompt-library-search]")
        ? "search"
        : target?.closest("button")
          ? "button"
          : target?.isContentEditable || target?.closest("input,textarea,select")
            ? "editable"
            : "other";
      const action = promptLibraryKeyAction({
        key: event.key,
        isComposing: event.isComposing,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        target: targetType,
      });
      if (action === null) return;
      if (action === "close") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (activeTab === "stash") {
        if (action === "next" || action === "previous") {
          if (visibleEntries.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          const currentIndex = visibleEntries.findIndex(
            (entry) => entry.id === highlightedEntry?.id,
          );
          const offset = action === "next" ? 1 : -1;
          const normalizedIndex = currentIndex >= 0 ? currentIndex : offset === 1 ? -1 : 0;
          const nextIndex =
            (normalizedIndex + offset + visibleEntries.length) % visibleEntries.length;
          setHighlightedId(visibleEntries[nextIndex]?.id ?? null);
          const nextButton =
            drawerRef.current?.querySelectorAll<HTMLButtonElement>("[data-stash-restore]")[
              nextIndex
            ];
          nextButton?.scrollIntoView({ block: "nearest" });
          if (targetType !== "search" && drawerRef.current?.contains(document.activeElement)) {
            nextButton?.focus({ preventScroll: true });
          }
          return;
        }
        if (action === "restore") {
          if (!highlightedEntry) return;
          event.preventDefault();
          event.stopPropagation();
          onRestore(highlightedEntry);
          return;
        }
        if (action === "delete") {
          if (!highlightedEntry) return;
          event.preventDefault();
          event.stopPropagation();
          onDelete(highlightedEntry);
        }
      } else {
        if (action === "next" || action === "previous") {
          if (visiblePresets.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          const currentIndex = visiblePresets.findIndex((p) => p.id === highlightedPreset?.id);
          const offset = action === "next" ? 1 : -1;
          const normalizedIndex = currentIndex >= 0 ? currentIndex : offset === 1 ? -1 : 0;
          const nextIndex =
            (normalizedIndex + offset + visiblePresets.length) % visiblePresets.length;
          setHighlightedPresetId(visiblePresets[nextIndex]?.id ?? null);
          const nextButton =
            drawerRef.current?.querySelectorAll<HTMLButtonElement>("[data-preset-restore]")[
              nextIndex
            ];
          nextButton?.scrollIntoView({ block: "nearest" });
          if (targetType !== "search" && drawerRef.current?.contains(document.activeElement)) {
            nextButton?.focus({ preventScroll: true });
          }
          return;
        }
        if (action === "restore") {
          if (!highlightedPreset) return;
          event.preventDefault();
          event.stopPropagation();
          onRestore({
            id: `preset-${highlightedPreset.id}`,
            createdAt: new Date().toISOString(),
            prompt: highlightedPreset.prompt,
            attachments: [],
            droppedImageNames: [],
            files: [],
          });
          return;
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activeTab,
    visibleEntries,
    highlightedEntry,
    highlightedPreset,
    onClose,
    onDelete,
    onRestore,
    visiblePresets,
  ]);

  return (
    <ComposerBanner.Root ref={drawerRef} data-composer-stash-drawer="true">
      <ComposerBanner.Row render={<div />} className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-stash-tab="stash"
            onClick={() => setActiveTab("stash")}
            className={cn(
              "px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1",
              activeTab === "stash"
                ? "bg-accent text-accent-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <BookmarkIcon className="size-3" />
            Stash ({entries.length})
          </button>
          <button
            type="button"
            data-stash-tab="presets"
            onClick={() => setActiveTab("presets")}
            className={cn(
              "px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1",
              activeTab === "presets"
                ? "bg-accent text-accent-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <SparklesIcon className="size-3 text-primary" />
            Presets ({CURATED_PROMPT_PRESETS.length})
          </button>
        </div>

        <div className="flex items-center gap-1">
          {activeTab === "presets" && (
            <div className="flex items-center gap-1 max-sm:hidden">
              {(["all", "refactor", "quality", "workflow", "exploration"] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] capitalize transition-colors cursor-pointer",
                    selectedCategory === cat
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-label="Close stash menu"
            className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={onClose}
          >
            <ComposerBanner.ToggleIcon expanded />
          </button>
        </div>
      </ComposerBanner.Row>

      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5">
        <input
          type="search"
          data-prompt-library-search
          aria-label={activeTab === "stash" ? "Search saved prompts" : "Search presets"}
          placeholder={
            activeTab === "stash" ? "Search saved prompts and attachments…" : "Search presets…"
          }
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground" role="status">
          {activeTab === "stash" ? visibleEntries.length : visiblePresets.length} results
        </span>
      </div>
      <ComposerBanner.Scroll>
        <ComposerBanner.Children
          render={<ul role="list" />}
          aria-label={activeTab === "stash" ? "Stashed prompts" : "Curated prompt presets"}
        >
          {activeTab === "stash" ? (
            visibleEntries.length === 0 ? (
              <ComposerBanner.Row render={<li />}>
                <ComposerBanner.Icon>
                  <BookmarkIcon />
                </ComposerBanner.Icon>
                <ComposerBanner.Content className="text-muted-foreground">
                  {entries.length === 0
                    ? "Nothing stashed yet."
                    : "No saved prompts match your search."}
                  {entries.length === 0 && stashShortcutLabel
                    ? ` Press ${stashShortcutLabel} with a prompt in the composer to stash it.`
                    : null}
                  <button
                    type="button"
                    onClick={() => setActiveTab("presets")}
                    className="underline text-foreground cursor-pointer ml-1"
                  >
                    Browse presets →
                  </button>
                </ComposerBanner.Content>
              </ComposerBanner.Row>
            ) : (
              visibleEntries.map((entry) => (
                <ComposerBanner.Row
                  render={<li />}
                  key={entry.id}
                  data-stash-entry={entry.id}
                  data-highlighted={highlightedEntry?.id === entry.id || undefined}
                  className={cn(
                    "relative rounded-sm",
                    highlightedEntry?.id === entry.id && "bg-accent text-accent-foreground",
                  )}
                  onMouseMove={() => {
                    if (highlightedId !== entry.id) setHighlightedId(entry.id);
                  }}
                  onFocus={() => setHighlightedId(entry.id)}
                >
                  <ComposerBanner.Icon>
                    <FileTextIcon />
                  </ComposerBanner.Icon>
                  <ComposerBanner.Content>
                    <button
                      type="button"
                      className="min-w-0 flex-1 cursor-pointer truncate text-left text-foreground/80 outline-none before:absolute before:inset-0 before:rounded-sm focus-visible:before:ring-2 focus-visible:before:ring-ring"
                      data-stash-restore={entry.id}
                      aria-label={`Restore stashed prompt: ${stashEntrySnippet(entry)}`}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => onRestore(entry)}
                    >
                      {stashEntrySnippet(entry)}
                    </button>
                  </ComposerBanner.Content>
                  <ComposerBanner.Actions>
                    {entry.pendingImageCount ? (
                      <span className="shrink-0 text-muted-foreground">
                        saving {entry.pendingImageCount} image
                        {entry.pendingImageCount === 1 ? "" : "s"}…
                      </span>
                    ) : missingImageCount(entry) > 0 ? (
                      <span className="shrink-0 text-warning-foreground">
                        {missingImageCount(entry)} image
                        {missingImageCount(entry) === 1 ? "" : "s"} dropped
                      </span>
                    ) : null}
                    {entry.attachments.length > 0 ? (
                      <span className="flex shrink-0 items-center -space-x-1.5">
                        {entry.attachments.slice(0, 3).map((attachment) => (
                          <img
                            key={attachment.id}
                            src={attachment.dataUrl}
                            alt=""
                            aria-hidden="true"
                            className="size-4 rounded border border-border/70 object-cover"
                          />
                        ))}
                      </span>
                    ) : null}
                    {(entry.files?.length ?? 0) > 0 ? (
                      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                        <FileIcon className="size-3" aria-hidden />
                        {entry.files!.length}
                      </span>
                    ) : null}
                    <time
                      dateTime={entry.createdAt}
                      className="shrink-0 text-muted-foreground tabular-nums max-sm:hidden"
                    >
                      {formatRelativeTimeLabel(entry.createdAt)}
                    </time>
                    <ComposerBanner.Dismiss
                      className="z-10"
                      aria-label="Delete stashed prompt"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => onDelete(entry)}
                    />
                  </ComposerBanner.Actions>
                </ComposerBanner.Row>
              ))
            )
          ) : visiblePresets.length === 0 ? (
            <ComposerBanner.Row render={<li />}>
              <ComposerBanner.Content className="text-muted-foreground">
                No presets match this search and category.
              </ComposerBanner.Content>
            </ComposerBanner.Row>
          ) : (
            visiblePresets.map((preset) => (
              <ComposerBanner.Row
                render={<li />}
                key={preset.id}
                data-preset-entry={preset.id}
                data-highlighted={highlightedPreset?.id === preset.id || undefined}
                className={cn(
                  "relative rounded-sm py-1.5",
                  highlightedPreset?.id === preset.id && "bg-accent text-accent-foreground",
                )}
                onMouseMove={() => {
                  if (highlightedPresetId !== preset.id) setHighlightedPresetId(preset.id);
                }}
                onFocus={() => setHighlightedPresetId(preset.id)}
              >
                <ComposerBanner.Icon>
                  <SparklesIcon className="size-3.5 text-primary" />
                </ComposerBanner.Icon>
                <ComposerBanner.Content>
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer text-left outline-none before:absolute before:inset-0 before:rounded-sm focus-visible:before:ring-2 focus-visible:before:ring-ring"
                    data-preset-restore={preset.id}
                    aria-label={`Insert preset: ${preset.title}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() =>
                      onRestore({
                        id: `preset-${preset.id}`,
                        createdAt: new Date().toISOString(),
                        prompt: preset.prompt,
                        attachments: [],
                        droppedImageNames: [],
                        files: [],
                      })
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground text-xs">{preset.title}</span>
                      <span className="text-[9px] uppercase tracking-wider font-mono px-1 py-0.5 rounded bg-muted text-muted-foreground">
                        {preset.category}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {preset.description}
                    </div>
                  </button>
                </ComposerBanner.Content>
              </ComposerBanner.Row>
            ))
          )}
        </ComposerBanner.Children>
      </ComposerBanner.Scroll>
    </ComposerBanner.Root>
  );
});
