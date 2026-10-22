<!-- agent-watermark: model=opus-5.5; effort=high; duration=95m; seat=claude-code; date=2026-10-22 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=45m; seat=codex; date=2026-10-21 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-20 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-19 -->
<!-- agent-watermark: model=opus-5.5; effort=high; duration=110m; seat=claude-code; date=2026-10-18 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-15 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=13m; seat=codex; date=2026-10-14 -->
<!-- agent-watermark: model=haiku-5.5; effort=high; duration=70m; seat=claude-code; date=2026-10-12 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-10 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=19m; seat=codex; date=2026-10-08 -->
<!-- agent-watermark: model=gemini-3.8-flash; effort=medium; duration=20m; seat=antigravity; date=2026-10-08 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=56m; seat=codex; date=2026-10-07 -->
<!-- agent-watermark: model=muse-spark; effort=high; duration=50m; seat=opencode; date=2026-10-07 -->
<!-- agent-watermark: model=opus-5.5; effort=high; duration=20m; seat=claude-code; date=2026-10-06 -->
<!-- agent-watermark: model=opus-5.5; effort=high; duration=60m; seat=claude-code; date=2026-10-05 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=34m; seat=codex; date=2026-10-04 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-03 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=1m; seat=codex; date=2026-10-02 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-01 -->
<!-- agent-watermark: model=grok-4.7; effort=default; duration=73m; seat=cursor; date=2026-09-30 -->
<!-- agent-watermark: model=gemini-3.8-flash; effort=high; duration=45m; seat=antigravity; date=2026-10-02 -->

# CONTEXT — t3code

> Agents: read this before touching code in this project.
> **Status:** external clone — contributing fork | **Last updated:** 2026-10-12
> **Linear:** —

## What this is

Third-party agent-harness control surface (T3 Code) created by `pingdotgg/t3code`. It provides an Electron desktop app, web app, and mobile apps to orchestrate AI agents (Claude Code, Codex, Cursor, Grok, OpenCode, Google Antigravity).

This is **not** a MyLifeOS product: Luca's contributions are aimed upstream. The local repository is an active clone / contributing fork (`super244/t3code`).

## Direction

**Becoming:** Clean upstream contributions, custom tooling integrations, and harness extensions where needed.

**Non-goals:**

- Do not integrate into the MyLifeOS vault index (its `.repos/` and `node_modules/` are excluded from indexing).
- Do not fork into a separate permanent proprietary product unless explicitly directed.

## Stack

| Layer         | Choice                                                               |
| ------------- | -------------------------------------------------------------------- |
| Language      | TypeScript / Node.js                                                 |
| Monorepo Tool | pnpm workspace / Turborepo                                           |
| Apps          | Electron desktop app, React web app                                  |
| Harness       | Multi-agent provider adapter (Claude Code, Codex, Antigravity, etc.) |

## Key paths

```
apps/           # Desktop, web, and cli applications
packages/       # Shared workspace libraries
docs/           # Project documentation
```

## Changelog

**2026-10-22 — Persistent memory (branch `claude/v1-t3code-3664a7`).** Luca asked for features he uses (layout, scheduled tasks, skills, memory, accurate usage/cost) rather than Race. Memory: per-project and "Everywhere" facts in `userdata/memory.json`; every new provider session (all six harnesses) gets the newest entries prepended to its first prompt (`ProviderService.sendTurn`, once per session); agents get `remember` / `recall` / `forget` on the `t3-code` MCP server; Settings → Memory and a Memory section on the project home page add, edit and forget entries. Tested (store, rules, MCP grant, injection once per session); saving from Settings verified live. Not verified live: a real agent answering from memory and an agent calling `remember` (the run was stopped). Mobile has no memory screen yet. Skills editing and usage-accuracy work were started in separate worktrees and stopped unfinished; not on this branch.

**2026-10-22 — Race autopilot (branch `claude/v1-t3code-3664a7`, not pushed).** Built on the unmerged Arena, scoreboard and rematch branches (`goal/t3-w1-*`, fast-forwarded in). A race started with **Autopilot** (Race page composer, "Race this prompt", or later from its arena) judges itself once every entrant stops and, if asked, squash-merges the judge's pick and discards the rest, records the result and notifies. Any open web/desktop client runs it (`RaceAutopilotHost`); each step is claimed with the compare-and-set `race.advanceAutopilot`, so only one client acts. Plans live in `race-history.json` beside the records. The arena shows the stage with Stop / Turn on again, and board cards carry a badge. Verified live on an isolated dev server: Claude Haiku 5.5 vs Sonnet 5.5 on the `.t3` demo repo, page parked on Home → judge started by itself at 40s → Entrant 1 kept into `main` at 101s (18/18 tests in the demo repo, loser discarded, record `kept` with costs). A race whose task was already done stopped with "No entrant changed any files". Follow-up the same day: Stop was verified live mid-race (both entrants then finished with changes and no judge was started), and a rematch ran on autopilot (heat 2 with participants 1–3; judge picked defending Entrant 2, kept into `main`, heat 1 stays "no winner"). The autopilot choice (on, judge, keep) is now remembered per browser, so the judge no longer silently defaults to the first provider. Mobile does not run autopilot.
**2026-10-19 — Mobile Race evidence (local, not committed).** Home Command center → Races and Settings → Race history open a new native screen over the existing typed Race RPC. Choose a connected computer, search prompts/models/failures, filter project/task/outcome/30-day window, inspect winner/judge/entrant failures and reported costs, and page retained records 20 at a time. The shared leaderboard uses the full filtered set, including explicit price coverage. JSON/CSV sharing captures all matches through the established attachment cache; unknown prices remain null/blank, and abort/temporary-file cleanup follow native lifetime. Offline computers and older unsupported hosts produce explicit unavailable/error states rather than an empty success.

Mobile typecheck and touched-file lint/format pass (existing warnings outside the added hunks remain). Four existing shared/settings/navigation/attachment suites pass 47 checks, and the iOS Expo export bundles successfully (19 MB Hermes). The React skill checklist was applied to state derivation, bounded rows, lazy export imports, abort lifetime and accessible controls. No tests or dependencies were added, and no live T3 userdata/provider call was used. Browser/mobile UI verification still awaits the explicit permission required by AGENTS.md; this is not enterprise-v1 completion.

**2026-10-19 — Filtered Race evidence and quota connection repair (local, not committed).** Race Scoreboard now searches retained prompts/models/failures and filters by project+computer, outcome, task kind and last 30 days. It renders 20 history rows per page, with the leaderboard and JSON/CSV exports covering every matching loaded record. Offline computers, missing prices and the 500-record per-computer retention bound remain explicit. Exports refuse incomplete/error-loading views; CSV quotes cells and neutralizes formulas. `RaceHistoryListInput` adds typed filters/paging; the server and web share `queryRaceHistory`, with additive optional total/offset/retention metadata for older clients. The stale `makePromoCreditsWindow` import in ClaudeProvider was also removed: subscription quotas now use subscription responses only; relay dollar spend remains separate.

Verification: web/server typechecks pass, focused Race history suites pass 14 tests and quota mapping passes 9 existing tests; touched-file lint/format pass. A temporary persisted Effect store exercised search, outcome/paging, reopen, unknown-cost blanks and formula escaping. No new tests, provider calls, live-userdata writes or commits. T3 browser QA requires explicit permission per AGENTS.md; permission was requested and is pending. Native/mobile interaction and enterprise-v1 readiness remain unverified.

