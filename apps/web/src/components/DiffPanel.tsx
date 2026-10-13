/* agent-watermark: model=muse-spark; effort=high; duration=50m; seat=opencode; date=2026-10-07 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=10m; seat=antigravity; date=2026-10-03 */
/* agent-watermark: model=haiku-5.5; effort=high; duration=45m; seat=claude-code; date=2026-10-12 */
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useAtomValue } from "@effect/atom-react";
import type { FileDiffContentsLoader, FileDiffMetadata } from "@pierre/diffs";
import { useParams } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  CopyIcon,
  FolderTreeIcon,
  PilcrowIcon,
  Rows3Icon,
  SearchIcon,
  TextWrapIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCodeViewFileReveal } from "./diffs/useCodeViewFileReveal";
import { useOpenInPreferredEditor } from "../editorPreferences";
import { type DraftId } from "../composerDraftStore";
import { openDiffFilePrimaryAction } from "../diffFileActions";
import { useCheckpointDiff } from "~/lib/checkpointDiffState";
import { cn } from "~/lib/utils";
import { selectThreadDiffPanelSelection, useDiffPanelStore } from "../diffPanelStore";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useTheme } from "../hooks/useTheme";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  getDiffCollapseIconClassName,
  getDiffLineStat,
  getSingleFileDiffLineStat,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import { PREFERRED_HIGHLIGHTER, warmSyntaxHighlighterCache } from "../lib/syntaxHighlighting";
import { areAllDiffFilesCollapsed, toggleAllDiffFiles } from "../lib/diffCollapse";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
} from "./ui/anchoredCopyToast";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useWorkspaceMutationRefresh } from "../hooks/useWorkspaceMutationRefresh";
import { useProject, useThread } from "../state/entities";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useClientSettings, useUpdateClientSettings } from "../hooks/useSettings";
import { formatShortTimestamp } from "../timestampFormat";
import { DiffFilePathCopyButton } from "./DiffFilePathCopyButton";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { DiffStatLabel } from "./chat/DiffStatLabel";
import { AnnotatableCodeView, type AnnotatableCodeViewHandle } from "./diffs/AnnotatableCodeView";
import { DiffChangesTree } from "./diffs/DiffChangesTree";
import {
  buildDiffChangeEntries,
  buildDiffHunkAnchors,
  type DiffChangeEntry,
  diffViewedStorageKey,
  stepDiffFile,
  stepDiffHunk,
} from "./diffs/diffChangesTree.logic";
import { useDiffViewedFiles } from "./diffs/useDiffViewedFiles";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { Button } from "./ui/button";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "./ui/sheet";
import { ToggleGroup, Toggle } from "./ui/toggle-group";
import { Switch } from "./ui/switch";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "./ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { serverEnvironment } from "../state/server";
import { reviewEnvironment } from "../state/review";
import { vcsEnvironment } from "../state/vcs";
import { buildBaseRefChoices, filterBaseRefChoices } from "../lib/baseRefChoices";
import { createGitDiffFileContentsLoader } from "../lib/diffFileContents";

type DiffThemeType = "light" | "dark";
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"]';
const TEXT_ENTRY_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

const DIFF_KEYBOARD_SURFACE_SELECTOR = '[data-keyboard-surface="diff"]';

// Bare keys are the diff's only while focus sits inside the diff. Text fields and open menus
// keep their own keys.
function isDiffKeyboardBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(DIFF_KEYBOARD_SURFACE_SELECTOR) === null) return true;
  return target.closest(TEXT_ENTRY_SELECTOR) !== null || target.closest(OVERLAY_SELECTOR) !== null;
}
const AUTOMATIC_BASE_REF = "__automatic_base_ref__";
const DIFF_FILE_TREE_STORAGE_KEY = "t3code.diffFileTreeOpen";

interface CollapsedDiffFilesState {
  readonly scopeKey: string | null;
  readonly fileKeys: ReadonlySet<string>;
}

const EMPTY_COLLAPSED_DIFF_FILE_KEYS: ReadonlySet<string> = new Set();

interface DiffPanelProps {
  mode?: DiffPanelMode;
  composerDraftTarget: ScopedThreadRef | DraftId;
  initialGitScope: "branch" | "unstaged";
  workspaceMutationId: string | null;
}

