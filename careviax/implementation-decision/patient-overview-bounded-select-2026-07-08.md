---
type: ImplementationDecision
title: Patient Overview Bounded Select 2026 07 08
confidence: high
evidence_level: tests-and-typecheck
validity_scope: >-
  careviax patient detail root GET and patient overview base read paths as of
  2026-07-08
ingested_via: put_page
ingested_at: '2026-07-07T17:59:59.508Z'
source_kind: put_page
tags:
  - careviax
  - db-performance
  - patient-detail
  - phi-boundary
  - plans-hygiene
---

# Patient overview bounded select / Plans hygiene

Decision: replace broad patient master relation includes on patient detail root GET and the shared overview/snapshot base reader with a shared bounded select contract.

Evidence:
- Added `src/server/services/patient-overview-base-query.ts` with per-relation caps: residences 4, contacts 12, conditions 12, consents 8, cases 8, care_team_links 12.
- Updated `src/app/api/patients/[id]/route.ts` and `src/server/services/patient-state-snapshot.ts` to use the shared select.
- Updated `/api/patients/[id]/overview` to read via `withOrgContext()` rather than the global Prisma client.
- Tests assert no broad `include`, no unbounded relation reads, and no consent `document_url` / `document_file_id` in the root/overview base query.

Validation:
- Focused patient root/overview/snapshot Vitest: 3 files / 45 tests passed.
- Broader patient detail pack: 6 files / 182 tests passed.
- Scoped ESLint passed.
- Prettier check passed after formatting.
- Full `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck` passed.
- `git diff --check` passed before final verification.

Security/performance notes:
- Root GET no longer spreads the entire Prisma patient object into the public response.
- First-visit document URLs are defensively stripped from the response.
- Role-based masking, org-scoped RLS, and PHI read audit behavior remain intact.
- This avoids relation fan-out on root/overview reads as historical patient master data grows.

Follow-up:
- Add payload-size smoke against seeded patient data.
- Continue with `PERF-DB-007` movement timeline caller-limit-aware source reads.
- Continue with `PERF-DB-006` care-report bounded search and EXPLAIN-backed index planning.
