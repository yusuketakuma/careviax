---
type: GateResult
title: STOCK-001-VISIT-UI gate-off browser/mobile regression
branch: main
source:
  - 'file:tools/tests/ui-route-mocked-smoke.spec.ts'
  - 'commit:5cb43c75433fb168d802a084ee0ebddd82b5e9f4'
  - 'test:targeted Playwright chromium and mobile-chromium'
  - 'test:focused Vitest medication stock gate/page/form/panel/route'
task_id: STOCK-001-VISIT-UI
repo_url: null
memory_id: projects/careviax/gates/2026-07-10/stock-001-visit-ui-gate-off
confidence: high
created_at: '2026-07-10T02:09:16.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-10T02:09:16.000Z'
owner_agent: codex-lead
commit_after: 5cb43c75433fb168d802a084ee0ebddd82b5e9f4
commit_before: 02e669bdc3f436e021bb837040bb0d18aa269053
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - tools/tests/ui-route-mocked-smoke.spec.ts
  tech_stack:
    - Next.js
    - React
    - TypeScript
    - Playwright
    - Vitest
  directories:
    - tools/tests
    - src/app
    - src/components
    - src/lib
ingested_via: put_page
ingested_at: '2026-07-10T02:09:40.567Z'
source_kind: put_page
tags:
  - accepted
  - accessibility
  - api
  - codex
  - medication-stock
  - test
  - ui
  - validation
  - visit
---

# STOCK-001-VISIT-UI gate-off browser/mobile regression

## Commands

- Targeted Playwright Chromium and Pixel 5 projects: pass. The server used the disabled release gate.
- Focused medication-stock gate, page, form, panel, and route Vitest suites: 5 files / 68 tests pass.
- Exact test-file ESLint, Prettier, and diff checks: pass.
- Full typecheck was not rerun for this test-only slice because the shared tree has an unrelated inbound communications type error; no type weakening was made.

## Security

- The real write API probe sends an invalid empty body without an idempotency key. With the gate off it returns 503 no-store before auth-scoped write work; if the gate drifts on it stops at validation before any write.
- Browser request monitoring proves no medication-stock observation POST and ordinary visit payloads omit stock observation fields.
- Fixtures use synthetic IDs and non-patient medication labels only.

## Overall

result: partial_pass
accepted_for_next_step: true
reason: Gate-off UI/API alignment and mobile browser evidence are verified. The parent task remains Partial because explicit prior/current/delta display and human-gated real DB integration plus environment activation remain open.
