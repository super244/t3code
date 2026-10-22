/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=60m; seat=codex; date=2026-10-15 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=25m; seat=antigravity; date=2026-10-14 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=15m; seat=codex; date=2026-10-14 */
import { describe, expect, it } from "@effect/vitest";

import {
  cacheSavingsUsd,
  createOverrideRateTable,
  lookupRate,
  parseRateTable,
  priceUsage,
} from "./usagePricing.ts";

const rate = (input: number, cacheRead?: number) => ({
  input_cost_per_token: input,
  output_cost_per_token: input * 5,
  ...(cacheRead === undefined ? {} : { cache_read_input_token_cost: cacheRead }),
});

describe("usage pricing", () => {
  it("keeps unpublished cache and partial tier rates unpriced instead of inheriting cheaper base rates", () => {
    const table = parseRateTable({
      example: {
        input_cost_per_token: 1e-6,
        output_cost_per_token: 2e-6,
        cache_read_input_token_cost: 0.1e-6,
        cache_creation_input_token_cost: 1.25e-6,
        cache_creation_input_token_cost_above_1hr: 2e-6,
        input_cost_per_token_above_200k_tokens: 2e-6,
        output_cost_per_token_above_200k_tokens: 4e-6,
        input_cost_per_token_above_512k_tokens: 3e-6,
      },
      missing: rate(1e-6),
    });
    const tokens = {
      uncachedInputTokens: 200001,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 10,
      reasoningTokens: 0,
    };
    expect(priceUsage(table, "example", tokens, null).costUsd).toBeCloseTo(0.400042);
    for (const [extra, oneHour] of [
      [{ cachedInputTokens: 1 }, 0],
      [{ cacheCreationTokens: 1 }, 0],
      [{ cacheCreationTokens: 1 }, 1],
      [{ uncachedInputTokens: 512001 }, 0],
    ] as const) {
      expect(
        priceUsage(table, "example", { ...tokens, ...extra }, null, undefined, oneHour).costSource,
      ).toBe("unpriced");
    }
    expect(
      priceUsage(table, "missing", { ...tokens, cacheCreationTokens: 1 }, null).costSource,
    ).toBe("unpriced");
    expect(priceUsage(table, "example", { ...tokens, cacheCreationTokens: 1 }, 1.5).costUsd).toBe(
      1.5,
    );
    expect(priceUsage(table, "missing", tokens, -1).costSource).toBe("modelPriced");
  });

  it("prefers exact variant prices and never erases generation suffixes", () => {
    const table = parseRateTable({
      base: rate(1e-6),
      "base-high": rate(3e-6),
      "base[1m]": rate(4e-6),
    });
    expect(lookupRate(table, "base-high")?.inputCostPerToken).toBe(3e-6);
    expect(lookupRate(table, "base[1m]")?.inputCostPerToken).toBe(4e-6);
    for (const model of ["base-preview", "base-exp", "base-latest"]) {
      expect(lookupRate(table, model)).toBeNull();
    }
  });

  it("uses the full request context to apply published long-context rates", () => {
    const table = parseRateTable({
      "tier-model": {
        input_cost_per_token: 1e-6,
        output_cost_per_token: 2e-6,
        cache_read_input_token_cost: 0.1e-6,
        input_cost_per_token_above_272k_tokens: 2e-6,
        output_cost_per_token_above_272k_tokens: 4e-6,
        cache_read_input_token_cost_above_272k_tokens: 0.2e-6,
      },
    });
    const short = {
      uncachedInputTokens: 1000,
      cachedInputTokens: 271000,
      cacheCreationTokens: 0,
      outputTokens: 100,
      reasoningTokens: 0,
    };
    expect(priceUsage(table, "tier-model", short, null).costUsd).toBeCloseTo(0.0283);
    const long = { ...short, cachedInputTokens: 272000 };
    expect(priceUsage(table, "tier-model", long, null).costUsd).toBeCloseTo(0.0568);
    expect(cacheSavingsUsd(table, "tier-model", long)).toBeCloseTo(0.4896);
  });

  it("does not invent prices for missing models or recorded unsupported billing modifiers", () => {
    const table = parseRateTable({ known: rate(1e-6) });
    const tokens = {
      uncachedInputTokens: 100,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 10,
      reasoningTokens: 0,
    };
    expect(priceUsage(table, "antigravity", tokens, null).costSource).toBe("unpriced");
    expect(priceUsage(table, "known", tokens, null, undefined, 0, true).costSource).toBe(
      "unpriced",
    );
    expect(priceUsage(table, "known", tokens, 1.5, undefined, 0, true).costUsd).toBe(1.5);
    expect(parseRateTable({ invalid: rate(-1) }).size).toBe(0);
  });

  it("prices mixed 5m and 1h Claude writes without charging the same tokens twice", () => {
    const table = parseRateTable({
      "claude-example": {
        input_cost_per_token: 4 / 1e6,
        output_cost_per_token: 20 / 1e6,
        cache_creation_input_token_cost: 5 / 1e6,
        cache_creation_input_token_cost_above_1hr: 8 / 1e6,
      },
    });
    const writes = {
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 1000000,
      outputTokens: 0,
      reasoningTokens: 0,
    };
    expect(
      priceUsage(table, "claude-example", writes, null, undefined, 600000).costUsd,
    ).toBeCloseTo(6.8);
    expect(priceUsage(table, "claude-example", writes, 9, undefined, 600000).costUsd).toBe(9);
    const overrides = createOverrideRateTable({
      "claude-example": {
        inputCostPerMillionTokens: 2,
        outputCostPerMillionTokens: 10,
        cacheWriteCostPerMillionTokens: 3,
      },
    });
    expect(priceUsage(table, "claude-example", writes, null, overrides, 600000).costUsd).toBe(3);
  });
  const totals = {
    uncachedInputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
    outputTokens: 1_000_000,
    reasoningTokens: 500_000,
  };

  it("uses custom token rates ahead of public and provider-reported costs", () => {
    const table = parseRateTable({ "example-model": rate(1) });
    const overrides = createOverrideRateTable({
      "example-model": {
        inputCostPerMillionTokens: 2,
        outputCostPerMillionTokens: 8,
        cacheReadCostPerMillionTokens: 0.5,
        cacheWriteCostPerMillionTokens: 3,
      },
    });

    for (const reportedCostUsd of [null, 99]) {
      expect(priceUsage(table, "example-model", totals, reportedCostUsd, overrides)).toEqual({
        costUsd: 13.5,
        costSource: "modelPriced",
      });
    }
    expect(cacheSavingsUsd(table, "example-model", totals, overrides)).toBe(1.5);
  });

  it("prices unknown models offline and uses input prices for omitted cache rates", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      "example-model": { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 },
    });

    expect(priceUsage(table, "example-model", totals, null, overrides)).toEqual({
      costUsd: 14,
      costSource: "modelPriced",
    });
    expect(cacheSavingsUsd(table, "example-model", totals, overrides)).toBe(0);
  });

  it("preserves explicit zero rates and matches only the exact trimmed model ID", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      " vendor/example-model[1m] ": {
        inputCostPerMillionTokens: 0,
        outputCostPerMillionTokens: 0,
      },
    });
    expect(priceUsage(table, " vendor/example-model[1m] ", totals, 99, overrides)).toEqual({
      costUsd: 0,
      costSource: "modelPriced",
    });
    for (const model of [
      "example-model[1m]",
      "vendor/example-model",
      "vendor/Example-model[1m]",
      "other/example-model[1m]",
    ]) {
      expect(priceUsage(table, model, totals, null, overrides).costSource).toBe("unpriced");
      expect(priceUsage(table, model, totals, 99, overrides)).toEqual({
        costUsd: 99,
        costSource: "providerReported",
      });
    }
  });

  it("keeps the canonical Fable rate separate from DeepInfra in either order", () => {
    const canonical = ["claude-fable-5", rate(1e-5, 1e-6)] as const;
    const deepInfra = ["deepinfra/anthropic/claude-fable-5", rate(1e-5)] as const;

    for (const entries of [
      [canonical, deepInfra],
      [deepInfra, canonical],
    ]) {
      const table = parseRateTable(Object.fromEntries(entries));

      expect(lookupRate(table, "claude-fable-5")?.cacheReadCostPerToken).toBe(1e-6);
      expect(lookupRate(table, "deepinfra/anthropic/claude-fable-5")?.cacheReadCostPerToken).toBe(
        1e-5,
      );
      expect(lookupRate(table, "other/claude-fable-5")).toBeNull();
    }
  });

  it("prices a bracketed context-tier variant at the base model's rate", () => {
    const table = parseRateTable({ "claude-fable-5-1": rate(1e-5, 2.5e-7) });

    expect(lookupRate(table, "claude-fable-5-1[1m]")).toEqual(
      lookupRate(table, "claude-fable-5-1"),
    );
    expect(lookupRate(table, "anthropic/Claude-Fable-5-1[1m]")).toBeNull();
  });

  it("adds a bare alias when every qualified entry has the same rate", () => {
    const table = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(1),
    });

    expect(lookupRate(table, "example-model")).toEqual(
      lookupRate(table, "provider-a/example-model"),
    );
  });

  it("leaves an ambiguous bare name unpriced", () => {
    const table = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(3),
    });

    expect(lookupRate(table, "provider-a/example-model")?.inputCostPerToken).toBe(1);
    expect(lookupRate(table, "provider-b/example-model")?.inputCostPerToken).toBe(3);
    expect(lookupRate(table, "example-model")).toBeNull();
  });

  it("keeps unknown generations and ambiguous family names unpriced", () => {
    const table = parseRateTable({
      "anthropic/claude-3-7-sonnet-20250219": rate(4 / 1e6, 0.4 / 1e6),
    });
    expect(lookupRate(table, "claude-3-7-sonnet-20250219")?.inputCostPerToken).toBe(4 / 1e6);
    for (const model of [
      "sonnet",
      "opus",
      "haiku",
      "claude-opus-future",
      "claude-sonnet-5",
      "claude-3-7-sonnet",
      "<synthetic>",
    ]) {
      expect(lookupRate(table, model)).toBeNull();
    }
  });

  it("prices bare Claude family names using active catalog models when present", () => {
    const table = parseRateTable({
      "claude-sonnet-5": rate(3 / 1e6, 0.3 / 1e6),
      "anthropic/claude-opus-5": rate(15 / 1e6, 1.5 / 1e6),
      "claude-haiku-4-5": rate(0.8 / 1e6, 0.08 / 1e6),
    });
    expect(lookupRate(table, "sonnet")?.inputCostPerToken).toBe(3 / 1e6);
    expect(lookupRate(table, "opus")?.inputCostPerToken).toBe(15 / 1e6);
    expect(lookupRate(table, "haiku")?.inputCostPerToken).toBe(0.8 / 1e6);
  });
});

