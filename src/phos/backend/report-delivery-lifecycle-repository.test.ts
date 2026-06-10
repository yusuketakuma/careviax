import { describe, expect, it, vi } from 'vitest';
import {
  ReportDeliveryStatus,
  UserRole,
  type ReportDeliveryView,
} from '@/phos/contracts/phos_contracts';
import { PhosDomainError } from './cards-repository';
import {
  createReportDeliveryLifecycleRepository,
  type IdempotentReportDeliveryLookup,
  type ReportDeliveryLifecycleStore,
} from './report-delivery-lifecycle-repository';
import type { TenantContext } from './tenant-context';

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

function store(
  overrides: Partial<ReportDeliveryLifecycleStore> = {},
): ReportDeliveryLifecycleStore {
  return {
    searchReportDeliveries: vi.fn(),
    getIdempotentMutation: vi.fn(
      async (): Promise<IdempotentReportDeliveryLookup> => ({ status: 'MISS' }),
    ),
    loadReportDelivery: vi.fn(async () => delivery()),
    commitReportDeliveryTransition: vi.fn(async (_ctx, input) => input.response),
    ...overrides,
  };
}

describe('ReportDelivery lifecycle repository', () => {
  it('registers a reply with idempotency and advances the delivery version', async () => {
    const fakeStore = store();
    const repo = createReportDeliveryLifecycleRepository(fakeStore, {
      now: () => new Date('2026-06-09T02:00:00.000Z'),
    });

    const response = await repo.registerReportReply(ctx, 'delivery_1', {
      result_status: ReportDeliveryStatus.ACTION_REQUIRED,
      reply_summary: '追加確認が必要です。',
      action_required_note: '薬剤師が電話確認する。',
      idempotency_key: 'idem_reply',
      client_version: 1,
    });

    expect(response.delivery).toMatchObject({
      delivery_id: 'delivery_1',
      status: ReportDeliveryStatus.ACTION_REQUIRED,
      reply_summary: '追加確認が必要です。',
      action_required_note: '薬剤師が電話確認する。',
      reply_received_at: '2026-06-09T02:00:00.000Z',
      server_version: 2,
    });
    expect(fakeStore.getIdempotentMutation).toHaveBeenCalledWith(
      ctx,
      'REGISTER_REPORT_REPLY:delivery_1',
      'idem_reply',
      expect.any(String),
    );
    expect(fakeStore.commitReportDeliveryTransition).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        mutation_key: 'REGISTER_REPORT_REPLY:delivery_1',
        previous_delivery: expect.objectContaining({ server_version: 1 }),
        response,
      }),
    );
  });

  it('returns saved idempotent responses and rejects stale versions', async () => {
    const saved = {
      delivery: delivery({ status: ReportDeliveryStatus.ACTION_DONE, server_version: 2 }),
      side_effects: [{ type: 'REPORT_ACTION_DONE' as const, delivery_id: 'delivery_1' }],
      server_version: 2,
    };
    const idempotentStore = store({
      getIdempotentMutation: vi.fn(
        async (): Promise<IdempotentReportDeliveryLookup> => ({
          status: 'MATCH',
          response: saved,
        }),
      ),
    });
    const repo = createReportDeliveryLifecycleRepository(idempotentStore);

    await expect(
      repo.registerReportReply(ctx, 'delivery_1', {
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '問題ありません。',
        idempotency_key: 'idem_reply',
        client_version: 1,
      }),
    ).resolves.toEqual(saved);
    expect(idempotentStore.loadReportDelivery).not.toHaveBeenCalled();

    const staleRepo = createReportDeliveryLifecycleRepository(store());
    await expect(
      staleRepo.registerReportReply(ctx, 'delivery_1', {
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '問題ありません。',
        idempotency_key: 'idem_reply',
        client_version: 0,
      }),
    ).rejects.toMatchObject({ status: 409, error_code: 'STALE_VERSION' });
  });

  it('rejects idempotency conflicts without loading or returning cached report PHI', async () => {
    const conflictStore = store({
      getIdempotentMutation: vi.fn(
        async (): Promise<IdempotentReportDeliveryLookup> => ({
          status: 'CONFLICT',
          existing_request_fingerprint: 'fp_other_actor',
        }),
      ),
    });
    const repo = createReportDeliveryLifecycleRepository(conflictStore);

    await expect(
      repo.registerReportReply(ctx, 'delivery_1', {
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '患者情報を含む返信',
        idempotency_key: 'idem_reply',
        client_version: 1,
      }),
    ).rejects.toMatchObject({
      status: 409,
      error_code: 'IDEMPOTENCY_CONFLICT',
      details: { idempotency_key: 'idem_reply' },
    });
    expect(conflictStore.loadReportDelivery).not.toHaveBeenCalled();
    expect(conflictStore.commitReportDeliveryTransition).not.toHaveBeenCalled();
  });

  it('replays matching idempotent responses after commit races', async () => {
    const saved = {
      delivery: delivery({ status: ReportDeliveryStatus.ACTION_DONE, server_version: 2 }),
      side_effects: [{ type: 'REPORT_ACTION_DONE' as const, delivery_id: 'delivery_1' }],
      server_version: 2,
    };
    const fakeStore = store({
      getIdempotentMutation: vi
        .fn()
        .mockResolvedValueOnce({ status: 'MISS' as const })
        .mockResolvedValueOnce({ status: 'MATCH' as const, response: saved }),
      commitReportDeliveryTransition: vi.fn(async () => {
        throw new PhosDomainError({
          status: 409,
          error_code: 'STALE_VERSION',
          message_key: 'api.error.stale_version',
        });
      }),
    });
    const repo = createReportDeliveryLifecycleRepository(fakeStore);

    await expect(
      repo.registerReportReply(ctx, 'delivery_1', {
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '問題ありません。',
        idempotency_key: 'idem_reply',
        client_version: 1,
      }),
    ).resolves.toEqual(saved);
    expect(fakeStore.getIdempotentMutation).toHaveBeenCalledTimes(2);
  });

  it('marks only action-required deliveries done', async () => {
    const fakeStore = store({
      loadReportDelivery: vi.fn(async () =>
        delivery({ status: ReportDeliveryStatus.ACTION_REQUIRED, server_version: 2 }),
      ),
    });
    const repo = createReportDeliveryLifecycleRepository(fakeStore, {
      now: () => new Date('2026-06-09T03:00:00.000Z'),
    });

    await expect(
      repo.markReportActionDone(ctx, 'delivery_1', {
        action_note: '電話で確認済み。',
        idempotency_key: 'idem_done',
        client_version: 2,
      }),
    ).resolves.toMatchObject({
      delivery: {
        status: ReportDeliveryStatus.ACTION_DONE,
        action_done_at: '2026-06-09T03:00:00.000Z',
        action_done_by_user_id: 'user_1',
        server_version: 3,
      },
    });

    const guardedRepo = createReportDeliveryLifecycleRepository(store());
    await expect(
      guardedRepo.markReportActionDone(ctx, 'delivery_1', {
        action_note: '確認済み。',
        idempotency_key: 'idem_done',
        client_version: 1,
      }),
    ).rejects.toMatchObject({ status: 422, error_code: 'ACTION_GUARD_FAILED' });
  });
});
