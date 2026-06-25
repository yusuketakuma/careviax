# OPEN VERIFICATION: daily cleanup jobs vs FORCE RLS (2026-06-25, claude scout)

Status: **OPEN QUESTION — NOT a confirmed bug, NOT auto-fixable from code.** Needs infra/prod DB role verification before any action.

## What was scanned

`src/server/jobs/daily/cleanup.ts` — `cleanupAbandonedQrDrafts()` and `cleanupTerminalQrDraftPayloads()`.

These run via `runJob(...)` using the **global `prisma` client directly** (no `withOrgContext`, no RLS context set). They are intentionally **cross-org system jobs** (scrub abandoned/terminal QR scan drafts across all tenants):

- `prisma.qrScanDraft.findMany({ where: { status:'pending', created_at:{lt:cutoff} } })` → ids
- `prisma.qrScanDraft.updateMany({ where: { id: { in: ids } }, data: {...scrub...} })`
- `prisma.jahisSupplementalRecord.deleteMany({ where: { qr_draft_id: { in: ids }, prescription_intake_id: null } })`
- `cleanupTerminalQrDraftPayloads`: `updateMany({ where: { status: { in: ['confirmed','discarded'] } }, data:{...scrub...} })`

## False positive (rejected)

An automated scout flagged "missing `org_id` on the updateMany/deleteMany (defense-in-depth)". **Rejected as a fix:**
- These are cross-org system jobs; there is no single current org to scope to.
- The writes target **exact PKs** already fetched by a trusted `findMany`, so `org_id` would not change which rows are affected nor add real safety.
- Adding `org_id` would require enumerating all org_ids and is semantically wrong for a global cleanup.

## The real (open) question — infra-dependent, cannot confirm from code

`QrScanDraft` and `JahisSupplementalRecord` are under **FORCE ROW LEVEL SECURITY**
(`prisma/migrations/20260608150000_force_remaining_org_rls_tables/migration.sql:17`,
policy `tenant_isolation USING (org_id = current_setting('app.current_org_id', true))`).
FORCE RLS applies the policy even to the table owner. There is **no system/bypass RLS-context helper** in `src/lib/db/rls.ts` (only `withOrgContext` / `createScopedTxRunner`, both org-scoped).

Therefore the behavior of these jobs depends entirely on the **production `DATABASE_URL` role's `BYPASSRLS` attribute**:

- **If the app role has BYPASSRLS (or is superuser):** jobs work cross-org as intended. No issue. (Local/E2E uses `ph_os` superuser per project memory `careviax-e2e-local-db`, which bypasses FORCE RLS — so tests pass regardless.)
- **If the app role does NOT bypass:** with no `app.current_org_id` set, the policy evaluates `org_id = NULL` (always false) → the **`findMany` returns 0 rows** → `abandonedDraftIds` empty → the whole job is a **silent no-op**. Consequence: abandoned QR drafts' `raw_qr_texts` / `qr_payload_hash` (QR payloads = PHI) are **never scrubbed**, a 3省2ガイドライン retention concern. This would be a latent compliance bug, not just defense-in-depth.

## Why this is NOT escalated to BLOCKED yet

- It is **unconfirmed**: depends on a prod role attribute not visible in the repo. Escalating an unproven bug would violate evidence-over-assumptions.
- Changing the jobs' RLS posture (e.g. adding a system-context/bypass seam) is **RLS/security-adjacent (§15-adjacent)** and must not be auto-implemented.

## Required next step (human/infra)

1. Confirm the **production** `DATABASE_URL` connection role and whether it has `BYPASSRLS` (or is the table owner exempt — note: FORCE RLS removes owner exemption, so only `BYPASSRLS`/superuser bypasses).
2. If non-bypass: design a **explicit system-job RLS posture** (a documented bypass/system-context seam in `src/lib/db/rls.ts`, or run cleanup under a dedicated maintenance role), with a test proving cleanup actually mutates rows under the production-equivalent role. Treat as a §15-adjacent change (human approval).
3. If bypass: add a one-line comment in `cleanup.ts` documenting that these are intentional cross-org system jobs relying on the BYPASSRLS role, so a future reader does not "fix" the missing org_id. (Safe, doc-only.)

Evidence: cleanup.ts (global prisma, no context); rls.ts (no system-context helper); migration 20260608150000 (FORCE RLS + tenant_isolation policy on QrScanDraft); project memory careviax-e2e-local-db (local superuser bypass).
