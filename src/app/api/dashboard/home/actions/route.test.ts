import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  medicationCycleGroupByMock,
  taskFindManyMock,
  communicationQueueMock,
  describeOperationalTaskMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  medicationCycleGroupByMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  communicationQueueMock: vi.fn(),
  describeOperationalTaskMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    medicationCycle: {
      groupBy: medicationCycleGroupByMock,
    },
    task: {
      findMany: taskFindManyMock,
    },
  },
}));

vi.mock('@/server/services/communication-queue', () => ({
  listCommunicationQueue: communicationQueueMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  describeOperationalTask: describeOperationalTaskMock,
}));

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    url: 'http://localhost/api/dashboard/home/actions',
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/dashboard/home/actions GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    describeOperationalTaskMock.mockReturnValue({
      queueLabel: '準備',
      actionHref: '/schedules',
      actionLabel: '開く',
    });
    medicationCycleGroupByMock.mockResolvedValue([
      { overall_status: 'intake_received', _count: { id: 2 } },
      { overall_status: 'ready_to_dispense', _count: { id: 1 } },
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        id: 'task_1',
        task_type: 'visit_preparation',
        title: '持参物確認',
        description: '午前ルート分',
        priority: 'high',
        assigned_to: '田中',
        due_date: new Date('2026-03-31T09:00:00Z'),
        sla_due_at: null,
        related_entity_type: 'case',
        related_entity_id: 'case_1',
      },
    ]);
    communicationQueueMock.mockResolvedValue({
      summary: {
        pending_count: 1,
        overdue_count: 0,
        self_reports: 1,
        callback_followups: 0,
        open_requests: 0,
        delivery_backlog: 0,
        expiring_external_shares: 0,
      },
      items: [
        {
          id: 'comm_1',
          title: '自己申告の確認',
          summary: '飲み忘れ',
          channel: 'patient_portal',
          status: 'submitted',
          priority: 'urgent',
          due_at: '2026-03-31T08:00:00Z',
          action_href: '/communications/requests',
          action_label: '確認',
          patient_name: '山田 太郎',
        },
      ],
    });
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
  });

  it('returns pipeline counts and sorted homepage actions', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pipeline: expect.arrayContaining([
          expect.objectContaining({ key: 'intake', count: 2 }),
          expect.objectContaining({ key: 'dispensing', count: 1 }),
        ]),
        actions: [
          expect.objectContaining({
            id: 'comm_1',
            item_type: 'self_report',
            priority: 'urgent',
          }),
          expect.objectContaining({
            id: 'task_1',
            item_type: 'task',
            priority: 'high',
          }),
        ],
      },
    });
  });
});
