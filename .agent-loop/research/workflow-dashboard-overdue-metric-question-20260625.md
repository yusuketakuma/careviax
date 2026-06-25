# LOW-CONFIDENCE metric-semantics question: overdueRequests includes 'expired'/'draft' (2026-06-25, claude scout R3)

Status: **NOT a confirmed bug — ambiguous business-logic / product intent. NOT auto-fixed.** Recorded for product clarification.

## Where

`src/server/services/workflow-dashboard-queries.ts:488-501` — two `communicationRequest.count` metrics:

```ts
// pendingRequests
status: { in: ['sent', 'received', 'in_progress'] },

// overdueRequests
status: { notIn: ['closed', 'cancelled', 'responded'] },
due_date: { lt: new Date() },
```

`RequestStatus` enum (prisma/schema/communication.prisma): draft, sent, received, in_progress, responded, closed, escalated, cancelled, expired (9 values).

So `overdueRequests` counts: draft, sent, received, in_progress, escalated, **expired** (past due_date).

## Why this is NOT being auto-fixed

A scout flagged the two metrics as "inconsistent" because they count different status sets. On inspection this is **by design, not a bug**:
- `pendingRequests` = actively-being-handled requests (sent/received/in_progress), independent of due date.
- `overdueRequests` = still-open requests past their due date (everything except the resolved/terminal closed/cancelled/responded).
These intentionally measure different things; equal sets would be wrong.

The only genuinely debatable point is whether **'expired'** (and arguably **'draft'**) should count as overdue:
- If 'expired' is a TERMINAL state (request window lapsed, no further action), it arguably belongs with closed/cancelled/responded in the `notIn` list, and including it slightly **over-counts** overdue.
- If 'expired' means "passed deadline unresolved", counting it as overdue is intended.
- 'draft' past its due date: missed-send (overdue) vs not-yet-actionable — also intent-dependent.

There is no comment or spec reference at the call site establishing intent, and the difference does not clearly indicate an error. Resolving it requires **product/domain confirmation** of the intended `pending` vs `overdue` definitions. Auto-changing the status set risks a dashboard-semantics regression in the opposite direction.

## Recommended next step (product, low priority)

Confirm the intended definition of `overdueRequests`: should terminal-ish states ('expired', possibly 'draft') be excluded so the count reflects only actionable past-due requests? If yes, add them to the `notIn` list with a test; if no, add a one-line comment documenting that they are intentionally counted. Either way it is a metric-semantics decision, not a mechanical fix.

Not §15 (dashboard count, no billing/算定/auth/security). Not escalated to BLOCKED (not a hard-stop; just needs product input). Evidence: workflow-dashboard-queries.ts:488-501, communication.prisma RequestStatus enum.