**2026-10-19 — Race from anywhere, and a scoreboard of who wins what (branch `goal/t3-w1-race-anywhere`, not pushed).** **Race this prompt** opens from every thread menu (sidebar and header), the command palette, and a flag button next to Send whenever the composer has text. It offers the thread's last request or the typed text, a compact 2–3 agent picker, and the thread's project and branch, and it warns when that checkout has uncommitted changes the entrants won't see. Then it opens the arena. Entrant and judge threads show a "Compare" pill linking back to their arena, and the palette offers "Compare this race". Board cards now count +/− from the same `review.getDiffPreview` the arena reads, so untracked files count; that is the shared `useEntrantReport`. **Race history:** new `race.recordResult` / `race.listHistory` / `race.forgetResult` RPCs (`packages/contracts/src/raceHistory.ts`) persist to `<userdata>/race-history.json` through `apps/server/src/race/RaceHistoryStore.ts`, with a per-file lock and merge rules in `packages/shared/src/raceHistory.ts`: a decision is never reopened, a decided race's entrant lines are frozen, and a kind the user picked beats a guess. Keep (arena or board), the judge's verdict and **No winner** all record. Claude's SDK `total_cost_usd` is now a `turn.cost` activity, hidden from both work logs. **Race → Scoreboard** shows wins, keep rate, judge picks, median time, median reported cost and failures per harness+model, leaders per kind of task, and an editable history. Verified live on an isolated dev server: three real races (Claude Haiku 5.5 / Sonnet 5, with Codex failing on "usage limit reached" at 09:18 and shown as failed), started from the composer, the thread menu and the Race page. One was judged by Haiku 5.5 and kept, one closed with no winner, and one kept by hand. Recorded costs were $0.0098 to $0.308 for Claude and none for Codex. Typecheck is clean in web, server, mobile, contracts and shared. Targeted suites pass (web 182, server 329, contracts 387, shared race 21, mobile threadActivity 101). `vp lint` shows no errors in touched files.

**2026-10-18 — Race Arena: watch entrants side by side, compare their diffs, ask a judge (branch `goal/t3-w1-race-arena`, not pushed).** **Compare** on a race opens `/race?race=<id>`: one lane per entrant with its live transcript (messages, commands, edits), elapsed time and +/− from the worktree's real diff (committed + uncommitted + untracked, via `review.getDiffPreview`, re-read every 4 s while it works); a "Changes compared" matrix lines files up across entrants and opens any file as side-by-side `FileDiff`s; **Ask the judge** starts a plan-mode thread on any ready provider with every entrant's diff (`buildRaceJudgeBrief` in `packages/shared/src/race.ts`), parses its `Winner: Entrant N` line, marks the pick and offers **Keep Entrant N**. Keep/Discard moved into `useRaceEntrantActions` (board and arena share them); entrant titles no longer read "Claude Claude …"; an entrant with no changes cannot be kept. Verified live on an isolated dev server (`--home-dir` scratch, demo repo): Claude Haiku 5.5 vs Fable 5.1 and a 3-way Codex/Sonnet 5/Haiku race streamed in the arena, Codex lanes showed "Codex usage limit reached", Haiku and Sonnet 5 judges each wrote a real verdict, and Keep Entrant 1 squash-merged 81 lines into the demo repo and discarded the loser. Web + shared typecheck clean, `vp lint`/`vp fmt --check` clean on touched files, race tests 28 + 10 pass. Mobile shows entrants and judges as ordinary threads. Not done: a "Compare race" link from an entrant's thread header and the command palette; the board card's +/− still comes from `git status` and undercounts new files.

**2026-10-12 — Premium polish: phone thread header, honest labels, safer Nightly install.** Below 768px wide the thread title stays on one line: the project opens from its favicon in a one-tap popover with "New thread", and scripts and editors sit behind a "Project tools" popover. Desktop header is unchanged. Single-line labels (tool activity, changed files, approval details, plan titles) show their full text on hover when the column cuts them off. The thread menu's "Export as Markdown" works for read-only clients, as copy does. The Upstream Nightly install refuses a malformed request body (400) instead of installing the latest Nightly; the isolation check resolves `.`, `..` and repeated slashes in `T3CODE_HOME` before comparing it with the shared home. Nightly rollback puts the running bundle back if the backup cannot be moved into place. The "pairing link has expired" flag now lapses after 60 seconds, so a later plain visit to `/pair` shows the token form instead of the expired-link card. The loading, empty and phone states for Usage, PRs, Command Center, Race, Routines and the shell landed in `df4948f6f4`.

**2026-10-09 — Thread report (branch `feat/thread-report`, not pushed).** Export a thread as Markdown or copy it as a PR description from the thread menu (sidebar, header) and ⌘K; mobile rows share it through the system sheet. Built in `client-runtime/threadReport.ts`. Opencode/antigravity `/api/enterprise/*` routes, the "99.999% SLA / Raft" fleet banner and drawer, and Enterprise branding were removed from the working tree.

**2026-10-08 — Antigravity & Claude model slug alias expansion and normalization.** Added comprehensive model slug aliases for Google Antigravity (mapping 'gemini-3.8-flash', 'flash', 'pro', 'gemini-pro', '3.8-flash', '3.8-pro', '2.5-flash', '2.5-pro' to canonical manifest identifiers) and Claude ('claude-3-7-sonnet', 'sonnet', 'haiku', 'opus') in `packages/contracts/src/model.ts`. Verified with 13 unit tests in `packages/shared/src/model.test.ts` (all 700 tests in shared suite passing). Monorepo typecheck clean across contracts and shared.

**2026-10-07 — Workspace paths and verification hardened (solo).** Antigravity resolves the longest existing ancestor before creating a file, rejects final-file symlinks escaping the workspace, and refuses resolution errors. The session scanner canonicalizes configured base/worktree roots; a real symlink-configuration regression failed before the fix and all 81 scanner tests pass afterward. Six path-focused suites pass 183 tests, and text-generation/VCS checks pass 93 tests. The macOS test root is canonicalized, fake CLI fixtures use the running Node executable, and the intended failed-commit case uses a failing hook that survives host-signing isolation. Final typecheck passes. The full monorepo test command passes (13,739 passed; existing skips retained), followed by the complete 81-test scanner rerun and final server typecheck; browser/native T3 interactions were not attempted because this project requires explicit browser approval. Existing unrelated changes and live user data are preserved; no commit was made.

2026-10-07: **Ultimate-quality pass over the dirty working tree (no commit).** Scoped gates all green: typecheck 0 errors in all six workspaces (web, server, desktop, mobile, contracts, client-runtime, shared), `vp lint` 0 errors on all 182 touched TS files (99 warnings are pre-existing react-compiler noise outside our hunks), `vp fmt --check` clean after formatting 17 files to the repo standard, and 927 tests across 61 touched test files pass (server 475, web 173→189 with desktop, packages/mobile/scripts 279). Removed orphan knip scratch `scripts/.knip-test-x79C69/`. Audited auth seams (prism/upstream routes authenticate before service access; vcsIntegrateWorktree correctly operate-scoped), read-only sqlite usage readers, upstream monitor/sync checksum + URL allowlisting, and Race entry points (palette, desktop Go menu, sidebar flag all reach `/race`; mobile-ordinary-threads claim holds). Upstream-ready: locale-independent snooze assertions in `Sidebar.snooze.test.ts`.

