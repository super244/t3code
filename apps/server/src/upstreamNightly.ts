/* agent-watermark: model=haiku-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */
// @effect-diagnostics nodeBuiltinImport:off -- Reads the installed bundle and runs the sidecar script, both local OS calls outside the Effect platform services.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import {
  buildUpstreamNightlyStatus,
  nightlyIsolation,
  type UpstreamNightlyInstall,
  type UpstreamNightlyStatus,
  type UpstreamRelease,
} from "@t3tools/shared/upstream";

/** The installed upstream Nightly that scripts/nightly-sidecar.py manages. */
export const NIGHTLY_APP_PATH = "/Applications/T3 Code (Nightly).app";
const SIDECAR_SCRIPT = NodePath.join("scripts", "nightly-sidecar.py");
/** The server bundle directory; the desktop build writes BUILD_SOURCE_RECORD here. */
const NODE_BUILD_DIR = import.meta.dirname;
const BUILD_SOURCE_RECORD = "build-source.json";
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const TAG_PATTERN = /^v?\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/;

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);

export interface NightlyInstallRequest {
  readonly tag: string | null;
  readonly seed: boolean;
}

export class NightlyInstallError extends Error {
  readonly status: 409 | 500;
  readonly detail: unknown;

  constructor(status: 409 | 500, message: string, detail: unknown = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/** Builds the install facts from a parsed Info.plist. Null when the bundle has no version. */
export function nightlyInstallFromInfo(
  info: Readonly<Record<string, unknown>>,
  sharedHome: string,
  appPath: string = NIGHTLY_APP_PATH,
): UpstreamNightlyInstall | null {
  const version =
    typeof info.CFBundleShortVersionString === "string" ? info.CFBundleShortVersionString : null;
  const bundleId = typeof info.CFBundleIdentifier === "string" ? info.CFBundleIdentifier : null;
  if (version === null || bundleId === null) return null;
  const environment =
    typeof info.LSEnvironment === "object" && info.LSEnvironment !== null
      ? (info.LSEnvironment as Record<string, unknown>)
      : {};
  return { appPath, version, bundleId, ...nightlyIsolation({ environment, sharedHome }) };
}

/** Reads the installed Nightly's Info.plist through plutil. Null off macOS or when absent. */
export async function readInstalledNightly(
  platform: NodeJS.Platform,
): Promise<UpstreamNightlyInstall | null> {
  if (platform !== "darwin") return null;
  const plist = NodePath.join(NIGHTLY_APP_PATH, "Contents", "Info.plist");
  if (!NodeFS.existsSync(plist)) return null;
  const { stdout } = await execFileAsync("plutil", ["-convert", "json", "-o", "-", plist], {
    timeout: 10_000,
    maxBuffer: 1 << 20,
  });
  return nightlyInstallFromInfo(
    JSON.parse(stdout) as Record<string, unknown>,
    NodePath.join(NodeOS.homedir(), ".t3"),
  );
}

/** A T3 Code checkout that has the Nightly sidecar script this server can run. */
export function isNightlySidecarCheckout(dir: string): boolean {
  return (
    NodeFS.existsSync(NodePath.join(dir, SIDECAR_SCRIPT)) &&
    NodeFS.existsSync(NodePath.join(dir, "apps", "server", "package.json"))
  );
}

/** The nearest ancestor of startDir that is a checkout, or null. */
export function findNightlySidecarCheckout(startDir: string): string | null {
  let dir = NodePath.resolve(startDir);
  for (let depth = 0; depth < 12; depth += 1) {
    if (isNightlySidecarCheckout(dir)) return dir;
    const parent = NodePath.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The checkout the build recorded beside the bundled server, if it is still valid. */
export function readBuildSourceCheckout(buildDir: string): string | null {
  try {
    const record = JSON.parse(
      NodeFS.readFileSync(NodePath.join(buildDir, BUILD_SOURCE_RECORD), "utf8"),
    ) as unknown;
    const repoRoot =
      typeof record === "object" && record !== null && "repoRoot" in record
        ? record.repoRoot
        : null;
    if (typeof repoRoot !== "string" || !NodePath.isAbsolute(repoRoot)) return null;
    return isNightlySidecarCheckout(repoRoot) ? repoRoot : null;
  } catch {
    return null;
  }
}

/**
 * Where the Nightly sidecar script lives, in this order:
 *   1. walking up from the working directory (a dev run from a checkout),
 *   2. T3CODE_SOURCE_CHECKOUT (an explicit override, for a packaged app),
 *   3. the checkout the desktop build recorded beside the bundled server.
 * Every candidate must still contain scripts/nightly-sidecar.py, or it is skipped.
 */
export function resolveNightlySidecarCheckout(input: {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly buildDir: string;
}): string | null {
  const fromCwd = findNightlySidecarCheckout(input.cwd);
  if (fromCwd !== null) return fromCwd;
  const override = input.env.T3CODE_SOURCE_CHECKOUT?.trim();
  if (override && NodePath.isAbsolute(override) && isNightlySidecarCheckout(override)) {
    return NodePath.resolve(override);
  }
  return readBuildSourceCheckout(input.buildDir);
}

export function nightlyInstallBlockedReason(input: {
  readonly platform: NodeJS.Platform;
  readonly checkout: string | null;
}): string | null {
  if (input.platform !== "darwin") return "Installing Nightly needs macOS.";
  if (input.checkout === null) {
    return "No T3 Code checkout with scripts/nightly-sidecar.py was found from the working directory, T3CODE_SOURCE_CHECKOUT, or the desktop build record, so Nightly cannot be installed here.";
  }
  return null;
}

/** Nightly status for the upstream response: the releases already fetched plus local install facts. */
export async function readNightlyStatus(input: {
  readonly releases: ReadonlyArray<UpstreamRelease>;
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Promise<UpstreamNightlyStatus> {
  const installed = await readInstalledNightly(input.platform).catch(() => null);
  const checkout = resolveNightlySidecarCheckout({
    cwd: process.cwd(),
    env: input.env,
    buildDir: NODE_BUILD_DIR,
  });
  return buildUpstreamNightlyStatus({
    releases: input.releases,
    installed,
    installBlockedReason: nightlyInstallBlockedReason({ platform: input.platform, checkout }),
  });
}

/** Validates the POST body. An absent body means the defaults: latest nightly, no seed. */
export function parseNightlyInstallRequest(value: unknown): NightlyInstallRequest | null {
  if (value === undefined || value === null) return { tag: null, seed: false };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const tag = record.tag ?? null;
  if (tag !== null && (typeof tag !== "string" || !TAG_PATTERN.test(tag))) return null;
  if (record.seed !== undefined && typeof record.seed !== "boolean") return null;
  return { tag, seed: record.seed === true };
}

let installInProgress = false;

/**
 * Runs `scripts/nightly-sidecar.py install` from the checkout this server runs in.
 * The script prints JSON on stdout for both success and refusal. Exit code 2 means
 * a refusal such as "quit Nightly first", which maps to 409.
 */
export async function runNightlyInstall(input: {
  readonly request: NightlyInstallRequest;
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Promise<unknown> {
  const { request } = input;
  const checkout = resolveNightlySidecarCheckout({
    cwd: process.cwd(),
    env: input.env,
    buildDir: NODE_BUILD_DIR,
  });
  const blocked = nightlyInstallBlockedReason({ platform: input.platform, checkout });
  if (blocked !== null || checkout === null) {
    throw new NightlyInstallError(409, blocked ?? "No Nightly sidecar checkout was found.");
  }
  if (installInProgress) {
    throw new NightlyInstallError(409, "A Nightly install is already running.");
  }
  const args = [NodePath.join(checkout, SIDECAR_SCRIPT), "install"];
  if (request.tag !== null) args.push("--tag", request.tag);
  if (request.seed) args.push("--seed");
  installInProgress = true;
  try {
    const { stdout } = await execFileAsync("python3", args, {
      cwd: checkout,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 4 << 20,
    });
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const failure = error as {
      code?: unknown;
      stdout?: unknown;
      stderr?: unknown;
      killed?: unknown;
    };
    const stdout = typeof failure.stdout === "string" ? failure.stdout : "";
    let detail: unknown = null;
    try {
      detail = stdout ? (JSON.parse(stdout) as unknown) : null;
    } catch {
      detail = null;
    }
    if (failure.killed === true) {
      throw new NightlyInstallError(500, "The Nightly install timed out.", detail);
    }
    if (failure.code === 2) {
      throw new NightlyInstallError(409, "Nightly was not replaced.", detail);
    }
    throw new NightlyInstallError(
      500,
      typeof failure.stderr === "string" && failure.stderr.trim()
        ? failure.stderr.trim()
        : "The Nightly install failed.",
      detail,
    );
  } finally {
    installInProgress = false;
  }
}
