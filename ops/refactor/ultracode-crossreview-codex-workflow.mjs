export const meta = {
  name: 'ultracode-crossreview-codex-20260702',
  description:
    "Claude cross-reviews Codex's F79-F89 candidates from an independent angle: adversarial re-verification + neighbor expansion (no implementation)",
  phases: [
    {
      title: 'CrossReview',
      detail:
        'per Codex finding: independently re-verify (refute-by-default) + propose neighbor expansions',
    },
  ],
};

let A = args;
if (typeof A === 'string') {
  try {
    A = JSON.parse(A);
  } catch {
    A = {};
  }
}
A = A || {};
const FINDINGS_PATH = A.findingsPath || 'ops/refactor/ULTRACODE_FINDINGS_20260702.md';
const R1 = A.round1Path || 'ops/refactor/ULTRACODE_EXPANSION_ROUND1_CLAUDE.md';
const R2 = A.round2Path || 'ops/refactor/ULTRACODE_EXPANSION_ROUND2_CLAUDE.md';
// Bulletproof default so the run never spawns 0 agents if args plumbing drops the array.
const DEFAULT_IDS = [
  {
    id: 'F79',
    focus:
      'FormularyChangeRequest and FormularyTemplate missing RLS/FORCE/failsafe. Cross-confirm vs my N11 (FormularyTemplate). Independently grep prisma for both tables RLS. Expand: any OTHER drug-domain org-scoped table missing RLS.',
  },
  {
    id: 'F80',
    focus:
      'external-access POST gated by canReport not canManagePatientSharing; pharmacist_trainee can issue external grants. Verify permission-matrix.ts roles + route guard. Expand: other external-sharing / grant / token routes with the wrong permission gate.',
  },
  {
    id: 'F81',
    focus:
      'CDS checkInteractions/checkDuplicates silently skip current meds with drug_master_id null, no data-quality alert. Verify checker.ts. Expand: other CDS paths (allergy/contraindication) with same silent-skip on unresolved identity.',
  },
  {
    id: 'F82',
    focus:
      'PatientCondition/problem-list not passed into CDS contraindication checks. Verify cds/check route context. Expand: other structured patient data (renal function, pregnancy) absent from CDS input.',
  },
  {
    id: 'F83',
    focus:
      'formulary request create + approve/reject check-then-act race; index not unique. Cross-confirm vs my CE05. Expand: other create-if-not-exists guarded only by non-unique index.',
  },
  {
    id: 'F84',
    focus:
      'ConsentRecord active duplicate concurrency (findFirst outside tx, no partial unique). Verify. Expand: other active-row uniqueness assumed but not constrained (management-plans active version).',
  },
  {
    id: 'F85',
    focus:
      'PatientInsurance active coverage overlap not concurrency-protected. Verify insurance routes. Expand: other date-range-overlap validations done with findFirst-then-write.',
  },
  {
    id: 'F86',
    focus:
      'webhook one-time signing secret 201 response cacheable (no no-store). Verify response.ts vs sensitive-response.ts. Expand: other endpoints returning secrets/tokens/PHI without withSensitiveNoStore (presign URLs, OTP, share tokens).',
  },
  {
    id: 'F87',
    focus:
      'prescriber-institutions/suggestion accepts patient_id/case_id without access/consistency check (IDOR), only canReport. Verify vs external-professionals/suggestions stronger guard. Expand: other suggestion/lookup routes taking patient_id/case_id without access proof.',
  },
  {
    id: 'F88',
    focus:
      'care-reports patient_id filter overwritten by q match set via object-spread. Verify route.ts:622-692 spread order. Expand: other routes where a later where-object spread clobbers an earlier explicit patient_id/org_id filter.',
  },
  {
    id: 'F89',
    focus:
      'QR match + evidence capture patient-identity error gates. Verify qr-scan/page.tsx + capture-content.tsx. Expand: other patient-identity-critical flows that proceed on unresolved identity.',
  },
];
const IDS = Array.isArray(A.ids) && A.ids.length ? A.ids : DEFAULT_IDS;

