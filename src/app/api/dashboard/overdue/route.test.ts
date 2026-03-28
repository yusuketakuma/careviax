import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  visitScheduleFindManyMock,
  careReportFindManyMock,
  taskFindManyMock,
  patientFindManyMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
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

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/dashboard/overdue GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
