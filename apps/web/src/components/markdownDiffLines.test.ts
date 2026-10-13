/* agent-watermark: model=haiku-5.5; effort=high; duration=30m; seat=claude-code; date=2026-10-12 */
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
