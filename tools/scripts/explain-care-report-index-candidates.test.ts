import { describe, expect, it, vi } from 'vitest';
import {
  assertSelectOnlyExplainSql,
  buildCareReportExplainQueries,
  parseCareReportExplainArgs,
  renderCareReportExplainMarkdown,
  resolveCareReportExplainArtifactPath,
  runCareReportIndexExplain,
} from './explain-care-report-index-candidates';

function mockExplainPlan(nodeType = 'Index Scan') {
  return [
    {
      Plan: {
        'Node Type': nodeType,
        'Relation Name': 'CareReport',
        'Index Name': 'CareReport_org_created_at_id_idx',
        'Startup Cost': 0.42,
        'Total Cost': 12.34,
        'Plan Rows': 40,
        'Plan Width': 128,
        Filter: "org_id = 'org_secret'::text",
        Plans: [
          {
            'Node Type': 'Index Scan',
            'Relation Name': 'DeliveryRecord',
            'Index Name': 'DeliveryRecord_org_report_created_idx',
            'Startup Cost': 0.12,
            'Total Cost': 3.45,
            'Plan Rows': 10,
            'Plan Width': 32,
            'Index Cond': "report_id = 'report_secret'::text",
          },
        ],
      },
      'Planning Time': 1.23,
    },
  ];
}

