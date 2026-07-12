# Change Log

## API-CONTRACT-001FZBUSINESSHOLIDAYSTRICT

- Commit Group: `API-CONTRACT-001FZBUSINESSHOLIDAYSTRICT`
- Commit: `c4d0b015e`
- Push Status: PUSHED
- Branch: `agent/continuous-improvement-20260712`
- Scope: business-holidays list response schema and its business-holidays / shifts consumers.
- Implementation: validate organization, date window, optional site filter, ordering, duplicate IDs, site relation, and bounded-list completeness before query state; preserve only consumed fields; use the inclusive last day of the displayed month.
- FE/BE impact: provider route unchanged; both frontend readers now reject malformed success payloads before calendar or shift state changes.
- DB/auth/tenant/audit impact: no DB or provider change; client-side org scope is checked fail-closed in addition to backend authorization.
- UI impact: date-window correctness only; no visual redesign.
- Verification: focused 2 files / 39 tests, static contract gates, typecheck, no-unused typecheck, lint, diff-check, and Next build passed.
- Rollback: revert the response schema, two reader adapters, regressions, allowlist removal, and ledger entries.
- Remote: `origin/agent/continuous-improvement-20260712`
- Push evidence: `0abd8a23a..c4d0b015e` fast-forward push succeeded.
