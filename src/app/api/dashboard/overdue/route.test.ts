import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  careCaseFindManyMock,
  visitScheduleFindManyMock,
  careReportFindManyMock,
  taskFindManyMock,
  patientFindManyMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
    careReport: {
      findMany: careReportFindManyMock,
    },
    patient: {
      findMany: patientFindManyMock,
    },
    task: {
      findMany: taskFindManyMock,
    },
  },
}));

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/dashboard/overdue', {
    headers,
  });
}

describe('/api/dashboard/overdue GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
  });

  it('returns 403 when the role lacks dashboard permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'driver' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns overdue dashboard buckets', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        scheduled_date: new Date('2026-03-20T00:00:00Z'),
        schedule_status: 'planned',
        case_: {
          patient: {
            id: 'patient_1',
            name: '山田 太郎',
          },
        },
      },
    ]);
    careReportFindManyMock.mockResolvedValue([
      {
        id: 'report_1',
        patient_id: 'patient_1',
        report_type: 'physician_report',
        status: 'draft',
        created_at: new Date('2026-03-20T00:00:00Z'),
        updated_at: new Date('2026-03-21T00:00:00Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '山田 太郎',
      },
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        id: 'task_1',
        task_type: 'visit_preparation',
        title: '訪問準備が未完了です',
        priority: 'high',
        due_date: new Date('2026-03-21T00:00:00Z'),
        sla_due_at: new Date('2026-03-21T00:00:00Z'),
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careCaseFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        AND: [
          {
            OR: [
              { primary_pharmacist_id: 'user_1' },
              { backup_pharmacist_id: 'user_1' },
              { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
            ],
          },
        ],
      },
      select: { id: true, patient_id: true },
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: ['case_1'] },
        }),
      }),
    );
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: ['patient_1'] },
        }),
      }),
    );
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: expect.arrayContaining([
                {
                  related_entity_type: 'patient',
                  related_entity_id: { in: ['patient_1'] },
                },
                {
                  related_entity_type: 'case',
                  related_entity_id: { in: ['case_1'] },
                },
              ]),
            },
          ]),
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      summary: {
        unrecorded_visits: 1,
        unsent_reports: 1,
        overdue_tasks: 1,
        total: 3,
      },
      unrecorded_visits: [
        expect.objectContaining({
          patient_name: '山田 太郎',
        }),
      ],
      unsent_reports: [
        expect.objectContaining({
          report_type: 'physician_report',
        }),
      ],
      overdue_tasks: [
        expect.objectContaining({
          title: '訪問準備が未完了です',
        }),
      ],
    });
  });

  it('returns empty buckets when a scoped user has no assigned patients or cases', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });
    careCaseFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    careReportFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    patientFindManyMock.mockResolvedValue([]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: [] },
        }),
      }),
    );
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: [] },
        }),
      }),
    );
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ id: { in: [] } }]),
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      summary: {
        unrecorded_visits: 0,
        unsent_reports: 0,
        overdue_tasks: 0,
        total: 0,
      },
      unrecorded_visits: [],
      unsent_reports: [],
      overdue_tasks: [],
    });
  });
});
