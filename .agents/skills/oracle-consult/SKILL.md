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

Do not treat "ask Oracle when stuck" as the rule. The rule is narrower:
use Oracle only when a wrong technical decision is costly, uncertainty remains
after serious local work, the same failure repeats, a design branch has high
downstream cost, or normal tests cannot prove the main risk. Consult Oracle
before asking the user when the question is technical and fits these triggers;
ask the user directly when the missing answer is a product, workflow, priority,
or business decision.

## Decision Levels

### Level 0: Do not consult

Proceed locally without Oracle for:

- formatting, typos, import order, or mechanical lint fixes
- obvious TypeScript errors scoped to one or two files
- trivial comments, test names, or README edits
- straightforward CRUD that follows an existing local pattern
- failures where the log already identifies the root cause
- missing product requirements that only the user can decide

### Level 1: Consult after two serious attempts

Stop patching blindly and consult Oracle after two serious local repair
attempts when:

- the same test/type/lint/build failure remains
- the root cause is still unclear after reading the stack trace and relevant code
- multiple implementation paths remain plausible and the choice has material cost
- CI/runtime fails but local reproduction is not possible
- state-management, cache, build, dependency, or integration behavior keeps expanding
- Codex is making speculative edits instead of proving the root cause

### Level 2: Consult before implementation or finalization

Consult Oracle before implementing or finalizing high-risk work involving:

- authentication or authorization
- tenant isolation, RLS, middleware, request context, platform/support mode, or cross-tenant grants
- PHI, PII, medical, pharmacy, patient, prescription, file, attachment, export, import, SSE, Web Push, or Webhook payload boundaries
- database schema, generated SQL, Prisma migrations, rollback, backfill, retention, archive, or legal hold
- production data deletion, rename, merge, import, export, or destructive workflows
- billing, payments, claims, audit logs, secrets, credentials, encryption, signing, sessions, cookies, CORS, or CSRF
- public API compatibility, queues, cron, retries, idempotency, transactions, locking, concurrency, caching, or invalidation
- broad refactors, subsystem rewrites, or changes spanning many modules

### Level 3: Consult before declaring completion

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

Last verified against upstream GitHub on 2026-07-06:

- Oracle README
- bundled `skills/oracle/SKILL.md`
- `docs/browser-mode.md`
- `CHANGELOG.md`

The verified upstream behavior confirms Browser mode with `gpt-5.5-pro`, minimal
file sets, `--dry-run` / `--files-report`, manual-login profile reuse, stored
sessions, and reattach/restart behavior. The local CLI help was also checked
with `npx -y @steipete/oracle --help` and reported Oracle CLI v0.15.1.

## GitHub Context Requirement

Every Oracle/GPT-5.5 Pro consult must include current target-repository GitHub
context.

Before consulting Oracle:

1. Inspect `git remote -v`.
2. Inspect the current branch and current commit.
3. Inspect dirty/clean state.
4. Inspect related PR/issue context when available through `gh` or GitHub web.

Include repository URL, branch, current commit, dirty/clean state, and relevant
PR/issue URL or state in the prompt. If GitHub or `gh` is unavailable, say so in
the prompt and final notes. Do not claim GitHub-current context was reviewed
when it was not.

The prompt must tell GPT-5.5 Pro to access the provided GitHub
repository/PR/issue URLs when its browser or web access allows it, then consider
that GitHub context alongside the attached local files. If GPT-5.5 Pro cannot
access the provided GitHub URLs, the prompt must ask it to say so explicitly.
GitHub access is mandatory for Oracle/GPT-5.5 Pro consults as repository
context, but never use it to send secrets, raw PHI, private logs, or production
data.

This is separate from upstream verification: every consult needs target-repo
GitHub context, but only Oracle operating-instruction changes require
`steipete/oracle` upstream verification.

## Data Minimization

Never attach `.env`, `.env.*`, API keys, private keys, credentials, tokens,
production dumps, raw patient data, raw customer data, raw medical records, or
unnecessary private logs. Attach only the smallest file set that contains the
truth.

If more than a few files may be sent, preview first:

```bash
npx -y @steipete/oracle --dry-run summary --files-report \
  -p "<consultation prompt>" \
  --file "<minimal relevant files>"
```

Before the first Oracle run in a session, run:

```bash
npx -y @steipete/oracle --help
```

## Before Consulting Oracle

Prepare a high-signal prompt. Do not ask vague questions. Include:

1. Goal
2. Current implementation state
3. Exact blocker or uncertainty
4. Files inspected
5. Files changed
6. Commands run
7. Exact errors, logs, or runtime behavior
8. Options considered
9. Constraints and non-goals
10. GitHub context: repository URL, branch, commit, dirty/clean state, PR/issue state if relevant
11. The decision needed from GPT-5.5 Pro

Explicitly ask GPT-5.5 Pro to access the provided GitHub URLs when possible and
to report whether GitHub access succeeded.

## Standard Command

```bash
npx -y @steipete/oracle \
  --engine browser \
  --browser-manual-login \
  --browser-auto-reattach-delay 5s \
  --browser-auto-reattach-interval 3s \
  --browser-auto-reattach-timeout 60s \
  --model gpt-5.5-pro \
  --browser-thinking-time heavy \
  --heartbeat 30 \
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

GitHub context:
<repository URL, branch, current commit, dirty/clean state, PR/issue URL or state if relevant, and any upstream/current GitHub context GPT-5.5 Pro must access and consider>

GitHub access instruction:
Please access the provided GitHub repository/PR/issue URLs when your browser or web access allows it. If you cannot access GitHub, state that explicitly before giving the recommendation.

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
npx -y @steipete/oracle status --hours 72
npx -y @steipete/oracle session <id> --render
npx -y @steipete/oracle restart <id>
```
