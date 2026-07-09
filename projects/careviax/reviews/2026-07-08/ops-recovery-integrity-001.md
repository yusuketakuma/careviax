---
type: SecurityFinding
title: Ops Recovery Integrity 001
confidence: high
evidence_level: tests-and-code
validity_scope: OPS-RECOVERY-INTEGRITY-001
ingested_via: put_page
ingested_at: '2026-07-07T23:52:30.653Z'
source_kind: put_page
tags:
  - backup-recovery
  - careviax
  - db-integrity
  - oracle-reviewed
  - phi-free
---

# OPS-RECOVERY-INTEGRITY-001

Implemented a PHI-free SELECT-only restored DB integrity audit CLI for backup recovery drills.

Evidence:
- Added `backup:drill:integrity` and `tools/scripts/backup-recovery-integrity-audit.ts`.
- CLI uses `default_transaction_read_only=on`, query/statement timeouts, production-like target guard, and PHI-free JSON/Markdown output.
- Oracle/GPT-5.5 Pro review returned No-Go before finalization; accepted blockers: redacted CLI catch-path provider errors, read-only session, stronger production-like URL detection, RPO basis excluding audit logs alone, invalid count fail-closed behavior, cross-link checks, and clarified allow-production semantics.
- Focused Vitest passed 3 files / 16 tests; scoped ESLint, Prettier, full typecheck, backup drill precheck, help smoke, production-like guard smoke, and diff check passed.

Safety notes:
- No live AWS restore call, production DB mutation, migration, secret write, deploy, or destructive operation was performed.
- Actual restored DB run remains a human-gated operation requiring approved credentials and target.
