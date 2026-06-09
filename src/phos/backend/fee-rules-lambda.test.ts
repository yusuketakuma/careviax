import { describe, expect, it, vi } from 'vitest';
import type { QueryResultRow } from 'pg';
import { UserRole } from '@/phos/contracts/phos_contracts';
import {
  createFeeRuleSearchLambdaHandler,
  createFeeRulesRepository,
  feeRuleSearchHandler,
} from './fee-rules-lambda';
import type { AuroraFeeRulesClient } from './aurora-fee-rules-repository';

function event() {
  return {
    routeKey: 'GET /fee-rules',
    headers: {
      'x-request-id': 'req_1',
    },
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: 'user_1',
            token_use: 'access',
            tenant_id: 'tenant_abc123',
            role: UserRole.PHARMACIST,
            scope: 'phos/fee-rules.read',
          },
        },
      },
    },
    queryStringParameters: { fee_code: 'M001', limit: '1' },
  };
}

function eventWithTenantQuery() {
  return {
    ...event(),
    queryStringParameters: { fee_code: 'M001', limit: '1', tenant_id: 'tenant_other' },
  };
}

function eventWithQuery(queryStringParameters: Record<string, string>) {
  return {
    ...event(),
    queryStringParameters,
  };
}

function auroraPool(rows: QueryResultRow[] = []) {
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

function parseJsonResponse(response: { statusCode?: number; body?: string }) {
  expect(response.statusCode).toBe(200);
  expect(response.body).toBeTypeOf('string');
  return JSON.parse(response.body ?? '{}') as unknown;
}

describe('fee-rules lambda composition', () => {
  it('wires GET /fee-rules through tenant context into the Aurora/RLS repository', async () => {
    const { pool, query } = auroraPool([
      {
        rule_id: 'rule_1',
        rule_version_id: 'rv_1',
        fee_code: 'M001',
        fee_label: '在宅患者訪問薬剤管理指導料',
        tenant_scope: 'SYSTEM',
        revision_code: '2026',
        active_from: '2026-04-01',
        active_to: null,
        condition: { op: 'EXISTS', field: 'visit_record_id' },
        evidence_requirements: [],
        source_refs: [],
      },
    ]);
    const handler = createFeeRuleSearchLambdaHandler({
      auroraPool: pool,
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });

    expect(parseJsonResponse(await handler(event()))).toMatchObject({
      items: [
        {
          rule_id: 'rule_1',
          fee_code: 'M001',
          tenant_scope: 'SYSTEM',
        },
      ],
      server_time: '2026-06-09T00:00:00.000Z',
    });

    expect(query).toHaveBeenCalledWith("SELECT set_config('app.tenant_id', $1, true)", [
      'tenant_abc123',
    ]);
  });

  it('does not retain an empty default repository when Aurora configuration is missing', () => {
    const previousAuroraUrl = process.env.PHOS_AURORA_DATABASE_URL;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.PHOS_AURORA_DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      expect(() => createFeeRulesRepository()).toThrow(
        'PH-OS FeeRule Aurora database URL is not configured',
      );
    } finally {
      if (previousAuroraUrl === undefined) {
        delete process.env.PHOS_AURORA_DATABASE_URL;
      } else {
        process.env.PHOS_AURORA_DATABASE_URL = previousAuroraUrl;
      }
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it('does not fall back to generic DATABASE_URL for the PH-OS FeeRule repository', () => {
    const previousAuroraUrl = process.env.PHOS_AURORA_DATABASE_URL;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.PHOS_AURORA_DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://legacy-app-wide-credential';

    try {
      expect(() => createFeeRulesRepository()).toThrow(
        'PH-OS FeeRule Aurora database URL is not configured',
      );
    } finally {
      if (previousAuroraUrl === undefined) {
        delete process.env.PHOS_AURORA_DATABASE_URL;
      } else {
        process.env.PHOS_AURORA_DATABASE_URL = previousAuroraUrl;
      }
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it('rejects tenant_id query at the Lambda boundary before default Aurora configuration is read', async () => {
    const previousAuroraUrl = process.env.PHOS_AURORA_DATABASE_URL;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.PHOS_AURORA_DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const response = await feeRuleSearchHandler(eventWithTenantQuery());

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({
        error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
        details: { source: 'query' },
      });
    } finally {
      if (previousAuroraUrl === undefined) {
        delete process.env.PHOS_AURORA_DATABASE_URL;
      } else {
        process.env.PHOS_AURORA_DATABASE_URL = previousAuroraUrl;
      }
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it('rejects tenant_id supplied through query parameters before repository access', async () => {
    const { pool } = auroraPool();
    const handler = createFeeRuleSearchLambdaHandler({ auroraPool: pool });

    await expect(handler(eventWithTenantQuery())).resolves.toMatchObject({
      statusCode: 400,
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rejects malformed numeric limit before Aurora access', async () => {
    const { pool } = auroraPool();
    const handler = createFeeRuleSearchLambdaHandler({ auroraPool: pool });

    const response = await handler(eventWithQuery({ fee_code: 'M001', limit: '1x' }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'limit' },
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rejects malformed cursors before Aurora access', async () => {
    const { pool } = auroraPool();
    const handler = createFeeRuleSearchLambdaHandler({ auroraPool: pool });

    const response = await handler(eventWithQuery({ fee_code: 'M001', cursor: 'not-base64-json' }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'cursor' },
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
