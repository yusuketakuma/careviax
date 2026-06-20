# LOOP_POLICY.md

**Purpose.** Per-run operating policy for the claude-lead / codex-lead agent loop. It tells each
Supervisor what to apply unconditionally, what to weigh, and what to leave alone for the current
run. This is the distilled, _enforceable_ slice of long-term memory (gbrain) plus the lane/LOCK
discipline that the two sessions have already proven in practice.

**How it is used in the loop.**

- Read at the **start of every cycle** before any work is planned or dispatched.
- `## ApplyNow` items are non-negotiable for this run; violating one is a stop-the-line event.
- `## Consider` items are weighed against the current objective; record the decision in the run log.
- `## Ignore` items are explicitly out of scope this run (avoids re-litigating settled questions).
- `## BlockedContext` records external dependencies that gate otherwise-ready work.
- `## Peer approval` tracks the proposed_by / reviewed_by / status of each policy line so no single
  Supervisor can unilaterally promote a rule.

- **Run:** RUN-20260620-001
- **Cycle:** 0 (idle, next_action: bootstrap)
- **Date:** 2026-06-20
- **Supervisors:** claude-lead (UI/UX + main impl), codex-lead (backend/perf/refactor/test review)

> **STATUS: gbrain MCP not yet connected** — ApplyNow below is seeded from already-proven
> lane/LOCK/drain discipline. Populate the remainder from the Memory Bootstrap once the
> `setup-gbrain` skill has been run and gbrain search is live. Do not invent gbrain-derived
> policy until then.

---

## ApplyNow

Proven, in-effect-now discipline. Apply on every cycle without re-deciding.

1. **Lane discipline.** Claude owns `src/app/(dashboard)/**` and `src/components/**` (UI/UX + main
   implementation). Codex owns backend / perf / refactor / test-review. Do not edit across lanes
   without an explicit handoff.
2. **LOCK before edit.** Announce a path LOCK over agmsg (team `phos`, supervisor-to-supervisor
   only) before editing any shared file. Release the LOCK when the edit lands.
3. **Drain inbox before commit.** Run `inbox.sh phos <name>` and resolve every pending message
   before staging or committing. Never commit over an unread LOCK or objection.
4. **Stage only your own files.** `git add` only paths in your lane. Never blanket `git add -A`.
5. **Supervisors-only on agmsg.** Only claude-lead and codex-lead write to agmsg. Subagents and
   workers never message directly — they report up to their Supervisor.
6. **Verify before claiming done.** Use the real commands: `pnpm lint`, `pnpm typecheck`,
   `pnpm typecheck:no-unused`, `pnpm format:check`, `pnpm test`, `pnpm build`,
   `pnpm test:e2e` / `pnpm test:e2e:audit`. No "done" without passing evidence.
7. **UI/UX changes consult the SSOT first.** Read `docs/ui-ux-design-guidelines.md` and the
   State Color token system before any visual/state-color change. CLAUDE.md's older color prose
   is superseded by the 6-axis StateBadge/StatusDot tokens.
8. **Compliance by Design.** Treat 3省2ガイドライン (MHLW v6.0 + METI/MIC v1.1) + APPI as a
   design precondition, not a later audit. Tenant isolation goes through Prisma + PostgreSQL RLS
   (`SET LOCAL app.current_org_id`); never weaken it for convenience.

## Consider

Weigh against the current objective; log the decision in the run log. (Seed list — extend from
gbrain once connected.)

- Choosing the lightest verification subset that still covers the change (e.g. skipping full
  `pnpm build` for a docs-only cycle) — justify in the run log.
- Whether a change spanning both lanes should be split into two LOCKed, separately-reviewed PRs.
- Whether to wire the currently-unconfigured gates (secret scan, dependency audit / `pnpm audit`,
  SAST) for the touched surface this run.

## Ignore

Explicitly out of scope for this run; do not re-litigate.

- Re-deriving the lane split or the LOCK/drain protocol — already settled (see ApplyNow).
- Re-opening the State Color decision — tokens are the SSOT
  (`docs/state-color-migration-map.md`).

## BlockedContext

External dependencies gating otherwise-ready work. Mark blocked items `cc:blocked` (lowercase).

- **gbrain long-term memory** — MCP not connected. Blocks Consider/Ignore population and any
  gbrain-derived policy. Unblock via the `setup-gbrain` skill. `cc:blocked`
- **Security gates (secret scan / dependency audit / SAST)** — recommended, not yet configured —
  TODO. Cannot be enforced as ApplyNow until wired. `cc:blocked`

## Peer approval

Each policy line needs proposed_by + reviewed_by + status before it graduates to ApplyNow.
Status values: `proposed` → `peer-approved` → `applied` (or `rejected`).

| Policy line                                       | proposed_by | reviewed_by | status                |
| ------------------------------------------------- | ----------- | ----------- | --------------------- |
| ApplyNow §1–6 (lane/LOCK/drain/verify discipline) | claude-lead | codex-lead  | applied (proven seed) |
| ApplyNow §7 (UI/UX SSOT + State Color tokens)     | claude-lead | _pending_   | proposed              |
| ApplyNow §8 (Compliance by Design + RLS)          | codex-lead  | _pending_   | proposed              |
| _next candidate_                                  | _name_      | _name_      | proposed              |
