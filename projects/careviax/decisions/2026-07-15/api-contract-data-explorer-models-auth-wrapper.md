---
type: ImplementationDecision
title: Standardize data explorer model summary auth wrapper
branch: agent/continuous-improvement-20260712
source:
  - 'file:src/app/api/admin/data-explorer/models/route.ts'
  - 'file:src/app/api/admin/data-explorer/models/route.test.ts'
  - 'file:src/app/api/__tests__/route-control-flow-rethrow.test.ts'
  - 'file:tools/route-auth-wrapper-allowlist.json'
  - 'commit:ca063b068'
  - 'test:pnpm exec vitest run focused route wrapper suites'
  - 'test:pnpm route-auth-wrapper:check'
  - 'test:pnpm typecheck'
  - 'test:pnpm typecheck:no-unused'
task_id: API-CONTRACT-001FZDATAEXPLORERMODELSAUTH
repo_url: 'https://github.com/yusuketakuma/careviax'
memory_id: >-
  projects/careviax/decisions/2026-07-15/api-contract-data-explorer-models-auth-wrapper
confidence: high
created_at: '2026-07-14T23:58:20.000Z'
created_by: codex-lead
dedupe_key: 0d6e6e9ecad2ca361ad783daab8872f13f140ca387e6fc3c72d04b0d351d83e3
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-14T23:58:20.000Z'
owner_agent: codex-lead
commit_after: ca063b068
commit_before: 536ea9325968fffe892c8f895ffc750cb17898a2
superseded_by: null
evidence_level: peer_reviewed
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/app/api/admin/data-explorer/models/route.ts
    - src/app/api/admin/data-explorer/models/route.test.ts
    - src/app/api/__tests__/route-control-flow-rethrow.test.ts
    - tools/route-auth-wrapper-allowlist.json
  tech_stack:
    - Next.js
    - TypeScript
  directories:
    - src/app/api/admin/data-explorer
    - src/lib/auth
ingested_via: put_page
ingested_at: '2026-07-14T23:59:05.113Z'
source_kind: put_page
tags:
  - api
  - auth-wrapper
  - no-store
  - request-trace
  - route-handler
---

## Problem

The model-summary GET duplicated direct authentication, sensitive no-store wrapping, fixed internal-error fallback, and Next control-flow handling. This left one direct requireAuthContext route outside the standard request trace and route performance boundary.

## Decision

Migrate only the read-only model-summary GET to withAuthContext while preserving canAdmin, the denial message, tenant org selection, the service call, status, and response body. Remove both the direct-auth allowlist entry and the obsolete route-local control-flow ownership entry because the central wrapper now owns those guarantees.

## Alternatives rejected

- Do not migrate the adjacent table mutation route in the same slice because its PATCH and DELETE behavior has a wider audit and authorization radius.
- Do not change the data-explorer service query or response DTO; this slice is wrapper convergence only.
- Do not keep duplicate route-local try/catch around the standard wrapper.

## Migration

From direct requireAuthContext plus route-local no-store and fixed 500 to the shared withAuthContext boundary. Direct-auth debt moves from 149 to 148 routes and 213 to 212 calls with zero new debt.

## Verification

Focused route, central auth, control-flow, service, and ratchet tests passed. Exact lint and format, API response shape, authorization status, DTO, boundaries, client PHI log, typecheck, and no-unused typecheck passed. Two independent read-only reviews approved the change.

## Review

Reviewer result: APPROVE. No blocker or severity finding. The route test mocks the wrapper, so central auth tests remain mandatory evidence for trace, performance, logging, and control-flow behavior.

## Future rule candidate

When a direct-auth route moves to withAuthContext, update all three ownership surfaces in one slice: the route, route tests plus central wrapper evidence, and static allowlists including route-local control-flow lists.
