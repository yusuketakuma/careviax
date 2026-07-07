---
type: PerformanceFinding
title: Care Report Bounded Patient Search 2026 07 08
confidence: high
evidence_level: tests-pass
validity_scope: 'careviax main branch, GET /api/care-reports q patient search'
ingested_via: put_page
ingested_at: '2026-07-07T18:57:37.425Z'
source_kind: put_page
tags:
  - care-reports
  - careviax
  - db-read
  - performance
  - phi-minimization
---

# Care report q search bounded patient candidate fix

On 2026-07-08, `GET /api/care-reports` non-palette `q` patient-name search was changed from an unbounded `prisma.patient.findMany` selecting patient identity display fields into a bounded candidate lookup.

Reusable decision:

- Palette search was already bounded and was left unchanged.
- Non-palette broad `q` search now reads only patient `id` candidates, with stable `name_kana/name/id` ordering and `take: CARE_REPORT_PATIENT_SEARCH_CANDIDATE_LIMIT + 1`.
- The active candidate set is capped to `CARE_REPORT_PATIENT_SEARCH_CANDIDATE_LIMIT` before building the `CareReport.patient_id in [...]` predicate.
- `patient_id + q` does not use the broad candidate set. It checks the exact patient under the same org and q predicate with `take: 1`, preserving the F88 intersection invariant.
- Patient display names are re-read only for returned report row `patient_id`s after report filtering/access shaping.

Files:

- `src/app/api/care-reports/route.ts`
- `src/app/api/care-reports/route.test.ts`

Validation evidence:

- Red test failed before implementation for missing `take`, stable `orderBy`, and id-only select.
- `pnpm exec vitest run src/app/api/care-reports/route.test.ts --reporter=dot --testTimeout=30000` passed 68 tests.
- Scoped ESLint and Prettier passed for the changed route/test files.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` passed.

Limits / follow-up:

- This is a route-local bound and PHI minimization fix, not a full indexed search solution.
- Keyword scan, delivery summary aggregate cost, payload budget, and pg_trgm/composite index candidates remain separate follow-ups (`PERF-DB-006B-D`, `PAYLOAD-BUDGET-003`).
- No Prisma schema, migration, DB write, or production data operation was performed.
