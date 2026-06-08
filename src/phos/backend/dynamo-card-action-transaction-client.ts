import {
  TransactWriteItemsCommand,
  type DynamoDBClient,
  type TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import type { DynamoActionCommitTransaction } from './dynamo-card-action-store';
import { dynamoKey, toDynamoAttributeValue } from './dynamodb-attribute-values';

export function buildDynamoActionCommitTransactWriteItems(
  input: DynamoActionCommitTransaction,
  committed_at: string,
): TransactWriteItem[] {
  const expressionAttributeNames = {
    '#server_version': 'server_version',
    '#current_step': 'current_step',
    '#display_status': 'display_status',
    '#action_code': 'last_action_code',
    '#updated_at': 'updated_at',
    '#card': 'card',
    '#next_action': 'next_action',
    '#blockers': 'blockers',
  };

  return [
    {
      Update: {
        TableName: input.table_name,
        Key: dynamoKey(input.partition_key, input.card_sort_key),
        ConditionExpression: '#server_version = :expected_server_version',
        UpdateExpression:
          'SET #server_version = :server_version, #current_step = :current_step, #display_status = :display_status, #action_code = :action_code, #updated_at = :updated_at, #card = :card, #next_action = :next_action, #blockers = :blockers',
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: {
          ':expected_server_version': { N: String(input.expected_server_version) },
          ':server_version': { N: String(input.projected_response.server_version) },
          ':current_step': { S: input.projected_response.card.current_step },
          ':display_status': { S: input.projected_response.display_status },
          ':action_code': { S: input.command.action_code },
          ':updated_at': { S: committed_at },
          ':card': toDynamoAttributeValue(input.projected_response.card),
          ':next_action': toDynamoAttributeValue(input.projected_response.next_action),
          ':blockers': toDynamoAttributeValue(input.projected_response.blockers),
        },
      },
    },
    ...input.blocker_puts.map(
      (blocker): TransactWriteItem => ({
        Put: {
          TableName: input.table_name,
          Item: {
            ...dynamoKey(input.partition_key, blocker.sort_key),
            entity_type: { S: 'CARD_BLOCKER' },
            card_id: { S: input.projected_response.card.card_id },
            blocker_code: { S: blocker.blocker.blocker_code },
            active: { BOOL: blocker.blocker.active },
            blocker: toDynamoAttributeValue(blocker.blocker),
            updated_at: { S: committed_at },
          },
          ConditionExpression: 'attribute_not_exists(PK) OR blocker_code = :blocker_code',
          ExpressionAttributeValues: {
            ':blocker_code': { S: blocker.blocker.blocker_code },
          },
        },
      }),
    ),
    ...input.blocker_resolutions.map(
      (blocker): TransactWriteItem => ({
        Update: {
          TableName: input.table_name,
          Key: dynamoKey(input.partition_key, blocker.sort_key),
          ConditionExpression: 'attribute_exists(PK)',
          UpdateExpression:
            'SET active = :active, resolved_at = :resolved_at, updated_at = :updated_at',
          ExpressionAttributeValues: {
            ':active': { BOOL: false },
            ':resolved_at': { S: committed_at },
            ':updated_at': { S: committed_at },
          },
        },
      }),
    ),
    ...input.report_delivery_puts.map(
      (put): TransactWriteItem => ({
        Put: {
          TableName: input.table_name,
          Item: {
            ...dynamoKey(input.partition_key, put.sort_key),
            entity_type: { S: 'REPORT_DELIVERY' },
            card_id: { S: put.delivery.card_id },
            report_id: { S: put.delivery.report_id },
            delivery_id: { S: put.delivery.delivery_id },
            status: { S: put.delivery.status },
            sent_at: { S: put.delivery.sent_at },
            server_version: { N: String(put.delivery.server_version) },
            GSI1PK: { S: put.status_gsi_pk },
            GSI1SK: { S: put.status_gsi_sk },
            report_delivery: toDynamoAttributeValue(put.delivery),
            created_at: { S: committed_at },
            updated_at: { S: committed_at },
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      }),
    ),
    {
      Put: {
        TableName: input.table_name,
        Item: {
          ...dynamoKey(input.partition_key, input.idempotency_sort_key),
          entity_type: { S: 'CARD_ACTION_IDEMPOTENCY' },
          card_id: { S: input.projected_response.card.card_id },
          idempotency_key: { S: input.command.idempotency_key },
          request_fingerprint: { S: input.request_fingerprint },
          response_json: { S: JSON.stringify(input.projected_response) },
          action_code: { S: input.command.action_code },
          created_at: { S: committed_at },
        },
        ConditionExpression:
          'attribute_not_exists(PK) OR request_fingerprint = :request_fingerprint',
        ExpressionAttributeValues: {
          ':request_fingerprint': { S: input.request_fingerprint },
        },
      },
    },
  ];
}

export function createDynamoCardActionTransactionClient(input: {
  client: Pick<DynamoDBClient, 'send'>;
  now?: () => Date;
}) {
  return {
    async transactCommitAction(transaction: DynamoActionCommitTransaction): Promise<void> {
      await input.client.send(
        new TransactWriteItemsCommand({
          TransactItems: buildDynamoActionCommitTransactWriteItems(
            transaction,
            (input.now?.() ?? new Date()).toISOString(),
          ),
        }),
      );
    },
  };
}
