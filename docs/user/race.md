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

Keep merges nothing when the project checkout has uncommitted changes to tracked files, is no
longer on the branch the race started from, or when the entrant's worktree has left its race
branch. In those cases nothing is changed: commit or stash your changes, or switch back to the right
branch, then keep again. If the merge conflicts or a commit hook rejects it, the project checkout is
restored but the entrant's work stays committed on its own branch, and every entrant is kept. Keep is
available once an entrant has finished its turn.

Race is available on desktop and web. The mobile app shows race entrants as ordinary threads.
