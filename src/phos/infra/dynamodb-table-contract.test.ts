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
      sort_key: null,
    });

    const backendSources = [
      'src/phos/backend/dynamo-cards-repository.ts',
      'src/phos/backend/dynamo-claim-candidates-repository.ts',
      'src/phos/backend/claim-candidates-lambda.ts',
      'src/phos/backend/handoffs-lambda.ts',
      'src/phos/backend/report-deliveries-lambda.ts',
    ].map(readBackendSource);
    for (const indexName of ['GSI1', 'GSI2'] as const) {
      if (backendSources.some((source) => source.includes(indexName))) {
        expect(PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes).toHaveProperty(indexName);
      }
    }
  });

  it('keeps the API Gateway/Lambda template aligned with the table contract parameter', () => {
    const template = buildPhosApiGatewayLambdaTemplate();

    expect(template.Parameters).toHaveProperty(PHOS_DYNAMODB_TABLE_NAME_PARAMETER);
    expect(JSON.stringify(template)).toContain(
      `table/\${${PHOS_DYNAMODB_TABLE_NAME_PARAMETER}}/index/*`,
    );
  });
});
