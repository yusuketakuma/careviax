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
  dynamoCursorKeyAttributesForIndex,
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
      const keyAttributes = dynamoCursorKeyAttributesForIndex(query.index_name);
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
            required_key_attributes: [
              keyAttributes.partition_key,
              ...(keyAttributes.sort_key ? [keyAttributes.sort_key] : []),
            ],
            required_partition: {
              attribute: keyAttributes.partition_key,
              value: query.partition_key,
            },
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
      actor_user_id: stringAttr(item, 'actor_user_id'),
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

function createLazyReportDeliveriesRepository(
  deps: ReportDeliveriesLambdaDependencies = {},
): PhosReportDeliveriesRepository {
  let repository: PhosReportDeliveriesRepository | undefined;
  return {
    searchReportDeliveries(ctx, query) {
      repository ??= createReportDeliveriesRepository(deps);
      return repository.searchReportDeliveries(ctx, query);
    },
    registerReportReply(ctx, delivery_id, command) {
      repository ??= createReportDeliveriesRepository(deps);
      return repository.registerReportReply(ctx, delivery_id, command);
    },
    markReportActionDone(ctx, delivery_id, command) {
      repository ??= createReportDeliveriesRepository(deps);
      return repository.markReportActionDone(ctx, delivery_id, command);
    },
  };
}

export function createReportDeliverySearchLambdaHandler(
  deps: ReportDeliveriesLambdaDependencies = {},
) {
  const repository = deps.repository
    ? createReportDeliveriesRepository(deps)
    : createLazyReportDeliveriesRepository(deps);
  return withTenantContext(createReportDeliverySearchHandler(repository), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

let defaultReportDeliverySearchHandler:
  | ReturnType<typeof createReportDeliverySearchLambdaHandler>
  | undefined;

export const reportDeliverySearchHandler: ReturnType<
  typeof createReportDeliverySearchLambdaHandler
> = (event) => {
  defaultReportDeliverySearchHandler ??= createReportDeliverySearchLambdaHandler();
  return defaultReportDeliverySearchHandler(event);
};

export function createRegisterReportReplyLambdaHandler(
  deps: ReportDeliveriesLambdaDependencies = {},
) {
  const repository = deps.repository
    ? createReportDeliveriesRepository(deps)
    : createLazyReportDeliveriesRepository(deps);
  return withTenantContext(createRegisterReportReplyHandler(repository), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

export function createMarkReportActionDoneLambdaHandler(
  deps: ReportDeliveriesLambdaDependencies = {},
) {
  const repository = deps.repository
    ? createReportDeliveriesRepository(deps)
    : createLazyReportDeliveriesRepository(deps);
  return withTenantContext(createMarkReportActionDoneHandler(repository), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

let defaultRegisterReportReplyHandler:
  | ReturnType<typeof createRegisterReportReplyLambdaHandler>
  | undefined;
let defaultMarkReportActionDoneHandler:
  | ReturnType<typeof createMarkReportActionDoneLambdaHandler>
  | undefined;

export const registerReportReplyHandler: ReturnType<
  typeof createRegisterReportReplyLambdaHandler
> = (event) => {
  defaultRegisterReportReplyHandler ??= createRegisterReportReplyLambdaHandler();
  return defaultRegisterReportReplyHandler(event);
};

export const markReportActionDoneHandler: ReturnType<
  typeof createMarkReportActionDoneLambdaHandler
> = (event) => {
  defaultMarkReportActionDoneHandler ??= createMarkReportActionDoneLambdaHandler();
  return defaultMarkReportActionDoneHandler(event);
};
