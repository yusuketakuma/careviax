# Unbounded GET list-bounding triage (2026-06-25, claude + codex)

Records the end-state of the list-bounding sweep so nothing is silently skipped (no-silent-caps rule). codex machine-extracted ~63 route files with `findMany` GETs lacking `take`. Classification below; only **A** is safe to bound with a naive `take`.

## Already landed (curated safe bounded-list sweep, 7)
templates `ef1fb166`, document-delivery-rules `781dd11c`, visit-vehicle-resources `32e9bf5f`, service-areas `1aeeb994`, pharmacist-shift-templates `73e07b88`, notification-rules `35ca6f16`, saved-views `ae3916d2`. Plus business-holidays (query validation + bound, in-flight/landed this round).

## A — SAFE to bound (plain resource/config lists; take is a protection cap above realistic counts). Verified take=0.
Handed to codex to harden (standard pattern, generous default):
1. admin/escalation-rules — config list
2. admin/facility-standards — config list
3. admin/pharmacist-credentials — resource list
4. admin/webhooks — config list
5. drug-alert-rules — config/master list
6. packaging-methods — small master list
7. pharmacy-sites — static master list per org (generous)
8. me/sites — user's accessible sites (<10)
9. pharmacists — staff roster + a SEPARATE visitSchedule.groupBy keyed by pharmacistIds (bounding the membership list is fine; groupBy stays correct per returned pharmacist); use a GENEROUS default (200/max 500) so no org drops staff
10. pharmacist-shifts — date-range scoped (generous)
11. pharmacist-shifts/available — date scoped (generous)
12. handoff-board — single-day scoped (generous)

### A#5 drug-alert-rules — verification (2026-06-25, claude): SAFE, un-deferred
A#5 was provisionally deferred pending a drug-safety completeness check. Verified: the CDS alert
engine `src/server/cds/checker.ts` queries `prisma.drugAlertRule.findMany` DIRECTLY and independently
(lines 340 configuredRules / 785 allergyRules / 954 highRiskRules / 1205 pimRules, each `rule_type`-filtered)
— it does NOT call GET `/api/drug-alert-rules`. The GET route (`route.ts:45`) is the admin alert-rules
tuning LIST UI only. Bounding the GET with a GENEROUS default (200 / max 500) drops no safety check.
**HARD CONSTRAINT:** do NOT add `take` to checker.ts's findMany calls — the engine must read every rule
for completeness; only the admin GET route is bounded.

### Post-implementation re-triage (2026-06-25, claude checker): A#10 + A#12 DEFERRED to B
After landing A#1-A#9 + A#11 (generous bound + take=limit+1 + additive `meta.has_more`), the last two
were re-examined and found NOT safe for a naive backend-only cap under the frontend freeze (frozen
consumers cannot paginate on `has_more`):
- **A#10 pharmacist-shifts → DEFER (B-completeness).** GET is date-RANGE scoped (`month` or
  `date_from..date_to`); with NO date params it has NO date filter = ALL org shifts ever. A monthly
  calendar consumer on a large org (e.g. 100 pharmacists × 30 days ≈ 3000 rows) would exceed a 500 cap,
  silently dropping shifts. Needs cursor/per-day design, not a cap.
- **A#12 handoff-board → DEFER (B-aggregate-adjacent).** The boundable list is the nested `board.items`
  (`handoffBoardInclude`), but those items feed client-side aggregates `outgoingCount`/`incomingCount`
  (route.ts); a `take` on the include would corrupt those counts. Single-day so small in practice, but
  not a clean naive bound. The monthly `handoffItem.count` is already a count (not a take target).
- **A#7 pharmacy-sites → DEFER (B-completeness, corrected).** NOT landed (an earlier draft of this
  doc wrongly said "landed" — it was never implemented). pharmacy-sites is a small org master (<50/org)
  but it feeds a site selector + resource_map summary that need the full set (same class as the
  prescriber-institutions PCA Select). Because the table is tiny a bound gives ~zero perf benefit while
  adding a silent-cap completeness risk under the frontend freeze (frozen selectors cannot paginate on
  `has_more`). Deferred. If ever bounded, use the prescriber-institutions conditional pattern (bound only
  a q-search path; keep the unfiltered selector load fully unbounded).

New item discovered during the sweep: **prescriber-institutions** (q-search list) — boundable with
take=limit+1 + has_more ONLY IF `q` is a DB-level `where` filter (else a cap drops search matches; same
caveat that downgraded admin/external-professionals). Verify q is DB-level before landing.

### Excluded from A
- **Already bounded (SKIP, no churn):** comments (`COMMENT_THREAD_LIMIT=100`), conference-notes (cursor via `parsePaginationParams`).
- **Downgraded A→DEFER:** admin/external-professionals — has a `q` search (`contains`); a naive `take` could drop search matches (same completeness risk as care-reports). Needs cursor or generous-with-note; do not naive-bound.

## B — UNSAFE to naively bound (27). A silent `take` = wrong numbers / data loss / dropped records. Defer; need cursor pagination or a different safeguard, not a cap.
- **B-aggregate (take computes WRONG numbers):** admin/capacity, admin/inventory-forecast, admin/master-hub, admin/metrics, admin/operations-insights, admin/reject-reason-stats, admin/staff-metrics, billing-evidence/analytics, billing-evidence/check, billing-evidence/stats, dashboard/cockpit, dashboard/dispensing-stats, dashboard/monthly-stats, pharmacy-drug-stocks/impact, pharmacy-drug-stocks/usage-mismatch
- **B-export (truncation loses data):** pharmacy-drug-stocks/export
- **B-completeness (consumer needs the full set; take drops records):** billing-candidates (workbench review), care-reports (keyword search), care-reports/today-workspace (worklist), cases (worklist), dashboard/overdue (worklist), drug-masters (reference/stock matching), inquiry-records, management-plans, medication-sets/workspace, patient-self-reports, prescription-intakes/triage (duplicate-detection logic)

## C — §15 sensitive (5). Human review required regardless of bound-feasibility.
- audit-logs — C-audit (compliance record; needs cursor pagination design, not a silent take)
- billing-candidates/export — C-billing (+ export completeness)
- communication-requests/export — C-communication (PHI export)
- external-access — C-auth (+ B-completeness; consent/sharing surface)
- visit-billing-candidates/summary — C-billing (aggregation)

## Counts
A=12 actionable (+2 already-bounded skipped, 1 downgraded) / B=27 deferred / C=5 escalate-or-defer. The B/C routes are intentionally NOT bounded in this sweep; bounding them needs cursor pagination or aggregation-aware design (separate, larger work — flag if prioritized). The §15-relevant billing/audit/auth dashboards already appear in the broader BLOCKED triage where applicable.
