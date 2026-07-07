import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const USAGE = [
  'Usage: pnpm db:explain-care-report-index-candidates -- --org-id <org_id> [options]',
  '',
  'SELECT-only EXPLAIN (FORMAT JSON) capture for care-report index candidates.',
  '',
  'Options:',
  '  --org-id <id>              Required tenant id for tenant-scoped predicates',
  '  --patient-id <id>          Optional sample patient id (default: __sample_patient_id__)',
  '  --status <status>          Optional report/delivery status (default: draft)',
  '  --search-token <token>     Optional patient search token (default: sample)',
  '  --recipient-token <token>  Optional delivery recipient token (default: sample)',
  '  --limit <n>                Page limit used for list shapes (default: 41)',
  '  --json-output <path>       Write PHI-safe JSON artifact',
  '  --markdown-output <path>   Write PHI-safe Markdown artifact',
  '  --help                     Print this usage before DATABASE_URL is required',
].join('\n');

const DEFAULT_LIMIT = 41;
const DEFAULT_SAMPLE_PATIENT_ID = '__sample_patient_id__';
const DEFAULT_SEARCH_TOKEN = 'sample';
const DEFAULT_STATUS = 'draft';
const DEFAULT_RECIPIENT_TOKEN = 'sample';
const BEGIN_TRANSACTION_SQL = 'BEGIN';
const ROLLBACK_TRANSACTION_SQL = 'ROLLBACK';
const SET_RLS_CONTEXT_SQL = `
SELECT
  set_config('app.current_org_id', $1, true),
  set_config('app.rls_context_applied', 'true', true)
`;

const FORBIDDEN_SQL_PATTERN =
  /\b(ANALYZE|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|REINDEX|VACUUM|MERGE|LOCK|CALL|DO|COPY|GRANT|REVOKE)\b/i;
const OPTION_VALUE_NAMES = new Set([
  '--org-id',
  '--patient-id',
  '--status',
  '--search-token',
  '--recipient-token',
  '--limit',
  '--json-output',
  '--markdown-output',
]);
const FLAG_NAMES = new Set(['--help']);

export type CareReportExplainClient = {
  query<T extends object>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type CareReportExplainQueryId =
  | 'care-report-palette-patient-candidates'
  | 'care-report-default-list'
  | 'care-report-patient-list'
  | 'care-report-query-patient-list'
  | 'care-report-status-list'
  | 'care-report-cursor-page'
  | 'care-report-keyword-bounded-scan'
  | 'care-report-patient-search-candidates'
  | 'care-report-delivery-filter'
  | 'delivery-records-for-report-page'
  | 'patient-hydration-for-report-page'
  | 'care-report-assigned-scope-list';

export type CareReportExplainQuery = {
  id: CareReportExplainQueryId;
  description: string;
  sql: string;
  params: unknown[];
  parameter_keys: string[];
  index_candidates: string[];
};

export type CareReportExplainOptions = {
  orgId: string;
  patientId?: string;
  status?: string;
  searchToken?: string;
  recipientToken?: string;
  limit?: number;
};

export type CareReportExplainCliOptions = CareReportExplainOptions & {
  jsonOutput: string | null;
  markdownOutput: string | null;
};

export type PlanNodeSummary = {
  node_type: string | null;
  relation_name: string | null;
  index_name: string | null;
  scan_direction: string | null;
  startup_cost: number | null;
  total_cost: number | null;
  plan_rows: number | null;
  plan_width: number | null;
  children: PlanNodeSummary[];
};

export type CareReportExplainResult = {
  ok: boolean;
  checked: CareReportExplainQueryId[];
  generated_at: string;
  explain_mode: 'EXPLAIN_FORMAT_JSON';
  safety: {
    sql_policy: 'SELECT_ONLY_EXPLAIN_NO_ANALYZE';
    values_redacted: true;
    migration_or_ddl_executed: false;
  };
  queries: Array<{
    id: CareReportExplainQueryId;
    description: string;
    parameter_keys: string[];
    index_candidates: string[];
    plan: {
      node_type: string | null;
      startup_cost: number | null;
      total_cost: number | null;
      plan_rows: number | null;
      root: PlanNodeSummary | null;
    };
  }>;
};

type ExplainJsonRow = {
  'QUERY PLAN': unknown;
};

function requiredOption(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function optionalOption(args: string[], name: string): string | null {
  return requiredOption(args, name);
}

function parseLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error('--limit must be an integer between 1 and 200');
  }
  return parsed;
}

