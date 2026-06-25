import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  membershipFindManyMock,
  taskGroupByMock,
  taskFindManyMock,
  taskQueryRawMock,
  visitScheduleFindManyMock,
  dispenseTaskGroupByMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  taskGroupByMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskQueryRawMock: vi.fn(),
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
    $queryRaw: taskQueryRawMock,
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
    taskFindManyMock.mockResolvedValue([]);
    taskQueryRawMock.mockResolvedValue([
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
      {
        id: 'task_2',
        assigned_to: 'user_a',
        title: '訪問前の確認',
        task_type: 'visit_preparation',
        priority: 'normal',
        status: 'pending',
        due_date: new Date('2026-06-16T14:59:00.000Z'),
        sla_due_at: null,
      },
      {
        id: 'task_3',
        assigned_to: 'user_a',
        title: '残薬連絡',
        task_type: 'medication_followup',
        priority: 'normal',
        status: 'in_progress',
        due_date: null,
        sla_due_at: null,
      },
      {
        id: 'task_4',
        assigned_to: 'user_a',
        title: '報告書確認',
        task_type: 'care_report_review',
        priority: 'low',
        status: 'pending',
        due_date: null,
        sla_due_at: null,
      },
      {
        id: 'task_5',
        assigned_to: 'user_a',
        title: 'SQL 側の上限を超えたタスク',
        task_type: 'should_not_render',
        priority: 'low',
        status: 'pending',
        due_date: null,
        sla_due_at: null,
      },
      {
        id: 'task_6',
        assigned_to: 'user_b',
        title: '配送確認',
        task_type: 'delivery_check',
        priority: 'normal',
        status: 'pending',
        due_date: null,
        sla_due_at: null,
      },
    ]);
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
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(taskQueryRawMock).toHaveBeenCalledTimes(1);
    const [query, orgId, assignedStaffIds, limit] = taskQueryRawMock.mock.calls[0] ?? [];
    const queryText = Array.from(query as TemplateStringsArray).join(' ');
    expect(queryText).toContain('ROW_NUMBER() OVER');
    expect(queryText).toContain('PARTITION BY assigned_to');
    expect(queryText).toContain('sla_due_at ASC NULLS LAST');
    expect(queryText).toContain('due_date ASC NULLS LAST');
    expect(queryText).toContain('org_id =');
    expect(queryText).toContain('assigned_to = ANY(');
    expect(queryText).toContain("status IN ('pending', 'in_progress')");
    expect(queryText).toContain('WHERE rn <=');
    expect(orgId).toBe('org_1');
    expect(assignedStaffIds).toEqual(['user_a', 'user_b']);
    expect(limit).toBe(4);
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
          open_tasks: [
            { title: '鈴木さんの監査をしてほしい' },
            { title: '訪問前の確認' },
            { title: '残薬連絡' },
            { title: '報告書確認' },
          ],
          visits: [{ patient_name: '田中 花子' }],
        },
        {
          id: 'user_b',
          name: '佐藤 事務',
          role_label: '事務スタッフ',
          open_task_count: 1,
          open_tasks: [{ title: '配送確認' }],
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
