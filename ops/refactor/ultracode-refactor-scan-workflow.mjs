export const meta = {
  name: 'ultracode-refactor-scan-20260702',
  description:
    'Full-codebase refactoring-candidate scan: duplication, oversized modules, missing SSOT helpers, FE/BE type drift, test-harness duplication, route boilerplate — adversarially verified, deduped against F01-F89/CE/N/X/CXR',
  phases: [
    {
      title: 'Scan',
      detail:
        '10 refactor lenses sweep FE/BE/DB/test surface for structural improvement candidates',
    },
    {
      title: 'Verify',
      detail:
        'adversarial verification: is the duplication/split real, behavior-preserving, worth the churn?',
    },
    { title: 'Synthesize', detail: 'dedup + rank by payoff/risk into a refactor backlog' },
  ],
};

const FINDINGS = 'ops/refactor/ULTRACODE_FINDINGS_20260702.md';
const MASTER = 'ops/refactor/ULTRACODE_EXPANSION_MASTER_TARGETS.md';

const COMMON = `
You are a read-only refactoring scout for careviax (Next.js 16 App Router, React 19 + React Compiler,
Prisma 7 + Postgres RLS, TZ=Asia/Tokyo, pnpm, Vitest, shadcn/ui). Use Read/Grep/Glob/Bash read-only.
Do NOT edit files. Ground every claim in exact file:line / wc -l / grep counts you actually ran.

GOAL: REFACTORING candidates (structure/duplication/maintainability), NOT bug hunting. A good candidate:
- has QUANTIFIED blast radius (N copies, M lines, K consumers — show the numbers),
- is BEHAVIOR-PRESERVING (or states exactly which tests lock behavior),
- names a CONCRETE target shape (extract to X, split by Y, reuse existing Z),
- respects repo idioms: React Compiler (no manual useMemo), view-model extraction precedent
  (drug-master-formulary-view-model.ts), DataTable errorMessage/onRetry, ErrorState, StateBadge/StatusDot
  tokens, japanDateKey/japanDayInstantRange helpers, src/lib/api/response.ts envelope, withOrgContext.

DEDUP: known findings live in ${FINDINGS} (F01-F89) and ${MASTER} (CE/N/X/CXR epics). Already-known
refactor-class items you must NOT re-report: F18/F25/F26/F40/F56 (dead code), F32 (readString dupes),
F35 (formatYen copies), F41 (facility-contacts route dupe), F42 (evaluatePasswordStrength copies),
F72 (contacts replace-with-version-guard triplicated), CE18 (trimStringOrUndefined), F30 (workflow
dashboard type drift), CXR2-PERF01. A NEW candidate must be a different (file-set, root-cause).
Report only candidates you would stake credibility on; prefer high-payoff/low-risk. Up to 8 each.
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
          kind: {
            type: 'string',
            description:
              'dup-helper | dup-component | dup-route-boilerplate | oversized-split | type-drift | test-harness-dup | dead-code | pattern-inconsistency | query-helper | other',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'all involved files (repo-relative)',
          },
          anchorFile: { type: 'string' },
          anchorLine: { type: 'integer' },
          evidence: {
            type: 'string',
            description:
              'quantified: N copies / M lines / K consumers, with file:line and any drift between copies',
          },
          proposal: {
            type: 'string',
            description: 'concrete target shape: extract to X / split along Y / adopt existing Z',
          },
          payoff: { type: 'string', description: 'what gets better, measurably' },
          risk: {
            type: 'string',
            description: 'what could break; which tests lock current behavior',
          },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: [
          'title',
          'kind',
          'files',
          'anchorFile',
          'anchorLine',
          'evidence',
          'proposal',
          'payoff',
          'risk',
          'effort',
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
    reason: {
      type: 'string',
      description:
        'what you independently re-verified (re-ran the greps/wc, re-read copies) or why refuted',
    },
    correctedTitle: { type: 'string' },
    scores: {
      type: 'object',
      additionalProperties: false,
      properties: {
        payoff: { type: 'integer', description: '1-5 maintainability/perf gain' },
        safety: {
          type: 'integer',
          description: '1-5 how behavior-preserving / well-locked by tests (5=safest)',
        },
        verify: { type: 'integer', description: '1-5 how mechanically verifiable' },
        scope: { type: 'integer', description: '1-5 how well-bounded (5=tight)' },
        priority: { type: 'integer', description: '1-5 how much it unblocks/reduces future work' },
      },
      required: ['payoff', 'safety', 'verify', 'scope', 'priority'],
    },
  },
  required: ['verdict', 'isDuplicate', 'reason', 'scores'],
};

const LENSES = [
  {
    key: 'fe-panel-boilerplate',
    prompt: `LENS: repeated FE panel boilerplate. The repo has ~328 dashboard screens; recent fail-close fixes stamped out many copies of the isLoading→isError(ErrorState+refetch)→empty→data ladder inline. Hunt for the biggest clusters of near-identical ladders / PanelBody-like wrappers / SummaryCard error-awareness ('—' on error) that could consolidate into a shared component or hook (e.g. useGuardedQueryPanel). Quantify: how many screens repeat the exact ladder, how many lines each. Also repeated FilterSummaryBar + query-error wiring. AREA: src/app/(dashboard)/**/*.tsx, src/components/features/**. Existing shared candidates to check first: external-viewer PanelBody, DataTable errorMessage/onRetry, ErrorState. Do NOT propose changing behavior — only consolidating identical patterns.`,
  },
  {
    key: 'be-route-boilerplate',
    prompt: `LENS: repeated API route boilerplate across 363 route.ts files. Hunt clusters of: (a) identical org-context + permission + zod-parse + envelope prologue that could be a withRoute() wrapper; (b) repeated cursor-pagination request parsing; (c) repeated from/to date parsing (also ties to F20's class); (d) repeated audit-log write shapes. Count exact copies with grep and read 3-4 representatives to show drift. AREA: src/app/api/**/route.ts. EXCLUDE the known facility-contacts whole-route dupe (F41). Propose the narrowest shared helper that covers the biggest cluster.`,
  },
  {
    key: 'oversized-split',
    prompt: `LENS: oversized modules needing split. Run wc -l over src/**/*.{ts,tsx} (exclude tests) and list the top ~15. For the top candidates (drug-master-content.tsx, card-workspace.tsx, handoff-workspace.tsx, prescription-intake-form.tsx, visit-record-form.tsx, prescription-intake-service.ts, cds/checker.ts likely among them) — propose CONCRETE split seams following the repo's own precedent: view-model extraction (drug-master-formulary-view-model.ts pattern), section-component extraction, or service submodule split. For each: current line count, proposed seams with line ranges, which existing tests lock behavior, what NOT to split (React Compiler / hooks constraints). Skip files already fully covered by pending findings.`,
  },
  {
    key: 'shared-helper-dupes',
    prompt: `LENS: duplicated small helpers lacking SSOT — beyond the known ones (trimStringOrUndefined CE18, readString F32, formatYen F35, evaluatePasswordStrength F42). Grep for repeated function names & near-identical implementations across src: date/time formatters (formatDate/formatDateTime/toLocaleDateString('ja-JP') inline copies), byte/size formatters, phone/postal normalizers, katakana/hiragana converters, fetch-json-with-error-throw helpers (readApiJson variants), buildXxxHeaders / orgScopedHeaders copies, classNames/cn variants, sleep/retry helpers. For each cluster: exact copy count, drift between copies (behavioral differences!), proposed SSOT location under src/lib. Behavioral drift between copies is the highest-value catch — show diffs.`,
  },
  {
    key: 'type-contract-drift',
    prompt: `LENS: FE/BE payload type drift (beyond F30 workflow-dashboard). Find hand-duplicated response/request types: FE files declaring type X = {...} that mirrors an API route's response shape instead of importing a shared type. Grep for duplicate type/interface names across src/app/(dashboard) vs src/app/api vs src/types vs src/server. For top clusters: show both declarations, any drift already present, and propose the shared home (src/types or colocated contract file). Also zod-schema vs TS-type double-maintenance where z.infer could replace a hand-written type.`,
  },
  {
    key: 'test-harness-dup',
    prompt: `LENS: test-harness duplication. Across *.test.tsx/*.test.ts, hunt repeated: stubFetch implementations, QueryClient+Provider wrappers, next/navigation mocks, session/org-context mocks, toast mocks, ResizeObserver/matchMedia shims. Count copies (grep for 'function stubFetch', 'new QueryClient', "vi.mock('next/navigation'", etc). Propose a shared src/test-utils (or tools/tests/helpers) with the 3-5 highest-copy fixtures. Note drift between copies (e.g. stubFetch handlers that differ subtly — that caused the handoff comments silent-bug precedent). Quantify total duplicated lines.`,
  },
  {
    key: 'dead-code-round2',
    prompt: `LENS: dead code beyond F18/F25/F26/F40/F56 (those files are already known — do not re-report soap-step-wizard, structured-soap-wizard, issue-timeline, care-trend-badges, schedule-day-view.sections, medication-format-grid, pull-to-refresh, intake-display, error-boundary, use-media-query, section-card, admin-adjacent-nav, field-lock-indicator, lib0). Sweep src/lib/**, src/server/**, src/components/** for: exported symbols with zero non-test importers, unused exports within multi-export modules, orphaned zod schemas, unused Prisma model helper wrappers, stale feature flags/constants, and package.json deps imported nowhere. Prove each with symbol-level grep, not just path grep.`,
  },
  {
    key: 'state-ui-consistency',
    prompt: `LENS: UI pattern inconsistency vs the repo's own SSOT. (a) status colors: places still hand-rolling badge colors instead of StateBadge/StatusDot tokens (SSOT docs/state-color-migration-map.md — report only NEW stragglers not already in that ledger). (b) inline <table> or hand-rolled lists where DataTable is the norm on data-dense admin screens. (c) hand-rolled loading text ('読み込み中...') where Skeleton is the guideline (docs/ui-ux-design-guidelines.md L460 precedent). (d) toast.error patterns bypassing the standard error envelope reader. Quantify each cluster; propose adopting the existing shared component (never invent new ones).`,
  },
  {
    key: 'prisma-query-helpers',
    prompt: `LENS: repeated Prisma query shapes that deserve helpers. (a) latest-per-group: count every 'orderBy created_at desc + take 1 in a loop' or 'findMany then keep newest per key' (beyond CE11/N23/CXR2-PERF01 which are perf findings — here look for the REMAINING copies to justify one shared latestPerGroup raw-SQL helper). (b) org-scoped pagination prologue (where org_id + cursor + take) copies. (c) japanDayInstantRange/japanMonthInstantRange call-sites that hand-roll the same gte/lt object — propose a where-builder. (d) audit-log create shapes. AREA: src/server/**, src/app/api/**. Quantify copies; name the helper signature.`,
  },
  {
    key: 'component-props-api',
    prompt: `LENS: shared component API inconsistencies creating per-screen adapters. Examine src/components/ui/** high-traffic components (DataTable, ErrorState, StateBadge, PageSection, FilterSummaryBar, WorkflowPageHeader, PatientHeader): find prop-shape inconsistencies forcing consumers to write repeated adapter code (e.g. errorMessage string vs error object, onRetry vs action.onClick, headingLevel handling), and consumers reimplementing what the component already offers (manual error rows above a DataTable that has errorMessage/onRetry built in). Quantify consumers per inconsistency. Propose minimal prop unification WITHOUT breaking existing test-locked contracts (institutions tests lock Button touch-target variants — do not touch those).`,
  },
];

