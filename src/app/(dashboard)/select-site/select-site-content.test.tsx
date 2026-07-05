// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';

setupDomTestEnv();

const { pushMock, fetchMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { SelectSiteContent } from './select-site-content';
import { toast } from 'sonner';

const SITES = [
  {
    id: 'site_main',
    name: 'PH薬局 本店',
    todays_visit_count: 28,
    has_home_visit: true,
    is_current: true,
  },
  {
    id: 'site_east',
    name: 'PH薬局 東部店',
    todays_visit_count: 14,
    has_home_visit: true,
    is_current: false,
  },
];

function renderPage() {
  return render(<SelectSiteContent />, { wrapper: createQueryClientWrapper() });
}

describe('SelectSiteContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildOrgHeaders).mockImplementation((orgId, extra) => ({
      'x-org-id': orgId,
      ...extra,
    }));
    vi.mocked(buildOrgJsonHeaders).mockImplementation((orgId, extra) => ({
      'Content-Type': 'application/json',
      'x-org-id': orgId,
      ...extra,
    }));
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me/sites') {
        return jsonResponse({ data: SITES });
      }
      return jsonResponse({});
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders site cards with the current badge, visit counts, and home-visit tags', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);

    renderPage();

    const cards = await screen.findAllByTestId('select-site-card');
    expect(cards).toHaveLength(2);
    const summary = screen.getByTestId('select-site-summary');

    expect(within(summary).getByText('選択中')).toBeTruthy();
    expect(within(summary).getByText('本日訪問')).toBeTruthy();
    expect(within(summary).getByText('42件')).toBeTruthy();
    expect(within(summary).getByText('在宅対応あり')).toBeTruthy();
    expect(within(summary).getByText('2薬局')).toBeTruthy();
    expect(within(cards[0]).getByText('PH薬局 本店')).toBeTruthy();
    expect(within(cards[0]).getByText('選択中')).toBeTruthy();
    expect(within(cards[0]).getByText('本日訪問 28件')).toBeTruthy();
    expect(within(cards[0]).getByText('在宅あり')).toBeTruthy();
    expect(within(cards[0]).getByRole('button', { name: 'この薬局で続ける' }).className).toContain(
      '!min-h-11',
    );
    expect(within(cards[1]).queryByText('選択中')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/me/sites', { headers: sentinelHeaders });
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
  });

  it('switches the site then navigates to the dashboard', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgJsonHeaders' };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinelHeaders);

    renderPage();
    const cards = await screen.findAllByTestId('select-site-card');

    fireEvent.click(within(cards[1]).getByRole('button', { name: 'この薬局を使う' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/me/site',
        expect.objectContaining({
          method: 'PUT',
          headers: sentinelHeaders,
          body: JSON.stringify({ site_id: 'site_east' }),
        }),
      );
    });
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('surfaces API error messages when site switching fails', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgJsonHeaders' };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinelHeaders);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/me/sites') {
        return jsonResponse({ data: SITES });
      }
      if (url === '/api/me/site' && init?.method === 'PUT') {
        return jsonResponse({ message: 'この薬局を選択する権限がありません' }, 403);
      }
      return jsonResponse({});
    });

    renderPage();
    const cards = await screen.findAllByTestId('select-site-card');
    fireEvent.click(within(cards[1]).getByRole('button', { name: 'この薬局を使う' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('この薬局を選択する権限がありません');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/site',
      expect.objectContaining({
        method: 'PUT',
        headers: sentinelHeaders,
        body: JSON.stringify({ site_id: 'site_east' }),
      }),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
