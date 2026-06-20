---
type: GateResult
title: <task-id> — gate @ <sha>
memory_id: projects/careviax/gates/<task-id>-<sha>
project_id: careviax
task_id: <QL-YYYYMMDD-nnn>
commit_after: <sha>
created_by: <codex-lead | claude-lead>
owner_agent: <codex-lead | claude-lead>
confidence: high
evidence_level: gate_verified
validity_scope: { repo: careviax }
expires_at: null
superseded_by: null
tags: [verification, <flaky-test?>, <agent>]
---

# <task-id> — GateResult

run_context: { os: macOS, node: 24.x, package_manager: pnpm, env: local }

## Commands

- `pnpm lint` → <pass|fail> (<sec>s)
- `pnpm typecheck` → <pass|fail>
- `pnpm typecheck:no-unused` → <pass|fail>
- `pnpm format:check` → <pass|fail>
- `pnpm test` → <pass|fail>
- `pnpm build` → <pass|fail> · failure_class: <none|existing_failure|new_failure> · <summary>
- `pnpm test:e2e` → <skipped> · reason: <local browser env unavailable>

## Security

secret_scan: <pass|skipped> · dependency_audit: <skipped, not configured>

## Overall

result: <pass|partial_pass|fail> · accepted_for_next_step: <true|false> · reason: <...>

## Links

- gated: [[projects/careviax/loop-runs/<YYYY-MM-DD>/<task-id>]]
