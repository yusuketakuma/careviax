import { describe, expect, it, vi } from 'vitest';
import {
  ReportDeliveryStatus,
  UserRole,
  type ReportDeliveryView,
} from '@/phos/contracts/phos_contracts';
import { toDynamoAttributeValue } from './dynamodb-attribute-values';
import { createDynamoReportDeliveriesRepository } from './dynamo-report-deliveries-repository';
import type { DynamoReportDeliveriesClient } from './dynamo-report-deliveries-repository';
import type { TenantContext } from './tenant-context';

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACY_CLERK,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/report-deliveries.read'],
};

function delivery(overrides: Partial<ReportDeliveryView> = {}): ReportDeliveryView {
  return {
    delivery_id: 'delivery_1',
    card_id: 'card_1',
    report_id: 'report_1',
    patient_name: '患者 山田太郎',
    target_label: '山田医師',
    status: ReportDeliveryStatus.WAITING_REPLY,
    delivery_method: 'FAX',
    sent_at: '2026-06-09T00:00:00.000Z',
    stale_minutes: 0,
    server_version: 1,
    source_refs: [{ kind: 'EVIDENCE_FILE', ref_id: 'report_1', label: '報告書' }],
    ...overrides,
  };
}

function client(
  overrides: Partial<DynamoReportDeliveriesClient> = {},
): DynamoReportDeliveriesClient {
  return {
    queryReportDeliveries: vi.fn(async () => ({
      items: [{ report_delivery: toDynamoAttributeValue(delivery({ stale_minutes: 90 })) }],
    })),
    ...overrides,
  };
}

describe('createDynamoReportDeliveriesRepository', () => {
  it('queries waiting reply deliveries through a tenant-scoped status GSI without scanning', async () => {
    const fakeClient = client();
    const repository = createDynamoReportDeliveriesRepository(fakeClient, {
      now: () => new Date('2026-06-09T01:30:00.000Z'),
    });

    await expect(
      repository.searchReportDeliveries(ctx, {
        status: ReportDeliveryStatus.WAITING_REPLY,
        limit: 25,
      }),
    ).resolves.toMatchObject({
      items: [{ delivery_id: 'delivery_1', stale_minutes: 90 }],
      server_time: '2026-06-09T01:30:00.000Z',
    });

    expect(fakeClient.queryReportDeliveries).toHaveBeenCalledWith({
      table_name: 'phos_core',
      index_name: 'GSI1',
      partition_key: 'TENANT#tenant_abc123#REPORT_DELIVERY_STATUS#WAITING_REPLY',
      limit: 25,
      cursor: undefined,
    });
  });

  it('filters mismatched status defensively and preserves cursors', async () => {
    const fakeClient = client({
      queryReportDeliveries: vi.fn(async () => ({
        items: [
          { report_delivery: toDynamoAttributeValue(delivery()) },
          {
            report_delivery: toDynamoAttributeValue(
              delivery({
                delivery_id: 'delivery_done',
                status: ReportDeliveryStatus.ACTION_DONE,
              }),
            ),
          },
        ],
        next_cursor: 'cursor_2',
      })),
    });
    const repository = createDynamoReportDeliveriesRepository(fakeClient, {
      now: () => new Date('2026-06-09T00:10:00.000Z'),
    });

    await expect(
      repository.searchReportDeliveries(ctx, {
        status: ReportDeliveryStatus.WAITING_REPLY,
        limit: 10,
        cursor: 'cursor_1',
      }),
    ).resolves.toMatchObject({
      items: [{ delivery_id: 'delivery_1' }],
      next_cursor: 'cursor_2',
    });
  });
});
