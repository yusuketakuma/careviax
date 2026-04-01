import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  getPmdaOnboardingSummaryMock,
  getBackupDrillSummaryMock,
  getIsmsReadinessSummaryMock,
  getPilotLaunchDossierMock,
} = vi.hoisted(() => ({
  getPmdaOnboardingSummaryMock: vi.fn(),
  getBackupDrillSummaryMock: vi.fn(),
  getIsmsReadinessSummaryMock: vi.fn(),
  getPilotLaunchDossierMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>) =>
    handler,
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
    const response = await GET({
      orgId: 'org_1',
      userId: 'user_1',
    } as NextRequest & { orgId: string; userId: string });

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
