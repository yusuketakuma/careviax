// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MemberRole } from '@prisma/client';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  PHARMACY_SITES_API_PATH,
  buildPharmacySiteApiPath,
  buildPharmacySiteInsuranceConfigApiPath,
  buildPharmacySiteInsuranceConfigsApiPath,
} from '@/lib/pharmacy-sites/api-paths';
import { PharmacySitesContent } from './pharmacy-sites-content';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

type MockAuthState = {
  currentUser: { role: MemberRole | null };
};

const useAuthStoreMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/stores/auth-store', () => ({
  useAuthStore: useAuthStoreMock,
}));

/** 既定は admin(編集/保険設定ボタンが見えるロール)。非管理者テストは個別に上書きする。 */
function mockViewerRole(role: MemberRole | null = 'admin') {
  useAuthStoreMock.mockImplementation((selector: (state: MockAuthState) => unknown) =>
    selector({ currentUser: { role } }),
  );
}

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// org-header builders are mocked with SENTINEL returns ('x-test-helper') so the tests
// prove the page DELEGATES to them (a raw inline literal lacks the sentinel, so a
// deep-equal on the sentinel object fails for un-converged code). '@/lib/http/path-segment'
// is intentionally NOT mocked — the real encodePathSegment is exercised for the
// shared pharmacy-site path helpers' per-segment hostile-encode and dot fail-fast teeth.
const buildOrgHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({ 'x-org-id': orgId, 'x-test-helper': 'orgHeaders' })),
);
const buildOrgJsonHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({
    'Content-Type': 'application/json',
    'x-org-id': orgId,
    'x-test-helper': 'orgJsonHeaders',
  })),
);
vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
}));

vi.mock('@/lib/pharmacy-sites/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/pharmacy-sites/api-paths')>();
  return {
    ...actual,
    buildPharmacySiteApiPath: vi.fn(actual.buildPharmacySiteApiPath),
    buildPharmacySiteInsuranceConfigsApiPath: vi.fn(
      actual.buildPharmacySiteInsuranceConfigsApiPath,
    ),
    buildPharmacySiteInsuranceConfigApiPath: vi.fn(actual.buildPharmacySiteInsuranceConfigApiPath),
  };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderContent() {
  return render(<PharmacySitesContent />, { wrapper: createWrapper() });
}

