// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { PatientFieldRevisionTimeline } from './patient-field-revision-timeline';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

describe('PatientFieldRevisionTimeline', () => {
  it('routes field revision fetches through the shared patient API path helper', async () => {
    const patientId = 'pt/1?tab=x#frag';
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_pt__/field-revisions',
    );
    useOrgIdMock.mockReturnValue('org_1');

    const capturedQueries: Array<{ queryKey: unknown[]; queryFn: () => Promise<unknown> }> = [];
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        capturedQueries.push(config);
        return { data: { data: [] }, isLoading: false, error: null };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientFieldRevisionTimeline patientId={patientId} />);
      fireEvent.click(screen.getByRole('button', { name: '基本情報' }));

      const latestQuery = capturedQueries.at(-1);
      expect(latestQuery?.queryKey).toEqual([
        'patient-field-revisions',
        patientId,
        'org_1',
        'basic',
      ]);

      await latestQuery?.queryFn();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId, '/field-revisions');
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/patients/__helper_pt__/field-revisions?category=basic',
        {
          headers: { 'x-org-id': 'org_1' },
        },
      );
      expect(fetchMock).not.toHaveBeenCalledWith(
        `/api/patients/${patientId}/field-revisions?category=basic`,
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p',
    async (dotId) => {
      useOrgIdMock.mockReturnValue('org_1');

      let capturedQuery: { queryFn: () => Promise<unknown> } | undefined;
      useQueryMock.mockImplementation((config: { queryFn: () => Promise<unknown> }) => {
        capturedQuery = config;
        return { data: { data: [] }, isLoading: false, error: null };
      });

      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientFieldRevisionTimeline patientId={dotId} />);
        await expect(capturedQuery?.queryFn()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );
});
