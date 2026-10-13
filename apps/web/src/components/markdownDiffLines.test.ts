/* agent-watermark: model=haiku-5.5; effort=high; duration=35m; seat=claude-code; date=2026-10-12 */
import { describe, expect, it } from "vite-plus/test";

import {
  annotateDiffLineHtml,
  annotateHighlightedCodeHtml,
  diffLineKind,
} from "./markdownDiffLines";

// Real Shiki (github-light, lang diff) output for a three-line diff.
const SHIKI_DIFF_HTML = [
  '<pre class="shiki github-light" style="background-color:#fff;color:#24292e" tabindex="0"><code>',
  '<span class="line"><span style="color:#B31D28">- await sleep(250);</span></span>',
  '<span class="line"><span style="color:#22863A">+ await waitForReady(server);</span></span>',
  '<span class="line"><span style="color:#24292E">  context line</span></span>',
  '<span class="line"></span></code></pre>',
].join("\n");

describe("diffLineKind", () => {
  it("reads add and remove from the leading marker", () => {
    expect(diffLineKind("+ await waitForReady(server);")).toBe("add");
    expect(diffLineKind("- await sleep(250);")).toBe("remove");
  });

  it("treats file headers and hunk headers as meta, not as changes", () => {
    expect(diffLineKind("--- a/src/index.ts")).toBe("meta");
    expect(diffLineKind("+++ b/src/index.ts")).toBe("meta");
    expect(diffLineKind("diff --git a/x b/x")).toBe("meta");
    expect(diffLineKind("index 3f2a..9b1c 100644")).toBe("meta");
    expect(diffLineKind("@@ -1,3 +1,3 @@")).toBe("hunk");
  });

  it("leaves context lines and empty lines as context", () => {
    expect(diffLineKind("  context line")).toBe("context");
    expect(diffLineKind("")).toBe("context");
  });
});

/** Shiki-shaped HTML for plain diff lines, one `line` span each. */
function diffHtml(lines: readonly string[]): string {
  return [
    '<pre class="shiki" tabindex="0"><code>',
    ...lines.map((line) => `<span class="line">${line}</span>`),
    '<span class="line"></span></code></pre>',
  ].join("\n");
}

/** The data-diff-line tag of each input line, or null for untagged context lines. */
function kindsOf(lines: readonly string[]): (string | null)[] {
  const rows = annotateDiffLineHtml(diffHtml(lines)).split("\n");
  // Row 0 opens the <pre>, so the input lines start at row 1.
  return lines.map((_, index) => /data-diff-line="(\w+)"/.exec(rows[index + 1] ?? "")?.[1] ?? null);
}

describe("diff lines that look like file headers inside a hunk", () => {
  it("reads a removed line that starts with -- as a removal, not a file header", () => {
    expect(diffLineKind("--- remove this SQL comment", true)).toBe("remove");
    expect(diffLineKind("+++i;", true)).toBe("add");
    expect(diffLineKind("--- a/src/index.ts")).toBe("meta");
  });

  it("tints removed and added lines inside a hunk", () => {
    expect(kindsOf(["@@ -1,2 +1,2 @@", "--- remove this SQL comment", "+++i;", " keep"])).toEqual([
      "hunk",
      "remove",
      "add",
      null,
    ]);
  });

  it("still treats the headers of the next file as meta once a hunk has ended", () => {
    expect(
      kindsOf([
        "@@ -1 +1 @@",
        "-x",
        "diff --git a/b.sql b/b.sql",
        "--- a/b.sql",
        "+++ b/b.sql",
        "@@ -1 +1 @@",
        "+y",
      ]),
    ).toEqual(["hunk", "remove", "meta", "meta", "meta", "hunk", "add"]);
  });
});

describe("annotateDiffLineHtml", () => {
  it("tags add and remove rows and leaves context rows untouched", () => {
    const annotated = annotateDiffLineHtml(SHIKI_DIFF_HTML);

    expect(annotated).toContain(
      '<span class="line" data-diff-line="remove"><span style="color:#B31D28">- await sleep(250);</span></span>',
    );
    expect(annotated).toContain(
      '<span class="line" data-diff-line="add"><span style="color:#22863A">+ await waitForReady(server);</span></span>',
    );
    expect(annotated).toContain(
      '<span class="line"><span style="color:#24292E">  context line</span></span>',
    );
    expect(annotated).toContain('<span class="line"></span></code>');
  });

  it("keeps every token span and line break so the markup still renders as before", () => {
    const annotated = annotateDiffLineHtml(SHIKI_DIFF_HTML);

    expect(annotated.replace(/ data-diff-line="\w+"/g, "")).toBe(SHIKI_DIFF_HTML);
  });

  it("does not treat a minus sign inside a line as the line's marker", () => {
    const html =
      '<span class="line"><span style="color:#24292E">  return a - b;</span></span>\n' +
      '<span class="line"></span></code>';

    expect(annotateDiffLineHtml(html)).toBe(html);
  });
});

describe("annotateHighlightedCodeHtml", () => {
  it("annotates diff and patch fences only", () => {
    expect(annotateHighlightedCodeHtml(SHIKI_DIFF_HTML, "diff")).toContain('data-diff-line="add"');
    expect(annotateHighlightedCodeHtml(SHIKI_DIFF_HTML, "patch")).toContain(
      'data-diff-line="remove"',
    );
    expect(annotateHighlightedCodeHtml(SHIKI_DIFF_HTML, "ts")).toBe(SHIKI_DIFF_HTML);
  });
});
