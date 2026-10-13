/* agent-watermark: model=haiku-5.5; effort=high; duration=25m; seat=claude-code; date=2026-10-13 */
import { useAtomValue } from "@effect/atom-react";

import { shortcutKeycapTokens } from "../CommandPalette.logic";
import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { Kbd, KbdGroup } from "../ui/kbd";
import { FIRST_THREAD_GUIDE_ITEMS } from "./firstThreadGuide.logic";

/**
 * Three inline notes under the first draft's example prompts. Static cards,
 * not an overlay: nothing blocks the composer, and they disappear with the
 * first thread. Shortcut keycaps read the live binding, so a customized key
 * shows the key the user actually has.
 */
export function FirstThreadGuide() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  return (
    <section
      aria-label="Getting started"
      className="pointer-events-auto mx-auto mt-3 flex w-full max-w-3xl flex-col gap-1.5 text-left sm:mt-5 sm:grid sm:grid-cols-3 sm:gap-2"
    >
      {FIRST_THREAD_GUIDE_ITEMS.map((item) => {
        const shortcutLabel = shortcutLabelForCommand(keybindings, item.shortcut);
        return (
          <div
            key={item.id}
            className="flex min-w-0 items-baseline gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-1.5 sm:block sm:rounded-xl sm:px-3.5 sm:py-3"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 sm:w-auto">
              <h2 className="text-xs font-medium whitespace-nowrap text-foreground">
                {item.title}
              </h2>
              {shortcutLabel ? (
                <KbdGroup
                  aria-label={`Shortcut ${shortcutLabel}`}
                  className="hidden shrink-0 gap-0.5 sm:inline-flex"
                >
                  {shortcutKeycapTokens(shortcutLabel).map((token) => (
                    <Kbd key={token} className="h-4.5 min-w-4.5 px-1 text-[0.7rem] leading-none">
                      {token}
                    </Kbd>
                  ))}
                </KbdGroup>
              ) : null}
            </div>
            <p className="min-w-0 flex-1 overflow-hidden text-xs text-ellipsis whitespace-nowrap text-muted-foreground sm:mt-1 sm:leading-relaxed sm:whitespace-normal">
              <span className="sm:hidden">{item.compactBody}</span>
              <span className="hidden sm:inline">{item.body}</span>
            </p>
          </div>
        );
      })}
    </section>
  );
}
