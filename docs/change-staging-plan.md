# Change Staging Plan

作成日: 2026-06-12

この文書は、広範な dirty worktree を安全に checkpoint / review / commit するための staging plan です。2026-06-12 時点の `git status --short`、`git diff --stat`、`docs/refactor-proposals.md`、`.codex/ralph-state.md` を根拠に分類しています。

## Current Verified Baseline

- Node / pnpm: Node `v24.16.0`、pnpm `11.5.2`
- Full validation: `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm test -- --reporter=dot`、`pnpm build` は pass
- API auth migration: `rg "withAuth\\(" src/app/api -g route.ts` は 0 件
- API raw audit writes: `rg "auditLog\\.create" src/app/api -g route.ts` は 0 件
- DB migration: 未適用。承認済み DB 環境でのみ precheck / apply / verify する

## Dirty Tree Summary

- tracked changes: 295 files
- untracked files: 18 files
- largest change families:
  - API auth/audit standardization
  - Node / pnpm runtime pinning
  - env safety and structured logger groundwork
  - DB schema and migration groundwork
  - dashboard / patient UI replacement and legacy deletion
  - scheduling / visit route typing and helper cleanup
  - file storage and webhook security groundwork
  - docs and Ralph state

## Proposed Checkpoint Order

### 1. Runtime Pin And Project Conventions

Scope:

- `.github/workflows/ci.yml`
- `.node-version`
- `.nvmrc`
- `package.json` / lockfile if changed in the local tree
- `CLAUDE.md`
- `docs/api-conventions.md`
- `docs/refactor-proposals.md`
- `.codex/ralph-state.md`

Why first:

- This fixes the execution baseline used by every later validation.
- It is small, easy to review, and has low rollback complexity.

Validation:

- `source ~/.nvm/nvm.sh && nvm use 24.16.0 >/dev/null && node -v && pnpm -v`
- `rg -n "24\\.14\\.1" .nvmrc .node-version package.json .github/workflows/ci.yml`
- `pnpm format:check`

### 2. Auth Context And Audit Helper Infrastructure

Scope:

- `src/lib/auth/context.ts`
- `src/lib/auth/middleware.ts`
- `src/lib/audit/audit-entry.ts`
- `src/lib/audit/audit-entry.test.ts`
- protected route matrix tests that enforce the new wrapper shape

Why second:

- API route changes depend on these helpers.
- Keeping helper changes separate makes API diffs easier to review.

Validation:

- `pnpm exec vitest run src/lib/audit/audit-entry.test.ts --reporter=dot`
- `pnpm typecheck`
- `pnpm lint`

### 3. API Auth/Audit Route Rollout

Scope:

- `src/app/api/**/route.ts`
- `src/app/api/**/route.test.ts`
- `src/app/api/__tests__/protected-*.test.ts`
- `src/app/api/__tests__/workflow-*.test.ts`

Review boundaries:

- Verify every changed route preserves org scope.
- Verify permission options remain equivalent.
- Verify `params: Promise<...>` route contexts are still passed.
- Verify audit writes use `createAuditLogEntry` where applicable.

Validation:

- `rg -n "withAuth\\(" src/app/api -g route.ts`
- `rg -n "auditLog\\.create" src/app/api -g route.ts`
- `pnpm test -- --reporter=dot`
- `pnpm build`

### 4. DB Schema And Migration Groundwork

Scope:

- `prisma/schema/admin.prisma`
- `prisma/schema/communication.prisma`
- `prisma/schema/drug.prisma`
- `prisma/schema/organization.prisma`
- `prisma/schema/patient.prisma`
- `prisma/schema/prescription.prisma`
- `prisma/migrations/20260612090000_add_workflow_exception_patient_and_drug_alert_org/migration.sql`
- `src/types/domain-literals.ts`
- schema-related service and route changes

Review boundaries:

- Migration must not be applied outside an approved DB environment.
- Confirm nullable additions and backfill assumptions.
- Confirm RLS policy coverage for new tenant-scoped or patient-linked fields.

Validation:

- `pnpm db:generate`
- `pnpm typecheck`
- approved DB only: `pnpm db:verify-migration-preconditions`
- approved DB only: migration apply and post-apply verifier

### 5. Env Safety And Structured Logger

Scope:

