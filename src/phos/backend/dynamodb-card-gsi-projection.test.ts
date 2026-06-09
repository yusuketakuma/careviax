import { describe, expect, it } from 'vitest';
import { CurrentStep, DisplayStatus } from '@/phos/contracts/phos_contracts';
import { buildDynamoCardGsiProjectionUpdate } from './dynamodb-card-gsi-projection';

describe('buildDynamoCardGsiProjectionUpdate', () => {
  it('projects board and status due-date sort keys from the canonical card state', () => {
    expect(
      buildDynamoCardGsiProjectionUpdate({
        tenant_partition_key: 'TENANT#tenant_abc123',
        card: {
          card_id: 'card_1',
          patient_id: 'patient_1',
          assigned_user_id: 'user_1',
          packet_id: 'packet_1',
          created_at: '2026-06-08T00:00:00.000Z',
          due_at: '2026-06-10T09:00:00.000Z',
          current_step: CurrentStep.DISPENSING,
          display_status: DisplayStatus.IN_PROGRESS,
        },
      }),
    ).toEqual({
      set: {
        GSI1PK: { S: 'TENANT#tenant_abc123#BOARD' },
        GSI1SK: { S: 'STEP#DISPENSING#DUE#2026-06-10T09:00:00.000Z#CARD#card_1' },
        GSI2PK: { S: 'TENANT#tenant_abc123#ASSIGNEE#user_1' },
        GSI2SK: { S: 'STATUS#IN_PROGRESS#DUE#2026-06-10T09:00:00.000Z#CARD#card_1' },
        GSI3PK: { S: 'TENANT#tenant_abc123#PATIENT#patient_1' },
        GSI3SK: { S: 'CREATED#2026-06-08T00:00:00.000Z#CARD#card_1' },
        GSI4PK: { S: 'TENANT#tenant_abc123#PACKET#packet_1' },
        GSI4SK: { S: 'CARD#card_1' },
      },
      remove: [],
    });
  });

  it('removes due-date sort keys when the projected card leaves the due queue', () => {
    expect(
      buildDynamoCardGsiProjectionUpdate({
        tenant_partition_key: 'TENANT#tenant_abc123',
        card: {
          card_id: 'card_1',
          current_step: CurrentStep.DISPENSING,
          display_status: DisplayStatus.IN_PROGRESS,
        },
      }),
    ).toEqual({
      set: {
        GSI1PK: { S: 'TENANT#tenant_abc123#BOARD' },
      },
      remove: ['GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'GSI4PK', 'GSI4SK'],
    });
  });
});
