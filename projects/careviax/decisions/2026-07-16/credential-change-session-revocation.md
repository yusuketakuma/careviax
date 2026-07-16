---
type: SecurityFinding
title: Credential changes require local epoch revocation plus Cognito global sign-out
task_id: AUTH-CREDENTIAL-CHANGE-SESSION-REVOCATION-001
memory_id: projects/careviax/decisions/2026-07-16/credential-change-session-revocation
confidence: high
created_by: codex1
expires_at: null
project_id: careviax
owner_agent: codex1
commit_after: 6be9b5c6a
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex2
validity_scope:
  repo: careviax
  files:
    - prisma/schema/organization.prisma
    - src/server/services/credential-revocation.ts
    - src/lib/auth/context.ts
  directories:
    - prisma
    - src/lib/auth
    - src/server/services
    - src/app/api/auth
    - src/app/api/me
    - src/app/api/jobs
ingested_via: put_page
ingested_at: '2026-07-16T01:27:56.743Z'
source_kind: put_page
tags:
  - accepted
  - auth
  - codex1
  - cognito
  - durable-intent
  - security
  - session-revocation
---

# Credential changes require local epoch revocation plus Cognito global sign-out

## Finding

Cognito token revocation alone does not invalidate a self-contained JWT when an application only verifies signature and expiry. A local session epoch alone also permits a still-valid Cognito session to authenticate again. Password change and reset therefore need both boundaries.

## Decision

Persist a per-user credential revocation intent before the provider mutation. While the intent exists, authenticated API context fails closed. After provider success, increment session_version and append one audit entry transactionally, call IAM-authorized AdminUserGlobalSignOut, and clear the intent only after both boundaries succeed. Ambiguous provider failures retain the intent. A bounded reconciliation job conservatively completes stale intents and retries sign-out without duplicating local epoch or audit.

## Verification

- focused auth, context, job, admin, data-explorer suites: 9 files, 125 tests pass
- typecheck, exact ESLint/Prettier, Prisma validate/generate pass
- API shape, authz status, client schema, route auth wrapper pass
- local E2E DB applies 168 migrations and seeds
- RLS contract 24 tests and NOSUPERUSER NOBYPASSRLS proof 5 tests pass

## Official references confirmed 2026-07-16

- Amazon Cognito Ending user sessions with token revocation: https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html
- Amazon Cognito Refresh tokens: https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html
- Amazon Cognito ConfirmForgotPassword API: https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_ConfirmForgotPassword.html

## Review

codex2 was unavailable because no independent codex2 pane was active. Codex1 completed adversarial tests, static gates, local migration, and RLS proof.
