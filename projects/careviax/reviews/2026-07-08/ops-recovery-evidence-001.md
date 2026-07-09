---
type: SecurityFinding
title: Ops Recovery Evidence 001
confidence: high
evidence_level: validated
validity_scope: >-
  OPS-RECOVERY-EVIDENCE-001 recovery evidence append and external readiness
  summaries
ingested_via: put_page
ingested_at: '2026-07-07T23:26:37.249Z'
source_kind: put_page
tags:
  - backup
  - careviax
  - evidence
  - oracle-reviewed
  - phi-safe
  - recovery
---

# OPS-RECOVERY-EVIDENCE-001 structured recovery evidence gate

Decision: backup recovery drill evidence must be structured and fail-closed for live mode. Do not persist operator free text as live evidence.

Implemented pattern:
- `backup:drill:check --append --mode live` requires environment, ticket, approver, started/completed timestamps, RTO/RPO minutes, `health-status=passed`, `redaction-check=passed`, and sample counts before document mutation.
- Evidence values reject structured delimiters and common PHI/secret/AWS raw identifiers before append.
- `external-readiness` only counts complete safe live rows, redacts unsafe row text, checks operator/result/duration/notes together, and does not allow summary delimiter injection to promote tabletop rows.
- Admin pilot launch dossier responses use sensitive no-store headers.

Oracle review: GPT-5.5 Pro browser consult returned No-Go for the pre-final patch; accepted blockers were live fail-closed, delimiter injection defense, row-wide unsafe detection, stricter `health=passed`, expanded identifier patterns, and pilot dossier no-store.

Validation evidence: focused Vitest passed 6 files / 24 tests; scoped ESLint passed; Prettier passed; `pnpm backup:drill:check` passed with local live readiness false due missing env; sparse live append negative smoke failed before mutation as expected; full typecheck passed.

Files: tools/scripts/backup-recovery-check.ts; src/lib/operations/recovery-evidence.ts; src/lib/operations/external-readiness.ts; src/app/api/admin/pilot-launch-dossier/route.ts; docs/compliance/backup-recovery-drill.md.
