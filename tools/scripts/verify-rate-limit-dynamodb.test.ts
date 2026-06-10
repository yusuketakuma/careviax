import { describe, expect, it } from 'vitest';
import { verifyRateLimitDynamoDb } from './verify-rate-limit-dynamodb';

type DynamoCall = {
  target: string;
  body: Record<string, unknown>;
};

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    AWS_ACCESS_KEY_ID: 'AKIATEST',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
    AWS_REGION: 'ap-northeast-1',
    RATE_LIMIT_DDB_TABLE_NAME: 'ph-os-rate-limit',
    ...overrides,
  };
}

function createDynamoFetch(calls: DynamoCall[]): typeof fetch {
  return async (_input, init) => {
    const headers = init?.headers as Record<string, string>;
    const target = headers['X-Amz-Target']?.replace('DynamoDB_20120810.', '') ?? '';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ target, body });

    if (target === 'DescribeTable') {
      return Response.json({
        Table: {
          TableStatus: 'ACTIVE',
          KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
        },
      });
    }
    if (target === 'DescribeTimeToLive') {
      return Response.json({
        TimeToLiveDescription: {
          AttributeName: 'expires_at',
          TimeToLiveStatus: 'ENABLED',
        },
      });
    }
    return Response.json({ Attributes: {} });
  };
}

describe('verify-rate-limit-dynamodb', () => {
  it('checks table and TTL without writing by default', async () => {
    const calls: DynamoCall[] = [];

    const report = await verifyRateLimitDynamoDb({
      env: env(),
      fetch: createDynamoFetch(calls),
      now: Date.parse('2026-06-10T00:00:00.000Z'),
    });

    expect(report).toMatchObject({
      ok: true,
      tableName: 'ph-os-rate-limit',
      region: 'ap-northeast-1',
      ttl: 'expires_at',
      writePath: 'skipped',
      writeOptIn: 'RATE_LIMIT_DDB_VERIFY_WRITE',
    });
    expect(calls.map((call) => call.target)).toEqual(['DescribeTable', 'DescribeTimeToLive']);
  });

  it('writes and deletes the preflight key only with explicit opt-in', async () => {
    const calls: DynamoCall[] = [];

    const report = await verifyRateLimitDynamoDb({
      env: env({
        RATE_LIMIT_DDB_VERIFY_WRITE: '1',
        RATE_LIMIT_VERIFY_WRITE_KEY: '__custom_preflight__',
      }),
      fetch: createDynamoFetch(calls),
      now: Date.parse('2026-06-10T00:00:00.000Z'),
    });

    expect(report).toMatchObject({
      ok: true,
      writePath: 'verified',
    });
    expect(calls.map((call) => call.target)).toEqual([
      'DescribeTable',
      'DescribeTimeToLive',
      'UpdateItem',
      'DeleteItem',
    ]);
    expect(calls[2]?.body).toMatchObject({
      Key: { pk: { S: '__custom_preflight__' } },
    });
    expect(calls[3]?.body).toMatchObject({
      Key: { pk: { S: '__custom_preflight__' } },
    });
  });
});
