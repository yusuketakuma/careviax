import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  inboundCommunicationEventFindFirstMock,
  inboundCommunicationSignalFindFirstMock,
  inboundCommunicationSignalUpdateManyMock,
  taskFindFirstMock,
  withOrgContextMock,
  assignmentWhereMock,
  upsertOperationalTaskMock,
  withAuthContextOptions,
} = vi.hoisted(() => ({
  inboundCommunicationEventFindFirstMock: vi.fn(),
  inboundCommunicationSignalFindFirstMock: vi.fn(),
  inboundCommunicationSignalUpdateManyMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  assignmentWhereMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  withAuthContextOptions: [] as Array<{ permission?: string; message?: string }>,
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
    ) => Promise<Response>,
    options?: { permission?: string; message?: string },
  ) => {
    withAuthContextOptions.push(options ?? {});
    return (req: NextRequest) =>
      handler(req, {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      });
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/communication-request-access', () => ({
  buildInboundCommunicationEventAssignmentWhere: assignmentWhereMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/communications/inbound/signals/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/communications/inbound/signals/tasks', () => {
  it('is gated by the report capability', () => {
    expect(withAuthContextOptions).toContainEqual(
      expect.objectContaining({
        permission: 'canReport',
        message: '他職種受信シグナルのタスク化権限がありません',
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
        inboundCommunicationEvent: {
          findFirst: inboundCommunicationEventFindFirstMock,
        },
        inboundCommunicationSignal: {
          findFirst: inboundCommunicationSignalFindFirstMock,
          updateMany: inboundCommunicationSignalUpdateManyMock,
        },
        task: {
          findFirst: taskFindFirstMock,
        },
      }),
    );
    inboundCommunicationEventFindFirstMock.mockResolvedValue({
      id: 'event_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      source_channel: 'phone',
      raw_text: '訪問看護師A 090-1234-5678 より、湿布は残り4枚です。storageKey=secret token=secret',
      received_at: new Date('2026-07-07T01:00:00.000Z'),
    });
    inboundCommunicationSignalFindFirstMock.mockResolvedValue({
      id: 'signal_1',
      signal_index: 0,
      inbound_event: {
        id: 'event_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        source_channel: 'phone',
        raw_text:
          '訪問看護師A 090-1234-5678 より、湿布は残り4枚です。storageKey=secret token=secret',
        received_at: new Date('2026-07-07T01:00:00.000Z'),
      },
    });
    inboundCommunicationSignalUpdateManyMock.mockResolvedValue({ count: 1 });
    taskFindFirstMock.mockResolvedValue(null);
    upsertOperationalTaskMock.mockResolvedValue({
      id: 'task_1',
      display_id: 'TASK-1',
    });
  });

  it('creates a deduped pharmacist review task from a stock signal without exposing raw inbound text', async () => {
    const response = await POST(
      createRequest({
        candidate_key: 'inbound_signal:signal_1',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
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
                source_channel: { in: ['phone', 'fax', 'email', 'mcs'] },
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
        signal_index: true,
        inbound_event: {
          select: {
            id: true,
            patient_id: true,
            case_id: true,
            source_channel: true,
            raw_text: true,
            received_at: true,
          },
        },
      },
    });
    expect(inboundCommunicationEventFindFirstMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'pharmacy.inbound_medication_stock_signal_review_required',
        title: '他職種からの残数シグナルを確認',
        priority: 'high',
        dedupeKey: 'inbound:signal_1:pharmacy.inbound_medication_stock_signal_review_required',
        relatedEntityType: 'inbound_medication_stock_signal',
        relatedEntityId: 'signal_1',
        metadata: expect.objectContaining({
          source: 'inbound_communication_signal',
          inbound_event_id: 'event_1',
          inbound_signal_id: 'signal_1',
          candidate_index: 0,
          signal_domain: 'medication_stock',
          signal_type: 'observed_quantity',
          source_channel: 'phone',
          patient_linked: true,
          case_linked: true,
          stock_review: expect.objectContaining({
            action: 'stage_for_pharmacist_review',
            observation_kind: 'remaining_quantity',
            review_priority: 'medium',
            warning_codes: ['medication_identity_missing'],
            has_medication_identity: false,
            has_observed_quantity: true,
            has_usage_quantity: false,
          }),
        }),
      }),
    );
    expect(inboundCommunicationSignalUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'signal_1',
        org_id: 'org_1',
        action_status: 'not_linked',
      },
      data: {
        action_status: 'linked_to_task',
      },
    });
    expect(payload).toMatchObject({
      data: {
        task_id: 'task_1',
        task_type: 'pharmacy.inbound_medication_stock_signal_review_required',
        status: 'pending',
        action_href: '/patients/patient_1#medication-stock-events',
      },
    });

    const serializedResponse = JSON.stringify(payload);
    expect(serializedResponse).not.toContain('湿布');
    expect(serializedResponse).not.toContain('残り4枚');
    expect(serializedResponse).not.toContain('訪問看護師A');
    expect(serializedResponse).not.toContain('090-1234-5678');
    expect(serializedResponse).not.toContain('storageKey');
    expect(serializedResponse).not.toContain('token=secret');
    expect(serializedResponse).not.toContain('content');
    expect(serializedResponse).not.toContain('subject');

    const taskInput = upsertOperationalTaskMock.mock.calls[0][1];
    const serializedTaskInput = JSON.stringify(taskInput);
    expect(serializedTaskInput).not.toContain('湿布');
    expect(serializedTaskInput).not.toContain('残り4枚');
    expect(serializedTaskInput).not.toContain('訪問看護師A');
    expect(serializedTaskInput).not.toContain('090-1234-5678');
    expect(serializedTaskInput).not.toContain('storageKey');
    expect(serializedTaskInput).not.toContain('token=secret');
    expect(serializedTaskInput).not.toContain('extractedQuantity');
    expect(serializedTaskInput).not.toContain('sourceRecordId');
  });

  it('maps unquantified low-stock text to the low-stock task type', async () => {
    inboundCommunicationEventFindFirstMock.mockResolvedValueOnce({
      id: 'event_2',
      patient_id: 'patient_1',
      case_id: null,
      source_channel: 'mcs',
      raw_text: 'MCS投稿: 残薬が少ないので補充希望です。',
      received_at: new Date('2026-07-07T02:00:00.000Z'),
    });

    const response = await POST(
      createRequest({
        candidate_key: 'inbound_event:event_2:candidate:0',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        dedupe_key: 'inbound-signal-task:event_2:0:pharmacy.inbound_low_stock_unquantified_report',
      },
      select: {
        id: true,
        status: true,
      },
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        taskType: 'pharmacy.inbound_low_stock_unquantified_report',
        priority: 'high',
        relatedEntityType: 'patient',
        relatedEntityId: 'patient_1',
        metadata: expect.objectContaining({
          signal_domain: 'medication_stock',
          signal_type: 'low_stock_text',
          source_channel: 'mcs',
        }),
      }),
    );
    expect(payload.data.action_href).toBe('/patients/patient_1#medication-stock-events');
    expect(JSON.stringify(payload)).not.toContain('補充希望');
  });

  it('returns an existing task without reopening a completed deduped review task', async () => {
    taskFindFirstMock.mockResolvedValueOnce({
      id: 'task_done',
      status: 'completed',
    });

    const response = await POST(
      createRequest({
        candidate_key: 'inbound_event:event_1:candidate:0',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expectNoStore(response);
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      data: {
        task_id: 'task_done',
        task_type: 'pharmacy.inbound_medication_stock_signal_review_required',
        status: 'completed',
        action_href: '/patients/patient_1#medication-stock-events',
      },
    });
    expect(JSON.stringify(payload)).not.toContain('湿布');
    expect(JSON.stringify(payload)).not.toContain('残り4枚');
  });

  it('maps urgent medication safety signals to the safety review task type', async () => {
    inboundCommunicationEventFindFirstMock.mockResolvedValueOnce({
      id: 'event_3',
      patient_id: null,
      case_id: null,
      source_channel: 'email',
      raw_text: '副作用かもしれない発疹があります。至急確認してください。',
      received_at: new Date('2026-07-07T03:00:00.000Z'),
    });

    const response = await POST(
      createRequest({
        candidate_key: 'inbound_event:event_3:candidate:0',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        taskType: 'pharmacy.inbound_medication_safety_review_required',
        priority: 'urgent',
        relatedEntityType: 'inbound_communication',
        relatedEntityId: 'event_3',
        metadata: expect.objectContaining({
          signal_domain: 'medication_safety',
          signal_type: 'side_effect_suspected',
          patient_linked: false,
        }),
      }),
    );
    expect(payload.data.action_href).toBe(
      '/tasks?status=&task_type=pharmacy.inbound_medication_safety_review_required',
    );
    expect(JSON.stringify(payload)).not.toContain('発疹');
    expect(JSON.stringify(payload)).not.toContain('至急確認');
  });

  it('rejects malformed candidate keys before reading communication events', async () => {
    const response = await POST(createRequest({ candidate_key: 'raw:event_1' }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(payload.code).toBe('VALIDATION_ERROR');
    expect(inboundCommunicationEventFindFirstMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('returns not found without creating a task when the source event is inaccessible', async () => {
    inboundCommunicationEventFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(
      createRequest({
        candidate_key: 'inbound_event:event_missing:candidate:0',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(payload.code).toBe('WORKFLOW_NOT_FOUND');
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('returns a no-store internal error without leaking raw content when task creation fails', async () => {
    upsertOperationalTaskMock.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await POST(
      createRequest({
        candidate_key: 'inbound_event:event_1:candidate:0',
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(JSON.stringify(payload)).not.toContain('湿布');
    expect(JSON.stringify(payload)).not.toContain('database unavailable');
  });
});
