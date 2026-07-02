export const meta = {
  name: 'ultracode-expansion-r2-20260702',
  description:
    'Round-2 neighbor expansion: for each confirmed round-1 finding, exhaustively enumerate the SAME defect pattern in sibling files / secondary consumers that round-1 missed; adversarially verify',
  phases: [
    {
      title: 'Expand',
      detail:
        'neighbor finders sweep siblings + secondary consumers of each confirmed class to loop-until-dry',
    },
    {
      title: 'Verify',
      detail:
        'adversarial per-candidate verification (refute-by-default, dedup vs F01-F78 AND vs round-1 CE01-CE19)',
    },
    { title: 'Synthesize', detail: 'dedup + rank confirmed NEW neighbors' },
  ],
};

const FINDINGS_PATH = (args && args.findingsPath) || 'ops/refactor/ULTRACODE_FINDINGS_20260702.md';
const R1_PATH = (args && args.round1Path) || 'ops/refactor/ULTRACODE_EXPANSION_ROUND1_CLAUDE.md';
const SEED = (args && args.seed) || [];
const SEED_STR = SEED.map((s) => `  ${s.id} [${s.class}] ${s.file}:${s.line} — ${s.title}`).join(
  '\n',
);

const DEDUP_BLOCK = `
=== DEDUP: two sources of truth ===
1. ${FINDINGS_PATH} — the original F01-F78 (grep '^## F').
2. ${R1_PATH} — round-1 confirmed CE01-CE19 (grep '^## CE'). These are the SEEDS below; DO NOT re-report a seed itself.
A candidate is NOVEL only if it is a DIFFERENT (file, root-cause) than every F-entry AND every CE-seed.
You are hunting the NEIGHBORS of the seeds: the SAME defect pattern in OTHER files, or a SECONDARY
consumer / sibling query / derived-gate that shares the seed's failure but at a different line.

=== ROUND-1 CONFIRMED SEEDS (CE01-CE19) — find their neighbors, do not repeat them ===
${SEED_STR}
`;

const COMMON = `
You are a read-only reconnaissance agent for careviax (Next.js 16 App Router, React 19 + React Compiler,
Prisma 7 + Postgres RLS, TZ=Asia/Tokyo runtime). Use Read/Grep/Glob/Bash read-only. Do NOT edit files.
Ground EVERY claim in exact file:line you actually read. Medical false-negatives (missing safety alert,
error rendered as 0/なし, wrong drug/patient, mis-windowed medical/billing data) are highest harm.
Only report defects you would stake credibility on; establish reachability, non-intentionality, and novelty.
${DEDUP_BLOCK}
`;

const CAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          bugClass: { type: 'string' },
          neighborOf: { type: 'string', description: 'which CE seed this is a neighbor of' },
          evidence: { type: 'string' },
          failureScenario: { type: 'string' },
          suggestedFix: { type: 'string' },
          reachability: { type: 'string' },
          intentionalCheck: { type: 'string' },
          notDuplicateReason: { type: 'string' },
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
    isDuplicate: { type: 'boolean' },
    dedupOf: { type: 'string' },
    reason: { type: 'string' },
    correctedTitle: { type: 'string' },
    classification: { type: 'string', enum: ['fix', 'flag'] },
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

