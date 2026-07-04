// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { jsonResponse } from '@/test/fetch-test-utils';
import { VisitBriefReviewContent } from './visit-brief-review-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe('VisitBriefReviewContent', () => {
  it('routes patient visit brief fetches through the shared patient API path helper', async () => {
    const patientId = 'pt/1?tab=x#frag';
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_pt__/visit-brief');

    let briefQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        if (config.queryKey[0] === 'visit-brief-review-patient') {
          return { data: { patientId }, isLoading: false, error: null };
        }
        if (config.queryKey[0] === 'patient-visit-brief') {
          briefQueryFn = config.queryFn;
        }
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: null }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<VisitBriefReviewContent visitId="visit_1" />);
      await briefQueryFn?.();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId, '/visit-brief');
      expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_pt__/visit-brief', {
        headers: { 'x-org-id': 'org_1' },
      });
      expect(fetchMock).not.toHaveBeenCalledWith(
        `/api/patients/${patientId}/visit-brief`,
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });
});
