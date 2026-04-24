// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { VisitsTable } from './visits-table';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: useQueryMock,
  };
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

describe('VisitsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
  });

  it('shows patient names and patient-level history links for each visit record', () => {
    useQueryMock.mockReturnValue({
      data: {
        data: [
          {
            id: 'visit_1',
            patient_id: 'patient_1',
            pharmacist_id: 'pharmacist_1',
            visit_date: '2026-04-20T10:00:00.000Z',
            outcome_status: 'completed',
            soap_subjective: '眠気なし',
            soap_objective: null,
            soap_assessment: null,
            soap_plan: null,
            schedule: {
              visit_type: 'regular',
              scheduled_date: '2026-04-20T00:00:00.000Z',
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田太郎',
                  name_kana: 'ヤマダタロウ',
                },
              },
            },
            patient_history_summary: {
              prescription_count: 1,
              visit_count: 2,
              latest_prescription: {
                id: 'intake_1',
                prescribed_date: '2026-04-18T00:00:00.000Z',
                prescriber_name: '佐藤医師',
                drug_names: ['アムロジピン錠5mg'],
              },
              previous_visit: {
                id: 'visit_prev',
                visit_date: '2026-04-01T10:00:00.000Z',
                outcome_status: 'completed_with_issue',
                next_visit_suggestion_date: '2026-04-20T00:00:00.000Z',
              },
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<VisitsTable />);

    expect(screen.getByText('患者ごとの過去歴確認')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: '山田太郎' })[0]?.getAttribute('href')).toBe(
      '/patients/patient_1?tab=visits',
    );
    expect(screen.getAllByRole('link', { name: '処方歴' })[0]?.getAttribute('href')).toBe(
      '/patients/patient_1/prescriptions',
    );
    expect(screen.getAllByRole('link', { name: '訪問歴' })[0]?.getAttribute('href')).toBe(
      '/patients/patient_1?tab=visits',
    );
    expect(screen.getAllByText(/直近処方:/)[0]?.textContent).toContain('アムロジピン錠5mg');
    expect(screen.getAllByText(/前回訪問:/)[0]?.textContent).toContain('完了（課題あり）');
  });

  it('requests patient history summaries only for the visit management table', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    useQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });

    render(<VisitsTable />);

    const queryOptions = useQueryMock.mock.calls[0]?.[0] as { queryFn: () => Promise<unknown> };
    await queryOptions.queryFn();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('include_history_summary=true'),
      expect.objectContaining({
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    vi.unstubAllGlobals();
  });
});