const FINDERS = [
  {
    key: 'tz-neighbors',
    prompt: `NEIGHBORS OF the tz-date-boundary seeds (CE03 cockpit carryover, CE07 workflow overdueRequests, CE08 @db.Date end_date write, CE10 care-reports conference month, CE15 staff-metrics parseMonthRange, CE16 conference recurrence getUTC). EXHAUSTIVELY enumerate EVERY remaining place that: (a) uses new Date()+setHours(0,0,0,0) / getMonth()/getFullYear()/getDate()/startOfDay to build a window against an instant DateTime column; (b) writes a local-time Date into a @db.Date column instead of the UTC-midnight sentinel; (c) derives weekday/BYDAY/week-of-month from a raw timestamp. AREA: all of 'src/app/api/**/route.ts', 'src/server/services/**', 'src/server/jobs/**'. Grep setHours/getMonth/getFullYear/getDate/getUTCDay/getUTCDate/startOfDay and inspect each. Skip anything already covered by F01-F78, F60-F66, or CE03/07/08/10/15/16. This is a loop-until-dry sweep — list ALL remaining real ones.`,
    effort: 'high',
  },
  {
    key: 'falseempty-neighbors',
    prompt: `NEIGHBORS OF the false-empty seeds (CE01 PCA-pump inspection query + derived safety Set, CE02 visit-prep readiness). Hunt (a) OTHER admin/reports/visits/dispense screens with a useQuery whose isError is unread and whose empty state gates a SAFETY or BILLING decision; (b) SECONDARY CONSUMERS: any query whose .data feeds a derived Set/count/flag used as a gate (disable/exclude/complete), where a fetch error collapses the gate open (the CE01 pattern). AREA: 'src/app/(dashboard)/{admin,reports,visits,dispense,set,audit,billing}/**/*.tsx' and 'src/components/features/**/*.tsx'. EXCLUDE files in the covered list, F01-F78, and CE01/CE02. Prove the gate collapses on error by reading the derivation + its consumers.`,
  },
  {
    key: 'concurrency-neighbors',
    prompt: `NEIGHBORS OF the concurrency seeds (CE05 stock-requests decision id-only where, CE06 dispense-results version lock omitted from where). EXHAUSTIVELY find EVERY other write path that is check-then-act: reads a status/version/state then '.update({ where: { id } })' WITHOUT re-asserting the expected prior value in the where-clause, OR read-modify-write on a JSON array column without atomicity. AREA: 'src/app/api/**/route.ts' and 'src/server/services/**'. Grep for '.update(' and '.updateMany(' near a prior findUnique/findFirst; for status machines and version/optimistic-lock fields; for JSON spreads [...existing]. EXCLUDE F44/F48/F71 and CE05/CE06. Prove concurrency reachability.`,
  },
  {
    key: 'offline-neighbors',
    prompt: `NEIGHBORS OF the offline seeds (CE12 global reconnect never calls processSyncQueue, CE13 sync store never bootstrapped globally, CE14 enqueueForSync no scope_id dedup). Trace EVERY remaining offline queue/draft/store lifecycle in 'src/phos/api/**', 'src/lib/offline/**', 'src/lib/stores/**', 'src/lib/hooks/**' for: never-replayed queues, missing retry-reset/dead-letter, no-dedup enqueues, badges/counts never hydrated on some routes, merges that drop data. EXCLUDE F49/F52/F53/F54/F78, offlineEvidenceQueue/offlineActionQueue/crypto, and CE12/13/14. Name exactly where data is lost or a status is silently wrong.`,
  },
  {
    key: 'rls-neighbors',
    prompt: `NEIGHBOR OF CE04 (rls-policies.sql SSOT omits FORCE RLS for PatientSelfReport & CommunityActivity that migrations force). EXHAUSTIVELY diff EVERY org-scoped table: for each model in prisma/schema/**/*.prisma that has org_id, check whether prisma/rls-policies.sql enables+forces RLS for it AND whether every migration under prisma/migrations/** that FORCEs RLS is reflected in the SSOT (and vice-versa). List ALL drift, not just the 2 known tables. Also: org-scoped models whose app findMany/findFirst omit org_id in a path that may run outside withOrgContext. EXCLUDE CE04's two tables and F59. This is the DB-depth lens — be exhaustive and cite exact table names + file:line on both sides.`,
    effort: 'high',
  },
  {
    key: 'perf-dupe-neighbors',
    prompt: `NEIGHBORS OF the perf seeds (CE11 inventory-forecast loads all intakes for newest-per-patient, CE17 daily expiry job full-history scan) AND the dupe seed (CE18 trimStringOrUndefined has no SSOT, copied across 7+ handlers). (a) Find remaining unbounded findMany / load-all-to-use-newest-per-group / N+1-in-loop in 'src/server/**' and 'src/app/api/**' not in F34/F43/F45/F46/F52/F55/F70/F73/F74/F76/F77 or CE11/CE17. (b) Find remaining verbatim-duplicated normalizers/formatters/validators (grep trimStringOrUndefined, readString, formatYen, evaluatePasswordStrength, date-key helpers) with DRIFT, not in F32/F35/F41/F42/F72 or CE18. Quantify blast radius / show the drift.`,
  },
];