export default function DiffPanel({
  mode = "inline",
  composerDraftTarget,
  initialGitScope: initialGitScopeProp,
  workspaceMutationId,
}: DiffPanelProps) {
  const { resolvedTheme } = useTheme();
  const isPhoneViewport = useMediaQuery("max-sm");
  const settings = useClientSettings();
  const [initialGitScope] = useState(initialGitScopeProp);
  const diffLayout = settings.diffLayout;
  const updateClientSettings = useUpdateClientSettings();
  const [wordWrap, setWordWrap] = useState(settings.wordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const [fileTreeOpen, setFileTreeOpen] = useLocalStorage(
    DIFF_FILE_TREE_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [baseRefQuery, setBaseRefQuery] = useState("");
  // The file the reader is on: moved by the file list, the j/k keys, and hunk navigation.
  const [focusedFilePath, setFocusedFilePath] = useState<string | null>(null);
  // Index into the diff's hunks for the n-style hunk keys; -1 before the first jump.
  const [hunkCursor, setHunkCursor] = useState(-1);
  const [phoneFilesOpen, setPhoneFilesOpen] = useState(false);
  const [collapsedDiffFiles, setCollapsedDiffFiles] = useState<CollapsedDiffFilesState>(() => ({
    scopeKey: null,
    fileKeys: EMPTY_COLLAPSED_DIFF_FILE_KEYS,
  }));
  const [codeViewRevision, setCodeViewRevision] = useState(0);
  const [codeView, setCodeView] = useState<AnnotatableCodeViewHandle | null>(null);

  useEffect(() => {
    warmSyntaxHighlighterCache();
  }, []);

  const copyPatchButtonRef = useRef<HTMLButtonElement>(null);
  const { copyToClipboard: copyPatchToClipboard, isCopied: isPatchCopied } =
    useCopyToClipboard<void>({
      onCopy: () => showAnchoredCopySuccessToast(copyPatchButtonRef),
      onError: (error) => showAnchoredCopyErrorToast(copyPatchButtonRef, error),
      timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
    });

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const activeThread = useThread(routeThreadRef);
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useProject(
    activeThread && activeProjectId
      ? {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        }
      : null,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.workspaceRoot;
  const activeRepositoryRoot = activeThread?.worktreePath
    ? undefined
    : activeProject?.repositoryIdentity?.rootPath;
  const serverConfig = useAtomValue(
    serverEnvironment.configValueAtom(activeThread?.environmentId ?? null),
  );
  const openInPreferredEditor = useOpenInPreferredEditor(
    activeThread?.environmentId ?? null,
    serverConfig?.availableEditors ?? [],
  );
  const getDiffFileContents = useAtomCommand(reviewEnvironment.diffFileContents);
  const gitStatusQuery = useEnvironmentQuery(
    activeThread !== null && activeThread !== undefined && activeCwd != null
      ? vcsEnvironment.status({
          environmentId: activeThread.environmentId,
          input: { cwd: activeCwd },
        })
      : null,
  );
  const diffSelection = useDiffPanelStore((state) =>
    selectThreadDiffPanelSelection(
      state.byThreadKey,
      routeThreadRef,
      initialGitScope === "unstaged",
    ),
  );
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  useEffect(() => {
    if (!routeThreadRef || diffSelection.kind !== "turn") return;
    useDiffPanelStore.getState().reconcileTurnSelection(
      routeThreadRef,
      orderedTurnDiffSummaries.map((summary) => summary.turnId),
    );
  }, [diffSelection, orderedTurnDiffSummaries, routeThreadRef]);

  const selectedTurnId = diffSelection.kind === "turn" ? diffSelection.turnId : null;
  const selectedGitScope = diffSelection.kind === "unstaged" ? "unstaged" : "branch";
  const selectedBaseRef = diffSelection.kind === "branch" ? diffSelection.baseRef : null;
  const selectedFilePath = diffSelection.kind === "turn" ? diffSelection.filePath : null;
  const selectedFileRevealRequestId =
    diffSelection.kind === "turn" ? diffSelection.revealRequestId : 0;
  // A new reveal from the chat's changed-files list moves focus to its file.
  const [seenRevealRequestId, setSeenRevealRequestId] = useState(selectedFileRevealRequestId);
  if (seenRevealRequestId !== selectedFileRevealRequestId) {
    setSeenRevealRequestId(selectedFileRevealRequestId);
    setFocusedFilePath(selectedFilePath);
  }
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0]);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const latestTurn = orderedTurnDiffSummaries[0];
  const selectedScopeLabel =
    selectedTurnId === null
      ? selectedGitScope === "unstaged"
        ? "Working tree"
        : "Branch changes"
      : selectedTurn?.turnId === latestTurn?.turnId
        ? "Latest turn"
        : `Turn ${selectedCheckpointTurnCount ?? "?"}`;
  const reviewSectionId = selectedTurn ? `turn:${selectedTurn.turnId}` : selectedGitScope;
  const collapseScopeKey = routeThreadRef
    ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}:${reviewSectionId}`
    : null;
  const codeViewMountKey = `${collapseScopeKey ?? reviewSectionId}:${codeViewRevision}`;
  const collapsedDiffFileKeys =
    collapsedDiffFiles.scopeKey === collapseScopeKey
      ? collapsedDiffFiles.fileKeys
      : EMPTY_COLLAPSED_DIFF_FILE_KEYS;
  const reviewSectionTitle = selectedTurn
    ? `Turn ${selectedCheckpointTurnCount ?? "?"}`
    : selectedGitScope === "unstaged"
      ? "Working tree"
      : "Branch changes";
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const activeCheckpointDiff = useCheckpointDiff(
    {
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: selectedCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: selectedCheckpointRange?.toTurnCount ?? null,
      ignoreWhitespace: diffIgnoreWhitespace,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : null,
    },
    { enabled: isGitRepo && selectedTurn !== undefined },
  );
  const primaryBranchDiffPreview = useEnvironmentQuery(
    selectedTurnId === null && activeThread && activeCwd
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: {
            cwd: activeCwd,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ignoreWhitespace: diffIgnoreWhitespace,
          },
        })
      : null,
  );
  const shouldRetryBranchDiffAtEnvironmentCwd =
    selectedTurnId === null &&
    primaryBranchDiffPreview.error?.includes("configured workspace root") === true &&
    serverConfig?.cwd !== undefined &&
    serverConfig.cwd !== activeCwd;
  const fallbackBranchDiffPreview = useEnvironmentQuery(
    shouldRetryBranchDiffAtEnvironmentCwd && activeThread && serverConfig
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: {
            cwd: serverConfig.cwd,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ignoreWhitespace: diffIgnoreWhitespace,
          },
        })
      : null,
  );
  const branchDiffPreview = shouldRetryBranchDiffAtEnvironmentCwd
    ? fallbackBranchDiffPreview
    : primaryBranchDiffPreview;
  const refreshBranchDiffPreview = branchDiffPreview.refresh;
  const canRefreshGitDiff =
    isGitRepo && selectedTurnId === null && activeThread != null && activeCwd != null;
  const activeThreadRefreshKey = routeThreadRef
    ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}`
    : null;

  useEffect(() => {
    if (!canRefreshGitDiff) return;
    const refreshOnFocus = () => refreshBranchDiffPreview();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [canRefreshGitDiff, refreshBranchDiffPreview]);

  useWorkspaceMutationRefresh({
    enabled: canRefreshGitDiff,
    mutationId: workspaceMutationId,
    refresh: refreshBranchDiffPreview,
    resourceKey: `diff:${activeThreadRefreshKey ?? ""}`,
  });

  const selectedGitSource = branchDiffPreview.data?.sources.find(
    (source) => source.kind === (selectedGitScope === "unstaged" ? "working-tree" : "branch-range"),
  );
  const currentLoadDiffFiles = useMemo<FileDiffContentsLoader | undefined>(() => {
    const preview = branchDiffPreview.data;
    if (selectedTurnId !== null || !activeThread || !preview || !selectedGitSource) {
      return undefined;
    }

    return createGitDiffFileContentsLoader(getDiffFileContents, {
      environmentId: activeThread.environmentId,
      cwd: preview.cwd,
      sourceKind: selectedGitSource.kind,
      baseRef: selectedGitSource.baseRef,
      headRef: selectedGitSource.headRef,
      cacheKey: selectedGitSource.diffHash,
    });
  }, [
    activeThread,
    branchDiffPreview.data,
    getDiffFileContents,
    selectedGitSource,
    selectedTurnId,
  ]);
  const loadDiffFilesRef = useRef(currentLoadDiffFiles);
  loadDiffFilesRef.current = currentLoadDiffFiles;
  const loadDiffFiles = useCallback<FileDiffContentsLoader>(async (fileDiff) => {
    const loader = loadDiffFilesRef.current;
    if (!loader) throw new Error("Diff file contents are unavailable for this selection.");
    return loader(fileDiff);
  }, []);
  const localBranchRefs = useEnvironmentQuery(
    selectedTurnId === null &&
      selectedGitScope === "branch" &&
      activeThread &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "local",
            ...(baseRefQuery.trim().length > 0 ? { query: baseRefQuery.trim() } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const remoteBranchRefs = useEnvironmentQuery(
    selectedTurnId === null &&
      selectedGitScope === "branch" &&
      activeThread &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "remote",
            ...(baseRefQuery.trim().length > 0 ? { query: baseRefQuery.trim() } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const baseRefChoices = buildBaseRefChoices(
    localBranchRefs.data?.refs.filter((ref) => ref.name !== selectedGitSource?.headRef) ?? [],
    remoteBranchRefs.data?.refs ?? [],
  );
  const matchingBaseRefChoices = filterBaseRefChoices(baseRefChoices, baseRefQuery);
  const valueForBaseRefChoice = (choice: (typeof baseRefChoices)[number]) =>
    selectedBaseRef && selectedBaseRef === choice.remote?.name
      ? selectedBaseRef
      : (choice.local?.name ?? choice.remote?.name ?? choice.id);
  const baseRefItems = [AUTOMATIC_BASE_REF, ...baseRefChoices.map(valueForBaseRefChoice)];
  const filteredBaseRefItems = [
    ...(baseRefQuery.trim().length === 0 ? [AUTOMATIC_BASE_REF] : []),
    ...matchingBaseRefChoices.map(valueForBaseRefChoice),
  ];
  const gitDiff = selectedGitSource?.diff;

  const selectedPatch = selectedTurn ? activeCheckpointDiff.data?.diff : gitDiff;
  const isSelectedPatchTruncated = !selectedTurn && selectedGitSource?.truncated === true;
  const isLoadingSelectedPatch = selectedTurn
    ? activeCheckpointDiff.isPending
    : branchDiffPreview.isPending;
  const selectedPatchError = selectedTurn ? activeCheckpointDiff.error : branchDiffPreview.error;
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const renderablePatch = useMemo(
    () =>
      getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`, {
        compactPartialHunkOffsets: selectedTurnId === null,
      }),
    [resolvedTheme, selectedPatch, selectedTurnId],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);
  const renderableFileEntries = useMemo(
    () =>
      renderableFiles.map((fileDiff) => ({
        fileDiff,
        fileKey: buildFileDiffIdentityKey(fileDiff),
        fileVersion: buildFileDiffContentVersion(fileDiff),
      })),
    [renderableFiles],
  );
  const codeViewFiles = useMemo(
    () =>
      renderableFileEntries.map(({ fileDiff, fileKey, fileVersion }) => {
        return {
          fileDiff,
          filePath: resolveFileDiffPath(fileDiff),
          fileKey,
          fileVersion,
          collapsed: collapsedDiffFileKeys.has(fileKey),
        };
      }),
    [collapsedDiffFileKeys, renderableFileEntries],
  );
  const diffFileKeys = useMemo(() => codeViewFiles.map((file) => file.fileKey), [codeViewFiles]);
  const allDiffFilesCollapsed = areAllDiffFilesCollapsed(diffFileKeys, collapsedDiffFileKeys);
  const diffLineStat = useMemo(() => getDiffLineStat(renderableFiles), [renderableFiles]);
  const changeEntries = useMemo(() => buildDiffChangeEntries(renderableFiles), [renderableFiles]);
  const changeEntriesByKey = useMemo(
    () => new Map(changeEntries.map((entry) => [entry.key, entry])),
    [changeEntries],
  );
  const hunkAnchors = useMemo(() => buildDiffHunkAnchors(renderableFiles), [renderableFiles]);
  const { isViewed, setViewed } = useDiffViewedFiles(
    routeThreadRef
      ? diffViewedStorageKey(routeThreadRef.environmentId, routeThreadRef.threadId)
      : null,
  );
  const treeSelectedPath = focusedFilePath ?? selectedFilePath;
  const selectedDiffFileKey = selectedFilePath
    ? (codeViewFiles.find((candidate) => candidate.filePath === selectedFilePath)?.fileKey ?? null)
    : null;

  useEffect(() => {
    if (!selectedDiffFileKey || !codeView?.getInstance()) return;
    codeView.scrollTo({ type: "item", id: selectedDiffFileKey, align: "start" });
  }, [codeView, codeViewMountKey, selectedDiffFileKey, selectedFileRevealRequestId]);

  const treeRevealScope = useMemo(
    () => ({ collapseScopeKey, diffSelection }),
    [collapseScopeKey, diffSelection],
  );
  const requestTreeReveal = useCodeViewFileReveal(codeView, treeRevealScope);
  const revealDiffFile = useCallback(
    (filePath: string) => {
      const file = codeViewFiles.find((candidate) => candidate.filePath === filePath);
      if (!file) return;
      if (file.collapsed) {
        setCollapsedDiffFiles((current) => {
          const next = new Set(current.scopeKey === collapseScopeKey ? current.fileKeys : []);
          next.delete(file.fileKey);
          return { scopeKey: collapseScopeKey, fileKeys: next };
        });
      }
      requestTreeReveal(file.fileKey);
    },
    [codeViewFiles, collapseScopeKey, requestTreeReveal],
  );

  const setDiffFileCollapsed = useCallback(
    (fileKey: string, collapsed: boolean) => {
      setCollapsedDiffFiles((current) => {
        const base =
          current.scopeKey === collapseScopeKey ? current.fileKeys : EMPTY_COLLAPSED_DIFF_FILE_KEYS;
        if (base.has(fileKey) === collapsed) return current;
        const next = new Set(base);
        if (collapsed) {
          next.add(fileKey);
        } else {
          next.delete(fileKey);
        }
        return { scopeKey: collapseScopeKey, fileKeys: next };
      });
    },
    [collapseScopeKey],
  );

  const focusDiffFile = useCallback(
    (filePath: string) => {
      setFocusedFilePath(filePath);
      setHunkCursor(hunkAnchors.findIndex((anchor) => anchor.filePath === filePath));
      revealDiffFile(filePath);
      const file = codeViewFiles.find((candidate) => candidate.filePath === filePath);
      if (file) {
        requestAnimationFrame(() => {
          if (!codeView?.getInstance()) return;
          codeView.scrollTo({ type: "item", id: file.fileKey, align: "start" });
        });
      }
    },
    [codeView, codeViewFiles, hunkAnchors, revealDiffFile],
  );

  const stepFile = useCallback(
    (step: 1 | -1) => {
      const next = stepDiffFile(changeEntries, treeSelectedPath, step);
      if (next) focusDiffFile(next.path);
    },
    [changeEntries, focusDiffFile, treeSelectedPath],
  );

  const stepHunk = useCallback(
    (step: 1 | -1) => {
      const nextIndex = stepDiffHunk(hunkAnchors.length, hunkCursor, step);
      const anchor = hunkAnchors[nextIndex];
      if (!anchor) return;
      setHunkCursor(nextIndex);
      setFocusedFilePath(anchor.filePath);
      setDiffFileCollapsed(anchor.fileKey, false);
      // A file that was collapsed has no rows until this render commits, so the line
      // target waits one frame.
      requestAnimationFrame(() => {
        if (!codeView?.getInstance()) return;
        codeView.scrollTo({
          type: "line",
          id: anchor.fileKey,
          lineNumber: anchor.lineNumber,
          side: anchor.side,
          align: "start",
        });
      });
    },
    [codeView, hunkAnchors, hunkCursor, setDiffFileCollapsed],
  );

  // Viewing a file folds it away, the way a review tool does; editing it again clears the mark.
  const markFileViewed = useCallback(
    (entry: DiffChangeEntry, viewed: boolean) => {
      setViewed(changeEntries, entry, viewed);
      if (viewed) setDiffFileCollapsed(entry.key, true);
    },
    [changeEntries, setDiffFileCollapsed, setViewed],
  );

  useEffect(() => {
    if (renderablePatch?.kind !== "files") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      // Only keys pressed inside the diff are the diff's. Elsewhere, letters still belong to the
      // composer, and a focused field or open menu keeps them too.
      if (event.shiftKey || isDiffKeyboardBlocked(event.target)) return;
      switch (event.key) {
        case "j":
          stepFile(1);
          break;
        case "k":
          stepFile(-1);
          break;
        case "]":
          stepHunk(1);
          break;
        case "[":
          stepHunk(-1);
          break;
        case "v": {
          const entry = changeEntries.find((candidate) => candidate.path === treeSelectedPath);
          if (!entry) return;
          markFileViewed(entry, !isViewed(entry));
          break;
        }
        default:
          return;
      }
      event.preventDefault();
    };
    // Capture phase: the code view handles keys on its own surface and would otherwise
    // stop them before they reach the window.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    changeEntries,
    isViewed,
    markFileViewed,
    renderablePatch,
    stepFile,
    stepHunk,
    treeSelectedPath,
  ]);

  const openDiffFile = useCallback(
    (filePath: string) => {
      openDiffFilePrimaryAction({
        threadRef: routeThreadRef,
        filePath,
        activeCwd,
        repositoryRoot: activeRepositoryRoot,
        openInEditor: (targetPath) => {
          void (async () => {
            const result = await openInPreferredEditor(targetPath);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              console.warn("Failed to open diff file in editor.", {
                operation: "open-diff-file",
                ...(routeThreadRef
                  ? {
                      environmentId: routeThreadRef.environmentId,
                      threadId: routeThreadRef.threadId,
                    }
                  : {}),
                ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
              });
            }
          })();
        },
      });
    },
    [activeCwd, activeRepositoryRoot, openInPreferredEditor, routeThreadRef],
  );
  const toggleDiffFileCollapsed = useCallback(
    (fileKey: string) => {
      setCollapsedDiffFiles((current) => {
        const next = new Set(current.scopeKey === collapseScopeKey ? current.fileKeys : []);
        if (next.has(fileKey)) {
          next.delete(fileKey);
        } else {
          next.add(fileKey);
        }
        return { scopeKey: collapseScopeKey, fileKeys: next };
      });
    },
    [collapseScopeKey],
  );

  const toggleDiffFileCollapse = useCallback(() => {
    setCodeViewRevision((current) => current + 1);
    setCollapsedDiffFiles((current) => {
      const currentKeys =
        current.scopeKey === collapseScopeKey ? current.fileKeys : EMPTY_COLLAPSED_DIFF_FILE_KEYS;

      return {
        scopeKey: collapseScopeKey,
        fileKeys: toggleAllDiffFiles(diffFileKeys, currentKeys),
      };
    });
  }, [collapseScopeKey, diffFileKeys]);

  const selectTurn = (turnId: TurnId) => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectTurn(routeThreadRef, turnId);
  };
  const selectGitScope = (scope: "branch" | "unstaged") => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectGitScope(routeThreadRef, scope);
  };
  const selectBranchBaseRef = (baseRef: string | null) => {
    if (!routeThreadRef) return;
    useDiffPanelStore.getState().selectBranchBaseRef(routeThreadRef, baseRef);
  };

  const viewedChangeCount = useMemo(
    () => changeEntries.filter((entry) => isViewed(entry)).length,
    [changeEntries, isViewed],
  );
  // The sticky header carries the mark: a check and the word once viewed, a ring until then.
  const renderFileViewedToggle = (fileDiff: FileDiffMetadata) => {
    const entry = changeEntriesByKey.get(buildFileDiffIdentityKey(fileDiff));
    if (!entry) return null;
    const viewed = isViewed(entry);
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-pressed={viewed}
              aria-label={viewed ? `Viewed: ${entry.path}` : `Mark viewed: ${entry.path}`}
              className={cn(
                "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1 font-sans text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                viewed
                  ? "bg-success/15 px-1.5 text-success"
                  : "text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
              )}
              onClick={(event) => {
                event.stopPropagation();
                markFileViewed(entry, !viewed);
              }}
            />
          }
        >
          {viewed ? (
            <>
              <CheckIcon aria-hidden="true" className="size-3" />
              <span className="max-sm:hidden">Viewed</span>
            </>
          ) : (
            <span aria-hidden="true" className="size-2.5 rounded-full border border-current" />
          )}
        </TooltipTrigger>
        <TooltipPopup side="top">
          {viewed ? "Viewed. Edits clear the mark." : "Mark viewed (V)"}
        </TooltipPopup>
      </Tooltip>
    );
  };

  const headerRow = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-3 [-webkit-app-region:no-drag]">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-accent px-2 text-xs font-medium text-accent-foreground outline-none transition-colors hover:bg-accent/80 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Diff scope: ${selectedScopeLabel}`}
          >
            <span className="truncate">{selectedScopeLabel}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuItem
              className={
                selectedTurnId === null && selectedGitScope === "unstaged"
                  ? "bg-foreground/[0.08]"
                  : undefined
              }
              onClick={() => selectGitScope("unstaged")}
            >
              <span>Working tree</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={
                selectedTurnId === null && selectedGitScope === "branch"
                  ? "bg-foreground/[0.08]"
                  : undefined
              }
              onClick={() => selectGitScope("branch")}
            >
              <span>Branch changes</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={
                selectedTurnId !== null && selectedTurn?.turnId === latestTurn?.turnId
                  ? "bg-foreground/[0.08]"
                  : undefined
              }
              onClick={() => {
                if (latestTurn) selectTurn(latestTurn.turnId);
              }}
            >
              <span>Latest turn</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Turn</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {orderedTurnDiffSummaries.map((summary) => {
                  const turnCount =
                    summary.checkpointTurnCount ??
                    inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                    "?";
                  return (
                    <DropdownMenuItem
                      key={summary.turnId}
                      className={
                        summary.turnId === selectedTurn?.turnId ? "bg-foreground/[0.08]" : undefined
                      }
                      onClick={() => selectTurn(summary.turnId)}
                    >
                      <span>Turn {turnCount}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        {selectedTurnId === null && selectedGitScope === "branch" && selectedGitSource?.baseRef && (
          <div
            className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-xs text-muted-foreground"
            aria-label={`Comparing ${selectedGitSource.headRef ?? "HEAD"} against ${selectedGitSource.baseRef}`}
          >
            <Tooltip>
              <TooltipTrigger render={<span className="flex min-w-0 items-center gap-2" />}>
                <span className="min-w-0 max-w-48 truncate">
                  {selectedGitSource.headRef ?? "HEAD"}
                </span>
                <ArrowRightIcon className="size-3.5 shrink-0 opacity-70" />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {`${selectedGitSource.headRef ?? "HEAD"} → ${selectedGitSource.baseRef}`}
              </TooltipPopup>
            </Tooltip>
            <Combobox
              items={baseRefItems}
              filteredItems={filteredBaseRefItems}
              value={selectedBaseRef ?? AUTOMATIC_BASE_REF}
              onOpenChange={(open) => {
                if (!open) setBaseRefQuery("");
              }}
              onValueChange={(value) => {
                if (!value) return;
                selectBranchBaseRef(value === AUTOMATIC_BASE_REF ? null : value);
              }}
            >
              <ComboboxTrigger
                className="inline-flex min-w-0 max-w-48 items-center gap-1 overflow-hidden rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Change comparison target. Currently ${selectedGitSource.baseRef}`}
              >
                <span className="min-w-0 truncate">{selectedGitSource.baseRef}</span>
                <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
              </ComboboxTrigger>
              <ComboboxPopup
                align="start"
                className="w-72 min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden"
              >
                <div className="min-w-0 shrink-0 px-3 pt-2.5">
                  <div className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
                    <SearchIcon
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1.5 left-0 size-4 shrink-0 text-muted-foreground/55"
                    />
                    <ComboboxInput
                      className="[&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
                      inputClassName="rounded-none bg-transparent text-sm"
                      placeholder="Search refs..."
                      showTrigger={false}
                      size="sm"
                      unstyled
                      value={baseRefQuery}
                      onChange={(event) => setBaseRefQuery(event.target.value)}
                    />
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 border-b border-border/70 ps-3 pe-6.5 pt-2 pb-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                  <span aria-hidden="true" />
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center">
                    <span>Branch</span>
                    <span className="text-right">Remote</span>
                  </div>
                </div>
                <ComboboxEmpty>No matching refs.</ComboboxEmpty>
                <ComboboxList className="max-h-64 min-w-0 overflow-x-hidden">
                  <ComboboxItem
                    className="h-8 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] py-0"
                    contentClassName="w-full min-w-0 overflow-hidden"
                    value={AUTOMATIC_BASE_REF}
                  >
                    <span className="block min-w-0 truncate">Automatic</span>
                  </ComboboxItem>
                  {baseRefChoices.map((choice) => {
                    const item = valueForBaseRefChoice(choice);
                    const hasBoth = choice.local !== null && choice.remote !== null;
                    const useRemote = choice.remote?.name === item;
                    return (
                      <ComboboxItem
                        key={choice.id}
                        className="h-8 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] py-0"
                        contentClassName="w-full min-w-0 overflow-hidden"
                        value={item}
                      >
                        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center overflow-hidden">
                          <span className="block min-w-0 truncate pe-2">{choice.label}</span>
                          {hasBoth ? (
                            <div
                              className="flex justify-end"
                              onClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              <Switch
                                aria-label={`Use remote version of ${choice.label}`}
                                checked={useRemote}
                                className="[--thumb-size:--spacing(3)]"
                                onCheckedChange={(checked) => {
                                  const nextRef = checked
                                    ? choice.remote?.name
                                    : choice.local?.name;
                                  if (nextRef) selectBranchBaseRef(nextRef);
                                }}
                              />
                            </div>
                          ) : choice.remote ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="flex justify-end text-muted-foreground">
                                    <CheckIcon
                                      role="img"
                                      aria-label="Remote only"
                                      className="size-3"
                                    />
                                  </span>
                                }
                              />
                              <TooltipPopup side="top">Remote only</TooltipPopup>
                            </Tooltip>
                          ) : null}
                        </div>
                      </ComboboxItem>
                    );
                  })}
                </ComboboxList>
              </ComboboxPopup>
            </Combobox>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        {codeViewFiles.length > 0 && (
          <DiffStatLabel
            additions={diffLineStat.additions}
            deletions={diffLineStat.deletions}
            className="mr-1 text-[11px] max-sm:hidden"
            layout="inline"
          />
        )}
        {canRefreshGitDiff && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={branchDiffPreview.isPending ? "Refreshing diff" : "Refresh diff"}
                  onClick={refreshBranchDiffPreview}
                />
              }
            >
              <RefreshIcon className="size-3.5" refreshing={branchDiffPreview.isPending} />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {branchDiffPreview.isPending ? "Refreshing diff…" : "Refresh diff"}
            </TooltipPopup>
          </Tooltip>
        )}
        {codeViewFiles.length > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={allDiffFilesCollapsed ? "Expand all files" : "Collapse all files"}
                  onClick={toggleDiffFileCollapse}
                />
              }
            >
              {allDiffFilesCollapsed ? (
                <ChevronsUpDownIcon className="size-3.5" />
              ) : (
                <ChevronsDownUpIcon className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">
              {allDiffFilesCollapsed ? "Expand all files" : "Collapse all files"}
            </TooltipPopup>
          </Tooltip>
        )}
        <ToggleGroup
          aria-label="Diff layout"
          className="shrink-0"
          variant="segmented"
          value={[diffLayout]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "stacked" || next === "split") {
              updateClientSettings({ diffLayout: next });
            }
          }}
        >
          <Toggle aria-label="Stacked diff view" value="stacked">
            <Rows3Icon className="size-3.5" />
          </Toggle>
          <Toggle aria-label="Split diff view" value="split">
            <Columns2Icon className="size-3.5" />
          </Toggle>
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                aria-label={wordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
                variant="ghost"
                size="sm"
                pressed={wordWrap}
                onPressedChange={(pressed) => {
                  setWordWrap(Boolean(pressed));
                }}
              />
            }
          >
            <TextWrapIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {wordWrap ? "Disable line wrapping" : "Enable line wrapping"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                aria-label={
                  diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
                }
                variant="ghost"
                size="sm"
                pressed={diffIgnoreWhitespace}
                onPressedChange={(pressed) => {
                  setDiffIgnoreWhitespace(Boolean(pressed));
                }}
              />
            }
          >
            <PilcrowIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">
            {diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
          </TooltipPopup>
        </Tooltip>
        {hasResolvedPatch && !hasNoNetChanges && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  ref={copyPatchButtonRef}
                  size="icon-sm"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  aria-label="Copy entire patch"
                  onClick={() => {
                    if (typeof selectedPatch === "string") {
                      copyPatchToClipboard(selectedPatch, undefined);
                    }
                  }}
                >
                  {isPatchCopied ? (
                    <CheckIcon className="size-3.5 text-success" />
                  ) : (
                    <CopyIcon className="size-3.5" />
                  )}
                </Button>
              }
            />
            <TooltipPopup side="top">
              {isPatchCopied ? "Patch copied!" : "Copy entire patch"}
            </TooltipPopup>
          </Tooltip>
        )}
        {codeViewFiles.length > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={fileTreeOpen ? "Hide file tree" : "Show file tree"}
                  className="max-sm:hidden"
                  variant="ghost"
                  size="sm"
                  pressed={fileTreeOpen}
                  onPressedChange={(pressed) => setFileTreeOpen(Boolean(pressed))}
                />
              }
            >
              <FolderTreeIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {fileTreeOpen ? "Hide file tree" : "Show file tree"}
            </TooltipPopup>
          </Tooltip>
        )}
      </div>
    </>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect turn diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Turn diffs are unavailable because this project is not a git repository.
        </div>
      ) : selectedTurnId !== null && orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No completed turns yet.
        </div>
      ) : (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
            {isSelectedPatchTruncated && (
              <p className="shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                This diff was truncated because it exceeded the preview limit. The changes shown are
                incomplete.
              </p>
            )}
            {selectedPatchError && !renderablePatch && (
              <div className="px-3">
                <p className="mb-2 text-[11px] text-error/80">{selectedPatchError}</p>
              </div>
            )}
            {!renderablePatch ? (
              isLoadingSelectedPatch ? (
                <DiffPanelLoadingState
                  label={
                    selectedTurn
                      ? "Loading checkpoint diff..."
                      : selectedGitScope === "unstaged"
                        ? "Loading working tree diff..."
                        : "Loading branch diff..."
                  }
                />
              ) : (
                <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                  <p>
                    {hasNoNetChanges
                      ? "No net changes in this selection."
                      : "No patch available for this selection."}
                  </p>
                </div>
              )
            ) : renderablePatch.kind === "files" ? (
              <div
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
                data-keyboard-surface="diff"
              >
                {isPhoneViewport && (
                  <button
                    type="button"
                    aria-label="Show changed files"
                    className="flex h-9 min-h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3 text-start text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setPhoneFilesOpen(true)}
                  >
                    <FolderTreeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium text-foreground">
                      {changeEntries.length} {changeEntries.length === 1 ? "file" : "files"}
                    </span>
                    <DiffStatLabel
                      additions={diffLineStat.additions}
                      deletions={diffLineStat.deletions}
                      className="text-[11px]"
                      layout="inline"
                    />
                    <span className="ms-auto tabular-nums text-muted-foreground">
                      {viewedChangeCount}/{changeEntries.length} viewed
                    </span>
                    <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                )}
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  <div
                    className="min-h-0 min-w-0 flex-1"
                    onClickCapture={(event) => {
                      const composedPath = event.nativeEvent.composedPath?.() ?? [];
                      for (const node of composedPath) {
                        if (!(node instanceof HTMLElement)) continue;
                        // Header controls keep their own actions. In particular, the chevron must
                        // not also trigger the row handler or the two toggles cancel each other.
                        if (
                          node instanceof HTMLButtonElement ||
                          node instanceof HTMLAnchorElement
                        ) {
                          return;
                        }
                      }
                      const title = composedPath.find(
                        (node): node is HTMLElement =>
                          node instanceof HTMLElement && node.hasAttribute("data-title"),
                      );
                      const filePath = title?.textContent?.trim();
                      // The filename remains the explicit "open in editor" affordance.
                      if (filePath) {
                        openDiffFile(filePath);
                        return;
                      }
                      const header = composedPath.find(
                        (node): node is HTMLElement =>
                          node instanceof HTMLElement && node.hasAttribute("data-diffs-header"),
                      );
                      const headerFilePath = header
                        ?.querySelector("[data-title]")
                        ?.textContent?.trim();
                      if (!headerFilePath) return;
                      const file = codeViewFiles.find(
                        (candidate) => candidate.filePath === headerFilePath,
                      );
                      if (file) toggleDiffFileCollapsed(file.fileKey);
                    }}
                  >
                    <AnnotatableCodeView
                      key={collapseScopeKey ?? reviewSectionId}
                      viewerRef={setCodeView}
                      codeViewKey={codeViewMountKey}
                      className="h-full min-h-0 overflow-auto"
                      files={codeViewFiles}
                      sectionId={reviewSectionId}
                      sectionTitle={reviewSectionTitle}
                      composerDraftTarget={composerDraftTarget}
                      renderHeaderFilenameSuffix={(fileDiff) => {
                        const stat = getSingleFileDiffLineStat(fileDiff);
                        const filePath = resolveFileDiffPath(fileDiff);
                        return (
                          <div className="flex items-center gap-1.5 ml-auto">
                            {(stat.additions > 0 || stat.deletions > 0) && (
                              <span className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums text-muted-foreground mr-1">
                                {stat.additions > 0 && (
                                  <span className="text-emerald-500 font-semibold">
                                    +{stat.additions}
                                  </span>
                                )}
                                {stat.deletions > 0 && (
                                  <span className="text-rose-500 font-semibold">
                                    -{stat.deletions}
                                  </span>
                                )}
                              </span>
                            )}
                            {renderFileViewedToggle(fileDiff)}
                            <DiffFilePathCopyButton filePath={filePath} />
                          </div>
                        );
                      }}
                      renderHeaderPrefix={(fileDiff, fileKey, collapsed) => {
                        const filePath = resolveFileDiffPath(fileDiff);
                        return (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  size="icon-micro"
                                  variant="ghost"
                                  className={cn(
                                    "-ms-0.5 [--control-icon-color:currentColor] bg-transparent hover:bg-foreground/10",
                                    getDiffCollapseIconClassName(fileDiff),
                                  )}
                                  aria-label={
                                    collapsed ? `Expand ${filePath}` : `Collapse ${filePath}`
                                  }
                                  aria-expanded={!collapsed}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleDiffFileCollapsed(fileKey);
                                  }}
                                />
                              }
                            >
                              {collapsed ? (
                                <ChevronRightIcon className="size-4" />
                              ) : (
                                <ChevronDownIcon className="size-4" />
                              )}
                            </TooltipTrigger>
                            <TooltipPopup side="top">
                              {collapsed ? "Expand diff" : "Collapse diff"}
                            </TooltipPopup>
                          </Tooltip>
                        );
                      }}
                      options={{
                        diffStyle: diffLayout === "split" ? "split" : "unified",
                        lineDiffType: "none",
                        overflow: wordWrap ? "wrap" : "scroll",
                        theme: resolveDiffThemeName(resolvedTheme),
                        preferredHighlighter: PREFERRED_HIGHLIGHTER,
                        themeType: resolvedTheme as DiffThemeType,
                        stickyHeaders: true,
                        ...(currentLoadDiffFiles ? { loadDiffFiles } : {}),
                      }}
                    />
                  </div>
                  {fileTreeOpen && !isPhoneViewport ? (
                    <aside className="flex w-[min(16rem,40%)] min-w-40 shrink-0 border-l border-border/60">
                      <DiffChangesTree
                        ariaLabel={`${reviewSectionTitle} files`}
                        entries={changeEntries}
                        selectedPath={treeSelectedPath}
                        isViewed={isViewed}
                        onSelectFile={focusDiffFile}
                        onToggleViewed={markFileViewed}
                        className="flex-1"
                      />
                    </aside>
                  ) : null}
                </div>
                {isPhoneViewport ? (
                  <Sheet open={phoneFilesOpen} onOpenChange={setPhoneFilesOpen}>
                    <SheetPopup side="bottom" showCloseButton={false}>
                      <SheetHeader>
                        <SheetTitle>{reviewSectionTitle} files</SheetTitle>
                      </SheetHeader>
                      <div className="flex h-[70dvh] min-h-0 flex-col">
                        <DiffChangesTree
                          ariaLabel={`${reviewSectionTitle} files`}
                          entries={changeEntries}
                          selectedPath={treeSelectedPath}
                          isViewed={isViewed}
                          onSelectFile={(filePath) => {
                            focusDiffFile(filePath);
                            setPhoneFilesOpen(false);
                          }}
                          onToggleViewed={markFileViewed}
                          className="flex-1"
                        />
                      </div>
                    </SheetPopup>
                  </Sheet>
                ) : null}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                  <pre
                    className={cn(
                      "max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90",
                      wordWrap
                        ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                        : "overflow-auto",
                    )}
                  >
                    {renderablePatch.text}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </DiffPanelShell>
  );
}
