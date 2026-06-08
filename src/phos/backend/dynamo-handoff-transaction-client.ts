import {
  TransactWriteItemsCommand,
  type DynamoDBClient,
  type TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import {
  type DynamoHandoffCreateTransaction,
  type DynamoHandoffTransitionTransaction,
  handoffUrgencyQueueRank,
} from './dynamo-handoff-lifecycle-store';
import { dynamoKey, toDynamoAttributeValue } from './dynamodb-attribute-values';
import { cardBlockerSk, handoffAssigneeGsiSk } from './dynamodb-keys';

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
        handoff_id: { S: input.response.handoff.handoff_id },
        idempotency_key: { S: input.idempotency_key },
        request_fingerprint: { S: input.request_fingerprint },
        response_json: { S: JSON.stringify(input.response) },
        created_at: { S: committed_at },
      },
      ConditionExpression: 'attribute_not_exists(PK) OR request_fingerprint = :request_fingerprint',
      ExpressionAttributeValues: {
        ':request_fingerprint': { S: input.request_fingerprint },
      },
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
          GSI1PK: { S: input.queue_gsi_pk },
          GSI1SK: { S: queueSortKey(input) },
          handoff_id: { S: handoff.handoff_id },
          card_id: { S: handoff.card_id },
          status: { S: handoff.status },
          urgency: { S: handoff.urgency },
          urgency_rank: { N: String(handoffUrgencyQueueRank(handoff.urgency)) },
          server_version: { N: String(handoff.server_version) },
          created_by_user_id: { S: handoff.created_by_user_id },
          ...(handoff.assignee_user_id
            ? { assignee_user_id: { S: handoff.assignee_user_id } }
            : {}),
          created_at: { S: handoff.created_at },
          updated_at: { S: committed_at },
          handoff: toDynamoAttributeValue(handoff),
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
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
  const cardAggregateUpdate: TransactWriteItem[] = cardAggregate?.update
    ? [
        {
          Update: {
            TableName: input.table_name,
            Key: dynamoKey(input.partition_key, cardAggregate.card_sort_key),
            ConditionExpression: '#server_version = :expected_card_server_version',
            UpdateExpression:
              'SET #server_version = :card_server_version, #display_status = :card_display_status, #updated_at = :updated_at, #card = :card, #next_action = :next_action, #blockers = :blockers',
            ExpressionAttributeNames: {
              '#server_version': 'server_version',
              '#display_status': 'display_status',
              '#updated_at': 'updated_at',
              '#card': 'card',
              '#next_action': 'next_action',
              '#blockers': 'blockers',
            },
            ExpressionAttributeValues: {
              ':expected_card_server_version': {
                N: String(cardAggregate.expected_card_server_version),
              },
              ':card_server_version': { N: String(cardAggregate.update.server_version) },
              ':card_display_status': {
                S: cardAggregate.update.card.display_status,
              },
              ':updated_at': { S: committed_at },
              ':card': toDynamoAttributeValue(cardAggregate.update.card),
              ':next_action': toDynamoAttributeValue(cardAggregate.update.next_action),
              ':blockers': toDynamoAttributeValue(cardAggregate.update.blockers),
            },
          },
        },
      ]
    : [];

  return [
    {
      Update: {
        TableName: input.table_name,
        Key: dynamoKey(input.partition_key, input.handoff_sort_key),
        ConditionExpression: '#server_version = :expected_server_version',
        UpdateExpression:
          'SET #server_version = :server_version, #status = :status, #updated_at = :updated_at, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, handoff = :handoff',
        ExpressionAttributeNames: {
          '#server_version': 'server_version',
          '#status': 'status',
          '#updated_at': 'updated_at',
        },
        ExpressionAttributeValues: {
          ':expected_server_version': { N: String(input.expected_server_version) },
          ':server_version': { N: String(input.response.server_version) },
          ':status': { S: handoff.status },
          ':updated_at': { S: committed_at },
          ':gsi1pk': { S: input.queue_gsi_pk },
          ':gsi1sk': { S: queueSortKey(input) },
          ':handoff': toDynamoAttributeValue(handoff),
        },
      },
    },
    ...blockerUpdate,
    ...cardAggregateUpdate,
    idempotencyPut(input, committed_at),
  ];
}

export function createDynamoHandoffTransactionClient(input: {
  client: Pick<DynamoDBClient, 'send'>;
  now?: () => Date;
}) {
  return {
    async transactCreateHandoff(transaction: DynamoHandoffCreateTransaction): Promise<void> {
      await input.client.send(
        new TransactWriteItemsCommand({
          TransactItems: buildDynamoHandoffCreateTransactWriteItems(
            transaction,
            (input.now?.() ?? new Date()).toISOString(),
          ),
        }),
      );
    },
    async transactCommitHandoffTransition(
      transaction: DynamoHandoffTransitionTransaction,
    ): Promise<void> {
      await input.client.send(
        new TransactWriteItemsCommand({
          TransactItems: buildDynamoHandoffTransitionTransactWriteItems(
            transaction,
            (input.now?.() ?? new Date()).toISOString(),
          ),
        }),
      );
    },
  };
}
