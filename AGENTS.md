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

## Current Operating Mode - Codex-only (2026-06-26 JST)

The user has switched this worktree to **Codex-only operation**.

- Do not route new work to Claude, spawn Claude, require Claude ACK/review, or wait on Claude gates.
- Treat the older Claude/Codex agmsg protocol below as historical unless the user explicitly re-enables multi-agent operation.
- Use agmsg only for one-time pause/handoff notices to any already-running Claude session; agmsg is no longer a completion gate.
- Preserve all pre-existing dirty/user/Claude changes. Before claiming a file, inspect `git status --short --untracked-files=all` and the file diff.
- For high-risk medical, patient, audit, auth, RLS, DB, or permission changes, use Codex subagents/independent review plus real validation instead of Claude mutual review.

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

## Multi-agent coordination (suspended)

Claude/Codex agmsg coordination is suspended while Codex-only operation is active.

- Do not create new Claude tasks, review requests, lock requests, or long-gate negotiations.
- If an already-running Claude session sends messages, treat them as legacy handoff context only. Preserve its dirty files, but do not wait for Claude before continuing with non-overlapping Codex-owned work.
- Keep long Next.js gates serialized locally: do not run `pnpm build` concurrently with `pnpm typecheck` or `pnpm typecheck:no-unused`; `.next/types` can race.
- For commits, stage only explicit Codex-owned files. Never use `git add -A` in this shared dirty worktree.

## Agent loop SSOT

The current operational SSOT is `.agent-loop/README.md` plus this Codex-only override. Historical Claude x Codex x agmsg rules remain useful background, but the active loop is single-supervisor Codex plus validation/gbrain. Before editing, inspect the dirty tree; before committing, stage only owned files; and follow the objective gates in `.agent-loop/GATE_CONFIG.md`.

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
