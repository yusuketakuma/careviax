export const meta = {
  name: 'ultracode-expansion-20260702',
  description:
    'Expand the 2026-07-02 ultracode findings: hunt NEW instances of the same bug classes across un-scanned FE/BE/DB surface, adversarially verify, synthesize an expansion appendix',
  phases: [
    {
      title: 'Find',
      detail:
        'multi-lens finders (FE/BE/DB) hunt new instances of known bug classes in un-scanned files',
    },
    {
      title: 'Verify',
      detail:
        'adversarial per-candidate verification: refute-by-default, dedup vs F01-F78, reachability, intentionality',
    },
    { title: 'Synthesize', detail: 'dedup + rank confirmed findings into an appendix payload' },
  ],
};

// args.findingsPath = path to the existing ULTRACODE findings file (F01-F78) for dedup
// args.covered      = array of already-scanned source file paths
const FINDINGS_PATH = (args && args.findingsPath) || 'ops/refactor/ULTRACODE_FINDINGS_20260702.md';
const COVERED = (args && args.covered) || [];
const COVERED_STR = COVERED.map((p) => `  - ${p}`).join('\n');

const DEDUP_BLOCK = `
=== DEDUP SOURCE OF TRUTH ===
The already-reported findings F01-F78 live in the file: ${FINDINGS_PATH}
Before finalizing ANY candidate, grep that file (e.g. \`grep -nE "^## F" ${FINDINGS_PATH}\` for the
index, then read the relevant entry) to confirm your defect is NOT already reported. Each finder
prompt below also lists specific F-numbers/files to EXCLUDE — honor them.

=== FILES ALREADY DEEPLY SCANNED (a NEW *different-root-cause* defect in one of these is still novel, but re-describing the same defect is a duplicate) ===
${COVERED_STR}

DEDUP RULE: A candidate is a DUPLICATE only when F01-F78 already describes the SAME defect
(same file AND same root cause). A different bug class in an already-scanned file, or the same
bug class in a NOT-yet-scanned file, is NOVEL and in scope. Prefer un-scanned files.
`;

const COMMON_RULES = `
You are a read-only reconnaissance agent for the careviax medical pharmacy platform (Next.js 16 App Router,
React 19 + React Compiler, Prisma 7 + Postgres RLS, TZ=Asia/Tokyo runtime). Use Read/Grep/Glob/Bash (read-only).
Do NOT edit any file. Ground every claim in exact file:line evidence you actually read.

MEDICAL-SAFETY LENS: false-negatives (a missing safety alert, an error rendered as "0件/なし",
a wrong drug/patient shown) are the highest-harm defects. Timezone/date-boundary errors silently
mis-window medical/billing data. Prefer high-confidence, reachable-in-production defects.

For EACH candidate you must establish, BY READING THE CODE (not assuming):
  1. It is REACHABLE in production (name the caller / user action / job).
  2. It is NOT intentional spec — check for a nearby comment, docs/decisions.md, or a test that
     locks the current behavior on purpose. A sibling that does it CORRECTLY is strong evidence
     the buggy one is an oversight.
  3. It is NOT already covered by F01-F78 (apply the DEDUP RULE below).
Report ONLY defects you would stake your credibility on. Over-reporting wastes the verify budget.
${DEDUP_BLOCK}
`;

const CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'one-line defect statement' },
          file: { type: 'string', description: 'repo-relative path' },
          line: { type: 'integer' },
          bugClass: {
            type: 'string',
            description:
              'one of: false-empty | tz-date-boundary | fe-be-contract | raw-sql | perf-n+1 | concurrency | db-rls | dead-code-dupe | offline-reliability | other',
          },
          evidence: {
            type: 'string',
            description:
              'exact code you read with file:line, and the sibling/correct counterpart if any',
          },
          failureScenario: {
            type: 'string',
            description: 'concrete inputs/state -> wrong output/crash',
          },
          suggestedFix: { type: 'string' },
          reachability: {
            type: 'string',
            description: 'caller / user action / job that triggers it',
          },
          intentionalCheck: {
            type: 'string',
            description: 'why this is NOT intentional spec (comment/docs/test/sibling checked)',
          },
          notDuplicateReason: { type: 'string', description: 'why this is not already F01-F78' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: [
          'title',
          'file',
          'line',
          'bugClass',
          'evidence',
          'failureScenario',
          'reachability',
          'confidence',
        ],
      },
    },
  },
  required: ['candidates'],
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED'] },
    isDuplicate: {
      type: 'boolean',
      description: 'true if F01-F78 already describes this same defect',
    },
    dedupOf: { type: 'string', description: 'e.g. F11, or empty' },
    reason: {
      type: 'string',
      description: 'what you independently verified or why you refute; cite file:line you re-read',
    },
    correctedTitle: { type: 'string', description: 'tightened one-line statement if confirmed' },
    classification: {
      type: 'string',
      enum: ['fix', 'flag'],
      description:
        'fix=safe to implement; flag=needs human/plan review (auth/billing/security/destructive/danger-zone)',
    },
    scores: {
      type: 'object',
      additionalProperties: false,
      properties: {
        safety: { type: 'integer' },
        effect: { type: 'integer' },
        verify: { type: 'integer' },
        scope: { type: 'integer' },
        efficiency: { type: 'integer' },
      },
      required: ['safety', 'effect', 'verify', 'scope', 'efficiency'],
    },
  },
  required: ['verdict', 'isDuplicate', 'reason', 'classification', 'scores'],
};

