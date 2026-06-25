# §15 authz gap: PATCH /api/dispense-results/[id] missing canDispense gate (2026-06-25, claude scout R4)

Status: **CONFIRMED authorization asymmetry (§15 auth). Escalated to BLOCKED.md. NOT auto-fixed.** Plus triage of 4 other round-4 security-scout findings (1 false positive, 1 cosmetic non-bug, 1 read likely-intentional, 1 policy question).

## Confirmed finding — escalated

`src/app/api/dispense-results/[id]/route.ts`:
- **GET (line 63-64)** and **PATCH (line 90-91)** both gate only on `requireAuthContext(req)` with NO `permission` option.
- The sibling **create route POST `/api/dispense-results` gates on `permission: 'canDispense'`** (`src/app/api/dispense-results/route.ts:851`). The audit route gates on `canAuditDispense` (`dispense-audits/route.ts:169,933`).

Access on `[id]` is otherwise controlled by `buildMedicationCycleAssignmentWhere(ctx)` (→ `buildCareCaseAssignmentWhere` → `src/lib/auth/visit-schedule-access.ts`). That helper returns:
- `null` (NO restriction, full org access) for `ORG_WIDE_ACCESS_ROLES = { owner, admin, pharmacist, pharmacist_trainee, clerk }`.
- a personal-assignment filter (`primary_pharmacist_id`/`backup_pharmacist_id`/assigned visit) for all other roles.

Permission matrix: **`clerk.canDispense = false`** (clerk is 事務/clerk — read + 連携 only; explicitly cannot dispense).

### The gap
`clerk` is in `ORG_WIDE_ACCESS_ROLES`, so the assignment filter is `null` (no restriction), and the PATCH has no `canDispense` gate. Therefore **a clerk can PATCH-edit a dispense result** — `actual_quantity`, `actual_drug_name`, `actual_drug_code`, `discrepancy_reason`, `carry_type`, `special_notes` (算定 + clinical safety fields) — **even though clerk cannot CREATE one** (POST is `canDispense`-gated) **and `clerk.canDispense = false`**. The only guards on the PATCH are the org/assignment scope (which clerk bypasses) and the precondition that the task's latest audit is `rejected`. pharmacist_trainee also bypasses but has `canDispense = true`, so that role is intended.

This is a create-vs-edit authorization asymmetry on a 算定/clinical record. It is an **auth gap = §15 hard-stop**.

### Correct fix (for human approval — do NOT auto-land)
Add `permission: 'canDispense'` to the PATCH handler (and decide whether GET should require it too — see below), mirroring the gated POST. Because this changes authorization behavior (and could newly 403 a role that today succeeds), it requires human approval + permission tests proving clerk (and any non-canDispense role) is rejected while pharmacist/owner/admin still succeed.

### GET (read) — likely intentional, lower concern
clerk has documented org-wide **read-all** access (project memory `careviax-access-model-orgwide`: 事務read-all は意図的仕様). So clerk *reading* a dispense result via GET is probably intended and should be confirmed, not assumed a bug. The write (PATCH) is the real gap.

## Other round-4 scout findings — triaged, NOT escalated

- **handoff-board read PATCH "unsafe raw SQL" — FALSE POSITIVE.** The code uses `tx.$executeRaw\`... ${ctx.userId} ... ${id} ...\`` — Prisma's TAGGED-template `$executeRaw`, which is parameterized (placeholders, not string concatenation). That is the safe pattern, not injection. (`$executeRawUnsafe` with string concatenation would be the bug; this is not that.)
- **handoff-board item org_id "post-fetch vs WHERE" — cosmetic non-bug.** The route DOES check `item.board.org_id !== ctx.orgId` and returns notFound for cross-org. Moving the predicate into the WHERE clause is a minor defense-in-depth tidy, not a vulnerability.
- **pharmacist_trainee `canAuthorReport: true` / `canManageBilling: true` — policy question, possibly intentional.** This is an RBAC/compliance-policy decision (least-privilege vs business need), not a code defect. Flag for human/compliance review; do NOT change the matrix without approval (§15 auth/policy).

## Why escalated, not fixed
Changing an authorization gate (or the permission matrix) directly affects who can write 算定/clinical records → §15 hard-stop. Recorded in `.agent-loop/BLOCKED.md`. Evidence: dispense-results/[id]/route.ts:63-91; dispense-results/route.ts:851; dispense-audits/route.ts:169; permission-matrix.ts clerk; visit-schedule-access.ts ORG_WIDE_ACCESS_ROLES + buildCareCaseAssignmentWhere.
