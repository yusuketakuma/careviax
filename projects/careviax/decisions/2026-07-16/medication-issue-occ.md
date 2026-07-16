---
type: project
title: Medication Issue Occ
ingested_via: put_page
ingested_at: '2026-07-16T01:08:57.298Z'
source_kind: put_page
---

---
type: ImplementationDecision
title: MedicationIssue writes use a durable version and serializable compare-and-swap
memory_id: projects/careviax/decisions/2026-07-16/medication-issue-occ
project_id: careviax
task_id: MEDSAFE-MEDICATION-ISSUE-OCC-001
commit_after: ea2ba1d3c
created_by: codex1
owner_agent: codex1
reviewer_agent: codex2
confidence: high
evidence_level: gate_verified
validity_scope: { repo: careviax, directories: [prisma, src/app/api/medication-issues, src/app/api/inquiry-records, src/app/(dashboard)/patients], files: [prisma/schema/medication.prisma, src/app/api/medication-issues/[id]/route.ts, src/app/api/medication-issues/route.ts, src/types/api/medication-issues.ts] }
expires_at: null
superseded_by: null
tags: [medication-issue, optimistic-concurrency, serializable, rls, codex1, accepted]
---

# MedicationIssue writes use a durable version and serializable compare-and-swap

## Problem

- summary: MedicationIssue PATCH read authorization and the issue snapshot outside its mutation transaction, then updated by id without a concurrency token. Concurrent clinical edits could overwrite one another, and authorization or assignment changes could race the write.
- evidence: src/app/api/medication-issues/[id]/route.ts, prisma/schema/medication.prisma

## Decision

- adopted: Add MedicationIssue.version, require it on PATCH, re-read active membership and assignment scope inside a Serializable org transaction, updateMany by org, id, version, and assignment scope, then keep promotions and audit in the same transaction.
- reason: A durable client-visible version plus a database compare-and-swap prevents stale UI writes. Fresh transactional authorization prevents time-of-check to time-of-use drift. All inquiry-linked MedicationIssue writers increment version so clients observe server workflow mutations.

## Alternatives rejected

- updated_at as a token - timestamp precision and serialization make it a weaker explicit contract than an integer version.
- preflight-only version comparison - it still permits a race between comparison and mutation.
- update by id followed by audit - it permits stale overwrites and can separate clinical promotion from audit on failure.

## Migration

- from: MedicationIssue PATCH without a concurrency token -> to: versioned Serializable compare-and-swap with same-transaction promotion and audit.

## Verification

- pnpm typecheck -> pass
- focused medication issue, inquiry, medications, and safety-check suites -> 6 files, 199 tests pass
- pnpm api-response-shape:check, client-json-schema:check, route-auth-wrapper:check -> pass
- pnpm rls-policy-contract:check -> 24 tests pass
- pnpm db:e2e:prepare -> 167 migrations applied and seeded
- pnpm test:rls-proof -> 5 tests pass under NOSUPERUSER NOBYPASSRLS role

## Review

- reviewer: codex2 unavailable because no independent codex2 pane was active; codex1 completed test and gate verification.

## Future rule candidate

- Every writer of a versioned clinical aggregate must increment the version, while interactive stale-write protection must compare-and-swap the submitted version in the mutation transaction.

## Links

- canonical: [[file:src/app/api/medication-issues/[id]/route.ts]]
