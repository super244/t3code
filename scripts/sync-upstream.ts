/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=6m; seat=codex; date=2026-10-03 */
// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Standalone Git/download bootstrap uses Node's private index environment, filesystem atomic rename, and native fetch before any application runtime.
import { HostProcessArchitecture } from "@t3tools/shared/hostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const OFFICIAL_REPOSITORY = "https://github.com/pingdotgg/t3code.git";
const RELEASE_API = "https://api.github.com/repos/pingdotgg/t3code/releases/latest";

function git(repo: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = NodeChildProcess.spawnSync("git", ["-C", repo, ...args], {
    env,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: 180_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
  return result.stdout.replace(/\n$/, "");
}

async function atomicJson(filename: string, value: unknown) {
  const temporary = `${filename}.${process.pid}.tmp`;
  await NodeFSP.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await NodeFSP.rename(temporary, filename);
}

/** Stage the full custom tree, including unstaged and untracked files, without
 * changing the developer's index, branch, worktree, or creating commits. */
export async function prepareCandidate(repo: string, targetRef: string, cacheDir: string) {
  await NodeFSP.mkdir(cacheDir, { recursive: true });
  const upstream = git(repo, ["rev-parse", `${targetRef}^{commit}`]);
  const head = git(repo, ["rev-parse", "HEAD"]);
  // Source/release checks must not replace an integration with accumulated ports.
  // Resuming is explicit through source-status; newer source is a pending delta.
  const statusPath = NodePath.join(cacheDir, "source-status.json");
  let retained: CandidateReport | undefined;
  try {
    retained = JSON.parse(await NodeFSP.readFile(statusPath, "utf8")) as CandidateReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (retained !== undefined) {
    // Fail closed if the retained checkout disappeared; do not silently start over.
    const candidateRoot = git(retained.candidateDir, ["rev-parse", "--show-toplevel"]);
    if ((await NodeFSP.realpath(candidateRoot)) !== (await NodeFSP.realpath(retained.candidateDir)))
      throw new Error("Retained integration candidate is not its own Git worktree.");
    const conflicts = git(retained.candidateDir, ["diff", "--name-only", "--diff-filter=U"])
      .split("\n")
      .filter(Boolean);
    const report: CandidateReport = {
      ...retained,
      conflicts,
      latestObservedUpstream: upstream,
      latestObservedSourceHead: head,
      pendingUpstream:
        upstream === (retained.integrationUpstream ?? retained.upstream) ? null : upstream,
      updatedAt: DateTime.formatIso(Effect.runSync(DateTime.now)),
    };
    await atomicJson(statusPath, report);
    return report;
  }
  const base = git(repo, ["merge-base", head, upstream]);
  const scratch = await NodeFSP.mkdtemp(NodePath.join(cacheDir, "snapshot-"));
  let tree: string;
  try {
    const env = { ...process.env, GIT_INDEX_FILE: NodePath.join(scratch, "index") };
    git(repo, ["read-tree", head], env);
    git(repo, ["add", "--all", "--", "."], env);
    tree = git(repo, ["write-tree"], env);
  } finally {
    await NodeFSP.rm(scratch, { recursive: true });
  }
  const identity = NodeCrypto.createHash("sha256")
    .update(`${repo}\0${upstream}\0${tree}`)
    .digest("hex");
  const candidateDir = NodePath.join(cacheDir, `candidate-${identity.slice(0, 20)}`);
  const reportPath = NodePath.join(cacheDir, `${identity}.json`);
  // Retain a conflicted candidate for human/agent resolution on later runs.
  try {
    const report = JSON.parse(await NodeFSP.readFile(reportPath, "utf8")) as CandidateReport;
    report.conflicts = git(report.candidateDir, ["diff", "--name-only", "--diff-filter=U"])
      .split("\n")
      .filter(Boolean);
    await atomicJson(reportPath, report);
    await atomicJson(NodePath.join(cacheDir, "source-status.json"), report);
    return report;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const patchPath = NodePath.join(cacheDir, `${identity}.patch`);
  await NodeFSP.writeFile(patchPath, git(repo, ["diff", "--binary", "--full-index", base, tree]), {
    mode: 0o600,
  });
  git(repo, ["worktree", "add", "--detach", candidateDir, upstream]);
  const patch = await NodeFSP.readFile(patchPath, "utf8");
  let applyError: string | null = null;
  if (patch.length > 0) {
    // Restore the single terminal newline removed by the git output helper.
    await NodeFSP.appendFile(patchPath, "\n");
    const errors: string[] = [];
    const partPath = NodePath.join(cacheDir, `${identity}.part.patch`);
    // Apply each file independently: upstream deletions/renames must not
    // prevent clean custom additions from reaching the integration candidate.
    try {
      for (const part of `${patch}\n`.split(/(?=^diff --git )/m).filter(Boolean)) {
        await NodeFSP.writeFile(partPath, part, { mode: 0o600 });
        try {
          git(candidateDir, ["apply", "--3way", partPath]);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      await NodeFSP.rm(partPath, { force: true });
    }
    applyError = errors.length > 0 ? errors.join("\n") : null;
  }
  const conflicts = git(candidateDir, ["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .filter(Boolean);
  const report: CandidateReport = {
    upstream,
    sourceHead: head,
    customTree: tree,
    base,
    candidateDir,
    patchPath,
    status: applyError ? "needs-resolution" : "ready-for-checks",
    conflicts,
    applyError,
    createdAt: DateTime.formatIso(Effect.runSync(DateTime.now)),
  };
  await atomicJson(reportPath, report);
  await atomicJson(NodePath.join(cacheDir, "source-status.json"), report);
  return report;
}

interface CandidateReport {
  upstream: string;
  sourceHead: string;
  customTree: string;
  base: string;
  candidateDir: string;
  patchPath: string;
  status:
    | "needs-resolution"
    | "ready-for-checks"
    | "custom-app-installed-verified"
    | "installed-validation-pending";
  integrationUpstream?: string;
  latestObservedUpstream?: string;
  latestObservedSourceHead?: string;
  pendingUpstream?: string | null;
  updatedAt?: string;
  conflicts: string[];
  applyError: string | null;
  createdAt: string;
}

export interface ReleaseAsset {
  name: string;
  size: number;
  digest: string | null;
  browser_download_url: string;
}
interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
  published_at: string;
  draft: boolean;
  prerelease: boolean;
}

export function selectLatestNightly(releases: Release[]) {
  const nightly = releases
    .filter(
      (release) =>
        !release.draft && release.prerelease && /-nightly\.\d{8}\.\d+$/.test(release.tag_name),
    )
    .sort((a, b) => b.published_at.localeCompare(a.published_at))[0];
  if (!nightly) throw new Error("No published upstream nightly release was found.");
  return nightly;
}

export function selectMacAsset(assets: ReleaseAsset[], arch: string) {
  if (arch !== "arm64" && arch !== "x64")
    throw new Error(`Unsupported macOS architecture: ${arch}`);
  const asset = assets.find(
    (entry) => /^T3-Code-.*\.dmg$/.test(entry.name) && entry.name.endsWith(`-${arch}.dmg`),
  );
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")) {
    throw new Error("The release has no matching macOS installer with a GitHub SHA-256 digest.");
  }
  const url = new URL(asset.browser_download_url);
  if (
    url.origin !== "https://github.com" ||
    !url.pathname.startsWith("/pingdotgg/t3code/releases/download/")
  ) {
    throw new Error("Unexpected upstream asset URL.");
  }
  if (
    NodePath.basename(asset.name) !== asset.name ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0
  ) {
    throw new Error("Invalid release asset metadata.");
  }
  return asset;
}

export function verifyAsset(bytes: Uint8Array, asset: ReleaseAsset) {
  const digest = `sha256:${NodeCrypto.createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== asset.size || digest !== asset.digest) {
    throw new Error(`Integrity check failed for ${asset.name}.`);
  }
}

export async function downloadLatestRelease(
  cacheDir: string,
  channel: "stable" | "nightly" = "stable",
) {
  const response = await fetch(
    channel === "stable" ? RELEASE_API : RELEASE_API.replace(/\/latest$/, "?per_page=100"),
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "t3code-custom-upstream-sync",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`GitHub release check failed: ${response.status}`);
  const body = await response.json();
  const release = channel === "stable" ? (body as Release) : selectLatestNightly(body as Release[]);
  const asset = selectMacAsset(release.assets, Effect.runSync(HostProcessArchitecture));
  await NodeFSP.mkdir(cacheDir, { recursive: true });
  const filename = NodePath.join(cacheDir, asset.name);
  let downloaded = false;
  try {
    verifyAsset(await NodeFSP.readFile(filename), asset);
  } catch {
    const download = await fetch(asset.browser_download_url, {
      signal: AbortSignal.timeout(180_000),
    });
    if (!download.ok) throw new Error(`Upstream download failed: ${download.status}`);
    const bytes = new Uint8Array(await download.arrayBuffer());
    verifyAsset(bytes, asset);
    const temporary = `${filename}.${process.pid}.partial`;
    await NodeFSP.writeFile(temporary, bytes, { mode: 0o600 });
    await NodeFSP.rename(temporary, filename);
    downloaded = true;
  }
  const report = {
    tag: release.tag_name,
    url: release.html_url,
    filename,
    digest: asset.digest,
    downloaded,
    checkedAt: DateTime.formatIso(Effect.runSync(DateTime.now)),
  };
  await atomicJson(
    NodePath.join(
      cacheDir,
      channel === "stable" ? "release-status.json" : "nightly-release-status.json",
    ),
    report,
  );
  return report;
}

export async function syncUpstream(repo: string) {
  const root = git(repo, ["rev-parse", "--show-toplevel"]);
  const cacheDir = NodePath.join(
    NodeOS.homedir(),
    ".cache",
    "t3code-upstream",
    NodeCrypto.createHash("sha256").update(root).digest("hex").slice(0, 16),
  );
  await NodeFSP.mkdir(cacheDir, { recursive: true });
  const lock = NodePath.join(cacheDir, "sync.lock");
  await NodeFSP.mkdir(lock); // Exclusive: concurrent automation runs cannot mutate a candidate.
  try {
    const remote = git(root, ["remote", "get-url", "origin"]);
    if (remote !== OFFICIAL_REPOSITORY)
      throw new Error("origin must point to the official pingdotgg/t3code repository.");
    git(root, [
      "-c",
      "http.lowSpeedLimit=1024",
      "-c",
      "http.lowSpeedTime=60",
      "fetch",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ]);
    const source = await prepareCandidate(root, "origin/main", cacheDir);
    // Download independently even when customization conflicts need work.
    const release = await downloadLatestRelease(NodePath.join(root, "release", "upstream"));
    const nightlyRelease = await downloadLatestRelease(
      NodePath.join(root, "release", "upstream"),
      "nightly",
    );
    return { source, release, nightlyRelease };
  } finally {
    await NodeFSP.rmdir(lock);
  }
}

export async function downloadUpstreamReleases(repo: string) {
  const directory = NodePath.join(
    git(repo, ["rev-parse", "--show-toplevel"]),
    "release",
    "upstream",
  );
  const release = await downloadLatestRelease(directory);
  const nightlyRelease = await downloadLatestRelease(directory, "nightly");
  return { release, nightlyRelease };
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const run = process.argv.includes("--releases-only") ? downloadUpstreamReleases : syncUpstream;
  run(process.cwd()).then(
    (report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
    (error: unknown) => {
      Effect.runSync(Effect.logError(error instanceof Error ? error.message : error));
      process.exitCode = 1;
    },
  );
}