2026-10-06: **Gate red on this Mac was a locale bug in upstream tests.** `pnpm test` failed 2 of 4,626: `Sidebar.snooze.test.ts` asserted `/PM/i`, but on an `en_CA` Mac the correct 12-hour output is `6:00 p.m.`. The assertions now check what every locale shares (`6:00`, never `18`); the formatter was already right. Worth sending upstream. Typecheck and lint were green (lint: warnings only). **Nexus now launches T3 Code** as a web project (`node scripts/dev-runner.ts dev --home-dir ~/.t3/dev`, web :5733, Vite binds ::1 only); verified launch → online in 3 s, a Nexus restart with T3 re-adopted, and a clean stop.

2026-10-05 evening: **Review with another agent verified live** in an isolated dev server (`--home-dir` in scratch, demo repo in `.t3/`). Codex hit its usage limit, Continue moved the task to Claude Haiku 4.5, Review ran on Claude Sonnet 5.5 (2 minor findings with file:line), and "Send findings" returned them; Haiku applied both. Fixes from the pass: the palette now matches "review with"; briefs no longer print `+0 −0` for untracked files (VCS status counts lines from `git diff`, which never sees them), and the review brief points at `git status`. **The parked uncommitted tree had a misplaced-patch defect in `CommandPalette.tsx`**: three blocks were spliced into the middle of other expressions. Two were syntax errors that stopped the web app loading at all. The third left the folder browser's Home/Up/Add this folder/Retry header as a dead expression inside `onItemHighlighted`, so it never rendered. All three were moved into place with no content changed. A lint sweep of all 181 dirty TS files finds no other parse errors or unused expressions. Web and shared typecheck 0 errors; `packages/shared` handoff tests 12/12.

2026-10-05 late: a review that errors or is interrupted now offers **"Send partial findings"**, and the delivered message says the review stopped before finishing. Verified live by interrupting a streaming Haiku review. Findings-message tests added; shared handoff tests 14/14, web handoff logic 5/5.

2026-10-05 handoff: **Continue with another agent** (commit `fdd919f893`) continues a provider-locked thread
on another provider in the same checkout with a generated brief; entry from thread menus, command palette and the
failed-turn banner; threads link via the `↪ ` title prefix + brief marker (no schema change). Verified live: Codex
usage-limit → Claude finished the task; chained handoff to Haiku. Mobile shows continued threads as ordinary threads.

2026-10-04 direction: Luca explicitly prioritizes original T3 Code feature parity,
folder browsing, and direct local desktop startup over Prism compatibility. Preserve
custom features while integrating upstream UI/backend behavior. Fresh original source
was cloned at `4ee6bfd50ef4a089440d5c3662db2298da9cc50e`; full textual comparison is
outside the repo at `/tmp/t3-comparison-20261004/source.diff`. This is comparison evidence,
not proof that all differences have been reviewed or integrated. The retained installation
candidate currently has unresolved source conflicts despite an older saved verification
record; canonical and installed source are not yet reconciled. A new original-baseline
integration checkout at `/tmp/t3-feature-integration-20261004-q6e7Qb` preserves the
canonical snapshot and applies custom patches per file: 143 clean, 80 unresolved
or unapplied. Detailed results are in `/tmp/t3-comparison-20261004/integration.json`;
this checkout is not yet buildable or ready for promotion.

2026-10-04 feature pass: imported the original primary-auth fix and regression tests,
retaining silent desktop bootstrap while handling explicit URL pairing credentials and
concurrent startup correctly. A reproduced hosted-static misclassification now keeps
desktop bridge startup ahead of hosted browser build configuration. Folder browsing adds Up, Add this folder, and Retry;
existing native selection, remote browsing, cloning, and path entry remain available.
Sound controls share current session state, preview the newly selected pack, tolerate
blocked storage, bound overlapping cues, and disconnect audio nodes after playback.
93 focused auth, folder-path, and sound tests, web typecheck, and production build
passed. Scoped lint has three existing state-in-effect warnings in CommandPalette.
Installed-app startup and native interaction remain unverified for this pass.

2026-10-03 prompt search pass: web/desktop and mobile libraries now search saved
text; web/desktop also searches attachment names. Presets share word-order-independent,
Unicode-normalized search across titles, descriptions, prompts, and categories.
Keyboard restore/delete acts only on visible results and preserves native button
activation, search text editing, and IME input. Focused interaction/search tests,
scoped lint, all three affected typechecks, the web production build, and the iOS
Expo export passed. Rendered/device validation remains pending for this pass.

2026-10-03 mobile reliability pass: prompt library mutations now transform current
storage under its existing lock and receive independent durable receipts. Rapid
saves and deletes no longer replace newer entries with an older render snapshot.
The modal waits for persistence, reports failures, prevents overlapping actions,
and preserves newer drafts. Focused mobile tests, typecheck, lint, and an iOS
Expo export passed; device interaction remains unverified.

