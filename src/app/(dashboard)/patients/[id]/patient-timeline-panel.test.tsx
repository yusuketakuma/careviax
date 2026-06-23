// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientTimelinePanel } from './patient-timeline-panel';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('./patient-activity-timeline', () => ({
  PatientActivityTimeline: () => <div>activity timeline</div>,
}));

describe('PatientTimelinePanel', () => {
  it('renders timeline errors with a semantic section heading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('患者タイムラインの取得に失敗しました'),
    });

    render(<PatientTimelinePanel patientId="patient_1" enabled />);

    expect(screen.getByRole('heading', { level: 2, name: 'タイムライン' }).tagName).toBe('H2');
    expect(screen.getByText('患者タイムラインの取得に失敗しました')).toBeTruthy();
  });

  it('builds the timeline fetch URL with an encoded hostile patientId and org header', async () => {
    const hostileId = 'pt/1?x=y#z';
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientTimelinePanel patientId={hostileId} enabled />);

      expect(captured?.queryKey).toEqual(['patient-timeline', hostileId, 'org_1']);

      await captured?.queryFn();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/timeline`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect((init.headers as Record<string, string>)['x-org-id']).toBe('org_1');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p',
    async (dotId) => {
      useOrgIdMock.mockReturnValue('org_1');

      let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
      useQueryMock.mockImplementation(
        (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
          captured = config;
          return { data: undefined, isLoading: true, error: null };
        },
      );

      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientTimelinePanel patientId={dotId} enabled />);
        await expect(captured?.queryFn()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );
});
