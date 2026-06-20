# Agent Loop — LOCKS

**Purpose.** Edit-conflict ledger. Records which Supervisor owns which paths for an in-flight
task so the two lanes never edit the same files concurrently.

**How it's used in the loop.** This mirrors the live `agmsg` LOCK discipline already in use:
Claude works the UI lane (`src/app/(dashboard)/**`, `src/components/**`); Codex works the
backend lane (server/perf/refactor/tests). Before editing, a Supervisor LOCKs its paths here
and over agmsg; it drains its inbox before committing and stages only its own files. Release
the lock (set `status: released`) once the task's changes are committed.

| task_id   | owner       | reviewer   | branch                           | locked_paths                                  | forbidden_paths              | mode | lease_until            | state_version | status  |
| --------- | ----------- | ---------- | -------------------------------- | --------------------------------------------- | ---------------------------- | ---- | ---------------------- | ------------- | ------- |
| _EXAMPLE_ | claude-lead | codex-lead | refactor/state-color-unification | `src/components/**`, `src/app/(dashboard)/**` | `prisma/**`, `src/server/**` | lock | `2026-06-20T12:00:00Z` | 1             | example |

> The `_EXAMPLE_` row above is illustrative only — delete or ignore it; it is not a live lock.
> Lane defaults: Claude (UI) locks `src/components/**` and `src/app/(dashboard)/**`; Codex
> (backend) locks `src/server/**`, `prisma/**`, and test/perf paths. Each lane's locked_paths
> are the other lane's forbidden_paths.

**Column semantics.** `mode` is the lock mode — `lock` means exclusive (only the `owner` may
edit `locked_paths`). `lease_until` is an ISO-8601 expiry; a lock past its lease is considered
stale and may be reclaimed (re-LOCK to extend). `state_version` is an integer incremented on
every lock/unlock mutation of a row.

**Optimistic locking.** Any concurrent modification of a LOCKS row MUST increment `state_version`.
A Supervisor reads the row's `state_version`, mutates, and writes back the incremented value; if
the on-disk `state_version` already advanced past what it read, the write is a lost-update and the
Supervisor must re-read and retry. This detects two lanes racing the same row.

**Idempotency.** Each `LOCK_REQUEST` over agmsg carries an `idempotency_key` (UUID); a re-sent
request with the same key is a no-op (no duplicate grant), so retries on flaky transport are safe.
See `MESSAGE_PROTOCOL.md` for the wire field.

**Workload handoff locks.** A load-balancing `HANDOFF` changes who owns the work, but it does not
expand the edit scope. The receiver must request/hold an explicit LOCK for the exact paths being
transferred, and the sender must treat those paths as forbidden while the receiver implements. A
resent handoff reuses the same `idempotency_key`; it must not create a second ownership flip or a
broader lock. Any handoff row still increments `state_version` when ownership, paths, or status
change.

**Worktree & conflict model.** Lane assignment (UI vs backend worktree/lane) plus agmsg LOCK
discipline prevents _mechanical_ (file-level) conflicts — the two lanes never touch the same
paths, so git never sees overlapping edits. _Logical_ conflicts (a double-claimed task, circular
ownership across rows) are not visible at the file level and are caught instead by `state_version`
(lost-update detection) + `idempotency_key` (duplicate-grant suppression).
