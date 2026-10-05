/* agent-watermark: model=opus-5.5; effort=high; duration=60m; seat=claude-code; date=2026-10-05 */
import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  defaultHandoffTarget,
  handoffMessages,
  retargetHandoff,
  validateHandoff,
} from "./handoff.logic";

function provider(instanceId: string, driver: string, models: string[], defaultSlug?: string) {
  return {
    instanceId,
    driver,
    displayName: instanceId,
    models: models.map((slug) => ({ slug, name: slug, isDefault: slug === defaultSlug })),
  } as unknown as ServerProvider;
}

const claude = provider("claude", "claudeAgent", ["sonnet", "opus"], "opus");
const claudeWork = provider("claude-work", "claudeAgent", ["sonnet"]);
const codex = provider("codex", "codex", ["gpt-6", "gpt-6-mini"], "gpt-6");

describe("handoff target", () => {
  it("prefers another driver, then another instance of the same driver", () => {
    const source = { instanceId: claude.instanceId, model: "sonnet" } as never;
    expect(defaultHandoffTarget([claude, claudeWork, codex], source)).toEqual({
      instanceId: "codex",
      model: "gpt-6",
    });
    expect(defaultHandoffTarget([claude, claudeWork], source)).toEqual({
      instanceId: "claude-work",
      model: "sonnet",
    });
    expect(defaultHandoffTarget([], source)).toBeNull();
  });

  it("switching provider picks that provider's default model", () => {
    expect(retargetHandoff([claude, codex], "claude" as never)).toEqual({
      instanceId: "claude",
      model: "opus",
    });
  });
});

describe("handoff validation", () => {
  const target = { instanceId: codex.instanceId, model: "gpt-6" };

  it("blocks while the current agent is still writing to the checkout", () => {
    const result = validateHandoff({
      target,
      providers: [codex],
      sourceRunning: true,
      hasMessages: true,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/Stop it first/);
  });

  it("needs a ready provider, a known model and something to hand off", () => {
    expect(
      validateHandoff({ target, providers: [], sourceRunning: false, hasMessages: true }).ok,
    ).toBe(false);
    expect(
      validateHandoff({
        target: { ...target, model: "retired" },
        providers: [codex],
        sourceRunning: false,
        hasMessages: true,
      }).ok,
    ).toBe(false);
    expect(
      validateHandoff({ target, providers: [codex], sourceRunning: false, hasMessages: false }).ok,
    ).toBe(false);
    expect(
      validateHandoff({ target, providers: [codex], sourceRunning: false, hasMessages: true }).ok,
    ).toBe(true);
  });

  it("leaves out messages that are still streaming", () => {
    expect(
      handoffMessages([
        { role: "user", text: "do it" },
        { role: "assistant", text: "half", streaming: true },
      ]),
    ).toEqual([{ role: "user", text: "do it" }]);
  });
});
