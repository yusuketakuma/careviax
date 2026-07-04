// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { ResidualMedicationChart } from './residual-medication-chart';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

describe('ResidualMedicationChart', () => {
  it('builds residual medication query parameters with URLSearchParams', async () => {
    const patientId = 'pt/1?tab=x#frag&limit=999&evil=true';
    useOrgIdMock.mockReturnValue('org_1');

    let capturedQuery: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        capturedQuery = config;
        return { data: { data: [] }, isLoading: false };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: [] }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<ResidualMedicationChart patientId={patientId} />);

      expect(capturedQuery?.queryKey).toEqual(['residual-medications-chart', 'org_1', patientId]);

      await capturedQuery?.queryFn();

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/residual-medications?patient_id=${encodeURIComponent(patientId)}&limit=100`,
        { headers: { 'x-org-id': 'org_1' } },
      );
      expect(fetchMock).not.toHaveBeenCalledWith(
        `/api/residual-medications?patient_id=${patientId}&limit=100`,
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('falls back when the residual medication response has no JSON error message', async () => {
    useOrgIdMock.mockReturnValue('org_1');

    let capturedQuery: { queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation((config: { queryFn: () => Promise<unknown> }) => {
      capturedQuery = config;
      return { data: { data: [] }, isLoading: false };
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<ResidualMedicationChart patientId="pt_1" />);

      await expect(capturedQuery?.queryFn()).rejects.toThrow('残薬データの取得に失敗しました');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('uses an announced skeleton instead of visible plain loading text', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ResidualMedicationChart patientId="pt_1" />);

    expect(screen.getByRole('status', { name: '残薬データを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'div' })).toBeNull();
  });

  it('surfaces a retryable error instead of a false "no residual data" state when the fetch fails', () => {
    useOrgIdMock.mockReturnValue('org_1');
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<ResidualMedicationChart patientId="pt_1" />);

    expect(screen.getByText('残薬データを読み込めませんでした')).toBeTruthy();
    expect(screen.queryByText('残薬データがありません')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalled();

    vi.clearAllMocks();
  });

  it('buckets a JST-early-morning record by its JST civil day, not the UTC calendar day (CE09)', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      useOrgIdMock.mockReturnValue('org_1');
      useQueryMock.mockReturnValue({
        data: {
          data: [
            {
              id: 'r1',
              drug_name: '薬A',
              excess_days: 3,
              // JST 2026-06-12 08:00 = UTC 2026-06-11T23:00Z。UTC 日付束ねだと 06/11 に誤混入。
              created_at: '2026-06-11T23:00:00.000Z',
            },
          ],
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });

      const { container } = render(<ResidualMedicationChart patientId="pt_1" />);

      const labels = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
      expect(labels).toContain('06/12');
      expect(labels).not.toContain('06/11');
    } finally {
      vi.clearAllMocks();
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});
