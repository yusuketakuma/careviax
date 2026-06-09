import {
  TransactWriteItemsCommand,
  type AttributeValue,
  type DynamoDBClient,
  type TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import {
  type DynamoHandoffCreateTransaction,
  type DynamoHandoffTransitionTransaction,
  handoffUrgencyQueueRank,
} from './dynamo-handoff-lifecycle-store';
import { buildDynamoCardAuditEventPut } from './card-audit-events';
import { dynamoKey, toDynamoAttributeValue } from './dynamodb-attribute-values';
import { buildDynamoCardGsiProjectionUpdate } from './dynamodb-card-gsi-projection';
import { dynamoEntityMetadata } from './dynamodb-entity-metadata';
import { cardBlockerSk, handoffAssigneeGsiSk } from './dynamodb-keys';
import { rethrowDynamoTransactionConflict } from './dynamodb-transaction-errors';

function queueSortKey(input: DynamoHandoffCreateTransaction | DynamoHandoffTransitionTransaction) {
  const handoff = input.response.handoff;
  return handoffAssigneeGsiSk({
    status: handoff.status,
    urgency_rank: handoffUrgencyQueueRank(handoff.urgency),
    created_at: handoff.created_at,
    handoff_id: handoff.handoff_id,
  });
}

function idempotencyPut(
  input: DynamoHandoffCreateTransaction | DynamoHandoffTransitionTransaction,
  committed_at: string,
): TransactWriteItem {
  return {
    Put: {
      TableName: input.table_name,
      Item: {
        ...dynamoKey(input.partition_key, input.idempotency_sort_key),
        entity_type: { S: 'HANDOFF_IDEMPOTENCY' },
        ...dynamoEntityMetadata({
          partition_key: input.partition_key,
          created_at: committed_at,
        }),
        handoff_id: { S: input.response.handoff.handoff_id },
        idempotency_key: { S: input.idempotency_key },
        request_fingerprint: { S: input.request_fingerprint },
        response_json: { S: JSON.stringify(input.response) },
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    },
  };
}

export function buildDynamoHandoffCreateTransactWriteItems(
  input: DynamoHandoffCreateTransaction,
  committed_at: string,
): TransactWriteItem[] {
  const handoff = input.response.handoff;
  return [
    {
      ConditionCheck: {
        TableName: input.table_name,
        Key: dynamoKey(input.partition_key, input.card_sort_key),
        ConditionExpression: '#server_version = :expected_card_server_version',
        ExpressionAttributeNames: {
          '#server_version': 'server_version',
        },
        ExpressionAttributeValues: {
          ':expected_card_server_version': { N: String(input.expected_card_server_version) },
        },
      },
    },
    {
      Put: {
        TableName: input.table_name,
        Item: {
          ...dynamoKey(input.partition_key, input.handoff_sort_key),
          entity_type: { S: 'HANDOFF' },
          ...dynamoEntityMetadata({
            partition_key: input.partition_key,
            created_at: handoff.created_at,
            updated_at: committed_at,
            server_version: handoff.server_version,
          }),
          GSI5PK: { S: input.queue_gsi_pk },
          GSI5SK: { S: queueSortKey(input) },
          handoff_id: { S: handoff.handoff_id },
          card_id: { S: handoff.card_id },
          status: { S: handoff.status },
          urgency: { S: handoff.urgency },
          urgency_rank: { N: String(handoffUrgencyQueueRank(handoff.urgency)) },
          created_by_user_id: { S: handoff.created_by_user_id },
          ...(handoff.assignee_user_id
            ? { assignee_user_id: { S: handoff.assignee_user_id } }
            : {}),
          handoff: toDynamoAttributeValue(handoff),
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    buildDynamoCardAuditEventPut({
      table_name: input.table_name,
      partition_key: input.partition_key,
      committed_at,
      event: input.audit_event,
    }),
    idempotencyPut(input, committed_at),
  ];
}

export function buildDynamoHandoffTransitionTransactWriteItems(
  input: DynamoHandoffTransitionTransaction,
  committed_at: string,
): TransactWriteItem[] {
  const handoff = input.response.handoff;
  const blockerUpdate: TransactWriteItem[] = input.blocker_resolution
    ? [
        {
          Update: {
            TableName: input.table_name,
            Key: dynamoKey(
              input.partition_key,
              cardBlockerSk({
                card_id: input.blocker_resolution.card_id,
                blocker_code: input.blocker_resolution.blocker_code,
              }),
            ),
            ConditionExpression: 'attribute_exists(PK)',
            UpdateExpression:
              'SET active = :active, resolved_at = :resolved_at, updated_at = :updated_at',
            ExpressionAttributeValues: {
              ':active': { BOOL: false },
              ':resolved_at': { S: committed_at },
              ':updated_at': { S: committed_at },
            },
          },
        },
      ]
    : [];
  const cardAggregate = input.card_aggregate_update;
  const cardAggregateUpdateInput = cardAggregate?.update;
  const cardAggregateGsiUpdate = cardAggregateUpdateInput
    ? buildDynamoCardGsiProjectionUpdate({
        tenant_partition_key: input.partition_key,
        card: cardAggregateUpdateInput.card,
      })
    : undefined;
  const cardAggregateExpressionAttributeNames: Record<string, string> = {
    '#server_version': 'server_version',
    '#display_status': 'display_status',
    '#updated_at': 'updated_at',
    '#card': 'card',
    '#next_action': 'next_action',
    '#blockers': 'blockers',
  };
  const cardAggregateExpressionAttributeValues: Record<string, AttributeValue> =
    cardAggregate && cardAggregateUpdateInput
      ? {
          ':expected_card_server_version': {
            N: String(cardAggregate.expected_card_server_version),
          },
          ':card_server_version': { N: String(cardAggregateUpdateInput.server_version) },
          ':card_display_status': {
            S: cardAggregateUpdateInput.card.display_status,
          },
          ':updated_at': { S: committed_at },
          ':card': toDynamoAttributeValue(cardAggregateUpdateInput.card),
          ':next_action': toDynamoAttributeValue(cardAggregateUpdateInput.next_action),
          ':blockers': toDynamoAttributeValue(cardAggregateUpdateInput.blockers),
        }
      : {};
  const cardAggregateIndexSetExpressions = Object.entries(cardAggregateGsiUpdate?.set ?? {}).map(
    ([attributeName, value]) => {
      const nameAlias = `#${attributeName}`;
      const valueAlias = `:${attributeName}`;
      cardAggregateExpressionAttributeNames[nameAlias] = attributeName;
      cardAggregateExpressionAttributeValues[valueAlias] = value;
      return `${nameAlias} = ${valueAlias}`;
    },
  );
  const cardAggregateIndexRemoveExpressions = (cardAggregateGsiUpdate?.remove ?? []).map(
    (attributeName) => {
      const nameAlias = `#${attributeName}`;
      cardAggregateExpressionAttributeNames[nameAlias] = attributeName;
      return nameAlias;
    },
  );
  const cardAggregateSetExpression = [
    '#server_version = :card_server_version',
    '#display_status = :card_display_status',
    '#updated_at = :updated_at',
    '#card = :card',
    '#next_action = :next_action',
    '#blockers = :blockers',
    ...cardAggregateIndexSetExpressions,
  ].join(', ');
  const cardAggregateRemoveExpression =
    cardAggregateIndexRemoveExpressions.length > 0
      ? ` REMOVE ${cardAggregateIndexRemoveExpressions.join(', ')}`
      : '';
  const cardAggregateUpdate: TransactWriteItem[] =
    cardAggregate && cardAggregateUpdateInput
      ? [
          {
            Update: {
              TableName: input.table_name,
              Key: dynamoKey(input.partition_key, cardAggregate.card_sort_key),
              ConditionExpression: '#server_version = :expected_card_server_version',
              UpdateExpression: `SET ${cardAggregateSetExpression}${cardAggregateRemoveExpression}`,
              ExpressionAttributeNames: cardAggregateExpressionAttributeNames,
              ExpressionAttributeValues: cardAggregateExpressionAttributeValues,
            },
          },
        ]
      : [];

  return [
    {
      Update: {
        TableName: input.table_name,
        Key: dynamoKey(input.partition_key, input.handoff_sort_key),
        ConditionExpression: input.expected_assignee_user_id
          ? '#server_version = :expected_server_version AND #assignee_user_id = :expected_assignee_user_id'
          : '#server_version = :expected_server_version AND attribute_not_exists(#assignee_user_id)',
        UpdateExpression:
          'SET #server_version = :server_version, #status = :status, #updated_at = :updated_at, GSI5PK = :gsi5pk, GSI5SK = :gsi5sk, handoff = :handoff',
        ExpressionAttributeNames: {
          '#server_version': 'server_version',
          '#status': 'status',
          '#updated_at': 'updated_at',
          '#assignee_user_id': 'assignee_user_id',
        },
        ExpressionAttributeValues: {
          ':expected_server_version': { N: String(input.expected_server_version) },
          ...(input.expected_assignee_user_id
            ? { ':expected_assignee_user_id': { S: input.expected_assignee_user_id } }
            : {}),
          ':server_version': { N: String(input.response.server_version) },
          ':status': { S: handoff.status },
          ':updated_at': { S: committed_at },
          ':gsi5pk': { S: input.queue_gsi_pk },
          ':gsi5sk': { S: queueSortKey(input) },
          ':handoff': toDynamoAttributeValue(handoff),
        },
      },
    },
    ...blockerUpdate,
    ...cardAggregateUpdate,
    buildDynamoCardAuditEventPut({
      table_name: input.table_name,
      partition_key: input.partition_key,
      committed_at,
      event: input.audit_event,
    }),
    idempotencyPut(input, committed_at),
  ];
}

export function createDynamoHandoffTransactionClient(input: {
  client: Pick<DynamoDBClient, 'send'>;
  now?: () => Date;
}) {
  return {
    async transactCreateHandoff(transaction: DynamoHandoffCreateTransaction): Promise<void> {
      try {
        await input.client.send(
          new TransactWriteItemsCommand({
            TransactItems: buildDynamoHandoffCreateTransactWriteItems(
              transaction,
              (input.now?.() ?? new Date()).toISOString(),
            ),
          }),
        );
      } catch (error) {
        rethrowDynamoTransactionConflict(error, {
          resource: 'handoff_create',
          handoff_id: transaction.response.handoff.handoff_id,
          expected_card_server_version: transaction.expected_card_server_version,
        });
      }
    },
    async transactCommitHandoffTransition(
      transaction: DynamoHandoffTransitionTransaction,
    ): Promise<void> {
      try {
        await input.client.send(
          new TransactWriteItemsCommand({
            TransactItems: buildDynamoHandoffTransitionTransactWriteItems(
              transaction,
              (input.now?.() ?? new Date()).toISOString(),
            ),
          }),
        );
      } catch (error) {
        rethrowDynamoTransactionConflict(error, {
          resource: 'handoff_transition',
          handoff_id: transaction.response.handoff.handoff_id,
          expected_server_version: transaction.expected_server_version,
        });
      }
    },
  };
}
