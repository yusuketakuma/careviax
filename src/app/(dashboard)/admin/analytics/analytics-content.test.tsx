// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { AnalyticsContent } from './analytics-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

setupDomTestEnv();

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
  return render(<AnalyticsContent />, { wrapper: createWrapper() });
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithClient(queryClient: QueryClient) {
  return render(<AnalyticsContent />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
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

  it('shows a billing error state while the resource map still renders independently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/billing-evidence/analytics') {
          return new Response('error', { status: 500 });
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
          return new Response('error', { status: 500 });
        }
        return new Response('{}', { status: 404 });
      }),
    );

    renderContent();

    expect(await screen.findByText('地域資源マップを取得できませんでした')).toBeTruthy();
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
  });
});
