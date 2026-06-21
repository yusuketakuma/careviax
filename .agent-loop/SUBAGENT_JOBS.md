# AGLOOP v5 — Subagent Job Registry

**Purpose.** Catalog of the subagent job types each supervisor spawns inside
the CareViaX (PH-OS Pharmacy) agent loop. A "subagent" is a short-lived worker
launched by a supervisor (`claude-lead` or `codex-lead`) to do one scoped piece
of work — explore, scan, verify, write tests — and return a result.

**How it's used in the loop.** A supervisor picks a job from this registry,
spawns the subagent with an explicit scope and `locked_paths`, collects its
output, then **summarizes the result into a single agmsg envelope** (§8.1)
before anything goes on the wire. Subagents themselves never write to agmsg —
that is a supervisor-only channel (see `MESSAGE_PROTOCOL.md` Transport).

**Lane discipline.** Claude side owns UI/UX + main implementation
(`src/app/(dashboard)/**`, `src/components/**`); Codex side owns
backend / perf / refactor / test review (`prisma/**`, `src/server/**`,
`src/lib/db/**`). A subagent's `locked_paths` must stay inside its side's lane.

---

## §10 — Codex-side roles

| Role                  | What it does                                                                                                                                                                                              | Typical scope / locked_paths                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `explorer`            | Maps the relevant slice of the codebase before a change: entry points, call graph, data flow, prior art. Read-mostly.                                                                                     | Read across repo; no locks (read-only lane).                    |
| `duplication-scanner` | Finds copy-pasted logic / near-duplicate components and proposes consolidation. Feeds refactor proposals.                                                                                                 | `src/**` (read); locks only files it is asked to consolidate.   |
| `verifier`            | Runs the real verification commands and reports verdict + evidence: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e` / `:audit`.                                                              | No source edits; locks `tools/tests/**` artifacts output only.  |
| `security-regression` | Checks the diff for RLS / tenant-isolation regressions, secret leakage, and trust-boundary issues. (SAST + secret scan: **recommended, not yet configured — TODO**; `pnpm audit` for deps likewise TODO.) | `prisma/**`, `src/server/**`, `src/lib/db/**` (read); no edits. |
| `test-writer`         | Authors Vitest unit tests / Playwright e2e for new or changed backend behavior; never reviews its own tests.                                                                                              | `tools/tests/**`, `src/**/*.test.ts` within the backend lane.   |

## §10 — Claude-side roles

| Role                                     | What it does                                                                                                                                                           | Typical scope / locked_paths                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `dynamic-workflow` (ultracode authoring) | Implements UI/UX features and flows: pages, components, state, a11y, applying `docs/ui-ux-design-guidelines.md` as SSOT.                                               | `src/app/(dashboard)/**`, `src/components/**`.   |
| `ui-verifier`                            | Verification pass for the Claude lane: `pnpm lint`, `pnpm typecheck`, `pnpm test`, plus design-fidelity / a11y check. Separate pass from authoring (no self-approval). | Read UI lane; locks `tools/tests/.artifacts/**`. |

---

## Job ledger

One row per spawned subagent job this run. `status`: `queued | running | done | blocked`.

| job_id          | side   | role             | scope / locked_paths                                                                                       | status             |
| --------------- | ------ | ---------------- | ---------------------------------------------------------------------------------------------------------- | ------------------ |
| JOB-EXAMPLE-001 | claude | dynamic-workflow | `src/app/(dashboard)/prescriptions/**`, `src/components/state/**` — implement StateBadge token unification | done (example row) |
