<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=1m; seat=codex; date=2026-10-18 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=125m; seat=codex; date=2026-10-14 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-10 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=29m; seat=codex; date=2026-10-09 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-02 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-01 -->
<!-- agent-watermark: model=gemini-3.8-flash; effort=high; duration=15m; seat=antigravity; date=2026-10-01 -->
<!-- agent-watermark: model=grok-4.7; effort=default; duration=18m; seat=cursor; date=2026-09-30 -->

<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=30m; seat=codex; date=2026-10-08 -->

# Scheduled routines

Open **Routines** from the sidebar, or **Settings → Routines** on mobile, to run an agent prompt on a
recurring schedule. A routine belongs to one environment and project. Choose the provider
subscription, model, permission mode, time zone, and a cron expression before
saving it.

The routine list features an instant search filter (matching name, schedule cron, and prompt contents)
along with status pills (**All**, **Active**, **Paused**, **Failed**) to quickly inspect fleet health on desktop,
web, and mobile. Curated 1-tap template chips (**Daily Task**, **Health & Security**, **24h Digest**, **Code Cleanup**)
provide editable starting instructions for recurring work.

**Change a group of schedules:** narrow the list by search or status, then choose **Pause visible** or **Resume visible**. Review the saved routine names before applying. The batch excludes schedules already in the requested state and is limited to 100 routines. If any selected routine changed or was deleted after review, none of the batch is applied. Pausing leaves running tasks alone; resuming starts scheduling from the next occurrence rather than requesting an immediate run. Save or discard an open draft first. Older environments need a server update to use these controls.

The routine list shows the plain-language schedule, when the next run is due, and the last failure when one exists. The selected provider instance is the subscription or account used for the run. Every occurrence
creates a normal T3 Code thread, so its messages, status, diff, and provider usage remain visible in
the ordinary project history. **Run now** queues the routine for the environment's next scheduler
sweep.

Choose a plain-language schedule preset for common hourly, daily, weekday, weekly, or monthly work,
or switch to a custom cron expression. Existing routines can be duplicated as a clean draft when you
want the same prompt and provider subscription on another project or schedule.

The editor previews the next five occurrences in the selected time zone using your device's clock. The environment's clock determines actual execution.

The environment's T3 server must be running. **Catch up after downtime** is enabled by default: a routine missed while the server was offline runs once when it returns. Disable catch-up to skip occurrences more than five minutes late and advance to the next scheduled time. The editor shows the most recently skipped occurrence. Neither option replays every missed occurrence. **Launched** means
the task was created; open the last task to check its progress and outcome. Save edited instructions
before using **Run now**. Running a paused routine also resumes its recurring schedule when future occurrences remain. Pause a
routine to keep its configuration without running it, or delete it to remove it from that environment.

Schedules are validated when you save. A rejected save keeps your edits and leaves the stored routine unchanged. Unsaved changes are protected when switching routines or computers and when leaving the editor. Pause a saved routine directly to stop future occurrences; reconnect an offline computer before changing its routines.

Custom schedules accept five fields (minute through weekday), six fields with leading seconds, or seven fields with seconds and a trailing year, plus presets such as `@daily`. The environment's clock determines future occurrences. A finite schedule pauses after its final launch or skipped occurrence; **Run now** can still launch it once. Change its schedule before resuming recurring runs.

Pausing stops future occurrences; a task already launched remains in project history. Automatic rescheduling keeps the last failure visible.

**Skip when a previous task is active** prevents a scheduled occurrence or **Run now** from creating
another task while one of the routine’s retained tasks is still starting, running, or has recorded
background work. The environment checks current activity, including archived tasks, rather than
assuming that a missing turn outcome means work is running. New routines enable this option;
existing routines retain their original concurrent behavior until you change it.
Update a connected environment before enabling this option; older environments cannot enforce it.

A skipped occurrence advances to the next scheduled time, preserves existing work, and links to
the task that blocked it. If activity cannot be checked, the occurrence is skipped with that reason.
Turn the option off when independent occurrences should run concurrently. Checks cover the latest
fifty retained occurrences and the last saved task; deleting or duplicating a routine does not adopt
its old tasks into a new routine.

**Daily launch limit** caps how many launch attempts this routine can claim in one calendar day
in its saved time zone. Scheduled occurrences and **Run now** share the same server counter.
Failed launches consume an attempt; skipped occurrences do not. The counter survives restart
and remains independent of the fifty retained receipts. History and JSON exports retain the
counter and limit recorded for each new occurrence, including **Daily launch limit reached** skips.

Leave the limit blank to remove it. Local midnight starts a fresh counter; changing the saved time
zone also starts a new local-day counter. Updating or pausing retains usage, while duplicating
starts a new routine with no usage. Counting begins with the updated scheduler; older launches
are not reconstructed. This controls launch attempts, not provider spend. Older environments
disable the control until updated.

Routine saves retain the server’s latest launch history. Run, pause, and resume use the currently saved instructions and subscription, including changes made on another device. If a routine was deleted while its editor was open, duplicate the draft to create a new routine. Use an updated client for **Run now**; older clients that send launch timestamps are rejected with an update message.

If another device changes the routine while you edit, your draft stays open and saving is blocked. Choose **Review saved version** to load the newer configuration, or duplicate your draft to keep it separately. Run-history updates do not create editing conflicts.

**Execution history** retains the latest fifty occurrences recorded by the updated environment. Filter starting, launched, failed or skipped occurrences, inspect their schedule and provider selection, and open any launched task. Search by error, model, subscription, recorded date or task ID; words can match across those fields. Export the shown selection as JSON on web/desktop, or share it on mobile. The report records the filters and matching versus retained counts; clearing the search and filters includes every retained receipt. Editing and pausing preserve receipts, while duplicating a routine starts a fresh history. Deleting a routine removes its retained receipts; its existing tasks stay in project history.

New launches also record their first agent turn’s **completed**, **interrupted** or **failed** outcome from the environment’s stored session events. The Outcome filter is independent of the launch filter. Recording continues while the routine is paused and resumes after a server restart, usually on the next thirty-second scheduler sweep. Receipt details identify the turn and recorded event; exports include that evidence and any failure reason. A later conversation turn cannot replace an already recorded outcome. When events cannot establish which turn belongs to the routine, the receipt says **Outcome not attributable** instead.

A completed turn does not verify that the task was correct; review its thread and diff. Older receipts remain **Launch-only receipt** and their outcomes are not reconstructed. **Turn outcome not recorded yet** means there is no recorded terminal outcome; it does not establish that a provider is still running.

## Move a routine between environments

Open a routine and choose **Export template**. Desktop and web download JSON; mobile opens the
system share sheet. The template includes its prompt, schedule, time zone, permissions, catch-up,
overlap policy and daily launch limit. It excludes project and provider identities, model options,
run history and usage. Prompts can contain private information: review the file before sharing it.

On the destination computer, choose **Import template**, paste the JSON and choose **Review template**. The editor opens a new **paused** draft using that environment's available project and
provider defaults. Review the project, provider, model and permissions, then **Save routine**.
Saving does not start it; resume it separately when ready. The source model name is a hint in the
file and is not applied automatically. Templates must use `t3.routine-template/1`, have a valid
schedule and time zone, and be at most 128 KB. Unknown fields are rejected.
