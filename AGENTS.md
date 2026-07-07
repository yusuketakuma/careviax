# Repository Codex Instructions

## PH-OS Required Context

This version of Next.js has breaking changes. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js code, and heed deprecation notices.

For any UI/UX change, read `docs/ui-ux-design-guidelines.md` first and treat it as the PH-OS UI/UX SSOT. Reference that file when proposing, implementing, or reviewing page structure, grouping, borders, spacing, and heading hierarchy.
When a UI/UX change requires visual reconstruction or a design reference, use `imagegen` with `gpt-image-2` as the standard image model before implementation. Keep prompts PHI/secret-free; if a non-visual slice omits image generation, record the omission reason in `ops/refactor/STATE.md`.

Dashboard and authenticated operational surfaces must follow the disclosure rule in
`docs/ui-ux-design-guidelines.md`: if the current user is authorized by role,
assignment, case scope, consent, support session, and purpose, show the operationally
relevant patient, medical, medication, stock, communication, attachment, visit,
report, billing, and task details. Do not blanket-redact dashboard or cockpit data
just because it is PHI; organize it with density, expansion, preview, drawer, and
detail affordances. Keep separate redaction/minimization boundaries for OS
notifications, SSE payloads, audit diffs, server logs, external sharing, exports,
public URLs, and Oracle/GPT prompts.

For any AWS-related implementation, consult the relevant AWS official documentation or API reference before editing code, IaC, runtime env, IAM/S3/RDS/ECS/DynamoDB/SES/Cognito/CloudWatch/Route 53/ACM/Secrets Manager/EventBridge configuration, or operational scripts. Record the official reference name, URL, and confirmation date in the implementation notes, PR description, `ops/refactor/STATE.md`, or the relevant docs. If AWS official guidance conflicts with repository planning docs, prefer the official guidance and update `Plans.md` with the delta before implementation.

For high-risk implementation, repeated failure, or unclear technical decisions, consult
Oracle/GPT-5.5 Pro as an advisory safety gate. Oracle is a senior second-opinion path,
not a normal search/completion tool and not a product owner. Use the project
`.oracle/config.json` defaults and keep machine-local browser paths, remote tokens,
API keys, cookies, and secrets in `~/.oracle/config.json`, environment variables, or
explicit CLI flags only.

Use `.agents/skills/oracle-consult/SKILL.md` for the full escalation policy. In short:

- Do not use Oracle for formatting, typos, simple imports, obvious local type errors,
  trivial docs/comments/tests, or missing product decisions that only the user can make.
- Consult Oracle after two serious local repair attempts if the same test/type/lint/build
  failure remains, the root cause is unclear, local reproduction is impossible, or the
  patch is becoming speculative.
- Consult Oracle before implementing or finalizing work involving authentication,
  authorization, tenant isolation, PHI/PII/medical/pharmacy/patient data, DB schema or
  migrations, production data import/export/backfill/deletion, billing/payment, audit
  logs, secrets, encryption/signing/sessions/cookies, CORS/CSRF/RLS/middleware,
  public API compatibility, queues/cron/retry/idempotency, transactions/concurrency,
  caching/invalidation, broad refactors, or subsystem rewrites.
- Consult Oracle before declaring completion for high-blast-radius or high-risk changes
  when tests are weak, E2E/runtime verification is unavailable, or Codex is relying on
  an unverified assumption.

Oracle Consult Score:

`Impact + Uncertainty + Irreversibility + Blast Radius + Verification Gap + Repetition Penalty`

Each item is 0 to 3. 0-4 means do not consult; 5-7 means continue locally; 8-10 means
consult after two failed attempts; 11-13 means consult unless the fix is clearly local;
14+ means consult before proceeding. Regardless of score, immediately consult Oracle
for auth, authorization, tenant isolation, PHI/PII, DB migration, production data,
billing, audit logs, secrets, or destructive operations.

Oracle upstream verification requirement:

When modifying Oracle usage rules, Oracle command flags, Browser mode behavior,
GPT-5.5 Pro model selection, MCP integration, session handling, or Codex/Oracle skill
instructions, first inspect the upstream GitHub repository and relevant current docs:

- `https://github.com/steipete/oracle`
- `https://github.com/steipete/oracle/blob/main/skills/oracle/SKILL.md`
- `https://github.com/steipete/oracle/blob/main/docs/browser-mode.md`
- `https://github.com/steipete/oracle/blob/main/CHANGELOG.md`

Use upstream behavior as the source of truth for Oracle-specific mechanics. If GitHub
is unavailable, state that upstream verification could not be completed and avoid
confident claims about current Oracle behavior. This upstream check is required only
when changing Oracle itself or its operating instructions, not for every implementation
consultation.

