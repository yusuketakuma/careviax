import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  membershipFindManyMock,
  taskGroupByMock,
  taskFindManyMock,
  visitScheduleFindManyMock,
  dispenseTaskGroupByMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  taskGroupByMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  dispenseTaskGroupByMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findMany: membershipFindManyMock,
    },
    task: {
      groupBy: taskGroupByMock,
      findMany: taskFindManyMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
    dispenseTask: {
      groupBy: dispenseTaskGroupByMock,
    },
  },
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url);
}

describe('/api/staff-workload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    membershipFindManyMock.mockResolvedValue([
      {
        role: 'pharmacist',
        user: { id: 'user_a', name: '山田 薬剤師' },
      },
      {
        role: 'clerk',
        user: { id: 'user_b', name: '佐藤 事務' },
      },
    ]);
    taskGroupByMock.mockResolvedValue([
      { assigned_to: 'user_a', _count: { id: 2 } },
      { assigned_to: 'user_b', _count: { id: 1 } },
    ]);
    taskFindManyMock.mockImplementation(async (args: { where?: { assigned_to?: string } }) =>
      args.where?.assigned_to === 'user_a'
        ? [
            {
              id: 'task_1',
              assigned_to: 'user_a',
              title: '鈴木さんの監査をしてほしい',
              task_type: 'staff_work_request_audit',
              priority: 'high',
              status: 'pending',
              due_date: new Date('2026-06-15T14:59:00.000Z'),
              sla_due_at: null,
            },
          ]
        : [],
    );
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'visit_1',
        pharmacist_id: 'user_a',
        visit_type: 'regular',
        schedule_status: 'planned',
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: null,
        case_: { patient: { name: '田中 花子' } },
      },
    ]);
    dispenseTaskGroupByMock.mockResolvedValue([{ assigned_to: 'user_a', _count: { id: 3 } }]);
  });

  it('returns staff workload grouped by active staff', async () => {
    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026-06-15'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(200);
    expect(membershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          is_active: true,
          user: { is_active: true },
        }),
      }),
    );
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          pharmacist_id: { in: ['user_a', 'user_b'] },
          scheduled_date: {
            gte: new Date('2026-06-15T00:00:00.000Z'),
            lt: new Date('2026-06-16T00:00:00.000Z'),
          },
        }),
      }),
    );
    expect(taskFindManyMock).toHaveBeenCalledTimes(2);
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assigned_to: 'user_a',
        }),
        take: 4,
      }),
    );
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assigned_to: 'user_b',
        }),
        take: 4,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      date: '2026-06-15',
      data: [
        {
          id: 'user_a',
          name: '山田 薬剤師',
          role_label: '薬剤師',
          open_task_count: 2,
          today_visit_count: 1,
          dispense_task_count: 3,
          open_tasks: [{ title: '鈴木さんの監査をしてほしい' }],
          visits: [{ patient_name: '田中 花子' }],
        },
        {
          id: 'user_b',
          name: '佐藤 事務',
          role_label: '事務スタッフ',
          open_task_count: 1,
        },
      ],
    });
  });

  it('rejects invalid date filters before querying staff', async () => {
    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026/06/15'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expect(membershipFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-existent calendar dates before querying staff', async () => {
    const response = await GET(
      createRequest('http://localhost/api/staff-workload?date=2026-02-31'),
    );
    if (!response) throw new Error('response is undefined');

    expect(response.status).toBe(400);
    expect(membershipFindManyMock).not.toHaveBeenCalled();
  });
});
