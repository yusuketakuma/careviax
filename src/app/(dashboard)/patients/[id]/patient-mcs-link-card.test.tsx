// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientMcsLinkCard } from './patient-mcs-link-card';

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

describe('PatientMcsLinkCard', () => {
  it('renders MCS linkage status with a semantic section heading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        link: null,
        summary: null,
        isRestricted: false,
      },
      isError: false,
    });

    render(<PatientMcsLinkCard patientId="patient_1" />);

    expect(screen.getByRole('heading', { level: 2, name: 'MCS 連携' }).tagName).toBe('H2');
    expect(screen.getByText('患者別タイムラインを保存済みデータとして利用')).toBeTruthy();
  });
});
