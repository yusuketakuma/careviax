---
type: project
title: Patient Board Read 001
ingested_via: put_page
ingested_at: '2026-07-08T00:06:58.412Z'
source_kind: put_page
---

# PerformanceFinding: PATIENT-BOARD-READ-001

Date: 2026-07-08 JST
Repo: /Users/yusuke/workspace/careviax
Scope: /api/patients/board DB read-shape hardening

Decision:
- Implemented a low-risk partial DB read-speed improvement for the patient board BFF.
- Bounded nested relation fan-out for contacts, care_team_links, and latest prescription lines.
- Added stable id tie-breakers to top-N nested relation reads and rail reads.
- Did not add a top-level scan cap yet because it could hide urgent/safety-relevant patients and change current exact facet/card semantics.

Oracle:
- Attempted Oracle/GPT-5.5 Pro twice with GitHub/repo context.
- First session failed with chrome-disconnected after Node setTypeOfService EINVAL.
- Second session failed before model answer because attachments did not finish uploading before timeout.
- No Oracle advice was used. Patch was kept intentionally conservative.

Validation:
- pnpm exec vitest run src/app/api/patients/board/route.test.ts --reporter=dot --testTimeout=30000: passed 34 tests.
- pnpm db:query-shape:check: passed 0 allowlisted / 0 new violations.
- pnpm exec eslint src/app/api/patients/board/route.ts src/app/api/patients/board/route.test.ts: passed.
- pnpm exec prettier --check Plans.md ops/refactor/STATE.md src/app/api/patients/board/route.ts src/app/api/patients/board/route.test.ts: passed.
- NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck: passed.

Remaining:
- QUERY-SHAPE-WATCHLIST-003B remains for patients board main cursor redesign with DB-side take limit+1 and truthful count_basis.
- Future design must preserve safety/urgent patient visibility and exactness semantics or explicitly expose truncation/count basis.
