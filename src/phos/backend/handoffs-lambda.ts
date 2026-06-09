import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  type AttributeValue,
  type DynamoDBClient as AwsDynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  HandoffStatus,
  type CreateHandoffRequest,
  type HandoffMutationResponse,
  type HandoffView,
} from '@/phos/contracts/phos_contracts';
import type { CardActionExecutionState } from './card-action-executor';
import type { CardActionDisplayContext } from './card-action-projection';
import { createDynamoHandoffLifecycleStore } from './dynamo-handoff-lifecycle-store';
import type {
  DynamoHandoffIdempotencyRecord,
  DynamoHandoffStoreClient,
  DynamoHandoffStoreMapper,
} from './dynamo-handoff-lifecycle-store';
import { createDynamoHandoffTransactionClient } from './dynamo-handoff-transaction-client';
import {
  decodeDynamoCursor,
  encodeDynamoCursor,
  tenantIdFromDynamoPartitionKey,
} from './dynamodb-cursor';
import { dynamoKey, fromDynamoAttributeValue } from './dynamodb-attribute-values';
import { createHandoffLifecycleRepository } from './handoff-lifecycle-repository';
import type { HandoffCreateCardContext } from './handoff-lifecycle-repository';
import {
  createCreateHandoffHandler,
  createHandoffSearchHandler,
  createOpenHandoffHandler,
  createResolveHandoffHandler,
  createReturnHandoffHandler,
} from './handoffs-handlers';
import type { PhosHandoffsRepository } from './handoffs-repository';
import {
  createLambdaObservabilitySink,
  type PhosLambdaRuntimeDependencies,
} from './lambda-observability';
import { withTenantContext } from './lambda-handler';
import type { TenantContext } from './tenant-context';

type DynamoItem = Record<string, AttributeValue>;
type HandoffLambdaHandler = ReturnType<typeof withTenantContext>;

type HandoffsLambdaDependencies = PhosLambdaRuntimeDependencies & {
  repository?: PhosHandoffsRepository;
  dynamo_client?: Pick<AwsDynamoDBClient, 'send'>;
  store_client?: DynamoHandoffStoreClient<DynamoItem, DynamoItem>;
  mapper?: DynamoHandoffStoreMapper<DynamoItem, DynamoItem>;
  createHandoffId?: () => string;
};

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

function parseJsonAttr<T>(item: DynamoItem, key: string): T | undefined {
  const value = stringAttr(item, key);
  return value ? (JSON.parse(value) as T) : undefined;
}

function asHandoffView(value: Record<string, unknown>): HandoffView {
  return value as HandoffView;
}

function asCardActionState(item: DynamoItem): CardActionExecutionState {
  return {
    card: objectAttr(item, 'card') as CardActionExecutionState['card'],
    next_action: objectAttr(item, 'next_action') as CardActionExecutionState['next_action'],
    blockers: (fromDynamoAttributeValue(item.blockers ?? { L: [] }) ??
      []) as CardActionExecutionState['blockers'],
    unresolved_claim_candidate_count: numberAttr(item, 'unresolved_claim_candidate_count') ?? 0,
  };
}

function asDisplayContext(item: DynamoItem): CardActionDisplayContext {
  const value = item.display_context ? objectAttr(item, 'display_context') : {};
  return {
    canceled_at: typeof value.canceled_at === 'string' ? value.canceled_at : null,
    has_open_rejected_audit: value.has_open_rejected_audit === true,
    has_active_in_progress_task: value.has_active_in_progress_task === true,
    primary_action_authorized: value.primary_action_authorized !== false,
  };
}

function ageMinutes(created_at: string, now: Date): number {
  const created = Date.parse(created_at);
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((now.getTime() - created) / 60_000));
}

export function createDynamoHandoffStoreClient(input: {
  client: Pick<AwsDynamoDBClient, 'send'>;
  now?: () => Date;
}): DynamoHandoffStoreClient<DynamoItem, DynamoItem> {
  const transactionClient = createDynamoHandoffTransactionClient(input);

  return {
    async queryHandoffs(query) {
      const partitionName = query.key_type === 'GSI' ? `${query.index_name}PK` : 'PK';
      const sortName = query.key_type === 'GSI' ? `${query.index_name}SK` : 'SK';
      const command = new QueryCommand({
        TableName: query.table_name,
        IndexName: query.index_name,
        KeyConditionExpression: query.sort_key_begins_with
          ? '#pk = :pk AND begins_with(#sk, :sk_prefix)'
          : '#pk = :pk',
        ExpressionAttributeNames: {
          '#pk': partitionName,
          ...(query.sort_key_begins_with ? { '#sk': sortName } : {}),
        },
        ExpressionAttributeValues: {
          ':pk': { S: query.partition_key },
          ...(query.sort_key_begins_with
            ? { ':sk_prefix': { S: query.sort_key_begins_with } }
            : {}),
        },
        Limit: query.limit,
        ExclusiveStartKey: decodeDynamoCursor(query.cursor, {
          tenant_id: tenantIdFromDynamoPartitionKey(query.partition_key),
        }),
      });
      const result = await input.client.send(command);
      return {
        items: result.Items ?? [],
        next_cursor: encodeDynamoCursor(result.LastEvaluatedKey),
      };
    },

    async getHandoff(query) {
      return getItem(input.client, query);
    },

    async getCreateCardContext(query) {
      return getItem(input.client, query);
    },

    async getHandoffCardState(query) {
      return getItem(input.client, query);
    },

    async getIdempotency(query) {
      return getItem(input.client, query);
    },

    transactCreateHandoff: transactionClient.transactCreateHandoff,
    transactCommitHandoffTransition: transactionClient.transactCommitHandoffTransition,
  };
}

