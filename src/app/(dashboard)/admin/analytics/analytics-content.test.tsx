// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
  });
});
