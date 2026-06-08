import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDynamoSecurityEventPutInput,
  PHOS_UNKNOWN_SECURITY_EVENT_PARTITION,
  recordDynamoSecurityEvent,
} from './security-events';
import type { PhosSecurityEvent } from './observability';

const event: PhosSecurityEvent = {
  event_type: 'AUTHORIZATION_DENIED',
  severity: 'WARNING',
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  request_id: 'req_1',
  correlation_id: 'corr_1',
  route_key: 'GET /cards',
  error_code: 'FORBIDDEN',
  details: {
    missing_scopes: ['phos/cards.read'],
    patient_name: '患者 山田太郎',
  },
};

describe('PH-OS security events', () => {
  it('builds tenant-scoped DynamoDB security event puts with redacted details', () => {
    const input = buildDynamoSecurityEventPutInput({
      table_name: 'phos_core',
      event,
      event_id: 'sec_evt_1',
      created_at: '2026-06-09T06:30:00.000Z',
    });

    expect(input).toMatchObject({
      TableName: 'phos_core',
      Item: {
        PK: { S: 'TENANT#tenant_abc123' },
        SK: { S: 'SECURITY_EVENT#2026-06-09T06:30:00.000Z#sec_evt_1' },
        entity_type: { S: 'SECURITY_EVENT' },
        event_type: { S: 'AUTHORIZATION_DENIED' },
        severity: { S: 'WARNING' },
        tenant_id: { S: 'tenant_abc123' },
        user_id: { S: 'user_1' },
        request_id: { S: 'req_1' },
        correlation_id: { S: 'corr_1' },
        details_json: {
          M: {
            missing_scopes: { L: [{ S: 'phos/cards.read' }] },
            patient_name: { S: '[REDACTED]' },
          },
        },
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    });
    expect(JSON.stringify(input)).not.toContain('患者 山田太郎');
  });

  it('uses a bounded unknown partition for pre-context boundary events', () => {
    const input = buildDynamoSecurityEventPutInput({
      event: {
        event_type: 'TENANT_BOUNDARY_REJECTED',
        severity: 'ERROR',
        request_id: 'req_2',
        correlation_id: 'corr_2',
        route_key: 'GET /cards',
        error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
        details: { source: 'query' },
      },
      event_id: 'sec_evt_2',
      created_at: '2026-06-09T06:31:00.000Z',
    });

    expect(input.Item?.PK).toEqual({ S: PHOS_UNKNOWN_SECURITY_EVENT_PARTITION });
    expect(input.Item).not.toHaveProperty('tenant_id');
    expect(input.Item).not.toHaveProperty('user_id');
  });

  it('sends PutItemCommand through the provided DynamoDB client', async () => {
    const send = vi.fn(async (command: PutItemCommand) => {
      expect(command).toBeInstanceOf(PutItemCommand);
      return {};
    });

    await recordDynamoSecurityEvent({
      client: { send },
      table_name: 'phos_core',
      event,
      event_id: 'sec_evt_3',
      now: () => new Date('2026-06-09T06:32:00.000Z'),
    });

    expect(send).toHaveBeenCalledOnce();
  });
});
