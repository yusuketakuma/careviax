// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock,
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
}));

import { ConferencesContent } from './conferences-content';

setupDomTestEnv();

describe('ConferencesContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/conferences');
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'conference-notes' || queryKey[0] === 'conference-notes-calendar') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'community-activities') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'conference-external-professionals') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'conference-prescriber-institution-suggestion') {
        return { data: { data: null }, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });
  });

  it('shows the home context banner for notes focus', () => {
    render(
      <ConferencesContent
        initialFocus="notes"
        initialContext="dashboard_home"
      />,
    );

    expect(screen.getByTestId('conferences-context-banner')).toBeTruthy();
    expect(screen.getByText('ホームからカンファレンス記録にフォーカスして開いています。')).toBeTruthy();
  });
});