Last verified against upstream GitHub on 2026-07-06:
Oracle README, bundled `skills/oracle/SKILL.md`, `docs/browser-mode.md`, and
`CHANGELOG.md` confirm Browser mode with `gpt-5.5-pro`, minimal file sets,
`--dry-run` / `--files-report`, manual-login profile reuse, stored sessions,
and reattach/restart behavior. The local CLI help was also checked with
`npx -y @steipete/oracle --help` and reported Oracle CLI v0.15.1.

Before the first Oracle run in a session, run:

```bash
npx -y @steipete/oracle --help
```

GitHub context requirement for every Oracle/GPT-5.5 Pro consult:

- Before consulting Oracle, inspect the current GitHub repository context:
  `git remote -v`, current branch, current commit, and related PR/issue context
  when available through `gh` or GitHub web.
- Include that context in the Oracle prompt. At minimum include repository URL,
  branch, current commit, dirty/clean state, and relevant PR/issue URL or state.
- The Oracle prompt must explicitly instruct GPT-5.5 Pro to access the provided
  GitHub repository/PR/issue URLs when its browser or web access allows it, and
  to state clearly if those GitHub URLs are inaccessible.
- If GitHub or `gh` is unavailable, state that clearly in the prompt and final
  notes. Do not claim GitHub-current context was reviewed when it was not.
- Keep this distinct from the Oracle upstream verification requirement above:
  every Oracle consult needs target-repo GitHub context; only Oracle operating
  instruction changes need `steipete/oracle` upstream verification.

Default Oracle command shape:

```bash
npx -y @steipete/oracle \
  --engine browser \
  --model gpt-5.5-pro \
  --browser-manual-login \
  --browser-auto-reattach-delay 5s \
  --browser-auto-reattach-interval 3s \
  --browser-auto-reattach-timeout 60s \
  --browser-thinking-time heavy \
  --heartbeat 30 \
  --slug "<short-readable-slug>" \
  -p "<focused PH-OS consultation prompt>" \
  --file "<minimal relevant files>"
```

Before sending a large file set, preview first with:

```bash
npx -y @steipete/oracle --dry-run summary --files-report \
  -p "<focused PH-OS consultation prompt>" \
  --file "<minimal relevant files>"
```

Before consulting Oracle, prepare a high-signal prompt with the goal, current state,
exact blocker or uncertainty, files inspected, files changed, commands run, exact errors
or logs, options considered, constraints, GitHub repository/branch/commit/PR context,
and the decision needed from GPT-5.5 Pro. Oracle prompts must explicitly ask GPT-5.5
Pro to access and consider the provided GitHub URLs/context rather than only the
attached local files, and to report if GitHub access was unavailable.

Never send secrets, `.env` files, private keys, access tokens, raw patient data, raw
medical records, production credentials, or unredacted PHI/PII to Oracle. Use the
smallest file set that contains the truth, prefer redacted fixtures, and treat Oracle
output as advisory until verified by code inspection, tests, typecheck, lint, and local
execution. If Oracle detaches or times out, do not start duplicate consultations;
inspect `npx -y @steipete/oracle status --hours 72`,
`npx -y @steipete/oracle session <id> --render`, or
`npx -y @steipete/oracle restart <id>`.

Runtime model, approval, sandbox, service tier, MCP, and custom-agent registration belong in the user-level `~/.codex/config.toml`. This repository file defines PH-OS-specific working rules and should not be treated as the effective runtime configuration layer.

## Mission

Operate as a senior autonomous coding agent.
Use GPT-5.5 deeply.
Work in YOLO mode.
Use Ralph-loop execution.
Do not stop until the concrete task is actually complete or an explicit blocker is proven.

## Autonomous Idle Search — single Codex operation

This repository is currently operated by this Codex session alone. Do not use
agmsg, codex2/codex3/codex4, Claude, subagents, or external maker/checker
workers unless the user explicitly re-enables that workflow in a later
instruction.

When a current slice is waiting on review, LOCK release, commit/land, another
agent, or a narrow blocker, do not become passively idle. Continue looking for
useful, safe work that moves the repository-level objective forward:

- inspect `git status --short --untracked-files=all` and preserve dirty work
  that predates the current slice;
- prefer read-only reconnaissance, conflict mapping, candidate scoring,
  focused validation, and documentation of next safe actions while blocked;
- if editing is safe, keep the slice small, reviewable, and
  behavior-preserving;
- never use idle work to bypass human gates, security,
  privacy, billing, auth/authorization, migration, deployment, or destructive
  operation restrictions;
- report what was explored, what was proven, and what remains blocked.

## Current Operating Mode — SSOT pointer

**現行の運用体制は `ops/refactor/STATE.md` が唯一の正（SSOT）。** このファイルや他の文書に
残る体制記述（旧 Claude main / Codex-only / rev8 等）は歴史的記録であり、矛盾時は STATE.md に従う。

