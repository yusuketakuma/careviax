// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientReadinessCard } from './patient-readiness-card';

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

describe('PatientReadinessCard', () => {
  it('renders readiness summary with a semantic section heading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        applicable: true,
        overall_status: 'blocked',
        completed_count: 1,
        total_count: 2,
        current_case: { status: 'active' },
        items: [
          {
            key: 'management_plan',
            label: '管理計画書',
            description: '承認済みの管理計画書が必要です。',
            completed: false,
            severity: 'high',
            action_label: '確認する',
            action_href: '/patients/patient_1/management-plan',
          },
        ],
      },
      isLoading: false,
      error: null,
    });

    render(<PatientReadinessCard patientId="patient_1" />);

    expect(
      screen.getByRole('heading', { level: 2, name: '患者情報・訪問開始 readiness' }).tagName,
    ).toBe('H2');
    expect(screen.getByText('管理計画書')).toBeTruthy();
    expect(screen.getByRole('link', { name: '確認する' }).getAttribute('href')).toBe(
      '/patients/patient_1/management-plan',
    );
  });
});
