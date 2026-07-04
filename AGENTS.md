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

## Autonomous Idle Search — all agents

This rule applies to every agent in this repository: Claude, Codex, codex2,
codex3, codex4, opus, sonnet, haiku, and future workers.

When a current slice is waiting on review, LOCK release, commit/land, another
agent, or a narrow blocker, do not become passively idle. Continue looking for
useful, safe work that moves the repository-level objective forward:

- drain agmsg and respect active LOCKs, dirty peer work, and ownership notes;
- prefer read-only reconnaissance, conflict mapping, candidate scoring,
  focused validation, and documentation of next safe actions while blocked;
- if editing is safe, claim exact paths before editing and keep the slice
  small, reviewable, and behavior-preserving;
- never use idle work to bypass maker/checker review, human gates, security,
  privacy, billing, auth/authorization, migration, deployment, or destructive
  operation restrictions;
- report what was explored, what was proven, and what remains blocked.

## Current Operating Mode — SSOT pointer

**現行の運用体制は `ops/refactor/STATE.md` が唯一の正（SSOT）。** このファイルや他の文書に
残る体制記述（旧 Claude main / Codex-only / rev8 等）は歴史的記録であり、矛盾時は STATE.md に従う。

2026-07-04 確定の骨子（詳細・更新は STATE.md）: `codex` が全体統括 coordinator /
checker / central-gate / committer / task-router。実行役は `codex2`（frontend/UI lane）、
`codex3`（cleanup/DataTable/API-helper lane）、`codex4`（backend/business-domain recon/implementation
lane）。Claude は停止済みの歴史的 handoff 元であり、ユーザーが明示的に再有効化しない限り新規
作業・review・gate は送らない。

全 agent は agmsg team `phos` で連絡を取り合う。作業開始前・PATCH_REPORT 前・land/hold 後に inbox
を drain し、exact-path LOCK/assignment、PATCH_REPORT、coordinator review、scoped commit の順序を守る。
Makers must not self-commit. Preserve all pre-existing dirty/user/peer changes: before claiming a file,
inspect `git status --short --untracked-files=all` and the file diff.

## Ralph-loop

For each iteration:

0. Inspect `git status --short --untracked-files=all` first and preserve pre-existing dirty work. If a legacy peer session may still be active, do a one-time agmsg drain/notification, but do not wait on peer review in Codex-only mode.
1. Read repository state and `.codex/ralph-state.md` if present.
2. Choose the highest-value next action.
3. Before editing, inspect affected diffs and confirm the target paths are not pre-existing user/Claude work unless explicitly claimed for the current Codex task.
4. Inspect affected code and impact radius.
5. Make the smallest complete fix.
6. Run available validation.
7. Update `.codex/ralph-state.md` / `CODEX_GOAL_PROGRESS.md` when present and relevant.
8. Before any commit, inspect `git status --short --untracked-files=all`, stage only explicit owned paths, and continue. Do not push unless the user explicitly asks.

## Multi-agent coordination

The active loop is Codex-coordinated multi-agent execution.

- `codex` assigns work, reviews reports, declares BUILD-LOCK, runs central folds, and makes scoped commits.
- `codex2` / `codex3` / `codex4` implement only exact assigned paths and report validation; they do not self-commit.
- Claude messages are legacy handoff context only unless the user explicitly re-enables Claude.
- Keep long Next.js gates serialized: do not run `pnpm build` concurrently with `pnpm typecheck` or `pnpm typecheck:no-unused`; `.next/types` can race. Workers must not run those long gates while a BUILD-LOCK is active.
- For commits, stage only explicit owned files. Never use `git add -A` in this shared dirty worktree.

## Agent loop SSOT

The current operational SSOT is `ops/refactor/STATE.md`, with `.agent-loop/README.md` as the operator guide.
Historical Claude x Codex x agmsg rules remain useful background, but the active loop is codex-led coordination
with three execution agents plus validation/gbrain. Before editing, inspect the dirty tree; before committing,
stage only owned files; and follow the objective gates in `.agent-loop/GATE_CONFIG.md`.

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
- After committing, send an `agmsg` `FYI:` with the commit hash, scope, validation summary, and any remaining locks or review needs.
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