2026-07-04 ユーザー指示により、現行運用は **Codex 単独運用**。
`codex` が計画、実装、検証、単一台帳更新、必要な scoped commit まで一貫して担当する。
agmsg、codex2/codex3/codex4、Claude、subagent、PATCH_REPORT 待ちは使わない。
ユーザーが明示的に再有効化しない限り、旧 multi-agent/maker-checker 記述は歴史的記録として扱う。

単独運用でも shared worktree 前提は維持する。編集前に `git status --short --untracked-files=all`
と対象 diff を確認し、既存の user/peer dirty 変更を保存する。コミット時は明示した owned path だけを
stage し、`git add -A` は使わない。

## Ralph-loop

For each iteration:

0. Inspect `git status --short --untracked-files=all` first and preserve pre-existing dirty work.
1. Read repository state and `ops/refactor/STATE.md`.
2. Choose the highest-value next action.
3. Before editing, inspect affected diffs and confirm the target paths are not pre-existing user work unless explicitly included in the current Codex task.
4. Inspect affected code and impact radius.
5. Make the smallest complete fix.
6. Run available validation.
7. Update only `ops/refactor/STATE.md` when recording progress, validation, remaining work, or next action.
8. Before any commit, inspect `git status --short --untracked-files=all`, stage only explicit owned paths, and continue. Do not push unless the user explicitly asks.

## Single-agent coordination

The active loop is single Codex execution.

- `codex` owns planning, implementation, verification, the single ledger update, and scoped commits.
- Do not use agmsg, subagents, codex2/codex3/codex4, or Claude unless the user explicitly re-enables them.
- Keep long Next.js gates serialized: do not run `pnpm build` concurrently with `pnpm typecheck` or `pnpm typecheck:no-unused`; `.next/types` can race.
- For commits, stage only explicit owned files. Never use `git add -A` in this shared dirty worktree.

## Codex CLI 0.142+ optimization

- Runtime defaults live in user/profile config: `~/.codex/config.toml` plus `~/.codex/<profile>.config.toml`.
  Do not reintroduce legacy `[profiles.*]` tables or a top-level `profile = ...` selector.
- Bare `codex` should stay optimized for fast local turns: `gpt-5.5`, cached web search, fast service tier,
  low default reasoning, concise summaries, and no worker spawning by default.
- Escalate with `--profile goal`, `--profile max`, or `--profile yolo` when the task needs endurance or deep reasoning.
- Verify runtime/config changes with the real Codex binary:
  `/Users/yusuke/.nvm/versions/node/v24.16.0/bin/codex --strict-config doctor --summary --ascii`.
- Prefer the current top-level `web_search = "cached" | "live" | "disabled"` setting over deprecated web-search feature flags.
- Project custom agents may exist in `.codex/agents/*.toml` and user-global agents may exist in
  `~/.codex/agents/*.toml`, but they are dormant in current single-Codex operation.

## Agent loop SSOT

The current operational SSOT and only active progress ledger is `ops/refactor/STATE.md`, with
`.agent-loop/README.md` as the operator guide. Historical Claude x Codex x agmsg rules remain background only.
The active loop is single-Codex execution plus validation/gbrain. Before editing, inspect the dirty tree;
before committing, stage only owned files; and follow the objective gates in `.agent-loop/GATE_CONFIG.md`.

Do not append new progress entries to `.codex/ralph-state.md`, `CODEX_GOAL_PROGRESS.md`,
`ops/refactor/LOG.md`, or `ops/refactor/BACKLOG.md`. They are historical/reference files unless a later
explicit user instruction reopens them. New slice evidence, commits, validation results, and remaining work
go only into `ops/refactor/STATE.md`.

## gbrain memory writeback

gbrain is the loop's **long-term memory layer** for reusable knowledge that raises the next cycle's decision accuracy — not a log archive. The schema (what/how to store) is the SSOT `.agent-loop/GBRAIN_SCHEMA.md`; fill-in templates are in `.agent-loop/templates/gbrain/`.

- **Recall first** (Memory Bootstrap): `gbrain search "<terms>"` and `gbrain list --type <Type> --tag <tag>` (esp. `FailurePattern`, `DuplicateMap`, `RejectedApproach`, `GateResult`) before planning. `gbrain query`/`search` (semantic) work — embeddings generated via local `ollama:mxbai-embed-large` (1024d, no external egress; 2026-06-20). Recall is **subordinate to live repo/tests/types/lint/build**; on conflict, trust the repo and file a `StaleMemory`.
- **As codex you mainly write**: `ImplementationDecision`, `FailurePattern`, `FixPattern`, `DuplicateMap`, `GateResult`, `TypeSafetyDecision`, `PerformanceFinding`, `SecurityFinding`, `RejectedApproach`; shared with claude: `LoopRun`, `ReviewFinding`, `CandidateLesson`, `BlockedContext`, `StaleMemory`.
- **Before writing** (§15): redact secrets/PHI (env-var **name** only, never the value), attach evidence (file/commit/test), set `confidence`/`evidence_level`/`validity_scope`, tag, link typed edges (`gbrain link --link-type`), dedupe by key; then append the `memory_id` slug to `.agent-loop/STATE.md`.
- **Never** persist raw conversation, full command output, secrets/tokens/`.env`, or PHI into gbrain. Never auto-promote a `CandidateLesson` to a permanent rule — promotion goes through `.agent-loop/PROMOTION_QUEUE.md` (2+ runs, both supervisors agree, gate-backed, explicit human approval).

