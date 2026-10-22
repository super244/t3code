<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=8m; seat=codex; date=2026-10-17 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=60m; seat=codex; date=2026-10-15 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=26m; seat=codex; date=2026-10-01 -->
<!-- agent-watermark: model=grok-4.7; effort=default; duration=40m; seat=cursor; date=2026-09-30 -->
<!-- agent-watermark: model=gemini-3.8-flash; effort=high; duration=8m; seat=antigravity; date=2026-10-01 -->

<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=20m; seat=codex; date=2026-10-02 -->

# Usage and limits

## Understand your usage

**Usage** combines Codex, Claude Code, Grok Build, OpenCode, and Antigravity session history from your connected environments. It shows token use, cache savings, model breakdowns, and estimated API-equivalent cost. These estimates are not your subscription bill.

Claude usage preserves the original transcript-row accounting: each recorded usage row contributes, including rows sharing a message ID. Refreshing or restarting does not add those same stored rows again. One-hour cache writes use their own rate. Unknown model prices and missing published cache or context-tier rates remain visibly unpriced rather than receiving a guessed rate.

Promo-credit spend and subscription limits are separate. The cost estimate does not establish your remaining promotional balance; use the provider's account balance for that. Missing quota data remains unavailable rather than appearing as zero usage.

Usage includes archived Codex sessions and separately configured Claude/Codex transcript homes. Long-context requests use the published context-tier rates. Unreadable files and malformed usage mark history incomplete. Unsupported billing modifiers or tool surcharges remain unpriced unless a provider quote or explicit rate override establishes the cost. “Known cost only” is a subtotal, not a complete bill; unpriced rows are not free. JSON/CSV exports preserve full numeric precision and cost-coverage details.

A connected harness stays on the page even when the selected window has no tokens. OpenCode is read from its local database. Antigravity is read from the IDE, CLI, and T3 Code conversation stores. Switch to **All** when recent windows look empty.

Move the period slider from 1 hour through 5 years, or choose **All**, to compare exact rolling
hourly activity with longer calendar-day trends. **Cost** always means what the same tokens would
cost at configured API rates. It does not mean T3 Code charged your subscription that amount.

Choose a harness on web, desktop, or mobile to focus every usage total, chart, model, and cache metric on that provider. Choose **All harnesses** to restore the combined view. Your choice is saved on the device. This filter applies to usage history; subscription Limits continue to show the accounts in your selected environments.

## Usage by project

Choose **Project** under **Breakdown** to see cost and tokens per project for the selected window and harness. Claude Code records which project each session ran in; other harnesses' usage appears as **Not recorded**. A project whose folder no longer exists keeps its usage under its last folder name.

## Compare usage rates

The recorded usage rate shows average tokens and API-equivalent cost per day, plus the cost of 30 days at the same rate. Hourly windows use their exact rolling duration. Longer windows include every selected calendar day, including quiet days; **All** uses the span from the first through last recorded day. An empty history has no rate.

These rates describe available history. Missing or unpriced records reduce the totals, and the current calendar day may be incomplete. The 30-day amount is a comparison at the same rate, not a bill or forecast.

Set a **Target** to compare the 30-day API-equivalent amount against your chosen amount. It follows the selected window, environments, and harness; it does not limit agent runs or track subscription payments. Incomplete history or unpriced usage shows **Unknown** instead of a target status. Add missing model prices or refresh unavailable environments to complete the comparison.

Search the model breakdown by model name or harness on web, desktop, and mobile. Rows follow the selected cost or token metric. On mobile, use **Show more** to expand long model lists. The harness filter above the chart focuses the entire report; web and desktop also offer a provider filter within the model table.

## Export usage data

Open **Export** in the Usage view to export the current period and selected environments and harness:

- **Export as JSON**: Full structured export of the current window, including total metrics, cache performance, per-provider shares, pricing coverage, model usage, and chronological timeline buckets with provider totals.
- **Export as CSV**: Spreadsheet-ready summary, provider and model breakdowns, and timeline with token counts and estimated USD costs.

On mobile, Export opens the device share sheet so you can save the report to Files or send it to another app.

