import { describe, expect, it, vi } from 'vitest';
import type { QueryResultRow } from 'pg';
import { UserRole } from '@/phos/contracts/phos_contracts';
import {
  AuroraFeeRulesRepository,
  DEFAULT_PHOS_AURORA_CONNECTION_TIMEOUT_MS,
  DEFAULT_PHOS_AURORA_IDLE_TIMEOUT_MS,
  DEFAULT_PHOS_AURORA_QUERY_TIMEOUT_MS,
  MAX_PHOS_AURORA_CONNECTION_TIMEOUT_MS,
  MAX_PHOS_AURORA_IDLE_TIMEOUT_MS,
  MAX_PHOS_AURORA_QUERY_TIMEOUT_MS,
  phosAuroraPoolConfig,
  type AuroraFeeRulesClient,
} from './aurora-fee-rules-repository';
import type { TenantContext } from './tenant-context';

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/fee-rules.read'],
};

function client(rows: QueryResultRow[] = []) {
  const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
    void params;
    if (sql.includes('SELECT') && sql.includes('phos_fee_rule_master')) {
      return { rows };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const pool: AuroraFeeRulesClient = {
    connect: vi.fn(async () => ({ query, release })),
  };
  return { pool, query, release };
}

describe('AuroraFeeRulesRepository', () => {
  it('builds bounded pg pool config for the default Aurora repository', () => {
    expect(phosAuroraPoolConfig('postgres://phos')).toEqual({
      connectionString: 'postgres://phos',
      max: 2,
      connectionTimeoutMillis: DEFAULT_PHOS_AURORA_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: DEFAULT_PHOS_AURORA_IDLE_TIMEOUT_MS,
      query_timeout: DEFAULT_PHOS_AURORA_QUERY_TIMEOUT_MS,
      statement_timeout: DEFAULT_PHOS_AURORA_QUERY_TIMEOUT_MS,
      idle_in_transaction_session_timeout: DEFAULT_PHOS_AURORA_QUERY_TIMEOUT_MS,
      allowExitOnIdle: true,
    });
  });

  it('normalizes Aurora timeout overrides without allowing unbounded values', () => {
    expect(
      phosAuroraPoolConfig('postgres://phos', {
        PHOS_AURORA_CONNECTION_TIMEOUT_MS: String(MAX_PHOS_AURORA_CONNECTION_TIMEOUT_MS + 1),
        PHOS_AURORA_QUERY_TIMEOUT_MS: String(MAX_PHOS_AURORA_QUERY_TIMEOUT_MS + 1),
        PHOS_AURORA_IDLE_TIMEOUT_MS: String(MAX_PHOS_AURORA_IDLE_TIMEOUT_MS + 1),
      }),
    ).toMatchObject({
      connectionTimeoutMillis: MAX_PHOS_AURORA_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: MAX_PHOS_AURORA_IDLE_TIMEOUT_MS,
      query_timeout: MAX_PHOS_AURORA_QUERY_TIMEOUT_MS,
      statement_timeout: MAX_PHOS_AURORA_QUERY_TIMEOUT_MS,
      idle_in_transaction_session_timeout: MAX_PHOS_AURORA_QUERY_TIMEOUT_MS,
    });

    expect(
      phosAuroraPoolConfig('postgres://phos', {
        PHOS_AURORA_CONNECTION_TIMEOUT_MS: '0',
        PHOS_AURORA_QUERY_TIMEOUT_MS: 'not-a-number',
        PHOS_AURORA_IDLE_TIMEOUT_MS: '-1',
      }),
    ).toMatchObject({
      connectionTimeoutMillis: DEFAULT_PHOS_AURORA_CONNECTION_TIMEOUT_MS,
      idleTimeoutMillis: DEFAULT_PHOS_AURORA_IDLE_TIMEOUT_MS,
      query_timeout: DEFAULT_PHOS_AURORA_QUERY_TIMEOUT_MS,
      statement_timeout: DEFAULT_PHOS_AURORA_QUERY_TIMEOUT_MS,
      idle_in_transaction_session_timeout: DEFAULT_PHOS_AURORA_QUERY_TIMEOUT_MS,
    });
  });

  it('sets transaction-local tenant context and keeps tenant WHERE predicates', async () => {
    const { pool, query, release } = client([
      {
        rule_id: 'rule_1',
        rule_version_id: 'rv_1',
        fee_code: 'M001',
        fee_label: '在宅患者訪問薬剤管理指導料',
        tenant_scope: 'SYSTEM',
        revision_code: '2026',
        active_from: '2026-04-01',
        active_to: null,
        condition: { op: 'EXISTS', field: ' visit_record_id ' },
        evidence_requirements: [
          {
            evidence_key: ' management_plan ',
            label: ' 管理計画 ',
            required: true,
            source_kind: ' CARE_PLAN ',
          },
        ],
        source_refs: [
          {
            kind: ' RULE_DOCUMENT ',
            ref_id: ' doc_1 ',
            label: ' 2026改定 ',
            uri: ' https://example.test/rule ',
            captured_at: ' 2026-04-01T00:00:00.000Z ',
          },
        ],
      },
    ]);
    const repository = new AuroraFeeRulesRepository(
      pool,
      () => new Date('2026-06-09T00:00:00.000Z'),
    );

    await expect(
      repository.searchFeeRules(ctx, { fee_code: 'M001', limit: 1 }),
    ).resolves.toMatchObject({
      items: [
        {
          rule_id: 'rule_1',
          rule_version_id: 'rv_1',
          fee_code: 'M001',
          fee_label: '在宅患者訪問薬剤管理指導料',
          tenant_scope: 'SYSTEM',
          revision_code: '2026',
          active_from: '2026-04-01',
          condition: { op: 'EXISTS', field: 'visit_record_id' },
          evidence_requirements: [
            {
              evidence_key: 'management_plan',
              label: '管理計画',
              required: true,
              source_kind: 'CARE_PLAN',
            },
          ],
          source_refs: [
            {
              kind: 'RULE_DOCUMENT',
              ref_id: 'doc_1',
              label: '2026改定',
              uri: 'https://example.test/rule',
              captured_at: '2026-04-01T00:00:00.000Z',
            },
          ],
        },
      ],
      server_time: '2026-06-09T00:00:00.000Z',
    });

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(2, "SELECT set_config('app.tenant_id', $1, true)", [
      'tenant_abc123',
    ]);
    const [sql, params] = query.mock.calls[2];
    expect(sql).toContain('FROM phos_fee_rule_master fr');
    expect(sql).toContain(
      "WHERE (fr.tenant_id = $1 OR (fr.tenant_scope = 'SYSTEM' AND fr.tenant_id = 'SYSTEM'))",
    );
    expect(sql).toContain('AND fr.fee_code = $2');
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual(['tenant_abc123', 'M001', 2]);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases the connection when a query fails', async () => {
    const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
      void params;
      if (sql.includes('phos_fee_rule_master')) throw new Error('database unavailable');
      return { rows: [] };
    });
    const release = vi.fn();
    const pool: AuroraFeeRulesClient = {
      connect: vi.fn(async () => ({ query, release })),
    };
    const repository = new AuroraFeeRulesRepository(pool);

    await expect(repository.searchFeeRules(ctx, { limit: 50 })).rejects.toThrow(
      'database unavailable',
    );

    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('logs a structured warning when rollback fails without hiding the original query error', async () => {
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queryError = new Error('database unavailable');
    const rollbackError = new Error('ROLLBACK failed for postgres://secret');
    const query = vi.fn(async (sql: string, params?: readonly unknown[]) => {
      void params;
      if (sql === 'ROLLBACK') throw rollbackError;
      if (sql.includes('phos_fee_rule_master')) throw queryError;
      return { rows: [] };
    });
    const release = vi.fn();
    const pool: AuroraFeeRulesClient = {
      connect: vi.fn(async () => ({ query, release })),
    };
    const repository = new AuroraFeeRulesRepository(pool);

    try {
      await expect(repository.searchFeeRules(ctx, { limit: 50 })).rejects.toBe(queryError);

      expect(query).toHaveBeenCalledWith('ROLLBACK');
      expect(release).toHaveBeenCalledTimes(1);
      expect(consoleErrorMock).toHaveBeenCalledTimes(1);
      const logLine = String(consoleErrorMock.mock.calls[0]?.[0]);
      const logEntry = JSON.parse(logLine) as Record<string, unknown>;
      expect(logEntry).toMatchObject({
        level: 'WARNING',
        message: 'PH-OS fee-rules transaction rollback failed',
        result: 'ERROR',
        request_id: 'req_1',
        correlation_id: 'corr_1',
        route_key: 'GET /fee-rules',
        error_code: 'AURORA_ROLLBACK_FAILED',
        details: { operation: 'searchFeeRules' },
      });
      expect(logLine).not.toContain(ctx.tenant_id);
      expect(logLine).not.toContain(ctx.user_id);
      expect(logLine).not.toContain('postgres://secret');
      expect(logLine).not.toContain('ROLLBACK failed');
    } finally {
      consoleErrorMock.mockRestore();
    }
  });

  it('returns an opaque cursor when more rows than the requested limit exist', async () => {
    const { pool } = client([
      {
        rule_id: 'rule_1',
        rule_version_id: 'rv_1',
        fee_code: 'M001',
        fee_label: 'fee 1',
        tenant_scope: 'SYSTEM',
        revision_code: '2026',
        active_from: '2026-04-01',
        active_to: null,
        condition: { op: 'AND', conditions: [] },
        evidence_requirements: [],
        source_refs: [],
      },
      {
        rule_id: 'rule_2',
        rule_version_id: 'rv_2',
        fee_code: 'M002',
        fee_label: 'fee 2',
        tenant_scope: 'SYSTEM',
        revision_code: '2026',
        active_from: '2026-04-01',
        active_to: null,
        condition: { op: 'AND', conditions: [] },
        evidence_requirements: [],
        source_refs: [],
      },
    ]);
    const repository = new AuroraFeeRulesRepository(pool);

    const response = await repository.searchFeeRules(ctx, { limit: 1 });

    expect(response.items).toHaveLength(1);
    expect(response.next_cursor).toBeTruthy();
    const cursor = JSON.parse(
      Buffer.from(response.next_cursor ?? '', 'base64url').toString('utf8'),
    ) as unknown;
    expect(cursor).toEqual({
      fee_code: 'M001',
      revision_code: '2026',
      rule_version_id: 'rv_1',
    });
  });

  it('uses keyset cursor predicates instead of offset pagination', async () => {
    const { pool, query } = client([]);
    const repository = new AuroraFeeRulesRepository(pool);
    const cursor = Buffer.from(
      JSON.stringify({
        fee_code: 'M001',
        revision_code: '2026',
        rule_version_id: 'rv_1',
      }),
      'utf8',
    ).toString('base64url');

    await repository.searchFeeRules(ctx, { limit: 50, cursor });

    const [sql, params] = query.mock.calls[2];
    expect(sql).toContain('fr.fee_code > $2');
    expect(sql).toContain('rv.revision_code < $3');
    expect(sql).toContain('rv.rule_version_id > $4');
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual(['tenant_abc123', 'M001', '2026', 'rv_1', 51]);
  });

  it('rejects cursors whose fee_code does not match the requested fee_code filter', async () => {
    const { pool } = client();
    const repository = new AuroraFeeRulesRepository(pool);
    const cursor = Buffer.from(
      JSON.stringify({
        fee_code: 'M001',
        revision_code: '2026',
        rule_version_id: 'rv_1',
      }),
      'utf8',
    ).toString('base64url');

    await expect(
      repository.searchFeeRules(ctx, { fee_code: 'M002', limit: 50, cursor }),
    ).rejects.toMatchObject({
      status: 400,
      error_code: 'VALIDATION_ERROR',
      details: { field: 'cursor' },
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rejects malformed cursors before opening an Aurora connection', async () => {
    const { pool } = client();
    const repository = new AuroraFeeRulesRepository(pool);

    await expect(
      repository.searchFeeRules(ctx, { limit: 50, cursor: 'not-base64-json' }),
    ).rejects.toMatchObject({
      status: 400,
      error_code: 'VALIDATION_ERROR',
      details: { field: 'cursor' },
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it.each([
    ['missing fee_code', { revision_code: '2026', rule_version_id: 'rv_1' }],
    ['missing revision_code', { fee_code: 'M001', rule_version_id: 'rv_1' }],
    ['missing rule_version_id', { fee_code: 'M001', revision_code: '2026' }],
    ['empty fee_code', { fee_code: '', revision_code: '2026', rule_version_id: 'rv_1' }],
  ])('rejects %s cursor payloads', async (_name, payload) => {
    const { pool } = client();
    const repository = new AuroraFeeRulesRepository(pool);
    const cursor = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    await expect(repository.searchFeeRules(ctx, { limit: 50, cursor })).rejects.toMatchObject({
      status: 400,
      error_code: 'VALIDATION_ERROR',
      details: { field: 'cursor' },
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rejects malformed rule DSL rows instead of returning unsafe rules', async () => {
    const { pool } = client([
      {
        rule_id: 'rule_bad',
        rule_version_id: 'rv_bad',
        fee_code: 'M999',
        fee_label: 'bad fee',
        tenant_scope: 'SYSTEM',
        revision_code: '2026',
        active_from: '2026-04-01',
        active_to: null,
        condition: { op: 'EVAL', expression: 'dangerous()' },
        evidence_requirements: [],
        source_refs: [],
      },
    ]);
    const repository = new AuroraFeeRulesRepository(pool);

    await expect(repository.searchFeeRules(ctx, { limit: 50 })).rejects.toThrow(
      'Invalid FeeRule condition operator',
    );
  });

  it('rejects FeeRule DSL rows that reference fields outside the PH-OS fact allowlist', async () => {
    const { pool } = client([
      {
        rule_id: 'rule_bad_field',
        rule_version_id: 'rv_bad_field',
        fee_code: 'M998',
        fee_label: 'bad field fee',
        tenant_scope: 'SYSTEM',
        revision_code: '2026',
        active_from: '2026-04-01',
        active_to: null,
        condition: { op: 'EQ', field: 'constructor.prototype.polluted', value: true },
        evidence_requirements: [],
        source_refs: [],
      },
    ]);
    const repository = new AuroraFeeRulesRepository(pool);

    await expect(repository.searchFeeRules(ctx, { limit: 50 })).rejects.toThrow(
      'Unknown FeeRule DSL field',
    );
  });

  it('rejects unsafe tenant ids before opening an Aurora connection', async () => {
    const { pool } = client();
    const repository = new AuroraFeeRulesRepository(pool);

    await expect(
      repository.searchFeeRules({ ...ctx, tenant_id: 'tenant_abc123;DROP' }, { limit: 50 }),
    ).rejects.toThrow('tenant_id contains unsafe characters');

    expect(pool.connect).not.toHaveBeenCalled();
  });
});
