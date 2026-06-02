import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role: 'pharmacist';
};

const { withAuthMock, withOrgContextMock, inquiryRecordFindManyMock, upsertOperationalTaskMock } =
  vi.hoisted(() => ({
    withAuthMock: vi.fn((handler: (req: AuthenticatedTestRequest) => Promise<Response>) => {
      return (req: NextRequest) =>
        handler(
          Object.assign(req, {
            orgId: 'org_1',
            userId: 'user_1',
            role: 'pharmacist',
          }) as AuthenticatedTestRequest,
        );
    }),
    withOrgContextMock: vi.fn(),
    inquiryRecordFindManyMock: vi.fn(),
    upsertOperationalTaskMock: vi.fn(),
  }));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    inquiryRecord: {
      findMany: inquiryRecordFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import { GET, POST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(url: string) {
  return new NextRequest(url);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/inquiry-records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedPostRequest() {
  return new NextRequest('http://localhost/api/inquiry-records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"cycle_id":',
  } satisfies NextRequestInit);
}

const expectedCycleAssignmentWhere = {
  case_: {
    OR: [
      { primary_pharmacist_id: 'user_1' },
      { backup_pharmacist_id: 'user_1' },
      { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
    ],
  },
};

describe('/api/inquiry-records GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inquiryRecordFindManyMock.mockResolvedValue([]);
  });

  it('filters by patient through the medication cycle relation when patient_id is provided', async () => {
    const response = await GET(
      createRequest('http://localhost/api/inquiry-records?patient_id=patient_1'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inquiryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cycle: {
            AND: [{ patient_id: 'patient_1' }, expectedCycleAssignmentWhere],
          },
        },
        orderBy: { inquired_at: 'desc' },
      }),
    );
  });
});

describe('/api/inquiry-records POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertOperationalTaskMock.mockResolvedValue({ id: 'operational_task_1' });
  });

  it('rejects non-object create payloads before creating inquiry side effects', async () => {
    const response = await POST(createPostRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before creating inquiry side effects', async () => {
    const response = await POST(createMalformedPostRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('denies unassigned cycles before creating inquiry side effects', async () => {
    const inquiryCreateMock = vi.fn();
    const communicationRequestCreateMock = vi.fn();
    const communicationEventCreateMock = vi.fn();
    const medicationCycleFindFirstMock = vi.fn().mockResolvedValue(null);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          update: vi.fn(),
        },
        prescriptionLine: {
          findFirst: vi.fn(),
        },
        medicationIssue: {
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        inquiryRecord: {
          create: inquiryCreateMock,
        },
        communicationRequest: {
          create: communicationRequestCreateMock,
        },
        communicationEvent: {
          create: communicationEventCreateMock,
        },
      }),
    );

    const response = await POST(
      createPostRequest({
        cycle_id: 'cycle_unassigned',
        reason: '用量疑義',
        inquiry_to_physician: '在宅医',
        inquiry_content: '用量をご確認ください',
        inquired_at: '2026-03-29',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'cycle_unassigned',
        org_id: 'org_1',
        AND: [expectedCycleAssignmentWhere],
      },
      select: {
        id: true,
        overall_status: true,
        patient_id: true,
        case_id: true,
      },
    });
    expect(inquiryCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(communicationEventCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('denies line IDs that do not belong to the assigned cycle before writing', async () => {
    const inquiryCreateMock = vi.fn();
    const communicationRequestCreateMock = vi.fn();
    const prescriptionLineFindFirstMock = vi.fn().mockResolvedValue(null);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cycle_1',
            overall_status: 'ready_to_dispense',
            patient_id: 'patient_1',
            case_id: 'case_1',
          }),
          update: vi.fn(),
        },
        prescriptionLine: {
          findFirst: prescriptionLineFindFirstMock,
        },
        medicationIssue: {
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        inquiryRecord: {
          create: inquiryCreateMock,
        },
        communicationRequest: {
          create: communicationRequestCreateMock,
        },
        communicationEvent: {
          create: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createPostRequest({
        cycle_id: 'cycle_1',
        line_id: 'line_foreign',
        reason: '用量疑義',
        inquiry_to_physician: '在宅医',
        inquiry_content: '用量をご確認ください',
        inquired_at: '2026-03-29',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(prescriptionLineFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'line_foreign',
        org_id: 'org_1',
        intake: {
          cycle_id: 'cycle_1',
        },
      },
      select: { id: true },
    });
    expect(inquiryCreateMock).not.toHaveBeenCalled();
    expect(communicationRequestCreateMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('creates communication request with inquiry context snapshot', async () => {
    const inquiryCreateMock = vi.fn().mockResolvedValue({ id: 'inquiry_1' });
    const communicationRequestCreateMock = vi
      .fn()
      .mockResolvedValue({ id: 'communication_request_1' });
    const communicationEventCreateMock = vi.fn().mockResolvedValue({ id: 'event_1' });
    const medicationCycleUpdateMock = vi.fn().mockResolvedValue({ id: 'cycle_1' });
    const cycleTransitionLogCreateMock = vi.fn().mockResolvedValue({ id: 'transition_1' });
    const auditLogCreateMock = vi.fn().mockResolvedValue({ id: 'audit_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'cycle_1',
            overall_status: 'ready_to_dispense',
            patient_id: 'patient_1',
            case_id: 'case_1',
          }),
          update: medicationCycleUpdateMock,
        },
        prescriptionLine: {
          findFirst: vi.fn(),
        },
        medicationIssue: {
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        inquiryRecord: {
          create: inquiryCreateMock,
        },
        communicationRequest: {
          create: communicationRequestCreateMock,
        },
        communicationEvent: {
          create: communicationEventCreateMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );

    const response = await POST(
      createPostRequest({
        cycle_id: 'cycle_1',
        reason: '用量疑義',
        inquiry_to_physician: '在宅医',
        inquiry_content: '用量をご確認ください',
        proposal_origin: 'pre_issuance',
        residual_adjustment: true,
        inquired_at: '2026-03-29',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        related_entity_type: 'inquiry_record',
        related_entity_id: 'inquiry_1',
        context_snapshot: {
          cycle_id: 'cycle_1',
          issue_id: null,
          line_id: null,
          reason: '用量疑義',
          proposal_origin: 'pre_issuance',
          residual_adjustment: true,
        },
      }),
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        relatedEntityType: 'inquiry_record',
        relatedEntityId: 'inquiry_1',
        metadata: expect.objectContaining({
          communication_request_id: 'communication_request_1',
        }),
      }),
    );
    expect(medicationCycleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1' },
      data: { overall_status: 'inquiry_pending' },
    });
    expect(cycleTransitionLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cycle_id: 'cycle_1',
        from_status: 'ready_to_dispense',
        to_status: 'inquiry_pending',
        actor_id: 'user_1',
        note: 'inquiry_record_created:inquiry_1',
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'inquiry_record_created',
        target_type: 'inquiry_record',
        target_id: 'inquiry_1',
        changes: expect.objectContaining({
          cycle_id: 'cycle_1',
          patient_id: 'patient_1',
          communication_request_id: 'communication_request_1',
        }),
      }),
    });
  });
});
