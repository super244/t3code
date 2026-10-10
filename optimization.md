<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=9m; seat=codex; date=2026-10-10 -->
# t3code optimization audit

Audit: 2026-10-10, America/Vancouver. Small resource-focused pass; source inspected in the canonical checkout. Runtime snapshots are instantaneous, not leak or battery-drain benchmarks. Proposed remedies below are not implemented unless explicitly stated.

## Evidence and cause

apps/server/src/resourceTelemetry/HostResources.ts explicitly avoids idle polling; ResourceTelemetryHistory.ts bounds query windows; packages/client-runtime/src/state/terminalSession.ts bounds terminal buffers.

The Alpha main process snapshot was 484,304 KiB RSS (about 473 MiB); this excludes renderer/server/agent children. Electron renderers, active agent sessions and terminals are distinct costs. Existing telemetry/history/buffer bounds are present; no new leak was proven.

## Fix and verification

Measure the complete Alpha PID tree in idle, one-thread and multi-thread cases. Profile subscriptions, terminal backlogs and duplicate dev servers; retain visibility/subscriber guards and cleanup tests. The checkout has hundreds of dirty paths, so only this audit note is committed to the fork main, never to upstream. No product change.
