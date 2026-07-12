// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';
import { buildVisitHref } from '@/lib/visits/navigation';
import { PatientHistorySummary } from './patient-history-summary';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

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

// Actual-backed spies: real encode/guard output for existing + hostile tests,
// plus return-value delegation teeth for the four browser hrefs.
vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});
vi.mock('@/lib/prescriptions/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/prescriptions/navigation')>();
  return { ...actual, buildPrescriptionHref: vi.fn(actual.buildPrescriptionHref) };
});
vi.mock('@/lib/visits/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/visits/navigation')>();
  return { ...actual, buildVisitHref: vi.fn(actual.buildVisitHref) };
});

function primeQueries(opts: { previousPrescriptionId?: string; previousVisitId?: string } = {}) {
  const previousPrescriptionId = opts.previousPrescriptionId ?? 'previous_intake';
  const previousVisitId = opts.previousVisitId ?? 'visit_1';
  useOrgIdMock.mockReturnValue('org_1');
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'patient-history-summary-prescriptions') {
      return {
        data: {
          data: [
            {
              id: 'current_intake',
              prescribed_date: '2026-04-20T00:00:00.000Z',
              prescriber_name: '現在医師',
              lines: [{ drug_name: '現在薬', dose: '1錠' }],
            },
            {
              id: previousPrescriptionId,
              prescribed_date: '2026-04-01T00:00:00.000Z',
              prescriber_name: '佐藤医師',
              lines: [{ drug_name: 'アムロジピン錠5mg', dose: '1錠' }],
            },
          ],
        },
        isLoading: false,
        error: null,
      };
    }
    return {
      data: {
        data: [
          {
            id: previousVisitId,
            visit_date: '2026-04-10T10:00:00.000Z',
            outcome_status: 'completed',
            soap_assessment: '眠気なく継続可',
            next_visit_suggestion_date: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    };
  });
}

