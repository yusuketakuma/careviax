import {
  TransactWriteItemsCommand,
  type DynamoDBClient,
  type TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import type { DynamoReportDeliveryTransitionTransaction } from './dynamo-report-delivery-lifecycle-store';
import { buildDynamoCardAuditEventPut } from './card-audit-events';
import { dynamoKey, toDynamoAttributeValue } from './dynamodb-attribute-values';
import { dynamoEntityMetadata } from './dynamodb-entity-metadata';
import { rethrowDynamoTransactionConflict } from './dynamodb-transaction-errors';

function idempotencyPut(
  input: DynamoReportDeliveryTransitionTransaction,
  committed_at: string,
): TransactWriteItem {
  return {
    Put: {
      TableName: input.table_name,
      Item: {
        ...dynamoKey(input.partition_key, input.idempotency_sort_key),
        entity_type: { S: 'REPORT_DELIVERY_IDEMPOTENCY' },
        ...dynamoEntityMetadata({
          partition_key: input.partition_key,
          created_at: committed_at,
        }),
        delivery_id: { S: input.response.delivery.delivery_id },
        idempotency_key: { S: input.idempotency_key },
        actor_user_id: { S: input.actor_user_id },
        request_fingerprint: { S: input.request_fingerprint },
        response_json: { S: JSON.stringify(input.response) },
      },
      ConditionExpression:
        'attribute_not_exists(PK) OR (request_fingerprint = :request_fingerprint AND actor_user_id = :actor_user_id)',
      ExpressionAttributeValues: {
        ':actor_user_id': { S: input.actor_user_id },
        ':request_fingerprint': { S: input.request_fingerprint },
      },
    },
  };
}

export function buildDynamoReportDeliveryTransitionTransactWriteItems(
  input: DynamoReportDeliveryTransitionTransaction,
  committed_at: string,
): TransactWriteItem[] {
  const delivery = input.response.delivery;
  return [
    {
      Update: {
        TableName: input.table_name,
        Key: dynamoKey(input.partition_key, input.delivery_sort_key),
        ConditionExpression: '#server_version = :expected_server_version',
        UpdateExpression:
          'SET #server_version = :server_version, #status = :status, #updated_at = :updated_at, GSI6PK = :gsi6pk, GSI6SK = :gsi6sk, report_delivery = :report_delivery, reply_received_at = :reply_received_at, reply_summary = :reply_summary, action_required_note = :action_required_note, action_done_at = :action_done_at, action_done_by_user_id = :action_done_by_user_id',
        ExpressionAttributeNames: {
          '#server_version': 'server_version',
          '#status': 'status',
          '#updated_at': 'updated_at',
        },
        ExpressionAttributeValues: {
          ':expected_server_version': { N: String(input.expected_server_version) },
          ':server_version': { N: String(input.response.server_version) },
          ':status': { S: delivery.status },
          ':updated_at': { S: committed_at },
          ':gsi6pk': { S: input.status_gsi_pk },
          ':gsi6sk': { S: input.status_gsi_sk },
          ':report_delivery': toDynamoAttributeValue(delivery),
          ':reply_received_at': toDynamoAttributeValue(delivery.reply_received_at ?? null),
          ':reply_summary': toDynamoAttributeValue(delivery.reply_summary ?? null),
          ':action_required_note': toDynamoAttributeValue(delivery.action_required_note ?? null),
          ':action_done_at': toDynamoAttributeValue(delivery.action_done_at ?? null),
          ':action_done_by_user_id': toDynamoAttributeValue(
            delivery.action_done_by_user_id ?? null,
          ),
        },
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

export function createDynamoReportDeliveryTransactionClient(input: {
  client: Pick<DynamoDBClient, 'send'>;
  now?: () => Date;
}) {
  return {
    async transactCommitReportDeliveryTransition(
      transaction: DynamoReportDeliveryTransitionTransaction,
    ): Promise<void> {
      try {
        await input.client.send(
          new TransactWriteItemsCommand({
            TransactItems: buildDynamoReportDeliveryTransitionTransactWriteItems(
              transaction,
              (input.now?.() ?? new Date()).toISOString(),
            ),
          }),
        );
      } catch (error) {
        rethrowDynamoTransactionConflict(error, {
          resource: 'report_delivery_transition',
          delivery_id: transaction.response.delivery.delivery_id,
          expected_server_version: transaction.expected_server_version,
        });
      }
    },
  };
}
