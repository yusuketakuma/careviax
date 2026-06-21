# gbrain writeback templates

Fill-in templates for the memory types defined in `../../GBRAIN_SCHEMA.md`. Copy one, replace the
`<...>` placeholders, then write it to gbrain:

```bash
sed 's/<task-id>/QL-20260620-001/' implementation-decision.md | gbrain put projects/careviax/decisions/2026-06-20/api-client-consolidation
# or simply:  gbrain put projects/careviax/<type-dir>/<yyyy-mm-dd>/<id> < filled.md
```

Rules (see GBRAIN_SCHEMA.md): set `title:` explicitly · keep `type:` exact (case-sensitive,
`list --type` matches it) · redact secrets/PHI (§10) · tag generously (§8) · add typed edges with
`gbrain link --link-type` (§6) · dedupe by key (§13) · append the slug to `STATE.md` after writing.
For new memories, use JST write-date partitioning:
`projects/careviax/<type-dir>/<yyyy-mm-dd>/<id>`. Existing old slugs remain stable and are not
bulk-migrated.

| Template                     | type                   | Phase |
| ---------------------------- | ---------------------- | ----- |
| `loop-run.md`                | LoopRun                | 1     |
| `gate-result.md`             | GateResult             | 1     |
| `blocked-context.md`         | BlockedContext         | 1     |
| `implementation-decision.md` | ImplementationDecision | 2     |
| `rejected-approach.md`       | RejectedApproach       | 2     |
| `review-finding.md`          | ReviewFinding          | 2     |
| `failure-pattern.md`         | FailurePattern         | 3     |
| `fix-pattern.md`             | FixPattern             | 3     |
| `duplicate-map.md`           | DuplicateMap           | 3     |
| `candidate-lesson.md`        | CandidateLesson        | 4     |
