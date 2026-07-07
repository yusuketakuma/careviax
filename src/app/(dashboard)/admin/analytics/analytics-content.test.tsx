// @vitest-environment jsdom

import type { QueryClient } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { AnalyticsContent } from './analytics-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

setupDomTestEnv();

function renderContent() {
  return render(<AnalyticsContent />, { wrapper: createQueryClientWrapper() });
}

function makeClient() {
  return createTestQueryClient();
}

function renderWithClient(queryClient: QueryClient) {
  return render(<AnalyticsContent />, {
    wrapper: createQueryClientWrapper(queryClient),
  });
}

const BILLING_BODY = {
  data: {
    summary: {
      ssot_rule_count: 4,
      current_month: '2026-06',
      current_month_candidates: 12,
      current_month_review_pending: 3,
      current_month_claimable_rate: 75,
      current_month_close_rate: 50,
      current_month_exported: 6,
    },
    monthly_trend: [
      {
        month: '2026-06',
        total_candidates: 12,
        review_pending: 3,
        confirmed: 8,
        excluded: 1,
        exported: 6,
        claimable_evidence: 9,
        unclaimable_evidence: 3,
      },
    ],
    blocker_reasons: [{ reason: '添付書類未確認', count: 2 }],
    top_codes: [{ billing_code: 'ZAI-001', billing_name: '在宅患者訪問薬剤管理指導料', count: 5 }],
  },
};

const RESOURCE_BODY = {
  summary: {
    total_sites: 1,
    emergency_ready_sites: 1,
    holiday_gap_sites: 0,
    missing_geo_sites: 0,
  },
  data: [
    {
      id: 'site_1',
      name: '基幹薬局',
      address: '東京都千代田区丸の内1-1-1',
      phone: null,
      emergency_capable_shift_count: 2,
      holiday_gap_dates: [],
      supports_narcotic: true,
      supports_sterile: false,
      can_delegate: true,
      has_geo: true,
      capability_tags: ['麻薬対応'],
      action_href: '/workflow',
    },
  ],
};

