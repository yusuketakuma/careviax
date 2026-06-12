import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

const USAGE = [
  'Usage: pnpm db:check-visit-route-order-conflicts [--help]',
  'Read-only precheck for active VisitSchedule and open VisitScheduleProposal route-order conflicts.',
].join('\n');

export type VisitRouteOrderConflictRow = {
  org_id: string;
  pharmacist_id: string;
  route_date: string;
  route_order: number;
  conflict_count: number;
  schedule_ids: string[];
  proposal_ids: string[];
};

export type VisitRouteOrderConflictClient = {
  query<T extends object>(sql: string): Promise<{ rows: T[] }>;
};

type RawVisitRouteOrderConflictRow = {
  org_id: string;
  pharmacist_id: string;
  route_date: string;
  route_order: number | string;
  conflict_count: number | string;
  schedule_ids: string[] | null;
  proposal_ids: string[] | null;
};

export const VISIT_ROUTE_ORDER_CONFLICT_SQL = `
WITH route_cells AS (
  SELECT
    org_id,
    pharmacist_id,
    scheduled_date AS route_date,
    route_order,
    id AS schedule_id,
    NULL::text AS proposal_id
  FROM "VisitSchedule"
  WHERE route_order IS NOT NULL
    AND schedule_status NOT IN ('cancelled', 'rescheduled')

  UNION ALL

  SELECT
    org_id,
    proposed_pharmacist_id AS pharmacist_id,
    proposed_date AS route_date,
    route_order,
    NULL::text AS schedule_id,
    id AS proposal_id
  FROM "VisitScheduleProposal"
  WHERE route_order IS NOT NULL
    AND finalized_schedule_id IS NULL
    AND proposal_status IN ('proposed', 'patient_contact_pending', 'reschedule_pending')
)
SELECT
  org_id,
  pharmacist_id,
  route_date::text AS route_date,
  route_order,
  COUNT(*)::int AS conflict_count,
  ARRAY_REMOVE(ARRAY_AGG(schedule_id ORDER BY schedule_id), NULL) AS schedule_ids,
  ARRAY_REMOVE(ARRAY_AGG(proposal_id ORDER BY proposal_id), NULL) AS proposal_ids
FROM route_cells
GROUP BY org_id, pharmacist_id, route_date, route_order
HAVING COUNT(*) > 1
ORDER BY org_id, pharmacist_id, route_date, route_order
`;

function normalizeConflictRow(row: RawVisitRouteOrderConflictRow): VisitRouteOrderConflictRow {
  return {
    org_id: row.org_id,
    pharmacist_id: row.pharmacist_id,
    route_date: row.route_date,
    route_order: Number(row.route_order),
    conflict_count: Number(row.conflict_count),
    schedule_ids: row.schedule_ids ?? [],
    proposal_ids: row.proposal_ids ?? [],
  };
}

export async function checkVisitRouteOrderConflicts(client: VisitRouteOrderConflictClient) {
  const result = await client.query<RawVisitRouteOrderConflictRow>(VISIT_ROUTE_ORDER_CONFLICT_SQL);
  const conflicts = result.rows.map(normalizeConflictRow);

  return {
    ok: conflicts.length === 0,
    conflict_groups: conflicts.length,
    checked: [
      'active-visit-schedule-route-order',
      'open-visit-schedule-proposal-route-order',
      'cross-table-visit-route-order',
    ],
    conflicts,
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
    const result = await checkVisitRouteOrderConflicts(client);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
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
