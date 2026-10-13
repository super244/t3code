/* agent-watermark: model=haiku-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-12 */

/** Role of one line inside a diff fence, read from its leading marker. */
export type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";

/** Fence languages whose lines carry +/- markers worth tinting. */
const DIFF_FENCE_LANGUAGES: ReadonlySet<string> = new Set(["diff", "patch"]);

// Shiki emits one `<span class="line">` per source line, with token spans
// inside it. A line ends at the `</span>` that is followed by a newline or by
// the closing `</code>`, so the lazy match cannot stop on an inner token.
const SHIKI_LINE_PATTERN = /<span class="line">([\s\S]*?)<\/span>(?=\n|<\/code>)/g;

/**
 * Classifies one diff line. `inHunk` says the line sits between a hunk header
 * and the end of that hunk's line counts, where `---` and `+++` are removed and
 * added content (a SQL `-- comment` removed reads as `--- comment`), not file
 * headers.
 */
export function diffLineKind(text: string, inHunk = false): DiffLineKind {
  if (!inHunk && (text.startsWith("+++") || text.startsWith("---"))) return "meta";
  if (text.startsWith("diff ") || text.startsWith("index ")) return "meta";
  if (text.startsWith("@@")) return "hunk";
  if (text.startsWith("+")) return "add";
  if (text.startsWith("-")) return "remove";
  return "context";
}

/** Lines still owed to the open hunk, from its `@@ -a,b +c,d @@` header. */
type HunkRemaining = { readonly oldLeft: number; readonly newLeft: number } | null;

const HUNK_HEADER_PATTERN = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

/** Advances the hunk state past one line. A hunk closes once its counted lines are read. */
function advanceHunk(state: HunkRemaining, text: string): HunkRemaining {
  const header = HUNK_HEADER_PATTERN.exec(text);
  if (header) {
    const oldLeft = Number(header[1] ?? 1);
    const newLeft = Number(header[2] ?? 1);
    return oldLeft > 0 || newLeft > 0 ? { oldLeft, newLeft } : null;
  }
  if (state === null || text.startsWith("\\")) return state;
  const marker = text.charAt(0);
  const oldLeft = state.oldLeft - (marker === "+" ? 0 : 1);
  const newLeft = state.newLeft - (marker === "-" ? 0 : 1);
  return oldLeft > 0 || newLeft > 0 ? { oldLeft, newLeft } : null;
}

/**
 * Tags the lines of Shiki's HTML for a diff fence with `data-diff-line`, so CSS
 * can tint whole rows. Context lines stay untouched.
 */
export function annotateDiffLineHtml(html: string): string {
  let hunk: HunkRemaining = null;
  return html.replace(SHIKI_LINE_PATTERN, (match, inner: string) => {
    const text = inner.replace(/<[^>]*>/g, "");
    const kind = diffLineKind(text, hunk !== null);
    hunk = advanceHunk(hunk, text);
    return kind === "context"
      ? match
      : `<span class="line" data-diff-line="${kind}">${inner}</span>`;
  });
}

/** Applies the diff annotation only where the fence language is a diff. */
export function annotateHighlightedCodeHtml(html: string, language: string): string {
  return DIFF_FENCE_LANGUAGES.has(language) ? annotateDiffLineHtml(html) : html;
}
