# Agent Loop Control Plane

**Status:** MVP docs/config implementation for the CareViaX Claude x Codex loop.
This is not a daemon or automatic merge service. The control plane is the thin
governance layer that tells the two supervisors what may run, when to stop, what must be
reviewed, and where audit evidence is recorded.

## 1. Scope

This file implements the AI coding-loop control-plane specification v0.1 for the existing
`.agent-loop` file plane.

- **Coding Loop:** product code, tests, and product documentation changes.
- **Loop Improvement Loop:** prompt, routing, gbrain, eval, playbook, and loop-method
  improvements.
- **Control Plane:** task intake, routing, policy, eval gates, approval gates, ledgers,
  promotion/rollback rules, incidents, and budget/iteration/runtime stop conditions.

Runtime enforcement is deferred. Until a runtime controller exists, the supervisors apply
`CONTROL_PLANE_CONFIG.yml` manually through agmsg locks, peer review, objective gates, and
explicit path staging.

## 2. Artifact Mapping

| Spec area                  | Implemented here                                                             | Status       |
| -------------------------- | ---------------------------------------------------------------------------- | ------------ |
| Task API / manifest        | `FEATURE_QUEUE.md` task blocks plus optional control-plane fields            | MVP          |
| Scheduler / router         | owner/reviewer fields, lane rules, agmsg `HANDOFF`                           | MVP          |
| Policy engine              | `LOOP_POLICY.md`, `LOCKS.md`, `CONTROL_PLANE_CONFIG.yml`                     | advisory MVP |
| State store / ledgers      | `STATE.md`, `REVIEW_LOG.md`, `VERIFY_LOG.md`, `PATCH_INBOX.md`, `BLOCKED.md` | MVP          |
| Eval gate                  | `GATE_CONFIG.md`, `VERIFY_LOG.md`, product/loop eval separation in config    | MVP          |
| Approval gate              | `BLOCKED.md`, high-risk approval rules in config                             | MVP          |
| Promotion / rollback       | `PROMOTION_QUEUE.md`, agent-version policy in config                         | MVP, manual  |
| Incident controller        | `BLOCKED.md` and stop-condition records                                      | MVP, manual  |
| Notification adapter       | agmsg only                                                                   | MVP          |
| Secret/redaction service   | policy only; no automated scanner yet                                        | deferred     |
| Runtime enforcement daemon | none                                                                         | deferred     |
| Golden eval management     | read-only policy only                                                        | deferred     |
| Auto-merge                 | explicitly disabled                                                          | deferred     |

## 3. Spec Section Coverage

| Spec section                    | Implementation in this MVP                                                                                                     | Status                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| §1 Purpose                      | `CONTROL_PLANE.md` scope and loop boundaries                                                                                   | implemented                   |
| §2 Review gaps                  | locks, approval, eval pollution, rollback, incident, retention, dependency, migration, observability are represented in config | implemented as policy         |
| §3 Terms                        | mapped to `.agent-loop` artifacts and config names                                                                             | implemented                   |
| §4 Scope                        | docs/config-only scope; runtime service out of scope                                                                           | implemented/deferred          |
| §5 Principles                   | deny-by-default, no self-escalation, trace-first, promotion evidence, rollback, human approval                                 | implemented as policy         |
| §6 Architecture                 | file-plane Control Plane over existing Claude/Codex/gbrain loop                                                                | implemented as docs/config    |
| §7 Components                   | CP-01..CP-10 mapped to existing ledgers/config; runtime controller deferred                                                    | partially implemented         |
| §8 Loop responsibilities        | Coding vs Improvement loop allowed/denied paths in config                                                                      | implemented as policy         |
| §9 Task Manifest                | `FEATURE_QUEUE.md` optional fields + config defaults                                                                           | implemented                   |
| §10 State transition            | existing queue status glossary + promotion states in config                                                                    | implemented as policy         |
| §11 Policy Engine               | stop conditions and approval rules in config; enforcement manual                                                               | advisory only                 |
| §12 Eval Gate                   | product eval vs loop eval in config; golden eval read-only policy                                                              | implemented as policy         |
| §13 Trace / Ledger              | existing ledgers mapped in config; raw trace retention automation deferred                                                     | partially implemented         |
| §14 Failure Classification      | represented through `PATCH_INBOX.md`, `BLOCKED.md`, gbrain FailurePattern/ReviewFinding                                        | partially implemented         |
| §15 Promotion / Rollback        | `PROMOTION_QUEUE.md` + config states/requirements                                                                              | implemented as manual process |
| §16 Parallel / conflict control | `LOCKS.md`, agmsg idempotency, config concurrency key                                                                          | implemented                   |
| §17 Security                    | prohibitions in `LOOP_POLICY.md`/`BLOCKED.md`; scanner automation deferred                                                     | partially implemented         |
| §18 Incident handling           | incident triggers in config and `BLOCKED.md`; immutable incident store deferred                                                | partially implemented         |
| §19 Directory structure         | collapsed into existing `.agent-loop` file plane rather than new `/control-plane` runtime tree                                 | adapted                       |
| §20 Initial settings            | `CONTROL_PLANE_CONFIG.yml`                                                                                                     | implemented                   |
| §21 Phases                      | README phase table + config status                                                                                             | implemented                   |
| §22 Acceptance criteria         | manifest, loop separation, ledgers, eval separation, proposal-only improvement, golden read-only, high-risk block              | MVP implemented manually      |
| §23 Test plan                   | mapped to future runtime validator tasks; not executable in this docs/config slice                                             | deferred                      |
| §24 Operations report           | `METRICS.md` remains reporting SSOT                                                                                            | implemented                   |
| §25 Open questions              | remain repo policy inputs for future tasks                                                                                     | deferred                      |
| §26 Conclusion                  | MVP artifacts: manifest, ledgers, promotion policy; improvement loop proposal-only                                             | implemented                   |

