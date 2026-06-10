import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  type AttributeValue,
  type DynamoDBClient as AwsDynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import type {
  CardBoardItemView,
  CardDetailResponse,
  CardSummaryView,
  NextActionView,
} from '@/phos/contracts/phos_contracts';
import { PHOS_DYNAMODB_TABLE_CONTRACT } from '@/phos/infra/dynamodb-table-contract';
import type { CardActionExecutionState } from './card-action-executor';
import { normalizeNextActionView } from './card-action-projection';
import { createCardActionExecutorRepository } from './card-action-executor';
import {
  createCardDetailHandler,
  createCardSearchHandler,
  createExecuteCardActionHandler,
} from './cards-handlers';
import type { PhosCardsRepository } from './cards-repository';
import {
  createDynamoCardActionExecutionStore,
  type DynamoActionCommitProjection,
  type DynamoActionIdempotencyRecord,
  type DynamoCardActionStoreClient,
  type DynamoCardActionStoreMapper,
} from './dynamo-card-action-store';
import { createDynamoCardActionTransactionClient } from './dynamo-card-action-transaction-client';
import {
  createDynamoCardsRepository,
  type DynamoCardsClient,
  type DynamoCardsMapper,
  type DynamoGetInput,
  type DynamoQueryOutput,
} from './dynamo-cards-repository';
import {
  decodeDynamoCursor,
  encodeDynamoCursor,
  tenantIdFromDynamoPartitionKey,
} from './dynamodb-cursor';
import { dynamoKey, fromDynamoAttributeValue } from './dynamodb-attribute-values';
import {
  createLambdaObservabilitySink,
  type PhosLambdaRuntimeDependencies,
} from './lambda-observability';
import { withTenantContext } from './lambda-handler';
import { phosAwsClientConfig, withPhosAwsClientTimeout } from './aws-client-timeout';

type DynamoItem = Record<string, AttributeValue>;

type CardsLambdaDependencies = PhosLambdaRuntimeDependencies & {
  repository?: PhosCardsRepository;
  dynamo_client?: Pick<AwsDynamoDBClient, 'send'>;
  cards_client?: DynamoCardsClient<DynamoItem, DynamoItem>;
  action_client?: DynamoCardActionStoreClient<DynamoItem, DynamoItem>;
  cards_mapper?: DynamoCardsMapper<DynamoItem, DynamoItem>;
  action_mapper?: DynamoCardActionStoreMapper<DynamoItem, DynamoItem>;
};

function attr(item: DynamoItem, key: string): unknown {
  const value = item[key];
  return value ? fromDynamoAttributeValue(value) : undefined;
}

