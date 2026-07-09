---
type: PerformanceFinding
title: Query Shape Watchlist Guard
confidence: high
evidence_level: tests-pass
validity_scope: >-
  /Users/yusuke/workspace/careviax critical read paths listed in
  tools/query-shape-watchlist.json as of 2026-07-08
ingested_via: put_page
ingested_at: '2026-07-07T21:57:19.551Z'
source_kind: put_page
tags:
  - careviax
  - db-performance
  - guardrail
  - query-shape
---

CareViaX now has a watchlist-only query-shape guard for critical Prisma read paths.

Evidence:
- package script: pnpm db:query-shape:check
- checker: tools/scripts/check-query-shape.mjs
- watchlist: tools/query-shape-watchlist.json
- allowlist: tools/query-shape-allowlist.json
- tests: tools/scripts/check-query-shape.test.ts

Current guard scope:
- care report list/search
- patient overview base query
- patient detail timeline registry
- medication stock summary
- inbound communication inbox/signals

Current checked rules:
- reject top-level Prisma include on watched read paths
- reject unbounded findMany unless cursor/take or bounded id-in fan-in is present
- reject bounded findMany without a stable orderBy including id tie-breaker
- reject aggregate fan-out through missing where or repeated same-delegate count/groupBy in one watched file

Implementation note:
This is intentionally not a whole-repo Prisma linter. Expand the watchlist gradually after making each path pass with zero allowlist debt. False positives should usually be handled by local query-shape improvement before adding expected-count allowlist debt.

Validation evidence:
- pnpm db:query-shape:check passed with 0 allowlisted violations and 0 new violations
- focused Vitest suite passed after adding fixtures for allowed bounded reads, id-in fan-in, broad include rejection, unbounded findMany rejection, unstable order rejection, aggregate fan-out rejection, and allowlist stale-entry failure

Reusable lesson:
Before adding indexes or UI-heavy BFF reads, first lock the query shape: bounded select, stable order, no broad include, and no repeated list-time aggregates. Add indexes only after SELECT-only EXPLAIN evidence and rollback plan.