2026-10-03 reliability pass: upstream checks share validated parsing and semantic
version comparison across browser/server, preserve last known data on failures,
and offer Stable/Nightly downloads. Integration routes authenticate before
reading or mutating, read current state per request, and do not write during
route construction. Prism sync uses the configured server home, reports missing
or unsupported source settings, and uses authenticated cookie/bearer/relay
transport. The bridge requires the documented `settings.json` source; native
Prism integration and rendered UI validation are not confirmed. This is a partial
pass of the broad premium mission, not full app or upstream V2 integration.

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-08 | Added model slug alias normalization for Antigravity (`gemini-3.8-flash`, `flash`, `pro`, `gemini-pro`, etc. -> canonical manifest slugs) and Claude models in contracts (`model.ts`), wired into `AntigravityAcpSupport.ts` to resolve human aliases to available session options, and verified with unit tests in `model.test.ts` and `AntigravityAcpSupport.test.ts`.     |
| 2026-10-03 | Explicit T3 homes now isolate the Electron profile and server state. Added upstream staging with private Git-index snapshots and checksum-verified stable/nightly Mac downloads. A 30-minute Codex heartbeat resumes integration and verification; the current upstream V2 migration is not yet fully integrated into the custom app.                                        |
| 2026-10-02 | Web and mobile All usage now share a Unix-epoch query boundary. Mobile's former rolling 20-year cutoff could omit older recorded history. Short presets retain exact rolling hours; longer presets retain inclusive calendar days.                                                                                                                                           |
| 2026-10-02 | Add Project opens the selected environment's folder browser directly; desktop exposes Home and the native folder picker. Shared cron validation accepts recurring five/six/seven-field schedules and presets; finite schedules dispatch their final occurrence once.                                                                                                         |
| 2026-10-02 | Correction to the earlier spend-cap entry: the control compares a 30-day API-equivalent rate with a target; it does not enforce a spending cap or represent subscription billing. Web and mobile show unknown coverage when selected history or pricing is incomplete, and use actual ratios for warning boundaries.                                                         |
| 2026-10-02 | Added monthly spend cap & budget velocity assessment across Web & Mobile with projection badges (`on_track`, `warning`, `exceeded`). Integrated Mobile Prompt Stash & Curated Presets modal (`PromptStashModal.tsx`, `useMobilePromptStash.ts`, `promptPresets.ts`), enhanced low-quota limit alerts, and loopback listener allocation.                                      |
| 2026-10-02 | Routine client mutations resolve against current settings under the scheduler write lock. Configuration saves preserve launch history. Updated clients check the editor’s baseline atomically, preventing conflicting configuration edits from overwriting each other. Explicit actions retain the latest instructions and subscription, and edits to deleted routines fail. |
| 2026-10-01 | Scheduler mutations read current routine state inside the settings write lock. Concurrent edits, pauses, deletions and manual retries survive claims and receipt updates; rescheduling retains the last failure. Provider metadata recovers an available default when discovery omits the default flag.                                                                      |
| 2026-10-01 | Mission preparation uses environment-local project and exact provider-instance routing, initializes unsent instructions before navigation, and preserves existing drafts. Mobile routine management shares configuration/history rules with web; invalid edited schedules are rejected before persistence.                                                                   |
| 2026-10-01 | Added recorded API-equivalent cost/token averages and model search across web, desktop, and mobile. Rates use exact rolling hours or calendar-day spans including quiet days; the 30-day comparison is not subscription billing or a forecast.                                                                                                                               |
| 2026-10-01 | Added Automated Routines 1-click prompt presets (Daily Task, Health & Security, 24h Digest, Code Cleanup) and status filter pills (`Active`, `Paused`, `Failed`).                                                                                                                                                                                                            |
| 2026-10-01 | Added Command Center active mission project filter pills and dedicated desktop 'Go' menu accelerators (`CmdOrCtrl+Shift+C/U/R/K`).                                                                                                                                                                                                                                           |
| 2026-10-01 | Added CSV and JSON usage exports, failure diagnostic badges for routines, and extended quiet multi-harness visibility (OpenCode, Antigravity, Claude Code, Codex, Grok) to the mobile experience and charts.                                                                                                                                                                 |
| 2026-09-30 | Usage now reads OpenCode (`opencode.db`) and Antigravity conversation databases, and keeps a connected harness visible when the selected window has no tokens.                                                                                                                                                                                                               |
| 2026-09-30 | Global skill inventory includes OpenCode (`~/.config/opencode/skills` and `skill`).                                                                                                                                                                                                                                                                                          |
| 2026-09-30 | Command Center harness rows show 7-day tokens. Routine lists show the next run or last failure. Skills keeps an enabled harness visible when it has no global skills.                                                                                                                                                                                                        |

## Related

- **Upstream:** https://github.com/pingdotgg/t3code
- **Registry:** [`Second-Brain/PROJECTS/registry.md`](../registry.md)

2026-10-04 installed-app repair: replaced Alpha custom3 with
`0.0.45-preview.20261004.custom4`. Native inspection traced the empty workspace
and stalled version to IndexedDB backing-store failure while both channels used
`t3code-v2`. Alpha now uses `t3code-v2-alpha`; desktop native connection storage
can initialize independently of the disposable browser cache. Existing MyLifeOS
project/thread, automatic local startup, loaded Connections version, folder
browser, macOS folder chooser, and sound controls were verified in the installed
app. Server data and the shared legacy Chromium profile were preserved; Nightly
was left intact. Rollback and build evidence live under
`/Users/luca/.cache/t3code-verification/2026-10-04/`.
The packaged source is the recovered custom 0.0.45 foundation plus these fixes;
complete integration of the freshly cloned upstream and all canonical changes
remains unfinished.

## Linear queue

- [ ] update — Inspect supporting races for a model pair — 2026-10-21 implementation and focused shared/type/lint checks pass; browser/native/package verification remains open. Linear unavailable.

- [ ] update — Matched race comparisons — 2026-10-21 implementation and focused verification complete across shared/web/mobile; native/browser/package verification pending. Linear unavailable.

- [ ] update — Usage transparency and quota readability — record custom32 validation; native mobile verification remains outstanding; no Linear connection or project binding available.

- [ ] create — Model slug alias normalization for Antigravity and Claude — track upstream contribution PR.

## 2026-10-08 — Schedule preview and downtime choice

Routine editors on web/desktop and mobile preview the next five occurrences using the same cron parser as the environment scheduler. Catch-up remains enabled by default; disabling it skips an occurrence more than five minutes late, advances the schedule and records the server-owned `lastSkippedAt`. Finite schedules pause after their last skipped occurrence. Client settings patches preserve scheduler receipts, and configuration equality treats omitted catch-up as enabled for compatibility. The UI labels the distinction between preview-device time and the execution environment's clock.

Server, web and mobile typechecks passed. The additions have not been packaged into a replacement installed macOS client or verified in a live routine launch. User behavior is documented in `docs/user/routines.md`.

### 2026-10-08 — Fresh macOS package

The canonical desktop/server/web build produced `T3-Code-0.0.40-arm64.zip`, copied to `/Users/luca/Downloads/T3-Code-0.0.40-arm64-premium-local-20261008.zip`. Packaging initially failed because sysinfo 0.39.3 requires Rust 1.95; the existing 1.95.0 toolchain completed the build. `rust-toolchain.toml` now pins that compatible toolchain and the resource-monitor manifest declares its minimum. This is a local unsigned package; the installed client was not replaced.

### 2026-10-08 — Custom Alpha upgrade staged

The same fresh build was packaged as `0.0.45-preview.20261008.custom5`, continuing the installed custom4 preview version rather than publishing its fallback 0.0.40 package metadata. The upgrade ZIP is `/Users/luca/Downloads/T3-Code-0.0.45-preview.20261008.custom5-arm64.zip`. Both installed Alpha and Nightly processes are running; neither bundle was replaced or terminated. Alpha's source retains the existing `t3code-v2-alpha` Chromium profile isolation. The packaged routine controls are present; installed-runtime routine execution remains unverified.

### 2026-10-08 — Local custom Alpha installer

`scripts/install-local-desktop.py` upgrades a packaged custom Alpha ZIP in `/Applications`, with `--dry-run` for the exact plan. It refuses a running Alpha, downgrades, unexpected bundle paths/identities and invalid local signatures; it retains the previous bundle and restores it if final installation fails. Server data and the Alpha Chromium profile are outside its write scope. The actual custom5 archive produced a dry-run plan against installed custom4 and correctly required Alpha to close. Neither Alpha nor Nightly was terminated or replaced.

### 2026-10-09 — Approved custom5 installation

After Luca explicitly approved native inspection and an idle upgrade, Alpha showed only one settled thread and an empty composer. The native Quit action closed Alpha; `install-local-desktop.py` verified/extracted custom5 and replaced the bundle while retaining custom4 at `/Applications/.t3-local-upgrades/T3 Code Alpha-0.0.45-preview.20261004.custom4-20261009-145041-080750Z.app`. Nightly was not quit or changed. Server data and `t3code-v2-alpha` remained outside the installer’s write scope.

Alpha reopened and reconnected to its saved local environment. The installed Routines editor rendered the next five real schedule-preview dates and the missed-occurrence choice. Its unsaved agent-created form was discarded; no routine was saved or run. The prior settled thread is still listed. The bundle version is `0.0.45-preview.20261008.custom5`; the server/application About surface still reports the source foundation version `0.0.40`. This installation does not establish completion of upstream/fork integration or the six-project v1 mission.

### 2026-10-09 — Retained routine occurrence history

