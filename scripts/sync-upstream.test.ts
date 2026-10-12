/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=6m; seat=codex; date=2026-10-03 */
// @effect-diagnostics nodeBuiltinImport:off - Integration fixtures exercise real Git indexes, dirty worktrees, and atomic filesystem behavior.
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
  prepareCandidate,
  selectLatestNightly,
  selectMacAsset,
  verifyAsset,
  type ReleaseAsset,
} from "./sync-upstream.ts";

const git = (repo: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

async function fixture() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-upstream-test-"));
  const repo = NodePath.join(root, "repo");
  await NodeFSP.mkdir(repo);
  git(repo, "init", "--initial-branch=main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.invalid");
  await NodeFSP.writeFile(NodePath.join(repo, "shared.txt"), "original\n");
  await NodeFSP.writeFile(NodePath.join(repo, "custom.txt"), "original\n");
  await NodeFSP.writeFile(NodePath.join(repo, ".gitignore"), "private.txt\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture base");
  git(repo, "checkout", "-b", "upstream");
  await NodeFSP.writeFile(NodePath.join(repo, "shared.txt"), "upstream shipped\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "upstream fixture");
  git(repo, "checkout", "main");
  return { root, repo, cache: NodePath.join(root, "cache") };
}

describe("upstream customization staging", () => {
  it("retains local commits, staged/unstaged edits and new files while importing upstream", async () => {
    const { repo, cache } = await fixture();
    await NodeFSP.writeFile(NodePath.join(repo, "committed.txt"), "custom commit\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "custom fixture");
    await NodeFSP.writeFile(NodePath.join(repo, "custom.txt"), "staged\n");
    git(repo, "add", "custom.txt");
    await NodeFSP.writeFile(NodePath.join(repo, "custom.txt"), "unstaged wins\n");
    await NodeFSP.writeFile(NodePath.join(repo, "new file.txt"), "new custom feature\n");
    await NodeFSP.writeFile(NodePath.join(repo, "private.txt"), "ignored fixture\n");
    const head = git(repo, "rev-parse", "HEAD");
    const index = git(repo, "diff", "--cached");
    const working = git(repo, "status", "--porcelain");
    const report = await prepareCandidate(repo, "upstream", cache);
    expect(report.status).toBe("ready-for-checks");
    expect(await NodeFSP.readFile(NodePath.join(report.candidateDir, "shared.txt"), "utf8")).toBe(
      "upstream shipped\n",
    );
    expect(await NodeFSP.readFile(NodePath.join(report.candidateDir, "custom.txt"), "utf8")).toBe(
      "unstaged wins\n",
    );
    expect(await NodeFSP.readFile(NodePath.join(report.candidateDir, "new file.txt"), "utf8")).toBe(
      "new custom feature\n",
    );
    expect(
      await NodeFSP.readFile(NodePath.join(report.candidateDir, "committed.txt"), "utf8"),
    ).toBe("custom commit\n");
    await expect(NodeFSP.stat(NodePath.join(report.candidateDir, "private.txt"))).rejects.toThrow();
    expect(git(repo, "rev-parse", "HEAD")).toBe(head);
    expect(git(repo, "diff", "--cached")).toBe(index);
    expect(git(repo, "status", "--porcelain")).toBe(working);
  });

  it("resumes a verified integration when upstream and dirty source advance", async () => {
    const { repo, cache } = await fixture();
    const original = await prepareCandidate(repo, "upstream", cache);
    const verified = {
      ...original,
      status: "custom-app-installed-verified",
      integrationUpstream: original.upstream,
      validation: { promoted: true, artifactSha256: "verified-fixture" },
    };
    await NodeFSP.writeFile(NodePath.join(cache, "source-status.json"), JSON.stringify(verified));
    await NodeFSP.writeFile(NodePath.join(original.candidateDir, "custom.txt"), "resolved port\n");
    git(original.candidateDir, "add", "custom.txt");
    git(repo, "checkout", "upstream");
    await NodeFSP.writeFile(NodePath.join(repo, "shared.txt"), "new upstream release\n");
    git(repo, "add", "shared.txt");
    git(repo, "commit", "-m", "next upstream fixture");
    const latest = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "main");
    await NodeFSP.writeFile(NodePath.join(repo, "custom.txt"), "unrelated dirty work\n");
    const working = git(repo, "status", "--porcelain");
    const index = git(repo, "diff", "--cached");
    const candidatesBefore = (await NodeFSP.readdir(cache)).filter((name) =>
      name.startsWith("candidate-"),
    );
    const resumed = await prepareCandidate(repo, "upstream", cache);
    expect(resumed.candidateDir).toBe(original.candidateDir);
    expect(resumed.customTree).toBe(original.customTree);
    expect(resumed.status).toBe("custom-app-installed-verified");
    expect(resumed.pendingUpstream).toBe(latest);
    expect(await NodeFSP.readFile(NodePath.join(original.candidateDir, "custom.txt"), "utf8")).toBe(
      "resolved port\n",
    );
    expect(git(repo, "status", "--porcelain")).toBe(working);
    expect(git(repo, "diff", "--cached")).toBe(index);
    expect((await NodeFSP.readdir(cache)).filter((name) => name.startsWith("candidate-"))).toEqual(
      candidatesBefore,
    );
    const saved = JSON.parse(
      await NodeFSP.readFile(NodePath.join(cache, "source-status.json"), "utf8"),
    );
    expect(saved.validation).toEqual(verified.validation);
    // Once manually integrated, subsequent checks stop reporting the same delta.
    saved.integrationUpstream = latest;
    await NodeFSP.writeFile(NodePath.join(cache, "source-status.json"), JSON.stringify(saved));
    expect((await prepareCandidate(repo, "upstream", cache)).pendingUpstream).toBeNull();
  });

  it("does not replace a missing retained candidate", async () => {
    const { repo, cache } = await fixture();
    const original = await prepareCandidate(repo, "upstream", cache);
    git(repo, "worktree", "remove", "--force", original.candidateDir);
    await expect(prepareCandidate(repo, "upstream", cache)).rejects.toThrow();
    const saved = JSON.parse(
      await NodeFSP.readFile(NodePath.join(cache, "source-status.json"), "utf8"),
    );
    expect(saved.candidateDir).toBe(original.candidateDir);
  });

  it("retains conflicted candidates and never rewrites their subsequent resolution", async () => {
    const { repo, cache } = await fixture();
    await NodeFSP.writeFile(NodePath.join(repo, "shared.txt"), "custom incompatible\n");
    const report = await prepareCandidate(repo, "upstream", cache);
    expect(report.status).toBe("needs-resolution");
    expect(report.conflicts).toContain("shared.txt");
    expect(await NodeFSP.readFile(NodePath.join(repo, "shared.txt"), "utf8")).toBe(
      "custom incompatible\n",
    );
    await NodeFSP.writeFile(
      NodePath.join(report.candidateDir, "shared.txt"),
      "resolved by developer\n",
    );
    expect((await prepareCandidate(repo, "upstream", cache)).candidateDir).toBe(
      report.candidateDir,
    );
    expect(await NodeFSP.readFile(NodePath.join(report.candidateDir, "shared.txt"), "utf8")).toBe(
      "resolved by developer\n",
    );
  });
});

const bytes = Buffer.from("official asset fixture");
const asset: ReleaseAsset = {
  name: "T3-Code-0.0.45-arm64.dmg",
  size: bytes.length,
  digest: `sha256:${NodeCrypto.createHash("sha256").update(bytes).digest("hex")}`,
  browser_download_url:
    "https://github.com/pingdotgg/t3code/releases/download/v0.0.45/T3-Code-0.0.45-arm64.dmg",
};

describe("upstream release downloads", () => {
  it("downloads the newest published nightly and excludes previews and drafts", () => {
    const release = {
      html_url: "https://github.com/pingdotgg/t3code",
      assets: [asset],
      draft: false,
      prerelease: true,
    };
    expect(
      selectLatestNightly([
        {
          ...release,
          tag_name: "v0.0.46-nightly.20261003.2623",
          published_at: "2026-10-03T10:00:00Z",
        },
        {
          ...release,
          tag_name: "v0.0.46-preview.20261003.2650",
          published_at: "2026-10-03T15:00:00Z",
        },
        {
          ...release,
          draft: true,
          tag_name: "v0.0.46-nightly.20261003.2651",
          published_at: "2026-10-03T15:01:00Z",
        },
        {
          ...release,
          tag_name: "v0.0.46-nightly.20261003.2632",
          published_at: "2026-10-03T11:00:00Z",
        },
      ]).tag_name,
    ).toBe("v0.0.46-nightly.20261003.2632");
  });
  it("selects the machine's installer and requires an official URL and checksum", () => {
    expect(selectMacAsset([asset], "arm64")).toEqual(asset);
    expect(() => selectMacAsset([asset], "x64")).toThrow();
    expect(() => selectMacAsset([{ ...asset, digest: null }], "arm64")).toThrow();
    expect(() =>
      selectMacAsset(
        [{ ...asset, browser_download_url: "https://example.invalid/asset" }],
        "arm64",
      ),
    ).toThrow();
  });
  it("rejects corrupted or truncated assets before publishing the download", () => {
    expect(() => verifyAsset(bytes, asset)).not.toThrow();
    expect(() => verifyAsset(Buffer.from("wrong"), asset)).toThrow();
    expect(() => verifyAsset(bytes, { ...asset, size: bytes.length + 1 })).toThrow();
  });
});
