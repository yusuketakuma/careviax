import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getPilotOrgAuditSnapshotMock } = vi.hoisted(() => ({
  getPilotOrgAuditSnapshotMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>) =>
    handler,
}));

vi.mock('@/server/services/pilot-org-audit', () => ({
  getPilotOrgAuditSnapshot: getPilotOrgAuditSnapshotMock,
}));

import { GET } from './route';

function createAuthRequest() {
  return Object.assign(new NextRequest('http://localhost/api/admin/pilot-org-audit'), {
    orgId: 'org_1',
    userId: 'user_1',
  });
}

describe('/api/admin/pilot-org-audit GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPilotOrgAuditSnapshotMock.mockResolvedValue({
      generated_at: '2026-03-31T00:00:00.000Z',
      org_structure: {
        site_count: 2,
        active_member_count: 6,
        role_counts: { owner: 1, admin: 1, pharmacist: 4 },
        site_breakdown: [],
      },
      pilot_targets: {
        active_case_count: 10,
        facility_linked_case_count: 3,
        set_pilot_case_count: 2,
      },
      coverage: {
        total_primary_residences: 10,
        flagged_patient_count: 2,
        flagged_patients_truncated: false,
        service_area_covered_count: 7,
        radius_16km_covered_count: 1,
        uncovered_count: 1,
        review_required_count: 1,
        flagged_patients: [],
      },
      recommendations: ['service area 未設定の店舗があります。16km 圏確認前に訪問エリアを登録してください。'],
    });
  });

  it('returns the org audit snapshot for the authenticated org', async () => {
    const response = await GET(createAuthRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(getPilotOrgAuditSnapshotMock).toHaveBeenCalledWith('org_1');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        org_structure: {
          site_count: 2,
        },
        coverage: {
          uncovered_count: 1,
        },
      },
    });
  });
});
