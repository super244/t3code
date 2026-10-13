/* agent-watermark: model=haiku-5.5; effort=high; duration=70m; seat=claude-code; date=2026-10-12 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { TruncatedText } from "./TruncatedText";

describe("TruncatedText", () => {
  it("renders as a plain element until a browser measures it as cut off", () => {
    const markup = renderToStaticMarkup(<TruncatedText text="Run command" className="truncate" />);
    expect(markup).toBe('<span class="truncate">Run command</span>');
  });

  it("wraps the text in a tooltip when the caller forces one", () => {
    const markup = renderToStaticMarkup(
      <TruncatedText text="Run command" tooltip className="truncate" />,
    );
    expect(markup).toContain('data-base-ui-tooltip-trigger=""');
    expect(markup).toContain("Run command");
  });

  it("stays plain when the caller says the text is already shown in full", () => {
    const long = "Read apps/web/src/components/chat/MessagesTimeline.tsx lines 1 to 200";
    const markup = renderToStaticMarkup(
      <TruncatedText text={long} tooltip={false} className="truncate" />,
    );
    expect(markup).toBe(`<span class="truncate">${long}</span>`);
  });
});
