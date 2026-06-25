import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  careCaseFindManyMock,
  visitScheduleCountMock,
  careReportCountMock,
  taskCountMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  careReportCountMock: vi.fn(),
  taskCountMock: vi.fn(),
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
      count: visitScheduleCountMock,
    },
    careReport: {
      count: careReportCountMock,
    },
    task: {
      count: taskCountMock,
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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/dashboard/overdue GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    visitScheduleCountMock.mockResolvedValue(1);
    careReportCountMock.mockResolvedValue(1);
    taskCountMock.mockResolvedValue(1);
  });

  it('returns 403 when the role lacks dashboard permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'driver' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns overdue dashboard buckets', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
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
    expect(visitScheduleCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: { in: ['case_1'] },
        }),
      }),
    );
    expect(careReportCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: { in: ['patient_1'] },
        }),
      }),
    );
    expect(taskCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          AND: expect.arrayContaining([
            {
              OR: expect.arrayContaining([
                {
                  assigned_to: 'user_1',
                },
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
    const json = await response.json();
    expect(json).toMatchObject({
      summary: {
        unrecorded_visits: 1,
        unsent_reports: 1,
        overdue_tasks: 1,
        total: 3,
      },
    });
    expect(json).not.toHaveProperty('unrecorded_visits');
    expect(json).not.toHaveProperty('unsent_reports');
    expect(json).not.toHaveProperty('overdue_tasks');
  });

  it('keeps directly assigned task scope when a scoped user has no assigned patients or cases', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });
    careCaseFindManyMock.mockResolvedValue([]);
    visitScheduleCountMock.mockResolvedValue(0);
    careReportCountMock.mockResolvedValue(0);
    taskCountMock.mockResolvedValue(0);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(visitScheduleCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: [] },
        }),
      }),
    );
    expect(careReportCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patient_id: { in: [] },
        }),
      }),
    );
    expect(taskCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [{ assigned_to: 'user_1' }],
            },
          ]),
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
    });
  });
});
