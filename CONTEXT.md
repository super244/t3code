<!-- agent-watermark: model=opus-5.5; effort=high; duration=110m; seat=claude-code; date=2026-10-18 -->
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
