/* agent-watermark: model=haiku-5.5; effort=high; duration=55m; seat=claude-code; date=2026-10-12 */
// The router runs the pair route's beforeLoad twice for one link: once with the token and
// once after the root route has stripped it from the address bar. The second run carries no
// error message and can land in a different module instance, so the rejection is kept in
// session storage for the render. It is cleared when the user asks for the token form again.
const LINK_REJECTED_KEY = "t3code:pairing-link-rejected";
// The flag only bridges the two beforeLoad runs and the first render. Once it is this old it
// is stale, so a later visit to /pair without a link shows the plain token form, not "expired".
const LINK_REJECTED_TTL_MS = 60_000;

// The gate reports a rejected credential with this message. Any other failure (a server error,
// a session cookie that never arrived) is not a rejected link and keeps its own message.
const REJECTED_PAIRING_MESSAGE = /^Invalid pairing token/i;

/**
 * True only when a link's token was rejected: the page arrived with a token in its hash, the
 * browser is still signed out, and the gate reported a credential rejection. A desktop bootstrap
 * rejection has no link, so it never counts.
 */
export function isRejectedPairingLink(input: {
  readonly arrivedWithToken: boolean;
  readonly requiresAuth: boolean;
  readonly errorMessage: string | undefined;
}): boolean {
  return (
    input.arrivedWithToken &&
    input.requiresAuth &&
    REJECTED_PAIRING_MESSAGE.test(input.errorMessage ?? "")
  );
}

export function readLinkRejected(): boolean {
  try {
    const stored = Number(window.sessionStorage.getItem(LINK_REJECTED_KEY));
    return Number.isFinite(stored) && Date.now() - stored < LINK_REJECTED_TTL_MS;
  } catch {
    return false;
  }
}

export function writeLinkRejected(rejected: boolean): void {
  try {
    if (rejected) {
      window.sessionStorage.setItem(LINK_REJECTED_KEY, String(Date.now()));
    } else {
      window.sessionStorage.removeItem(LINK_REJECTED_KEY);
    }
  } catch {
    // Storage can be blocked; the card then falls back to the gate's own message.
  }
}
