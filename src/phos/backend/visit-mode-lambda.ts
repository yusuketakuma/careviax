import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
  type DynamoDBClient as AwsDynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { createDynamoVisitModeRepository } from './dynamo-visit-mode-repository';
import type {
  DynamoVisitModeClient,
  DynamoVisitStepCommitTransaction,
} from './dynamo-visit-mode-repository';
import { dynamoKey, toDynamoAttributeValue } from './dynamodb-attribute-values';
import { createVisitModeLifecycleRepository } from './visit-mode-lifecycle-repository';
import { createGetVisitModeHandler, createUpdateVisitStepHandler } from './visit-mode-handlers';
import type { PhosVisitModeRepository } from './visit-mode-repository';
import { withTenantContext } from './lambda-handler';

type VisitModeLambdaDependencies = {
  repository?: PhosVisitModeRepository;
  dynamo_client?: Pick<AwsDynamoDBClient, 'send'>;
  store_client?: DynamoVisitModeClient;
  now?: () => Date;
};

export function createDynamoVisitModeClient(input: {
  client: Pick<AwsDynamoDBClient, 'send'>;
}): DynamoVisitModeClient {
  return {
    async getVisitPacket(query) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: dynamoKey(query.partition_key, query.sort_key),
        }),
      );
      return result.Item ?? null;
    },

    async getIdempotency(query) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: dynamoKey(query.partition_key, query.sort_key),
        }),
      );
      return result.Item ?? null;
    },

    async transactCommitVisitStep(transaction: DynamoVisitStepCommitTransaction) {
      await input.client.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Update: {
                TableName: transaction.table_name,
                Key: dynamoKey(transaction.partition_key, transaction.visit_packet_sort_key),
                UpdateExpression:
                  'SET visit_mode = :visit_mode, server_version = :next_version, updated_at = :updated_at',
                ConditionExpression: 'server_version = :expected_version',
                ExpressionAttributeValues: {
                  ':visit_mode': toDynamoAttributeValue(transaction.response),
                  ':next_version': { N: String(transaction.response.server_version) },
                  ':updated_at': { S: transaction.committed_at },
                  ':expected_version': { N: String(transaction.expected_server_version) },
                },
              },
            },
            {
              Put: {
                TableName: transaction.table_name,
                Item: {
                  ...dynamoKey(transaction.partition_key, transaction.idempotency_sort_key),
                  request_fingerprint: { S: transaction.request_fingerprint },
                  response: { S: JSON.stringify(transaction.response) },
                  created_at: { S: transaction.committed_at },
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
          ],
        }),
      );
    },
  };
}

export function createVisitModeRepository(
  deps: VisitModeLambdaDependencies = {},
): PhosVisitModeRepository {
  if (deps.repository) return deps.repository;
  const dynamoClient = deps.dynamo_client ?? new DynamoDBClient({});
  const storeClient = deps.store_client ?? createDynamoVisitModeClient({ client: dynamoClient });
  return createVisitModeLifecycleRepository(
    createDynamoVisitModeRepository(storeClient, { now: deps.now }),
  );
}

export function createGetVisitModeLambdaHandler(deps: VisitModeLambdaDependencies = {}) {
  return withTenantContext(createGetVisitModeHandler(createVisitModeRepository(deps)));
}

export function createUpdateVisitStepLambdaHandler(deps: VisitModeLambdaDependencies = {}) {
  return withTenantContext(createUpdateVisitStepHandler(createVisitModeRepository(deps)));
}

export const getVisitModeHandler = createGetVisitModeLambdaHandler();
export const updateVisitStepHandler = createUpdateVisitStepLambdaHandler();
