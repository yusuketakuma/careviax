// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { ManagementPlanPanel } from './management-plan-panel';

setupDomTestEnv();

describe('ManagementPlanPanel', () => {
  it('renders the no-case state with a semantic section heading', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <ManagementPlanPanel patientId="patient_1" patientName="山田花子" cases={[]} orgId="org_1" />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '管理計画書' }).tagName).toBe('H2');
    expect(screen.getByText('ケースがありません')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      'ケース作成後に管理計画書を登録できます',
    );
  });

  it('exposes the management-plan case selector by label', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <ManagementPlanPanel
        patientId="patient_1"
        patientName="山田花子"
        orgId="org_1"
        cases={[
          {
            id: 'case_active_123456',
            status: 'active',
            primary_pharmacist_id: 'pharmacist_1',
            referral_source: '居宅介護支援事業所',
            start_date: '2026-06-02',
            end_date: null,
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('管理計画書のケース')).toBeTruthy();
  });
});
