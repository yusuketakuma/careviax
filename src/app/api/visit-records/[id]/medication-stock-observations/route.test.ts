import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { applyVisitMedicationStockObservationsMock, withAuthContextOptions, withOrgContextMock } =
  vi.hoisted(() => ({
    applyVisitMedicationStockObservationsMock: vi.fn(),
    withAuthContextOptions: [] as Array<{ permission?: string; message?: string }>,
    withOrgContextMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
      routeContext: { params: Promise<{ id?: string }> },
    ) => Promise<Response>,
    options?: { permission?: string; message?: string },
  ) => {
    withAuthContextOptions.push(options ?? {});
    return (req: NextRequest, routeContext: { params: Promise<{ id?: string }> }) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/modules/pharmacy', () => ({
  applyVisitMedicationStockObservations: applyVisitMedicationStockObservationsMock,
}));

import { POST as rawPOST } from './route';

const POST = (req: NextRequest, id = 'visit_1') =>
  rawPOST(req, { params: Promise.resolve({ id }) });

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(
    'http://localhost/api/visit-records/visit_1/medication-stock-observations',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'visit-submit-1',
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    observed_at: '2026-07-08T10:30:00+09:00',
    observations: [
      {
        client_observation_id: 'obs_1',
        stock_item_id: 'stock_item_1',
        kind: 'observed_absolute',
        quantity: 4,
        unit: 'sheet',
      },
    ],
    ...overrides,
  };
}

describe('POST /api/visit-records/[id]/medication-stock-observations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback({ tx: true }));
    applyVisitMedicationStockObservationsMock.mockResolvedValue({
      kind: 'applied',
      data: {
        visit_record_id: 'visit_1',
        observations: [
          {
            client_observation_id: 'obs_1',
            stock_item_id: 'stock_item_1',
            stock_event_id: 'stock_event_1',
            observation_context_id: 'context_1',
            event_type: 'visit_observation',
            observation_kind: 'observed_absolute',
            quantity_kind: 'observed_absolute',
            snapshot: {
              current_quantity: 4,
              stock_risk_level: 'watch',
              calculated_at: '2026-07-08T01:40:00.000Z',
            },
            idempotent_replay: false,
          },
        ],
      },
      meta: {
        generated_at: '2026-07-08T01:40:00.000Z',
        applied_count: 1,
        replay_count: 0,
      },
    });
  });

  it('is gated by visit permission', () => {
    expect(withAuthContextOptions).toContainEqual(
      expect.objectContaining({
        permission: 'canVisit',
        message: '訪問記録の残数観測を登録する権限がありません',
      }),
    );
  });

  it('records visit medication stock observations through a serializable org-scoped transaction', async () => {
    const response = await POST(createRequest(createBody()));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
        }),
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeoutMs: 5000,
      }),
    );
    expect(applyVisitMedicationStockObservationsMock).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        visitRecordId: 'visit_1',
        idempotencyKey: 'visit-submit-1',
        observations: [
          expect.objectContaining({
            clientObservationId: 'obs_1',
            stockItemId: 'stock_item_1',
            kind: 'observed_absolute',
            quantity: 4,
            unit: 'sheet',
          }),
        ],
      }),
    );
    expect(payload).toMatchObject({
      data: {
        visit_record_id: 'visit_1',
        observations: [
          {
            stock_event_id: 'stock_event_1',
            observation_context_id: 'context_1',
          },
        ],
      },
      meta: {
        applied_count: 1,
        replay_count: 0,
      },
    });
    expect(JSON.stringify(payload)).not.toContain('visit-submit-1');
    expect(JSON.stringify(payload)).not.toContain('idempotency_key_hash');
    expect(JSON.stringify(payload)).not.toContain('request_fingerprint_hash');
  });

  it('returns 200 for a pure idempotent replay', async () => {
    applyVisitMedicationStockObservationsMock.mockResolvedValueOnce({
      kind: 'applied',
      data: {
        visit_record_id: 'visit_1',
        observations: [
          {
            client_observation_id: 'obs_1',
            stock_item_id: 'stock_item_1',
            stock_event_id: 'stock_event_1',
            observation_context_id: 'context_1',
            event_type: 'visit_observation',
            observation_kind: 'observed_absolute',
            quantity_kind: 'observed_absolute',
            snapshot: {
              current_quantity: 4,
              stock_risk_level: 'watch',
              calculated_at: '2026-07-08T01:40:00.000Z',
            },
            idempotent_replay: true,
          },
        ],
      },
      meta: {
        generated_at: '2026-07-08T01:40:00.000Z',
        applied_count: 0,
        replay_count: 1,
      },
    });

    const response = await POST(createRequest(createBody()));

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
  });

  it('requires a valid Idempotency-Key before opening the transaction', async () => {
    const response = await POST(
      createRequest(createBody(), {
        'Idempotency-Key': '',
      }),
    );

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(applyVisitMedicationStockObservationsMock).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads before writing', async () => {
    const response = await POST(createRequest(createBody({ observations: [] })));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(applyVisitMedicationStockObservationsMock).not.toHaveBeenCalled();
  });

  it('maps service conflicts to no-store 409 responses', async () => {
    applyVisitMedicationStockObservationsMock.mockResolvedValueOnce({
      kind: 'conflict',
      message: '同じ冪等キーで異なる残数観測が指定されています',
    });

    const response = await POST(createRequest(createBody()));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(payload).toEqual({
      code: 'WORKFLOW_CONFLICT',
      message: '同じ冪等キーで異なる残数観測が指定されています',
    });
  });

  it('does not expose raw DB errors when the service throws', async () => {
    withOrgContextMock.mockRejectedValueOnce(new Error('database unavailable with patient name'));

    const response = await POST(createRequest(createBody()));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    expect(JSON.stringify(payload)).not.toContain('database unavailable');
    expect(JSON.stringify(payload)).not.toContain('patient name');
  });
});
