import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  feedbackFindFirstMock,
  feedbackUpdateMock,
  userFindFirstMock,
  requireAuthContextMock,
} = vi.hoisted(() => ({
  feedbackFindFirstMock: vi.fn(),
  feedbackUpdateMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    uatFeedback: {
      findFirst: feedbackFindFirstMock,
      update: feedbackUpdateMock,
    },
    user: {
      findFirst: userFindFirstMock,
    },
  },
}));

import { PATCH } from './route';

describe('/api/admin/uat-feedback/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    feedbackFindFirstMock.mockResolvedValue({
      id: 'feedback_1',
      status: 'open',
      resolved_at: null,
    });
    userFindFirstMock.mockResolvedValue({ id: 'user_2' });
    feedbackUpdateMock.mockResolvedValue({
      id: 'feedback_1',
      org_id: 'org_1',
      submitted_by: 'user_1',
      priority: 'high',
      status: 'resolved',
      owner_user_id: 'user_2',
      feedback: '重要な導線修正',
      checklist_progress: '5/8',
      checked_items: ['flow_patient_to_report'],
      source: 'pilot_pharmacy',
      linked_work_item: 'CVX-102',
      due_date: new Date('2026-04-02T00:00:00.000Z'),
      resolved_at: new Date('2026-03-31T12:00:00.000Z'),
      created_at: new Date('2026-03-30T12:00:00.000Z'),
      updated_at: new Date('2026-03-31T12:00:00.000Z'),
    });
  });

  it('updates triage fields and resolves the feedback', async () => {
    const response = await PATCH(
      {
        json: async () => ({
          status: 'resolved',
          owner_user_id: 'user_2',
          linked_work_item: 'CVX-102',
          due_date: '2026-04-02T00:00:00.000Z',
        }),
      } as unknown as NextRequest,
      { params: Promise.resolve({ id: 'feedback_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(feedbackUpdateMock).toHaveBeenCalledWith({
      where: { id: 'feedback_1' },
      data: expect.objectContaining({
        status: 'resolved',
        owner_user_id: 'user_2',
        linked_work_item: 'CVX-102',
        due_date: new Date('2026-04-02T00:00:00.000Z'),
        resolved_at: expect.any(Date),
      }),
    });
  });

  it('rejects an owner outside the org', async () => {
    userFindFirstMock.mockResolvedValue(null);

    const response = await PATCH(
      {
        json: async () => ({
          owner_user_id: 'user_x',
        }),
      } as unknown as NextRequest,
      { params: Promise.resolve({ id: 'feedback_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
  });

  it('preserves the original resolved_at when a resolved item is re-saved', async () => {
    const originalResolvedAt = new Date('2026-03-29T12:00:00.000Z');
    feedbackFindFirstMock.mockResolvedValue({
      id: 'feedback_1',
      status: 'resolved',
      resolved_at: originalResolvedAt,
    });

    await PATCH(
      {
        json: async () => ({
          status: 'resolved',
          linked_work_item: 'CVX-103',
        }),
      } as unknown as NextRequest,
      { params: Promise.resolve({ id: 'feedback_1' }) }
    );

    expect(feedbackUpdateMock).toHaveBeenCalledWith({
      where: { id: 'feedback_1' },
      data: expect.not.objectContaining({
        resolved_at: expect.anything(),
      }),
    });
  });
});
