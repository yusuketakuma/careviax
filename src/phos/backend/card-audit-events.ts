import type { TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { dynamoKey, toDynamoAttributeValue } from './dynamodb-attribute-values';
import { dynamoEntityMetadata } from './dynamodb-entity-metadata';
import { cardEventSk } from './dynamodb-keys';

export type DynamoCardAuditEvent = {
  event_id: string;
  event_type: string;
  card_id: string;
  action_code?: string;
  actor_user_id: string;
  request_id: string;
  correlation_id: string;
  before_json: unknown;
  after_json: unknown;
  subject_json?: unknown;
};

export function buildDynamoCardAuditEventPut(input: {
  table_name: string;
  partition_key: string;
  committed_at: string;
  event: DynamoCardAuditEvent;
}): TransactWriteItem {
  return {
    Put: {
      TableName: input.table_name,
      Item: {
        ...dynamoKey(
          input.partition_key,
          cardEventSk({
            card_id: input.event.card_id,
            created_at: input.committed_at,
            event_id: input.event.event_id,
          }),
        ),
        entity_type: { S: 'CARD_EVENT' },
        ...dynamoEntityMetadata({
          partition_key: input.partition_key,
          created_at: input.committed_at,
        }),
        event_type: { S: input.event.event_type },
        event_id: { S: input.event.event_id },
        card_id: { S: input.event.card_id },
        ...(input.event.action_code ? { action_code: { S: input.event.action_code } } : {}),
        actor_user_id: { S: input.event.actor_user_id },
        request_id: { S: input.event.request_id },
        correlation_id: { S: input.event.correlation_id },
        before_json: toDynamoAttributeValue(input.event.before_json),
        after_json: toDynamoAttributeValue(input.event.after_json),
        ...(input.event.subject_json !== undefined
          ? { subject_json: toDynamoAttributeValue(input.event.subject_json) }
          : {}),
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    },
  };
}