// (class × area) finder matrix — diverse lenses across FE / BE / DB
const FINDERS = [
  // ---- FE lane: false-empty fail-close (react-query isError unhandled) ----
  {
    key: 'fe-falseempty-patients',
    lane: 'FE',
    prompt: `CLASS: FE false-empty fail-close. A useQuery/useQueries whose isError is never read, so a fetch failure collapses to data ?? [] / ?? null and renders as a genuine empty/zero/"なし/ありません/見つかりません" state, or silently drops a safety alert / warning / count. Exemplars: F05/F11/F14/F27/F28/F36/F50.
AREA: patient-facing screens & their child components — glob 'src/app/(dashboard)/patients/**/*.tsx' and 'src/components/features/patients/**/*.tsx'. EXCLUDE files already scanned (card-workspace.tsx, medications-content.tsx, safety-check-content.tsx are done). Grep for useQuery/useQueries, then for each check whether isError is destructured AND rendered; flag ones that aren't where the empty state is user-meaningful (esp. allergy/CDS/consent/medication/plan data). Also hunt SECONDARY consumers of a query (badges/counts/other sections) that show false-zero even when the primary list has an error branch.`,
  },
  {
    key: 'fe-falseempty-workflow',
    lane: 'FE',
    prompt: `CLASS: FE false-empty fail-close (isError unhandled -> empty/0/no-alert). Exemplars: F13/F14/F27/F28/F50.
AREA: workflow / operational screens — 'src/app/(dashboard)/{dashboard,my-day,visits,dispense,set,set-audit,audit,workflow,qr-scan,search,select-mode,communications,referrals,views,statistics}/**/*.tsx'. EXCLUDE already-scanned (my-day-content, visit-record-form, notifications-content, handoff-workspace, tasks-content, conferences-content, schedule-* done). Focus on queries whose failure hides a deadline/alert/blocked-reason/count.`,
  },
  {
    key: 'fe-falseempty-admin',
    lane: 'FE',
    prompt: `CLASS: FE false-empty fail-close. Exemplars: F05/F36. Also the inverse: an EmptyState/'0件'/'なし' shown while an owning query is in isError, and false-zero summary counts (FilterSummaryBar '表示: N件') during error.
AREA: admin & billing screens — 'src/app/(dashboard)/{admin,billing,external,clerk-support,reports}/**/*.tsx'. EXCLUDE already-scanned (staff-kpi-panel, capacity, drug-master-content, data-explorer, partner-cooperation-billing-content, collaboration/external-viewer/consent/share done in earlier cycles). Verify by reading the render branch, not just the useQuery.`,
  },
  // ---- FE lane: contract & shared component ----
  {
    key: 'fe-be-contract',
    lane: 'FE',
    prompt: `CLASS: FE↔BE contract mismatch. (a) FE reads body?.error but the API envelope (src/lib/api/response.ts) emits {code,message,details} — actionable server errors collapse to a generic fallback toast (exemplar F03). (b) FE hand-duplicates an API payload TYPE that has drifted from the route's type (F30). (c) FE ignores a server capability: fetches-all then client-filters though the route supports a status/mode param, or a mark-all/bulk mode the FE never sends (F15/F16/F39/F51).
AREA: all mutation error handlers + fetch call sites under 'src/app/(dashboard)/**/*.tsx'. Grep for 'body?.error' / '.error ??' / 'res.json()' error parsing and for fetchAllCursorPages usages. Cross-check each against the actual route's response.ts helper usage and supported query params. EXCLUDE F03(schedule-create-edit-drawer)/F15/F16/F30/F39/F51.`,
  },
  {
    key: 'fe-tz-datekey',
    lane: 'FE',
    prompt: `CLASS: FE timezone/date-key derivation bug. new Date().toISOString().slice(0,7|10) or new Date()+setHours/getMonth used as a business date/month key or API filter, instead of japanDateKey()/japanMonthInstantRange() from src/lib/utils/date-boundary.ts — off-by-one for JST users before 09:00. Exemplars: F19/F29/F31.
AREA: 'src/app/(dashboard)/**/*.tsx' and 'src/components/features/**/*.tsx'. Grep for toISOString().slice, setHours(0, getMonth(, new Date(now). EXCLUDE staff-kpi-panel(F19). Confirm the derived value is used as a business date/month (not a stored UTC-sentinel formatting).`,
  },
  {
    key: 'fe-shared-component',
    lane: 'FE',
    prompt: `CLASS: shared-UI component correctness bug that fans out to many consumers. Exemplar F02: DataTable desktop onRowClick passes the sorted/filtered row-model index while consumers index the original array -> wrong record after sort. Look for other index/id/position mismatches, stale-closure props, or prop contracts that differ between two render paths (desktop vs mobile) in shared components.
AREA: 'src/components/ui/**/*.tsx' and 'src/components/features/**/*.tsx' (shared, multi-consumer). EXCLUDE data-table.tsx(F02), patient-pinned-header, reason-dialog, notification-bell (scanned). For any suspect, grep its consumers to prove a real misuse exists.`,
  },
  // ---- BE lane: timezone / raw-sql / perf / concurrency / db-date ----
  {
    key: 'be-tz-boundary-routes',
    lane: 'BE',
    prompt: `CLASS: BE server-local date/time boundary. new Date()+setHours(0,0,0,0) / getMonth()+setDate(1) / startOfDay used for a DateTime-column gte/lt filter or a KPI window, instead of japanDayInstantRange/japanMonthInstantRange (src/lib/utils/date-boundary.ts). On UTC prod this shifts windows by 9h and mis-buckets today/this-month. Exemplars: F06/F22/F60-F66.
AREA: 'src/app/api/**/route.ts'. EXCLUDE admin/capacity, admin/operations-insights, settings/operational-policy, prescription-intakes/triage, community-activities, visit-billing-candidates, patients/board (scanned) and the billing-evidence/admin-metrics/monthly-job/next-day-reminder/master-hub/daily-helpers already noted in F60-F66. Grep setHours(0/getMonth(/getDate(/new Date(now). Report only NOT-yet-covered routes.`,
  },
  {
    key: 'be-tz-boundary-services-jobs',
    lane: 'BE',
    prompt: `CLASS: BE server-local date/time boundary in services & scheduled jobs (higher blast radius — a mis-windowed daily job silently mis-processes every org). Exemplars: F24(server-TZ formatTimeOfDay)/F63/F64/F66.
AREA: 'src/server/services/**/*.ts' and 'src/server/jobs/**/*.ts'. EXCLUDE patient-status-tracker, today-ops-rail, prescriptions daily job, pdf-visit-record, time-of-day, date-display (scanned). Grep setHours/getMonth/getDate/startOfDay/new Date() used for windows or labels. Also flag server-side time-of-day/weekday labels rendered in server TZ.`,
  },
  {
    key: 'be-raw-sql',
    lane: 'BE',
    prompt: `CLASS: raw SQL correctness/safety. (a) $queryRaw window/aggregate where the outer ORDER BY / column references a name the inner subquery does not expose -> 42703 crash (F01). (b) latest-per-group via a single shared take:N window that starves other groups to null (F21/F75). (c) $queryRawUnsafe with interpolated identifiers -> injection risk (F59). (d) GROUP BY / DISTINCT ON / window mismatches.
AREA: grep every '$queryRaw' / '$queryRawUnsafe' / '$executeRaw' across 'src/server/**' and 'src/app/api/**'. EXCLUDE patient-status-tracker(F01), data-explorer(F59), and the take:50 sites already in F21/F75. Read each raw block fully and reason about Postgres semantics. If you can, sanity-check a query shape with the repo's PGlite (node_modules/@electric-sql/pglite) — but reading is sufficient.`,
  },
  {
    key: 'be-perf',
    lane: 'BE',
    prompt: `CLASS: BE performance / scalability. (a) unbounded findMany over full org history for a 'today/this-month' KPI or a hot page load (F43/F76/F77). (b) N+1: a findFirst/findUnique inside a for-loop over a collection (F55/F70). (c) independent awaited reads that should be Promise.all / a query placed after the Promise.all it belongs in (F45/F46/F74). (d) loading all rows to use only newest-per-group (F34/F73).
AREA: 'src/server/services/**/*.ts', 'src/server/jobs/**/*.ts', 'src/app/api/**/route.ts'. EXCLUDE the specific sites in F34/F43/F45/F46/F52/F55/F70/F73/F74/F76/F77. Grep for 'for (' + await inside, sequential 'await prisma' blocks, findMany without take/where-time-bound. Quantify the blast radius (rows/requests).`,
  },
  {
    key: 'be-concurrency',
    lane: 'BE',
    prompt: `CLASS: concurrency / atomicity. (a) check-then-act: read status/state then update WITHOUT re-asserting the expected prior value in the update where-clause, so concurrent transitions bypass a state machine (F44/F71). (b) read-modify-write on a JSON array/column (e.g. allergy_info, tags, arrays) without a row lock / atomic update, so concurrent writers drop entries (F48). (c) non-idempotent upsert keys that can collide.
AREA: 'src/server/services/**/*.ts' and 'src/app/api/**/route.ts' — grep for status transitions, '.update(' after a '.findUnique/findFirst', and JSON-field spreads like [...existing, new]. EXCLUDE cases/transition(F44), qr-allergy-promotion(F48). Prove concurrency reachability (two users / retries / SSE).`,
  },
  {
    key: 'be-db-date-writes',
    lane: 'BE',
    prompt: `CLASS: @db.Date sentinel write bug. Writing a local-time Date (new Date(y,m,d) / new Date(localKey)) into a '@db.Date' column instead of the UTC-midnight sentinel convention (utcDateFromLocalKey / new Date('YYYY-MM-DD')), so under JST the stored civil date is the previous day and upsert keys never collide with the correct-convention writers. Exemplar F07.
AREA: first grep prisma/schema/**/*.prisma for '@db.Date' columns; then grep 'src/app/api/**' and 'src/server/**' for writers of those columns and check each Date construction. EXCLUDE pharmacist-shift-templates/apply(F07). This is DB-schema-aware BE work.`,
  },
  // ---- DB lane: schema / RLS / indexes ----
  {
    key: 'db-rls-orgscope',
    lane: 'DB',
    prompt: `CLASS: DB tenant-isolation / RLS / org-scoping. (a) a Prisma query on an org-scoped model that omits org_id in the where and relies solely on RLS, in a code path that may run outside withOrgContext (fail-open read across tenants). (b) a model that is FORCE-RLS in prisma/rls-policies.sql but whose app query assumes global, or vice-versa (see project memory: DrugAlertRule hybrid, app_enforced_org_id fail-closed). (c) $queryRawUnsafe / raw SQL that bypasses RLS session context. (d) missing @@unique / composite index for a documented hot query path.
AREA: read prisma/schema/**/*.prisma and prisma/rls-policies.sql to map org-scoped + FORCE-RLS models; then grep src/server & src/app/api for findMany/findFirst on those models missing org_id where-clauses or run outside withOrgContext. This is the DB-depth lens the earlier scan under-covered. Be precise: an intentional global model (e.g. DrugMaster) is NOT a bug.`,
    effort: 'high',
  },
  {
    key: 'db-schema-integrity',
    lane: 'DB',
    prompt: `CLASS: DB schema / data-integrity gaps that surface as app bugs. (a) a unique/foreign-key/enum constraint the app assumes but the schema lacks (or vice-versa: an upsert key that cannot collide because the @@unique differs from the writer's key — see F07). (b) nullable columns the app always dereferences. (c) enum drift between Prisma enum and a TS union / zod schema used at a boundary (F17/F30/F32 class). (d) @db.Date vs DateTime columns read with the wrong boundary helper.
AREA: read prisma/schema/**/*.prisma; cross-reference with src/lib/validations/**, src/types/**, and the services that write/read the columns. Report concrete app-visible consequences, not style.`,
  },
  // ---- cross-cutting: dead-code / duplication / offline ----
  {
    key: 'dead-code-dupe',
    lane: 'X',
    prompt: `CLASS: dead code & divergent duplication. (a) exported module/component with zero non-test importers (F18/F25/F26/F56). (b) a helper copied into N files that has DRIFTED (divergent null/trim/format handling — F32/F35/F41/F42/F72). (c) a stale vi.mock of a module the source no longer imports.
AREA: whole repo. For dead code: pick suspicious src/components/** and src/lib/** modules and prove zero production importers via grep of the symbol + '@/...' path (NOT just the path). For drift: grep for repeated helper names (formatYen, readString, evaluatePasswordStrength, date formatters) and diff the copies. EXCLUDE the specific files listed in F18/F25/F26/F32/F35/F40/F41/F42/F56/F72. Report each with proof.`,
  },
  {
    key: 'offline-reliability',
    lane: 'X',
    prompt: `CLASS: offline/PWA queue reliability (PHI at stake). Exemplars: F52(quota materializes all payloads)/F53(evidence stuck at MAX_RETRIES forever)/F54(card action queue never replayed). Hunt for other queues/drafts in src/phos/api/** and src/lib/offline/** that: never get replayed, have no retry-reset/dead-letter path, silently drop on quota, or lose data on merge. Also SSE/notification merge that zeroes an aggregate (F49/F78 class).
AREA: 'src/phos/api/**/*.ts', 'src/lib/offline/**/*.ts', 'src/lib/hooks/**' sync engines, and notification/SSE merge code. EXCLUDE offlineEvidenceQueue/offlineActionQueue/crypto(scanned), F49/F52/F53/F54/F78. Trace the enqueue->replay lifecycle and name where data is lost.`,
  },
];

