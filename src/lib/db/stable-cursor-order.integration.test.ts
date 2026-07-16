import { describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

const databaseUrl = process.env.PAGINATION_ORDER_DATABASE_URL;
const isSafeLocalE2eDatabase =
  !databaseUrl ||
  /^postgresql:\/\/[^@/]+@(?:localhost|127\.0\.0\.1|\[::1\]):5433\/ph_os_e2e(?:\?|$)/.test(
    databaseUrl,
  );

if (!isSafeLocalE2eDatabase) {
  throw new Error(
    'PAGINATION_ORDER_DATABASE_URL must point to the local ph_os_e2e database on port 5433',
  );
}

const describeDatabase = databaseUrl ? describe : describe.skip;
const PAGE_LIMIT = 2;

type OrderedRow = {
  id: string;
  sort_key: Date;
};

type CursorPage = {
  ids: string[];
  hasMore: boolean;
  nextCursor: string | null;
};

type BillingOrderedRow = {
  id: string;
  total_count: string;
};

async function fetchPage(client: PoolClient, cursor: string | null): Promise<CursorPage> {
  const result = await client.query<OrderedRow>(
    `WITH rows(id, sort_key) AS (
       VALUES
         ('row_a', TIMESTAMPTZ '2026-07-15 00:00:00+00'),
         ('row_b', TIMESTAMPTZ '2026-07-15 00:00:00+00'),
         ('row_c', TIMESTAMPTZ '2026-07-15 00:00:00+00'),
         ('row_d', TIMESTAMPTZ '2026-07-15 00:00:00+00')
     ),
     cursor_row AS (
       SELECT sort_key, id
       FROM rows
       WHERE id = $1::text
     )
     SELECT rows.id, rows.sort_key
     FROM rows
     LEFT JOIN cursor_row ON true
     WHERE $1::text IS NULL
        OR (rows.sort_key, rows.id) < (cursor_row.sort_key, cursor_row.id)
     ORDER BY rows.sort_key DESC, rows.id DESC
     LIMIT $2`,
    [cursor, PAGE_LIMIT + 1],
  );
  const hasMore = result.rows.length > PAGE_LIMIT;
  const visibleRows = hasMore ? result.rows.slice(0, PAGE_LIMIT) : result.rows;

  return {
    ids: visibleRows.map((row) => row.id),
    hasMore,
    nextCursor: hasMore ? (visibleRows[visibleRows.length - 1]?.id ?? null) : null,
  };
}

async function fetchPartnerBillingPage(
  client: PoolClient,
  cursor: string | null,
): Promise<CursorPage & { totalCount: number }> {
  const result = await client.query<BillingOrderedRow>(
    `WITH rows AS (
       SELECT
         'candidate_' || lpad(series::text, 2, '0') AS id,
         DATE '2026-06-01' AS billing_month,
         TIMESTAMPTZ '2026-06-20 00:00:00+00' AS created_at,
         'partner_pharmacy_1'::text AS partner_pharmacy_id,
         'candidate'::text AS status
       FROM generate_series(1, 21) AS series
       UNION ALL
       SELECT
         'candidate_other_provider',
         DATE '2026-06-01',
         TIMESTAMPTZ '2026-06-20 00:00:00+00',
         'partner_pharmacy_2',
         'candidate'
     ),
     filtered AS (
       SELECT *
       FROM rows
       WHERE partner_pharmacy_id = $1::text
         AND status = $2::text
     ),
     cursor_row AS (
       SELECT billing_month, created_at, id
       FROM filtered
       WHERE id = $3::text
     )
     SELECT
       filtered.id,
       (SELECT count(*)::text FROM filtered) AS total_count
     FROM filtered
     LEFT JOIN cursor_row ON true
     WHERE $3::text IS NULL
        OR (filtered.billing_month, filtered.created_at, filtered.id)
           < (cursor_row.billing_month, cursor_row.created_at, cursor_row.id)
     ORDER BY filtered.billing_month DESC, filtered.created_at DESC, filtered.id DESC
     LIMIT $4`,
    ['partner_pharmacy_1', 'candidate', cursor, 21],
  );
  const hasMore = result.rows.length > 20;
  const visibleRows = hasMore ? result.rows.slice(0, 20) : result.rows;

  return {
    ids: visibleRows.map((row) => row.id),
    hasMore,
    nextCursor: hasMore ? (visibleRows[visibleRows.length - 1]?.id ?? null) : null,
    totalCount: Number(result.rows[0]?.total_count ?? 0),
  };
}

describeDatabase('stable cursor ordering (PAGINATION_ORDER_DATABASE_URL)', () => {
  it('returns equal-key rows exactly once across two limit-plus-one pages', async () => {
    expect(databaseUrl).toBeTruthy();
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 3_000,
    });

    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const readOnly = await client.query<{ transaction_read_only: string }>(
          'SHOW transaction_read_only',
        );
        expect(readOnly.rows[0]?.transaction_read_only).toBe('on');

        const firstPage = await fetchPage(client, null);
        const secondPage = await fetchPage(client, firstPage.nextCursor);
        const allIds = [...firstPage.ids, ...secondPage.ids];

        expect(firstPage).toEqual({
          ids: ['row_d', 'row_c'],
          hasMore: true,
          nextCursor: 'row_c',
        });
        expect(secondPage).toEqual({
          ids: ['row_b', 'row_a'],
          hasMore: false,
          nextCursor: null,
        });
        expect(new Set(allIds).size).toBe(allIds.length);
        expect(allIds).toEqual(['row_d', 'row_c', 'row_b', 'row_a']);
      } finally {
        try {
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.end();
    }
  });

  it('keeps a filtered partner-billing 20/21 cursor chain exact across equal keys', async () => {
    expect(databaseUrl).toBeTruthy();
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 3_000,
    });

    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const firstPage = await fetchPartnerBillingPage(client, null);
        const secondPage = await fetchPartnerBillingPage(client, firstPage.nextCursor);
        const allIds = [...firstPage.ids, ...secondPage.ids];

        expect(firstPage).toMatchObject({
          hasMore: true,
          nextCursor: 'candidate_02',
          totalCount: 21,
        });
        expect(firstPage.ids).toHaveLength(20);
        expect(secondPage).toEqual({
          ids: ['candidate_01'],
          hasMore: false,
          nextCursor: null,
          totalCount: 21,
        });
        expect(new Set(allIds).size).toBe(21);
        expect(allIds).not.toContain('candidate_other_provider');
      } finally {
        try {
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.end();
    }
  });
});
