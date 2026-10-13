/* agent-watermark: model=haiku-5.5; effort=high; duration=70m; seat=claude-code; date=2026-10-12 */
import { useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * Single-line text that shows its full value on hover, but only while it is actually cut
 * off. Truncation depends on the width of the column, not the character count, so the
 * element is measured after it mounts and re-measured when its box resizes. Until then, and
 * wherever nothing can measure (server render, tests), it renders as a plain element.
 * Pass `tooltip` to force the choice.
 */
export function TruncatedText(
  props: HTMLAttributes<HTMLElement> & {
    readonly text: string;
    readonly as?: "span" | "p" | undefined;
    /** Text shown in the popup; defaults to `text`. */
    readonly tooltipText?: string | undefined;
    /** Undefined means "when the text is cut off"; true or false overrides the measurement. */
    readonly tooltip?: boolean | undefined;
  },
) {
  const { text, as = "span", tooltipText, tooltip, ...elementProps } = props;
  const Element = as;
  const ref = useRef<HTMLElement | null>(null);
  const [cutOff, setCutOff] = useState(false);
  const measure = tooltip === undefined;
  // A callback ref: `as` may be a span or a paragraph, and one ref type fits both.
  const attachRef = (node: HTMLElement | null) => {
    ref.current = node;
  };

  useLayoutEffect(() => {
    const element = ref.current;
    if (!measure || !element) return;
    const check = () => setCutOff(element.scrollWidth > element.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
    // The element is replaced when the tooltip appears, so re-attach to the new node.
  }, [measure, text, cutOff]);

  const showTooltip = tooltip ?? cutOff;
  if (!showTooltip)
    return (
      <Element ref={attachRef} {...elementProps}>
        {text}
      </Element>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<Element ref={attachRef} {...elementProps} />}>{text}</TooltipTrigger>
      <TooltipPopup>{tooltipText ?? text}</TooltipPopup>
    </Tooltip>
  );
}