async function getItem(
  client: Pick<AwsDynamoDBClient, 'send'>,
  query: { table_name: string; partition_key: string; sort_key: string },
): Promise<DynamoItem | null> {
  const result = await client.send(
    new GetItemCommand({
      TableName: query.table_name,
      Key: dynamoKey(query.partition_key, query.sort_key),
    }),
  );
  return result.Item ?? null;
}

export function createDynamoHandoffMapper(
  input: {
    now?: () => Date;
  } = {},
): DynamoHandoffStoreMapper<DynamoItem, DynamoItem> {
  const now = input.now ?? (() => new Date());

  return {
    toHandoffView(item) {
      const handoff = asHandoffView(objectAttr(item, 'handoff'));
      return {
        ...handoff,
        age_minutes: ageMinutes(handoff.created_at, now()),
      };
    },

    toCreateCardContext(item) {
      const card = objectAttr(item, 'card') as HandoffCreateCardContext;
      const server_version = numberAttr(item, 'server_version') ?? card.server_version;
      return {
        card_id: card.card_id,
        patient_name: card.patient_name,
        server_version,
        ...(stringAttr(item, 'pharmacist_assignee_user_id')
          ? { pharmacist_assignee_user_id: stringAttr(item, 'pharmacist_assignee_user_id') }
          : {}),
      };
    },

    toHandoffCardState(item) {
      return {
        state: asCardActionState(item),
        display_context: asDisplayContext(item),
      };
    },

    toIdempotencyRecord(item): DynamoHandoffIdempotencyRecord {
      return {
        request_fingerprint: stringAttr(item, 'request_fingerprint') ?? '',
        response: parseJsonAttr<HandoffMutationResponse>(item, 'response_json'),
      };
    },

    toCreateResponse({ ctx, command, card_context, handoff_id, created_at }) {
      return createHandoffMutationResponse({
        ctx,
        command,
        card_context,
        handoff_id,
        created_at,
        now: now(),
      });
    },
  };
}

function createHandoffMutationResponse(input: {
  ctx: TenantContext;
  command: CreateHandoffRequest;
  card_context: HandoffCreateCardContext;
  handoff_id: string;
  created_at: string;
  now: Date;
}): HandoffMutationResponse {
  const assignee_user_id =
    input.command.assignee_user_id ??
    input.card_context.pharmacist_assignee_user_id ??
    input.ctx.user_id;
  const handoff: HandoffView = {
    handoff_id: input.handoff_id,
    card_id: input.command.card_id,
    status: HandoffStatus.OPEN,
    reason_code: input.command.reason_code,
    summary: input.command.summary,
    source_refs: input.command.source_refs,
    ...(input.command.requested_action ? { requested_action: input.command.requested_action } : {}),
    urgency: input.command.urgency,
    ...(input.command.related_blocker_code
      ? { related_blocker_code: input.command.related_blocker_code }
      : {}),
    created_by_user_id: input.ctx.user_id,
    assignee_user_id,
    created_at: input.created_at,
    updated_at: input.created_at,
    server_version: 1,
    patient_name: input.card_context.patient_name,
    age_minutes: ageMinutes(input.created_at, input.now),
  };

  return {
    handoff,
    side_effects: [{ type: 'HANDOFF_CREATED', handoff_id: input.handoff_id }],
    toast: { tone: 'INFO', message_key: 'toast.handoff.created' },
    server_version: handoff.server_version,
  };
}

export function createHandoffRepository(
  deps: HandoffsLambdaDependencies = {},
): PhosHandoffsRepository {
  if (deps.repository) return deps.repository;

  const now = deps.now ?? (() => new Date());
  const dynamoClient = deps.dynamo_client ?? new DynamoDBClient({});
  const storeClient =
    deps.store_client ?? createDynamoHandoffStoreClient({ client: dynamoClient, now });
  const mapper = deps.mapper ?? createDynamoHandoffMapper({ now });
  const store = createDynamoHandoffLifecycleStore(storeClient, mapper, {
    createHandoffId: deps.createHandoffId,
    now,
  });
  return createHandoffLifecycleRepository(store, { now });
}

export function createHandoffSearchLambdaHandler(
  deps: HandoffsLambdaDependencies = {},
): HandoffLambdaHandler {
  return withTenantContext(createHandoffSearchHandler(createHandoffRepository(deps)), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

export function createCreateHandoffLambdaHandler(
  deps: HandoffsLambdaDependencies = {},
): HandoffLambdaHandler {
  return withTenantContext(createCreateHandoffHandler(createHandoffRepository(deps)), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

export function createOpenHandoffLambdaHandler(
  deps: HandoffsLambdaDependencies = {},
): HandoffLambdaHandler {
  return withTenantContext(createOpenHandoffHandler(createHandoffRepository(deps)), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

export function createResolveHandoffLambdaHandler(
  deps: HandoffsLambdaDependencies = {},
): HandoffLambdaHandler {
  return withTenantContext(createResolveHandoffHandler(createHandoffRepository(deps)), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

export function createReturnHandoffLambdaHandler(
  deps: HandoffsLambdaDependencies = {},
): HandoffLambdaHandler {
  return withTenantContext(createReturnHandoffHandler(createHandoffRepository(deps)), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

export const handoffSearchHandler = createHandoffSearchLambdaHandler();
export const createHandoffHandler = createCreateHandoffLambdaHandler();
export const openHandoffHandler = createOpenHandoffLambdaHandler();
export const resolveHandoffHandler = createResolveHandoffLambdaHandler();
export const returnHandoffHandler = createReturnHandoffLambdaHandler();
