/* agent-watermark: model=haiku-5.5; effort=high; duration=30m; seat=claude-code; date=2026-10-12 */

/** Role of one line inside a diff fence, read from its leading marker. */
export type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";

/** Fence languages whose lines carry +/- markers worth tinting. */
const DIFF_FENCE_LANGUAGES: ReadonlySet<string> = new Set(["diff", "patch"]);

// Shiki emits one `<span class="line">` per source line, with token spans
// inside it. A line ends at the `</span>` that is followed by a newline or by
// the closing `</code>`, so the lazy match cannot stop on an inner token.
const SHIKI_LINE_PATTERN = /<span class="line">([\s\S]*?)<\/span>(?=\n|<\/code>)/g;

export function diffLineKind(text: string): DiffLineKind {
  if (text.startsWith("+++") || text.startsWith("---")) return "meta";
  if (text.startsWith("diff ") || text.startsWith("index ")) return "meta";
  if (text.startsWith("@@")) return "hunk";
  if (text.startsWith("+")) return "add";
  if (text.startsWith("-")) return "remove";
  return "context";
}

/**
 * Tags the lines of Shiki's HTML for a diff fence with `data-diff-line`, so CSS
 * can tint whole rows. Context lines stay untouched.
 */
export function annotateDiffLineHtml(html: string): string {
  return html.replace(SHIKI_LINE_PATTERN, (match, inner: string) => {
    const kind = diffLineKind(inner.replace(/<[^>]*>/g, ""));
    return kind === "context"
      ? match
      : `<span class="line" data-diff-line="${kind}">${inner}</span>`;
  });
}

/** Applies the diff annotation only where the fence language is a diff. */
export function annotateHighlightedCodeHtml(html: string, language: string): string {
  return DIFF_FENCE_LANGUAGES.has(language) ? annotateDiffLineHtml(html) : html;
}
