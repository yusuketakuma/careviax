import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '@/test/fetch-test-utils';
import { CYCLE_STATUS_LABELS } from '@/lib/prescription/cycle-workspace';
import { fetchCycleTransitionLogs, WORKFLOW_STATUS_LABELS } from './cycle-transition-query';

const buildOrgHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({
    'x-org-id': `org-header:${orgId}`,
    'x-test-helper': 'buildOrgHeaders',
  })),
);

vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
}));

describe('fetchCycleTransitionLogs', () => {
  it('reuses the canonical cycle status labels for workflow history', () => {
    expect(WORKFLOW_STATUS_LABELS).toBe(CYCLE_STATUS_LABELS);
    expect(WORKFLOW_STATUS_LABELS.audited).toBe('監査済');
    expect(WORKFLOW_STATUS_LABELS.visit_completed).toBe('訪問完了');
  });

  it('fetches cycle transition history with the existing URL and org headers', async () => {
    const logs = [
      {
        id: 'log_1',
        from_status: 'dispensing',
        to_status: 'dispensed',
        actor_name: '薬剤師A',
        note: null,
        created_at: '2026-07-04T00:00:00.000Z',
      },
    ];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: logs }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(
        fetchCycleTransitionLogs({ cycleId: 'cycle_1', orgId: 'org_1' }),
      ).resolves.toEqual(logs);

      expect(fetchMock).toHaveBeenCalledWith('/api/medication-cycles/cycle_1/history', {
        headers: { 'x-org-id': 'org-header:org_1', 'x-test-helper': 'buildOrgHeaders' },
      });
      expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('falls back when the history response has no JSON error message', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(
        fetchCycleTransitionLogs({ cycleId: 'cycle_1', orgId: 'org_1' }),
      ).rejects.toThrow('履歴の取得に失敗しました');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });
});
