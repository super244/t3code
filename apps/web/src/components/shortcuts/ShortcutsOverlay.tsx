import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { KeyboardIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { formatShortcutLabel } from "../../keybindings";
import { cn } from "../../lib/utils";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { buildKeybindingRows, commandLabel } from "../settings/KeybindingsSettings.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Kbd, KbdGroup } from "../ui/kbd";
import {
  buildShortcutGroups,
  isTypingTarget,
  OPEN_SHORTCUTS_EVENT,
} from "./shortcutsOverlay.logic";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Split "⌘⇧K" / "Ctrl+Shift+K" into keycaps. */
function keycaps(label: string): ReadonlyArray<string> {
  const glyphs = /[\u2303\u2325\u21e7\u2318]/.test(label);
  if (!glyphs && label.length > 1 && label.includes("+")) {
    // "Ctrl++" keeps its final plus as the key.
    return label.endsWith("++") ? [...label.slice(0, -2).split("+"), "+"] : label.split("+");
  }
  const caps: string[] = [];
  let rest = label;
  while (rest.length > 0 && /^[⌃⌥⇧⌘]/.test(rest)) {
    caps.push(rest[0] as string);
    rest = rest.slice(1);
  }
  if (rest) caps.push(rest);
  return caps;
}

function Shortcut({ label }: { label: string }) {
  return (
    <KbdGroup>
      {keycaps(label).map((cap) => (
        <Kbd
          key={cap}
          className="min-w-6 border border-border/70 bg-background px-1.5 text-foreground shadow-xs"
        >
          {cap}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

/**
 * Keyboard shortcuts, read from the live keybindings config so a rebinding in
 * Settings shows here immediately. Opens on ⌘/ (Ctrl+/), on `?` outside text
 * fields, and from the command palette.
 */
export function ShortcutsOverlay() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const mod = IS_MAC ? event.metaKey : event.ctrlKey;
      const slash =
        (event.key === "/" || event.code === "Slash") && mod && !event.altKey && !event.shiftKey;
      const question =
        event.key === "?" && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target);
      if (!slash && !question) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    const onOpen = () => setOpen(true);
    // Capture, so a focused composer cannot swallow ⌘/ before it reaches us.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    };
  }, []);

  const groups = useMemo(() => {
    if (!open) return [];
    const bindings = buildKeybindingRows(keybindings, "").map((row) => ({
      command: row.command,
      label: commandLabel(row.command),
      keyLabel: formatShortcutLabel(row.binding.shortcut),
      when: row.when,
      custom: row.source === "Custom",
    }));
    return buildShortcutGroups({ bindings, query: deferredQuery });
  }, [deferredQuery, keybindings, open]);

  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <DialogPopup className="max-w-3xl" initialFocus={searchRef}>
        <DialogHeader className="gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <KeyboardIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-lg">Keyboard shortcuts</DialogTitle>
              <DialogDescription className="text-xs">
                Your live bindings, including the ones you changed.
              </DialogDescription>
            </div>
          </div>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search actions or keys…"
              aria-label="Search shortcuts"
              className="pl-8"
              data-keybinding-capture=""
            />
          </div>
        </DialogHeader>
        <DialogPanel className="pt-1">
          {groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {query ? `No shortcut matches “${query}”.` : "No keybindings are configured."}
            </p>
          ) : (
            <div className="columns-1 gap-8 md:columns-2">
              {groups.map((group) => (
                <section key={group.id} className="mb-5 break-inside-avoid">
                  <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.title}
                  </h3>
                  <ul className="divide-y divide-border/60">
                    {group.entries.map((entry) => (
                      <li
                        key={`${entry.command}-${entry.context ?? ""}`}
                        className="flex items-center justify-between gap-3 py-1.5"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
                          <span className="truncate">{entry.label}</span>
                          {entry.context ? (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              · {entry.context}
                            </span>
                          ) : null}
                          {entry.custom ? (
                            <Badge variant="info" size="sm" className="shrink-0">
                              custom
                            </Badge>
                          ) : null}
                        </span>
                        <span className={cn("flex shrink-0 items-center gap-1.5")}>
                          {entry.keys.map((key, index) => (
                            <span key={key} className="flex items-center gap-1.5">
                              {index > 0 ? (
                                <span className="text-[11px] text-muted-foreground">or</span>
                              ) : null}
                              <Shortcut label={key} />
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </DialogPanel>
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {total} shortcuts · <Shortcut label={IS_MAC ? "⌘/" : "Ctrl+/"} /> or{" "}
            <Shortcut label="?" /> opens this
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(false);
              void navigate({ to: "/settings/keybindings" });
            }}
          >
            Customize shortcuts
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
