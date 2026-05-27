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
1. Read repository state and `.codex/ralph-state.md` if present.
2. Choose the highest-value next action.
3. Inspect affected code and impact radius.
4. Make the smallest complete fix.
5. Run available validation.
6. Update `.codex/ralph-state.md`.
7. Continue.
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
