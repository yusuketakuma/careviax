import {
  TransactWriteItemsCommand,
  type DynamoDBClient,
  type TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import type { DynamoActionCommitTransaction } from './dynamo-card-action-store';
import { buildDynamoCardAuditEventPut } from './card-audit-events';
import { dynamoKey, toDynamoAttributeValue } from './dynamodb-attribute-values';
import { dynamoEntityMetadata } from './dynamodb-entity-metadata';
import { rethrowDynamoTransactionConflict } from './dynamodb-transaction-errors';

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
    ...(input.claim_review_guard
      ? { '#unresolved_claim_candidate_count': 'unresolved_claim_candidate_count' }
      : {}),
  };
  const conditionExpression = input.claim_review_guard
    ? '#server_version = :expected_server_version AND attribute_exists(#unresolved_claim_candidate_count) AND #unresolved_claim_candidate_count = :zero_unresolved_claim_candidate_count'
    : '#server_version = :expected_server_version';

  return [
    {
      Update: {
        TableName: input.table_name,
        Key: dynamoKey(input.partition_key, input.card_sort_key),
        ConditionExpression: conditionExpression,
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
          ...(input.claim_review_guard
            ? { ':zero_unresolved_claim_candidate_count': { N: '0' } }
            : {}),
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
            ...dynamoEntityMetadata({
              partition_key: input.partition_key,
              created_at: committed_at,
            }),
            card_id: { S: input.projected_response.card.card_id },
            blocker_code: { S: blocker.blocker.blocker_code },
            active: { BOOL: blocker.blocker.active },
            blocker: toDynamoAttributeValue(blocker.blocker),
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
            ...dynamoEntityMetadata({
              partition_key: input.partition_key,
              created_at: committed_at,
              server_version: put.delivery.server_version,
            }),
            card_id: { S: put.delivery.card_id },
            report_id: { S: put.delivery.report_id },
            delivery_id: { S: put.delivery.delivery_id },
            status: { S: put.delivery.status },
            sent_at: { S: put.delivery.sent_at },
            GSI6PK: { S: put.status_gsi_pk },
            GSI6SK: { S: put.status_gsi_sk },
            report_delivery: toDynamoAttributeValue(put.delivery),
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      }),
    ),
    buildDynamoCardAuditEventPut({
      table_name: input.table_name,
      partition_key: input.partition_key,
      committed_at,
      event: {
        event_id: input.audit_event.event_id,
        event_type: input.audit_event.event_type,
        card_id: input.projected_response.card.card_id,
        action_code: input.audit_event.action_code,
        actor_user_id: input.audit_event.actor_user_id,
        request_id: input.audit_event.request_id,
        correlation_id: input.audit_event.correlation_id,
        before_json: input.audit_event.before_card,
        after_json: input.audit_event.after_card,
      },
    }),
    {
      Put: {
        TableName: input.table_name,
        Item: {
          ...dynamoKey(input.partition_key, input.idempotency_sort_key),
          entity_type: { S: 'CARD_ACTION_IDEMPOTENCY' },
          ...dynamoEntityMetadata({
            partition_key: input.partition_key,
            created_at: committed_at,
          }),
          card_id: { S: input.projected_response.card.card_id },
          idempotency_key: { S: input.command.idempotency_key },
          request_fingerprint: { S: input.request_fingerprint },
          response_json: { S: JSON.stringify(input.projected_response) },
          action_code: { S: input.command.action_code },
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
      try {
        await input.client.send(
          new TransactWriteItemsCommand({
            TransactItems: buildDynamoActionCommitTransactWriteItems(
              transaction,
              (input.now?.() ?? new Date()).toISOString(),
            ),
          }),
        );
      } catch (error) {
        rethrowDynamoTransactionConflict(error, {
          resource: 'card_action',
          card_id: transaction.projected_response.card.card_id,
          expected_server_version: transaction.expected_server_version,
        });
      }
    },
  };
}