The scheduler records at most fifty occurrence receipts per routine through its existing atomic settings writer: starting, launched, failed and skipped. Receipts retain scheduled/observed times, exact project/provider/model and permission selection, launch error and a thread link after acknowledged dispatch. Client edits preserve server-owned history; duplication removes it, and historical occurrences are not reconstructed from the old latest-run fields. The optional wire field remains compatible with routines lacking history. Deleting a routine removes its receipts while retaining its ordinary project threads.

Web/desktop and mobile expose compact execution-history rows, status filtering, task navigation with unsaved-edit protection and retained-history JSON export/sharing. Launched is explicitly task creation rather than task completion. All six affected workspace typechecks, scoped lint and production web/server/desktop builds passed. An in-memory scheduler with a mock dispatcher exercised launch, failure and downtime-skip receipt paths; no real provider or agent task ran. No new tests were written. Rendered browser validation requires the separately requested approval; installed Alpha remains custom5.

The local arm64 custom6 package is `/Users/luca/Downloads/T3-Code-0.0.45-preview.20261009.custom6-arm64.zip`. Packaging passed after supplying the repository's `vp` binary on PATH. The installer's dry-run resolves installed custom5 → custom6, requires Alpha to quit and retains the old bundle, server data and Alpha profile. Native idle inspection/upgrade was separately requested; no installed process or bundle was changed. The underlying source foundation remains 0.0.40, and this does not complete upstream integration or enterprise-v1 readiness.

### 2026-10-09 — Approved custom6 installation and isolated history validation

Luca approved both isolated browser validation and native idle inspection/custom6 upgrade. Alpha showed a settled thread and no configured routines. Native Quit closed it; the installer installed `0.0.45-preview.20261009.custom6` and retained custom5 at `/Applications/.t3-local-upgrades/T3 Code Alpha-0.0.45-preview.20261008.custom5-20261009-180952-667821Z.app`. Alpha reopened with its saved MyLifeOS workspace/settled thread intact and rendered its existing Usage surface. Nightly, server data and Alpha profile were preserved. No installed routine was created or run.

An owned loopback server with a disposable data directory rendered the canonical history UI using a paused, explicitly verification-only routine. Failed filtering retained one occurrence; JSON export retained all three launched/failed/skipped receipts with format `t3.routine-history/1`. No agent routine ran. The preview did not import existing projects or modify the installed app's state. It does not establish real provider execution outcomes, mobile native rendering or whole-project enterprise-v1 readiness.

### 2026-10-09 — First-turn outcome receipts and installed custom7

New routine launches retain their dispatch event sequence. The scheduler replays bounded pages of stored thread events on its thirty-second sweep, including while paused and after restart, and records the first turn’s completed, interrupted, failed or unattributable outcome separately from launch acknowledgement. A later turn cannot replace a recorded outcome; a follow-up request before terminal evidence ends attribution rather than assigning its result to the routine. Legacy receipts remain launch-only. Updates use the existing settings write lock and preserve concurrent configuration and history. Web/desktop and mobile share independent launch/outcome filters, evidence details and full retained-history JSON export/sharing.

All six affected workspace typechecks and scoped formatting/lint passed. Source replay exercised terminal states, serialized cursor recovery, unrelated-thread rejection and legacy preservation. The actual scheduler with an in-memory settings writer and mock event source recorded completion while paused without dispatching a task. An isolated loopback server retained six verification-only receipts across restart; outcome filtering selected one failed turn and browser export retained all six. At 390px, the history region measured 340px and the page remained 390px without horizontal overflow. No new tests or real provider routines ran; native mobile rendering and live provider outcomes remain unverified.

Using Luca’s approved native idle-check/upgrade process, Alpha showed only settled threads, an empty draft and no routines before native Quit. `0.0.45-preview.20261009.custom7` was installed from `/Users/luca/Downloads/T3-Code-0.0.45-preview.20261009.custom7-arm64.zip`; custom6 was retained at `/Applications/.t3-local-upgrades/T3 Code Alpha-0.0.45-preview.20261009.custom6-20261010-022611-887505Z.app`. Alpha reopened with its saved MyLifeOS workspace and settled threads, rendered Routines, and returned to Usage after discarding the untouched agent-created draft. No installed routine was saved or run. Server data and the Alpha profile were preserved. Source foundation remains 0.0.40; upstream integration and the six-project enterprise-v1 mission remain partial.

### 2026-10-09 — Routine overlap policy and custom8

Routines can skip an occurrence while a retained previous task has current session, turn or background activity. The bounded SQL activity service reads task state without messages and includes archived tasks. Scheduled and Run now launches share the policy, atomic claims preserve concurrent edits, and query failures produce a distinct activity-unavailable receipt. New drafts default to protection when the server advertises it; legacy routines keep allowing overlap. Older servers disable the control. Web/desktop and mobile share skip reasons, active-task links and receipt exports.

The disposable scheduler proof exercised active, archived, background, settled, failed and unavailable activity without a real provider dispatch. Five client workspace typechecks, scoped lint and production web/server/desktop packaging passed; server typechecking remains failing in separate enterprise diagnostics code. The diagnostics module's standalone entry guard was corrected because bundling previously ran it and exited during server startup. The global simulated telemetry ribbon is no longer mounted. Isolated browser rendering showed the protection control and both skip reasons; JSON export retained both receipts and the blocking task ID. Native mobile rendering and real provider overlap remain unverified.

Alpha showed only settled threads, an empty draft and no routines before native menu Quit. The installer replaced custom7 with `0.0.45-preview.20261009.custom8` from `/Users/luca/Downloads/T3-Code-0.0.45-preview.20261009.custom8-arm64.zip`, preserving server data/profile and retaining `/Applications/.t3-local-upgrades/T3 Code Alpha-0.0.45-preview.20261009.custom7-20261010-062940-281522Z.app`. Alpha and its backend restarted; the backend readiness probe returned 200. Post-install native accessibility inspection repeatedly timed out, so the reopened native screen is unverified. The source foundation and whole-project enterprise-v1 status remain partial.

### 2026-10-10 — Daily routine launch limits and custom9

Web/desktop and mobile expose an optional per-routine local-calendar-day launch limit. Scheduled occurrences and Run now share the server-owned counter inside the existing atomic settings claim; launch failures consume attempts, skips do not, and retained history is independent of usage. Stale client edits preserve usage, duplication resets it, and changing day or time zone starts a fresh counter. Receipts and exports retain the exact count, day, time zone and limit, including daily-limit skips. Older servers disable the control. This limits launch attempts rather than spend and does not reconstruct older launches.

The actual scheduler and persisted settings were exercised with a disposable state directory, in-memory SQLite and mock dispatcher: one launch, a capped Run now skip, stale-edit preservation, duplication reset, local-midnight reset and fresh-service reload. Five client workspace typechecks, desktop typechecking, scoped formatting/lint and production web/desktop packaging passed. Server typechecking remains failing in separate enterprise diagnostics and existing test code. An isolated browser rendered the exact receipts at 390px without horizontal overflow; exported JSON retained the counter. No real agent routine ran and no new repository tests were written. Native mobile rendering and live-provider enforcement remain unverified.

