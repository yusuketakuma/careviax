import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDynamoEvidenceUploadIntentTransactWriteItems,
  createDynamoEvidenceUploadIntentStore,
  type DynamoEvidenceUploadIntentTransaction,
} from './evidence-upload-intent-store';
import type { TenantContext } from './tenant-context';
import { ActionCode, UserRole } from '@/phos/contracts/phos_contracts';

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/evidence.write'],
};

function transaction(
  overrides: Partial<DynamoEvidenceUploadIntentTransaction> = {},
): DynamoEvidenceUploadIntentTransaction {
  return {
    table_name: 'phos_core',
    partition_key: 'TENANT#tenant_abc123',
    evidence_sort_key: 'EVIDENCE#evidence_1',
    actor_user_id: 'user_1',
    request_id: 'req_1',
    correlation_id: 'corr_1',
    intent: {
      evidence_id: 'evidence_1',
      card_id: 'card_1',
      evidence_type: 'PHOTO',
      s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      mime_type: 'image/jpeg',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
      expires_in_seconds: 300,
    },
    ...overrides,
  };
}

describe('Dynamo evidence upload intent store', () => {
  it('builds an evidence item and card audit event without original file names', () => {
    const items = buildDynamoEvidenceUploadIntentTransactWriteItems(
      transaction(),
      '2026-06-09T07:30:00.000Z',
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      Put: {
        TableName: 'phos_core',
        Item: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'EVIDENCE#evidence_1' },
          entity_type: { S: 'EVIDENCE' },
          evidence_id: { S: 'evidence_1' },
          card_id: { S: 'card_1' },
          evidence_type: { S: 'PHOTO' },
          s3_key: { S: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg' },
          upload_status: { S: 'PRESIGNED' },
          created_by_user_id: { S: 'user_1' },
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    });
    expect(items[1]).toMatchObject({
      Put: {
        Item: {
          SK: {
            S: 'CARD_EVENT#card_1#2026-06-09T07:30:00.000Z#EVIDENCE_PRESIGN_CREATED#evidence_1',
          },
          entity_type: { S: 'CARD_EVENT' },
          event_type: { S: 'EVIDENCE_PRESIGN_CREATED' },
          action_code: { S: ActionCode.UPLOAD_EVIDENCE },
          actor_user_id: { S: 'user_1' },
          before_json: { NULL: true },
        },
      },
    });
    expect(JSON.stringify(items)).not.toContain('photo.jpg');
    expect(JSON.stringify(items)).not.toContain('患者');
  });

  it('sends TransactWriteItemsCommand through the provided DynamoDB client', async () => {
    const send = vi.fn(async (command: TransactWriteItemsCommand) => {
      expect(command).toBeInstanceOf(TransactWriteItemsCommand);
      return {};
    });
    const store = createDynamoEvidenceUploadIntentStore({
      client: { send },
      now: () => new Date('2026-06-09T07:30:00.000Z'),
    });

    await store.recordUploadIntent(ctx, transaction().intent);

    expect(send).toHaveBeenCalledOnce();
    const sent = send.mock.calls[0]?.[0] as TransactWriteItemsCommand;
    expect(sent.input.TransactItems).toHaveLength(2);
  });
});
