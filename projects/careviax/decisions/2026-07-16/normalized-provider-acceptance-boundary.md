---
type: ImplementationDecision
title: >-
  Require provider acceptance evidence before reporting external delivery
  success
task_id: STABILITY-DELIVERY-PROVIDER-READINESS-001
memory_id: projects/careviax/decisions/2026-07-16/normalized-provider-acceptance-boundary
confidence: high
created_by: codex-lead
expires_at: null
project_id: careviax
owner_agent: codex-lead
commit_after: 1f78359f7
superseded_by: null
evidence_level: gate_verified
reviewer_agent: null
validity_scope:
  repo: careviax
  directories:
    - src/server/adapters
    - src/server/services
    - src/app/api/external-access
    - src/app/api/health
ingested_via: put_page
ingested_at: '2026-07-16T03:42:46.369Z'
source_kind: put_page
tags:
  - accepted
  - codex1
  - delivery
  - line
  - otp
  - readiness
  - security
  - sms
  - stability
---

# Require provider acceptance evidence before reporting external delivery success

## Problem

- summary: Missing SMS/LINE configuration silently used success stubs, causing an external-access OTP to be removed from the response even though no provider accepted it.
- evidence: src/server/adapters/sms/index.ts, src/server/adapters/line/index.ts, src/app/api/external-access/route.ts

## Decision

- adopted: Normalize each attempt as accepted, not_configured, failed, or unknown. Accepted requires a Twilio Message SID plus accepted provider status, or a LINE request ID. Every other result keeps the OTP on the audited manual path and appears in admin provider readiness.
- reason: HTTP completion or a no-op stub is not evidence that a provider accepted the message; a stable provider ID is required for reconciliation.

## Alternatives rejected

- Silent production stub fallback — creates false delivery success.
- Treat every HTTP 2xx as accepted — loses reconciliation when the provider ID or accepted state is absent.
- Throw all provider outcomes — erases the distinction between definite rejection and ambiguous response loss.

## Migration

- from: [void-returning SMS/LINE adapters] -> to: [src/server/adapters/delivery-result.ts]

## Verification

- focused Vitest 5 files / 84 tests, scoped ESLint, Prettier, Plans active gate, diff check, full typecheck, and no-unused typecheck passed.

## Review

- reviewer: codex2 unavailable in the current tmux session; result: not independently reviewed. Official Twilio and LINE response contracts plus local gates passed.

## Future rule candidate

- External delivery can be called accepted only when the provider returns a stable acceptance identifier; accepted and delivered remain distinct states.

## Links

- canonical: [[file:src/server/adapters/delivery-result.ts]]
- canonical: [[file:src/app/api/external-access/route.ts]]