Read-only installed projection state showed only stopped sessions and completed/interrupted turns, with no provider child process. Native menu Quit closed Alpha. The installer installed `0.0.45-preview.20261010.custom9` from `/Users/luca/Downloads/T3-Code-0.0.45-preview.20261010.custom9-arm64.zip` and retained custom8 at `/Applications/.t3-local-upgrades/T3 Code Alpha-0.0.45-preview.20261009.custom8-20261010-174359-923234Z.app`, preserving server data and the Alpha profile. The installed signature passed; Alpha reopened and its owned backend listens on the existing port 3774. Post-install native accessibility exposes only the outer window, so the reopened native content remains unverified. Source foundation, upstream integration and whole-project enterprise-v1 remain partial.

### 2026-10-10 — Portable routine templates (custom10)

Routines now export `t3.routine-template/1` configuration JSON and import it into a new paused
reviewable draft on desktop/web/mobile. Shared contract validation rejects unknown fields, invalid
schedules/time zones and payloads over 128 KB. Explicit export fields exclude environment project
and provider IDs, model options, history and usage. Imports retain authored permissions and bind to
local available defaults; users review the project/provider/model before saving. Desktop/web
exports a file; mobile uses the native share sheet. Saving and resuming remain separate actions.

Scoped contracts/client-runtime/web/mobile typechecks and changed-source lint passed. The current
server typecheck also passes; the older red record is stale. An owned disposable settings-service
proof retained a paused import across fresh-service reload with no scheduler/provider launch.
The retained disposable web environment at :50980 verified import, export/download, paused save,
zero receipts and 390px containment. Its existing state/tab remain available for iteration.

`T3-Code-0.0.45-preview.20261010.custom10-arm64.zip` built and was installed after native idle
inspection and native Quit. Custom9 is retained under `/Applications/.t3-local-upgrades/`; server
state and the Alpha profile are preserved. Signature verification passed and the reopened backend
listens on :3774. Post-upgrade native UI inspection timed out; updated native screen and mobile
share-sheet interaction remain unverified. This is one delivered capability; full enterprise-v1
and upstream parity remain partial.

## 2026-10-14 — Review-bound routine batch controls

Web/desktop and native mobile can pause or resume the schedules in the current routine filter after reviewing the captured names. The shared client builder excludes already-matching schedules and caps batches at 100. Optional expected configuration on the existing RoutineAction wire shape binds every selected routine; the server resolves all entries under the existing settings write lock, refusing changed or deleted configurations before persistence. Runtime history and starting/running task state remain server-owned. A capability flag keeps these controls disabled on older environments. No new execution queue or provider launch path.

Direct source runtime evidence: a two-schedule pause preserved the active task identity/status and original input; changed and deleted selections refused before persistence. Mobile and server typechecks passed; web reports no TypeScript errors (existing Effect schema suggestions remain). No new tests, live schedule mutation, provider run, installed-app rebuild or browser/native QA in this pass. Enterprise-v1 readiness remains partial.

Delivery follow-through: the scoped production web, server and desktop build completed successfully on 2026-10-14. Installed Alpha and live schedules remain unchanged; native UI permission remains pending under this project’s AGENTS.md. This is build evidence, not installed client verification.

## 2026-10-15 — Claude usage accounting after the promo-credit relay

Claude content blocks and fork/resume copies repeat message usage; reconciled snapshots retain component maxima before day/project aggregation. One-hour cache writes and available thinking counts remain subsets of their token totals; pricing uses the recorded TTL, and the versioned scan cache cold-rebuilds older parse results. Unknown Claude generations remain unpriced. Subscription probes use a stored subscription token independently of the credit path when available, retain Opus/Sonnet weekly buckets, preserve endpoint percentage units, and reject nonfinite quota values.

The relay's first unseen resumed-session report was capped at its reservation. T3 now reads the SDK starting cost before publishing a resumed runtime ready and reports the increase under a separate accounting scope, preserving the relay's cumulative deduplication. If that optional baseline read fails, the prior estimated-report path remains; no historical promotional balance is reconstructed from ambiguous billing history. The Usage total is API-equivalent consumption, not an authoritative credit balance.

## Linear queue

- [ ] create — Verify Claude usage accounting and installed Alpha delivery — snapshot reconciliation, one-hour pricing, quota windows and resumed relay spend; Linear tools unavailable in this session.

Accounting verification: an isolated checkout at `~/.cache/t3code-development/usage-20261015` contains only the 18 usage/provider source and test changes above HEAD; unrelated routine edits were excluded. All 240 focused tests in 12 files and the server typecheck passed. Scoped lint reports one existing warning in `usageProjects.ts`. The real client at `http://localhost:7004` rendered the verification-only message as 100 output tokens, one million cache writes and $6.80, across three repeated snapshots. No provider turn ran. The disposable test base remains in the current session's `/tmp/t3-usage-qa-path` locator.

The arm64 `0.0.45-preview.20261015.custom21` ZIP is in `/Users/luca/Downloads`; production web/server/desktop packaging and extracted bundle signature verification passed. Installer dry-run targets installed custom20, preserves server data/profile, and retains a rollback bundle. Luca explicitly approved native verification and an idle update. Both native attempts were blocked by the locked Mac; custom20 remains installed and running, so installation and installed Usage verification are pending manual unlock. No live ledger, transcript, credential or installed app was changed. Historical promotional credit remaining is not established by these estimates.

### 2026-10-15 — Usage coverage audit and custom22

Usage v7 attributes buckets and project rows to a physical source. Shared clients merge overlapping source sets independently and prefer healthy/newer snapshots; legacy summaries without source attribution remain visibly incomplete. Archived Codex sessions, separately configured Claude/Codex homes and Grok homes are scanned. Codex receipt deduplication uses cumulative totals when supplied so equal-sized distinct turns survive. Failed reads and malformed complete usage lines mark coverage partial across cold/incremental/cached scans. Synthetic Claude messages do not count as billed responses.

Public long-context rates are selected from recorded input length, including cache tokens. Unknown models, unsupported recorded billing modifiers and unpriced server-tool surcharges remain unpriced; Antigravity's missing model no longer borrows a Gemini price. Web/desktop/mobile distinguish known cost, partial prices and unpriced rows. Positive sub-cent amounts display `<$0.01`, and JSON/CSV exports retain numeric precision and incomplete-coverage flags.

The earlier estimated fallback for an unknown resumed-runtime baseline is superseded: scoped relay reporting refuses reconciliation without its starting cost, retries the same idempotent cumulative report, checks acknowledgement and emits a persisted warning on failure. A positive SDK cost-counter decrease creates a fresh accounting scope for `/clear`. Transcript coverage and an acknowledged local ledger still do not establish Anthropic's authoritative promotional balance.

Verification: 361 tests across 21 focused files, server/web/mobile/shared/contracts typechecks, scoped lint (one existing project-slug warning), production packaging and strict extracted-bundle signature verification passed. The isolated client exported exactly 1,000,150 tokens, 130 output tokens, $6.802 known cost, two distinct messages, one unpriced message and incomplete coverage from the malformed fixture. The 32 selected usage files match the isolated checkout; unrelated routine changes are excluded. Evidence: `/Users/luca/.cache/t3code-verification/2026-10-15/usage-accounting.json`.

`/Users/luca/Downloads/T3-Code-0.0.45-preview.20261015.custom22-arm64.zip` is ready. The approved native idle inspection/update remains blocked by the locked Mac; custom20 is still installed. No live ledger, transcript or credential was changed. Native mobile interaction and provider-authoritative promotional balance remain unverified. The disposable client at :7004 is retained for follow-up.