const COMMON = `
You are Claude, a read-only reconnaissance agent for careviax (Next.js 16 App Router, React 19 + React
Compiler, Prisma 7 + Postgres RLS, TZ=Asia/Tokyo). Use Read/Grep/Glob/Bash read-only. Do NOT edit files.
This is a MUTUAL cross-review: Codex proposed a finding; you verify it from an INDEPENDENT angle and then
EXPAND it to neighbors Codex may have missed. Ground every claim in file:line you actually read.
Medical false-negatives (missing safety alert, wrong patient/drug, cross-tenant PHI, mis-windowed
medical/billing data) are highest harm. auth/billing/security/RLS/migration/PHI = classification=flag.

DEDUP: the existing findings are F01-F89 in ${FINDINGS_PATH} (grep '^## F'); Claude's own confirmed are
CE01-CE19 in ${R1} and N01-N33 in ${R2}. A neighbor is NOVEL only if different (file, root-cause) from all
of these. Do NOT restate the Codex finding itself as a neighbor.
`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    codexId: { type: 'string' },
    verdict: { type: 'string', enum: ['CONFIRMED', 'PARTIALLY_CONFIRMED', 'REFUTED'] },
    independentReason: {
      type: 'string',
      description:
        'what YOU re-verified by reading the cited code; agreements AND disagreements with Codex, cite file:line',
    },
    corrections: {
      type: 'string',
      description: 'any inaccuracy in the Codex evidence/scope/severity you found, or empty',
    },
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
    neighbors: {
      type: 'array',
      description: 'NEW novel neighbor defects this finding points to (may be empty)',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          bugClass: { type: 'string' },
          evidence: { type: 'string' },
          failureScenario: { type: 'string' },
          reachability: { type: 'string' },
          classification: { type: 'string', enum: ['fix', 'flag'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: [
          'title',
          'file',
          'line',
          'bugClass',
          'evidence',
          'failureScenario',
          'confidence',
        ],
      },
    },
  },
  required: ['codexId', 'verdict', 'independentReason', 'classification', 'scores', 'neighbors'],
};

phase('CrossReview');
log(`Claude cross-review of ${IDS.length} Codex findings (${IDS.map((x) => x.id).join(', ')})`);

const results = await parallel(
  IDS.map(
    (item) => () =>
      agent(
        `${COMMON}\n\nCROSS-REVIEW Codex finding ${item.id}. First run: \`grep -n -A18 "^## ${item.id} " ${FINDINGS_PATH}\` (or read that section) to load Codex's full claim. Hint on focus: ${item.focus}\n\nDo, by reading the actual code (not Codex's summary):\n1. Independently RE-VERIFY. Try to refute. State agreements and any disagreement/correction with file:line. Set verdict CONFIRMED / PARTIALLY_CONFIRMED / REFUTED and re-score safety/effect/verify/scope/efficiency 1-5.\n2. Check classification (flag if auth/billing/security/RLS/migration/PHI/danger-zone).\n3. EXPAND: find NEW novel neighbor defects this finding points to (same class in sibling files, secondary consumers, the same object-spread/permission/RLS/concurrency mistake elsewhere). Dedup vs F01-F89 / CE01-CE19 / N01-N33. Only high/medium-confidence, proven by reading code.`,
        {
          label: `xreview:${item.id}`,
          phase: 'CrossReview',
          agentType: 'general-purpose',
          effort: 'high',
          schema: SCHEMA,
        },
      )
        .then((r) => r)
        .catch(() => null),
  ),
);

const clean = results.filter(Boolean);
const neighbors = clean.flatMap((r) =>
  (r.neighbors || []).map((n) => ({ ...n, fromCodex: r.codexId })),
);
// dedup neighbors by file+class+title-prefix
const seen = new Map();
for (const n of neighbors) {
  const key = `${n.file}::${n.bugClass}::${(n.title || '').slice(0, 40)}`;
  if (!seen.has(key)) seen.set(key, n);
}
const dedupNeighbors = [...seen.values()];

return {
  summary: {
    reviewed: clean.length,
    confirmed: clean.filter((r) => r.verdict === 'CONFIRMED').length,
    partial: clean.filter((r) => r.verdict === 'PARTIALLY_CONFIRMED').length,
    refuted: clean.filter((r) => r.verdict === 'REFUTED').length,
    newNeighbors: dedupNeighbors.length,
  },
  reviews: clean.map((r) => ({
    codexId: r.codexId,
    verdict: r.verdict,
    classification: r.classification,
    scores: r.scores,
    independentReason: r.independentReason,
    corrections: r.corrections || '',
    neighborCount: (r.neighbors || []).length,
  })),
  newNeighbors: dedupNeighbors,
};
