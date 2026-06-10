import { describe, expect, it, vi } from 'vitest';
import type { PhosLambdaResponse } from './error-response';
import type { PhosHttpEvent } from './lambda-handler';

function mockAwsClients() {
  vi.resetModules();
  const dynamoClient = vi.fn();
  const s3Client = vi.fn();
  const secretsClient = vi.fn();

  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: dynamoClient,
    GetItemCommand: class GetItemCommand {
      constructor(readonly input: unknown) {}
    },
    QueryCommand: class QueryCommand {
      constructor(readonly input: unknown) {}
    },
    TransactWriteItemsCommand: class TransactWriteItemsCommand {
      constructor(readonly input: unknown) {}
    },
  }));
  vi.doMock('@aws-sdk/client-s3', () => ({
    S3Client: s3Client,
    GetObjectCommand: class GetObjectCommand {
      constructor(readonly input: unknown) {}
    },
    HeadObjectCommand: class HeadObjectCommand {
      constructor(readonly input: unknown) {}
    },
    PutObjectTaggingCommand: class PutObjectTaggingCommand {
      constructor(readonly input: unknown) {}
    },
  }));
  vi.doMock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManagerClient: secretsClient,
    GetSecretValueCommand: class GetSecretValueCommand {
      constructor(readonly input: unknown) {}
    },
  }));

  return { dynamoClient, s3Client, secretsClient };
}

function event(routeKey: string, scope: string): PhosHttpEvent {
  return {
    routeKey,
    queryStringParameters: { tenant_id: 'tenant_other' },
    pathParameters: { card_id: 'card_1', packet_id: 'packet_1' },
    requestContext: {
      requestId: 'req_1',
      authorizer: {
        jwt: {
          claims: {
            token_use: 'access',
            tenant_id: 'tenant_abc123',
            role: 'PHARMACIST',
            sub: 'user_1',
            scope,
          },
        },
      },
    },
  };
}

describe('PH-OS Lambda exported handlers', () => {
  it('does not construct AWS SDK clients while importing multi-export Lambda modules', async () => {
    const { dynamoClient, s3Client, secretsClient } = mockAwsClients();

    await Promise.all([
      import('./capacity-lambda'),
      import('./cards-lambda'),
      import('./claim-candidates-lambda'),
      import('./evidence-lambda'),
      import('./fee-rules-lambda'),
      import('./handoffs-lambda'),
      import('./report-deliveries-lambda'),
      import('./visit-mode-lambda'),
    ]);

    expect(dynamoClient).not.toHaveBeenCalled();
    expect(s3Client).not.toHaveBeenCalled();
    expect(secretsClient).not.toHaveBeenCalled();
  });

  it.each([
    [
      'capacity',
      async () => (await import('./capacity-lambda')).capacityHandler,
      'GET /capacity',
      'phos/capacity.read',
    ],
    [
      'cards',
      async () => (await import('./cards-lambda')).cardSearchHandler,
      'GET /cards',
      'phos/cards.read',
    ],
    [
      'claim-candidates',
      async () => (await import('./claim-candidates-lambda')).claimCandidateSearchHandler,
      'GET /claim-candidates',
      'phos/claim-candidates.read',
    ],
    [
      'handoffs',
      async () => (await import('./handoffs-lambda')).handoffSearchHandler,
      'GET /handoffs',
      'phos/handoffs.read',
    ],
    [
      'report-deliveries',
      async () => (await import('./report-deliveries-lambda')).reportDeliverySearchHandler,
      'GET /report-deliveries',
      'phos/report-deliveries.read',
    ],
    [
      'visit-mode',
      async () => (await import('./visit-mode-lambda')).getVisitModeHandler,
      'GET /visit-packets/{packet_id}/visit-mode',
      'phos/visit-mode.read',
    ],
  ] as const)(
    'rejects tenant-boundary failures before constructing AWS SDK clients for %s',
    async (_name, loadHandler, routeKey, scope) => {
      const { dynamoClient, s3Client, secretsClient } = mockAwsClients();
      const handler = await loadHandler();

      const response = (await handler(event(routeKey, scope))) as PhosLambdaResponse;

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toMatchObject({
        error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
      });
      expect(dynamoClient).not.toHaveBeenCalled();
      expect(s3Client).not.toHaveBeenCalled();
      expect(secretsClient).not.toHaveBeenCalled();
    },
  );
});