Totalling and timestamps automatically adjust to the active period and time zone.

Totals depend on the history available on each server. Grok turns without a saved completed-turn
record are missing from the totals.

On web and desktop, use the environment dropdown to filter costs, tokens, and limits. All
environments are selected by default. The dropdown shows which environments are still scanning;
results appear as each one responds.

If recent work is missing or a new model shows no cost, refresh to rescan session history and
update model pricing.

To inspect excluded costs, choose **Model → Needs pricing** (web/desktop) or **By model → Needs pricing** (mobile). Search still applies. Each affected model shows its unpriced record count. Its token total includes both priced and unpriced records; the filter does not change your window totals. Use a documented rate or your provider invoice before setting an override.

## Set custom model prices

On web or desktop, open the environment dropdown on **Usage**, then choose **Model prices** to add,
edit, or reset a model's estimated price. **Apply to** starts with your current Usage filter;
choose all environments or select individual destinations. Enter the exact model ID and USD
rates per million input and output tokens. You can enter any model ID, including models
without public pricing.

Cache read and cache write rates are optional and use the input rate when blank. Enter `0` for
tokens that are free. Saved prices replace automatic pricing for all of that environment's
history and are shared with clients connected to it. When environments have different prices,
cells show **Mixed**. Edit rates directly in the table, then choose **Save changes** to apply all
edited rows. Untouched cells keep each environment's rate. Select one environment to inspect its
prices. **Reset to automatic** marks a model's override for removal when you save; you can undo
it before saving.

Each destination reports whether the change saved. Offline or unavailable environments are
marked **Not saved**. Reconnect them and choose **Retry failed saves** to finish the same change
without writing again to environments that already saved. Changes are not queued after you close
the dialog.

## Track subscription limits

Antigravity uses its signed-in Google account to report model quota and reset times. Claude Code requires subscription OAuth credentials to report subscription quota; an API-key or promo-credit proxy login cannot provide those percentages. Missing quota is explained above the available bars.

Quota readings show when they were read. Readings at least 15 minutes old are marked for refresh; a reset countdown alone does not establish a fresh balance. Multi-account percentages are equal averages of reported percentages, not capacity-weighted balances across different plans.

**Usage → Limits** pools every subscription account it can see per provider, so with several Codex
or Claude accounts across your environments and hubs you read one number per window rather than a
list. Each window card shows how much of the pool is left and a bar with one segment per account,
kept in the same column across windows. Accounts are ordered by their 5-hour reset, soonest
first, or by the first available window when no account reports a 5-hour limit. A gap means the
account does not report that window. When the provider reports reset times, the card also says
when the next reset lands and how much it hands back. The hatched
part of a segment is what that reset restores. Tap a segment or account row for the account's plan,
where it is signed in, and its reset time. On web, you can hover too. Codex accounts with banked
reset credits show a ticket count and the **Use reset** action in the account details. On narrow screens, numbered rows below
the bar show each account's quota, countdown, and credits. Tap a row to open its details.

The same account signed in on more than one environment, or reported by a hub as well, counts once.
Filter with the environment dropdown to see what a single machine has.

If a window looks stale, refresh Limits to re-check every provider and hub.

Pick `/usage-limits` from the composer's command menu, or send it as a message, to check the
current model's limits without leaving the conversation. The result opens above the composer and
closes when you dismiss it or send your next message. It uses the same snapshot as **Usage → Limits**, so it does not run the agent or refresh
anything. The command is offered only for providers that appear under **Usage → Limits**.

API-key accounts may not report subscription limits. This also applies to Claude connections
using a proxy through `ANTHROPIC_AUTH_TOKEN`.

## Connect a CLIProxyAPI hub

To see pooled accounts, open **Settings → Providers → Usage providers → Add hub**. Choose the
environment that will connect to the hub and enter its URL and management key.

The accounts appear under **Usage → Limits**. Codex accounts show banked reset credits; select an
account and choose **Use reset** to redeem one. No hub plugin is required.

This connection supplies usage information; configure
the provider separately to send agent requests through the hub. Remove the hub from the same
settings section when you no longer need it.
