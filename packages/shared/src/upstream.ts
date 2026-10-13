/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
/* agent-watermark: model=haiku-5.5; effort=high; duration=80m; seat=claude-code; date=2026-10-12 */
// @effect-diagnostics globalFetch:off globalDate:off
// This helper runs in both browsers and Node; it owns AbortSignal deadlines.
import { compareSemverVersions, parseSemver } from "./semver.ts";

export const UPSTREAM_REPO = "pingdotgg/t3code";
export type UpstreamChannel = "stable" | "nightly";
export interface UpstreamReleaseAsset {
  readonly name: string;
  readonly downloadUrl: string;
  readonly sizeBytes: number;
  readonly platform: "mac-arm64" | "mac-x64" | "linux" | "windows" | "other";
}
export interface UpstreamRelease {
  readonly tagName: string;
  readonly name: string;
  readonly publishedAt: string;
  readonly htmlUrl: string;
  readonly body: string;
  readonly isPrerelease: boolean;
  readonly assets: ReadonlyArray<UpstreamReleaseAsset>;
}
export interface UpstreamCommit {
  readonly sha: string;
  readonly shortSha: string;
  readonly message: string;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly date: string;
  readonly htmlUrl: string;
  readonly prNumber: number | null;
}
/**
 * What this server's own state holds next to upstream builds. Upstream Nightly
 * and this build can share one state directory; upstream then records migrations
 * this build does not define.
 */
export interface UpstreamSharedState {
  /** Highest migration id this build defines. */
  readonly knownMigration: number;
  /** Highest migration id recorded in this server's state.sqlite; null when it is empty or unreadable. */
  readonly foundMigration: number | null;
  /** Recorded migrations this build does not define, as "<id>_<name>", in id order. */
  readonly foreignMigrations: ReadonlyArray<string>;
  /** Whether Orchestration V2's statev2.sqlite sits beside state.sqlite. */
  readonly orchestratorV2StorePresent: boolean;
}

/** The Nightly desktop app installed in /Applications, read from its Info.plist. */
export interface UpstreamNightlyInstall {
  readonly appPath: string;
  readonly version: string;
  readonly bundleId: string;
  /** LSEnvironment T3CODE_HOME, or null when the bundle does not set one. */
  readonly home: string | null;
  readonly autoUpdateDisabled: boolean;
  /** The bundle keeps its state out of ~/.t3 and cannot update itself back into it. */
  readonly isolated: boolean;
}

export interface UpstreamNightlyStatus {
  /** Newest upstream nightly prerelease from the same GitHub call as `releases`. */
  readonly latestRelease: UpstreamRelease | null;
  readonly installed: UpstreamNightlyInstall | null;
  /** True when the latest nightly is newer than the installed one, or nothing is installed. */
  readonly updateAvailable: boolean;
  /** False when this server cannot run the install script; see installBlockedReason. */
  readonly canInstall: boolean;
  readonly installBlockedReason: string | null;
}

