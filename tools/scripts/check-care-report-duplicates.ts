import 'dotenv/config';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const USAGE = [
  'Usage: pnpm db:check-care-report-duplicates [--help]',
  'Read-only precheck for CareReport_org_visit_record_report_type_unique_idx.',
].join('\n');

export type CareReportDuplicateRow = {
  org_id: string;
  visit_record_id: string;
  report_type: string;
  duplicate_count: number;
  report_ids: string[];
};

export type CareReportDuplicateClient = {
  query<T extends object>(sql: string): Promise<{ rows: T[] }>;
};

type RawCareReportDuplicateRow = {
  org_id: string;
  visit_record_id: string;
  report_type: string;
  duplicate_count: number | string;
  report_ids: string[] | null;
};

export const CARE_REPORT_DUPLICATE_SQL = `
SELECT
  org_id,
  visit_record_id,
  report_type::text AS report_type,
  COUNT(*)::text AS duplicate_count,
  ARRAY_AGG(id ORDER BY created_at ASC, id ASC) AS report_ids
FROM "CareReport"
WHERE visit_record_id IS NOT NULL
GROUP BY org_id, visit_record_id, report_type
HAVING COUNT(*) > 1
ORDER BY org_id, visit_record_id, report_type
`;

function normalizeDuplicateRow(row: RawCareReportDuplicateRow): CareReportDuplicateRow {
  return {
    org_id: row.org_id,
    visit_record_id: row.visit_record_id,
    report_type: row.report_type,
    duplicate_count: Number(row.duplicate_count),
    report_ids: row.report_ids ?? [],
  };
}

export async function checkCareReportDuplicates(client: CareReportDuplicateClient) {
  const result = await client.query<RawCareReportDuplicateRow>(CARE_REPORT_DUPLICATE_SQL);
  const duplicates = result.rows.map(normalizeDuplicateRow);

  return {
    ok: duplicates.length === 0,
    duplicate_groups: duplicates.length,
    checked: ['care-report-org-visit-record-report-type-unique'],
    duplicates,
    message:
      duplicates.length === 0
        ? 'No duplicate CareReport rows found for org_id + visit_record_id + report_type'
        : 'Duplicate CareReport rows would block CareReport_org_visit_record_report_type_unique_idx',
  };
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }

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
    const result = await checkCareReportDuplicates(client);
    const serialized = JSON.stringify(result, null, result.ok ? 0 : 2);
    if (result.ok) {
      console.log(serialized);
    } else {
      console.error(serialized);
      process.exitCode = 1;
    }
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
