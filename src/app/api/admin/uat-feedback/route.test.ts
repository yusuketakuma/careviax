import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  feedbackFindManyMock,
  feedbackCreateMock,
} = vi.hoisted(() => ({
  feedbackFindManyMock: vi.fn(),
  feedbackCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>) =>
    handler,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    uatFeedback: {
      findMany: feedbackFindManyMock,
      create: feedbackCreateMock,
    },
  },
}));

import { GET, POST } from './route';

function createAuthRequest(init?: ConstructorParameters<typeof NextRequest>[1]) {
  return Object.assign(new NextRequest('http://localhost/api/admin/uat-feedback', init), {
    orgId: 'org_1',
    userId: 'user_1',
  });
}

function createJsonAuthRequest(body: unknown) {
  return createAuthRequest({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('/api/admin/uat-feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    feedbackFindManyMock.mockResolvedValue([
      {
        id: 'feedback_1',
        org_id: 'org_1',
        submitted_by: 'user_1',
        priority: 'high',
        status: 'open',
        owner_user_id: null,
        feedback: '訪問後の戻る導線を改善したい',
        checklist_progress: '4/7',
        checked_items: ['flow_patient_to_report'],
        source: 'pilot_pharmacy',
        linked_work_item: null,
        due_date: null,
        resolved_at: null,
        created_at: new Date('2026-03-28T12:00:00.000Z'),
        updated_at: new Date('2026-03-28T12:00:00.000Z'),
      },
    ]);
    feedbackCreateMock.mockResolvedValue({
      id: 'feedback_2',
      org_id: 'org_1',
      submitted_by: 'user_1',
      priority: 'medium',
      status: 'open',
      owner_user_id: null,
      feedback: '帳票の余白が広い',
      checklist_progress: '5/7',
      checked_items: ['check_mobile'],
      source: 'pilot_pharmacy',
      linked_work_item: null,
      due_date: null,
      resolved_at: null,
      created_at: new Date('2026-03-28T13:00:00.000Z'),
      updated_at: new Date('2026-03-28T13:00:00.000Z'),
    });
  });

  it('lists persisted UAT feedback', async () => {
    const response = await GET(createAuthRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(feedbackFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1' },
      orderBy: [{ created_at: 'desc' }],
      take: 100,
    });
  });

  it('stores feedback with checklist state', async () => {
    const response = await POST(
      createJsonAuthRequest({
        priority: 'medium',
        feedback: '帳票の余白が広い',
        checklist_progress: '5/7',
        checked_items: ['check_mobile'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(feedbackCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        submitted_by: 'user_1',
        priority: 'medium',
        status: 'open',
        owner_user_id: null,
        feedback: '帳票の余白が広い',
        checklist_progress: '5/7',
        checked_items: ['check_mobile'],
        source: 'pilot_pharmacy',
        linked_work_item: null,
        due_date: null,
        resolved_at: null,
      },
    });
  });
});