phase('Find');
log(
  `ultracode expansion: ${FINDERS.length} finder lenses over un-scanned FE/BE/DB surface, adversarial per-candidate verify`,
);

const perFinder = await pipeline(
  FINDERS,
  // stage 1: find candidates
  (f) =>
    agent(
      `${COMMON_RULES}\n\n${f.prompt}\n\nReturn up to 7 of your HIGHEST-confidence NEW candidates (fewer is better than padding). If you find nothing novel, return an empty array.`,
      {
        label: `find:${f.key}`,
        phase: 'Find',
        agentType: 'general-purpose',
        effort: f.effort || 'high',
        schema: CANDIDATE_SCHEMA,
      },
    ).then((r) => ({ finder: f.key, lane: f.lane, candidates: (r && r.candidates) || [] })),
  // stage 2: adversarially verify each candidate from this finder (runs as soon as the finder returns)
  (found) => {
    if (!found || !found.candidates.length)
      return {
        finder: found ? found.finder : 'unknown',
        lane: found ? found.lane : '?',
        verified: [],
      };
    return parallel(
      found.candidates.map(
        (c) => () =>
          agent(
            `${COMMON_RULES}\n\nADVERSARIAL VERIFICATION. Another agent proposed this candidate defect. Your job is to REFUTE it unless the code proves it real. Default to REFUTED if you cannot independently confirm by re-reading the cited code yourself.\n\nCANDIDATE:\n${JSON.stringify(c, null, 2)}\n\nChecklist you MUST perform by reading files:\n1. Does the cited code actually say what the candidate claims (re-read file:line)?\n2. Is it reachable in production (real caller / user action / job)?\n3. Is it intentional spec? (nearby comment, docs/decisions.md, a test that deliberately locks it, an offline-networkMode nuance, an optional field). If intentional, REFUTE.\n4. Is it a DUPLICATE of F01-F78 (same file AND same root cause)? If yes, set isDuplicate=true and dedupOf.\n5. Set classification=flag if it touches auth/billing/security/destructive-migration/PHI-in-error or is a DANGER_ZONE; else fix.\n6. Score safety/effect/verify/scope/efficiency each 1-5 (like the existing findings).\nReturn your verdict.`,
            {
              label: `verify:${found.finder}:${c.file.split('/').pop()}`,
              phase: 'Verify',
              agentType: 'general-purpose',
              effort: 'high',
              schema: VERDICT_SCHEMA,
            },
          )
            .then((v) => ({ candidate: c, finder: found.finder, lane: found.lane, verdict: v }))
            .catch(() => null),
      ),
    ).then((verified) => ({
      finder: found.finder,
      lane: found.lane,
      verified: verified.filter(Boolean),
    }));
  },
);

