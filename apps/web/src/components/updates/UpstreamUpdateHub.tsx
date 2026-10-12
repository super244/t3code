/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
import {
  ArrowDownToLineIcon,
  ExternalLinkIcon,
  GitCommitIcon,
  GithubIcon,
  RefreshCwIcon,
  ZapIcon,
} from "lucide-react";
import { useState } from "react";
import {
  UPSTREAM_REPO,
  selectUpstreamRelease,
  type UpstreamChannel,
  type UpstreamStatus,
} from "@t3tools/shared/upstream";
export { useUpstreamTracker } from "./upstreamTracker";
export type {
  UpstreamStatus,
  UpstreamRelease,
  UpstreamReleaseAsset,
  UpstreamCommit,
} from "@t3tools/shared/upstream";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface UpstreamUpdateHubModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly status: UpstreamStatus;
  readonly onCheckNow: () => Promise<void>;
}

export function UpstreamUpdateHubModal({
  open,
  onOpenChange,
  status,
  onCheckNow,
}: UpstreamUpdateHubModalProps) {
  const [activeTab, setActiveTab] = useState<"releases" | "commits" | "status">("releases");

  const [channel, setChannel] = useState<UpstreamChannel>("stable");
  const latest = selectUpstreamRelease(status.releases, channel);
  const assets = latest?.assets || [];
  const macArm64 = assets.find((a) => a.platform === "mac-arm64");
  const macX64 = assets.find((a) => a.platform === "mac-x64");
  const linux = assets.find((a) => a.platform === "linux");
  const windows = assets.find((a) => a.platform === "windows");

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl border-sky-500/20 bg-background/95 p-0 backdrop-blur-2xl">
        <DialogHeader className="border-b border-border/50 px-6 pt-6 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/30">
                <ZapIcon className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold tracking-tight text-foreground">
                  Upstream releases
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Release and commit checks for{" "}
                  <a
                    className="font-medium text-sky-400 hover:underline"
                    href={`https://github.com/${UPSTREAM_REPO}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {UPSTREAM_REPO}
                  </a>
                </DialogDescription>
              </div>
            </div>
            <Button
              className="h-8 gap-1.5 text-xs"
              disabled={status.isChecking}
              size="sm"
              variant="outline"
              onClick={() => void onCheckNow()}
            >
              <RefreshCwIcon className={`h-3.5 w-3.5 ${status.isChecking ? "animate-spin" : ""}`} />
              {status.isChecking ? "Checking..." : "Check Now"}
            </Button>
          </div>

          {/* Navigation Tabs */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-border/40 pb-1">
            <button
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "releases"
                  ? "bg-sky-500/15 text-sky-300 font-semibold"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              }`}
              onClick={() => setActiveTab("releases")}
              type="button"
            >
              Official Releases & Downloads
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "commits"
                  ? "bg-sky-500/15 text-sky-300 font-semibold"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              }`}
              onClick={() => setActiveTab("commits")}
              type="button"
            >
              <GitCommitIcon className="h-3.5 w-3.5" />
              Community Contributions ({status.recentCommits.length})
            </button>
            <button
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "status"
                  ? "bg-sky-500/15 text-sky-300 font-semibold"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              }`}
              onClick={() => setActiveTab("status")}
              type="button"
            >
              App & Check Status
            </button>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] px-6 py-4">
          {status.error && (
            <p role="alert" className="mb-3 text-xs text-destructive">
              {status.error}{" "}
              {status.checkedAt ? "Showing last known information." : "Use Check Now to retry."}
            </p>
          )}
          {activeTab === "releases" && (
            <div className="space-y-4">
              <div className="flex gap-1 border-b border-border pb-2" aria-label="Release channel">
                {(["stable", "nightly"] as const).map((item) => (
                  <Button
                    key={item}
                    size="sm"
                    variant={channel === item ? "secondary" : "ghost"}
                    aria-pressed={channel === item}
                    onClick={() => setChannel(item)}
                  >
                    {item === "stable" ? "Stable" : "Nightly"}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {channel === "stable"
                  ? "Official stable releases."
                  : "Preview releases may contain unfinished changes."}{" "}
                Downloads install the upstream app; they do not update this custom checkout.
              </p>
              {latest ? (
                <>
                  <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/40">
                          {latest.tagName}
                        </Badge>
                        {latest.isPrerelease && (
                          <Badge variant="outline" className="text-amber-400 border-amber-500/30">
                            Nightly
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          Published {formatDate(latest.publishedAt)}
                        </span>
                      </div>
                      <a
                        className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"
                        href={latest.htmlUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        GitHub Release
                        <ExternalLinkIcon className="h-3 w-3" />
                      </a>
                    </div>

                    <h4 className="mt-2 text-sm font-medium text-foreground">{latest.name}</h4>

                    {/* Direct Download Action Grid */}
                    <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {macArm64 && (
                        <a
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-card/60 p-2.5 transition-colors hover:border-sky-500/50 hover:bg-sky-950/30"
                          href={macArm64.downloadUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">🍏</span>
                            <div>
                              <div className="text-xs font-medium text-foreground">
                                macOS Apple Silicon
                              </div>
                              <div className="text-[10px] text-muted-foreground font-mono">
                                DMG • {formatBytes(macArm64.sizeBytes)}
                              </div>
                            </div>
                          </div>
                          <ArrowDownToLineIcon className="h-4 w-4 text-sky-400" />
                        </a>
                      )}

                      {macX64 && (
                        <a
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-card/60 p-2.5 transition-colors hover:border-sky-500/50 hover:bg-sky-950/30"
                          href={macX64.downloadUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">🍏</span>
                            <div>
                              <div className="text-xs font-medium text-foreground">
                                macOS Intel (x64)
                              </div>
                              <div className="text-[10px] text-muted-foreground font-mono">
                                DMG • {formatBytes(macX64.sizeBytes)}
                              </div>
                            </div>
                          </div>
                          <ArrowDownToLineIcon className="h-4 w-4 text-sky-400" />
                        </a>
                      )}

                      {linux && (
                        <a
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-card/60 p-2.5 transition-colors hover:border-sky-500/50 hover:bg-sky-950/30"
                          href={linux.downloadUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">🐧</span>
                            <div>
                              <div className="text-xs font-medium text-foreground">
                                Linux Package
                              </div>
                              <div className="text-[10px] text-muted-foreground font-mono">
                                AppImage • {formatBytes(linux.sizeBytes)}
                              </div>
                            </div>
                          </div>
                          <ArrowDownToLineIcon className="h-4 w-4 text-sky-400" />
                        </a>
                      )}

                      {windows && (
                        <a
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-card/60 p-2.5 transition-colors hover:border-sky-500/50 hover:bg-sky-950/30"
                          href={windows.downloadUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">🪟</span>
                            <div>
                              <div className="text-xs font-medium text-foreground">
                                Windows Setup
                              </div>
                              <div className="text-[10px] text-muted-foreground font-mono">
                                EXE • {formatBytes(windows.sizeBytes)}
                              </div>
                            </div>
                          </div>
                          <ArrowDownToLineIcon className="h-4 w-4 text-sky-400" />
                        </a>
                      )}
                    </div>
                  </div>

                  {latest.body && (
                    <div className="rounded-xl border border-border/50 bg-card/40 p-4">
                      <h5 className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-2">
                        Release Highlights
                      </h5>
                      <div className="max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap">
                        {latest.body.slice(0, 1500)}
                        {latest.body.length > 1500 && "\n..."}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                  <GithubIcon className="h-8 w-8 opacity-40 mb-2" />
                  <p className="text-sm">
                    {status.isChecking
                      ? "Checking GitHub releases…"
                      : status.error
                        ? "Release information is unavailable."
                        : `No ${channel} release was returned.`}
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === "commits" && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground pb-1">
                Recent pull requests and code merged to{" "}
                <span className="font-mono text-sky-400">main</span>:
              </div>
              {status.recentCommits.length === 0 && (
                <p className="py-4 text-xs text-muted-foreground">
                  {status.isChecking
                    ? "Checking recent commits…"
                    : "No recent commits are available for this check."}
                </p>
              )}
              {status.recentCommits.map((commit) => (
                <a
                  className="flex items-start justify-between gap-3 rounded-xl border border-border/40 bg-card/40 p-3 transition-colors hover:border-sky-500/40 hover:bg-sky-950/20"
                  href={commit.htmlUrl}
                  key={commit.sha}
                  rel="noreferrer"
                  target="_blank"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {commit.authorAvatarUrl ? (
                      <img
                        alt={commit.authorName}
                        className="h-6 w-6 rounded-full ring-1 ring-border"
                        src={commit.authorAvatarUrl}
                      />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[10px] font-bold">
                        {commit.authorName[0]}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">
                        {commit.message}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                        <span>{commit.authorName}</span>
                        <span>•</span>
                        <span>{formatDate(commit.date)}</span>
                        {commit.prNumber && (
                          <span className="font-mono text-sky-400">#{commit.prNumber}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0 rounded bg-accent/60 px-1.5 py-0.5">
                    {commit.shortSha}
                  </span>
                </a>
              ))}
            </div>
          )}

          {activeTab === "status" && (
            <div className="space-y-3 text-xs text-muted-foreground">
              <p>
                Current client version:{" "}
                <span className="font-mono text-foreground">{status.currentVersion}</span>
              </p>
              <p>
                Release information is checked periodically while this app is open. Use Check Now to
                refresh it.
              </p>
              <p>
                Downloading an official release does not merge upstream changes into this custom
                app.
              </p>
              <p>
                Prism palettes are available from the theme selector. Sync status is reported there
                after a sync attempt.
              </p>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="border-t border-border/50 px-6 py-3">
          <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
            <span>
              {status.checkedAt ? `Last checked: ${formatDate(status.checkedAt)}` : "Ready"}
            </span>
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { UpstreamUpdateHubModal as UpstreamUpdateHub };
