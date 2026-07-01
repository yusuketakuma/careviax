// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { MentionInput } from './mention-input';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const buildOrgHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({
    'x-org-id': `org-header:${orgId}`,
    'x-test-helper': 'buildOrgHeaders',
  })),
);

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
}));

setupDomTestEnv();

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('MentionInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
  });

  it('fetches staff mention candidates through shared pharmacist path and org headers', async () => {
    renderWithQueryClient(
      <MentionInput
        value=""
        onChange={() => undefined}
        mentions={[]}
        onMentionsChange={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/pharmacists', {
        headers: { 'x-org-id': 'org-header:org_1', 'x-test-helper': 'buildOrgHeaders' },
      });
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });
});
