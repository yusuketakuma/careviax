import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getUatFeedbackSummaryMock } = vi.hoisted(() => ({
  getUatFeedbackSummaryMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'admin' },
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext = emptyRouteContext) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/server/services/uat-feedback-summary', () => ({
  getUatFeedbackSummary: getUatFeedbackSummaryMock,
}));

import { GET } from './route';

function createAuthRequest() {
  return new NextRequest('http://localhost/api/admin/uat-feedback/summary');
}

describe('/api/admin/uat-feedback/summary GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUatFeedbackSummaryMock.mockResolvedValue({
      generated_at: '2026-03-31T00:00:00.000Z',
      total_feedback: 3,
      priorities: {
        critical: 1,
        high: 1,
        medium: 1,
        low: 0,
      },
      blocker_count: 2,
      action_items: [
        {
          id: 'feedback_1',
          priority: 'critical',
          status: 'open',
          feedback: '保存時にエラー',
          checklist_progress: '4/8',
          source: 'pilot',
          created_at: '2026-03-31T00:00:00.000Z',
        },
      ],
      checklist_coverage: [],
      recommendations: [
        'critical/high の blocker が 2 件あります。Phase 2 開始前に action_items の解消を優先してください。',
      ],
    });
  });

  it('returns the UAT feedback summary for the authenticated org', async () => {
    const response = await GET(createAuthRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(getUatFeedbackSummaryMock).toHaveBeenCalledWith('org_1');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        total_feedback: 3,
        blocker_count: 2,
      },
    });
  });
});
