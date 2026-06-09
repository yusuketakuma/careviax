import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPhosApiGatewayLambdaTemplate } from './api-gateway-lambda-template';
import {
  PHOS_DYNAMODB_TABLE_CONTRACT,
  PHOS_DYNAMODB_TABLE_NAME_PARAMETER,
} from './dynamodb-table-contract';

function readBackendSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('PH-OS DynamoDB table contract', () => {
  it('defines the table, primary key, and all GSIs referenced by backend code', () => {
    expect(PHOS_DYNAMODB_TABLE_CONTRACT.table_name_parameter).toBe(
      PHOS_DYNAMODB_TABLE_NAME_PARAMETER,
    );
    expect(PHOS_DYNAMODB_TABLE_CONTRACT.primary_key).toEqual({
      partition_key: 'PK',
      sort_key: 'SK',
    });
    expect(PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes.GSI1).toMatchObject({
      partition_key: 'GSI1PK',
      sort_key: 'GSI1SK',
    });
    expect(PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes.GSI2).toMatchObject({
      partition_key: 'GSI2PK',
      sort_key: 'GSI2SK',
    });
    expect(PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes.GSI3).toMatchObject({
      partition_key: 'GSI3PK',
      sort_key: 'GSI3SK',
    });
    expect(PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes.GSI4).toMatchObject({
      partition_key: 'GSI4PK',
      sort_key: 'GSI4SK',
    });
    expect(PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes.GSI5).toMatchObject({
      partition_key: 'GSI5PK',
      sort_key: 'GSI5SK',
    });
    expect(PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes.GSI6).toMatchObject({
      partition_key: 'GSI6PK',
      sort_key: 'GSI6SK',
    });
    expect(PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes.GSI7).toMatchObject({
      partition_key: 'GSI7PK',
      sort_key: 'GSI7SK',
    });
    expect(PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes.GSI8).toMatchObject({
      partition_key: 'GSI8PK',
      sort_key: null,
    });
    expect(PHOS_DYNAMODB_TABLE_CONTRACT.ttl_attribute).toBe('ttl_epoch_seconds');

    const backendSources = [
      'src/phos/backend/dynamo-cards-repository.ts',
      'src/phos/backend/dynamo-claim-candidates-repository.ts',
      'src/phos/backend/claim-candidates-lambda.ts',
      'src/phos/backend/handoffs-lambda.ts',
      'src/phos/backend/report-deliveries-lambda.ts',
    ].map(readBackendSource);
    for (const indexName of [
      'GSI1',
      'GSI2',
      'GSI3',
      'GSI4',
      'GSI5',
      'GSI6',
      'GSI7',
      'GSI8',
    ] as const) {
      if (backendSources.some((source) => source.includes(indexName))) {
        expect(PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes).toHaveProperty(indexName);
      }
    }
  });

  it('keeps the API Gateway/Lambda template aligned with the table contract parameter', () => {
    const template = buildPhosApiGatewayLambdaTemplate();

    expect(template.Parameters).toHaveProperty(PHOS_DYNAMODB_TABLE_NAME_PARAMETER);
    expect(template.Parameters[PHOS_DYNAMODB_TABLE_NAME_PARAMETER]).toMatchObject({
      Default: 'phos_core',
      AllowedPattern: '^phos_core$',
    });
    expect(template.Resources.PhosCoreDynamoDbTable).toMatchObject({
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: { Ref: PHOS_DYNAMODB_TABLE_NAME_PARAMETER },
        BillingMode: PHOS_DYNAMODB_TABLE_CONTRACT.billing_mode,
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: expect.arrayContaining([
          expect.objectContaining({
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
          }),
          expect.objectContaining({
            IndexName: 'GSI2',
            KeySchema: [
              { AttributeName: 'GSI2PK', KeyType: 'HASH' },
              { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
            ],
          }),
          expect.objectContaining({
            IndexName: 'GSI3',
            KeySchema: [
              { AttributeName: 'GSI3PK', KeyType: 'HASH' },
              { AttributeName: 'GSI3SK', KeyType: 'RANGE' },
            ],
          }),
          expect.objectContaining({
            IndexName: 'GSI4',
            KeySchema: [
              { AttributeName: 'GSI4PK', KeyType: 'HASH' },
              { AttributeName: 'GSI4SK', KeyType: 'RANGE' },
            ],
          }),
          expect.objectContaining({
            IndexName: 'GSI5',
            KeySchema: [
              { AttributeName: 'GSI5PK', KeyType: 'HASH' },
              { AttributeName: 'GSI5SK', KeyType: 'RANGE' },
            ],
          }),
          expect.objectContaining({
            IndexName: 'GSI6',
            KeySchema: [
              { AttributeName: 'GSI6PK', KeyType: 'HASH' },
              { AttributeName: 'GSI6SK', KeyType: 'RANGE' },
            ],
          }),
          expect.objectContaining({
            IndexName: 'GSI7',
            KeySchema: [
              { AttributeName: 'GSI7PK', KeyType: 'HASH' },
              { AttributeName: 'GSI7SK', KeyType: 'RANGE' },
            ],
          }),
          expect.objectContaining({
            IndexName: 'GSI8',
            KeySchema: [{ AttributeName: 'GSI8PK', KeyType: 'HASH' }],
          }),
        ]),
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
        SSESpecification: {
          SSEEnabled: true,
        },
        TimeToLiveSpecification: {
          AttributeName: PHOS_DYNAMODB_TABLE_CONTRACT.ttl_attribute,
          Enabled: true,
        },
      },
    });
    expect(JSON.stringify(template)).toContain(
      `table/\${${PHOS_DYNAMODB_TABLE_NAME_PARAMETER}}/index/*`,
    );
  });

  it('keeps runtime queue projections off canonical card GSIs and forbids DynamoDB Scan', () => {
    const backendSources = [
      'src/phos/backend/dynamo-cards-repository.ts',
      'src/phos/backend/cards-lambda.ts',
      'src/phos/backend/dynamo-handoff-lifecycle-store.ts',
      'src/phos/backend/handoffs-lambda.ts',
      'src/phos/backend/dynamo-report-deliveries-repository.ts',
      'src/phos/backend/report-deliveries-lambda.ts',
      'src/phos/backend/dynamo-claim-candidates-repository.ts',
      'src/phos/backend/claim-candidates-lambda.ts',
      'src/phos/backend/dynamo-card-action-transaction-client.ts',
      'src/phos/backend/dynamo-handoff-transaction-client.ts',
      'src/phos/backend/dynamo-report-delivery-transaction-client.ts',
    ].map(readBackendSource);
    const combined = backendSources.join('\n');

    expect(combined).not.toMatch(/\bScanCommand\b|new\s+Scan\b|\.scan\s*\(/);
    expect(readBackendSource('src/phos/backend/dynamo-handoff-lifecycle-store.ts')).toContain(
      'PHOS_HANDOFF_QUEUE_GSI',
    );
    expect(readBackendSource('src/phos/backend/dynamo-report-deliveries-repository.ts')).toContain(
      'PHOS_REPORT_DELIVERY_STATUS_GSI',
    );
    expect(readBackendSource('src/phos/backend/dynamo-claim-candidates-repository.ts')).toContain(
      'PHOS_CLAIM_CANDIDATE_STATUS_GSI',
    );
    expect(readBackendSource('src/phos/backend/dynamo-claim-candidates-repository.ts')).toContain(
      'PHOS_CLAIM_CANDIDATE_CARD_GSI',
    );
  });
});
