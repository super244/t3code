/* agent-watermark: model=muse-spark; effort=high; duration=45m; seat=opencode; date=2026-10-10 */
import { describe, expect, it } from "vite-plus/test";

import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";
import {
  getProviderOrchestrationDecision,
  PROVIDER_ORCHESTRATION_DECISIONS,
} from "./orchestrationDecisions.ts";

describe("provider orchestration decisions", () => {
  it("covers every built-in driver with no extras", () => {
    const driverKinds = BUILT_IN_DRIVERS.map((driver) => driver.driverKind).toSorted();
    expect(Object.keys(PROVIDER_ORCHESTRATION_DECISIONS).toSorted()).toEqual(driverKinds);
  });

  it("supports native conversation rollback everywhere except Antigravity", () => {
    for (const driver of BUILT_IN_DRIVERS) {
      const expected = driver.driverKind === "antigravity" ? "unsupported" : "native";
      expect(getProviderOrchestrationDecision(driver.driverKind)?.conversationRollback).toBe(
        expected,
      );
    }
  });

  it("keeps model switching in-session and interactive response native", () => {
    for (const driver of BUILT_IN_DRIVERS) {
      const decision = getProviderOrchestrationDecision(driver.driverKind);
      expect(decision?.sessionModelSwitch).toBe("in-session");
      expect(decision?.interactiveResponse).toBe("native");
    }
  });

  it("reserves promptless continuation for Codex", () => {
    for (const driver of BUILT_IN_DRIVERS) {
      expect(getProviderOrchestrationDecision(driver.driverKind)?.promptlessTurnContinuation).toBe(
        driver.driverKind === "codex",
      );
    }
  });

  it("declares each driver's compaction path", () => {
    expect(getProviderOrchestrationDecision("codex" as never)?.compaction).toEqual({
      kind: "native",
    });
    expect(getProviderOrchestrationDecision("opencode" as never)?.compaction).toEqual({
      kind: "native",
    });
    expect(getProviderOrchestrationDecision("cursor" as never)?.compaction).toEqual({
      kind: "slash-command",
      command: "/compress",
    });
    for (const driverKind of ["claudeAgent", "grok", "antigravity"] as const) {
      expect(getProviderOrchestrationDecision(driverKind as never)?.compaction).toEqual({
        kind: "slash-command",
        command: "/compact",
      });
    }
  });

  it("returns undefined for unknown driver kinds", () => {
    expect(getProviderOrchestrationDecision("ollama" as never)).toBeUndefined();
  });
});
