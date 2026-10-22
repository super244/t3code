<!-- agent-watermark: model=opus-5.5; effort=high; duration=5m; seat=claude-code; date=2026-10-22 -->

# Memory

Memory is a list of short facts that every new agent session starts with, whatever the provider:
your preferences, decisions, conventions, commands that work, and gotchas. A project's memory
reaches every new session in that project. **Everywhere** memory reaches every session on that
computer.

Open **Settings → Memory** to see everything remembered on a connected computer, or the **Memory**
section of a project's home page to see that project's memory together with Everywhere memory. Type a
fact, choose where it applies, and press **Remember** (or ⌘↵). Edit or forget any entry from its row.
Each row says whether you or an agent saved it, and links to the thread an agent saved it from.

Agents add to memory themselves with the `remember` tool, search it with `recall`, and remove wrong
entries with `forget`. These tools come from T3 Code, so Claude, Codex, Cursor, Grok, OpenCode and
Antigravity sessions all have them. Saving a fact that is already remembered refreshes it instead of
adding a duplicate.

When a provider session starts, its first prompt carries the newest entries, up to about 6,000
characters. Older entries stay searchable with `recall`. A thread that is already running picks up
new memory the next time its session starts. Memory is stored on the computer that runs T3 Code, in
`memory.json` in its data folder, and is never sent to another computer.

The mobile app doesn't show memory yet, but agents started from the phone still receive it.
