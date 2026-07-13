---
type: ImplementationDecision
title: Make best-effort PHI read audit loss alertable without leaking identifiers
branch: agent/continuous-improvement-20260712
source:
  - 'file:src/lib/audit/phi-read-audit.ts'
  - 'file:src/lib/audit/phi-read-audit.test.ts'
  - 'file:tools/infra/cloudwatch-alarms.json'
  - 'commit:11ef2f40f'
  - >-
    test:pnpm exec vitest run src/lib/audit/phi-read-audit.test.ts
    src/phos/infra/pr15-final-no-go-gate.test.ts
task_id: PHI-READ-AUDIT-BESTEFFORT-DROP-001
repo_url: 'https://github.com/yusuketakuma/careviax'
memory_id: projects/careviax/decisions/2026-07-13/alert-on-phi-read-audit-failure
confidence: high
created_at: '2026-07-13T11:19:30.000Z'
created_by: codex-lead
expires_at: null
feature_id: null
project_id: careviax
updated_at: '2026-07-13T11:19:30.000Z'
captured_at: '2026-07-13T11:20:04.809Z'
owner_agent: codex-lead
captured_via: capture-cli
commit_after: 11ef2f40f
commit_before: 2ba5a012c
superseded_by: null
evidence_level: gate_verified
reviewer_agent: codex-lead
validity_scope:
  repo: careviax
  files:
    - src/lib/audit/phi-read-audit.ts
    - src/lib/audit/phi-read-audit.test.ts
    - tools/infra/cloudwatch-alarms.json
  tech_stack:
    - Next.js
    - TypeScript
    - AWS CloudWatch Logs
  directories:
    - src/lib/audit
    - tools/infra
ingested_via: put_page
ingested_at: '2026-07-13T11:20:05.229Z'
source_kind: put_page
tags:
  - accepted
  - audit
  - cloudwatch
  - codex
  - observability
  - phi
  - security
---

# Make best-effort PHI read audit loss alertable without leaking identifiers

## Problem

- summary: Best-effort PHI read audit write and org-context failures returned the PHI response but produced no dedicated metric or alarm.
- evidence: `src/lib/audit/phi-read-audit.ts`, `tools/infra/cloudwatch-alarms.json`.

## Decision

- adopted: Keep the response non-blocking, emit one of two fixed structured error events containing only event, operation, phase, and a normalized error name, and aggregate both through one dimensionless CloudWatch Logs metric filter and alarm declaration.
- reason: Audit loss becomes operationally visible without exposing organization, actor, patient, target, view, purpose, metadata, raw error messages, or stack traces and without adding retry or migration behavior.

## Alternatives rejected

- Fail the PHI read response when the best-effort audit write fails - changes the established availability contract and was outside this bounded slice.
- Add a durable outbox immediately - requires schema, retry, and reconciliation design beyond the migration-free alertability objective.
- Add identifiers as metric dimensions - creates privacy and high-cardinality risk.

## Migration

- from: warning-only best-effort failure path with no dedicated metric.
- to: PHI-safe structured error events plus a single no-dimension failure counter and alarm declaration.

## Verification

- `pnpm exec vitest run src/lib/audit/phi-read-audit.test.ts src/phos/infra/pr15-final-no-go-gate.test.ts` -> 48 tests passed.
- Scoped ESLint, Prettier, JSON parse, Plans check, and diff check passed.
- AWS CloudWatch Logs JSON string wildcard and metric filter syntax were confirmed in official documentation on 2026-07-13.

## Review

- reviewer: codex-lead - result: approved after independent logger redaction and AWS filter syntax review.

## Future rule candidate

- Best-effort security or audit writes must expose a fixed PHI-safe low-cardinality failure signal while preserving the explicitly chosen response contract.

## Links

- canonical: [[file:src/lib/audit/phi-read-audit.ts]]
