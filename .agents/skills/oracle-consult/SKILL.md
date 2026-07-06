---
name: oracle-consult
description: Use Oracle GPT-5.5 Pro as a senior second-opinion review path when Codex is blocked after repeated serious attempts, making high-risk technical implementation decisions, touching authentication, authorization, tenant isolation, PHI/PII, medical/pharmacy/patient data, DB schema or migrations, production data, billing, audit logs, secrets, security boundaries, public API contracts, queues/retries/idempotency/concurrency, broad refactors, or needing final review for a high-blast-radius change. Do not use for trivial formatting, typos, imports, obvious local type errors, or product decisions only the user can make.
---

# Oracle Consult

Use Oracle as an advisory senior engineering review path. Do not use it as a
normal search engine, autocomplete tool, or product owner. Treat the result as
advice; verify it with code inspection, tests, typecheck, lint, and local
execution before applying or reporting completion.

## Escalation Rules

Do not consult Oracle for formatting, typos, simple imports, obvious local type
errors, trivial docs/comments/tests, or missing product requirements that only
the user can decide.

Consult Oracle after two serious local repair attempts if the same
test/type/lint/build failure remains, the root cause is unclear, local
reproduction is impossible, the patch scope keeps expanding, or edits are
becoming speculative.

Consult Oracle before implementing or finalizing work involving:

- authentication or authorization
- tenant isolation, RLS, middleware, request context, platform/support mode, or cross-tenant grants
- PHI, PII, medical, pharmacy, patient, prescription, file, attachment, export, import, SSE, Web Push, or Webhook payload boundaries
- database schema, generated SQL, Prisma migrations, rollback, backfill, retention, archive, or legal hold
- production data deletion, rename, merge, import, export, or destructive workflows
- billing, payments, claims, audit logs, secrets, credentials, encryption, signing, sessions, cookies, CORS, or CSRF
- public API compatibility, queues, cron, retries, idempotency, transactions, locking, concurrency, caching, or invalidation
- broad refactors, subsystem rewrites, or changes spanning many modules

Consult Oracle before declaring completion when the blast radius is broad, data
integrity or tenant/permission boundaries changed, tests cannot cover the main
risk, E2E/runtime verification is unavailable, or Codex is relying on an
unverified assumption.

## Score

Compute:

```text
Oracle Consult Score =
Impact + Uncertainty + Irreversibility + Blast Radius + Verification Gap + Repetition Penalty
```

Each item is 0 to 3.

- 0-4: do not consult
- 5-7: continue locally
- 8-10: consult after two failed attempts
- 11-13: consult unless the fix is clearly local
- 14+: consult before proceeding

Always consult regardless of score for auth, authorization, tenant isolation,
PHI/PII, DB migration, production data, billing, audit logs, secrets, or
destructive operations.

## Upstream Verification

When modifying Oracle usage rules, Oracle flags, Browser mode behavior,
GPT-5.5 Pro model selection, MCP integration, session handling, or Codex/Oracle
skill instructions, first inspect the current upstream GitHub repository:

- `https://github.com/steipete/oracle`
- `https://github.com/steipete/oracle/blob/main/skills/oracle/SKILL.md`
- `https://github.com/steipete/oracle/blob/main/docs/browser-mode.md`
- `https://github.com/steipete/oracle/blob/main/CHANGELOG.md`

If GitHub is unavailable, state that upstream verification could not be
completed and avoid confident claims about current Oracle behavior. This rule is
only for Oracle operating instructions, not every implementation consult.

## Data Minimization

Never attach `.env`, `.env.*`, API keys, private keys, credentials, tokens,
production dumps, raw patient data, raw customer data, raw medical records, or
unnecessary private logs. Attach only the smallest file set that contains the
truth.

If more than a few files may be sent, preview first:

```bash
oracle --dry-run summary --files-report \
  -p "<consultation prompt>" \
  --file "<minimal relevant files>"
```

## Standard Command

```bash
oracle \
  --engine browser \
  --browser-manual-login \
  --browser-auto-reattach-delay 5s \
  --browser-auto-reattach-interval 3s \
  --browser-auto-reattach-timeout 60s \
  --model gpt-5.5-pro \
  --browser-thinking-time heavy \
  --slug "<short-readable-slug>" \
  -p "<consultation prompt>" \
  --file "<minimal relevant files>"
```

## Prompt Template

Use a focused prompt:

```text
You are GPT-5.5 Pro acting as a strict senior engineering reviewer.

Project:
<stack, repo conventions, build/test commands, important directories>

Goal:
<current implementation goal>

Current state:
<what Codex has implemented or inspected>

Blocker / uncertainty:
<exact issue>

Evidence:
<exact test output, type error, stack trace, runtime behavior, or CI log>

Files inspected:
<list>

Files changed:
<list>

Files attached:
<list>

Options considered:
A. <option>
B. <option>
C. <option>

Constraints:
<security, compatibility, data, performance, migration, user-facing constraints>

Please return:
1. Go / no-go judgment
2. Most likely root cause or best design choice
3. Risks in the current approach
4. Minimal safe next step
5. Tests or verification commands to run
6. Assumptions that must be checked before proceeding
```

## After Oracle Responds

Summarize the advice, decide whether to accept, partially accept, or reject it,
explain why, implement the minimal safe next step, and verify locally. If the
run detaches or times out, reattach to the existing session instead of starting a
duplicate run:

```bash
oracle status --hours 72
oracle session <id> --render
oracle restart <id>
```
