/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=25m; seat=antigravity; date=2026-10-17 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=60m; seat=codex; date=2026-10-15 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=25m; seat=antigravity; date=2026-10-14 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=15m; seat=codex; date=2026-10-14 */
/**
 * Model rate lookup and cost arithmetic.
 *
 * Rates come from LiteLLM's `model_prices_and_context_window.json`, the same
 * table `ccusage` prices against. Everything here is pure: fetching and caching
 * the table lives in `UsageService`.
 *
 * @module usagePricing
 */
import type {
  UsageCostSource,
  UsageModelPriceOverride,
  UsageTokenTotals,
} from "@t3tools/contracts";

/**
 * The subset of a LiteLLM entry we price against. All values are USD per token.
 *
 * Context tiers use the per-request input length, including cached input.
 * A model with no trustworthy rate remains unpriced.
 */
export interface ModelRate {
  readonly inputCostPerToken: number;
  readonly outputCostPerToken: number;
  readonly cacheReadCostPerToken: number;
  readonly cacheCreationCostPerToken: number;
  readonly cacheCreation1hCostPerToken?: number;
  readonly missingRates?: readonly (
    | "input"
    | "output"
    | "cacheRead"
    | "cacheCreation"
    | "cacheCreation1h"
  )[];
  readonly contextTiers?: readonly { readonly aboveTokens: number; readonly rate: ModelRate }[];
}

export type RateTable = ReadonlyMap<string, ModelRate>;

