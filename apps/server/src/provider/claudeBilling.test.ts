/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=60m; seat=codex; date=2026-10-15 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=25m; seat=antigravity; date=2026-10-14 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=15m; seat=codex; date=2026-10-14 */
/* agent-watermark: model=opus-5.5; effort=high; duration=45m; seat=claude-code; date=2026-10-13 */
import { describe, expect, it } from "vite-plus/test";

import {
  claudeBillingEnvironment,
  claudeUsageProbeEnvironment,
  promoCreditsDescriptor,
  readClaudeCredentials,
  wantsPromoCredits,
  withPromoCreditsOption,
} from "./claudeBilling.ts";

const none = { creditKey: undefined, subscriptionToken: undefined };
const both = { creditKey: "sk-credit", subscriptionToken: "oat-sub" };

describe("claudeBilling", () => {
  it("probes subscription limits with the stored token instead of the credit/proxy key", () => {
    const base = {
      PATH: "/bin",
      ANTHROPIC_API_KEY: "credit",
      ANTHROPIC_AUTH_TOKEN: "proxy",
      ANTHROPIC_BASE_URL: "http://localhost:9999",
    };
    expect(claudeUsageProbeEnvironment(base, both)).toEqual({
      PATH: "/bin",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_BASE_URL: "",
      CLAUDE_CODE_OAUTH_TOKEN: "oat-sub",
    });
    expect(claudeUsageProbeEnvironment(base, none)).toEqual({
      PATH: "/bin",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_BASE_URL: "",
    });
    expect(base.ANTHROPIC_API_KEY).toBe("credit");
  });
  it("never reads credentials under a test runner unless asked, and then never the real Keychain", () => {
    expect(readClaudeCredentials({ VITEST: "true" }, () => "keychain")).toEqual(none);
    expect(
      readClaudeCredentials({
        T3CODE_CLAUDE_BILLING: "1",
        T3CODE_CLAUDE_SUBSCRIPTION_TOKEN: "oat",
      }),
    ).toEqual({ creditKey: undefined, subscriptionToken: "oat" });
    expect(readClaudeCredentials({ T3CODE_CLAUDE_BILLING: "0" }, () => "keychain")).toEqual(none);
  });

  it("the switch defaults on until a subscription token exists, then off", () => {
    expect(promoCreditsDescriptor(none)).toMatchObject({
      id: "promoCredits",
      type: "boolean",
      currentValue: true,
    });
    expect(promoCreditsDescriptor(both)).toMatchObject({ currentValue: false });
    expect(wantsPromoCredits(undefined, none)).toBe(true);
    expect(wantsPromoCredits(undefined, both)).toBe(false);
    expect(wantsPromoCredits(true, both)).toBe(true);
  });

  it("adds the option once, after the model's own options", () => {
    const caps = {
      optionDescriptors: [{ id: "fastMode", label: "Fast Mode", type: "boolean" as const }],
    };
    const once = withPromoCreditsOption(caps, none);
    expect(once.optionDescriptors?.map((d) => d.id)).toEqual(["fastMode", "promoCredits"]);
    expect(withPromoCreditsOption(once, none)).toBe(once);
  });

  it("credits: the credit key replaces any key and the subscription token is removed", () => {
    const base = { PATH: "/bin", ANTHROPIC_API_KEY: "other", CLAUDE_CODE_OAUTH_TOKEN: "oat-old" };
    const credit = claudeBillingEnvironment(base, true, both);
    expect(credit).toMatchObject({ ok: true, billing: "credits" });
    if (!credit.ok) return;
    expect(credit.env.ANTHROPIC_API_KEY).toBe("sk-credit");
    expect(credit.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(base.CLAUDE_CODE_OAUTH_TOKEN).toBe("oat-old");
    const login = claudeBillingEnvironment(
      { PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "x" },
      true,
      none,
    );
    expect(login.ok && login.env).toEqual({ PATH: "/bin" });
  });

  it("subscription: the token is set and API keys are removed; without one it refuses with the fix", () => {
    const sub = claudeBillingEnvironment(
      { ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t" },
      false,
      both,
    );
    expect(sub.ok && sub.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "oat-sub" });
    const refused = claudeBillingEnvironment({}, false, none);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toMatch(/claude setup-token/);
  });
});
