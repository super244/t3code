/* agent-watermark: model=haiku-5.5; effort=high; duration=55m; seat=claude-code; date=2026-10-12 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { isRejectedPairingLink, readLinkRejected, writeLinkRejected } from "./pairingLinkRejected";

function stubSessionStorage(storage: Record<string, string>) {
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => (key in storage ? storage[key] : null),
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
    },
  });
}

describe("pairing link rejected flag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is false until a rejection is written, and cleared by writing false", () => {
    stubSessionStorage({});
    expect(readLinkRejected()).toBe(false);

    writeLinkRejected(true);
    expect(readLinkRejected()).toBe(true);

    writeLinkRejected(false);
    expect(readLinkRejected()).toBe(false);
  });

  it("stops reporting a rejection once it is stale, so a plain visit shows the token form", () => {
    stubSessionStorage({});
    writeLinkRejected(true);

    vi.advanceTimersByTime(59_000);
    expect(readLinkRejected()).toBe(true);

    vi.advanceTimersByTime(2_000);
    expect(readLinkRejected()).toBe(false);
  });

  it("ignores a legacy or garbage stored value instead of treating it as a rejection", () => {
    stubSessionStorage({ "t3code:pairing-link-rejected": "1" });
    expect(readLinkRejected()).toBe(false);
  });

  it("degrades to no rejection when session storage throws", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() => writeLinkRejected(true)).not.toThrow();
    expect(readLinkRejected()).toBe(false);
  });
});

describe("isRejectedPairingLink", () => {
  const rejected = "Invalid pairing token. Check the token and try again.";

  it("records a rejection only for a link whose token the server refused", () => {
    expect(
      isRejectedPairingLink({ arrivedWithToken: true, requiresAuth: true, errorMessage: rejected }),
    ).toBe(true);
  });

  it("does not call a server failure during the exchange an expired link", () => {
    expect(
      isRejectedPairingLink({
        arrivedWithToken: true,
        requiresAuth: true,
        errorMessage:
          "Primary environment request failed during exchange-bootstrap-credential (HTTP 500).",
      }),
    ).toBe(false);
  });

  it("does not call a session that never established an expired link", () => {
    expect(
      isRejectedPairingLink({
        arrivedWithToken: true,
        requiresAuth: true,
        errorMessage: "Timed out waiting for authenticated session after bootstrap.",
      }),
    ).toBe(false);
  });

  it("does not treat a desktop bootstrap rejection as a link, since no token arrived in the URL", () => {
    expect(
      isRejectedPairingLink({
        arrivedWithToken: false,
        requiresAuth: true,
        errorMessage: rejected,
      }),
    ).toBe(false);
  });

  it("ignores a rejection once the browser is already signed in", () => {
    expect(
      isRejectedPairingLink({
        arrivedWithToken: true,
        requiresAuth: false,
        errorMessage: rejected,
      }),
    ).toBe(false);
  });
});
