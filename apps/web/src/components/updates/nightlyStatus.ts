/* agent-watermark: model=opus-5.5; effort=high; duration=25m; seat=claude-code; date=2026-10-12 */
// The Nightly panel reads the server's view of upstream (shared-state guard, installed
// Nightly) rather than the browser's GitHub check, because only the server can see the
// state directory and /Applications. Auth mirrors the primary HTTP layer: the session
// cookie for a same-origin browser, the desktop bearer token otherwise.
import type { UpstreamStatus } from "@t3tools/shared/upstream";

import { readDesktopPrimaryBearerToken } from "../../environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";

export interface NightlyInstallResult {
  readonly ok: boolean;
  readonly message: string;
}

async function serverRequest(pathname: string, init: RequestInit = {}): Promise<Response> {
  const url = resolvePrimaryEnvironmentHttpUrl(pathname);
  const sameOrigin =
    typeof window !== "undefined" &&
    window.desktopBridge === undefined &&
    new URL(url).origin === window.location.origin;
  const headers = new Headers(init.headers);
  if (!sameOrigin) {
    const token = await readDesktopPrimaryBearerToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers, credentials: sameOrigin ? "include" : "omit" });
}

export async function fetchServerUpstreamStatus(): Promise<UpstreamStatus> {
  const response = await serverRequest("/api/upstream/status");
  if (!response.ok) throw new Error(`The server answered ${response.status}.`);
  return (await response.json()) as UpstreamStatus;
}

/** Runs the server's sidecar installer; a refusal (409) carries the reason to show. */
export async function installNightlyOnServer(input: {
  readonly tag?: string;
  readonly seed: boolean;
}): Promise<NightlyInstallResult> {
  const response = await serverRequest("/api/upstream/nightly/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body: unknown = await response.json().catch(() => null);
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (!response.ok) {
    const reason =
      typeof record.error === "string" ? record.error : `Install failed (${response.status}).`;
    return { ok: false, message: reason };
  }
  // The installer answers {installed, new_version, reason?}; "installed: false" with a reason
  // means nothing needed replacing (e.g. already installed and isolated).
  const version = typeof record.new_version === "string" ? record.new_version : null;
  if (record.installed === false) {
    const reason = typeof record.reason === "string" ? record.reason : "nothing to replace";
    return { ok: true, message: `No change: ${reason}.` };
  }
  return {
    ok: true,
    message: version
      ? `Installed ${describeNightlyVersion(version)}. Open it from Applications.`
      : "Installed.",
  };
}

/** "0.0.46-nightly.20261012.3021" -> "Oct 12 · build 3021"; anything else passes through. */
export function describeNightlyVersion(version: string): string {
  const match = /-nightly\.(\d{4})(\d{2})(\d{2})\.(\d+)$/.exec(version);
  if (!match) return version;
  const [, year, month, day, build] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${label} · build ${build}`;
}
