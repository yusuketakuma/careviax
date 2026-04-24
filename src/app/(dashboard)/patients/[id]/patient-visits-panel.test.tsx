// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientVisitsPanel } from './patient-visits-panel';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/components/home-care/home-care-feature-board', () => ({
  HomeCareFeatureBoard: () => <div>訪問支援サマリー</div>,
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

const visitsSnapshot = {
  monthly_visit_count: 2,
  visit_schedules: [
    {
      id: 'schedule_1',
      scheduled_date: '2026-04-10T00:00:00.000Z',
      schedule_status: 'completed',
      priority: 'normal',
      confirmed_at: '2026-04-09T10:00:00.000Z',
      route_order: 1,
      visit_record: {
        id: 'record_1',
        outcome_status: 'completed',
      },
    },
    {
      id: 'schedule_2',
      scheduled_date: '2026-04-11T00:00:00.000Z',
      schedule_status: 'ready',
      priority: 'urgent',
      confirmed_at: null,
      route_order: null,
      visit_record: null,
    },
  ],
  visit_records: [
    {
      id: 'record_1',
      schedule_id: 'schedule_1',
      visit_date: '2026-04-10T10:00:00.000Z',
      outcome_status: 'completed',
      next_visit_suggestion_date: null,
      cancellation_reason: null,
      postpone_reason: null,
      revisit_reason: null,
      created_at: '2026-04-10T10:30:00.000Z',
    },
  ],
  home_care_feature_summary: {},
};

describe('PatientVisitsPanel', () => {
  it('separates schedule-board links from visit-record links', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'patient-visits-panel') {
        return {
          data: visitsSnapshot,
          isLoading: false,
          error: null,
        };
      }

      return {
        data: { data: visitsSnapshot.visit_records },
        isLoading: false,
        error: null,
      };
    });

    render(
      <PatientVisitsPanel
        patientId="patient_1"
        medicalInsuranceNumber="medical_1"
        careInsuranceNumber={null}
        enabled
      />,
    );

    expect(screen.getAllByRole('link', { name: '2026年4月10日(金)' })[0]?.getAttribute('href')).toBe(
      '/schedules?date=2026-04-10&tab=confirmed&schedule=schedule_1#schedule-schedule_1',
    );
    expect(screen.getAllByRole('link', { name: '記録詳細' })[0]?.getAttribute('href')).toBe(
      '/visits/record_1',
    );
    expect(screen.getByRole('link', { name: '訪問記録入力' }).getAttribute('href')).toBe(
      '/visits/schedule_2/record',
    );
    expect(screen.getByText('完了')).toBeTruthy();
    expect(screen.getByText('至急')).toBeTruthy();
  });
});