phase('Synthesize');
// flatten every verified candidate
const all = perFinder.flatMap((pf) => (pf && pf.verified) || []);
const confirmed = all.filter(
  (x) => x && x.verdict && x.verdict.verdict === 'CONFIRMED' && !x.verdict.isDuplicate,
);

// dedup across finders by file+bugClass (two finders may surface the same defect)
const seen = new Map();
for (const x of confirmed) {
  const key = `${x.candidate.file}::${x.candidate.bugClass}::${(x.candidate.title || '').slice(0, 40)}`;
  const score =
    x.verdict.scores.safety +
    x.verdict.scores.effect +
    x.verdict.scores.verify +
    x.verdict.scores.scope +
    x.verdict.scores.efficiency;
  const prev = seen.get(key);
  if (!prev || score > prev.score) seen.set(key, { ...x, score });
}
const deduped = [...seen.values()].sort((a, b) => b.score - a.score);

const refuted = all.filter(
  (x) => x && x.verdict && x.verdict.verdict === 'REFUTED' && !x.verdict.isDuplicate,
);
const duplicates = all.filter((x) => x && x.verdict && x.verdict.isDuplicate);

log(
  `raw candidates: ${all.length} | confirmed-novel: ${confirmed.length} | after dedup: ${deduped.length} | refuted: ${refuted.length} | duplicates-of-F01-78: ${duplicates.length}`,
);

