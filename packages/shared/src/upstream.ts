/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 */
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

export function selectUpstreamRelease(
  releases: ReadonlyArray<UpstreamRelease>,
  channel: UpstreamChannel,
): UpstreamRelease | null {
  const candidates = releases.filter((release) =>
    channel === "stable" ? !release.isPrerelease : release.isPrerelease,
  );
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
