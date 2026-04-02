// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientMcsContent } from './mcs-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PatientMcsContent', () => {
  it('shows an inline validation error and keeps actions disabled for invalid draft urls', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    useQueryMock.mockReturnValue({
      data: {
        link: {
          sourceUrl: null,
          projectTitle: null,
          projectMemo: null,
          memberCount: null,
          lastSyncAttemptAt: null,
          lastSyncedAt: null,
          lastSyncError: null,
        },
        summary: null,
        messages: [],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PatientMcsContent patientId="patient_1" />);

    fireEvent.change(screen.getByLabelText('MCS 連携元 URL'), {
      target: { value: 'invalid-url' },
    });

    await waitFor(() => {
      expect(
        screen.getByText('MCS の患者 URL または医療・介護側タイムライン URL を入力してください')
      ).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: '今すぐ同期' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'MCS で開く' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '患者ページ' }).hasAttribute('disabled')).toBe(true);
  });
});
