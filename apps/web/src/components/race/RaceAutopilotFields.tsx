/* agent-watermark: model=opus-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-22 */
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import type { RaceAutopilot } from "@t3tools/contracts";
import { isRaceAutopilotActive } from "@t3tools/shared/raceHistory";
import { BotIcon, CircleStopIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  describeRaceAutopilot,
  INITIAL_RACE_AUTOPILOT_DRAFT,
  raceAutopilotStageLabel,
  readStoredRaceAutopilotDraft,
  type RaceAutopilotDraft,
} from "./raceAutopilot.logic";
import { formatRaceAgentLabel } from "./raceLabels";

import { raceHistoryEnvironment } from "../../state/raceHistory";
import { useAtomCommand } from "../../state/use-atom-command";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { RaceSelect } from "./RaceComposer";
import { raceModelLabel, raceProviderLabel } from "./raceLabels";

const DRAFT_STORAGE_KEY = "t3code:race-autopilot:v1";

function loadDraft(): RaceAutopilotDraft {
  try {
    return readStoredRaceAutopilotDraft(window.localStorage.getItem(DRAFT_STORAGE_KEY));
  } catch {
    return INITIAL_RACE_AUTOPILOT_DRAFT;
  }
}

function storeDraft(draft: RaceAutopilotDraft) {
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Blocked storage only means the next race starts with autopilot off.
  }
}

/** The judge a draft resolves to among the ready providers: the picked one, else the first. */
function resolveJudge(draft: RaceAutopilotDraft, providers: ReadonlyArray<ServerProvider>) {
  const provider = providers.find((item) => item.instanceId === draft.instanceId) ?? providers[0];
  const model =
    (draft.model && provider?.models.some((item) => item.slug === draft.model)
      ? draft.model
      : null) ??
    provider?.models[0]?.slug ??
    null;
  return provider && model ? { provider, model } : null;
}

/**
 * Autopilot as a race starts: the draft the fields edit, and `arm`, which
 * saves the plan once the entrants have started. A race whose plan did not
 * save still runs; it just waits for the user like any other race.
 */
export function useRaceAutopilotDraft(providers: ReadonlyArray<ServerProvider>) {
  const [draft, setDraftState] = useState<RaceAutopilotDraft>(loadDraft);
  const setDraft = useCallback((next: RaceAutopilotDraft) => {
    setDraftState(next);
    storeDraft(next);
  }, []);
  const setAutopilot = useAtomCommand(raceHistoryEnvironment.setAutopilot, {
    reportFailure: false,
  });
  const judge = resolveJudge(draft, providers);
  const arm = useCallback(
    async (input: { environmentId: EnvironmentId; raceId: string; heat: number }) => {
      if (!draft.enabled || !judge) return;
      const result = await setAutopilot({
        environmentId: input.environmentId,
        input: {
          raceId: input.raceId,
          heat: input.heat,
          judge: { instanceId: judge.provider.instanceId, model: judge.model },
          keep: draft.keep,
        },
      });
      if (result._tag === "Failure") {
        toastManager.add({
          type: "warning",
          title: "Autopilot is off for this race",
          description: "Its plan did not save. Ask the judge and keep a winner from the arena.",
        });
      }
    },
    [draft.enabled, draft.keep, judge, setAutopilot],
  );
  return { draft, setDraft, judge, arm };
}