describe('PatientHistorySummary', () => {
  it('shows independent loading states without claiming either history is empty', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      isRefetchError: false,
      refetch: vi.fn(),
    });

    render(<PatientHistorySummary patientId="patient_1" />);

    expect(screen.getByRole('status', { name: '過去処方を読み込み中' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '過去訪問を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('過去処方はありません')).toBeNull();
    expect(screen.queryByText('過去訪問はありません')).toBeNull();
  });

  it('keeps the successful visit segment visible when prescriptions fail and offers retry', () => {
    const prescriptionRefetch = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'patient-history-summary-prescriptions') {
        return {
          data: undefined,
          isLoading: false,
          isPending: false,
          isError: true,
          isRefetchError: false,
          error: new Error('provider details must not render'),
          refetch: prescriptionRefetch,
        };
      }
      return {
        data: {
          data: [
            {
              id: 'visit_1',
              visit_date: '2026-04-10T10:00:00.000Z',
              outcome_status: 'completed',
              soap_assessment: '眠気なく継続可',
              next_visit_suggestion_date: null,
            },
          ],
        },
        isLoading: false,
        isPending: false,
        isError: false,
        isRefetchError: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    render(<PatientHistorySummary patientId="patient_1" />);

    expect(
      screen.getByRole('heading', { level: 3, name: '過去処方を表示できません' }),
    ).toBeTruthy();
    expect(screen.getByText('眠気なく継続可')).toBeTruthy();
    expect(screen.queryByText('provider details must not render')).toBeNull();
    expect(screen.queryByText('過去処方はありません')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(prescriptionRefetch).toHaveBeenCalledOnce();
  });

  it('keeps the successful prescription segment visible when visits fail and offers retry', () => {
    const visitRefetch = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'patient-history-summary-prescriptions') {
        return {
          data: {
            data: [
              {
                id: 'previous_intake',
                prescribed_date: '2026-04-01T00:00:00.000Z',
                prescriber_name: '佐藤医師',
                lines: [{ drug_name: 'アムロジピン錠5mg', dose: '1錠' }],
              },
            ],
          },
          isLoading: false,
          isPending: false,
          isError: false,
          isRefetchError: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: undefined,
        isLoading: false,
        isPending: false,
        isError: true,
        isRefetchError: false,
        error: new Error('provider details must not render'),
        refetch: visitRefetch,
      };
    });

    render(<PatientHistorySummary patientId="patient_1" />);

    expect(
      screen.getByRole('heading', { level: 3, name: '過去訪問を表示できません' }),
    ).toBeTruthy();
    expect(screen.getByText('アムロジピン錠5mg')).toBeTruthy();
    expect(screen.queryByText('provider details must not render')).toBeNull();
    expect(screen.queryByText('過去訪問はありません')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(visitRefetch).toHaveBeenCalledOnce();
  });

  it('keeps cached prescription data visible and labels it stale after refetch failure', () => {
    const prescriptionRefetch = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'patient-history-summary-prescriptions') {
        return {
          data: {
            data: [
              {
                id: 'previous_intake',
                prescribed_date: '2026-04-01T00:00:00.000Z',
                prescriber_name: '佐藤医師',
                lines: [{ drug_name: 'アムロジピン錠5mg', dose: '1錠' }],
              },
            ],
          },
          isLoading: false,
          isPending: false,
          isError: true,
          isRefetchError: true,
          error: new Error('refresh failed'),
          refetch: prescriptionRefetch,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        isPending: false,
        isError: false,
        isRefetchError: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    render(<PatientHistorySummary patientId="patient_1" />);

    expect(screen.getByText('前回取得した処方を表示中')).toBeTruthy();
    expect(screen.getByText('アムロジピン錠5mg')).toBeTruthy();
    expect(screen.getByRole('link', { name: '2026/04/01' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(prescriptionRefetch).toHaveBeenCalledOnce();
  });

  it('shows previous prescription and visit summaries in the current workflow page', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'patient-history-summary-prescriptions') {
        return {
          data: {
            data: [
              {
                id: 'current_intake',
                prescribed_date: '2026-04-20T00:00:00.000Z',
                prescriber_name: '現在医師',
                lines: [{ drug_name: '現在薬', dose: '1錠' }],
              },
              {
                id: 'previous_intake',
                prescribed_date: '2026-04-01T00:00:00.000Z',
                prescriber_name: '佐藤医師',
                lines: [
                  { drug_name: 'アムロジピン錠5mg', dose: '1錠' },
                  { drug_name: 'ロキソプロフェン錠60mg', dose: '1錠' },
                  { drug_name: '酸化マグネシウム錠330mg', dose: '2錠' },
                ],
              },
            ],
          },
          isLoading: false,
          error: null,
        };
      }

      return {
        data: {
          data: [
            {
              id: 'visit_1',
              visit_date: '2026-04-10T10:00:00.000Z',
              outcome_status: 'completed',
              soap_assessment: '眠気なく継続可',
              next_visit_suggestion_date: null,
            },
          ],
        },
        isLoading: false,
        error: null,
      };
    });

    render(
      <PatientHistorySummary patientId="patient_1" excludePrescriptionIntakeId="current_intake" />,
    );

    expect(screen.getByRole('heading', { name: '直近過去歴サマリー' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '2026/04/01' }).getAttribute('href')).toBe(
      '/prescriptions/previous_intake',
    );
    expect(screen.getByRole('link', { name: '2026/04/01' }).className).toContain('min-h-11');
    expect(screen.getByRole('link', { name: '2026/04/01' }).className).not.toContain('sm:min-h-0');
    expect(screen.getByText(/アムロジピン錠5mg、ロキソプロフェン錠60mg 他1剤/)).toBeTruthy();
    expect(screen.getByText(/眠気なく継続可/)).toBeTruthy();
  });

  describe('shared href helper convergence (F-043)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('routes the prescriptions summary fetch through the shared patient API path helper', async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ data: { data: [], hasMore: false } })),
      );
      vi.stubGlobal('fetch', fetchMock);
      vi.mocked(buildPatientApiPath).mockReturnValueOnce(
        '/api/patients/__helper_pt__/prescriptions',
      );
      let capturedQueryFn: (() => Promise<unknown>) | undefined;
      useOrgIdMock.mockReturnValue('org_1');
      useQueryMock.mockImplementation(
        ({ queryKey, queryFn }: { queryKey: string[]; queryFn: () => Promise<unknown> }) => {
          if (queryKey[0] === 'patient-history-summary-prescriptions') {
            capturedQueryFn = queryFn;
          }
          return { data: { data: [] }, isLoading: false, error: null };
        },
      );

      render(<PatientHistorySummary patientId="pt/1?tab=x#frag" />);
      await capturedQueryFn?.();

      expect(buildPatientApiPath).toHaveBeenCalledWith('pt/1?tab=x#frag', '/prescriptions');
      expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_pt__/prescriptions?limit=5', {
        headers: { 'x-org-id': 'org_1' },
      });
      expect(fetchMock).not.toHaveBeenCalledWith(
        '/api/patients/pt/1?tab=x#frag/prescriptions?limit=5',
        expect.anything(),
      );

      vi.unstubAllGlobals();
    });

    it('surfaces API messages from prescriptions and visits read queries', async () => {
      const queryFns: Record<string, () => Promise<unknown>> = {};
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/prescriptions')) {
          return new Response(JSON.stringify({ message: '処方履歴の閲覧権限がありません' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.startsWith('/api/visit-records?')) {
          return new Response(JSON.stringify({ message: '訪問履歴の閲覧権限がありません' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      useOrgIdMock.mockReturnValue('org_1');
      useQueryMock.mockImplementation(
        ({ queryKey, queryFn }: { queryKey: string[]; queryFn: () => Promise<unknown> }) => {
          queryFns[queryKey[0]] = queryFn;
          return { data: { data: [] }, isLoading: false, error: null };
        },
      );

      render(<PatientHistorySummary patientId="patient_1" />);

      await expect(queryFns['patient-history-summary-prescriptions']?.()).rejects.toThrow(
        '処方履歴の閲覧権限がありません',
      );
      await expect(queryFns['patient-history-summary-visits']?.()).rejects.toThrow(
        '訪問履歴の閲覧権限がありません',
      );

      vi.unstubAllGlobals();
    });

    it('validates and minimizes prescription and visit history responses', async () => {
      const queryFns: Record<string, () => Promise<unknown>> = {};
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/prescriptions')) {
          return new Response(
            JSON.stringify({
              data: {
                patient: { id: 'patient_1', name: '患者名' },
                data: [
                  {
                    id: 'intake_1',
                    prescribed_date: '2026-04-20T00:00:00.000Z',
                    prescriber_name: '佐藤医師',
                    lines: [
                      {
                        id: 'line_1',
                        drug_name: '薬A',
                        dose: '1錠',
                        notes: 'provider-only note',
                      },
                    ],
                    cycle_id: 'cycle_1',
                  },
                ],
                hasMore: false,
                diff_review: { provider_only: true },
              },
            }),
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'visit_1',
                visit_date: '2026-04-10T10:00:00.000Z',
                outcome_status: 'completed',
                soap_assessment: '継続可',
                next_visit_suggestion_date: null,
                patient_id: 'provider-only-patient',
                soap_subjective: 'provider-only subjective',
              },
            ],
            meta: { has_more: false, next_cursor: null },
          }),
        );
      });
      vi.stubGlobal('fetch', fetchMock);
      useOrgIdMock.mockReturnValue('org_1');
      useQueryMock.mockImplementation(
        ({ queryKey, queryFn }: { queryKey: string[]; queryFn: () => Promise<unknown> }) => {
          queryFns[queryKey[0]] = queryFn;
          return { data: { data: [] }, isLoading: false, error: null };
        },
      );

      try {
        render(<PatientHistorySummary patientId="patient_1" />);

        await expect(queryFns['patient-history-summary-prescriptions']?.()).resolves.toEqual({
          data: [
            {
              id: 'intake_1',
              prescribed_date: '2026-04-20T00:00:00.000Z',
              prescriber_name: '佐藤医師',
              lines: [{ drug_name: '薬A', dose: '1錠' }],
            },
          ],
        });
        await expect(queryFns['patient-history-summary-visits']?.()).resolves.toEqual({
          data: [
            {
              id: 'visit_1',
              visit_date: '2026-04-10T10:00:00.000Z',
              outcome_status: 'completed',
              soap_assessment: '継続可',
              next_visit_suggestion_date: null,
            },
          ],
        });
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    });

    it('rejects malformed, duplicate, reverse-ordered, or inconsistent history pages', async () => {
      const queryFns: Record<string, () => Promise<unknown>> = {};
      useOrgIdMock.mockReturnValue('org_1');
      useQueryMock.mockImplementation(
        ({ queryKey, queryFn }: { queryKey: string[]; queryFn: () => Promise<unknown> }) => {
          queryFns[queryKey[0]] = queryFn;
          return { data: { data: [] }, isLoading: false, error: null };
        },
      );
      render(<PatientHistorySummary patientId="patient_1" />);

      const prescription = {
        id: 'intake_1',
        prescribed_date: '2026-04-20T00:00:00.000Z',
        prescriber_name: null,
        lines: [],
      };
      const visit = {
        id: 'visit_1',
        visit_date: '2026-04-10T10:00:00.000Z',
        outcome_status: 'completed',
        soap_assessment: null,
        next_visit_suggestion_date: null,
      };
      const cases = [
        {
          key: 'patient-history-summary-prescriptions',
          payload: { prescriptions: [prescription] },
        },
        {
          key: 'patient-history-summary-prescriptions',
          payload: {
            data: { data: [prescription, prescription], hasMore: false },
          },
        },
        {
          key: 'patient-history-summary-visits',
          payload: {
            data: [
              { ...visit, id: 'visit_old', visit_date: '2026-04-01T00:00:00.000Z' },
              { ...visit, id: 'visit_new', visit_date: '2026-04-10T00:00:00.000Z' },
            ],
            meta: { has_more: false, next_cursor: null },
          },
        },
        {
          key: 'patient-history-summary-visits',
          payload: {
            data: [visit],
            meta: { has_more: true, next_cursor: null },
          },
        },
      ];

      try {
        for (const testCase of cases) {
          vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify(testCase.payload), { status: 200 })),
          );
          await expect(queryFns[testCase.key]?.()).rejects.toThrow(/履歴の取得に失敗しました/);
        }
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    });

    it('all four browser links consume the shared helper return values', () => {
      primeQueries();
      const realPatient = vi.mocked(buildPatientHref).getMockImplementation();
      const realRx = vi.mocked(buildPrescriptionHref).getMockImplementation();
      const realVisit = vi.mocked(buildVisitHref).getMockImplementation();
      vi.mocked(buildPatientHref).mockImplementation(
        (id: string, suffix = '') => `/patients/__sentinel_${id}__${suffix}`,
      );
      vi.mocked(buildPrescriptionHref).mockImplementation(
        (id: string) => `/prescriptions/__s_${id}__`,
      );
      vi.mocked(buildVisitHref).mockImplementation((id: string) => `/visits/__s_${id}__`);
      try {
        render(
          <PatientHistorySummary
            patientId="patient_1"
            excludePrescriptionIntakeId="current_intake"
          />,
        );

        expect(screen.getByRole('link', { name: '2026/04/01' }).getAttribute('href')).toBe(
          '/prescriptions/__s_previous_intake__',
        );
        expect(screen.getByRole('link', { name: '2026/04/10' }).getAttribute('href')).toBe(
          '/visits/__s_visit_1__',
        );
        expect(
          screen.getByRole('link', { name: /処方履歴をすべて見る/ }).getAttribute('href'),
        ).toBe('/patients/__sentinel_patient_1__/prescriptions');
        expect(screen.getByRole('link', { name: /処方履歴をすべて見る/ }).className).not.toContain(
          'sm:min-h-0',
        );
        expect(
          screen.getByRole('link', { name: /訪問履歴をすべて見る/ }).getAttribute('href'),
        ).toBe('/patients/__sentinel_patient_1__#card-recent-activities');

        expect(vi.mocked(buildPrescriptionHref).mock.calls).toEqual([['previous_intake']]);
        expect(vi.mocked(buildVisitHref).mock.calls).toEqual([['visit_1']]);
        expect(vi.mocked(buildPatientHref).mock.calls).toEqual([
          ['patient_1', '/prescriptions'],
          ['patient_1', '#card-recent-activities'],
        ]);
      } finally {
        if (realPatient) vi.mocked(buildPatientHref).mockImplementation(realPatient);
        if (realRx) vi.mocked(buildPrescriptionHref).mockImplementation(realRx);
        if (realVisit) vi.mocked(buildVisitHref).mockImplementation(realVisit);
      }
    });

    it('encodes hostile ids as single path segments across all four links', () => {
      primeQueries({
        previousPrescriptionId: 'rx/1?a=b#c',
        previousVisitId: 'vr/1?a=b#c',
      });
      render(
        <PatientHistorySummary
          patientId="pt/1?tab=x#frag"
          excludePrescriptionIntakeId="current_intake"
        />,
      );

      expect(screen.getByRole('link', { name: '2026/04/01' }).getAttribute('href')).toBe(
        `/prescriptions/${encodeURIComponent('rx/1?a=b#c')}`,
      );
      expect(screen.getByRole('link', { name: '2026/04/10' }).getAttribute('href')).toBe(
        `/visits/${encodeURIComponent('vr/1?a=b#c')}`,
      );
      expect(screen.getByRole('link', { name: /処方履歴をすべて見る/ }).getAttribute('href')).toBe(
        `/patients/${encodeURIComponent('pt/1?tab=x#frag')}/prescriptions`,
      );
      expect(screen.getByRole('link', { name: /訪問履歴をすべて見る/ }).getAttribute('href')).toBe(
        `/patients/${encodeURIComponent('pt/1?tab=x#frag')}#card-recent-activities`,
      );
    });
  });
});
