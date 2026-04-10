// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

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

import { ExternalViewerContent } from './external-viewer-content';

setupDomTestEnv();

describe('ExternalViewerContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });
  });

  it('shows the home context banner for self report focus', () => {
    render(
      <ExternalViewerContent
        initialFocus="self_reports"
        initialContext="dashboard_home"
      />,
    );

    expect(screen.getByTestId('external-context-banner')).toBeTruthy();
    expect(screen.getByText('ホームから自己申告キューにフォーカスして開いています。')).toBeTruthy();
  });
});
