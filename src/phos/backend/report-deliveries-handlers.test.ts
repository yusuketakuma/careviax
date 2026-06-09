import { describe, expect, it, vi } from 'vitest';
import {
  ReportDeliveryStatus,
  UserRole,
  type ReportDeliveryMutationResponse,
  type ReportDeliverySearchResponse,
} from '@/phos/contracts/phos_contracts';
import type { PhosLambdaResponse } from './error-response';
import {
  createMarkReportActionDoneHandler,
  createRegisterReportReplyHandler,
  createReportDeliverySearchHandler,
} from './report-deliveries-handlers';
import type { PhosReportDeliveriesRepository } from './report-deliveries-repository';
import type { TenantContext } from './tenant-context';

function ctx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenant_id: 'tenant_abc123',
    user_id: 'user_1',
    role: UserRole.PHARMACY_CLERK,
    request_id: 'req_1',
    correlation_id: 'corr_1',
    scopes: ['phos/report-deliveries.read'],
    ...overrides,
  };
}

function response(): ReportDeliverySearchResponse {
  return {
    items: [],
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function mutationResponse(): ReportDeliveryMutationResponse {
  return {
    delivery: {
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
      source_refs: [],
    },
    side_effects: [{ type: 'REPORT_ACTION_DONE', delivery_id: 'delivery_1' }],
    server_version: 2,
  };
}

function repository(
  overrides: Partial<PhosReportDeliveriesRepository> = {},
): PhosReportDeliveriesRepository {
  return {
    searchReportDeliveries: vi.fn(async () => response()),
    registerReportReply: vi.fn(async () => mutationResponse()),
    markReportActionDone: vi.fn(async () => mutationResponse()),
    ...overrides,
  };
}

describe('PH-OS report-deliveries handler', () => {
  it('loads WAITING_REPLY deliveries by default for authorized users', async () => {
    const repo = repository();
    const handler = createReportDeliverySearchHandler(repo);

    await expect(
      handler({
        ctx: ctx(),
        body: undefined,
        event: {
          routeKey: 'GET /report-deliveries',
          queryStringParameters: {},
        },
      }),
    ).resolves.toEqual(response());

    expect(repo.searchReportDeliveries).toHaveBeenCalledWith(ctx(), {
      status: ReportDeliveryStatus.WAITING_REPLY,
      limit: 50,
    });
  });

  it('validates status and limit before repository access', async () => {
    const repo = repository();
    const handler = createReportDeliverySearchHandler(repo);

    const result = (await handler({
      ctx: ctx(),
      body: undefined,
      event: {
        queryStringParameters: { status: 'BAD_STATUS', limit: '200' },
      },
    })) as PhosLambdaResponse;

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'limit' },
    });
    expect(repo.searchReportDeliveries).not.toHaveBeenCalled();
  });

  it('rejects requests missing the report delivery read scope', async () => {
    const repo = repository();
    const handler = createReportDeliverySearchHandler(repo);

    const result = (await handler({
      ctx: ctx({ scopes: [] }),
      body: undefined,
      event: { queryStringParameters: { status: ReportDeliveryStatus.WAITING_REPLY } },
    })) as PhosLambdaResponse;

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body)).toMatchObject({
      error_code: 'FORBIDDEN',
      details: { missing_scopes: ['phos/report-deliveries.read'] },
    });
    expect(repo.searchReportDeliveries).not.toHaveBeenCalled();
  });

  it('rejects roles outside the report delivery work queue', async () => {
    const repo = repository();
    const handler = createReportDeliverySearchHandler(repo);

    const result = (await handler({
      ctx: ctx({ role: UserRole.DISPENSE_ASSISTANT }),
      body: undefined,
      event: { queryStringParameters: { status: ReportDeliveryStatus.WAITING_REPLY } },
    })) as PhosLambdaResponse;

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body)).toMatchObject({
      error_code: 'FORBIDDEN',
      details: { role: UserRole.DISPENSE_ASSISTANT },
    });
    expect(repo.searchReportDeliveries).not.toHaveBeenCalled();
  });

  it('registers report replies through the write-scoped mutation handler', async () => {
    const repo = repository();
    const handler = createRegisterReportReplyHandler(repo);

    await expect(
      handler({
        ctx: ctx({ scopes: ['phos/report-deliveries.write'] }),
        event: {
          routeKey: 'POST /report-deliveries/{delivery_id}/reply',
          pathParameters: { delivery_id: 'delivery_1' },
        },
        body: {
          result_status: ReportDeliveryStatus.ACTION_DONE,
          reply_summary: '問題ありません。',
          idempotency_key: 'idem_reply',
          client_version: 1,
        },
      }),
    ).resolves.toEqual(mutationResponse());

    expect(repo.registerReportReply).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123' }),
      'delivery_1',
      {
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '問題ありません。',
        idempotency_key: 'idem_reply',
        client_version: 1,
      },
    );
  });

  it('requires an action note for ACTION_REQUIRED reply registration', async () => {
    const repo = repository();
    const handler = createRegisterReportReplyHandler(repo);

    const result = (await handler({
      ctx: ctx({ scopes: ['phos/report-deliveries.write'] }),
      event: { pathParameters: { delivery_id: 'delivery_1' } },
      body: {
        result_status: ReportDeliveryStatus.ACTION_REQUIRED,
        reply_summary: '対応が必要です。',
        idempotency_key: 'idem_reply',
        client_version: 1,
      },
    })) as PhosLambdaResponse;

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'action_required_note' },
    });
    expect(repo.registerReportReply).not.toHaveBeenCalled();
  });

  it('rejects invalid reply source ref captured_at before repository access', async () => {
    const repo = repository();
    const handler = createRegisterReportReplyHandler(repo);

    const result = (await handler({
      ctx: ctx({ scopes: ['phos/report-deliveries.write'] }),
      event: { pathParameters: { delivery_id: 'delivery_1' } },
      body: {
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '問題ありません。',
        source_refs: [
          {
            kind: 'EVIDENCE_FILE',
            ref_id: 'photo_1',
            label: '残薬写真',
            captured_at: 'not-a-date',
          },
        ],
        idempotency_key: 'idem_reply',
        client_version: 1,
      },
    })) as PhosLambdaResponse;

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'source_refs.0.captured_at' },
    });
    expect(repo.registerReportReply).not.toHaveBeenCalled();
  });

  it('trims reply source refs and keeps valid captured_at values', async () => {
    const repo = repository();
    const handler = createRegisterReportReplyHandler(repo);

    await expect(
      handler({
        ctx: ctx({ scopes: ['phos/report-deliveries.write'] }),
        event: { pathParameters: { delivery_id: 'delivery_1' } },
        body: {
          result_status: ReportDeliveryStatus.ACTION_DONE,
          reply_summary: '問題ありません。',
          source_refs: [
            {
              kind: 'EVIDENCE_FILE',
              ref_id: ' photo_1 ',
              label: ' 残薬写真 ',
              uri: ' https://example.test/photo_1 ',
              captured_at: ' 2026-06-09T00:00:00.000Z ',
            },
          ],
          idempotency_key: 'idem_reply',
          client_version: 1,
        },
      }),
    ).resolves.toEqual(mutationResponse());

    expect(repo.registerReportReply).toHaveBeenCalledWith(expect.anything(), 'delivery_1', {
      result_status: ReportDeliveryStatus.ACTION_DONE,
      reply_summary: '問題ありません。',
      source_refs: [
        {
          kind: 'EVIDENCE_FILE',
          ref_id: 'photo_1',
          label: '残薬写真',
          uri: 'https://example.test/photo_1',
          captured_at: '2026-06-09T00:00:00.000Z',
        },
      ],
      idempotency_key: 'idem_reply',
      client_version: 1,
    });
  });

  it('marks report reply action done only for pharmacist-grade roles', async () => {
    const repo = repository();
    const handler = createMarkReportActionDoneHandler(repo);

    const clerkResult = (await handler({
      ctx: ctx({ scopes: ['phos/report-deliveries.write'], role: UserRole.PHARMACY_CLERK }),
      event: { pathParameters: { delivery_id: 'delivery_1' } },
      body: {
        action_note: '確認済み。',
        idempotency_key: 'idem_done',
        client_version: 2,
      },
    })) as PhosLambdaResponse;

    expect(clerkResult.statusCode).toBe(403);
    expect(repo.markReportActionDone).not.toHaveBeenCalled();

    await expect(
      handler({
        ctx: ctx({ scopes: ['phos/report-deliveries.write'], role: UserRole.PHARMACIST }),
        event: {
          routeKey: 'POST /report-deliveries/{delivery_id}/action-done',
          pathParameters: { delivery_id: 'delivery_1' },
        },
        body: {
          action_note: '確認済み。',
          idempotency_key: 'idem_done',
          client_version: 2,
        },
      }),
    ).resolves.toEqual(mutationResponse());

    expect(repo.markReportActionDone).toHaveBeenCalledWith(expect.any(Object), 'delivery_1', {
      action_note: '確認済み。',
      idempotency_key: 'idem_done',
      client_version: 2,
    });
  });
});
