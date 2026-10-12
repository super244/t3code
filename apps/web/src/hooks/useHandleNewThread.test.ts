/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 */
import { describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
  } | null = null;
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} }],
    },
    navigate: vi.fn(async (request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
    }),
  };
  const investedDraftIds = new Set<string>();
  const draftStore = {
    getComposerDraft: vi.fn((target: string) => ({
      prompt: investedDraftIds.has(target) ? "Keep my existing work" : "",
    })),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() => null),
    getDraftThread: vi.fn(() => null),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    setLogicalProjectDraftThreadId: vi.fn(),
    setModelSelection: vi.fn(),
  };

  return {
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    draftStore,
    investedDraftIds,
    get projectFileRead() {
      return projectFileRead;
    },
    reset(nextStoredDraft: typeof storedDraft) {
      storedDraft = nextStoredDraft;
      investedDraftIds.clear();
      router.state.location.href = "/";
      router.navigate.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    router,
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: false }
      : new Map([
          [
            "environment-ssh",
            {
              settings: {
                defaultThreadEnvMode: "local",
                newWorktreesStartFromOrigin: false,
                defaultModelSelection: null,
              },
            },
          ],
        ]),
}));
vi.mock("@t3tools/client-runtime/environment", () => ({
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
}));
vi.mock("@t3tools/contracts", () => ({
  DEFAULT_RUNTIME_MODE: "default",
  DEFAULT_SERVER_SETTINGS: {},
}));
vi.mock("@t3tools/shared/threadEnvMode", () => ({
  resolveDefaultThreadEnvMode: (input: {
    readonly projectFile: "local" | "worktree" | null;
    readonly globalDefault: "local" | "worktree";
  }) => input.projectFile ?? input.globalDefault,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => testState.router,
}));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../components/Sidebar.logic", () => ({ orderItemsByPreferredIds: () => [] }));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(() => null, {
    getState: () => testState.draftStore,
  });
  return {
    composerDraftHasUserContent: (draft: { readonly prompt?: string } | null) =>
      Boolean(draft?.prompt?.trim()),
    markPromotedDraftThreadByRef: vi.fn(),
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", () => ({
  hasExplicitComposerModelSelection: () => false,
  resolveNewDraftStartFromOrigin: () => false,
  resolveNewThreadModelSelectionOverride: () => null,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFileDefaultThreadEnvMode: () => testState.projectFileRead,
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => ({
  readProjects: () => [
    {
      id: "project-remote",
      environmentId: "environment-ssh",
      workspaceRoot: "/remote/project",
      defaultThreadEnvMode: null,
      defaultModelSelection: null,
    },
  ],
  readThreadShell: () => null,
  useProjects: () => [],
  useThread: () => null,
}));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: "primary-settings",
}));
vi.mock("../threadRoutes", () => ({ resolveThreadRouteTarget: () => null }));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import { useNewThreadHandler } from "./useHandleNewThread";

describe("useNewThreadHandler", () => {
  it.each([
    ["new", null],
    [
      "reusable",
      {
        draftId: "draft-existing",
        environmentId: "environment-ssh",
        promotedTo: null,
        threadId: "thread-existing",
      },
    ],
  ])("abandons a delayed %s draft open when the user navigates elsewhere", async (_, draft) => {
    testState.reset(draft);
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });
});

describe("mission draft preservation", () => {
  const existing = {
    draftId: "draft-existing",
    environmentId: "environment-ssh",
    promotedTo: null,
    threadId: "thread-existing",
  } as const;
  it("opens a fresh mission instead of reusing a draft containing instructions", async () => {
    testState.reset(existing);
    testState.investedDraftIds.add(existing.draftId);
    const opening = useNewThreadHandler()({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);
    testState.completeProjectFileRead(null);
    expect(await opening).toEqual({ draftId: "draft-delayed", threadId: "thread-delayed" });
    expect(testState.router.state.location.href).toBe("/draft/draft-delayed");
    expect(testState.draftStore.getComposerDraft(existing.draftId).prompt).toBe(
      "Keep my existing work",
    );
    expect(testState.draftStore.setLogicalProjectDraftThreadId.mock.calls.at(-1)?.[2]).toBe(
      "draft-delayed",
    );
  });
  it("abandons reuse if the user starts typing during the project read", async () => {
    testState.reset(existing);
    const opening = useNewThreadHandler()({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);
    testState.investedDraftIds.add(existing.draftId);
    testState.completeProjectFileRead(null);
    expect(await opening).toBeNull();
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
    expect(testState.draftStore.getComposerDraft(existing.draftId).prompt).toBe(
      "Keep my existing work",
    );
  });
});

describe("mission initialization before navigation", () => {
  it.each([
    ["new", null],
    [
      "reused",
      {
        draftId: "draft-existing",
        environmentId: "environment-ssh",
        promotedTo: null,
        threadId: "thread-existing",
      },
    ],
  ] as const)("prepares a %s draft before the caller leaves its form", async (_, draft) => {
    testState.reset(draft);
    let preparedId: string | null = null;
    const opening = useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      {
        initializeDraft(draftId) {
          expect(testState.router.state.location.href).toBe("/");
          preparedId = draftId;
          testState.investedDraftIds.add(draftId);
        },
      },
    );
    testState.completeProjectFileRead(null);
    const opened = await opening;
    expect(preparedId).toBe(opened?.draftId);
    expect(testState.router.state.location.href).toBe(`/draft/${preparedId}`);
    expect(testState.draftStore.getComposerDraft(preparedId!).prompt).toBe("Keep my existing work");
  });

  it("keeps the form route open when preparation fails", async () => {
    testState.reset(null);
    const opening = useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      {
        initializeDraft() {
          throw new Error("Subscription became unavailable");
        },
      },
    );
    testState.completeProjectFileRead(null);
    await expect(opening).rejects.toThrow("Subscription became unavailable");
    expect(testState.router.state.location.href).toBe("/");
    expect(testState.router.navigate).not.toHaveBeenCalled();
  });
});