function validateKnownArgs(args: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    if (FLAG_NAMES.has(arg)) continue;
    if (!OPTION_VALUE_NAMES.has(arg)) throw new Error(`Unknown option: ${arg}`);

    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    index += 1;
  }
}

function explain(sql: string): string {
  return `EXPLAIN (FORMAT JSON)\n${sql.trim()}`;
}

export function assertSelectOnlyExplainSql(sql: string) {
  const normalized = sql.trim().replace(/\s+/g, ' ');
  if (!/^EXPLAIN\s+\(FORMAT\s+JSON\)\s+SELECT\b/i.test(normalized)) {
    throw new Error('Only EXPLAIN (FORMAT JSON) SELECT statements are allowed');
  }
  if (normalized.includes(';')) {
    throw new Error('Multiple SQL statements are not allowed');
  }
  if (FORBIDDEN_SQL_PATTERN.test(normalized)) {
    throw new Error('DDL/DML/ANALYZE statements are not allowed in care-report EXPLAIN capture');
  }
}

export function buildCareReportExplainQueries(
  options: CareReportExplainOptions,
): CareReportExplainQuery[] {
  const patientId = options.patientId ?? DEFAULT_SAMPLE_PATIENT_ID;
  const status = options.status ?? DEFAULT_STATUS;
  const searchPattern = `%${options.searchToken ?? DEFAULT_SEARCH_TOKEN}%`;
  const recipientPattern = `%${options.recipientToken ?? DEFAULT_RECIPIENT_TOKEN}%`;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const reportIds = ['__sample_report_id_1__', '__sample_report_id_2__'];
  const patientIds = [patientId, '__sample_patient_id_2__'];
  const caseIds = ['__sample_case_id_1__', '__sample_case_id_2__'];
  const cursorCreatedAt = '2026-02-01T00:00:00.000Z';
  const cursorId = '__sample_cursor_report_id__';
  const sentFrom = '2026-01-01T00:00:00.000Z';
  const sentTo = '2026-02-01T00:00:00.000Z';

  return [
    {
      id: 'care-report-palette-patient-candidates',
      description:
        'Palette q= patient candidate search without non-palette ordering, matching the palette path.',
      sql: explain(`
SELECT p.id, p.name
FROM "Patient" AS p
WHERE p.org_id = $1
  AND (p.name ILIKE $2 OR p.name_kana ILIKE $2)
LIMIT $3
`),
      params: [options.orgId, searchPattern, 9],
      parameter_keys: ['org_id', 'search_pattern', 'palette_limit_plus_one'],
      index_candidates: [
        'pg_trgm GIN on Patient.name / Patient.name_kana after EXPLAIN review',
        'Patient(org_id) remains the tenant-leading fallback',
      ],
    },
    {
      id: 'care-report-default-list',
      description: 'Default tenant-scoped care-report list ordered by created_at DESC, id DESC.',
      sql: explain(`
SELECT cr.id, cr.org_id, cr.patient_id, cr.status, cr.created_at, cr.updated_at
FROM "CareReport" AS cr
WHERE cr.org_id = $1
ORDER BY cr.created_at DESC, cr.id DESC
LIMIT $2
`),
      params: [options.orgId, limit],
      parameter_keys: ['org_id', 'limit'],
      index_candidates: ['CareReport(org_id, created_at DESC, id DESC)'],
    },
    {
      id: 'care-report-patient-list',
      description: 'Patient-scoped care-report list ordered by created_at DESC, id DESC.',
      sql: explain(`
SELECT cr.id, cr.org_id, cr.patient_id, cr.status, cr.created_at, cr.updated_at
FROM "CareReport" AS cr
WHERE cr.org_id = $1
  AND cr.patient_id = $2
ORDER BY cr.created_at DESC, cr.id DESC
LIMIT $3
`),
      params: [options.orgId, patientId, limit],
      parameter_keys: ['org_id', 'patient_id', 'limit'],
      index_candidates: ['CareReport(org_id, patient_id, created_at DESC, id DESC)'],
    },
    {
      id: 'care-report-query-patient-list',
      description: 'Care-report list after bounded q= patient candidate lookup.',
      sql: explain(`
SELECT cr.id, cr.org_id, cr.patient_id, cr.status, cr.created_at, cr.updated_at
FROM "CareReport" AS cr
WHERE cr.org_id = $1
  AND cr.patient_id = ANY($2::text[])
ORDER BY cr.created_at DESC, cr.id DESC
LIMIT $3
`),
      params: [options.orgId, patientIds, limit],
      parameter_keys: ['org_id', 'matched_patient_ids', 'limit'],
      index_candidates: ['CareReport(org_id, patient_id, created_at DESC, id DESC)'],
    },
    {
      id: 'care-report-status-list',
      description:
        'Status-filtered care-report list using current route ordering by created_at DESC, id DESC.',
      sql: explain(`
SELECT cr.id, cr.org_id, cr.patient_id, cr.status, cr.created_at, cr.updated_at
FROM "CareReport" AS cr
WHERE cr.org_id = $1
  AND cr.status = $2::"ReportStatus"
ORDER BY cr.created_at DESC, cr.id DESC
LIMIT $3
`),
      params: [options.orgId, status, limit],
      parameter_keys: ['org_id', 'status', 'limit'],
      index_candidates: ['CareReport(org_id, status, created_at DESC, id DESC)'],
    },
    {
      id: 'care-report-cursor-page',
      description: 'Keyset cursor page after cursor report lookup.',
      sql: explain(`
SELECT cr.id, cr.org_id, cr.patient_id, cr.status, cr.created_at, cr.updated_at
FROM "CareReport" AS cr
WHERE cr.org_id = $1
  AND (cr.created_at < $2::timestamptz OR (cr.created_at = $2::timestamptz AND cr.id < $3))
ORDER BY cr.created_at DESC, cr.id DESC
LIMIT $4
`),
      params: [options.orgId, cursorCreatedAt, cursorId, limit],
      parameter_keys: ['org_id', 'cursor_created_at', 'cursor_id', 'limit'],
      index_candidates: ['CareReport(org_id, created_at DESC, id DESC)'],
    },
    {
      id: 'care-report-keyword-bounded-scan',
      description: 'Keyword search bounded scan window; content filtering remains app-layer.',
      sql: explain(`
SELECT cr.id, cr.org_id, cr.patient_id, cr.status, cr.created_at, cr.updated_at, cr.content
FROM "CareReport" AS cr
WHERE cr.org_id = $1
ORDER BY cr.created_at DESC, cr.id DESC
LIMIT 501
`),
      params: [options.orgId],
      parameter_keys: ['org_id'],
      index_candidates: ['CareReport(org_id, created_at DESC, id DESC)'],
    },
    {
      id: 'care-report-patient-search-candidates',
      description: 'Bounded patient candidate search for q= before care-report list filtering.',
      sql: explain(`
SELECT p.id
FROM "Patient" AS p
WHERE p.org_id = $1
  AND (p.name ILIKE $2 OR p.name_kana ILIKE $2)
ORDER BY p.name_kana ASC, p.name ASC, p.id ASC
LIMIT $3
`),
      params: [options.orgId, searchPattern, 101],
      parameter_keys: ['org_id', 'search_pattern', 'candidate_limit'],
      index_candidates: [
        'Patient(org_id, name_kana, name, id)',
        'pg_trgm GIN on Patient.name / Patient.name_kana after EXPLAIN review',
      ],
    },
    {
      id: 'care-report-delivery-filter',
      description:
        'Care-report list with delivery_records.some(status/sent_at/recipient) relation filter.',
      sql: explain(`
SELECT cr.id, cr.org_id, cr.patient_id, cr.status, cr.created_at, cr.updated_at
FROM "CareReport" AS cr
WHERE cr.org_id = $1
  AND EXISTS (
    SELECT 1
    FROM "DeliveryRecord" AS dr
    WHERE dr.report_id = cr.id
      AND dr.org_id = $1
      AND dr.status = $2::"ReportStatus"
      AND dr.sent_at >= $3::timestamptz
      AND dr.sent_at < $4::timestamptz
      AND dr.recipient_name ILIKE $5
  )
ORDER BY cr.created_at DESC, cr.id DESC
LIMIT $6
`),
      params: [options.orgId, status, sentFrom, sentTo, recipientPattern, limit],
      parameter_keys: [
        'org_id',
        'delivery_status',
        'sent_from',
        'sent_to',
        'recipient_pattern',
        'limit',
      ],
      index_candidates: [
        'DeliveryRecord(org_id, status, sent_at, report_id)',
        'DeliveryRecord(org_id, report_id, created_at DESC, id DESC)',
        'CareReport(org_id, created_at DESC, id DESC)',
      ],
    },
    {
      id: 'delivery-records-for-report-page',
      description: 'Relation-style latest delivery records per already selected report id.',
      sql: explain(`
SELECT ranked.report_id, ranked.status, ranked.sent_at, ranked.created_at, ranked.id
FROM (
  SELECT
    dr.report_id,
    dr.status,
    dr.sent_at,
    dr.created_at,
    dr.id,
    row_number() OVER (
      PARTITION BY dr.report_id
      ORDER BY dr.created_at DESC, dr.id DESC
    ) AS rn
  FROM "DeliveryRecord" AS dr
  WHERE dr.org_id = $1
    AND dr.report_id = ANY($2::text[])
) AS ranked
WHERE ranked.rn <= $3
ORDER BY ranked.report_id ASC, ranked.created_at DESC, ranked.id DESC
`),
      params: [options.orgId, reportIds, 10],
      parameter_keys: ['org_id', 'report_ids', 'per_report_limit'],
      index_candidates: [
        'DeliveryRecord(org_id, report_id, created_at DESC, id DESC)',
        'DeliveryRecord(report_id, created_at DESC, id DESC) is not tenant-leading',
      ],
    },
    {
      id: 'patient-hydration-for-report-page',
      description: 'Patient name hydration for already selected care-report rows.',
      sql: explain(`
SELECT p.id, p.name, p.name_kana
FROM "Patient" AS p
WHERE p.org_id = $1
  AND p.id = ANY($2::text[])
`),
      params: [options.orgId, patientIds],
      parameter_keys: ['org_id', 'patient_ids'],
      index_candidates: ['Patient(id, org_id) unique constraint', 'Patient(org_id) fallback'],
    },
    {
      id: 'care-report-assigned-scope-list',
      description:
        'Assigned-role access scope variant: case_id IN (...) OR case-less patient_id IN (...).',
      sql: explain(`
SELECT cr.id, cr.org_id, cr.patient_id, cr.case_id, cr.status, cr.created_at, cr.updated_at
FROM "CareReport" AS cr
WHERE cr.org_id = $1
  AND (
    cr.case_id = ANY($2::text[])
    OR (cr.case_id IS NULL AND cr.patient_id = ANY($3::text[]))
  )
ORDER BY cr.created_at DESC, cr.id DESC
LIMIT $4
`),
      params: [options.orgId, caseIds, patientIds, limit],
      parameter_keys: ['org_id', 'assigned_case_ids', 'assigned_patient_ids', 'limit'],
      index_candidates: [
        'CareReport(org_id, case_id, created_at DESC, id DESC)',
        'CareReport(org_id, patient_id, created_at DESC, id DESC)',
      ],
    },
  ];
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function summarizePlanNode(node: unknown): PlanNodeSummary | null {
  if (!node || typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;
  const childPlans = Array.isArray(record.Plans) ? record.Plans : [];

  return {
    node_type: readString(record['Node Type']),
    relation_name: readString(record['Relation Name']),
    index_name: readString(record['Index Name']),
    scan_direction: readString(record['Scan Direction']),
    startup_cost: readNumber(record['Startup Cost']),
    total_cost: readNumber(record['Total Cost']),
    plan_rows: readNumber(record['Plan Rows']),
    plan_width: readNumber(record['Plan Width']),
    children: childPlans
      .map((child) => summarizePlanNode(child))
      .filter((child): child is PlanNodeSummary => child !== null),
  };
}

function summarizeExplainJson(rawPlan: unknown) {
  const firstPlan = Array.isArray(rawPlan) ? rawPlan[0] : null;
  const plan = firstPlan && typeof firstPlan === 'object' ? firstPlan : null;
  const root = summarizePlanNode((plan as Record<string, unknown> | null)?.Plan);

  return {
    node_type: root?.node_type ?? null,
    startup_cost: root?.startup_cost ?? null,
    total_cost: root?.total_cost ?? null,
    plan_rows: root?.plan_rows ?? null,
    root,
  };
}

export async function runCareReportIndexExplain(
  client: CareReportExplainClient,
  options: CareReportExplainOptions,
): Promise<CareReportExplainResult> {
  const queries = buildCareReportExplainQueries(options);
  const results: CareReportExplainResult['queries'] = [];

  await client.query(BEGIN_TRANSACTION_SQL);
  try {
    await client.query(SET_RLS_CONTEXT_SQL, [options.orgId]);

    for (const query of queries) {
      assertSelectOnlyExplainSql(query.sql);
      const result = await client.query<ExplainJsonRow>(query.sql, query.params);
      results.push({
        id: query.id,
        description: query.description,
        parameter_keys: query.parameter_keys,
        index_candidates: query.index_candidates,
        plan: summarizeExplainJson(result.rows[0]?.['QUERY PLAN'] ?? null),
      });
    }
  } finally {
    await client.query(ROLLBACK_TRANSACTION_SQL);
  }

  return {
    ok: true,
    checked: queries.map((query) => query.id),
    generated_at: new Date().toISOString(),
    explain_mode: 'EXPLAIN_FORMAT_JSON',
    safety: {
      sql_policy: 'SELECT_ONLY_EXPLAIN_NO_ANALYZE',
      values_redacted: true,
      migration_or_ddl_executed: false,
    },
    queries: results,
  };
}

export function renderCareReportExplainMarkdown(result: CareReportExplainResult): string {
  const lines = [
    '# Care-report index EXPLAIN artifact',
    '',
    `Generated at: ${result.generated_at}`,
    '',
    'Safety:',
    `- SQL policy: ${result.safety.sql_policy}`,
    `- Values redacted: ${result.safety.values_redacted ? 'yes' : 'no'}`,
    `- Migration or DDL executed: ${result.safety.migration_or_ddl_executed ? 'yes' : 'no'}`,
    '',
    '## Query shapes',
  ];

  for (const query of result.queries) {
    lines.push(
      '',
      `### ${query.id}`,
      '',
      query.description,
      '',
      `- Parameters: ${query.parameter_keys.join(', ')}`,
      `- Root node: ${query.plan.node_type ?? 'unknown'}`,
      `- Total cost: ${query.plan.total_cost ?? 'unknown'}`,
      `- Plan rows: ${query.plan.plan_rows ?? 'unknown'}`,
      '- Index candidates:',
      ...query.index_candidates.map((candidate) => `  - ${candidate}`),
    );
  }

  return `${lines.join('\n')}\n`;
}

export function resolveCareReportExplainArtifactPath(path: string): string {
  const resolved = resolve(process.cwd(), path);
  const allowedRoots = [
    resolve(process.cwd(), 'projects', 'careviax', 'reviews'),
    resolve(process.cwd(), 'artifacts'),
  ];
  const isAllowed = allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(`${root}${sep}`),
  );
  if (!isAllowed) {
    throw new Error(
      '--json-output and --markdown-output must stay under projects/careviax/reviews or artifacts',
    );
  }
  return resolved;
}

export function parseCareReportExplainArgs(args: string[]): CareReportExplainCliOptions {
  validateKnownArgs(args);
  const orgId = requiredOption(args, '--org-id');
  if (!orgId) throw new Error('--org-id is required');

  return {
    orgId,
    patientId: optionalOption(args, '--patient-id') ?? undefined,
    status: optionalOption(args, '--status') ?? undefined,
    searchToken: optionalOption(args, '--search-token') ?? undefined,
    recipientToken: optionalOption(args, '--recipient-token') ?? undefined,
    limit: parseLimit(optionalOption(args, '--limit')),
    jsonOutput: optionalOption(args, '--json-output'),
    markdownOutput: optionalOption(args, '--markdown-output'),
  };
}

function writeArtifact(path: string, contents: string) {
  const safePath = resolveCareReportExplainArtifactPath(path);
  mkdirSync(dirname(safePath), { recursive: true });
  writeFileSync(safePath, contents);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(USAGE);
    return;
  }

  const options = parseCareReportExplainArgs(args);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client({
    connectionString: databaseUrl,
    statement_timeout: 120_000,
    query_timeout: 120_000,
  });

  await client.connect();
  try {
    const result = await runCareReportIndexExplain(client, options);
    const json = JSON.stringify(result, null, 2);

    if (options.jsonOutput) writeArtifact(options.jsonOutput, `${json}\n`);
    if (options.markdownOutput) {
      writeArtifact(options.markdownOutput, renderCareReportExplainMarkdown(result));
    }

    console.log(json);
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        message:
          error instanceof Error && error.message.length > 0
            ? error.message
            : inspect(error, { depth: 2 }),
      }),
    );
    process.exit(1);
  });
}
