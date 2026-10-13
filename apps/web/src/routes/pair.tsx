/* agent-watermark: model=haiku-5.5; effort=high; duration=90m; seat=claude-code; date=2026-10-12 */
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { APP_DISPLAY_NAME } from "../branding";
import {
  HostedPairingRouteSurface,
  PairingPendingSurface,
  PairingRouteSurface,
} from "../components/auth/PairingRouteSurface";
import {
  isRejectedPairingLink,
  readLinkRejected,
  writeLinkRejected,
} from "../components/auth/pairingLinkRejected";
import { Button } from "../components/ui/button";

export const Route = createFileRoute("/pair")({
  beforeLoad: async ({ context, location }) => {
    const { authGateState } = context;
    if (authGateState.status === "authenticated" || authGateState.status === "hosted-static") {
      writeLinkRejected(false);
      throw redirect({ to: "/", replace: true });
    }

    // The router location still carries the hash the link arrived with. Only the first of the two
    // runs has the gate's error message, so only that run records the rejection.
    const arrivedWithToken = new URLSearchParams(location.hash).has("token");
    if (
      isRejectedPairingLink({
        arrivedWithToken,
        requiresAuth: authGateState.status === "requires-auth",
        errorMessage:
          authGateState.status === "requires-auth" ? authGateState.errorMessage : undefined,
      })
    ) {
      writeLinkRejected(true);
    }
    return {
      authGateState,
    };
  },
  component: PairRouteView,
  pendingComponent: PairRoutePendingView,
});

function PairRouteView() {
  const { authGateState } = Route.useRouteContext();
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);

  if (!authGateState) {
    return null;
  }

  if (authGateState.status === "hosted-pairing") {
    return <HostedPairingRouteSurface />;
  }

  // The rejection was recorded by beforeLoad from the link's own token. Anything else the gate
  // reports (a server error, a session that never established) shows in the token form.
  if (!retrying && readLinkRejected()) {
    return (
      <ExpiredPairingLinkCard
        onRetry={() => {
          writeLinkRejected(false);
          setRetrying(true);
        }}
      />
    );
  }

  return (
    <PairingRouteSurface
      auth={authGateState.auth}
      onAuthenticated={() => {
        void navigate({ to: "/", replace: true });
      }}
      {...(authGateState.errorMessage ? { initialErrorMessage: authGateState.errorMessage } : {})}
    />
  );
}

function PairRoutePendingView() {
  return <PairingPendingSurface />;
}

const PAIR_COMMAND = "npx t3 pair";

/**
 * Shown when the link's token was rejected: already used, expired, or not valid for this server.
 * Explains why, gives the one command that mints a fresh link, and offers a retry that opens the
 * token form again.
 */
function ExpiredPairingLinkCard({ onRetry }: { readonly onRetry: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyCommand = () => {
    void navigator.clipboard
      .writeText(PAIR_COMMAND)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-amber-500)_12%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section
        role="alert"
        className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8"
      >
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          This pairing link didn&apos;t work
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Pairing links work once and then expire. This one was already used, ran out of time, or is
          not valid for this server, so this browser cannot connect with it.
        </p>

        <div className="mt-6 space-y-2">
          <p className="text-sm font-medium">Get a new link</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Run this on the computer that hosts T3 Code, then open the link it prints.
          </p>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5 font-mono text-sm">
            <span className="min-w-0 truncate">
              <span className="mr-2 text-muted-foreground">$</span>
              {PAIR_COMMAND}
            </span>
            <Button size="xs" variant="ghost" onClick={copyCommand} aria-live="polite">
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={onRetry}>
            Enter a token instead
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              writeLinkRejected(false);
              window.location.reload();
            }}
          >
            Reload app
          </Button>
        </div>
      </section>
    </div>
  );
}