/** Custom IDs keep their case, provider prefix, and variant suffix. */
export function createOverrideRateTable(
  overrides: Readonly<Record<string, UsageModelPriceOverride>>,
): RateTable {
  return new Map(
    Object.entries(overrides).map(([model, prices]) => [
      model.trim(),
      {
        inputCostPerToken: prices.inputCostPerMillionTokens / 1_000_000,
        outputCostPerToken: prices.outputCostPerMillionTokens / 1_000_000,
        cacheReadCostPerToken:
          (prices.cacheReadCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        cacheCreationCostPerToken:
          (prices.cacheWriteCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
      },
    ]),
  );
}

/** Raw shape of one LiteLLM entry, narrowed to the fields we read. */
interface LiteLlmEntry {
  readonly input_cost_per_token?: unknown;
  readonly output_cost_per_token?: unknown;
  readonly cache_read_input_token_cost?: unknown;
  readonly cache_creation_input_token_cost?: unknown;
  readonly cache_creation_input_token_cost_above_1hr?: unknown;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Projects the LiteLLM document into a rate table.
 *
 * Entries without both an input and an output rate are dropped: a half-priced
 * model would silently under-report cost, which is worse than reporting the
 * model as unpriced.
 *
 * Entries keep their full normalized key; a bare name is aliased only when no
 * canonical entry exists and every qualified entry has the same rate.
 */
export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== "object" || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as LiteLlmEntry;
    const input = finiteNumber(entry.input_cost_per_token);
    const output = finiteNumber(entry.output_cost_per_token);
    if (input === null || output === null) continue;

    const key = normalizeRateKey(name);
    if (key.length === 0) continue;
    const base: ModelRate = {
      inputCostPerToken: input,
      outputCostPerToken: output,
      // Missing category rates are placeholders only; priceUsage refuses
      // to quote a request that uses an unpublished category.
      missingRates: [
        ...(finiteNumber(entry.cache_read_input_token_cost) === null ? ["cacheRead" as const] : []),
        ...(finiteNumber(entry.cache_creation_input_token_cost) === null
          ? ["cacheCreation" as const]
          : []),
        ...(finiteNumber(entry.cache_creation_input_token_cost_above_1hr) === null
          ? ["cacheCreation1h" as const]
          : []),
      ],
      cacheReadCostPerToken: finiteNumber(entry.cache_read_input_token_cost) ?? input,
      cacheCreationCostPerToken: finiteNumber(entry.cache_creation_input_token_cost) ?? input,
      ...(finiteNumber(entry.cache_creation_input_token_cost_above_1hr) === null
        ? {}
        : {
            cacheCreation1hCostPerToken: finiteNumber(
              entry.cache_creation_input_token_cost_above_1hr,
            )!,
          }),
    };
    const rawFields = raw as Record<string, unknown>;
    const tiers: { aboveTokens: number; rate: ModelRate }[] = [];
    for (const threshold of [100, 128, 200, 272, 512]) {
      const suffix = `_above_${threshold}k_tokens`;
      const tierInput = finiteNumber(rawFields[`input_cost_per_token${suffix}`]);
      const tierOutput = finiteNumber(rawFields[`output_cost_per_token${suffix}`]);
      if (tierInput === null && tierOutput === null) continue;
      const oneHour = finiteNumber(rawFields[`cache_creation_input_token_cost_above_1hr${suffix}`]);
      tiers.push({
        aboveTokens: threshold * 1000,
        rate: {
          inputCostPerToken: tierInput ?? input,
          outputCostPerToken: tierOutput ?? output,
          missingRates: [
            ...(tierInput === null ? ["input" as const] : []),
            ...(tierOutput === null ? ["output" as const] : []),
            ...(finiteNumber(rawFields[`cache_read_input_token_cost${suffix}`]) === null
              ? ["cacheRead" as const]
              : []),
            ...(finiteNumber(rawFields[`cache_creation_input_token_cost${suffix}`]) === null
              ? ["cacheCreation" as const]
              : []),
            ...(oneHour === null ? ["cacheCreation1h" as const] : []),
          ],
          cacheReadCostPerToken:
            finiteNumber(rawFields[`cache_read_input_token_cost${suffix}`]) ??
            base.cacheReadCostPerToken,
          cacheCreationCostPerToken:
            finiteNumber(rawFields[`cache_creation_input_token_cost${suffix}`]) ??
            base.cacheCreationCostPerToken,
          ...(oneHour === null ? {} : { cacheCreation1hCostPerToken: oneHour }),
        },
      });
    }
    table.set(key, tiers.length > 0 ? { ...base, contextTiers: tiers } : base);
  }

  // `null` marks a bare name claimed at conflicting rates: no alias for it.
  const aliasCandidates = new Map<string, ModelRate | null>();
  for (const [key, rate] of table) {
    const alias = bareModelName(key);
    if (alias.length === 0 || alias === key || table.has(alias)) continue;
    const held = aliasCandidates.get(alias);
    if (held === undefined) {
      aliasCandidates.set(alias, rate);
    } else if (held !== null && !sameRate(held, rate)) {
      aliasCandidates.set(alias, null);
    }
  }
  for (const [alias, rate] of aliasCandidates) {
    if (rate !== null) table.set(alias, rate);
  }

  return table;
}

function sameRate(a: ModelRate, b: ModelRate): boolean {
  return (
    a.inputCostPerToken === b.inputCostPerToken &&
    a.outputCostPerToken === b.outputCostPerToken &&
    a.cacheReadCostPerToken === b.cacheReadCostPerToken &&
    a.cacheCreationCostPerToken === b.cacheCreationCostPerToken &&
    a.cacheCreation1hCostPerToken === b.cacheCreation1hCostPerToken &&
    JSON.stringify(a.missingRates) === JSON.stringify(b.missingRates) &&
    JSON.stringify(a.contextTiers) === JSON.stringify(b.contextTiers)
  );
}

function normalizeRateKey(model: string): string {
  return model.trim().toLowerCase();
}

function bareModelName(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}

/**
 * Drops bracketed variant suffixes such as `claude-fable-5-1[1m]`, and reasoning/tier
 * suffixes such as `-high`, `-medium`, `-low`, `-thinking`, `-extended-thinking`.
 */
function stripVariantSuffix(key: string): string {
  const bracket = key.indexOf("[");
  let base = bracket === -1 ? key : key.slice(0, bracket);
  base = base.replace(/-(?:high|medium|low|thinking|extended-thinking)$/, "");
  return base;
}

/**
 * Models we never price, regardless of the table.
 *
 * `<synthetic>` marks locally generated messages that were never billed.
 */
const UNPRICEABLE_MODELS = new Set([
  "<synthetic>",
  "synthetic",
]);

/**
 * Common bare family names used by CLI transcripts and proxies map to the
 * active generation in the model catalog when present in the rate table.
 */
const BARE_MODEL_CANONICAL: Readonly<Record<string, string>> = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
  haiku: "claude-haiku-4-5",
  fable: "claude-fable-5-1",
};

