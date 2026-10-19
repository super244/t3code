<!-- agent-watermark: model=opus-5.5; effort=high; duration=6m; seat=claude-code; date=2026-10-19 -->
<!-- agent-watermark: model=opus-5.5; effort=high; duration=6m; seat=claude-code; date=2026-10-18 -->
<!-- agent-watermark: model=opus-5.5; effort=high; duration=110m; seat=claude-code; date=2026-10-04 -->

# Race

Race sends one prompt to two to four agents at once and lets you keep the best result. Open it from
the flag icon in the sidebar, search for **Open Race** in the command palette, or choose
**Go → Race** in the desktop app.

Pick a project and the branch to start from, describe the task, and choose an entrant for each
provider and model you want to compare. The same provider can enter more than once. Every entrant
works in its own worktree, so they never touch each other's files or your project checkout, and each
one is a normal thread you can open, follow up on, or stop.

The board shows each entrant's status and how many lines and files it has changed. When you have a
winner, **Keep** commits its work and squash-merges it into the branch currently checked out in the
project folder, then deletes the other entrants and their worktrees. **Discard** deletes a single
entrant and its worktree.

## Race from anywhere

You don't have to start on the Race page. **Race this prompt** is in every thread's menu (right-click
the thread in the sidebar, or the thread's title), in the command palette, and next to the send
button whenever the composer has text. From a thread it offers the thread's last request; from the
composer it takes what you typed instead of sending it. Pick two or three agents, then start. The
race runs in the thread's project from its branch, as committed. If that checkout has uncommitted
changes the dialog says so, because entrants start without them. The arena opens as soon as the
entrants start.

An entrant's thread shows **Entrant N of M in a race · Compare** at the top, a judge's thread shows
**Judging a race**, and **Compare this race** is in the command palette while one is open. Each link
goes back to the race's arena.

## Compare entrants in the arena

**Compare** on a race opens its arena. Each entrant gets a lane with its live transcript — messages
as they stream, and the commands and edits it runs — plus how long it has worked and what it has
changed so far. Lanes follow the stream unless you scroll up to read.

Below the lanes, **Changes compared** lines up every file any entrant changed, with each entrant's
additions and deletions side by side. Files every entrant touched come first; the summary says how
many files only one entrant touched. Open a file to see each entrant's diff of it next to the
others. Counts include new, untracked files and anything an entrant committed on its race branch.

**Ask the judge** starts another agent on any ready provider once every entrant has stopped. It gets
the task, every entrant's diff and final message, and the worktree paths, runs in plan mode so it
cannot change any worktree, and ends with a `Winner: Entrant N` line. The arena marks that entrant
as the judge's pick and offers **Keep Entrant N**; you still decide. The judge is an ordinary thread
named "Judge · <task>", and **Ask another judge** gets a second opinion. If the judge ends without a
winner line, no entrant is marked.

Keep and Discard work the same in the arena as on the board. An entrant that changed no files
cannot be kept. Board and arena count lines from the same worktree diff, so new untracked files are
included in both.

## The scoreboard

Every finished race is recorded on the computer that ran it, in `race-history.json` in T3 Code's
data folder. A race is recorded when you keep a winner, from the arena or the board, or when you
close it with **No winner**. A judge's verdict is added as soon as the judge answers. The record keeps
each entrant's diff size, how long it worked, whether it failed and why, and the cost when its
provider reports one. Claude reports cost; Codex doesn't, so its cost shows as "—". Once a race is
decided its entrant lines don't change, even after Keep merges the winner and deletes the losers.

**Race → Scoreboard** (or **Open Race scoreboard** in the command palette) ranks every agent by
wins. It shows each agent's keep rate over decided races, judge picks, median time to finish,
median reported cost and failures. **Who wins what** names the leader for each kind of task. Each
race's kind (feature, bug fix, refactor, tests, docs, other) is guessed from the opening sentence of
its prompt. Change it in the arena or in the history list; a kind you pick is never re-guessed. Filter
the leaderboard by kind, open a race's arena while its entrants still exist, or remove a race from
the history. Removing a race doesn't touch its threads or code.

## Keeping a winner

Keep merges nothing when the project checkout has uncommitted changes to tracked files, is no
longer on the branch the race started from, or when the entrant's worktree has left its race
branch. In those cases nothing is changed: commit or stash your changes, or switch back to the right
branch, then keep again. If the merge conflicts or a commit hook rejects it, the project checkout is
restored but the entrant's work stays committed on its own branch, and every entrant is kept. Keep is
available once an entrant has finished its turn.

Race and the arena are available on desktop and web. The mobile app shows race entrants and judges as ordinary threads.