- `src/instrumentation.ts`
- `src/lib/env/assert-env.ts`
- `src/lib/env/assert-env.test.ts`
- `src/lib/utils/logger.ts`
- `src/lib/utils/logger.test.ts`
- touched server/API callers that moved from raw console logging

Review boundaries:

- Production fail-fast must not trigger in local/test unintentionally.
- Structured logger must avoid PHI fields and raw Error stack/message leakage in safe mode.

Validation:

- `pnpm exec vitest run src/lib/env/assert-env.test.ts src/lib/utils/logger.test.ts --reporter=dot`
- `pnpm typecheck`
- `pnpm lint`

### 6. File Storage And Webhook Security Groundwork

Scope:

- `src/server/services/file-storage.ts`
- `src/server/services/outbound-webhook.ts`
- `tools/scripts/backfill-webhook-registration-secrets.ts` if changed later
- related tests

Review boundaries:

- Ensure legacy Setting fallback remains backward compatible.
- Ensure FileAsset reads/writes do not break pre-migration environments.
- Ensure webhook secret handling does not expose plaintext.

Validation:

- focused service tests
- `pnpm typecheck`
- `pnpm test -- --reporter=dot`

### 7. Dashboard And Patient UI Replacement / Legacy Removal

Scope:

- deleted dashboard legacy components
- deleted `/api/dashboard/home/*` and `/api/dashboard/today`
- dashboard, my-day, patient board, patient process UI changes
- related UI tests and Playwright specs

Review boundaries:

- Verify no live route imports deleted components or deleted APIs.
- Verify dashboard-preview no longer depends on old BFFs.
- Verify patient classic route/test expectations are intentionally replaced.

Validation:

- `rg -n "dashboard/home|dashboard/today|dashboard-content-legacy|patients-classic" src tools`
- targeted dashboard / my-day / patient tests
- browser smoke for dashboard and patient board

### 8. Scheduling, Vehicle, And Visit Route Improvements

Scope:

- schedules UI helpers and tests
- visit route shared types
- visit route engine
- vehicle/resource-aware scheduling changes
- schedule proposal components

Review boundaries:

- Confirm multi-pharmacist and vehicle constraints remain first-class.
- Confirm reorder/date logic has boundary tests.
- Confirm route preview APIs still match UI expectations.

Validation:

- schedule helper tests
- visit route engine tests
- targeted Playwright flow if UI changed

### 9. PH-OS Backend / Infrastructure Tests

Scope:

- `src/phos/backend/lambda-observability-aws-client.test.ts`
- `tools/infra/websocket/lambdas/**`
- PH-OS readiness scripts and infra fixtures

Review boundaries:

- Keep local tests separate from live AWS proof.
- Verify no secret values are persisted.

Validation:

- focused PH-OS/backend tests
- `pnpm phos:backend-live:readiness:report` only with approved live env

### 10. Documentation And Release Evidence

Scope:

- `docs/design-gap-analysis.*`
- `docs/async-fire-and-forget-audit.md`
- `docs/date-boundary-audit.md`
- `docs/env-catalog.md`
- `docs/change-staging-plan.md`
- `.codex/ralph-state.md`

Review boundaries:

- Docs should reflect current implementation, not old proposal state.
- Release notes must call out unapplied DB migration explicitly.

Validation:

- `pnpm format:check`
- spot-check referenced files and commands exist

## Commit Strategy

Recommended checkpoint commits:

1. `chore: pin runtime and document api conventions`
2. `refactor: add explicit auth context and audit helpers`
3. `refactor: migrate api routes to explicit auth context`
4. `feat: add schema groundwork for workflow and drug alert scoping`
5. `chore: add production env and structured logging guardrails`
6. `refactor: harden file storage and webhook persistence`
7. `refactor: replace legacy dashboard and patient surfaces`
8. `feat: harden scheduling and visit route planning`
9. `test: update phos and websocket infrastructure coverage`
10. `docs: record release evidence and remaining db gates`

Each commit should be followed by at least:

- `pnpm format:check`
- targeted tests for the touched scope

After all checkpoint commits:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm test -- --reporter=dot`
- `pnpm build`

## Known External Gates

- DB migration precheck/apply/verify requires an approved DB environment.
- Live AWS / PH-OS readiness proof requires approved live credentials and target environment.
- Browser/a11y smoke requires a running dev server or preview deployment.