describe('explain-care-report-index-candidates', () => {
  it('builds only SELECT-only EXPLAIN query shapes for care-report read paths', () => {
    const queries = buildCareReportExplainQueries({
      orgId: 'org_secret',
      patientId: 'patient_secret',
      searchToken: '山田',
      recipientToken: '主治医',
      status: 'response_waiting',
      limit: 42,
    });

    expect(queries.map((query) => query.id)).toEqual([
      'care-report-palette-patient-candidates',
      'care-report-default-list',
      'care-report-patient-list',
      'care-report-query-patient-list',
      'care-report-status-list',
      'care-report-cursor-page',
      'care-report-keyword-bounded-scan',
      'care-report-patient-search-candidates',
      'care-report-delivery-filter',
      'delivery-records-for-report-page',
      'patient-hydration-for-report-page',
      'care-report-assigned-scope-list',
    ]);

    for (const query of queries) {
      expect(() => assertSelectOnlyExplainSql(query.sql)).not.toThrow();
      expect(query.sql).toMatch(/^EXPLAIN \(FORMAT JSON\)\nSELECT/);
      expect(query.sql).not.toMatch(
        /\b(ANALYZE|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|REINDEX|VACUUM)\b/i,
      );
      expect(query.parameter_keys).not.toHaveLength(0);
      expect(query.index_candidates).not.toHaveLength(0);
    }

    expect(
      queries.find((query) => query.id === 'care-report-status-list')?.index_candidates,
    ).toContain('CareReport(org_id, status, created_at DESC, id DESC)');
    expect(
      queries.find((query) => query.id === 'care-report-delivery-filter')?.index_candidates,
    ).toContain('DeliveryRecord(org_id, status, sent_at, report_id)');
    expect(queries.find((query) => query.id === 'care-report-cursor-page')?.sql).toContain(
      'cr.created_at < $2::timestamptz',
    );
    expect(queries.find((query) => query.id === 'care-report-assigned-scope-list')?.sql).toContain(
      'cr.case_id = ANY($2::text[])',
    );
  });

  it('rejects DDL, DML, ANALYZE, and multi-statement SQL', () => {
    expect(() =>
      assertSelectOnlyExplainSql('EXPLAIN (FORMAT JSON) CREATE INDEX x ON y (z)'),
    ).toThrow(/Only EXPLAIN|DDL\/DML|not allowed/i);
    expect(() => assertSelectOnlyExplainSql('EXPLAIN (FORMAT JSON) SELECT 1; SELECT 2')).toThrow(
      /Multiple SQL statements/,
    );
    expect(() => assertSelectOnlyExplainSql('EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1')).toThrow(
      /Only EXPLAIN|ANALYZE/i,
    );
    expect(() =>
      assertSelectOnlyExplainSql('EXPLAIN (FORMAT JSON) SELECT * FROM t DELETE'),
    ).toThrow(/DDL\/DML|not allowed/i);
  });

  it('runs all query shapes with a pg-like client and redacts parameter values from output', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ 'QUERY PLAN': mockExplainPlan() }] });

    const result = await runCareReportIndexExplain(
      { query },
      {
        orgId: 'org_secret',
        patientId: 'patient_secret',
        searchToken: '山田',
        recipientToken: '主治医',
        status: 'failed',
        limit: 41,
      },
    );

    expect(query).toHaveBeenCalledTimes(15);
    expect(query.mock.calls[0][0]).toBe('BEGIN');
    expect(String(query.mock.calls[1][0])).toContain("set_config('app.current_org_id'");
    expect(query.mock.calls[1][1]).toEqual(['org_secret']);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');

    const explainCalls = query.mock.calls.filter(([sql]) =>
      String(sql).startsWith('EXPLAIN (FORMAT JSON)'),
    );
    expect(explainCalls).toHaveLength(12);
    for (const [sql, params] of explainCalls) {
      expect(() => assertSelectOnlyExplainSql(String(sql))).not.toThrow();
      expect(params).toEqual(expect.any(Array));
    }

    expect(result).toMatchObject({
      ok: true,
      explain_mode: 'EXPLAIN_FORMAT_JSON',
      safety: {
        sql_policy: 'SELECT_ONLY_EXPLAIN_NO_ANALYZE',
        values_redacted: true,
        migration_or_ddl_executed: false,
      },
    });
    expect(result.queries).toHaveLength(12);
    expect(result.queries[0].plan.root).toMatchObject({
      node_type: 'Index Scan',
      relation_name: 'CareReport',
      index_name: 'CareReport_org_created_at_id_idx',
      children: [
        expect.objectContaining({
          relation_name: 'DeliveryRecord',
          index_name: 'DeliveryRecord_org_report_created_idx',
        }),
      ],
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('org_secret');
    expect(serialized).not.toContain('patient_secret');
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('主治医');
    expect(serialized).not.toContain('report_secret');
    expect(serialized).not.toContain('Filter');
    expect(serialized).not.toContain('Index Cond');
  });

  it('parses CLI options and constrains artifact paths to review/artifact directories', () => {
    expect(
      parseCareReportExplainArgs([
        '--org-id',
        'org_1',
        '--patient-id',
        'patient_1',
        '--status',
        'failed',
        '--search-token',
        'sample',
        '--recipient-token',
        'doctor',
        '--limit',
        '50',
        '--json-output',
        'projects/careviax/reviews/2026-07-08/care-report-index-explain.json',
        '--markdown-output',
        'artifacts/care-report-index-explain.md',
      ]),
    ).toMatchObject({
      orgId: 'org_1',
      patientId: 'patient_1',
      status: 'failed',
      searchToken: 'sample',
      recipientToken: 'doctor',
      limit: 50,
      jsonOutput: 'projects/careviax/reviews/2026-07-08/care-report-index-explain.json',
      markdownOutput: 'artifacts/care-report-index-explain.md',
    });

    expect(() => parseCareReportExplainArgs([])).toThrow(/--org-id is required/);
    expect(() => parseCareReportExplainArgs(['--org-id'])).toThrow(/--org-id requires a value/);
    expect(() => parseCareReportExplainArgs(['--org-id', 'org_1', '--unknown'])).toThrow(
      /Unknown option/,
    );
    expect(() => parseCareReportExplainArgs(['--org-id', 'org_1', '--limit', '0'])).toThrow(
      /--limit/,
    );

    expect(
      resolveCareReportExplainArtifactPath(
        'projects/careviax/reviews/2026-07-08/care-report-index-explain.json',
      ),
    ).toContain('/projects/careviax/reviews/2026-07-08/care-report-index-explain.json');
    expect(
      resolveCareReportExplainArtifactPath('artifacts/care-report-index-explain.md'),
    ).toContain('/artifacts/care-report-index-explain.md');
    expect(() =>
      resolveCareReportExplainArtifactPath('/tmp/care-report-index-explain.json'),
    ).toThrow(/projects\/careviax\/reviews or artifacts/);
  });

  it('renders a PHI-safe markdown artifact without SQL or parameter values', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ 'QUERY PLAN': mockExplainPlan('Seq Scan') }],
    });

    const result = await runCareReportIndexExplain({ query }, { orgId: 'org_secret' });
    const markdown = renderCareReportExplainMarkdown(result);

    expect(markdown).toContain('# Care-report index EXPLAIN artifact');
    expect(markdown).toContain('SQL policy: SELECT_ONLY_EXPLAIN_NO_ANALYZE');
    expect(markdown).toContain('care-report-default-list');
    expect(markdown).toContain('DeliveryRecord(org_id, report_id, created_at DESC, id DESC)');
    expect(markdown).not.toContain('org_secret');
    expect(markdown).not.toContain('SELECT ');
    expect(markdown).not.toContain('DATABASE_URL');
  });
});
