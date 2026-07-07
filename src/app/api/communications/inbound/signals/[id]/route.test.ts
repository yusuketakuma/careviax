import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  inboundCommunicationSignalFindFirstMock,
  inboundCommunicationSignalUpdateMock,
  taskUpdateManyMock,
  withOrgContextMock,
  assignmentWhereMock,
  withAuthContextOptions,
  applyInboundSignalToMedicationStockMock,
} = vi.hoisted(() => ({
  inboundCommunicationSignalFindFirstMock: vi.fn(),
  inboundCommunicationSignalUpdateMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  assignmentWhereMock: vi.fn(),
  withAuthContextOptions: [] as Array<{ permission?: string; message?: string }>,
  applyInboundSignalToMedicationStockMock: vi.fn(),
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

vi.mock('@/server/services/communication-request-access', () => ({
  buildInboundCommunicationEventAssignmentWhere: assignmentWhereMock,
}));

vi.mock(
  '@/modules/pharmacy/medication-stock/application/apply-inbound-medication-stock-signal',
  () => ({
    applyInboundSignalToMedicationStock: applyInboundSignalToMedicationStockMock,
  }),
);

import { PATCH as rawPATCH } from './route';

const PATCH = (req: NextRequest, id = 'signal_1') =>
  rawPATCH(req, { params: Promise.resolve({ id }) });

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/communications/inbound/signals/signal_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/communications/inbound/signals/[id]', () => {
  it('is gated by the report capability', () => {
    expect(withAuthContextOptions).toContainEqual(
      expect.objectContaining({
        permission: 'canReport',
        message: '他職種受信シグナルのレビュー権限がありません',
      }),
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    assignmentWhereMock.mockResolvedValue({
      OR: [{ patient_id: { in: ['patient_1'] } }, { patient_id: null }],
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        inboundCommunicationSignal: {
          findFirst: inboundCommunicationSignalFindFirstMock,
          update: inboundCommunicationSignalUpdateMock,
        },
        task: {
          updateMany: taskUpdateManyMock,
        },
      }),
    );
    inboundCommunicationSignalFindFirstMock.mockResolvedValue({
      id: 'signal_1',
    });
    inboundCommunicationSignalUpdateMock.mockResolvedValue({
      id: 'signal_1',
      inbound_event_id: 'event_1',
      review_status: 'record_only',
      action_status: 'ignored',
      reviewed_at: new Date('2026-07-07T07:10:00.000Z'),
    });
    taskUpdateManyMock.mockResolvedValue({ count: 1 });
    applyInboundSignalToMedicationStockMock.mockResolvedValue({
      kind: 'applied',
      data: {
        signal_id: 'signal_1',
        inbound_event_id: 'event_1',
        stock_item_id: 'stock_item_1',
        stock_event_id: 'stock_event_1',
        external_observation_id: 'external_observation_1',
        review_status: 'accepted',
        action_status: 'linked_to_stock_event',
        snapshot: {
          current_quantity: 4,
          stock_risk_level: 'watch',
          calculated_at: '2026-07-07T07:20:00.000Z',
        },
        review_task_closure_count: 1,
        idempotent_replay: false,
      },
    });
  });

  it('marks a signal as record_only without returning raw inbound content', async () => {
    const response = await PATCH(
      createRequest({
        action: 'record_only',
        reason: '電話で確認済み。湿布は残り4枚。',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(assignmentWhereMock).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org_1' }));
    expect(inboundCommunicationSignalFindFirstMock).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            id: 'signal_1',
            org_id: 'org_1',
            inbound_event: {
              is: {
                org_id: 'org_1',
              },
            },
          },
          {
            inbound_event: {
              is: {
                OR: [{ patient_id: { in: ['patient_1'] } }, { patient_id: null }],
              },
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });
    expect(inboundCommunicationSignalUpdateMock).toHaveBeenCalledWith({
      where: {
        id: 'signal_1',
      },
      data: expect.objectContaining({
        review_status: 'record_only',
        action_status: 'ignored',
        reviewed_by: 'user_1',
        rejection_reason: '電話で確認済み。湿布は残り4枚。',
      }),
      select: {
        id: true,
        inbound_event_id: true,
        review_status: true,
        action_status: true,
        reviewed_at: true,
      },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        dedupe_key: {
          startsWith: 'inbound:signal_1:',
        },
        status: {
          in: ['pending', 'in_progress'],
        },
      },
      data: {
        status: 'completed',
        completed_at: expect.any(Date),
      },
    });
    expect(payload).toMatchObject({
      data: {
        signal_id: 'signal_1',
        inbound_event_id: 'event_1',
        review_status: 'record_only',
        action_status: 'ignored',
        reviewed_at: '2026-07-07T07:10:00.000Z',
        review_task_closure_count: 1,
      },
    });
    expect(JSON.stringify(payload)).not.toContain('湿布');
    expect(JSON.stringify(payload)).not.toContain('残り4枚');
    expect(JSON.stringify(payload)).not.toContain('電話で確認済み');
  });

  it('requires a rejection reason and does not write invalid review payloads', async () => {
    const response = await PATCH(createRequest({ action: 'reject' }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(inboundCommunicationSignalFindFirstMock).not.toHaveBeenCalled();
    expect(inboundCommunicationSignalUpdateMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('marks a signal as accepted while leaving action status unchanged', async () => {
    inboundCommunicationSignalUpdateMock.mockResolvedValueOnce({
      id: 'signal_1',
      inbound_event_id: 'event_1',
      review_status: 'accepted',
      action_status: 'not_linked',
      reviewed_at: new Date('2026-07-07T07:11:00.000Z'),
    });

    const response = await PATCH(createRequest({ action: 'accept' }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(inboundCommunicationSignalUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          action_status: expect.anything(),
        }),
      }),
    );
    expect(payload.data).toMatchObject({
      signal_id: 'signal_1',
      review_status: 'accepted',
      action_status: 'not_linked',
      review_task_closure_count: 1,
    });
  });

  it('does not leak or fail when no formal review task is still open', async () => {
    inboundCommunicationSignalUpdateMock.mockResolvedValueOnce({
      id: 'signal_1',
      inbound_event_id: 'event_1',
      review_status: 'rejected',
      action_status: 'ignored',
      reviewed_at: new Date('2026-07-07T07:12:00.000Z'),
    });
    taskUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest({
        action: 'reject',
        reason: 'rejected_from_inbound_review_queue',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(taskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dedupe_key: { startsWith: 'inbound:signal_1:' },
          status: { in: ['pending', 'in_progress'] },
        }),
      }),
    );
    expect(payload.data).toMatchObject({
      review_status: 'rejected',
      action_status: 'ignored',
      review_task_closure_count: 0,
    });
    expect(JSON.stringify(payload)).not.toContain('rejected_from_inbound_review_queue');
  });

  it('returns not found for inaccessible signals', async () => {
    inboundCommunicationSignalFindFirstMock.mockResolvedValueOnce(null);

    const response = await PATCH(createRequest({ action: 'accept' }));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(payload.code).toBe('WORKFLOW_NOT_FOUND');
    expect(inboundCommunicationSignalUpdateMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it('applies an accepted medication stock signal through the application service', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/communications/inbound/signals/signal_1', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'apply-signal-1',
        },
        body: JSON.stringify({
          action: 'apply_to_medication_stock',
          target_stock_item_id: 'stock_item_1',
          observation: {
            kind: 'observed_absolute',
            quantity: 4,
            unit: 'sheet',
            event_at: '2026-07-07T07:20:00.000Z',
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(assignmentWhereMock).not.toHaveBeenCalled();
    expect(inboundCommunicationSignalFindFirstMock).not.toHaveBeenCalled();
    expect(applyInboundSignalToMedicationStockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inboundCommunicationSignal: expect.any(Object),
      }),
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        signalId: 'signal_1',
        targetStockItemId: 'stock_item_1',
        idempotencyKey: 'apply-signal-1',
        observation: {
          kind: 'observed_absolute',
          quantity: 4,
          unit: 'sheet',
          eventAt: new Date('2026-07-07T07:20:00.000Z'),
        },
      },
    );
    expect(payload).toMatchObject({
      data: {
        signal_id: 'signal_1',
        action_status: 'linked_to_stock_event',
        stock_event_id: 'stock_event_1',
        snapshot: {
          stock_risk_level: 'watch',
        },
      },
    });
    expect(JSON.stringify(payload)).not.toContain('湿布');
    expect(JSON.stringify(payload)).not.toContain('apply-signal-1');
  });

  it('requires an idempotency key before applying a signal to medication stock', async () => {
    const response = await PATCH(
      createRequest({
        action: 'apply_to_medication_stock',
        target_stock_item_id: 'stock_item_1',
        observation: {
          kind: 'observed_absolute',
          quantity: 4,
          unit: 'sheet',
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(applyInboundSignalToMedicationStockMock).not.toHaveBeenCalled();
  });

  it('maps medication stock apply conflicts to no-store 409 responses', async () => {
    applyInboundSignalToMedicationStockMock.mockResolvedValueOnce({
      kind: 'conflict',
      message: '同じ冪等キーで異なる反映内容が指定されています',
    });

    const response = await PATCH(
      new NextRequest('http://localhost/api/communications/inbound/signals/signal_1', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'apply-signal-conflict',
        },
        body: JSON.stringify({
          action: 'apply_to_medication_stock',
          target_stock_item_id: 'stock_item_1',
          observation: {
            kind: 'no_stock_observed',
            unit: 'sheet',
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expectNoStore(response);
    expect(payload).toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じ冪等キーで異なる反映内容が指定されています',
    });
    expect(JSON.stringify(payload)).not.toContain('apply-signal-conflict');
  });

  it('returns a no-store internal error without leaking raw details', async () => {
    inboundCommunicationSignalUpdateMock.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await PATCH(
      createRequest({
        action: 'reject',
        reason: '湿布の件は患者違い',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(JSON.stringify(payload)).not.toContain('湿布');
    expect(JSON.stringify(payload)).not.toContain('database unavailable');
  });
});
