---
type: PerformanceFinding
title: Payload Budget Matrix Smoke
date: '2026-07-08T00:00:00.000Z'
repo: /Users/yusuke/workspace/careviax
project: careviax
confidence: high
commit_before: d216d7561a870d1b517ac4ffe79e31ec7f63123f
evidence_level: tests_passed
ingested_via: put_page
ingested_at: '2026-07-07T21:44:30.980Z'
source_kind: put_page
tags:
  - careviax
  - payload-budget
  - perf-smoke
  - performance
  - phi-safe-artifacts
---

# Payload budget matrix smoke

## Context

The aggregate `perf-smoke` payload result can hide route-level payload regressions when multiple paths are sampled together. For PHI/medical route families with configured payload budgets, each configured exact GET route needs independent measurement and independent pass/fail output.

## Decision

Add a `--payload-budget-matrix` mode and `perf:smoke:payload-matrix` script. In matrix mode, default paths expand from configured exact GET entries in `CRITICAL_ROUTE_PAYLOAD_BUDGETS`; each route is measured as a separate entry with resolved budget metadata.

## Reusable pattern

- Emit only pathname identity in perf artifacts. Do not echo query strings, search terms, patient ids, hashes, headers, or request bodies.
- Treat configured budget routes without runtime `Content-Length` as `PAYLOAD_UNMEASURED` failures, even if a CLI body fallback can estimate bytes. Runtime route performance instrumentation depends on `Content-Length`.
- Keep body fallback useful for local diagnostics, but do not treat it as sufficient evidence that route-level runtime payload budgets are instrumented.
- Add a coverage guard so every configured exact GET payload budget route appears in default matrix mode.

## Evidence

- `tools/scripts/perf-smoke.ts` implements matrix mode, sanitized output path identity, measurement source counts, and per-route warning codes.
- `tools/scripts/perf-smoke.test.ts` covers default matrix expansion, explicit path override, query/hash redaction, mixed-route over-budget detection, missing `Content-Length` failure, and budget registry coverage.
- Validation passed: focused Vitest suite, scoped ESLint, Prettier check, diff whitespace check, and full typecheck.

## Follow-up

Use the matrix against local/staging/live environments after representative seed data exists. Continue adding exact GET payload budget definitions only when the endpoint response is intentionally bounded and has tests for visibility/hidden counts.