phase('Expand');
log(
  `round-2 neighbor expansion: ${FINDERS.length} finders over neighbors of ${SEED.length} confirmed seeds`,
);

const perFinder = await pipeline(
  FINDERS,
  (f) =>
    agent(
      `${COMMON}\n\n${f.prompt}\n\nReturn ALL high/medium-confidence NEW neighbors you can prove (this is a loop-until-dry enumeration; do not artificially cap, but do not pad with low-confidence guesses).`,
      {
        label: `expand:${f.key}`,
        phase: 'Expand',
        agentType: 'general-purpose',
        effort: f.effort || 'high',
        schema: CAND_SCHEMA,
      },
    ).then((r) => ({ finder: f.key, candidates: (r && r.candidates) || [] })),
  (found) => {
    if (!found || !found.candidates.length)
      return { finder: found ? found.finder : '?', verified: [] };
    return parallel(
      found.candidates.map(
        (c) => () =>
          agent(
            `${COMMON}\n\nADVERSARIAL VERIFICATION. REFUTE this neighbor candidate unless the code proves it real; default REFUTED if unsure. CANDIDATE:\n${JSON.stringify(c, null, 2)}\n\nBy reading files: (1) does the cited code say what is claimed? (2) reachable in prod? (3) intentional spec / mitigations I missed? -> REFUTE. (4) duplicate of F01-F78 or CE01-CE19 (same file+root-cause)? -> isDuplicate. (5) classification flag if auth/billing/security/destructive/PHI/danger-zone. (6) score safety/effect/verify/scope/efficiency 1-5.`,
            {
              label: `verify:${found.finder}:${c.file.split('/').pop()}`,
              phase: 'Verify',
              agentType: 'general-purpose',
              effort: 'high',
              schema: VERDICT_SCHEMA,
            },
          )
            .then((v) => ({ candidate: c, finder: found.finder, verdict: v }))
            .catch(() => null),
      ),
    ).then((verified) => ({ finder: found.finder, verified: verified.filter(Boolean) }));
  },
);

phase('Synthesize');
const all = perFinder.flatMap((pf) => (pf && pf.verified) || []);
const confirmed = all.filter(
  (x) => x && x.verdict && x.verdict.verdict === 'CONFIRMED' && !x.verdict.isDuplicate,
);
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
const refuted = all.filter((x) => x && x.verdict && x.verdict.verdict === 'REFUTED');
const duplicates = all.filter((x) => x && x.verdict && x.verdict.isDuplicate);
log(
  `r2 raw: ${all.length} | confirmed-novel-neighbors: ${confirmed.length} | dedup: ${deduped.length} | refuted: ${refuted.length} | dup: ${duplicates.length}`,
);

return {
  summary: {
    finders: FINDERS.length,
    rawCandidates: all.length,
    confirmedNovel: confirmed.length,
    afterDedup: deduped.length,
    refuted: refuted.length,
    duplicates: duplicates.length,
    byClass: deduped.reduce(
      (a, x) => ((a[x.candidate.bugClass] = (a[x.candidate.bugClass] || 0) + 1), a),
      {},
    ),
  },
  findings: deduped.map((x) => ({
    score: x.score,
    bugClass: x.candidate.bugClass,
    neighborOf: x.candidate.neighborOf || '',
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
};
