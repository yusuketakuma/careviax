# Repository Codex Instructions

## PH-OS Required Context

This version of Next.js has breaking changes. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js code, and heed deprecation notices.

For any UI/UX change, read `docs/ui-ux-design-guidelines.md` first and treat it as the PH-OS UI/UX SSOT. Reference that file when proposing, implementing, or reviewing page structure, grouping, borders, spacing, and heading hierarchy.

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
`codex` が計画、実装、検証、台帳更新、必要な scoped commit まで一貫して担当する。
agmsg、codex2/codex3/codex4、Claude、subagent、PATCH_REPORT 待ちは使わない。
ユーザーが明示的に再有効化しない限り、旧 multi-agent/maker-checker 記述は歴史的記録として扱う。

単独運用でも shared worktree 前提は維持する。編集前に `git status --short --untracked-files=all`
と対象 diff を確認し、既存の user/peer dirty 変更を保存する。コミット時は明示した owned path だけを
stage し、`git add -A` は使わない。

## Ralph-loop

For each iteration:

0. Inspect `git status --short --untracked-files=all` first and preserve pre-existing dirty work.
1. Read repository state and `.codex/ralph-state.md` if present.
2. Choose the highest-value next action.
3. Before editing, inspect affected diffs and confirm the target paths are not pre-existing user work unless explicitly included in the current Codex task.
4. Inspect affected code and impact radius.
5. Make the smallest complete fix.
6. Run available validation.
7. Update `.codex/ralph-state.md` / `CODEX_GOAL_PROGRESS.md` when present and relevant.
8. Before any commit, inspect `git status --short --untracked-files=all`, stage only explicit owned paths, and continue. Do not push unless the user explicitly asks.

## Single-agent coordination

The active loop is single Codex execution.

- `codex` owns planning, implementation, verification, ledger updates, and scoped commits.
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

The current operational SSOT is `ops/refactor/STATE.md`, with `.agent-loop/README.md` as the operator guide.
Historical Claude x Codex x agmsg rules remain background only. The active loop is single-Codex execution
plus validation/gbrain. Before editing, inspect the dirty tree; before committing, stage only owned files;
and follow the objective gates in `.agent-loop/GATE_CONFIG.md`.

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
- Mandatory commit trigger points include: finished implementation slice, finished test-only slice, finished validation/CI wiring slice, finished progress-ledger slice, or before switching to a substantially different task area.
- A group is committable only when its affected code paths were inspected, relevant focused validation passed, and `.codex/ralph-state.md` / `CODEX_GOAL_PROGRESS.md` are updated when required.
- Before every commit, inspect `git status --short --untracked-files=all`, preserve unrelated dirty work, and stage only explicit owned paths.
- Never use `git add -A` or broad staging in a shared dirty worktree. Do not include peer-owned files, peer locks, generated artifacts, or unrelated user changes.
- Prefer small commit groups such as implementation, tests, validation/CI wiring, and progress-ledger updates. If one file contains unrelated hunks, split or delay the commit rather than mixing ownership.
- If automatic commit is skipped because validation is failing, the slice is not coherent, files are peer-locked, or unrelated hunks cannot be separated safely, record the skip reason in the progress ledger or user-facing update and continue toward the next safe commit boundary.
- After committing, record the commit hash, scope, validation summary, and remaining work in the progress ledgers.
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