export function lookupRate(table: RateTable, model: string): ModelRate | null {
  const exactKey = normalizeRateKey(model);
  const exact = table.get(exactKey);
  if (exact !== undefined && !UNPRICEABLE_MODELS.has(bareModelName(exactKey))) return exact;
  const key = stripVariantSuffix(exactKey);
  const bareName = bareModelName(key);
  if (bareName.length === 0 || UNPRICEABLE_MODELS.has(bareName)) return null;

  const direct = table.get(key);
  if (direct !== undefined) return direct;

  const canonical = BARE_MODEL_CANONICAL[bareName];
  if (canonical !== undefined) {
    const canonicalRate = table.get(canonical) ?? table.get(`anthropic/${canonical}`);
    if (canonicalRate !== undefined) return canonicalRate;
  }

  // Antigravity records can emit "gemini-3.8-flash", "gemini-3.8-pro", etc. without provider prefix,
  // which LiteLLM sometimes indexes under vertex_ai/gemini-*.
  if (key.startsWith("gemini-") && !key.includes("/")) {
    const vertexMatch = table.get(`vertex_ai/${key}`);
    if (vertexMatch !== undefined) return vertexMatch;
  }

  return null;
}

function rateForInput(rate: ModelRate | null, totals: UsageTokenTotals): ModelRate | null {
  if (rate === null) return null;
  const context =
    totals.uncachedInputTokens + totals.cachedInputTokens + totals.cacheCreationTokens;
  let selected = rate;
  for (const tier of rate.contextTiers ?? []) {
    if (context > tier.aboveTokens) selected = tier.rate;
  }
  return selected;
}

export interface PricedUsage {
  readonly costUsd: number;
  readonly costSource: UsageCostSource;
}

/**
 * Prices a bucket's tokens.
 *
 * `reasoningTokens` is intentionally not charged separately: it is already
 * counted inside `outputTokens`.
 */
export function priceUsage(
  table: RateTable,
  model: string,
  totals: UsageTokenTotals,
  reportedCostUsd: number | null,
  overrides?: RateTable,
  cacheCreation1hTokens = 0,
  pricingUnsupported = false,
): PricedUsage {
  const override = overrides?.get(model.trim());
  if (
    override === undefined &&
    reportedCostUsd !== null &&
    Number.isFinite(reportedCostUsd) &&
    reportedCostUsd >= 0
  ) {
    return { costUsd: reportedCostUsd, costSource: "providerReported" };
  }

  if (override === undefined && pricingUnsupported) return { costUsd: 0, costSource: "unpriced" };
  const rate = override ?? rateForInput(lookupRate(table, model), totals);
  if (rate === null) return { costUsd: 0, costSource: "unpriced" };

  const oneHourTokens = Math.min(totals.cacheCreationTokens, Math.max(0, cacheCreation1hTokens));
  const quantities = {
    input: totals.uncachedInputTokens,
    output: totals.outputTokens,
    cacheRead: totals.cachedInputTokens,
    cacheCreation: totals.cacheCreationTokens - oneHourTokens,
    cacheCreation1h: oneHourTokens,
  };
  if (rate.missingRates?.some((kind) => quantities[kind] > 0)) {
    return { costUsd: 0, costSource: "unpriced" };
  }
  // An explicit override owns all cache writes; fallback to 1h rate, standard cache creation rate, or 2x input rate.
  const oneHourRate =
    override?.cacheCreationCostPerToken ??
    rate.cacheCreation1hCostPerToken ??
    rate.cacheCreationCostPerToken ??
    rate.inputCostPerToken * 2;
  const costUsd =
    totals.uncachedInputTokens * rate.inputCostPerToken +
    totals.cachedInputTokens * rate.cacheReadCostPerToken +
    (totals.cacheCreationTokens - oneHourTokens) * rate.cacheCreationCostPerToken +
    oneHourTokens * oneHourRate +
    totals.outputTokens * rate.outputCostPerToken;

  return { costUsd, costSource: "modelPriced" };
}

/**
 * What the cached input would have cost at full input rates, minus what it
 * actually cost. Drives the "cache savings" figure.
 */
export function cacheSavingsUsd(
  table: RateTable,
  model: string,
  totals: UsageTokenTotals,
  overrides?: RateTable,
): number {
  const rate = overrides?.get(model.trim()) ?? rateForInput(lookupRate(table, model), totals);
  if (rate === null || rate.missingRates?.some((kind) => kind === "input" || kind === "cacheRead"))
    return 0;
  return totals.cachedInputTokens * (rate.inputCostPerToken - rate.cacheReadCostPerToken);
}
