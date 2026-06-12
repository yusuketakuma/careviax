import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withAuthContextMock,
  getPmdaOnboardingSummaryMock,
  getBackupDrillSummaryMock,
  getIsmsReadinessSummaryMock,
  getPilotLaunchDossierMock,
} = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'admin' },
        routeContext: { params: Promise<Record<string, never>> },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest, routeContext = emptyRouteContext) =>
        handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
    },
  ),
  getPmdaOnboardingSummaryMock: vi.fn(),
  getBackupDrillSummaryMock: vi.fn(),
  getIsmsReadinessSummaryMock: vi.fn(),
  getPilotLaunchDossierMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/operations/external-readiness', () => ({
  getPmdaOnboardingSummary: getPmdaOnboardingSummaryMock,
  getBackupDrillSummary: getBackupDrillSummaryMock,
  getIsmsReadinessSummary: getIsmsReadinessSummaryMock,
}));

vi.mock('@/server/services/pilot-launch-dossier', () => ({
  getPilotLaunchDossier: getPilotLaunchDossierMock,
}));

import { GET } from './route';

function createAuthRequest() {
  return new NextRequest('http://localhost/api/admin/pilot-launch-dossier');
}

describe('/api/admin/pilot-launch-dossier GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPmdaOnboardingSummaryMock.mockReturnValue({ ready_for_import_test: false });
    getBackupDrillSummaryMock.mockReturnValue({ ready_for_live_drill: false, recorded_runs: [] });
    getIsmsReadinessSummaryMock.mockReturnValue({
      ready_for_quote_request: true,
      comparison_table_started: false,
      decision_memo_started: false,
    });
    getPilotLaunchDossierMock.mockResolvedValue({
      generated_at: '2026-03-31T00:00:00.000Z',
      org_id: 'org_1',
      readiness: {
        decisions: { phase2_entry: 'blocked' },
      },
      org_audit: {
        coverage: {
          uncovered_count: 1,
          review_required_count: 0,
        },
      },
      uat_summary: {
        blocker_count: 2,
      },
      external_readiness: {
        pmda: { ready_for_import_test: false },
        backup: { ready_for_live_drill: false, recorded_runs: [] },
        isms: {
          ready_for_quote_request: true,
          comparison_table_started: false,
          decision_memo_started: false,
        },
      },
      recommendations: ['PMDA の前提が未完了です。'],
    });
  });

  it('returns a combined dossier for the authenticated org', async () => {
    const response = await GET(createAuthRequest(), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(getPilotLaunchDossierMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      externalReadiness: {
        pmda: { ready_for_import_test: false },
        backup: { ready_for_live_drill: false, recorded_runs: [] },
        isms: {
          ready_for_quote_request: true,
          comparison_table_started: false,
          decision_memo_started: false,
        },
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        org_id: 'org_1',
        uat_summary: {
          blocker_count: 2,
        },
      },
    });
  });
});
