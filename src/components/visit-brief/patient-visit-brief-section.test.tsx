// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { PatientVisitBriefSection } from './patient-visit-brief-section';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/components/ui/loading', () => ({
  Loading: () => <div data-testid="loading" />,
}));

vi.mock('@/components/visit-brief/visit-brief-card', () => ({
  VisitBriefCard: ({
    brief,
    title,
    description,
    compact,
  }: {
    brief: { patient: { id: string } };
    title: string;
    description: string;
    compact?: boolean;
  }) => (
    <article
      data-testid="visit-brief-card"
      data-patient-id={brief.patient.id}
      data-title={title}
      data-description={description}
      data-compact={String(Boolean(compact))}
    />
  ),
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

setupDomTestEnv();

describe('PatientVisitBriefSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
  });

  it('routes the visit brief fetch through the shared patient API path helper', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { patient: { id: 'patient_1?x=1#frag' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_patient_1__/visit-brief',
    );
    let capturedQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation((options) => {
      capturedQueryFn = options.queryFn;
      return {
        data: { data: { patient: { id: 'patient_1?x=1#frag' } } },
        isLoading: false,
        error: null,
      };
    });

    render(
      <PatientVisitBriefSection
        patientId="patient_1?x=1#frag"
        title="訪問前要約"
        description="確認事項"
        compact
      />,
    );
    await capturedQueryFn?.();

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['patient-visit-brief', 'patient_1?x=1#frag', 'org_1'],
        enabled: true,
      }),
    );
    expect(buildPatientApiPath).toHaveBeenCalledWith('patient_1?x=1#frag', '/visit-brief');
    expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_patient_1__/visit-brief', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/patients/patient_1?x=1#frag/visit-brief',
      expect.anything(),
    );
    expect(screen.getByTestId('visit-brief-card').dataset.patientId).toBe('patient_1?x=1#frag');

    vi.unstubAllGlobals();
  });
});
