import { randomUUID } from 'node:crypto';
import {
  PutItemCommand,
  type DynamoDBClient,
  type PutItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import { sanitizeLogDetails } from './structured-logger';
import type { PhosSecurityEvent } from './observability';
import { dynamoKey, toDynamoAttributeValue } from './dynamodb-attribute-values';
import { tenantPk } from './dynamodb-keys';
import { PHOS_CORE_TABLE } from './dynamo-cards-repository';

export const PHOS_UNKNOWN_SECURITY_EVENT_PARTITION = 'SECURITY#UNKNOWN';

export function securityEventSk(input: { created_at: string; event_id: string }): string {
  return `SECURITY_EVENT#${input.created_at}#${input.event_id}`;
}

export function securityEventPartitionKey(event: Pick<PhosSecurityEvent, 'tenant_id'>): string {
  return event.tenant_id
    ? tenantPk({ tenant_id: event.tenant_id })
    : PHOS_UNKNOWN_SECURITY_EVENT_PARTITION;
}

export function buildDynamoSecurityEventPutInput(input: {
  table_name?: string;
  event: PhosSecurityEvent;
  event_id?: string;
  created_at: string;
}): PutItemCommandInput {
  const event_id = input.event_id ?? randomUUID();
  const details = input.event.details
    ? (sanitizeLogDetails(input.event.details) as Record<string, unknown>)
    : undefined;

  return {
    TableName: input.table_name ?? PHOS_CORE_TABLE,
    Item: {
      ...dynamoKey(
        securityEventPartitionKey(input.event),
        securityEventSk({ created_at: input.created_at, event_id }),
      ),
      entity_type: { S: 'SECURITY_EVENT' },
      event_id: { S: event_id },
      event_type: { S: input.event.event_type },
      severity: { S: input.event.severity },
      route_key: { S: input.event.route_key },
      error_code: { S: input.event.error_code },
      request_id: { S: input.event.request_id },
      correlation_id: { S: input.event.correlation_id },
      ...(input.event.tenant_id ? { tenant_id: { S: input.event.tenant_id } } : {}),
      ...(input.event.user_id ? { user_id: { S: input.event.user_id } } : {}),
      ...(details ? { details_json: toDynamoAttributeValue(details) } : {}),
      created_at: { S: input.created_at },
    },
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
  };
}

export async function recordDynamoSecurityEvent(input: {
  client: Pick<DynamoDBClient, 'send'>;
  table_name?: string;
  event: PhosSecurityEvent;
  event_id?: string;
  now?: () => Date;
}) {
  await input.client.send(
    new PutItemCommand(
      buildDynamoSecurityEventPutInput({
        table_name: input.table_name,
        event: input.event,
        event_id: input.event_id,
        created_at: (input.now?.() ?? new Date()).toISOString(),
      }),
    ),
  );
}
