# Agent Loop — LOCKS

**Purpose.** Edit-conflict ledger. Records which Supervisor owns which paths for an in-flight
task so the two lanes never edit the same files concurrently.

**How it's used in the loop.** This mirrors the live `agmsg` LOCK discipline already in use:
Claude works the UI lane (`src/app/(dashboard)/**`, `src/components/**`); Codex works the
backend lane (server/perf/refactor/tests). Before editing, a Supervisor LOCKs its paths here
and over agmsg; it drains its inbox before committing and stages only its own files. Release
the lock (set `status: released`) once the task's changes are committed.

| task_id   | owner       | reviewer   | branch                           | locked_paths                                  | forbidden_paths              | status  |
| --------- | ----------- | ---------- | -------------------------------- | --------------------------------------------- | ---------------------------- | ------- |
| _EXAMPLE_ | claude-lead | codex-lead | refactor/state-color-unification | `src/components/**`, `src/app/(dashboard)/**` | `prisma/**`, `src/server/**` | example |

> The `_EXAMPLE_` row above is illustrative only — delete or ignore it; it is not a live lock.
> Lane defaults: Claude (UI) locks `src/components/**` and `src/app/(dashboard)/**`; Codex
> (backend) locks `src/server/**`, `prisma/**`, and test/perf paths. Each lane's locked_paths
> are the other lane's forbidden_paths.
