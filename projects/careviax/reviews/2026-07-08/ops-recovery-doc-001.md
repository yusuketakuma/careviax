---
type: SecurityFinding
title: Ops Recovery Doc 001
confidence: high
evidence_level: repo-doc-validation
validity_scope: /Users/yusuke/workspace/careviax recovery docs and Plans.md
ingested_via: put_page
ingested_at: '2026-07-08T00:45:42.856Z'
source_kind: put_page
tags:
  - aws
  - careviax
  - phi-safe
  - recovery
  - runbook
---

# OPS-RECOVERY-DOC-001 Recovery runbook cleanup

Decision: keep `docs/compliance/backup-recovery-drill.md` as the current recovery SSOT and treat `docs/backup-recovery-drill.md` as detailed/historical runbook only. Root runbook must be aligned to least-privilege, non-destructive, synthetic-drill-only practice.

Implemented cleanup:
- Removed broad AWS managed policy prerequisites from the standard runbook.
- Avoided live bucket/object identifiers in training examples; compliance env examples use placeholders.
- Changed RDS drill verification from migration apply to SELECT-only `backup:drill:integrity` against a restored/staging DB.
- Kept production connection switching, service restart/redeploy, DB rename, S3 delete marker removal, and S3 version overwrite as real-incident break-glass operations, not normal drills.
- Updated `Plans.md` so `OPS-RECOVERY-DOC-001` is implemented/frozen and residual Recovery/AWS work is `OPS-RECOVERY-LIVE-001` human-gated live evidence.

Validation used:
- unsafe phrase scan over `docs/backup-recovery-drill.md`, `docs/compliance/backup-recovery-drill.md`, and `Plans.md`
- Prettier check
- `pnpm backup:drill:check`
- `pnpm aws:rds-backup:template:validate`
- `git diff --check`

Do not add runtime restore APIs, app-role Secrets Manager write permission, AWS destructive permissions, migration apply, live AWS operations, production data mutation, raw ARN/account id/endpoint/storage key/PHI evidence output, or production S3 object examples to drills without explicit human approval and a separate live incident/runbook gate.
