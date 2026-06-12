import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getPilotReadinessSnapshotMock } = vi.hoisted(() => ({
  getPilotReadinessSnapshotMock: vi.fn(),
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

vi.mock('@/server/services/pilot-readiness', () => ({
  getPilotReadinessSnapshot: getPilotReadinessSnapshotMock,
}));

import { GET } from './route';

function createAuthRequest() {
  return new NextRequest('http://localhost/api/admin/pilot-readiness');
}

describe('/api/admin/pilot-readiness GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPilotReadinessSnapshotMock.mockResolvedValue({
      generated_at: '2026-03-31T00:00:00.000Z',
      case_summary: {
        active_case_count: 4,
        facility_linked_case_count: 2,
        non_facility_case_count: 2,
        facility_count: 1,
        set_pilot_case_count: 1,
        set_pilot_without_facility_count: 0,
      },
      uat_summary: {
        total_feedback: 3,
        critical_count: 1,
        high_count: 1,
        medium_count: 1,
        low_count: 0,
        blocker_count: 2,
        recent_feedback: [],
      },
      decisions: {
        facility_batching: 'ready',
        medication_set_workflow: 'ready',
        phase2_entry: 'blocked',
      },
      recommendations: [
        'UAT に critical/high が 2 件あります。Phase 2 開始前に優先修正を完了してください。',
      ],
    });
  });

  it('returns the pilot readiness snapshot for the authenticated org', async () => {
    const response = await GET(createAuthRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(getPilotReadinessSnapshotMock).toHaveBeenCalledWith('org_1');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        case_summary: {
          active_case_count: 4,
        },
        decisions: {
          phase2_entry: 'blocked',
        },
      },
    });
  });
});