phase('Scan');
log(
  `refactor scan: ${LENSES.length} lenses over the full codebase, adversarial verify, dedup vs F/CE/N/X/CXR`,
);

const perLens = await pipeline(
  LENSES,
  (l) =>
    agent(
      `${COMMON}\n\n${l.prompt}\n\nReturn your highest-value candidates (max 8; fewer is fine).`,
      {
        label: `scan:${l.key}`,
        phase: 'Scan',
        agentType: 'general-purpose',
        effort: 'high',
        schema: CAND_SCHEMA,
      },
    ).then((r) => ({ lens: l.key, candidates: (r && r.candidates) || [] })),
  (found) => {
    if (!found || !found.candidates.length) return { lens: found ? found.lens : '?', verified: [] };
    return parallel(
      found.candidates.map(
        (c) => () =>
          agent(
            `${COMMON}\n\nADVERSARIAL VERIFICATION of a refactor candidate. Default REFUTED unless you independently re-verify by re-running the greps/wc and re-reading the copies yourself. REFUTE if: the copies are not actually near-identical (list real differences), the "duplication" is intentional decoupling, the split would fight React Compiler / hooks rules, behavior is not test-locked and the refactor is risky, or it duplicates a known finding (set isDuplicate + dedupOf).\n\nCANDIDATE:\n${JSON.stringify(c, null, 2)}\n\nScore payoff/safety/verify/scope/priority 1-5.`,
            {
              label: `verify:${found.lens}:${(c.anchorFile || '').split('/').pop()}`,
              phase: 'Verify',
              agentType: 'general-purpose',
              effort: 'high',
              schema: VERDICT_SCHEMA,
            },
          )
            .then((v) => ({ candidate: c, lens: found.lens, verdict: v }))
            .catch(() => null),
      ),
    ).then((verified) => ({ lens: found.lens, verified: verified.filter(Boolean) }));
  },
);