### 2026-10-15 — Independent pricing recheck and custom23

A second audit found unpublished cache prices could inherit cheaper base-tier rates, and exact variant prices could be discarded before lookup. Missing required cache/context-tier categories now remain unpriced; exact model keys take precedence, while unknown preview/latest/exp IDs no longer borrow base prices. Negative provider cost quotes cannot override token pricing. Explicit custom overrides retain their documented cache defaults.

All 363 tests across the same 21 focused files passed; the server typecheck, focused pricing lint, production packaging and strict extracted-bundle signature check passed. Independent arithmetic reconfirmed the exported fixture at 1,000,150 tokens and $6.802 known cost with incomplete coverage explicit. Custom23 supersedes custom22: `/Users/luca/Downloads/T3-Code-0.0.45-preview.20261015.custom23-arm64.zip`. The Mac remains locked and custom20 remains installed; the approved idle update and provider-authoritative credit reconciliation are still pending. Evidence remains in the external usage-accounting.json artifact.

### 2026-10-15 — Installed custom28 and lifetime-history reconciliation

<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=1m; seat=codex; date=2026-10-15 -->

The approved idle update installed custom28 in `/Applications/T3 Code (Alpha).app`; strict bundle signature verification and native startup passed. A durable usage-history ledger imports validated legacy evidence and retains records when original transcripts disappear or parser caches are pruned. Current and historical evidence reconcile before aggregation. Non-applicable Claude `inference_geo:not_available` no longer excludes otherwise priceable records. Calendar activity includes tokens with unknown/zero cost and quiet days; unavailable account limits remain visible.

A raw Claude audit found repeated snapshots behind the older near-90B lifetime count. Separate missing transcript evidence was recovered from the legacy cache. After restart the installed Usage page displayed 42.2B tokens and $15,750.09 known API-equivalent cost; 11.9% of records remain unpriced. These are consumption estimates, not invoice totals or remaining promo credit. Claude subscription quota is unavailable for the current account. Focused history/service/calendar tests, scoped lint/typechecks and production packaging passed. Custom27 native JSON export arithmetic passed; custom28 reached the native save panel but Save stayed disabled, so its final export comparison remains unverified. Evidence and reconciliation: `/Users/luca/.cache/t3code-verification/2026-10-15/native-verification.json` and `history-reconciliation/report.md`. Prior installation notes above are historical and superseded by this installed-build record.

### 2026-10-17 — Original Claude accounting restored and verified

<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=1m; seat=codex; date=2026-10-17 -->

Custom29 is installed. Luca supplied Claude-side counterevidence to message-ID collapsing; the original per-transcript-row accounting is restored. Version-9 parse caches rebuild collapsed records, and the version-2 history ledger retains original row multiplicity across repeated scans and restarts. Missing historical records, pricing-category handling, coverage, exports and account-limit changes remain. The earlier assertion that collapsed usage established the correct consumption total is superseded.

Native Usage and JSON export now agree on 84,412,724,115 total tokens and $33,350.387295399974 known API-equivalent cost, including 77,555,107,436 Claude tokens and $31,895.319666149986 Claude cost. Claude has zero unpriced records; overall 6.893% of records remain unpriced, from Antigravity lacking a usable model/price. Independent token-category, provider, model, daily, session and cost-coverage arithmetic passed. Native export Save works. Provider invoice, subscription quota and promotional balance are separate and are not established by this transcript accounting. Previous focused tests/build validation passed; no further runtime source changes were needed in this verification. Evidence: `/Users/luca/.cache/t3code-verification/2026-10-17/verification.json`.

### 2026-10-17 — Antigravity accounting and provider quota (custom30)

<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=4m; seat=codex; date=2026-10-17 -->

Custom30 is installed and its strict bundle signature passed. Antigravity now resolves the served model from generation metadata linked by explicit step indices, counts each generation once, reads cache writes from protobuf field 4, and treats thinking as a subset of output. Version-10 scan caches rebuild older parses; live-history migration replaces obsolete step identities. Original Claude per-row accounting and other usage features remain.

The installed Usage screen showed $33,682.76 known API-equivalent cost, including $316.38 / 2.39B Antigravity tokens, $31,895.32 / 77.6B Claude tokens and 0.3% unpriced records. Ongoing activity changes these snapshots. A later independent replay across all three Antigravity conversation homes counted 2,420,497,561 tokens and $316.75779317499865 known cost; 2,246,178,496 tokens were cache reads. Gemini 3.8/3.6 Flash rows independently matched public input/cache/output rate arithmetic. Internal trial models without public rates remain unpriced.

Antigravity now reads Google's real per-model quota with the existing instance OAuth grant; the installed runtime returned 25 model windows, exact provider fractions and reset times. Claude subscription quota remains unavailable because the local login contains API/proxy credentials without a subscription OAuth token. The UI surfaces that reason and the subscription-login requirement. Promotional balance, invoice spend and API-equivalent usage remain separate.

Validation: 117 focused tests, server/web/shared typechecks, scoped lint, two additional all-home/live-quota checks, production packaging and native Usage observation passed. Native Limits interaction and a new custom30 JSON export remain unverified: native automation input fails with noWindowsAvailable or leaves selectors unchanged. Custom29 export evidence is retained. Evidence: `/Users/luca/.cache/t3code-verification/2026-10-17/provider-fixes-verification.json`.

### 2026-10-17 — Inspectable pricing gaps and quota freshness

<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=8m; seat=codex; date=2026-10-17 -->

Web/desktop and mobile model breakdowns now offer Needs pricing, preserving search and selected-window totals while showing each affected model's exact unpriced/total record counts. Model token totals intentionally include both priced and unpriced rows; unknown cost is not represented as zero. Quota views show snapshot read age and flag readings at least 15 minutes old. The compact web quota list removes large per-model cards; both clients explain equal-account averaging rather than implying capacity weighting across plans. Mobile Antigravity uses its own label/color and missing-quota notices precede other providers' bars.

72 focused shared tests, web/mobile/shared typechecks, scoped lint and production desktop/server/web build passed. Real isolated browser checks verified filter/search/reverse actions with unchanged window totals, quota read ages and 413px/1280px layouts. Native mobile device verification remains outstanding. Delivery evidence: `/Users/luca/.cache/t3code-verification/2026-10-17/premium-verification.json`.

Custom32 delivery: approved idle update installed after a fresh zero-active-turn check and native Quit; the previous custom30 bundle is retained for rollback. Strict signature verification passed. The updated native process and bundled server on :3774 are running; desktop automation timed out inspecting the window, so native interaction is not confirmed. The isolated verification server was stopped.

## Linear queue

- [ ] create — Review Race Scoreboard evidence filters and subscription-only quota probe — local changes pass focused checks; browser permission pending; no Linear tools/binding available.

- [ ] create — Review mobile Race evidence parity — implementation, typecheck, iOS export and existing focused checks pass; rendered native verification pending permission and suitable runtime.

### 2026-10-19 — Race conversation provenance across desktop and mobile

New Race records retain optional, typed entrant and judge thread IDs from the actual source conversations. Older records remain readable without invented links; later reports can fill matching missing entrant provenance while preserving decided metrics. Both desktop scoreboard and mobile history open available conversations on the same connected computer. Deleted/unavailable or unrecorded entrant links are explained. This is navigation only; viewing a record never merges code or starts another agent.