## 4. Loop Boundaries

### Coding Loop

Allowed when a task manifest grants scope:

- `src/**`, `tests/**`, `docs/**`, `.agent-loop/**` as task-appropriate.
- `migrations/**` only with high-risk/human approval.

Never automatic:

- auth, billing/payments, security policy, destructive migrations, production deploys,
  dependency/workflow changes, eval threshold changes, and golden eval changes.

### Loop Improvement Loop

Allowed scope is proposal-oriented and bounded:

- `.agent-loop/**`
- `docs/agent-playbooks/**`
- `evals/candidates/**`
- gbrain writeback metadata and templates

Denied without human approval:

- golden evals, policy threshold weakening, permission escalation, secrets, production
  automation, auto-merge rules, and control-plane runtime enforcement.

## 5. Manifest Contract

Every new task should be represented in `FEATURE_QUEUE.md`. Existing older tasks are valid
legacy manifests; missing control-plane fields inherit defaults from `CONTROL_PLANE_CONFIG.yml`.

Recommended fields:

```yaml
task_id: F-YYYYMMDD-NNN
type: feature | bugfix | refactor | test | docs | loop_improvement
risk_level: low | medium | high | critical
owner: claude-lead | codex-lead
reviewer: claude-lead | codex-lead
scope:
  allowed_paths: ['.agent-loop/**']
  denied_paths: ['src/**', 'prisma/**']
  max_diff_lines: 800
loop_policy:
  primary_loop: coding | improvement
  max_iterations: 4
  max_runtime_minutes: 90
  require_plan_before_edit: true
  concurrency_key: 'feature-or-area'
success_gates:
  required: [format_check, diff_check, peer_review]
approval:
  human_required_if: [touches_auth, adds_dependency, modifies_workflow]
```

## 6. Stop And Approval Rules

The supervisors must stop or escalate when:

- iteration, runtime, cost, or diff-size limits are exceeded;
- a denied path would be edited;
- the same gate fails 3 times;
- secrets or PHI appear in a trace, diff, log, gbrain writeback, or agmsg;
- auth, billing/payments, security, destructive migration, dependency, workflow, eval
  threshold, golden eval, permission escalation, auto-merge, or production deploy work is needed.

High-risk tasks go to `BLOCKED.md` until human approval is explicit and current.

## 7. Eval Separation

**Product evals** judge the product output:

- lint, format, typecheck, no-unused typecheck, targeted tests, full tests, build, e2e,
  audit e2e, dependency audit where relevant.

**Loop evals** judge the agent loop:

- task success rate, iterations to green, rework after approval, review gate misses,
  repeated failure rate, intervention rate, rollback rate, scope violation count, cost.

Loop Improvement work may propose candidate evals, but must not edit golden evals or lower
thresholds without human approval and a decision-ledger entry.

## 8. Promotion And Rollback

Candidate loop changes move through:

```text
candidate -> shadow -> canary -> default -> locked
                |         |          |
                v         v          v
              rejected  rejected   rolled_back
```

Promotion requires evidence in `METRICS.md`, a non-degraded product gate, no worse scope
violation rate, no hidden failures, a locked rollback target, both-supervisor agreement, and
human approval for any permission or policy expansion.

## 9. Incident Handling

Incident triggers:

- scope violation;
- budget or runtime runaway;
- repeated failure loop;
- prompt injection suspicion;
- secret or PHI exposure suspicion;
- dangerous diff;
- unauthorized permission request;
- promotion/canary quality degradation.

Record incidents in `BLOCKED.md` or the configured incident ledger. Critical incidents stop
related loops, require human review, and may require rollback.

## 10. Deferred Items

The following are intentionally not implemented in this docs/config MVP:

- automatic policy enforcement daemon;
- automatic branch/PR/merge creation;
- golden eval mutation or promotion automation;
- secret scan/SAST wiring;
- dependency/workflow approval automation;
- runtime cost accounting;
- shadow/canary executor;
- immutable audit storage.

These are future phases and must not be claimed as enforced until implemented and verified.
