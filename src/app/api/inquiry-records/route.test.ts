import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { withAuthMock, withOrgContextMock, inquiryRecordFindManyMock, upsertOperationalTaskMock } =
  vi.hoisted(() => ({
    withAuthMock: vi.fn(
      (
        handler: (
          req: NextRequest & { orgId: string; userId: string; role: 'pharmacist' },
        ) => Promise<Response>,
      ) => {
        return (req: NextRequest) =>
          handler({
            ...req,
            orgId: 'org_1',
            userId: 'user_1',
            role: 'pharmacist',
          } as NextRequest & { orgId: string; userId: string; role: 'pharmacist' });
      },
    ),
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

function createRequest(url: string) {
  return { url } as unknown as NextRequest;
}

function createPostRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
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
});