export interface UpstreamStatus {
  readonly repo: string;
  readonly currentVersion: string;
  /** Last successful complete check; a failure does not freshen it. */
  readonly checkedAt: string;
  readonly releases: ReadonlyArray<UpstreamRelease>;
  readonly latestRelease: UpstreamRelease | null;
  readonly recentCommits: ReadonlyArray<UpstreamCommit>;
  readonly hasNewRelease: boolean;
  readonly isChecking: boolean;
  readonly error: string | null;
  /** Filled in by the server on every status and check response; null only in the bare monitor state. */
  readonly sharedState: UpstreamSharedState | null;
  /** Filled in by the server on every status and check response; null only in the bare monitor state. */
  readonly nightly: UpstreamNightlyStatus | null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function githubUrl(value: unknown, asset = false): string {
  const url = string(value);
  const prefix = `https://github.com/${UPSTREAM_REPO}/`;
  return url.startsWith(prefix + (asset ? "releases/download/" : "")) ? url : "";
}

export function classifyUpstreamAsset(name: string): UpstreamReleaseAsset["platform"] {
  const lower = name.toLowerCase();
  if (/\.(yml|yaml|json|txt|sha256|blockmap)$/.test(lower)) return "other";
  if (/arm64\.dmg$|darwin-arm64|arm64-mac/.test(lower)) return "mac-arm64";
  if (/x64\.dmg$|darwin-x64|mac\.dmg$/.test(lower)) return "mac-x64";
  if (/\.(appimage|deb|rpm)$/.test(lower)) return "linux";
  if (/\.(exe|msi)$/.test(lower)) return "windows";
  return "other";
}

export function parseUpstreamReleases(value: unknown): ReadonlyArray<UpstreamRelease> {
  if (!Array.isArray(value)) throw new Error("GitHub returned an invalid releases response.");
  return value.flatMap((item) => {
    const raw = record(item);
    const tagName = string(raw.tag_name);
    const htmlUrl = githubUrl(raw.html_url);
    if (raw.draft || !tagName || !htmlUrl) return [];
    const assets = (Array.isArray(raw.assets) ? raw.assets : []).flatMap((item) => {
      const raw = record(item);
      const name = string(raw.name);
      const downloadUrl = githubUrl(raw.browser_download_url, true);
      return name && downloadUrl
        ? [
            {
              name,
              downloadUrl,
              sizeBytes:
                typeof raw.size === "number" && Number.isFinite(raw.size) && raw.size >= 0
                  ? raw.size
                  : 0,
              platform: classifyUpstreamAsset(name),
            },
          ]
        : [];
    });
    return [
      {
        tagName,
        htmlUrl,
        name: string(raw.name) || tagName,
        publishedAt: string(raw.published_at),
        body: string(raw.body),
        isPrerelease: raw.prerelease === true || /nightly/i.test(tagName),
        assets,
      },
    ];
  });
}

const NIGHTLY_ORDER = /^v?\d+\.\d+\.\d+-nightly\.(\d{8})\.(\d+)$/;
const NIGHTLY_RELEASE_TAG = /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/;

/**
 * Orders an upstream nightly tag or version by (date, build). Upstream also publishes
 * `-preview.` prereleases and `android-nightly` tags; those return null here, so
 * semver prerelease-string order never decides which nightly is newest.
 */
export function nightlyOrderKey(tagOrVersion: string): readonly [number, number] | null {
  const match = NIGHTLY_ORDER.exec(tagOrVersion);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function compareNightlyKeys(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return left[0] - right[0] || left[1] - right[1];
}

/** Newest nightly that matches the tag pattern and ships a mac arm64 DMG, or null. */
function selectNightlyRelease(releases: ReadonlyArray<UpstreamRelease>): UpstreamRelease | null {
  let best: { readonly key: readonly [number, number]; readonly release: UpstreamRelease } | null =
    null;
  for (const release of releases) {
    const key = NIGHTLY_RELEASE_TAG.test(release.tagName) ? nightlyOrderKey(release.tagName) : null;
    if (key === null || !release.assets.some((asset) => asset.platform === "mac-arm64")) continue;
    if (best === null || compareNightlyKeys(key, best.key) > 0) best = { key, release };
  }
  return best?.release ?? null;
}

export function selectUpstreamRelease(
  releases: ReadonlyArray<UpstreamRelease>,
  channel: UpstreamChannel,
): UpstreamRelease | null {
  if (channel === "nightly") return selectNightlyRelease(releases);
  const candidates = releases.filter((release) => !release.isPrerelease);
  return (
    candidates.toSorted((a, b) => {
      if (parseSemver(a.tagName) && parseSemver(b.tagName))
        return compareSemverVersions(b.tagName, a.tagName);
      return b.publishedAt.localeCompare(a.publishedAt);
    })[0] ?? null
  );
}

export function isNewerUpstreamRelease(release: UpstreamRelease | null, version: string): boolean {
  return (
    release !== null &&
    parseSemver(release.tagName) !== null &&
    parseSemver(version) !== null &&
    compareSemverVersions(release.tagName, version) > 0
  );
}
export function emptyUpstreamStatus(version: string): UpstreamStatus {
  return {
    repo: UPSTREAM_REPO,
    currentVersion: version,
    checkedAt: "",
    releases: [],
    latestRelease: null,
    recentCommits: [],
    hasNewRelease: false,
    isChecking: false,
    error: null,
    sharedState: null,
    nightly: null,
  };
}

/**
 * Lexically normalizes an absolute POSIX path (no filesystem access): "." and ".." resolve, slashes
 * collapse. Symlinks and aliases need the caller's `resolvePath`.
 */
function normalizeAbsolutePosixPath(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return `/${parts.join("/")}`;
}

/**
 * Reads the isolation facts from an installed Nightly's LSEnvironment. The
 * bundle is isolated only when it points T3CODE_HOME away from `sharedHome` and
 * turns the updater off, since an updater would copy the shared bundle back in.
 * Both paths are compared after `resolvePath`, so a symlink or alias to ~/.t3 is
 * the shared home too; the sidecar resolves the same way with os.path.realpath.
 */
export function nightlyIsolation(input: {
  readonly environment: Readonly<Record<string, unknown>>;
  readonly sharedHome: string;
  readonly resolvePath?: (path: string) => string;
}): Pick<UpstreamNightlyInstall, "home" | "autoUpdateDisabled" | "isolated"> {
  const rawHome =
    typeof input.environment.T3CODE_HOME === "string" ? input.environment.T3CODE_HOME.trim() : "";
  const home = rawHome.startsWith("/") ? normalizeAbsolutePosixPath(rawHome) : null;
  const sharedHome = normalizeAbsolutePosixPath(input.sharedHome);
  const resolvePath = input.resolvePath ?? ((path: string) => path);
  const updater = String(input.environment.T3CODE_DISABLE_AUTO_UPDATE ?? "")
    .trim()
    .toLowerCase();
  const autoUpdateDisabled = ["1", "true", "yes", "on"].includes(updater);
  return {
    home,
    autoUpdateDisabled,
    isolated: home !== null && resolvePath(home) !== resolvePath(sharedHome) && autoUpdateDisabled,
  };
}

/**
 * True when the latest nightly is strictly newer by (date, build). An installed
 * version that is not a nightly counts as older.
 */
function isNewerNightly(latestTag: string, installedVersion: string): boolean {
  const latest = nightlyOrderKey(latestTag);
  if (latest === null) return false;
  const installed = nightlyOrderKey(installedVersion);
  return installed === null || compareNightlyKeys(latest, installed) > 0;
}

export function buildUpstreamNightlyStatus(input: {
  readonly releases: ReadonlyArray<UpstreamRelease>;
  readonly installed: UpstreamNightlyInstall | null;
  /** Why this server cannot install Nightly, or null when it can. */
  readonly installBlockedReason: string | null;
}): UpstreamNightlyStatus {
  const latestRelease = selectUpstreamRelease(input.releases, "nightly");
  return {
    latestRelease,
    installed: input.installed,
    updateAvailable:
      latestRelease !== null &&
      (input.installed === null || isNewerNightly(latestRelease.tagName, input.installed.version)),
    canInstall: input.installBlockedReason === null,
    installBlockedReason: input.installBlockedReason,
  };
}
function parseCommits(value: unknown): ReadonlyArray<UpstreamCommit> {
  if (!Array.isArray(value)) throw new Error("GitHub returned an invalid commits response.");
  return value.flatMap((item) => {
    const raw = record(item);
    const sha = string(raw.sha);
    const htmlUrl = githubUrl(raw.html_url);
    if (!sha || !htmlUrl) return [];
    const commit = record(raw.commit);
    const author = record(commit.author);
    const gitAuthor = record(raw.author);
    const message = string(commit.message).split("\n")[0]?.trim() ?? "";
    const match = message.match(/\(#(\d+)\)/);
    const avatar = string(gitAuthor.avatar_url);
    return [
      {
        sha,
        htmlUrl,
        shortSha: sha.slice(0, 7),
        message,
        authorName: string(author.name) || string(gitAuthor.login) || "Contributor",
        authorAvatarUrl: avatar.startsWith("https://avatars.githubusercontent.com/")
          ? avatar
          : null,
        date: string(author.date),
        prNumber: match?.[1] ? Number(match[1]) : null,
      },
    ];
  });
}

/** Share validation and deadlines across the server and browser trackers. */
export async function fetchUpstreamStatus(previous: UpstreamStatus): Promise<UpstreamStatus> {
  const request = async (path: string): Promise<unknown> => {
    const response = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/${path}`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok)
      throw new Error(
        `GitHub ${path.split("?")[0]}: HTTP ${response.status}${
          response.status === 403 || response.status === 429
            ? " (rate limited or access denied)"
            : ""
        }`,
      );
    return response.json();
  };
  const [releasesResult, commitsResult] = await Promise.allSettled([
    request("releases?per_page=30").then(parseUpstreamReleases),
    request("commits?sha=main&per_page=15").then(parseCommits),
  ]);
  const errors = [releasesResult, commitsResult].flatMap((result) =>
    result.status === "rejected"
      ? [result.reason instanceof Error ? result.reason.message : "GitHub check failed."]
      : [],
  );
  const releases = releasesResult.status === "fulfilled" ? releasesResult.value : previous.releases;
  const latestRelease = selectUpstreamRelease(releases, "stable");
  return {
    ...previous,
    releases,
    latestRelease,
    recentCommits:
      commitsResult.status === "fulfilled" ? commitsResult.value : previous.recentCommits,
    hasNewRelease: isNewerUpstreamRelease(latestRelease, previous.currentVersion),
    checkedAt: errors.length === 0 ? new Date().toISOString() : previous.checkedAt,
    isChecking: false,
    error: errors.length ? errors.join("; ") : null,
  };
}
