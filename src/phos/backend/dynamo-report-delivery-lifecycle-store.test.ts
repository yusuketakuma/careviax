import { describe, expect, it, vi } from 'vitest';
import {
  ReportDeliveryStatus,
  UserRole,
  type ReportDeliveryMutationResponse,
  type ReportDeliveryView,
} from '@/phos/contracts/phos_contracts';
import {
  createDynamoReportDeliveryLifecycleStore,
  type DynamoReportDeliveryLifecycleClient,
  type DynamoReportDeliveryLifecycleMapper,
} from './dynamo-report-delivery-lifecycle-store';
import { PHOS_CORE_TABLE } from './dynamo-cards-repository';
import type { TenantContext } from './tenant-context';

type DeliveryItem = { delivery: ReportDeliveryView };
type IdempotencyItem = { fingerprint: string; saved?: ReportDeliveryMutationResponse };

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACY_CLERK,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/report-deliveries.write'],
};

function delivery(overrides: Partial<ReportDeliveryView> = {}): ReportDeliveryView {
  return {
    delivery_id: 'delivery_1',
    card_id: 'card_1',
    report_id: 'report_1',
    patient_name: '患者 山田太郎',
    target_label: '山田医師',
    sent_at: '2026-06-09T00:00:00.000Z',
    stale_minutes: 90,
    status: ReportDeliveryStatus.WAITING_REPLY,
    delivery_method: 'FAX',
    server_version: 1,
    source_refs: [{ kind: 'EVIDENCE_FILE', ref_id: 'report_1', label: '報告書' }],
    ...overrides,
  };
}

const mapper: DynamoReportDeliveryLifecycleMapper<DeliveryItem, IdempotencyItem> = {
  toReportDeliveryView: (item) => item.delivery,
  toIdempotencyRecord: (item) => ({
    request_fingerprint: item.fingerprint,
    response: item.saved,
  }),
};

function client(
  overrides: Partial<DynamoReportDeliveryLifecycleClient<DeliveryItem, IdempotencyItem>> = {},
): DynamoReportDeliveryLifecycleClient<DeliveryItem, IdempotencyItem> {
  return {
    getReportDelivery: vi.fn(async () => ({ delivery: delivery() })),
    getIdempotency: vi.fn(async () => null),
    transactCommitReportDeliveryTransition: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('createDynamoReportDeliveryLifecycleStore', () => {
  it('builds a tenant-scoped report delivery transition with a redacted card audit event', async () => {
    const fakeClient = client();
    const store = createDynamoReportDeliveryLifecycleStore(fakeClient, mapper, vi.fn());
    const previous = delivery();
    const response: ReportDeliveryMutationResponse = {
      delivery: delivery({
        status: ReportDeliveryStatus.ACTION_REQUIRED,
        stale_minutes: 0,
        reply_received_at: '2026-06-09T02:00:00.000Z',
        reply_summary: '追加確認が必要です。',
        action_required_note: '薬剤師が電話確認する。',
        server_version: 2,
      }),
      side_effects: [
        {
          type: 'REPORT_REPLY_REGISTERED',
          delivery_id: 'delivery_1',
          status: ReportDeliveryStatus.ACTION_REQUIRED,
        },
      ],
      server_version: 2,
    };

    await store.commitReportDeliveryTransition(ctx, {
      delivery_id: 'delivery_1',
      mutation_key: 'REGISTER_REPORT_REPLY:delivery_1',
      command: {
        result_status: ReportDeliveryStatus.ACTION_REQUIRED,
        reply_summary: '追加確認が必要です。',
        action_required_note: '薬剤師が電話確認する。',
        idempotency_key: 'idem_reply',
        client_version: 1,
      },
      request_fingerprint: 'fp_reply',
      previous_delivery: previous,
      response,
    });

    expect(fakeClient.transactCommitReportDeliveryTransition).toHaveBeenCalledWith({
      table_name: PHOS_CORE_TABLE,
      partition_key: 'TENANT#tenant_abc123',
      delivery_sort_key: 'REPORT_DELIVERY#delivery_1',
      status_gsi_pk: 'TENANT#tenant_abc123#REPORT_DELIVERY_STATUS#ACTION_REQUIRED',
      status_gsi_sk: 'STALE#00000000#SENT#2026-06-09T00:00:00.000Z#DELIVERY#delivery_1',
      idempotency_sort_key:
        'REPORT_DELIVERY_IDEMPOTENCY#REGISTER_REPORT_REPLY:delivery_1#idem_reply',
      idempotency_key: 'idem_reply',
      expected_server_version: 1,
      request_fingerprint: 'fp_reply',
      command: expect.objectContaining({ idempotency_key: 'idem_reply' }),
      response,
      audit_event: expect.objectContaining({
        event_id: 'REPORT_REPLY_REGISTERED#idem_reply',
        event_type: 'REPORT_REPLY_REGISTERED',
        card_id: 'card_1',
        actor_user_id: 'user_1',
        request_id: 'req_1',
        correlation_id: 'corr_1',
        before_json: expect.objectContaining({
          delivery_id: 'delivery_1',
          status: ReportDeliveryStatus.WAITING_REPLY,
          source_ref_count: 1,
        }),
        after_json: expect.not.objectContaining({
          reply_summary: '追加確認が必要です。',
          action_required_note: '薬剤師が電話確認する。',
        }),
      }),
    });
  });
});
