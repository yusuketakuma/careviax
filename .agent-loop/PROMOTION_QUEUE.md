# PROMOTION_QUEUE.md

**Purpose.** Holding area for CandidateLessons that have proven themselves in the loop and are
proposed for promotion into a durable home: `AGENTS.md` (Codex instructions), `CLAUDE.md`
(project + design), or a reusable Skill. Promotion is the only way a per-run lesson becomes
permanent team policy, so it is deliberately gated.

**How it is used in the loop.**

- A lesson that recurs in `MEMORY_REVIEW.md` / `LOOP_POLICY.md` across cycles is filed here as a
  CandidateLesson with evidence.
- At a promotion review, each candidate is checked against the criteria below.
- Only candidates that meet **every** criterion and pass the prohibitions are promoted; the
  destination file is edited in a normal LOCKed, peer-reviewed change.
- Rejected or not-yet-ready candidates stay queued with their current evidence count.

- **Run:** RUN-20260620-001
- **Cycle:** 0 (idle, next_action: bootstrap)
- **Date:** 2026-06-20

---

## Promotion criteria (`GBRAIN_SCHEMA.md` §4.13 promotion ladder + §11 quality gate)

A CandidateLesson may be promoted only if **all** of the following hold:

1. **Reproduced** in **2+ independent runs** (not the same run re-counted).
2. **Both Supervisors agree** — claude-lead **and** codex-lead explicitly sign off.
3. **Objective-gate backed** — supported by a passing objective gate / verification evidence
   (e.g. `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / e2e), not opinion.
4. **Fits the stack** — consistent with Next.js 16 / React 19 / TS 6 / Prisma 7 + RLS /
   TanStack Query 5 / Zustand 5 / Dexie / Serwist and existing conventions.
5. **Clear exceptions stated** — the lesson names the conditions under which it does _not_ apply.
6. **No security weakening** — does not relax RLS/tenant isolation, auth, audit, or compliance
   (3省2ガイドライン / APPI) posture.
7. **Human / explicit approval** — final promotion is approved explicitly (human or designated
   approval gate), never auto-applied.

## Prohibitions

A candidate is **rejected outright**, regardless of evidence, if it:

- Weakens security, tenant isolation (RLS), authentication, audit, or compliance.
- Is backed by a single run, or by both Supervisors being the same context (no real second opinion).
- Contradicts an existing `ApplyNow` rule without a documented superseding decision.
- Encodes a one-off / repo-state-specific hack as if it were general policy.
- Bypasses the LOCK/drain/lane discipline or lets subagents write to agmsg.
- Would be auto-applied without the explicit approval gate.

## Candidates

### CandidateLesson: API response validation & PHI-safe mutations

- **id:** CL-20260620-01
- **statement:** Validate client API reads with `readApiJson(res, {schema})` (fail-close malformed 2xx, static `fallbackMessage` only); mutation/POST responses must reuse the GET's `toSafe*` allowlist projection (never return the raw created row); consolidate response schemas to a shared lib when 3+ screens converge.
- **proposed_by:** claude-lead
- **destination:** AGENTS.md (codex lane conventions) / CLAUDE.md (API section)
- **evidence (runs):**
  - RUN-20260620-001 — Codex slice 1–8 + PHI fix (correction-request POST leaked raw `reason`/`proposed_value`); reviewer-audit APPROVED each; full suite 8465 passed.
  - RUN-**\_\_** — _pending independent second occurrence (do not promote yet)._
- **objective-gate:** `pnpm typecheck` / `typecheck:no-unused` / full `pnpm test` green (8465 passed / 1 skipped, 2026-06-20)
- **stack-fit:** zod@4 + Next route handlers + `readApiJson` already in `src/lib/api/`; no new deps.
- **exceptions:** ack-only endpoints returning no body; bare `success(row)` uses a bare schema (not `apiDataSchema`).
- **security-impact:** none (strengthens PHI redaction & fail-closed; does not weaken auth/tests).
- **criteria check:** [x]gate-backed [x]stack-fit [x]exceptions [x]no-sec-weaken [ ]2+runs [ ]both-agree [ ]explicit-approval
- **reviewed_by:** codex-lead — _pending_
- **status:** proposed
- **gbrain:** [[projects/careviax/lessons/candidates/api-response-validation-and-consolidation]]

_Template below._

<!--
### CandidateLesson: <short-title>

<!--
### CandidateLesson: <short-title>
- **id:** CL-<YYYYMMDD>-<nn>
- **statement:** <one-sentence lesson, phrased as a rule>
- **proposed_by:** <claude-lead | codex-lead>
- **destination:** <AGENTS.md | CLAUDE.md | Skill:<name>>
- **evidence (runs):**
  - RUN-________ — <what happened, which gate confirmed it>
  - RUN-________ — <independent second occurrence>
- **objective-gate:** <command(s) that back it, e.g. `pnpm typecheck` green>
- **stack-fit:** <why it is consistent with the pinned stack>
- **exceptions:** <when this lesson does NOT apply>
- **security-impact:** none / <describe — if non-none, likely auto-reject>
- **criteria check:** [ ]2+runs [ ]both-agree [ ]gate-backed [ ]stack-fit [ ]exceptions [ ]no-sec-weaken [ ]explicit-approval
- **reviewed_by:** <other supervisor> — <agree | objections>
- **status:** proposed | peer-approved | approved | promoted | rejected
-->
