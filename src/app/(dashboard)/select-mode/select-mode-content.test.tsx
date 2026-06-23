// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { setupDomTestEnv } from '@/test/dom-test-utils';

setupDomTestEnv();

const { pushMock, setWorkModeMock, fetchMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  setWorkModeMock: vi.fn(),
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
  return { ...actual, buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders) };
});

vi.mock('@/lib/stores/ui-store', () => ({
  useUIStore: (selector: (state: { setWorkMode: typeof setWorkModeMock }) => unknown) =>
    selector({ setWorkMode: setWorkModeMock }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SelectModeContent, WORK_MODE_OPTIONS } from './select-mode-content';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SelectModeContent />
    </QueryClientProvider>,
  );
}

describe('SelectModeContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildOrgJsonHeaders).mockImplementation((orgId, extra) => ({
      'Content-Type': 'application/json',
      'x-org-id': orgId,
      ...extra,
    }));
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the three mode cards from p0_03', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: '今日はどの画面から始めますか?' })).toBeTruthy();
    expect(screen.getByText('薬剤師モード')).toBeTruthy();
    expect(screen.getByText('事務サポートモード')).toBeTruthy();
    expect(screen.getByText('管理モード')).toBeTruthy();
    expect(screen.getAllByText('よく使う画面だけを先に表示します')).toHaveLength(3);
  });

  it('persists clerk mode then lands on the clerk support dashboard', async () => {
    const sentinelHeaders = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinelHeaders);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '事務として入る' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/me/preferences',
        expect.objectContaining({
          method: 'PATCH',
          headers: sentinelHeaders,
          body: JSON.stringify({ work_mode: 'clerk_support' }),
        }),
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect((init as RequestInit | undefined)?.headers).toBe(sentinelHeaders);
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    await waitFor(() => {
      expect(setWorkModeMock).toHaveBeenCalledWith('clerk_support');
      expect(pushMock).toHaveBeenCalledWith('/clerk-support');
    });
  });

  it('keeps the option table aligned with the work-mode enum', () => {
    expect(WORK_MODE_OPTIONS.map((option) => option.mode)).toEqual([
      'pharmacist',
      'clerk_support',
      'management',
    ]);
    expect(WORK_MODE_OPTIONS.map((option) => option.landingHref)).toEqual([
      '/dashboard',
      '/clerk-support',
      '/admin',
    ]);
  });
});
