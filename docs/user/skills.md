<!-- agent-watermark: model=gemini-3.8-flash; effort=high; duration=15m; seat=antigravity; date=2026-10-01 -->
<!-- agent-watermark: model=grok-4.7; effort=default; duration=15m; seat=cursor; date=2026-09-30 -->

# Skills

Open **Settings → Skills** on desktop, web, or mobile to inspect reusable agent instructions
installed on each connected computer. T3 Code groups installations by provider instance, so the
same skill can appear separately for different harnesses or subscriptions.

The inventory discovers global Codex, Claude, Cursor, Grok, OpenCode, and Antigravity skills and shows the
skill name, description, source directory, and `SKILL.md` content. Search matches names,
descriptions, harnesses, and paths. Active subscriptions without global skills remain visible as quiet
harnesses ("No global skills") across desktop, web, and mobile, confirming that discovery succeeded
rather than being skipped. The inventory is read-only: install or edit a skill in the
harness's normal configuration directory, then refresh the inventory.

Project-specific skills continue to appear in the composer for the active project. The global
inventory does not replace provider-native enablement or invocation rules.