function objectAttr<T extends Record<string, unknown>>(item: DynamoItem, key: string): T {
  const value = attr(item, key);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Missing DynamoDB map attribute: ${key}`);
  }
  return value as T;
}

function optionalObjectAttr<T extends Record<string, unknown>>(
  item: DynamoItem,
  key: string,
): T | undefined {
  const value = attr(item, key);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`DynamoDB attribute is not an object: ${key}`);
  }
  return value as T;
}

function stringAttr(item: DynamoItem, key: string): string | undefined {
  const value = attr(item, key);
  return typeof value === 'string' ? value : undefined;
}

function numberAttr(item: DynamoItem, key: string): number | undefined {
  const value = attr(item, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function dynamoQueryKeyAttributes(query: {
  index_name?: keyof typeof PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes;
  sort_key_begins_with?: string;
}) {
  if (!query.index_name) {
    return PHOS_DYNAMODB_TABLE_CONTRACT.primary_key;
  }
  const index = PHOS_DYNAMODB_TABLE_CONTRACT.global_secondary_indexes[query.index_name];
  if (query.sort_key_begins_with && !index.sort_key) {
    throw new Error(`PH-OS DynamoDB index ${query.index_name} does not have a sort key`);
  }
  return index;
}

export function createDynamoCardsClient(input: {
  client: Pick<AwsDynamoDBClient, 'send'>;
}): DynamoCardsClient<DynamoItem, DynamoItem> {
  return {
    async query(query): Promise<DynamoQueryOutput<DynamoItem>> {
      const keyAttributes = dynamoQueryKeyAttributes(query);
      const expressionAttributeNames: Record<string, string> = {
        '#pk': keyAttributes.partition_key,
      };
      const expressionAttributeValues: Record<string, AttributeValue> = {
        ':pk': { S: query.partition_key },
      };
      const keyConditions = ['#pk = :pk'];

      if (query.sort_key_begins_with && keyAttributes.sort_key) {
        expressionAttributeNames['#sk'] = keyAttributes.sort_key;
        expressionAttributeValues[':sk_prefix'] = { S: query.sort_key_begins_with };
        keyConditions.push('begins_with(#sk, :sk_prefix)');
      }

      const result = await input.client.send(
        new QueryCommand({
          TableName: query.table_name,
          IndexName: query.index_name,
          KeyConditionExpression: keyConditions.join(' AND '),
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
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
        }),
      );
      return {
        items: (result.Items ?? []) as DynamoItem[],
        next_cursor: encodeDynamoCursor(result.LastEvaluatedKey),
      };
    },
    async get(query: DynamoGetInput) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: dynamoKey(query.partition_key, query.sort_key),
        }),
      );
      return (result.Item ?? null) as DynamoItem | null;
    },
  };
}

function createDefaultCardsMapper(): DynamoCardsMapper<DynamoItem, DynamoItem> {
  return {
    toCardBoardItem(item) {
      const stored = optionalObjectAttr<CardBoardItemView>(item, 'card_board_item') ?? {
        card: objectAttr<CardSummaryView>(item, 'card'),
        next_action: objectAttr<NextActionView>(item, 'next_action'),
      };
      return {
        ...stored,
        next_action: normalizeNextActionView(stored.next_action),
      };
    },
    toCardDetail(item) {
      const stored = optionalObjectAttr<CardDetailResponse>(item, 'card_detail') ?? {
        card: objectAttr<CardSummaryView>(item, 'card'),
        visible_tabs: (attr(item, 'visible_tabs') as CardDetailResponse['visible_tabs']) ?? [],
        permissions: objectAttr<CardDetailResponse['permissions']>(item, 'permissions'),
        next_action: objectAttr<NextActionView>(item, 'next_action'),
        blockers: (attr(item, 'blockers') as CardDetailResponse['blockers']) ?? [],
        source_refs: (attr(item, 'source_refs') as CardDetailResponse['source_refs']) ?? [],
        server_version:
          numberAttr(item, 'server_version') ??
          objectAttr<CardSummaryView>(item, 'card').server_version,
      };
      return {
        ...stored,
        next_action: normalizeNextActionView(stored.next_action),
      };
    },
  };
}

function createDefaultActionMapper(
  now: () => Date = () => new Date(),
): DynamoCardActionStoreMapper<DynamoItem, DynamoItem> {
  return {
    toActionState(item) {
      const unresolvedClaimCandidateCount = numberAttr(item, 'unresolved_claim_candidate_count');
      const stored = optionalObjectAttr<CardActionExecutionState>(item, 'action_state') ?? {
        card: objectAttr<CardSummaryView>(item, 'card'),
        next_action: objectAttr<NextActionView>(item, 'next_action'),
        blockers: (attr(item, 'blockers') as CardActionExecutionState['blockers']) ?? [],
        ...(optionalObjectAttr<CardActionExecutionState['visit_mode'] & Record<string, unknown>>(
          item,
          'visit_mode',
        )
          ? {
              visit_mode: objectAttr<
                CardActionExecutionState['visit_mode'] & Record<string, unknown>
              >(item, 'visit_mode'),
            }
          : {}),
        ...(unresolvedClaimCandidateCount !== undefined
          ? {
              unresolved_claim_candidate_count: unresolvedClaimCandidateCount,
            }
          : {}),
        ...(attr(item, 'allowed_actions')
          ? {
              allowed_actions: attr(
                item,
                'allowed_actions',
              ) as CardActionExecutionState['allowed_actions'],
            }
          : {}),
      };
      return {
        ...stored,
        next_action: normalizeNextActionView(stored.next_action),
      };
    },
    toIdempotencyRecord(item): DynamoActionIdempotencyRecord {
      const responseJson = stringAttr(item, 'response_json');
      return {
        actor_user_id: stringAttr(item, 'actor_user_id'),
        request_fingerprint: stringAttr(item, 'request_fingerprint') ?? '',
        ...(responseJson ? { response: JSON.parse(responseJson) } : {}),
      };
    },
    toCommitProjection(input): DynamoActionCommitProjection {
      return {
        server_version: input.previous_state.card.server_version + 1,
        next_action: input.previous_state.next_action,
        display_context: {
          canceled_at: input.command.action_code === 'CANCEL_CARD' ? now().toISOString() : null,
          has_open_rejected_audit: false,
          has_active_in_progress_task: false,
          primary_action_authorized: true,
        },
      };
    },
  };
}

export function createDynamoCardActionClient(input: {
  client: Pick<AwsDynamoDBClient, 'send'>;
  now?: () => Date;
}): DynamoCardActionStoreClient<DynamoItem, DynamoItem> {
  const transactionClient = createDynamoCardActionTransactionClient(input);
  return {
    async getActionState(query) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: dynamoKey(query.partition_key, query.sort_key),
        }),
      );
      return (result.Item ?? null) as DynamoItem | null;
    },
    async getIdempotency(query) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: query.table_name,
          Key: dynamoKey(query.partition_key, query.sort_key),
        }),
      );
      return (result.Item ?? null) as DynamoItem | null;
    },
    transactCommitAction: transactionClient.transactCommitAction,
  };
}

export function createCardsRepository(deps: CardsLambdaDependencies = {}): PhosCardsRepository {
  if (deps.repository) return deps.repository;
  const dynamoClient =
    deps.dynamo_client ?? withPhosAwsClientTimeout(new DynamoDBClient(phosAwsClientConfig()));
  const cardsClient = deps.cards_client ?? createDynamoCardsClient({ client: dynamoClient });
  const actionClient =
    deps.action_client ?? createDynamoCardActionClient({ client: dynamoClient, now: deps.now });
  const cardsRepository = createDynamoCardsRepository(
    cardsClient,
    deps.cards_mapper ?? createDefaultCardsMapper(),
  );
  const actionRepository = createCardActionExecutorRepository(
    createDynamoCardActionExecutionStore(
      actionClient,
      deps.action_mapper ?? createDefaultActionMapper(deps.now),
    ),
  );
  return {
    ...cardsRepository,
    ...actionRepository,
  };
}

function createLazyCardsRepository(deps: CardsLambdaDependencies = {}): PhosCardsRepository {
  let repository: PhosCardsRepository | undefined;
  return {
    searchCards(ctx, query) {
      repository ??= createCardsRepository(deps);
      return repository.searchCards(ctx, query);
    },
    getCardDetail(ctx, card_id) {
      repository ??= createCardsRepository(deps);
      return repository.getCardDetail(ctx, card_id);
    },
    executeCardAction(ctx, card_id, command) {
      repository ??= createCardsRepository(deps);
      return repository.executeCardAction(ctx, card_id, command);
    },
  };
}

export function createCardSearchLambdaHandler(deps: CardsLambdaDependencies = {}) {
  const repository = deps.repository
    ? createCardsRepository(deps)
    : createLazyCardsRepository(deps);
  return withTenantContext(createCardSearchHandler(repository), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

export function createCardDetailLambdaHandler(deps: CardsLambdaDependencies = {}) {
  const repository = deps.repository
    ? createCardsRepository(deps)
    : createLazyCardsRepository(deps);
  return withTenantContext(createCardDetailHandler(repository), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

export function createExecuteCardActionLambdaHandler(deps: CardsLambdaDependencies = {}) {
  const repository = deps.repository
    ? createCardsRepository(deps)
    : createLazyCardsRepository(deps);
  return withTenantContext(createExecuteCardActionHandler(repository), {
    observability: createLambdaObservabilitySink(deps),
    now: deps.now,
  });
}

let defaultCardSearchHandler: ReturnType<typeof createCardSearchLambdaHandler> | undefined;
let defaultCardDetailHandler: ReturnType<typeof createCardDetailLambdaHandler> | undefined;
let defaultExecuteCardActionHandler:
  | ReturnType<typeof createExecuteCardActionLambdaHandler>
  | undefined;

export const cardSearchHandler: ReturnType<typeof createCardSearchLambdaHandler> = (event) => {
  defaultCardSearchHandler ??= createCardSearchLambdaHandler();
  return defaultCardSearchHandler(event);
};

export const cardDetailHandler: ReturnType<typeof createCardDetailLambdaHandler> = (event) => {
  defaultCardDetailHandler ??= createCardDetailLambdaHandler();
  return defaultCardDetailHandler(event);
};

export const executeCardActionHandler: ReturnType<typeof createExecuteCardActionLambdaHandler> = (
  event,
) => {
  defaultExecuteCardActionHandler ??= createExecuteCardActionLambdaHandler();
  return defaultExecuteCardActionHandler(event);
};
