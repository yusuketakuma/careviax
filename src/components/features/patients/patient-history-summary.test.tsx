// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
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
    expect(screen.getByText(/アムロジピン錠5mg、ロキソプロフェン錠60mg 他1剤/)).toBeTruthy();
    expect(screen.getByText(/眠気なく継続可/)).toBeTruthy();
  });

  describe('shared href helper convergence (F-043)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
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