return {
  summary: {
    finders: FINDERS.length,
    rawCandidates: all.length,
    confirmedNovel: confirmed.length,
    afterDedup: deduped.length,
    refuted: refuted.length,
    duplicates: duplicates.length,
    byLane: deduped.reduce((acc, x) => ((acc[x.lane] = (acc[x.lane] || 0) + 1), acc), {}),
    byClass: deduped.reduce(
      (acc, x) => ((acc[x.candidate.bugClass] = (acc[x.candidate.bugClass] || 0) + 1), acc),
      {},
    ),
  },
  findings: deduped.map((x) => ({
    score: x.score,
    lane: x.lane,
    finder: x.finder,
    bugClass: x.candidate.bugClass,
    title: x.verdict.correctedTitle || x.candidate.title,
    file: x.candidate.file,
    line: x.candidate.line,
    classification: x.verdict.classification,
    scores: x.verdict.scores,
    evidence: x.candidate.evidence,
    failureScenario: x.candidate.failureScenario,
    reachability: x.candidate.reachability,
    suggestedFix: x.candidate.suggestedFix,
    verifierReason: x.verdict.reason,
  })),
  duplicatesOfExisting: duplicates.map((x) => ({
    file: x.candidate.file,
    title: x.candidate.title,
    dedupOf: x.verdict.dedupOf,
  })),
};
