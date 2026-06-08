import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { ReportDeliveryStatus, type ReportDeliveryView } from '@/phos/contracts/phos_contracts';
import type { DynamoReportDeliveryTransitionTransaction } from './dynamo-report-delivery-lifecycle-store';
import {
  buildDynamoReportDeliveryTransitionTransactWriteItems,
  createDynamoReportDeliveryTransactionClient,
} from './dynamo-report-delivery-transaction-client';

function delivery(overrides: Partial<ReportDeliveryView> = {}): ReportDeliveryView {
  return {
    delivery_id: 'delivery_1',
    card_id: 'card_1',
    report_id: 'report_1',
    patient_name: '患者 山田太郎',
    target_label: '山田医師',
    sent_at: '2026-06-09T00:00:00.000Z',
    stale_minutes: 0,
    status: ReportDeliveryStatus.ACTION_DONE,
    delivery_method: 'FAX',
    server_version: 2,
    reply_summary: '問題ありません。',
    reply_received_at: '2026-06-09T02:00:00.000Z',
    action_done_at: '2026-06-09T02:00:00.000Z',
    source_refs: [],
    ...overrides,
  };
}

function transaction(
  overrides: Partial<DynamoReportDeliveryTransitionTransaction> = {},
): DynamoReportDeliveryTransitionTransaction {
  return {
    table_name: 'phos_core',
    partition_key: 'TENANT#tenant_abc123',
    delivery_sort_key: 'REPORT_DELIVERY#delivery_1',
    status_gsi_pk: 'TENANT#tenant_abc123#REPORT_DELIVERY_STATUS#ACTION_DONE',
    status_gsi_sk: 'STALE#00000000#SENT#2026-06-09T00:00:00.000Z#DELIVERY#delivery_1',
    idempotency_sort_key:
      'REPORT_DELIVERY_IDEMPOTENCY#REGISTER_REPORT_REPLY:delivery_1#idem_reply',
    idempotency_key: 'idem_reply',
    expected_server_version: 1,
    request_fingerprint: 'fp_1',
    command: {
      result_status: ReportDeliveryStatus.ACTION_DONE,
      reply_summary: '問題ありません。',
      idempotency_key: 'idem_reply',
      client_version: 1,
    },
    response: {
      delivery: delivery(),
      side_effects: [
        {
          type: 'REPORT_REPLY_REGISTERED',
          delivery_id: 'delivery_1',
          status: ReportDeliveryStatus.ACTION_DONE,
        },
      ],
      server_version: 2,
    },
    ...overrides,
  };
}

describe('Dynamo report delivery transaction client', () => {
  it('updates the delivery status and saves idempotency in one transaction', () => {
    const items = buildDynamoReportDeliveryTransitionTransactWriteItems(
      transaction(),
      '2026-06-09T02:00:00.000Z',
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      Update: {
        TableName: 'phos_core',
        Key: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'REPORT_DELIVERY#delivery_1' },
        },
        ConditionExpression: '#server_version = :expected_server_version',
        ExpressionAttributeValues: {
          ':expected_server_version': { N: '1' },
          ':server_version': { N: '2' },
          ':status': { S: ReportDeliveryStatus.ACTION_DONE },
          ':gsi1pk': { S: 'TENANT#tenant_abc123#REPORT_DELIVERY_STATUS#ACTION_DONE' },
          ':gsi1sk': {
            S: 'STALE#00000000#SENT#2026-06-09T00:00:00.000Z#DELIVERY#delivery_1',
          },
        },
      },
    });
    expect(items[1]).toMatchObject({
      Put: {
        Item: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: {
            S: 'REPORT_DELIVERY_IDEMPOTENCY#REGISTER_REPORT_REPLY:delivery_1#idem_reply',
          },
          entity_type: { S: 'REPORT_DELIVERY_IDEMPOTENCY' },
          request_fingerprint: { S: 'fp_1' },
        },
      },
    });
  });

  it('sends TransactWriteItemsCommand through the provided DynamoDB client', async () => {
    const send = vi.fn(async (command: TransactWriteItemsCommand) => {
      expect(command).toBeDefined();
      return {};
    });
    const client = createDynamoReportDeliveryTransactionClient({
      client: { send },
      now: () => new Date('2026-06-09T02:00:00.000Z'),
    });

    await client.transactCommitReportDeliveryTransition(transaction());

    expect(send).toHaveBeenCalledOnce();
    const sent = (send.mock.calls as unknown as [[TransactWriteItemsCommand]])[0][0];
    expect(sent).toBeInstanceOf(TransactWriteItemsCommand);
  });
});