phase('Synthesize');
const all = perLens.flatMap((p) => (p && p.verified) || []);
const confirmed = all.filter(
  (x) => x && x.verdict && x.verdict.verdict === 'CONFIRMED' && !x.verdict.isDuplicate,
);
const seen = new Map();
for (const x of confirmed) {
  const key = `${x.candidate.anchorFile}::${x.candidate.kind}::${(x.candidate.title || '').slice(0, 40)}`;
  const s = x.verdict.scores;
  const score = s.payoff + s.safety + s.verify + s.scope + s.priority;
  const prev = seen.get(key);
  if (!prev || score > prev.score) seen.set(key, { ...x, score });
}
const deduped = [...seen.values()].sort((a, b) => b.score - a.score);
const refuted = all.filter((x) => x && x.verdict && x.verdict.verdict === 'REFUTED');
const dups = all.filter((x) => x && x.verdict && x.verdict.isDuplicate);
log(
  `refactor scan: raw ${all.length} | confirmed ${confirmed.length} | deduped ${deduped.length} | refuted ${refuted.length} | dup-of-known ${dups.length}`,
);

return {
  summary: {
    lenses: LENSES.length,
    raw: all.length,
    confirmed: confirmed.length,
    afterDedup: deduped.length,
    refuted: refuted.length,
    duplicates: dups.length,
    byKind: deduped.reduce(
      (a, x) => ((a[x.candidate.kind] = (a[x.candidate.kind] || 0) + 1), a),
      {},
    ),
  },
  candidates: deduped.map((x) => ({
    score: x.score,
    lens: x.lens,
    kind: x.candidate.kind,
    title: x.verdict.correctedTitle || x.candidate.title,
    anchorFile: x.candidate.anchorFile,
    anchorLine: x.candidate.anchorLine,
    files: x.candidate.files,
    effort: x.candidate.effort,
    scores: x.verdict.scores,
    evidence: x.candidate.evidence,
    proposal: x.candidate.proposal,
    payoff: x.candidate.payoff,
    risk: x.candidate.risk,
    verifierReason: x.verdict.reason,
  })),
  duplicatesOfKnown: dups.map((x) => ({
    file: x.candidate.anchorFile,
    title: x.candidate.title,
    dedupOf: x.verdict.dedupOf,
  })),
};
