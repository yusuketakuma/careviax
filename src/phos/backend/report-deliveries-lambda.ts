import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  type AttributeValue,
  type DynamoDBClient as AwsDynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import type { ReportDeliveryView } from '@/phos/contracts/phos_contracts';
import { createDynamoReportDeliveriesRepository } from './dynamo-report-deliveries-repository';
import type {
  DynamoReportDeliveriesClient,
  DynamoReportDeliveryQueryOutput,
} from './dynamo-report-deliveries-repository';
import {
  createDynamoReportDeliveryLifecycleStore,
  type DynamoReportDeliveryLifecycleClient,
  type DynamoReportDeliveryLifecycleMapper,
} from './dynamo-report-delivery-lifecycle-store';
import { createDynamoReportDeliveryTransactionClient } from './dynamo-report-delivery-transaction-client';
import {
  decodeDynamoCursor,
  encodeDynamoCursor,
  tenantIdFromDynamoPartitionKey,
} from './dynamodb-cursor';
import { fromDynamoAttributeValue } from './dynamodb-attribute-values';
import { createReportDeliveryLifecycleRepository } from './report-delivery-lifecycle-repository';
import {
  createMarkReportActionDoneHandler,
  createRegisterReportReplyHandler,
  createReportDeliverySearchHandler,
} from './report-deliveries-handlers';
import type { PhosReportDeliveriesRepository } from './report-deliveries-repository';
import {
  createLambdaObservabilitySink,
  type PhosLambdaRuntimeDependencies,
} from './lambda-observability';
import { withTenantContext } from './lambda-handler';

type DynamoItem = Record<string, AttributeValue>;

type ReportDeliveriesLambdaDependencies = PhosLambdaRuntimeDependencies & {
  repository?: PhosReportDeliveriesRepository;
  dynamo_client?: Pick<AwsDynamoDBClient, 'send'>;
  store_client?: DynamoReportDeliveriesClient;
  lifecycle_client?: DynamoReportDeliveryLifecycleClient<DynamoItem, DynamoItem>;
};

export function createDynamoReportDeliveriesClient(input: {
  client: Pick<AwsDynamoDBClient, 'send'>;
}): DynamoReportDeliveriesClient {
  return {
    async queryReportDeliveries(query): Promise<DynamoReportDeliveryQueryOutput> {
      const result = await input.client.send(
        new QueryCommand({
          TableName: query.table_name,
          IndexName: query.index_name,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: {
            '#pk': `${query.index_name}PK`,
          },
          ExpressionAttributeValues: {
            ':pk': { S: query.partition_key },
          },
          Limit: query.limit,
          ExclusiveStartKey: decodeDynamoCursor(query.cursor, {
            tenant_id: tenantIdFromDynamoPartitionKey(query.partition_key),
          }),
          ScanIndexForward: false,
        }),
      );
      return {
        items: (result.Items ?? []) as DynamoItem[],
        next_cursor: encodeDynamoCursor(result.LastEvaluatedKey),
      };
    },
  };
}

function objectAttr(item: DynamoItem, key: string): Record<string, unknown> {
  const value = item[key];
  if (!value) throw new Error(`Missing DynamoDB map attribute: ${key}`);
  const parsed = fromDynamoAttributeValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`DynamoDB attribute is not an object: ${key}`);
  }
  return parsed as Record<string, unknown>;
}

function stringAttr(item: DynamoItem, key: string): string | undefined {
  const value = item[key];
  if (!value) return undefined;
  const parsed = fromDynamoAttributeValue(value);
  return typeof parsed === 'string' ? parsed : undefined;
}

function numberAttr(item: DynamoItem, key: string): number | undefined {
  const value = item[key];
  if (!value) return undefined;
  const parsed = fromDynamoAttributeValue(value);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

const lifecycleMapper: DynamoReportDeliveryLifecycleMapper<DynamoItem, DynamoItem> = {
  toReportDeliveryView(item) {
    const delivery = objectAttr(item, 'report_delivery');
    return {
      ...(delivery as ReportDeliveryView),
      server_version: numberAttr(item, 'server_version') ?? Number(delivery.server_version ?? 1),
    };
  },
  toIdempotencyRecord(item) {
    const responseJson = stringAttr(item, 'response_json');
    return {
      request_fingerprint: stringAttr(item, 'request_fingerprint') ?? '',
      ...(responseJson ? { response: JSON.parse(responseJson) } : {}),
    };
  },
};

export function createDynamoReportDeliveryLifecycleClient(input: {
  client: Pick<AwsDynamoDBClient, 'send'>;
  now?: () => Date;
}): DynamoReportDeliveryLifecycleClient<DynamoItem, DynamoItem> {
  const transactionClient = createDynamoReportDeliveryTransactionClient(input);
  return {
    async getReportDelivery(query) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: {
            PK: { S: query.partition_key },
            SK: { S: query.sort_key },
          },
        }),
      );
      return (result.Item ?? null) as DynamoItem | null;
    },
    async getIdempotency(query) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: {
            PK: { S: query.partition_key },
            SK: { S: query.sort_key },
          },
        }),
      );
      return (result.Item ?? null) as DynamoItem | null;
    },
    transactCommitReportDeliveryTransition:
      transactionClient.transactCommitReportDeliveryTransition,
  };
}

export function createReportDeliveriesRepository(
  deps: ReportDeliveriesLambdaDependencies = {},
): PhosReportDeliveriesRepository {
  if (deps.repository) return deps.repository;
  const dynamoClient = deps.dynamo_client ?? new DynamoDBClient({});
  const storeClient =
    deps.store_client ?? createDynamoReportDeliveriesClient({ client: dynamoClient });
  const searchRepository = createDynamoReportDeliveriesRepository(storeClient, { now: deps.now });
  const lifecycleClient =
    deps.lifecycle_client ??
    createDynamoReportDeliveryLifecycleClient({ client: dynamoClient, now: deps.now });
  return createReportDeliveryLifecycleRepository(
    createDynamoReportDeliveryLifecycleStore(
      lifecycleClient,
      lifecycleMapper,
      searchRepository.searchReportDeliveries,
    ),
    { now: deps.now },
  );
}

export function createReportDeliverySearchLambdaHandler(
  deps: ReportDeliveriesLambdaDependencies = {},
) {
  return withTenantContext(
    createReportDeliverySearchHandler(createReportDeliveriesRepository(deps)),
    {
      observability: createLambdaObservabilitySink(deps),
      now: deps.now,
    },
  );
}

export const reportDeliverySearchHandler = createReportDeliverySearchLambdaHandler();

export function createRegisterReportReplyLambdaHandler(
  deps: ReportDeliveriesLambdaDependencies = {},
) {
  return withTenantContext(
    createRegisterReportReplyHandler(createReportDeliveriesRepository(deps)),
    {
      observability: createLambdaObservabilitySink(deps),
      now: deps.now,
    },
  );
}

export function createMarkReportActionDoneLambdaHandler(
  deps: ReportDeliveriesLambdaDependencies = {},
) {
  return withTenantContext(
    createMarkReportActionDoneHandler(createReportDeliveriesRepository(deps)),
    {
      observability: createLambdaObservabilitySink(deps),
      now: deps.now,
    },
  );
}

export const registerReportReplyHandler = createRegisterReportReplyLambdaHandler();
export const markReportActionDoneHandler = createMarkReportActionDoneLambdaHandler();