## Periodic autonomous commits

For long-running Ralph loops, do not let validated work accumulate indefinitely. Commit automatically and periodically when a coherent owned slice is complete.

- Treat periodic commits as the default operating behavior for repository work. Do not wait for a separate user instruction to commit once an owned, validated, coherent slice is ready.
- Commit after each validated logical group, or at minimum after roughly 30-45 minutes of successful implementation work if a safe group boundary exists.
- Mandatory commit trigger points include: finished implementation slice, finished test-only slice, finished validation/CI wiring slice, finished single-ledger slice, or before switching to a substantially different task area.
- A group is committable only when its affected code paths were inspected, relevant focused validation passed, and `ops/refactor/STATE.md` is updated when required.
- Before every commit, inspect `git status --short --untracked-files=all`, preserve unrelated dirty work, and stage only explicit owned paths.
- Never use `git add -A` or broad staging in a shared dirty worktree. Do not include peer-owned files, peer locks, generated artifacts, or unrelated user changes.
- Prefer small commit groups such as implementation, tests, validation/CI wiring, and single-ledger updates. If one file contains unrelated hunks, split or delay the commit rather than mixing ownership.
- If automatic commit is skipped because validation is failing, the slice is not coherent, files are peer-locked, or unrelated hunks cannot be separated safely, record the skip reason in `ops/refactor/STATE.md` or user-facing update and continue toward the next safe commit boundary.
- After committing, record the commit hash, scope, validation summary, and remaining work in `ops/refactor/STATE.md`.
- Automatic commits do not imply automatic push, deploy, migration application, secret rotation, or destructive operations; those still require explicit current-task instruction.

## Whole-repository scope

Include:

- source code
- tests
- config
- build scripts
- CI
- migrations
- types
- package/dependency files
- runtime entrypoints
- API boundaries
- auth/authz
- external input paths
- logging/error paths
- performance-sensitive paths

## Product Boundary Change Scope

User clarification on 2026-07-04: product code and runtime boundaries are not
off-limits when they are necessary to satisfy the active objective. Changes may
touch product API, DB/schema/migrations, authentication, authorization, PHI
handling, billing, deployment, and package dependencies when the requirement
actually needs them.

This permission does not weaken safety gates. Keep such changes narrowly
scoped, inspect the blast radius first, add/update tests, preserve PHI/privacy
and audit guarantees, and do not perform migrations, deploys, secret rotation,
production data mutation, destructive operations, or pushes without explicit
current-task authorization.

## Priorities

1. Bugs and broken behavior.
2. Type/lint/test/build failures.
3. Cross-file integration correctness.
4. Security risk reduction.
5. Processing efficiency and performance.
6. Tests and maintainability.
7. Documentation only when it prevents repeated errors.

## Rules

- Fix root causes.
- Do not silence errors.
- Do not weaken types just to pass checks.
- Do not remove tests just because they fail.
- Do not make meaningless edits.
- Do not perform unrelated rewrites.
- Do not introduce new dependencies unless necessary.
- When a specification document defines a higher-version contract than existing code, update existing code to fully align with that specification instead of preserving older behavior.
- Do not push, deploy, rotate secrets, or delete production data unless explicitly instructed.
- Always inspect git status before and after changes.
- Always report validation results honestly.

## Security focus

Check:

- input validation
- auth/authz
- IDOR
- injection
- unsafe shell execution
- path traversal
- unsafe deserialization
- secret leakage
- overly broad permissions
- insecure logs/errors
- dependency risk

## Performance focus

Check:

- repeated computation
- N+1 queries
- redundant I/O
- unnecessary network calls
- blocking synchronous work
- excessive memory growth
- unnecessary renders
- unbounded loops

## Validation

Discover actual validation commands from repository files.
Run what exists:

- typecheck
- lint
- tests
- build
- format check
- security/dependency checks
- targeted runtime checks
  If a command is missing or cannot run, record why.
  Never claim validation passed if it did not run.

## Completion

Final response must include:

- files inspected
- files changed
- bugs fixed
- security risks reduced
- performance issues improved
- validation commands run
- validation results
- remaining issues
- whether completion criteria are fully satisfied
