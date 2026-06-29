// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
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
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);
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
});