describe('PharmacySitesContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewerRole('admin');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/pharmacy-sites') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'site_1',
                  name: '本店',
                  address: '東京都千代田区1-1',
                  phone: '03-1111-2222',
                  fax: '03-1111-2223',
                  is_health_support_pharmacy: true,
                  is_regional_support: false,
                  is_specialized_pharmacy: false,
                  dispensing_fee_category: null,
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/pharmacy-sites/site_1/insurance-configs') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'config_2024_medical',
                  site_id: 'site_1',
                  insurance_type: 'medical',
                  revision_code: '2024',
                  revision_label: '令和6年度改定',
                  effective_from: '2024-06-01',
                  effective_to: null,
                  config: {},
                },
              ],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('associates visible labels with pharmacy site edit fields', async () => {
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の薬局情報を編集' }));

    expect(screen.getByLabelText('薬局名')).toBeTruthy();
    expect(screen.getByLabelText('住所')).toBeTruthy();
    expect(screen.getByLabelText('電話番号')).toBeTruthy();
    expect(screen.getByLabelText('FAX')).toBeTruthy();
  });

  it('keeps pharmacy site primary actions at the PH-OS 44px target size', async () => {
    renderContent();

    expect(
      (await screen.findByRole('button', { name: '本店の薬局情報を編集' })).className,
    ).toContain('h-11');
    expect(
      (await screen.findByRole('button', { name: '本店の薬局情報を編集' })).className,
    ).toContain('sm:h-11');
    expect(screen.getByRole('button', { name: '本店の保険設定を開く' }).className).toContain(
      'h-11',
    );
    expect(screen.getByRole('button', { name: '本店の保険設定を開く' }).className).toContain(
      'sm:h-11',
    );
  });

  it('associates visible labels with insurance config fields', async () => {
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));
    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を追加' }));

    expect(screen.getByLabelText('保険種別')).toBeTruthy();
    expect(screen.getByLabelText('改定年度')).toBeTruthy();
    expect(screen.getByLabelText('施行日')).toBeTruthy();
    expect(screen.getByLabelText('終了日（空欄=現行）')).toBeTruthy();
  });

  it('names repeated insurance config actions by target', async () => {
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));

    expect(
      await screen.findByRole('button', { name: '医療保険 2024から2026設定を作成' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '医療保険 2024の保険設定を編集' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '医療保険 2024の保険設定を削除' }));

    expect(screen.getByText(/医療保険 2024の保険設定を削除します/)).toBeTruthy();
  });

  it('keeps insurance config sheet actions at the PH-OS 44px target size', async () => {
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));

    for (const name of [
      '本店の保険設定を追加',
      '医療保険 2024から2026設定を作成',
      '医療保険 2024の保険設定を編集',
      '医療保険 2024の保険設定を削除',
    ]) {
      const button = await screen.findByRole('button', { name });
      expect(button.className).toContain('h-11');
      expect(button.className).toContain('sm:h-11');
    }
  });

  it('blocks insurance config ranges that end before the effective date', async () => {
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));
    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を追加' }));

    const effectiveFrom = screen.getByLabelText('施行日') as HTMLInputElement;
    const effectiveTo = screen.getByLabelText('終了日（空欄=現行）') as HTMLInputElement;
    const submit = screen.getByRole('button', { name: '登録する' }) as HTMLButtonElement;

    fireEvent.change(effectiveFrom, { target: { value: '2026-06-01' } });
    fireEvent.change(effectiveTo, { target: { value: '2026-06-01' } });

    expect(effectiveFrom.max).toBe('2026-05-31');
    expect(effectiveTo.min).toBe('2026-06-02');
    expect(effectiveTo.getAttribute('aria-invalid')).toBe('true');
    expect(effectiveTo.getAttribute('aria-describedby')).toContain(
      'insurance-config-effective-to-error',
    );
    expect(screen.getAllByText('終了日は施行日より後の日付を指定してください。')).toHaveLength(2);
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('aria-describedby')).toBe('insurance-config-save-blocker');

    fireEvent.click(submit);
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/pharmacy-sites/site_1/insurance-configs',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // A fetch stub that serves one site (id=siteId, name keeps 本店 so the action button
  // names are stable) and one insurance config (id=configId), and 200s every mutation.
  function stubFetch(siteId: string, configId: string) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-sites' && !init?.method) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: siteId,
                name: '本店',
                address: '東京都千代田区1-1',
                phone: '03-1111-2222',
                fax: '03-1111-2223',
                is_health_support_pharmacy: false,
                is_regional_support: false,
                is_specialized_pharmacy: false,
                dispensing_fee_category: null,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/insurance-configs') && !init?.method) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: configId,
                site_id: siteId,
                insurance_type: 'medical',
                revision_code: '2024',
                revision_label: '令和6年度改定',
                effective_from: '2024-06-01',
                effective_to: null,
                config: {},
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('both GET queries delegate to buildOrgHeaders and the configs GET encodes the site id segment', async () => {
    const fetchMock = stubFetch('a/b c', 'cfg_1');
    renderContent();

    // sites GET
    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));
    await screen.findByRole('button', { name: '医療保険 2024の保険設定を削除' });

    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
    expect(fetchMock).toHaveBeenCalledWith(PHARMACY_SITES_API_PATH, {
      headers: buildOrgHeaders('org_1'),
    });
    // configs GET delegates to the shared helper, which encodes the hostile site id segment.
    expect(fetchMock).toHaveBeenCalledWith('/api/pharmacy-sites/a%2Fb%20c/insurance-configs', {
      headers: buildOrgHeaders('org_1'),
    });
    expect(buildPharmacySiteInsuranceConfigsApiPath).toHaveBeenCalledWith('a/b c');
  });

  it('save site (PATCH) encodes a hostile site id via the shared path helper and uses buildOrgJsonHeaders', async () => {
    const fetchMock = stubFetch('a/b c', 'cfg_1');
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の薬局情報を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '更新する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pharmacy-sites/a%2Fb%20c',
        expect.objectContaining({ method: 'PATCH', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    expect(buildPharmacySiteApiPath).toHaveBeenCalledWith('a/b c');
  });

  it('create insurance config (POST) encodes the site id segment via the shared path helper and uses buildOrgJsonHeaders', async () => {
    const fetchMock = stubFetch('a/b c', 'cfg_1');
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));
    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を追加' }));
    fireEvent.change(screen.getByLabelText('施行日'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pharmacy-sites/a%2Fb%20c/insurance-configs',
        expect.objectContaining({ method: 'POST', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    expect(buildPharmacySiteInsuranceConfigsApiPath).toHaveBeenCalledWith('a/b c');
  });

  it('update insurance config (PATCH) encodes BOTH the site id and config id segments via the shared path helper', async () => {
    const fetchMock = stubFetch('a/b c', 'x/y z');
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));
    fireEvent.click(await screen.findByRole('button', { name: '医療保険 2024の保険設定を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '更新する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pharmacy-sites/a%2Fb%20c/insurance-configs/x%2Fy%20z',
        expect.objectContaining({ method: 'PATCH', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    expect(buildPharmacySiteInsuranceConfigApiPath).toHaveBeenCalledWith('a/b c', 'x/y z');
  });

  it('delete insurance config (DELETE) encodes BOTH segments via the shared path helper and uses buildOrgHeaders', async () => {
    const fetchMock = stubFetch('a/b c', 'x/y z');
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));
    fireEvent.click(await screen.findByRole('button', { name: '医療保険 2024の保険設定を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/pharmacy-sites/a%2Fb%20c/insurance-configs/x%2Fy%20z',
        expect.objectContaining({ method: 'DELETE', headers: buildOrgHeaders('org_1') }),
      );
    });
    expect(buildPharmacySiteInsuranceConfigApiPath).toHaveBeenCalledWith('a/b c', 'x/y z');
  });

  it('delete insurance config with a dot-segment config id fails closed before any DELETE fetch', async () => {
    const fetchMock = stubFetch('site_1', '.');
    vi.mocked(toast.error).mockClear();
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));
    fireEvent.click(await screen.findByRole('button', { name: '医療保険 2024の保険設定を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('surfaces a sites fetch error instead of collapsing to a false-empty "no pharmacies" state', async () => {
    // 薬局一覧 GET だけ 500。空配列に潰れて「薬局情報がありません」と化けないことを検証する。
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === PHARMACY_SITES_API_PATH) {
        return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderContent();

    expect(await screen.findByText('薬局情報を読み込めませんでした')).toBeTruthy();
    expect(screen.queryByText('薬局情報がありません。')).toBeNull();

    const sitesCallsBefore = fetchMock.mock.calls.filter(
      ([input]) => String(input) === PHARMACY_SITES_API_PATH,
    ).length;
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    await waitFor(() => {
      const sitesCallsAfter = fetchMock.mock.calls.filter(
        ([input]) => String(input) === PHARMACY_SITES_API_PATH,
      ).length;
      expect(sitesCallsAfter).toBeGreaterThan(sitesCallsBefore);
    });
  });

  it('surfaces an insurance-configs fetch error instead of a false-empty "not registered" state', async () => {
    // 薬局一覧 GET は 200、保険設定 GET だけ 500。「未登録」に潰れないことを検証する。
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === PHARMACY_SITES_API_PATH) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'site_1',
                name: '本店',
                address: '東京都千代田区1-1',
                phone: '03-1111-2222',
                fax: '03-1111-2223',
                is_health_support_pharmacy: false,
                is_regional_support: false,
                is_specialized_pharmacy: false,
                dispensing_fee_category: null,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/insurance-configs')) {
        return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));

    expect(await screen.findByText('保険設定を読み込めませんでした')).toBeTruthy();
    expect(screen.queryByText('保険設定はまだ登録されていません。')).toBeNull();
  });

  it('create insurance config with a dot-segment SITE id fails closed before any POST fetch', async () => {
    // first-segment (siteId) dot guard: a dot site id must fail closed before the
    // mutating POST, not just the second (configId) segment.
    const fetchMock = stubFetch('.', 'cfg_1');
    vi.mocked(toast.error).mockClear();
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));
    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を追加' }));
    fireEvent.change(screen.getByLabelText('施行日'), { target: { value: '2026-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    // buildPharmacySiteInsuranceConfigsApiPath(configSiteId='.') throws inside the mutationFn before fetch.
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(buildPharmacySiteInsuranceConfigsApiPath).toHaveBeenCalledWith('.');
    const postCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(0);
  });

  describe('role-gated actions (canAdmin)', () => {
    it('hides 編集/保険設定 for a non-admin role that would always get 403 from the API', async () => {
      mockViewerRole('pharmacist');
      renderContent();

      await screen.findByText('本店');
      expect(screen.queryByRole('button', { name: '本店の薬局情報を編集' })).toBeNull();
      expect(screen.queryByRole('button', { name: '本店の保険設定を開く' })).toBeNull();
    });

    it('hides admin actions for clerk too', async () => {
      mockViewerRole('clerk');
      renderContent();

      await screen.findByText('本店');
      expect(screen.queryByRole('button', { name: '本店の薬局情報を編集' })).toBeNull();
      expect(screen.queryByRole('button', { name: '本店の保険設定を開く' })).toBeNull();
    });

    it('shows admin actions for owner as well as admin', async () => {
      mockViewerRole('owner');
      renderContent();

      expect(await screen.findByRole('button', { name: '本店の薬局情報を編集' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '本店の保険設定を開く' })).toBeTruthy();
    });

    it('fails closed (hides admin actions) when role is not yet known', async () => {
      mockViewerRole(null);
      renderContent();

      await screen.findByText('本店');
      expect(screen.queryByRole('button', { name: '本店の薬局情報を編集' })).toBeNull();
      expect(screen.queryByRole('button', { name: '本店の保険設定を開く' })).toBeNull();
    });
  });
});
