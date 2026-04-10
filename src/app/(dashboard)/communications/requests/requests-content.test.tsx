// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({ data }: { data: Array<{ subject: string }> }) => (
    <div data-testid="communications-table">{data.map((item) => item.subject).join(',')}</div>
  ),
}));

import { CommunicationRequestsContent } from './requests-content';

setupDomTestEnv();

describe('CommunicationRequestsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/communications/requests');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=dashboard_home'));
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });
  });

  it('shows the home context banner for sent communications focus', () => {
    render(
      <CommunicationRequestsContent
        initialStatus="sent"
        initialContext="dashboard_home"
      />,
    );

    expect(screen.getByTestId('communications-context-banner')).toBeTruthy();
    expect(screen.getByText('ホームから返信待ちの依頼・照会にフォーカスして開いています。')).toBeTruthy();
  });
});
