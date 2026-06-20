# GBRAIN_SCHEMA.md — gbrain Memory Schema (SSOT)

**Purpose.** This is the **single source of truth** for _what_ the careviax agent loop writes into
gbrain and _how_. gbrain is the loop's **long-term memory layer** — not a log archive. We store
**reusable knowledge that raises the decision accuracy of the next Claude Code / Codex cycle**, not
raw transcripts.

The other `.agent-loop/` files already reference this spec by section number
(`PROMOTION_QUEUE.md` → "spec §13"; `MEMORY_REVIEW.md` buckets ← §14; the prompts' §15 writeback).
This document is that spec, reconciled with the **real gbrain CLI** (`gbrain put/get/list/search/
query/link/tag`) and the existing scaffold naming.

> **Non-negotiable.** gbrain recall is **subordinate to the live repository, tests, typecheck, lint,
> and build.** When gbrain and the repo disagree, the **repo + objective gate win**, and the gbrain
> entry is recorded as a `StaleMemory` (§4.14). gbrain is the durable memory; `.agent-loop/STATE.md`
> is the current state; `LOOP_POLICY.md` is the per-run policy; `AGENTS.md` / `CLAUDE.md` are the
> promoted permanent rules. Do not collapse these layers.

---

## 1. What to store / what not to store

Store exactly these five things, abstracted for reuse:

```
1. What was done            4. How it was verified
2. Why it was done          5. What to do next time
3. What failed
```

Never store:

```
1. Full conversation transcripts        4. Unverified speculation
2. Raw, long logs / full command output 5. One-off coincidences
3. secret / token / .env / cookie       6. Lessons premised on repo structure that no longer exists
```

---

## 2. Memory hierarchy

```
ProjectMemory → LoopRun → Task/Feature → Decision → Patch/Review/Gate
            → FailurePattern/FixPattern → CandidateLesson → VerifiedLesson → StableRuleCandidate
```

This lets a cycle start by asking gbrain: _What failed here before? How was this component built?
May I add another API client? Is this test flaky or real? Is there an existing unified UI pattern?
Has this lesson already been promoted to AGENTS.md?_

---

## 3. Common metadata (every memory carries it)

Every page's YAML frontmatter MUST carry the fields below. Without `confidence`, `evidence_level`,
`validity_scope`, `superseded_by`, and `expires_at`, stale memory gets applied forever.

```yaml
type: LoopRun | FeatureIntake | ImplementationDecision | RejectedApproach | FailurePattern
  | FixPattern | ReviewFinding | GateResult | DuplicateMap | RiskArea | BlockedContext
  | SecurityFinding | CandidateLesson | VerifiedLesson | StableRuleCandidate | StaleMemory
  | MemoryConflict | UIUXDecision | TypeSafetyDecision
  # specialized finding/decision types (§4.16) — claude/codex lane-specific:
  | FormUXPattern | StateDisplayPattern | AccessibilityFinding | ResponsiveFinding
  | ProductDecision | UserFlowDecision | PerformanceFinding
title: <human-readable title — REQUIRED; gbrain derives from slug if omitted>
memory_id: <deterministic — equals the slug, e.g. projects/careviax/decisions/api-client-consolidation>
project_id: careviax
repo_url: <github url or null>
branch: <branch>
commit_before: <sha | null>
commit_after: <sha | null>
task_id: <e.g. QL-20260620-001 | null>
feature_id: <F-... | null>
created_at: <ISO8601>
updated_at: <ISO8601>
created_by: claude-lead | codex-lead | human
owner_agent: claude-lead | codex-lead
reviewer_agent: claude-lead | codex-lead | null
source: # provenance — paths/commits/tests/messages, NOT raw content
  - file:<path>
  - commit:<sha>
  - test:<command>
  - agmsg:<message_id>
  - pr:<url>
confidence: low | medium | high
evidence_level: none | observed | tested | peer_reviewed | gate_verified | production_verified
validity_scope:
  repo: careviax
  directories: [src/...]
  files: [src/...]
  tech_stack: [Next.js, React, TypeScript, Prisma]
expires_at: null # ISO date when this memory should be re-evaluated
superseded_by: null # slug of the memory that replaces this one
tags: [<see §8>]
```

---

## 4. Memory types

Condensed field guides. The canonical, fill-in templates live in
`.agent-loop/templates/gbrain/` — copy one, fill it, `gbrain put` it (§ CLI).

### 4.1 LoopRun — one autonomous cycle

Records what the cycle read, changed, and verified. Key blocks: `inputs` (feature_queue_items,
loop_policy_sources), `actions`, `changed_files`, `verification` (lint/format_check/typecheck/
unit_test/integration_test/build/e2e/secret_scan), `peer_review` (reviewer, result, comments),
`outcome` (status, regressions_found, blocked_items), `lessons_created`. **One per cycle.**

### 4.2 FeatureIntake — the origin record for new work

`title`, `background`, `user_value`, `target` (screens/api/directories), `acceptance_criteria`,
`constraints`, `status` (queued|planning|implementing|reviewing|done|blocked), `dedupe_key`. Mirrors
`FEATURE_QUEUE.md`. Written on intake; updated on each state transition.

### 4.3 ImplementationDecision — _why_ this implementation (most important type)

`problem` (summary + evidence files), `decision` (adopted + reasons), `alternatives_rejected`,
`migration` (from→to), `verification` (commands), `review` (reviewer + result),
`future_rule_candidate`. Written on any design judgment, consolidation, or new
component/API/hook/service.

### 4.4 RejectedApproach — the approach we decided NOT to take

Stored **separately** so an agent does not re-propose it next cycle. `proposal`,
`rejection_reason`, `do_not_repeat_until` (condition), `linked_decision`.

### 4.5 FailurePattern — a past failure (more valuable than successes)

`symptom`, `root_cause`, `bad_fix` (anti-patterns), `good_fix`, `applies_to` (directories/patterns),
`evidence`, `tests_to_run`, `times_seen`. Search before touching similar code.

### 4.6 FixPattern — the verified recipe that fixes a FailurePattern

`fixes` (link to FailurePattern), `recipe.steps`, `required_checks`, `anti_patterns`.

### 4.7 ReviewFinding — abstracted peer-review result

`finding_type` (duplicate_implementation|missing_test|ui_regression|type_safety|performance|
security), `severity`, `status` (fixed|accepted_risk|blocked|false_positive), `finding`, `evidence`,
`recommended_action`, `resolution` (action_taken + commit), `lesson_candidate`. Abstract it —
file:line specifics belong in `evidence`, the reusable shape in `finding`.

### 4.8 GateResult — objective-gate outcome (incl. what was skipped)

Per-command `result` (pass|fail|skipped) with `failure_class` and `reason`; `security` block;
`overall` (result, accepted_for_next_step, reason). Records **what was not run**, so a later cycle
knows the coverage gap.

### 4.9 DuplicateMap — the map of de-duplicated implementations

`canonical_implementation` (file + exports), `duplicates_removed`, `callers_migrated`,
`do_not_recreate`, `verification`. Names the **canonical** implementation so the next similar feature
reuses it.

### 4.10 RiskArea — regression-prone hotspots

`risk_level`, `why_risky`, `files`, `required_before_edit`, `blocked_actions`, `linked_failures`.
Feeds automatic Blocked-ing and owner assignment.

### 4.11 BlockedContext — why we stopped (so the next agent doesn't hit the same wall)

`blocked_reason`, `blocked_by`, `attempted`, `safe_next_action`, `do_not_do`. Mirrors `BLOCKED.md`.

### 4.12 SecurityFinding — security posture for the MCP / loop surface

`risk`, `policy`, `detection`, `resolution`. **Store the env-var NAME only**, never the value (§10).
gbrain remote token is a full-access secret and is excluded from writeback by policy.

### 4.13 CandidateLesson / VerifiedLesson / StableRuleCandidate — the promotion ladder

- **CandidateLesson** — `lesson`, `source_task`, `source_memory`, `applies_to`, `validated_by`,
  `times_confirmed: 1`, `promotion_status: candidate`, `promotion_requirements`, `anti_conditions`.
- **VerifiedLesson** — `times_confirmed: ≥2` across **independent** runs, `peer_agreement`,
  `objective_gate`, `promotion_status: stable_rule_candidate`.
- **StableRuleCandidate** — `target_file` (AGENTS.md|CLAUDE.md), `proposed_rule`,
  `requires_human_review: true`. **Never auto-promote** (see `PROMOTION_QUEUE.md` §13 criteria).

### 4.14 StaleMemory — explicitly kills an out-of-date memory

`stale_memory_id`, `detected_in_task`, `reason`, `action` (mark superseded; do not ApplyNow),
`superseded_by`. Prevents misapplication and keeps search quality high. Set the **old** page's
`superseded_by` to the new slug when you file one.

### 4.15 MemoryConflict — two memories disagree

`memory_a`, `memory_b`, `conflict`, `resolution_status`, `safe_policy` (do not ApplyNow; defer to
peer review + **current repo usage**).

---

### 4.16 Specialized finding / decision types (lane-specific)

First-class `type` values used by the Claude/Codex split (§12). They are intentionally narrower than
the base types so `gbrain list --type` can slice by concern. **No dedicated template yet** — reuse
the nearest base template in `templates/gbrain/` (noted per type) and set `type:` accordingly.

**claude-lead lane** (UI/UX + product), each shaped like an **ImplementationDecision/ReviewFinding**:

- **UIUXDecision** (already §3) — a settled UI/UX choice (component, hierarchy, density, a11y).
  _Canonical component named, like a DuplicateMap for UI._ Base: `implementation-decision.md`.
- **FormUXPattern** — a reusable form-interaction pattern (validation surfacing, autosave, leave-guard,
  multi-step). Base: `implementation-decision.md`.
- **StateDisplayPattern** — how a domain state is rendered (StateBadge/StatusDot tokens, empty/loading/
  error surfaces). Base: `implementation-decision.md`.
- **AccessibilityFinding** — a WCAG-AA conformance gap + fix (contrast, focus, target size, aria).
  Base: `review-finding.md` (`finding_type: ui_regression`/a11y).
- **ResponsiveFinding** — a breakpoint/layout-density issue + fix. Base: `review-finding.md`.
- **ProductDecision** — a product-scope/acceptance judgment (what is in/out of a slice, UX-completeness
  gap accepted or deferred). Base: `implementation-decision.md`.
- **UserFlowDecision** — a chosen navigation/flow path across screens. Base: `implementation-decision.md`.

**codex-lead lane** (correctness/perf):

- **TypeSafetyDecision** (already §3) — a type-modeling choice (schema-derived type over ad-hoc union).
  Base: `implementation-decision.md`.
- **PerformanceFinding** — a perf issue + fix (N+1, unbounded query, needless re-render), with the
  measurement that confirmed it. Base: `review-finding.md` (`finding_type: performance`).

All carry the §3 common metadata, follow the §10 redaction rules, and link per §6.

## 5. gbrain slug / directory design (mapped to the real CLI)

gbrain page **slugs use `/` as path separators** (confirmed against the live store — existing pages
are `.agent-loop/prompts/claude-lead`, etc.). The memory **`type`** comes from frontmatter and is
queryable via `gbrain list --type <Type>`. Write-through lands in the local brain
(`/Users/yusuke/brain/...`, on-device — no data egress).

```
projects/careviax/profile
projects/careviax/loop-runs/<YYYY-MM-DD>/<task-id>
projects/careviax/features/<feature-id>
projects/careviax/decisions/<decision-id>
projects/careviax/rejected/<rejected-id>
projects/careviax/failures/<failure-id>
projects/careviax/fix-patterns/<fix-id>
projects/careviax/reviews/<review-id>
projects/careviax/gates/<gate-id>
projects/careviax/duplicates/<duplicate-map-id>
projects/careviax/risk-areas/<risk-id>
projects/careviax/blocked/<blocked-id>
projects/careviax/lessons/candidates/<lesson-id>
projects/careviax/lessons/verified/<lesson-id>
projects/careviax/lessons/stable-candidates/<lesson-id>
projects/careviax/stale/<stale-memory-id>
```

Keeping `decisions/`, `failures/`, `fix-patterns/`, and `lessons/` **separate from `loop-runs/`** is
deliberate: it keeps "what is reusable knowledge" findable instead of buried in run logs.

---

## 6. Graph edges → `gbrain link --link-type`

gbrain stores typed edges natively (`gbrain link <from> <to> --link-type <T>`; traverse with
`gbrain graph` / `gbrain graph-query` / `gbrain backlinks`). Encode these relations explicitly:

```
LoopRun        --produced-->       Decision | FailurePattern | CandidateLesson
Decision       --rejects-->        RejectedApproach
FailurePattern --fixed_by-->       FixPattern
ReviewFinding  --targets-->        <file page>
DuplicateMap   --canonicalizes-->  <file page>
CandidateLesson--derived_from-->   Decision
VerifiedLesson --confirmed_by-->   LoopRun
StableRuleCand --proposes_update-->AGENTS.md | CLAUDE.md
BlockedContext --requires-->       HumanApproval
StaleMemory    --superseded_by-->  Decision
```

Also mirror the key links in a page's `## Links` body section (`[[slug]]`) for human readability —
gbrain extracts them when `auto_link` is on, and the explicit `gbrain link` call guarantees the edge.

---

## 7. Save timing

| Loop step  | Action (mostly **search**, then targeted **save**)                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run start  | **Search**: recent LoopRun, target-file Decisions, similar FailurePattern, DuplicateMap, RiskArea, BlockedContext, StaleMemory → fill `MEMORY_REVIEW.md` → `LOOP_POLICY.md`. |
| Plan       | Save **drafts** (`status: proposed`): FeatureIntake, ImplementationDecision, RejectedApproach, RiskArea ref.                                                                 |
| Patch done | Save: ReviewFinding, GateResult, DuplicateMap, FixPattern, finalized Decision.                                                                                               |
| Run end    | Save: LoopRun, CandidateLesson, BlockedContext, StaleMemory, MetricSnapshot.                                                                                                 |
| LE-PDCA    | Analyze past LoopRun / ReviewFinding / GateResult patterns; save useful loop methods and anti-patterns as reusable memories, then check them against `METRICS.md`.           |

---

### 7.1 Loop-Engineering PDCA writeback

Loop engineering is a separate improvement track for the Claude × Codex process itself. It must be
recorded as reusable knowledge, not as a raw retrospective log.

Use existing memory types instead of inventing one-off pages:

- **Useful methods** → `ImplementationDecision`, `FixPattern`, or `CandidateLesson`.
  Examples: a review checklist that reliably catches green-gate contract mismatches; a lock/commit
  split that prevents dirty-tree collisions; a gbrain query pattern that improves duplicate
  detection.
- **Methods to improve** → `FailurePattern`, `RejectedApproach`, or `ReviewFinding`.
  Examples: a subagent fan-out that missed stale-data behavior; a validation subset that produced a
  false sense of safety; a policy patch promoted without enough provenance.
- **Evidence / measurement** → link to `LoopRun`, `GateResult`, `REVIEW_LOG.md`, `VERIFY_LOG.md`,
  `PATCH_INBOX.md`, and `METRICS.md` entries. Store paths, commit ids, command names, and short
  findings; never store full command output or conversation text.

PDCA mapping:

1. **Plan** — formulate one bounded method hypothesis from prior patterns.
2. **Do** — apply it in one cycle without widening product scope.
3. **Check** — compare against review turnaround, recurrence, gate misses, stale-memory rate,
   candidate lesson conversion, and rework after approval.
4. **Act** — write a `CandidateLesson` or `RejectedApproach`; promote only through
   `PROMOTION_QUEUE.md` / `LOOP_POLICY.md` with peer agreement and human approval where required.

Recommended tags:

```yaml
tags: [loop-engineering, pdca, review-quality, validation, gbrain, agent-loop]
```

These memories are still subordinate to live repo state. If a later cycle shows the method no
longer applies, file `StaleMemory` or `MemoryConflict` rather than continuing to ApplyNow it.

## 8. Retrieval metadata (tags)

Tag generously at write time (`gbrain tag <slug> <tag>` or `tags:` in frontmatter). Recommended axes:

```yaml
tags:
  domain: [items, auth, billing, dispense, audit, report, ...] # careviax: dispense/audit/report/patient/...
  layer: [ui, api, db, test, infra]
  concern:
    [
      duplicate-removal,
      performance,
      stability,
      accessibility,
      validation,
      state-color,
      loop-engineering,
      pdca,
    ]
  technology: [react, nextjs, typescript, prisma, rls, tanstack-query, zustand, dexie, serwist]
  risk: [security, destructive-migration, flaky-test, phi]
  agent: [claude, codex]
  outcome: [accepted, blocked, rejected]
```

Search examples (both keyword and **`gbrain query` semantic work now — embeddings generated via
local `ollama:mxbai-embed-large`, 2026-06-20; see §10 + `BLOCKED.md` RESOLVED**):

```
gbrain search "api client retry duplicate-removal"
gbrain list --type FailurePattern --tag stability
gbrain list --type GateResult --tag flaky-test
gbrain list --type RejectedApproach
```

---

## 9. Save / skip decision

```
Save when it: prevents repeating a decision · prevents a regression · prevents a duplicate impl ·
  names the canonical impl · records how to verify · explains why human approval is needed ·
  raises Claude/Codex review accuracy.
Skip when it: is a scratch note · an unexplained error fragment · full command output ·
  a transient lint error · a one-off coincidence · may contain a secret · already fully captured
  in an Issue/PR with no reuse value.
```

---

## 10. Redaction / sanitization (mandatory before writeback)

Strip before `gbrain put`: API keys, tokens, cookies, Authorization headers, `.env` contents,
database URLs, private keys, customer/patient data (PHI — 要配慮個人情報), email bodies, PII inside
stack traces.

```yaml
# OK
secret_reference: { env_var_name: GBRAIN_REMOTE_TOKEN, value_stored: false, smoke_test: pass }
# NEVER
token: gbrain_xxx...
```

This binds to the loop's hard security rule (README §7 / prompts §15): never log PHI or secrets into
RUNLOG / agmsg / **memory**. **Embeddings are now generated locally** (`ollama:mxbai-embed-large`,
1024d, `http://localhost:11434`) — nothing is sent to OpenAI/Voyage, so the data-egress concern is
moot (`BLOCKED.md` gbrain-embeddings RESOLVED 2026-06-20). Both keyword and `gbrain query` (semantic) work.

---

## 11. Memory quality score

```yaml
memory_quality:
  { evidence:0-5, recency:0-5, reuse:0-5, peer_agreement:0-5, gate:0-5, risk:0-5, total:0-30 }
```

`≥25` → ApplyNow candidate · `18–24` → Consider · `10–17` → Ignore / human check · `≤9` → do not use
(stale / unfounded). Scoring rubric for each axis is in §11 of the originating design (evidence:
file<test<peer; recency: 2w=5/3mo=3/1yr=0; reuse: multi=5/once=3/none=0; peer: human-or-both=5;
gate: lint+type+test+build=5; risk: security/auth/billing=0, normal=5).

---

## 12. Claude / Codex writeback split

All type names below are defined `type` values (§3 union); the lane-specific specializations have
field guides in **§4.16**.

**claude-lead writes mainly:** FeatureIntake, **UIUXDecision**, FormUXPattern, StateDisplayPattern,
AccessibilityFinding, ResponsiveFinding, ProductDecision, UserFlowDecision.

**codex-lead writes mainly:** ImplementationDecision, FailurePattern, FixPattern, DuplicateMap,
GateResult, **TypeSafetyDecision**, PerformanceFinding, SecurityFinding, RejectedApproach.

**Both write:** LoopRun, ReviewFinding, CandidateLesson, BlockedContext, StaleMemory. For a shared
type written from both sides in one task, set `partial: true` on each and merge into one final
`LoopRun` at run end.

---

## 13. Dedupe & conflict

```yaml
dedupe_key: sha256(project_id + type + normalized_title + target_files + normalized_decision_or_failure)
```

On a key collision: **do not create a new page** — `gbrain get` the existing one, append the new
evidence, bump `times_seen` / `times_confirmed`. If the new evidence **contradicts** the old, file a
`MemoryConflict` (§4.15) with `resolution_status: unresolved` and `safe_policy: prefer current repo
usage; not ApplyNow until peer-resolved`.

---

## 14. gbrain → LOOP_POLICY mapping

Every recalled memory is classified into one `MEMORY_REVIEW.md` bucket; **only `ApplyNow` enters
`LOOP_POLICY.md`**:

```
ApplyNow   : directly relevant · not contradicted by repo · evidence_level ≥ peer_reviewed ·
             confidence high|medium · no security weakening.
Consider   : relevant but conditional · old-but-useful caution · gate-unverified review note.
Ignore     : stale · out of scope · unfounded · contradicted by repo.
BlockedContext: human approval / credentials / destructive migration / production / auth|billing|
             payments|security.
```

---

## 15. Writeback Rule (paste-ready for the supervisor prompts)

```
Memory Writeback Rule:

Before writing to gbrain, classify this cycle's information.

Save:    LoopRun · FeatureIntake · ImplementationDecision · RejectedApproach · FailurePattern ·
         FixPattern · ReviewFinding · GateResult · DuplicateMap · RiskArea · BlockedContext ·
         SecurityFinding · CandidateLesson · StaleMemory
Do not:  raw conversation · full command output · secret/token/cookie/.env · PII/PHI ·
         unverified speculation · transient trial-and-error · a hypothesis already shown wrong

Before saving: redact secrets · attach evidence (file/commit/test) · set confidence ·
         set evidence_level · set validity_scope · add tags · link related memories · dedupe by key
After saving:  append memory_id (= slug) to .agent-loop/STATE.md ·
         file CandidateLessons into PROMOTION_QUEUE.md · never auto-promote to a StableRule
```

---

## 16. CLI cheat-sheet (real gbrain commands)

```bash
# write (stdin; frontmatter type/title/tags honored)
gbrain put projects/careviax/decisions/<id> < page.md
# read / list by type or tag
gbrain get  projects/careviax/decisions/<id>
gbrain list --type ImplementationDecision --tag api -n 20
# recall (keyword + query=semantic both work; local ollama embeddings, 2026-06-20)
gbrain search "api client retry duplicate"
# typed edges (the knowledge graph)
gbrain link projects/careviax/loop-runs/2026-06-20/QL-001 projects/careviax/decisions/<id> --link-type produced
gbrain backlinks projects/careviax/decisions/<id>
gbrain graph-query projects/careviax/decisions/<id> --type produced --direction in
# tags
gbrain tag projects/careviax/decisions/<id> duplicate-removal
# supersede a stale memory: set superseded_by in the OLD page's frontmatter, then re-put it.
```

> Note: gbrain prints a benign `[config] Ignoring DATABASE_URL …` line — it deliberately uses its own
> `~/.gbrain/config.json` engine, not the repo `.env`. Harmless; filter with `grep -v '^\[config\]'`.

---

## 17. MVP phasing (build the minimum that makes the loop self-improve)

```
Phase 1: LoopRun · GateResult · BlockedContext
Phase 2: ImplementationDecision · RejectedApproach · ReviewFinding
Phase 3: FailurePattern · FixPattern · DuplicateMap
Phase 4: CandidateLesson · VerifiedLesson · StableRuleCandidate · StaleMemory
```

The six load-bearing types are **ImplementationDecision · FailurePattern · FixPattern ·
ReviewFinding · GateResult · CandidateLesson**. With these, a cycle can ask: _what similar work
exists? what did we break? which impl is canonical? which approach is already rejected? which tests
must run? which lesson is ApplyNow now?_ — which is what turns gbrain from a memory store into the
self-improvement engine of the Claude×Codex maker/checker loop.

---

## Links

- governed_by: [[.agent-loop/loop_policy]] · [[.agent-loop/promotion_queue]] · [[.agent-loop/memory_review]]
- templates: `.agent-loop/templates/gbrain/`
- security: [[.agent-loop/blocked]] (gbrain-embeddings: RESOLVED 2026-06-20 — local ollama embeddings, no egress)
