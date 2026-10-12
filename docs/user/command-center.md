<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-01 -->
<!-- agent-watermark: model=grok-4.7; effort=default; duration=18m; seat=cursor; date=2026-09-30 -->
<!-- agent-watermark: model=gemini-3.8-flash; effort=high; duration=7m; seat=antigravity; date=2026-10-01 -->
# Command Center

Command Center is the cross-environment operating view for T3 Code. Open it from the dashboard icon
in the sidebar or search for **Open Command Center** in the command palette.

It brings together:

- active, monitoring, waiting, approval, and failed threads across every connected computer;
- enabled provider instances, authentication identity, default model, and readiness;
- upcoming and failed scheduled routines, complete with red "Failed" status badges and diagnostic failure reasons;
- global skill inventory across supported agent harnesses;
- token volume and API-equivalent usage cost for the past seven days, including a per-harness token count on the readiness table for all connected harnesses (Codex, Claude Code, Grok, OpenCode, Antigravity).

Choose **New task** to prepare a mission for a specific project, computer, provider subscription,
and model. Start with a feature, bug investigation, or review recipe, then edit the instructions.
**Open draft** takes you to the composer for review before sending. Existing drafts with text or
attachments stay available in the sidebar. The selected computer must be connected and the provider
ready. Add a project first if none is available.

Search the mission queue by task, project, computer, or subscription. **Needs attention** shows
approvals, requests for input, and failed sessions; **All missions** also includes ready threads.
Interactive project filter pills allow narrowing down active missions by project alongside status and text search.
Attention items appear first, and **Show more** reveals the rest of the matching queue.

Provider instances are shown separately, even when several use the same harness. This keeps personal,
school, and work subscriptions independently routable. API-equivalent cost is an estimate of what the
same observed tokens would cost at API prices; it is not an invoice or an additional subscription
charge.

The mobile home screen includes a compact fleet summary so active work, attention items, harness
readiness, and routine count remain visible away from the desktop. Open **Settings → Skills** on
mobile to search and inspect the same cross-environment skill inventory.
