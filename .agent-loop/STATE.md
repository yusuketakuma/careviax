# Agent Loop — STATE

**Purpose.** Single source of truth for the current loop's runtime state. The two Supervisors
(`claude-lead`, `codex-lead`) read this at the start of every cycle and write it back at the
end. It is the first file consulted on resume and the last file written on a hard-stop.

**How it's used in the loop.**

- At cycle start: read the YAML, confirm `current_run_id` / `current_cycle`, pick up `next_action`.
- During a cycle: update `active_task_id`, `claude_status`, `codex_status` as work proceeds.
- At the gate: write `last_gate_result` (pass | fail | unknown).
- On hard-stop: write the **Resume point** section below so the next session continues cleanly.
- `zero_actionable_count` increments each cycle the queue yields no actionable task; the loop
  idles/backs off when it climbs (see FEATURE_QUEUE.md for intake).

```yaml
current_run_id: RUN-20260620-001
current_cycle: 0
active_task_id: none
claude_status: idle # idle | planning | implementing | reviewing | verifying | blocked
codex_status: idle # idle | planning | implementing | reviewing | verifying | blocked
last_memory_bootstrap: none # ISO ts of last gbrain bootstrap. NOTE: gbrain MCP not yet connected (Phase 3 — gstack setup-gbrain); stays `none` until then.
zero_actionable_count: 0
last_gate_result: unknown # pass | fail | unknown
next_action: bootstrap
```

## Resume point

<!-- Written only on hard-stop. Capture: active_task_id, the exact step in progress,
     any locked paths to release, and the single next command/action to take.
     Empty at bootstrap. -->

_(empty)_

> Note: a hard-stop writes the **Resume point** here before exiting so the next session can resume without re-deriving context.
