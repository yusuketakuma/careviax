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

| Gate                | Command                              | Wired                          | Cost  | When to run                                   |
| ------------------- | ------------------------------------ | ------------------------------ | ----- | --------------------------------------------- |
| lint                | `pnpm lint`                          | yes                            | cheap | every slice                                   |
| format              | `pnpm format:check`                  | yes                            | cheap | every slice                                   |
| typecheck           | `pnpm typecheck`                     | yes                            | cheap | every slice                                   |
| no-unused typecheck | `pnpm typecheck:no-unused`           | yes (added by Codex)           | cheap | every slice                                   |
| unit test           | `pnpm test` (Vitest)                 | yes                            | cheap | every slice                                   |
| build               | `pnpm build`                         | yes                            | heavy | before done / merge                           |
| e2e                 | `pnpm test:e2e` (Playwright)         | yes                            | heavy | before done / merge — impacted areas          |
| e2e (audit)         | `pnpm test:e2e:audit`                | yes                            | heavy | before done / merge — audit-impacting changes |
| secret scan         | _(recommended, e.g. gitleaks)_       | **no — TODO**                  | cheap | once wired: every commit                      |
| dependency audit    | `pnpm audit`                         | available, not a required gate | cheap | periodic / on dep change                      |
| SAST                | _(recommended, e.g. semgrep/CodeQL)_ | **no — TODO**                  | heavy | once wired: before merge                      |

### Gate details

- **lint** — `pnpm lint`. ESLint flat config (eslint@10). Wired. Cheap.
- **format** — `pnpm format:check`. Prettier check (prettier@3.8). Wired. Cheap.
- **typecheck** — `pnpm typecheck`. Runs `next typegen` + `tsc` + `tsc -p tsconfig.sw.json`
  (covers app types + the Serwist service worker). Wired. Cheap.
- **no-unused typecheck** — `pnpm typecheck:no-unused`. Stricter pass that flags unused
  locals/params; added by Codex. Wired. Cheap. Run alongside typecheck on every slice.
- **unit test** — `pnpm test`. Vitest@4. Wired. Cheap.
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
- **Cheap gates — run every slice:** lint, format, typecheck, no-unused typecheck, unit
  test. Fast feedback; failing any blocks the slice.
- **Heavy gates — run before done/merge:** build, e2e, e2e:audit. Scope e2e to the
  impacted area to control cost.
- **Not-yet-wired gates** (secret scan, SAST) and **advisory checks** (`pnpm audit`) must
  be reported honestly: never count an unwired gate as a pass. Wiring them is tracked as
  a TODO and, once done, this table's `Wired` column is updated.
- **Evidence:** every gate run records command + result (pass/fail) into the run ledger;
  a green slice carries the list of gates it passed.
