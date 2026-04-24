// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
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
});
