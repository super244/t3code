/* agent-watermark: model=opus-5.5; effort=high; duration=25m; seat=claude-code; date=2026-10-12 */
import type { UpstreamStatus } from "@t3tools/shared/upstream";
import {
  CheckIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  describeNightlyVersion,
  fetchServerUpstreamStatus,
  installNightlyOnServer,
  type NightlyInstallResult,
} from "./nightlyStatus";

type Load =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly status: UpstreamStatus }
  | { readonly state: "failed"; readonly reason: string };

/**
 * Upstream Nightly beside this Alpha: what is installed, what is newest, whether the two
 * keep their data apart, and a one-press install that never touches this app's state.
 */
export function NightlyPanel() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [installing, setInstalling] = useState(false);
  const [seed, setSeed] = useState(true);
  const [result, setResult] = useState<NightlyInstallResult | null>(null);

  const refresh = useCallback(() => {
    fetchServerUpstreamStatus().then(
      (status) => setLoad({ state: "ready", status }),
      (error: unknown) =>
        setLoad({
          state: "failed",
          reason: error instanceof Error ? error.message : "The server could not be reached.",
        }),
    );
  }, []);
  useEffect(refresh, [refresh]);

  if (load.state === "loading") {
    return <p className="py-6 text-center text-xs text-muted-foreground">Reading this computer…</p>;
  }
  if (load.state === "failed" || load.status.nightly === null) {
    return (
      <p role="alert" className="py-6 text-center text-xs text-muted-foreground">
        {load.state === "failed" ? load.reason : "This server does not report Nightly status."} The
        release lists in the other tabs still work.
      </p>
    );
  }

  const { nightly, sharedState } = load.status;
  const installed = nightly.installed;
  const latest = nightly.latestRelease;
  const latestVersion = latest ? latest.tagName.replace(/^v/, "") : null;
  const firstInstall = installed === null;
  const actionLabel = firstInstall
    ? "Install Nightly"
    : nightly.updateAvailable
      ? `Update to ${latestVersion ? describeNightlyVersion(latestVersion) : "latest"}`
      : "Up to date";

  const install = () => {
    setInstalling(true);
    setResult(null);
    installNightlyOnServer({
      seed: firstInstall && seed,
      ...(latest ? { tag: latest.tagName } : {}),
    })
      .then(setResult, (error: unknown) =>
        setResult({
          ok: false,
          message: error instanceof Error ? error.message : "Install failed.",
        }),
      )
      .finally(() => {
        setInstalling(false);
        refresh();
      });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Upstream's nightly builds run as their own app with their own data folder, so Orchestration
        V2 and newer database migrations never reach this Alpha's threads.
      </p>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground">
              <FlaskConicalIcon className="size-4" />
            </span>
            <div>
              <h3 className="text-sm font-medium">T3 Code (Nightly)</h3>
              <p className="text-xs text-muted-foreground">
                {installed ? describeNightlyVersion(installed.version) : "Not installed"}
              </p>
            </div>
          </div>
          {installed ? (
            <Badge variant={nightly.updateAvailable ? "warning" : "success"}>
              {nightly.updateAvailable ? "Update available" : "Latest nightly"}
            </Badge>
          ) : null}
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
          <Fact label="Installed">
            <span className="font-mono">{installed?.version ?? "—"}</span>
          </Fact>
          <Fact label="Newest upstream">
            {latest ? (
              <a
                className="inline-flex items-center gap-1 font-mono hover:underline"
                href={latest.htmlUrl}
                rel="noreferrer"
                target="_blank"
              >
                {latestVersion}
                <ExternalLinkIcon className="size-3 opacity-60" />
              </a>
            ) : (
              "—"
            )}
          </Fact>
        </dl>

        {installed ? (
          <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs">
            <Check ok={installed.home !== null && installed.isolated}>
              Own data folder{" "}
              <span className="font-mono text-muted-foreground">
                {installed.home ?? "shared with this app"}
              </span>
            </Check>
            <Check ok={installed.autoUpdateDisabled}>
              {installed.autoUpdateDisabled
                ? "Its own updater is off; updates come from here"
                : "Its own updater is on and can reinstall the shared build"}
            </Check>
            <Check ok={installed.bundleId !== "com.t3tools.t3code"}>
              Separate app identity{" "}
              <span className="font-mono text-muted-foreground">{installed.bundleId}</span>
            </Check>
          </ul>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          {firstInstall ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={seed} onCheckedChange={(value) => setSeed(value === true)} />
              Start with a copy of my threads (read-only copy; this app's data is not changed)
            </label>
          ) : (
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {result ? result.message : installed?.isolated ? "Isolated from this app." : ""}
            </span>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={refresh} aria-label="Re-read Nightly status">
              <RefreshCwIcon />
            </Button>
            <Button
              size="sm"
              disabled={
                installing || !nightly.canInstall || (!firstInstall && !nightly.updateAvailable)
              }
              onClick={install}
            >
              {installing ? "Installing…" : actionLabel}
            </Button>
          </div>
        </div>
        {!nightly.canInstall && nightly.installBlockedReason ? (
          <p className="mt-2 text-xs text-muted-foreground">{nightly.installBlockedReason}</p>
        ) : null}
        {result && !result.ok ? (
          <p role="alert" className="mt-2 text-xs text-destructive-foreground">
            {result.message}
          </p>
        ) : null}
      </section>

      {sharedState ? (
        <section
          className={cn(
            "rounded-xl border p-4",
            sharedState.foreignMigrations.length > 0 || sharedState.orchestratorV2StorePresent
              ? "border-warning/40 bg-warning/5"
              : "border-border bg-card",
          )}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground">
              <DatabaseIcon className="size-4" />
            </span>
            <div>
              <h3 className="text-sm font-medium">This app's data</h3>
              <p className="text-xs text-muted-foreground">
                Schema {sharedState.foundMigration ?? "—"} of the {sharedState.knownMigration} this
                build knows
              </p>
            </div>
          </div>
          {sharedState.foreignMigrations.length > 0 || sharedState.orchestratorV2StorePresent ? (
            <div className="mt-3 space-y-2 text-xs">
              <p className="flex items-start gap-2 text-warning-foreground">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                A newer upstream build has opened this data folder before. This app keeps working,
                but run Nightly only from its own folder above.
              </p>
              {sharedState.foreignMigrations.length > 0 ? (
                <p className="text-muted-foreground">
                  Migrations it added:{" "}
                  <span className="font-mono">{sharedState.foreignMigrations.join(", ")}</span>
                </p>
              ) : null}
              {sharedState.orchestratorV2StorePresent ? (
                <p className="text-muted-foreground">
                  An Orchestration V2 store (statev2.sqlite) sits beside it; this build does not
                  read it.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <CheckIcon className="size-3.5 text-success" />
              Only this build has written to it.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-foreground">{children}</dd>
    </div>
  );
}

function Check({ ok, children }: { readonly ok: boolean; readonly children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-success" />
      ) : (
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
      )}
      <span className="min-w-0">{children}</span>
    </li>
  );
}