JSON exports retain provenance and CSV adds explicit entrant/judge thread ID columns. Existing Race suites (14 checks), mobile/web/server typechecks, scoped lint and an iOS Expo production export pass. No new tests. Rendered T3 verification remains pending the previously requested browser/computer-use permission; no desktop/mobile UI was launched.

- [ ] create — Verify Race conversation provenance on desktop/mobile — additive contract and both navigation paths implemented; production mobile bundle exported, rendered permission still pending.

### 2026-10-20 — Portable Race evidence and approved browser verification

Desktop and mobile now export Markdown evidence from actual retained records, either the filtered history or one race. Reports preserve the source prompt, per-entrant phase/diff counts/reported time and price, judge choice and optional conversation IDs. Unknown fields remain unreported; prompts/failures use collision-safe code fences and metadata/table cells are escaped. JSON/CSV stay available. Mobile uses the existing explicit native share flow, abort cleanup and bounded rendering.

Luca approved isolated browser QA. The retained test environment uses `/var/folders/3k/8kq7zwlj4ts3pz6g2tpjrh5w0000gn/T/t3code-race-qa-LR4xk9`, web :5733 and backend :13773. No live projects were imported and no agent task was started. Controlled JSON fixtures demonstrated 20/5-row pagination, literal search (1 match), project (13), task (9), kept outcome (15) and last-30-days (24 of 25). Real browser downloads contained 25 JSON records, 50 CSV entrant rows with 37 unknown prices, and 25 Markdown race sections while viewing page two. Filtered CSV neutralized a formula-leading prompt; single-race Markdown preserved literal text behind safe fences. Browser warnings/errors: zero. The authenticated review tab and dev runner are retained for follow-up; pairing tokens are not stored here.

Existing Race suites (14 checks), mobile/shared/web typechecks, scoped lint/format and an iOS Expo bundle pass. No new project test files. This proves the desktop browser filters/pagination/export flow; native mobile sharing/navigation, installed desktop behavior and live provider/code-merge workflows remain outside this verification.

- [ ] create — Review portable Race evidence and native follow-up — desktop browser flow verified with controlled records; mobile export compiled, native interaction still pending.

### 2026-10-20 — Race history refresh without losing filters

The web/desktop Scoreboard now refreshes the connected computers’ retained history through the existing query atoms, preserves filters and pagination, and disables exports while refreshed data is pending. Failed reads can be retried through the same control. In the retained isolated browser, adding one controlled record then clicking Refresh changed 1/25 to 2/26 matches while keeping the `needle` search; the fixture was restored afterward. Web typecheck and scoped lint/format passed; no tests added. The authorized QA environment remains retained for follow-up.

### 2026-10-20 — Current-source desktop review candidate

Production web/server/desktop build and arm64 ZIP packaging completed for custom33. `/Users/luca/Downloads/T3-Code-0.0.45-preview.20261020.custom33-arm64.zip` SHA256 is `0459e381c79be3d6fe7aac0a0ca147c2b2c1600624676f4031de857a232c663d`. Extraction and strict deep bundle signature verification pass; packaged `apps/server/dist/client/assets/race-UhD28xrl.js` includes Race refresh, evidence, search and Scoreboard controls, and bundle/package version is `0.0.45-preview.20261020.custom33`. This is package evidence, not native UI evidence. Installed application and live data were not changed. Isolated native candidate QA permission was requested under AGENTS.md; the candidate has not been launched. Details: `/tmp/t3-custom33-delivery.json`.

### 2026-10-20 — Authorized isolated desktop launch and export lifetime repair

Luca approved isolated native desktop QA. Custom33 launched with separate home `/tmp/t3-custom33-native.9OlIy1`, Electron profile under that home and bundled backend on :3775. Native setup rendered; its state changed during observation and 139 historical threads were found copied into the isolated database. Those records are preserved. Native controls then timed out, so Electron Race/save-dialog behavior is still unverified. Provider-session count in this QA database remained zero; no agent turn was started by this pass. The installed app was not replaced.

The same bundled backend/client worked in an authenticated browser: 25 controlled Race records loaded, literal `needle` search matched one, refresh kept the filter, and browser warnings/errors were empty. The initial CSV content inspection mistakenly selected a file from the earlier dev pass; modification times exposed the mistake. Custom33 production CSV saving is not verified. The corrected external report is `/tmp/t3-custom33-delivery.json`.

Race full-history and per-race exports now retain their Blob URLs until replacement or component teardown, matching the established Usage exporter lifecycle, rather than revoking them immediately. A visible prepared-file link supports clients that block the automatic transfer. Browser verification saved fresh CSV (two entrant rows with formula-leading prompt neutralized) and Markdown (literal prompt/fence text retained) through those links; file modification times were checked. Web typecheck and scoped lint/format pass; no tests added. Custom34 is packaged with this fix. Native save-dialog consumption remains outside that evidence.

Custom34 delivery follow-through: production build/arm64 packaging, extraction, strict deep signature and packaged retained-link marker checks pass. Review ZIP: `/Users/luca/Downloads/T3-Code-0.0.45-preview.20261020.custom34-arm64.zip`; SHA256 `187e3dc2d4d7dc30dab3bfcb09636aac7f5def585da7309cbb726115fdd4fe20`. The first renamed QA copy flattened framework symlinks and failed helper/signature checks; it was discarded and rebuilt with symlinks/original helper names intact. The resulting QA copy has a separate bundle identifier, passed strict signature verification and reused the isolated home after custom33 quit cleanly. Its bundled backend/main window started on :3775; native observation still times out. The packaged custom34 frontend loaded 25 controlled records in the browser, matched one literal search and saved a fresh two-row formula-neutralized CSV through the retained link. Browser warnings/errors and QA provider sessions were zero. External delivery evidence is `/tmp/t3-custom34-delivery.json`; authenticated dev/production browser tabs and the QA process are retained for follow-up. Installed application was not replaced.

### 2026-10-21 — Matched race comparisons

Race Scoreboard now compares harness/model pairs only over races both entered, on web/desktop and mobile Settings → Race history. It separates each side's keeps, no-winner decisions, open races, keeps of a third entrant and unknown kept slots. Time deltas use pairs that both finished with recorded durations; cost deltas use pairs with both prices reported, including actual zero. Sample counts accompany each median, and ambiguous repeated entries of the same harness/model in one race are excluded. All filtered pairs are retained in JSON and Markdown exports. The 30 focused shared/race tests, touched-file lint, and shared/web/mobile TypeScript checks pass. Native/browser QA, packaging and enterprise-v1 acceptance remain open; no live install or userdata was modified.

### 2026-10-21 — Inspect the races behind a model comparison

Head-to-head rows now offer View shared races on web/desktop and mobile. The selected pair scopes the leaderboard, history, pagination and exports to exact harness/model identities, requiring one unique entrant per side in each race. Races where a third entrant was kept remain visible as supporting evidence; repeated copies of one model are excluded consistently with the comparison table. Clear model pair removes only that scope, and Clear filters also resets it on web. JSON retains the selected identities, and exported pair statistics are rebuilt from the captured filtered records. Shared tests (15), shared/web/mobile TypeScript and touched-file lint pass. This turn did not perform T3 browser/native QA or packaging; enterprise-v1 acceptance remains partial.
