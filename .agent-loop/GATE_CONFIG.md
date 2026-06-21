# GATE_CONFIG — Objective Acceptance Gates

**Purpose.** This file is the single source of truth for the _objective_ gates that
decide whether a change in the careviax (PH-OS Pharmacy) agent loop is "done". LLM
review is necessary but never sufficient: a slice is only accepted once the wired
gates below pass with evidence (spec §2.4). Supervisors (claude-lead, codex-lead)
consult this file to pick which gates to run for a given slice and to attach pass/fail
evidence to the RUN ledger.

**How it is used in the loop.**

- After every cheap slice, the owning lane runs the **cheap gates** and records results.
- Before declaring a slice _done_ or proposing a merge, the lane runs the **heavy gates**
  for the impacted area.
- A gate marked `wired: yes` is enforceable today. A gate marked `wired: no` is a known
  gap — it must NOT be reported as passing; reference the TODO instead.

- run_id (initial): RUN-20260620-001
- cycle: 0 · status: idle · next_action: bootstrap
- date: 2026-06-20

---

## Gates

| Gate                 | Command                              | Wired                          | Cost  | When to run                                   |
| -------------------- | ------------------------------------ | ------------------------------ | ----- | --------------------------------------------- |
| lint                 | `pnpm lint`                          | yes                            | cheap | every slice                                   |
| format               | `pnpm format:check`                  | yes                            | cheap | every slice                                   |
| typecheck            | `pnpm typecheck`                     | yes                            | cheap | every slice                                   |
| no-unused typecheck  | `pnpm typecheck:no-unused`           | yes (added by Codex)           | cheap | every slice                                   |
| unit test (targeted) | `pnpm exec vitest run <impacted>`    | yes                            | cheap | every slice — impacted files/areas            |
| unit test (full)     | `pnpm test` (Vitest, ~8k tests)      | yes                            | heavy | before done / merge, or periodic broad run    |
| build                | `pnpm build`                         | yes                            | heavy | before done / merge                           |
| e2e                  | `pnpm test:e2e` (Playwright)         | yes                            | heavy | before done / merge — impacted areas          |
| e2e (audit)          | `pnpm test:e2e:audit`                | yes                            | heavy | before done / merge — audit-impacting changes |
| secret scan          | _(recommended, e.g. gitleaks)_       | **no — TODO**                  | cheap | once wired: every commit                      |
| dependency audit     | `pnpm audit`                         | available, not a required gate | cheap | periodic / on dep change                      |
| SAST                 | _(recommended, e.g. semgrep/CodeQL)_ | **no — TODO**                  | heavy | once wired: before merge                      |

### Gate details

- **lint** — `pnpm lint`. ESLint flat config (eslint@10). Wired. Cheap.
- **format** — `pnpm format:check`. Prettier check (prettier@3.8). Wired. Cheap.
- **typecheck** — `pnpm typecheck`. Runs `next typegen` + `tsc` + `tsc -p tsconfig.sw.json`
  (covers app types + the Serwist service worker). Wired. Cheap.
- **no-unused typecheck** — `pnpm typecheck:no-unused`. Stricter pass that flags unused
  locals/params; added by Codex. Wired. Cheap. Run alongside typecheck on every slice.
- **unit test (targeted)** — `pnpm exec vitest run <impacted files/area>`. Vitest@4. Wired.
  Cheap — run on every slice for the files/areas the change touches.
- **unit test (full)** — `pnpm test` runs the whole Vitest suite (~8k tests). Wired but
  **heavy**: run before declaring a slice done / proposing a merge, or as a periodic broad
  validation — NOT on every slice (it would stall the loop). Evidence recording stays mandatory.
- **build** — `pnpm build`. Next.js 16 production build. Wired. Heavy — run before
  declaring done or proposing a merge, not on every slice.
- **e2e** — `pnpm test:e2e`. Playwright@1.58. Wired but heavy: run for the impacted
  flows/areas, not the full suite on every slice.
- **e2e (audit)** — `pnpm test:e2e:audit`. Audit-focused Playwright config. Wired,
  heavy. Run when the change touches audit-logged or compliance-relevant paths.
- **secret scan** — recommended, NOT yet wired. TODO: add gitleaks (or equivalent) as a
  required pre-commit/CI gate. Until wired, do not claim secret-scan coverage.
- **dependency audit** — `pnpm audit` is available but is not yet a required gate. Run on
  dependency changes and periodically; findings are advisory until promoted to a gate.
- **SAST** — recommended, NOT yet wired. TODO: add static analysis (e.g. semgrep or
  CodeQL) before merge once configured.

---

## Gate policy (§2.4)

- **Objective gates are the final word.** LLM/code-review (necessary) catches intent,
  taste, and structural issues, but acceptance leans on the wired objective gates above.
  A change is **not "done" on LLM review alone** — the relevant gates must be green with
  recorded evidence.
- **Cheap gates — run every slice:** lint, format, typecheck, no-unused typecheck, and
  **targeted** unit tests (`pnpm exec vitest run` for the impacted files/areas). Fast
  feedback; failing any blocks the slice. (The full Vitest suite is ~8k tests — too heavy
  for every slice; running it per slice would stall the loop or train agents to skip it.)
- **Heavy gates — run before done/merge:** the **full** unit suite (`pnpm test`), build,
  e2e, e2e:audit. Scope e2e to the impacted area to control cost. The full suite may also
  run as a periodic broad validation between slices.
- **Not-yet-wired gates** (secret scan, SAST) and **advisory checks** (`pnpm audit`) must
  be reported honestly: never count an unwired gate as a pass. Wiring them is tracked as
  a TODO and, once done, this table's `Wired` column is updated.
- **Evidence:** every gate run records command + result (pass/fail) into the run ledger;
  a green slice carries the list of gates it passed.

---

## Done Condition (§2.5)

A slice is **Done** only when ALL of the following hold — this is the single canonical
"done" definition for the loop. Partial satisfaction is **not** done; keep working.

1. **Peer review APPROVED.** The maker/checker split is honored (implementer never
   self-completes): the peer supervisor (Claude↔Codex) has returned `APPROVED`. Docs-only
   slices that touch no `src/`, config, or schema may skip review — state "docs-only, no
   review needed" explicitly.
2. **All applicable gates green with recorded evidence.** Every gate selected for the
   slice's impacted area (per the table above) passed, and each carries command + result
   in the run ledger. No "assumed green".
3. **Unwired gates never claimed as passing.** Not-yet-wired gates (secret scan, SAST) and
   advisory checks (`pnpm audit`) are reported honestly — referenced as TODO, never counted
   as a pass (reaffirms §2.4).
4. **STATE.md updated.** `.agent-loop/STATE.md` reflects the new cycle/status/next_action
   and the slice outcome.
5. **gbrain writeback complete.** Per `GBRAIN_SCHEMA.md` §15 (redact → evidence →
   confidence/evidence_level/validity_scope → tag → link → dedupe). The resulting
   `memory_id` (slug) is appended to `STATE.md`. If writeback is BLOCKED (e.g. embeddings),
   note the block explicitly instead of silently skipping.
6. **next_action clear.** The next concrete action (or "idle — slice closed") is stated in
   `STATE.md` so the following cycle can start without rediscovery.
7. **Ledgers record the verdict.** `REVIEW_LOG.md` carries the peer verdict and
   `VERIFY_LOG.md` carries the gate results for this slice.

If any item is unmet, the slice is **partial**, not done — record what remains in
`next_action` and continue the loop.
