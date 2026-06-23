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

## Ralph-loop

For each iteration:

0. **Drain the agmsg inbox first** (`~/.agents/skills/agmsg/scripts/inbox.sh phos codex`). A busy main loop does not process pushed agmsg events until it reaches a turn boundary, so polling here every iteration is the reliable delivery path — do not rely on push alone. Act on any `PAUSE_REQUEST`/`HANDOFF_REQUEST`/conflicting `LOCK`/`REQUEST CHANGES` before doing anything else.
1. Read repository state and `.codex/ralph-state.md` if present.
2. Choose the highest-value next action.
3. **Before editing, re-drain the inbox and check no peer holds a `LOCK` on the target files.** Declare your own `LOCK` and wait for `ACK`/no-conflict before editing shared/high-risk files.
4. Inspect affected code and impact radius.
5. Make the smallest complete fix.
6. Run available validation.
7. Update `.codex/ralph-state.md`; send an agmsg `FYI:`/`READY_FOR_REVIEW:` at start and finish of each owned group.
8. **Drain the inbox again** before committing (catch a just-arrived `PAUSE_REQUEST`/conflict), then continue.

## Multi-agent coordination (agmsg)

This worktree is shared with a peer Claude Code agent (`claude` in team `phos`). Messaging is best-effort: a pushed event is only processed when the receiver hits a turn boundary, so **never assume a message was received**.

- **Poll, don't trust push.** Drain the inbox at every iteration boundary, before every edit, and before every commit (steps 0/3/8 above). This is the guaranteed delivery channel; the Monitor stream is only a latency optimization.
- **Priority prefixes.** Tag messages so a draining peer can triage fast: `URGENT:` (act before anything else — conflicts, data-loss risk, broken main), `LOCK:`/`PAUSE_REQUEST:`/`HANDOFF_REQUEST:` (coordination), `DELEGATE:`/`REQUEST CHANGES:`/`READY_FOR_REVIEW:`/`FYI:`. Scan for `URGENT:` first on every drain.
- **ACK-gate blocking operations.** `URGENT`, `LOCK`, `DELEGATE`, `PAUSE_REQUEST`, `HANDOFF_REQUEST`, and `REQUEST CHANGES` require an explicit reply (`ACK`/`ACCEPT`/`DECLINE`) before the sender proceeds. If you send one, wait for the ack; if you receive one, ack promptly. No ack within your next 1–2 iterations → re-send.
- **Two live agents only by default.** The active loop is `codex` and `claude`. Do not add a relay/third agent unless the human explicitly re-authorizes it for the current run.
- **Main dispatcher discipline.** Keep the main Codex loop available for inbox drain, ACK/LOCK/review routing, subagent steering, and committing reviewed work. Send a quick ACK/STATUS for inbound `PLAN_REVIEW_REQUEST`, `PATCH_REVIEW_REQUEST`, `VERIFY_REQUEST`, `LOCK_REQUEST`, `HANDOFF`, `PAUSE_REQUEST`, `URGENT`, and `CHANGES_REQUESTED` before starting long review or validation work. Delegate sustained implementation, large review, and verification to subagents or background sessions, then summarize from the main loop.
- **Serialize long Next.js gates.** Do not run `pnpm build` concurrently with `pnpm typecheck` or `pnpm typecheck:no-unused`; `.next/types` can race. Run build/type gates serially and keep the main loop free while they run.
- **File-level locks are mandatory for shared edits.** Announce `LOCK: <paths>` before touching files; respect peer locks; never edit a peer-locked path. Resolve overlaps via `PAUSE_REQUEST`/`HANDOFF_REQUEST`.
- **Own your commits.** Commit your own groups in isolation and announce them; do not mix the peer's in-flight (unlocked) changes into your commits.
- **High-risk areas** (auth, patient/medical data, audit logs, permissions, DB/RLS, offline sync, realtime, billing) require mutual review before landing.

## Agent loop SSOT

The Claude x Codex x agmsg x gbrain operational loop SSOT is `.agent-loop/README.md`. Before editing, LOCK via agmsg; before committing, drain the inbox; stage only owned files; and follow the objective gates in `.agent-loop/GATE_CONFIG.md`.

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
- Before every commit, drain `agmsg` inbox, resolve any `URGENT:` / `LOCK:` / `PAUSE_REQUEST:` / `HANDOFF_REQUEST:` / `REQUEST CHANGES:` message, inspect `git status --short --untracked-files=all`, and stage only explicit owned paths.
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
