<!-- agent-watermark: model=opus-5.5; effort=high; duration=60m; seat=claude-code; date=2026-10-05 -->

# Continue with another agent

A thread stays on the provider it started with. When that provider stops — a usage limit, an
outage, or you want a different model's take — **Continue with another agent** picks the work up
in a new thread on the provider and model you choose, in the same checkout.

Start it from the thread's menu (right-click the thread in the sidebar, or click its title), from
the command palette, or from **Continue with another agent** on a thread's error banner.

The new thread opens with a brief written from the old one: the original request, the latest plan,
recent messages, the files changed in the checkout, and where the previous agent stopped. You can
add what it should do next and read the brief before continuing. The new agent works on the same
branch and files, so nothing is copied or merged. The original thread is kept, and each thread
links to the other at the top of the conversation.

If the current agent is still working, stop it first so two agents don't edit the same files at
once; the dialog offers to stop it. The mobile app shows continued threads as ordinary threads.
