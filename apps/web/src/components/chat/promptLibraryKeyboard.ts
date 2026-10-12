/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-03 */
export type PromptLibraryKeyAction = "close" | "next" | "previous" | "restore" | "delete" | null;
/** Menu shortcuts must leave native button activation, text editing and IME input intact. */
export function promptLibraryKeyAction(input: {
  readonly key: string;
  readonly isComposing: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly target: "search" | "button" | "editable" | "other";
}): PromptLibraryKeyAction {
  if (input.isComposing) return null;
  if (input.key === "Escape") return "close";
  if (input.target === "editable") return null;
  if (input.key === "Backspace" && (input.metaKey || input.ctrlKey)) {
    return input.target === "search" ? null : "delete";
  }
  if (input.metaKey || input.ctrlKey || input.altKey) return null;
  if (input.key === "ArrowDown") return "next";
  if (input.key === "ArrowUp") return "previous";
  if (input.key === "Enter" && input.target !== "button") return "restore";
  return null;
}