describe('AnalyticsContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/billing-evidence/analytics') {
          return new Response(
            JSON.stringify({
              data: {
                summary: {
                  ssot_rule_count: 4,
                  current_month: '2026-06',
                  current_month_candidates: 12,
                  current_month_review_pending: 3,
                  current_month_claimable_rate: 75,
                  current_month_close_rate: 50,
                  current_month_exported: 6,
                },
                monthly_trend: [
                  {
                    month: '2026-06',
                    total_candidates: 12,
                    review_pending: 3,
                    confirmed: 8,
                    excluded: 1,
                    exported: 6,
                    claimable_evidence: 9,
                    unclaimable_evidence: 3,
                  },
                ],
                blocker_reasons: [{ reason: '添付書類未確認', count: 2 }],
                top_codes: [
                  { billing_code: 'ZAI-001', billing_name: '在宅患者訪問薬剤管理指導料', count: 5 },
                ],
              },
            }),
            { status: 200 },
          );
        }

        if (url === '/api/pharmacy-sites?view=resource_map') {
          return new Response(
            JSON.stringify({
              summary: {
                total_sites: 1,
                emergency_ready_sites: 1,
                holiday_gap_sites: 0,
                missing_geo_sites: 0,
              },
              data: [
                {
                  id: 'site_1',
                  name: '基幹薬局',
                  address: '東京都千代田区丸の内1-1-1',
                  phone: '03-0000-0000',
                  emergency_capable_shift_count: 2,
                  holiday_gap_dates: [],
                  supports_narcotic: true,
                  supports_sterile: false,
                  can_delegate: true,
                  has_geo: true,
                  capability_tags: ['麻薬対応'],
                  action_href: '/workflow',
                },
              ],
            }),
            { status: 200 },
          );
        }

        return new Response('{}', { status: 404 });
      }),
    );
  });

  it('renders monthly trends with DataTable controls and aggregate-only search', async () => {
    renderContent();

    expect(await screen.findByText('月次推移')).toBeTruthy();
    expect(screen.getByLabelText('月次推移内検索')).toBeTruthy();
    expect(screen.getByRole('button', { name: '列' })).toBeTruthy();
    expect(await screen.findByText('添付書類未確認')).toBeTruthy();
    expect((await screen.findAllByText('2026-06')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('候補').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('算定不可').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByLabelText('患者名で検索')).toBeNull();
    // both concurrent queries succeed -> resource-map section also renders
    expect(await screen.findByText('基幹薬局')).toBeTruthy();
  });

  it('keeps the analytics workbench compact on mobile and preserves 44px page controls', async () => {
    renderContent();

    expect(await screen.findByText('月次推移')).toBeTruthy();

    const kpiGrid = screen.getByTestId('analytics-kpis');
    const workbench = screen.getByTestId('analytics-workbench');
    expect(workbench.className).toContain('[&_input]:!min-h-[44px]');
    expect(kpiGrid.className).toContain('grid-cols-2');
    expect(kpiGrid.className).toContain('xl:grid-cols-4');
    expect(screen.getByRole('link', { name: '緊急時プレイブックを確認' }).className).toContain(
      'min-h-[44px]',
    );
    for (const button of screen.getByTestId('resource-filter-rail').querySelectorAll('button')) {
      expect(button.className).toContain('min-h-[44px]');
    }
  });

  it('fetches analytics and resource-map data with shared org headers and exact query keys', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url === '/api/billing-evidence/analytics') {
        return new Response(JSON.stringify(BILLING_BODY), { status: 200 });
      }
      if (url === '/api/pharmacy-sites?view=resource_map') {
        return new Response(JSON.stringify(RESOURCE_BODY), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = makeClient();

    renderWithClient(queryClient);

    expect(await screen.findByText('月次推移')).toBeTruthy();
    expect(await screen.findByText('基幹薬局')).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/billing-evidence/analytics');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toBe(sentinelHeaders);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/pharmacy-sites?view=resource_map');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toBe(sentinelHeaders);
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenNthCalledWith(1, 'org_1');
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenNthCalledWith(2, 'org_1');
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual(
      expect.arrayContaining([
        ['billing-analytics', 'org_1'],
        ['pharmacy-sites', 'org_1', 'resource-map'],
      ]),
    );
  });

  it('shows a billing error state while the resource map still renders independently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/billing-evidence/analytics') {
          return new Response('患者 山田太郎 storage_key=private/provider_error token=secret', {
            status: 500,
          });
        }
        if (url === '/api/pharmacy-sites?view=resource_map') {
          return new Response(
            JSON.stringify({
              summary: {
                total_sites: 1,
                emergency_ready_sites: 1,
                holiday_gap_sites: 0,
                missing_geo_sites: 0,
              },
              data: [
                {
                  id: 'site_1',
                  name: '基幹薬局',
                  address: '東京都千代田区丸の内1-1-1',
                  phone: null,
                  emergency_capable_shift_count: 2,
                  holiday_gap_dates: [],
                  supports_narcotic: true,
                  supports_sterile: false,
                  can_delegate: true,
                  has_geo: true,
                  capability_tags: ['麻薬対応'],
                  action_href: '/workflow',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    renderContent();

    expect(await screen.findByText('請求分析を取得できませんでした')).toBeTruthy();
    const renderedText = document.body.textContent ?? '';
    expect(renderedText).not.toContain('患者 山田太郎');
    expect(renderedText).not.toContain('storage_key');
    expect(renderedText).not.toContain('provider_error');
    expect(renderedText).not.toContain('token=secret');
    // billing section is replaced by the error state -> no fabricated billing figures
    expect(screen.queryByText('今月候補')).toBeNull();
    expect(screen.queryByText('月次推移')).toBeNull();
    // resource-map section is unaffected and still renders
    expect(await screen.findByText('基幹薬局')).toBeTruthy();
  });

  it('shows a resource-map error state while billing analytics still renders independently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/billing-evidence/analytics') {
          return new Response(
            JSON.stringify({
              data: {
                summary: {
                  ssot_rule_count: 4,
                  current_month: '2026-06',
                  current_month_candidates: 12,
                  current_month_review_pending: 3,
                  current_month_claimable_rate: 75,
                  current_month_close_rate: 50,
                  current_month_exported: 6,
                },
                monthly_trend: [
                  {
                    month: '2026-06',
                    total_candidates: 12,
                    review_pending: 3,
                    confirmed: 8,
                    excluded: 1,
                    exported: 6,
                    claimable_evidence: 9,
                    unclaimable_evidence: 3,
                  },
                ],
                blocker_reasons: [{ reason: '添付書類未確認', count: 2 }],
                top_codes: [
                  { billing_code: 'ZAI-001', billing_name: '在宅患者訪問薬剤管理指導料', count: 5 },
                ],
              },
            }),
            { status: 200 },
          );
        }
        if (url === '/api/pharmacy-sites?view=resource_map') {
          return new Response('患者 山田太郎 storage_key=private/provider_error token=secret', {
            status: 500,
          });
        }
        return new Response('{}', { status: 404 });
      }),
    );

    renderContent();

    expect(await screen.findByText('地域資源マップを取得できませんでした')).toBeTruthy();
    const renderedText = document.body.textContent ?? '';
    expect(renderedText).not.toContain('患者 山田太郎');
    expect(renderedText).not.toContain('storage_key');
    expect(renderedText).not.toContain('provider_error');
    expect(renderedText).not.toContain('token=secret');
    // resource section is replaced by the error state -> no false-empty regional copy
    expect(screen.queryByText('拠点数')).toBeNull();
    expect(screen.queryByText('地域資源データはありません。')).toBeNull();
    // billing section is unaffected and still renders (unique blocker-reason text)
    expect(await screen.findByText('添付書類未確認')).toBeTruthy();
  });

  it('keeps billing analytics and shows a non-blocking warning when its refetch fails', async () => {
    let billingCall = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/billing-evidence/analytics') {
          billingCall += 1;
          return billingCall === 1
            ? new Response(JSON.stringify(BILLING_BODY), { status: 200 })
            : new Response('error', { status: 500 });
        }
        if (url === '/api/pharmacy-sites?view=resource_map') {
          return new Response(JSON.stringify(RESOURCE_BODY), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const queryClient = makeClient();
    renderWithClient(queryClient);

    expect(await screen.findByText('添付書類未確認')).toBeTruthy();

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['billing-analytics', 'org_1'] });
    });

    // stale billing data retained (NOT wiped by a blocking error) ...
    expect(screen.getByText('添付書類未確認')).toBeTruthy();
    expect(screen.queryByText('請求分析を取得できませんでした')).toBeNull();
    // ... with a non-blocking refetch warning instead.
    expect(
      await screen.findByText('最新の請求分析を取得できませんでした。表示は前回取得した値です。'),
    ).toBeTruthy();
  });

  it('keeps the resource map and shows a non-blocking warning when its refetch fails', async () => {
    let resourceCall = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/billing-evidence/analytics') {
          return new Response(JSON.stringify(BILLING_BODY), { status: 200 });
        }
        if (url === '/api/pharmacy-sites?view=resource_map') {
          resourceCall += 1;
          return resourceCall === 1
            ? new Response(JSON.stringify(RESOURCE_BODY), { status: 200 })
            : new Response('error', { status: 500 });
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const queryClient = makeClient();
    renderWithClient(queryClient);

    expect(await screen.findByText('基幹薬局')).toBeTruthy();

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['pharmacy-sites', 'org_1', 'resource-map'] });
    });

    expect(screen.getByText('基幹薬局')).toBeTruthy();
    expect(screen.queryByText('地域資源マップを取得できませんでした')).toBeNull();
    expect(
      await screen.findByText(
        '最新の地域資源マップを取得できませんでした。表示は前回取得した値です。',
      ),
    ).toBeTruthy();
  });

  it('does not show false-empty side-list copy while the queries are still loading', () => {
    // never-resolving fetch keeps both queries in the loading state
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    renderContent();

    // during loading the side lists skeletonize — they must NOT assert "...ありません"
    expect(screen.queryByText('算定不可の主因はありません。')).toBeNull();
    expect(screen.queryByText('算定コードの実績はありません。')).toBeNull();
    expect(screen.queryByText('地域別集計はありません。')).toBeNull();
    expect(screen.queryByText('地域資源データはありません。')).toBeNull();
    expect(screen.queryByText('---- -- の請求候補')).toBeNull();
    expect(screen.queryByText('締め済み 0 件')).toBeNull();
    expect(within(screen.getByTestId('analytics-kpis')).queryByText('0%')).toBeNull();
  });

  it('announces loading regions while keeping skeleton shapes decorative', () => {
    // never-resolving fetch keeps both queries in the loading state
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    const { container } = renderContent();

    expect(screen.getByRole('status', { name: '請求分析の指標を読み込み中' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '締め阻害要因を読み込み中' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '主要算定コードを読み込み中' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '地域別サマリーを読み込み中' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '拠点別の対応体制を読み込み中' })).toBeTruthy();

    for (const skeleton of container.querySelectorAll('.animate-pulse')) {
      expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
