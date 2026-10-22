/* agent-watermark: model=haiku-5.5; effort=high; duration=15m; seat=claude-code; date=2026-10-12 */
import {
  scopedProjectKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { useRouter } from "@tanstack/react-router";
import { BellIcon, BellOffIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import { useProjects, useThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import {
  DEFAULT_AGENT_NOTIFICATION_PREFS,
  diffAgentShells,
  notificationText,
  shouldNotify,
  type AgentNotificationPrefs,
  type AgentSnapshot,
} from "./agentNotifications.logic";

interface AgentNotificationStore extends AgentNotificationPrefs {
  readonly set: (patch: Partial<AgentNotificationPrefs>) => void;
}

/** Per device: a phone and a desktop decide separately whether to buzz. */
export const useAgentNotificationPrefs = create<AgentNotificationStore>()(
  persist((set) => ({ ...DEFAULT_AGENT_NOTIFICATION_PREFS, set: (patch) => set(patch) }), {
    name: "t3code:agent-notifications:v1",
    storage: createJSONStorage(() =>
      resolveStorage(typeof window === "undefined" ? null : window.localStorage),
    ),
    partialize: ({ set: _set, ...prefs }) => prefs,
  }),
);

const supported = () => typeof window !== "undefined" && "Notification" in window;

/**
 * Watches the thread shells and raises a system notification when a thread
 * finishes, needs an approval or an answer, or fails. Clicking one focuses the
 * app on that thread. Mounted once in the app layout; renders nothing.
 */
export function AgentNotifications() {
  const prefs = useAgentNotificationPrefs();
  const shells = useThreadShells();
  const projects = useProjects();
  const router = useRouter();
  const previous = useRef<Map<string, AgentSnapshot> | null>(null);

  const projectTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const project of projects) {
      titles.set(
        scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }),
        project.title,
      );
    }
    return titles;
  }, [projects]);

  useEffect(() => {
    const keyed = shells.map((shell) => ({
      ...shell,
      key: scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)),
    }));
    const { next, events } = diffAgentShells(previous.current ?? new Map(), keyed);
    const firstObservation = previous.current === null;
    previous.current = next;
    if (firstObservation || events.length === 0 || !prefs.enabled || !supported()) return;
    if (Notification.permission !== "granted") return;
    if (prefs.onlyWhenAway && document.visibilityState === "visible" && document.hasFocus()) return;

    for (const event of events) {
      if (!shouldNotify(event, prefs)) continue;
      const shell = keyed.find((s) => s.key === event.key);
      if (!shell) continue;
      const project = projectTitles.get(
        scopedProjectKey({ environmentId: shell.environmentId, projectId: shell.projectId }),
      );
      const { title, body } = notificationText(event, project ?? null);
      const notification = showNotice(title, {
        body,
        tag: `${event.key}:${event.kind}`,
        silent: event.kind === "finished",
      });
      notification?.addEventListener("click", () => {
        window.focus();
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(shell.environmentId, shell.id)),
        });
        notification.close();
      });
    }
  }, [shells, prefs, projectTitles, router]);

  return null;
}

/**
 * A one-off system notification under the same switch and "only when away"
 * rule as the agent ones, for events that are not a thread changing state
 * (a race on autopilot finishing). Returns null when it was not shown.
 */
export function showAgentNotice(title: string, body: string): Notification | null {
  const prefs = useAgentNotificationPrefs.getState();
  if (!prefs.enabled || !supported() || Notification.permission !== "granted") return null;
  if (prefs.onlyWhenAway && document.visibilityState === "visible" && document.hasFocus()) {
    return null;
  }
  return showNotice(title, { body, tag: `t3-notice:${title}` });
}

/**
 * `new Notification` throws "Illegal constructor" on Chromium for Android; there the service worker
 * shows it instead (no click-through). Never lets the throw reach React.
 */
function showNotice(title: string, options: NotificationOptions): Notification | null {
  try {
    return new Notification(title, options);
  } catch {
    void navigator.serviceWorker?.ready
      .then((registration) => registration.showNotification(title, options))
      .catch(() => {});
    return null;
  }
}

/** Settings › General › Notifications. */
export function AgentNotificationsSettingsSection() {
  const prefs = useAgentNotificationPrefs();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    supported() ? Notification.permission : "unsupported",
  );

  async function setEnabled(enabled: boolean) {
    if (!enabled || !supported()) {
      prefs.set({ enabled: false });
      return;
    }
    // A dismissed or denied prompt leaves the switch off, rather than ON with nothing ever shown.
    const next =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    setPermission(next);
    prefs.set({ enabled: next === "granted" });
  }

  const blocked = permission === "denied" || permission === "unsupported";
  const kinds: ReadonlyArray<[keyof AgentNotificationPrefs, string, string]> = [
    ["finished", "Turn finished", "An agent finished what you asked."],
    ["approval", "Approval needed", "An agent is waiting for you to approve a command or edit."],
    ["input", "Question asked", "An agent asked you something and is waiting."],
    ["failed", "Turn failed", "A turn stopped with an error, with the error's first line."],
  ];

  return (
    <SettingsSection
      id="agent-notifications"
      title="Notifications"
      description="Alerts about agent activity, delivered by your browser or operating system."
      icon={prefs.enabled ? <BellIcon className="size-4" /> : <BellOffIcon className="size-4" />}
    >
      <SettingsRow
        title="Notify me about agents"
        description={
          permission === "unsupported"
            ? "This browser has no system notifications."
            : permission === "denied"
              ? "Notifications are blocked for T3 Code. Allow them in your system or browser settings, then switch this on."
              : "A system notification when a thread needs you or is done. Click it to jump to the thread."
        }
        control={
          <Switch
            checked={prefs.enabled && !blocked}
            disabled={blocked}
            onCheckedChange={(checked) => void setEnabled(checked)}
            aria-label="Agent notifications"
          />
        }
      />
      {prefs.enabled && !blocked ? (
        <>
          {kinds.map(([key, title, description]) => (
            <SettingsRow
              key={key}
              title={title}
              description={description}
              control={
                <Switch
                  checked={Boolean(prefs[key])}
                  onCheckedChange={(checked) => prefs.set({ [key]: checked })}
                  aria-label={title}
                />
              }
            />
          ))}
          <SettingsRow
            title="Only while T3 Code is in the background"
            description="Off also notifies while you are looking at another thread."
            control={
              <Switch
                checked={prefs.onlyWhenAway}
                onCheckedChange={(checked) => prefs.set({ onlyWhenAway: checked })}
                aria-label="Only while in the background"
              />
            }
          />
          <SettingsRow
            title="Test"
            description="Send one now to see how it looks on this device."
            control={
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  showNotice("Finished · T3 Code", {
                    body: "This is how a finished turn will look.",
                    tag: "t3code:test",
                  })
                }
              >
                Send test
              </Button>
            }
          />
        </>
      ) : null}
    </SettingsSection>
  );
}
