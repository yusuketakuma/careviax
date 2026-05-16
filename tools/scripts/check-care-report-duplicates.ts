import 'dotenv/config';
import { Client } from 'pg';
import { inspect } from 'node:util';

type DuplicateRow = {
  org_id: string;
  visit_record_id: string;
  report_type: string;
  duplicate_count: string;
  report_ids: string[];
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const client = new Client({ connectionString });

async function main() {
  await client.connect();

  try {
    const result = await client.query<DuplicateRow>(`
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
    `);

    if (result.rows.length === 0) {
      console.log(
        JSON.stringify({
          ok: true,
          duplicate_groups: 0,
          message: 'No duplicate CareReport rows found for org_id + visit_record_id + report_type',
        }),
      );
      return;
    }

    console.error(
      JSON.stringify(
        {
          ok: false,
          duplicate_groups: result.rows.length,
          duplicates: result.rows.map((row) => ({
            org_id: row.org_id,
            visit_record_id: row.visit_record_id,
            report_type: row.report_type,
            duplicate_count: Number(row.duplicate_count),
            report_ids: row.report_ids,
          })),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

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