/** The "Autopilot" block of the race dialog and the Race page composer. */
export function RaceAutopilotFields({
  draft,
  onChange,
  providers,
  disabled = false,
}: {
  draft: RaceAutopilotDraft;
  onChange: (next: RaceAutopilotDraft) => void;
  providers: ReadonlyArray<ServerProvider>;
  disabled?: boolean;
}) {
  const judge = resolveJudge(draft, providers);
  const unavailable = providers.length === 0;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 px-3 py-2.5">
      <label className="flex min-w-0 cursor-pointer items-start gap-2.5">
        <BotIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Autopilot</span>
          <span className="block text-xs text-muted-foreground">
            {unavailable
              ? "No ready agent can judge on this computer."
              : "When every entrant stops, a judge picks the best one. It runs while the desktop app or a browser tab of T3 Code is open."}
          </span>
        </span>
        <Switch
          checked={draft.enabled && !unavailable}
          disabled={disabled || unavailable}
          aria-label="Autopilot"
          onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
        />
      </label>
      {draft.enabled && judge ? (
        <div className="flex min-w-0 flex-col gap-2 ps-6.5">
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <RaceSelect
              ariaLabel="Autopilot judge provider"
              value={judge.provider.instanceId}
              disabled={disabled}
              options={providers.map((item) => {
                const Icon = PROVIDER_ICON_BY_PROVIDER[item.driver];
                return {
                  value: item.instanceId,
                  label: raceProviderLabel(item),
                  icon: Icon ? <Icon className="size-3.5" /> : undefined,
                };
              })}
              onChange={(instanceId) => onChange({ ...draft, instanceId, model: null })}
            />
            <RaceSelect
              ariaLabel="Autopilot judge model"
              value={judge.model}
              disabled={disabled}
              options={judge.provider.models.map((item) => ({
                value: item.slug,
                label: raceModelLabel(judge.provider, item.slug),
              }))}
              onChange={(model) => onChange({ ...draft, model })}
            />
          </div>
          <label className="flex min-w-0 cursor-pointer items-center gap-2.5 text-xs">
            <span className="min-w-0 flex-1 text-muted-foreground">
              Keep the judge's pick: squash-merge it into the project checkout and discard the
              others, without asking.
            </span>
            <Switch
              checked={draft.keep}
              disabled={disabled}
              aria-label="Keep the judge's pick automatically"
              onCheckedChange={(keep) => onChange({ ...draft, keep })}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The arena's autopilot strip: the plan and where it is, with Stop while it
 * runs. A race without one (or whose autopilot ended) can turn it on here for
 * its current heat.
 */
export function RaceAutopilotBar({
  environmentId,
  raceId,
  heat,
  autopilot,
  providers,
  decided,
}: {
  environmentId: EnvironmentId;
  raceId: string;
  heat: number;
  autopilot: RaceAutopilot | null;
  providers: ReadonlyArray<ServerProvider>;
  /** This heat already has a kept winner or was closed: nothing left to automate. */
  decided: boolean;
}) {
  const advance = useAtomCommand(raceHistoryEnvironment.advanceAutopilot, {
    reportFailure: false,
  });
  const arming = useRaceAutopilotDraft(providers);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = autopilot && autopilot.heat === heat ? autopilot : null;
  const active = current !== null && isRaceAutopilotActive(current.stage);

  if (!current && decided) return null;

  if (current && !editing) {
    const judge = providers.find((item) => item.instanceId === current.judge.instanceId) ?? null;
    return (
      <div
        role="status"
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-2.5 text-xs",
          active ? "border-sky-500/30 bg-sky-500/6" : "border-border/70 bg-muted/30",
        )}
      >
        <BotIcon className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Autopilot · {raceAutopilotStageLabel(current.stage)}</span>
          <span className="text-muted-foreground">
            {" "}
            · judge {formatRaceAgentLabel(judge, current.judge)}
            {current.keep ? ", keeps its pick" : ", you keep"}
          </span>
          <span className="block text-muted-foreground">{describeRaceAutopilot(current)}</span>
        </p>
        {active ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await advance({
                environmentId,
                input: {
                  raceId,
                  from: current.stage,
                  to: "stopped",
                  note: "Stopped by hand. Judge and keep from the arena.",
                },
              });
              setBusy(false);
            }}
          >
            <CircleStopIcon /> Stop
          </Button>
        ) : decided ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              arming.setDraft({
                enabled: true,
                instanceId: current.judge.instanceId,
                model: current.judge.model,
                keep: current.keep,
              });
              setEditing(true);
            }}
          >
            Turn on again
          </Button>
        )}
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
        <BotIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          Autopilot is off: you ask the judge and keep a winner yourself.
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={providers.length === 0}
          onClick={() => {
            arming.setDraft({ ...arming.draft, enabled: true });
            setEditing(true);
          }}
        >
          Turn on autopilot
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <RaceAutopilotFields
        draft={arming.draft}
        onChange={arming.setDraft}
        providers={providers}
        disabled={busy}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={busy || !arming.draft.enabled || !arming.judge}
          onClick={async () => {
            setBusy(true);
            await arming.arm({ environmentId, raceId, heat });
            setBusy(false);
            setEditing(false);
          }}
        >
          <BotIcon /> Start autopilot
        </Button>
      </div>
    </div>
  );
}
