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
cannot be kept.

## Keeping a winner

Keep merges nothing when the project checkout has uncommitted changes to tracked files, is no
longer on the branch the race started from, or when the entrant's worktree has left its race
branch. In those cases nothing is changed: commit or stash your changes, or switch back to the right
branch, then keep again. If the merge conflicts or a commit hook rejects it, the project checkout is
restored but the entrant's work stays committed on its own branch, and every entrant is kept. Keep is
available once an entrant has finished its turn.

Race and the arena are available on desktop and web. The mobile app shows race entrants and judges as ordinary threads.
