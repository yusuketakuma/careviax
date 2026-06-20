# Reusable Prompt — Feature Intake

> Paste this (with the feature description appended) into **either** supervisor session — claude-lead or codex-lead. It registers a feature into the queue and routes it through the full loop: search → classify → policy patch → peer approval → implement → review → gates → writeback.
>
> How it is used: this is the single entry point for new work. Whoever receives it registers the feature, then coordinates with the peer over agmsg.

---

## Feature

```
<paste the feature description / request here>
```

---

## Intake steps (§11)

1. **Register** the feature into `FEATURE_QUEUE.md` with: id, title, requested-by, date, status `queued`.
2. **gbrain search** for prior art and past decisions on this feature area.
   - **STATUS: gbrain connected 2026-06-20** (careviax indexed read-write). Run `gbrain search "<terms>"` / `gbrain query "<question>"` and record the hits in `gbrain_memory_used`. Also read the repo (`src/app/**`, `src/components/**`, `docs/`) for prior art. (`mcp__gbrain__*` tools need a Claude Code restart; the CLI works now.)
3. **Classify**: which of Q1–Q6 (Refactor / Stability / Product-adjacent / UI/UX / Verification / Memory Writeback) apply; scope; risk tier; exact affected paths.
4. **Propose a LOOP_POLICY patch** (claude-lead drafts) describing active loops, scope bounds, and intended LOCK paths.
5. **Peer approval** over agmsg — codex-lead approves or tightens the policy before any implementation.
6. **Claude implements** in lane after LOCKing paths (study existing code first).
7. **Codex reviews** → `CHANGES_REQUESTED` (loop) or `APPROVED`.
8. **Gates** green (Q5).
9. **Writeback** (Q6) — stage outcome in the logs; gbrain is connected (2026-06-20), so a `gbrain` page may also be written. Memory stays subordinate to live repo state.

---

## Constraints (must hold)

- **Do not break existing specs** (`docs/ph-os_pharmacy_workflow_spec_*`, `docs/ph-os_pharmacy_multidisciplinary_collaboration_spec_*`, `docs/decisions.md`, `docs/ui-ux-design-guidelines.md`).
- **Reuse** existing component / API / type / Prisma schema / Zod validator. **No duplicate implementations.**
- **Conform to the UI/UX SSOT** (`docs/ui-ux-design-guidelines.md`) and the State Color System (StateBadge / StatusDot are canonical).
- **auth / billing / payments / security / destructive (irreversible) migration / production deploy** require explicit human approval (hard-stop, §14).
- **Never** weaken RLS / tenant isolation; never log or persist PHI.

---

## Verification checklist (Q5)

Before requesting `APPROVED`, confirm all of:

- [ ] `pnpm lint`
- [ ] `pnpm typecheck` (next typegen + tsc + tsc -p tsconfig.sw.json)
- [ ] `pnpm test` (Vitest)
- [ ] `pnpm build`
- [ ] 正常系 (happy path) works
- [ ] 異常系 (error path) handled and surfaced
- [ ] 空状態 (empty state) rendered
- [ ] 権限不足 (insufficient permission) handled
- [ ] responsive (mobile-first) verified

> Targeted when relevant: `pnpm test:e2e`, `pnpm test:e2e:audit`, `pnpm typecheck:no-unused`, `pnpm format:check`.
