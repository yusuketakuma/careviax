// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { CapacityContent, emergencyCapacityState, staffUtilizationState } from './capacity-content';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

type CapacityPayload = {
  generated_at: string;
  kpis: {
    visit_slots: { completed: number; total: number };
    dispense_set: { completed: number; total: number };
    staff_utilization_percent: number;
    emergency_capacity_count: number;
  };
  process_remaining: Array<{ key: string; label: string; count: number }>;
  staff_load: Array<{ user_id: string; label: string; load_percent: number }>;
  attention_items: string[];
};

const BASE_PAYLOAD: CapacityPayload = {
  generated_at: '2026-06-22T01:00:00.000Z',
  kpis: {
    visit_slots: { completed: 6, total: 10 },
    dispense_set: { completed: 4, total: 8 },
    staff_utilization_percent: 72,
    emergency_capacity_count: 2.5,
  },
  process_remaining: [
    { key: 'visit', label: '訪問', count: 4 },
    { key: 'dispense', label: '調剤', count: 3 },
  ],
  staff_load: [{ user_id: 'u1', label: '田中', load_percent: 80 }],
  attention_items: ['訪問枠の残りがあと少しです'],
};

function stubCapacityFetch(payload: CapacityPayload) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/admin/capacity') {
        return new Response(JSON.stringify({ data: payload }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    }),
  );
}

function renderContent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CapacityContent />
    </QueryClientProvider>,
  );
}

describe('CapacityContent', () => {
  beforeEach(() => {
    stubCapacityFetch(BASE_PAYLOAD);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders 今すぐ見るべきこと above the charts and below the full KPI grid (info order, UI/UX SSOT §2)', async () => {
    renderContent();

    // KPI 群(最後の KPI=緊急余力)→ 今すぐ見るべきこと → 行程ごとの残り / スタッフ別の負荷 の
    // DOM 順序を保証する。先頭 KPI ではなく最後の KPI に anchor し、即時判断 section が
    // KPI グリッド全体より後ろにあること(KPI カードの間に割り込んでいないこと)まで縛る。
    const firstKpi = await screen.findByRole('heading', { name: '訪問枠' });
    const lastKpi = screen.getByRole('heading', { name: '緊急余力' });
    const attention = screen.getByRole('heading', { name: '今すぐ見るべきこと' });
    const processChart = screen.getByRole('heading', { name: '行程ごとの残り' });
    const staffChart = screen.getByRole('heading', { name: 'スタッフ別の負荷' });
    const kpiGrid = screen.getByTestId('capacity-kpis');

    expect(screen.queryByText('最初に見るポイント')).toBeNull();
    expect(kpiGrid.className).toContain('grid-cols-2');
    expect(kpiGrid.className).toContain('xl:grid-cols-4');

    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    // 即時判断 section は KPI グリッド全体(最後の KPI=緊急余力)より後ろ。
    expect(lastKpi.compareDocumentPosition(attention) & FOLLOWING).toBeTruthy();
    // 念のため先頭 KPI より後ろであることも保持。
    expect(firstKpi.compareDocumentPosition(attention) & FOLLOWING).toBeTruthy();
    // 即時判断 section は両チャートより前。
    expect(attention.compareDocumentPosition(processChart) & FOLLOWING).toBeTruthy();
    expect(attention.compareDocumentPosition(staffChart) & FOLLOWING).toBeTruthy();

    // 即時判断 item 本文が描画される。
    expect(screen.getByText('・訪問枠の残りがあと少しです')).toBeTruthy();
  });

  it('keeps the true-empty copy for attention and staff when there is nothing to show', async () => {
    stubCapacityFetch({ ...BASE_PAYLOAD, attention_items: [], staff_load: [] });
    renderContent();

    await waitFor(() =>
      expect(screen.getByText('いま注意が必要な詰まりはありません。')).toBeTruthy(),
    );
    expect(screen.getByText('勤務中のスタッフがいません。')).toBeTruthy();
  });

  it('loading state mirrors the loaded layout: KPI skeletons → attention skeleton → 2 chart skeletons', async () => {
    // never-resolving fetch keeps capacityQuery in the loading state.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderContent();

    const status = await screen.findByRole('status', { name: 'キャパシティ読み込み中' });
    const kpis = within(status).getByTestId('capacity-loading-kpis');
    const attention = within(status).getByTestId('capacity-loading-attention');
    const charts = within(status).getByTestId('capacity-loading-charts');

    // loaded と同じ 4 KPI / 1 即時判断 / 2 チャート の骨格(load 時のジャンプ防止)。
    expect(kpis.childElementCount).toBe(4);
    expect(kpis.className).toContain('grid-cols-2');
    expect(kpis.className).toContain('xl:grid-cols-4');
    expect(attention.childElementCount).toBe(1);
    expect(charts.childElementCount).toBe(2);

    // KPI → 即時判断 → チャート の順序を骨格でも保証する。
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(kpis.compareDocumentPosition(attention) & FOLLOWING).toBeTruthy();
    expect(attention.compareDocumentPosition(charts) & FOLLOWING).toBeTruthy();
  });

  it('classifies staff utilization thresholds (>=85 confirm, >=100 blocked, below neutral)', () => {
    expect(staffUtilizationState(84)).toBeNull();
    expect(staffUtilizationState(85)).toEqual({ role: 'confirm', label: '逼迫' });
    expect(staffUtilizationState(100)).toEqual({ role: 'blocked', label: '過負荷' });
  });

  it('classifies emergency capacity thresholds (<2 confirm, <=0 blocked, otherwise neutral)', () => {
    expect(emergencyCapacityState(2)).toBeNull();
    expect(emergencyCapacityState(1.9)).toEqual({ role: 'confirm', label: '余力僅少' });
    expect(emergencyCapacityState(0)).toEqual({ role: 'blocked', label: '余力なし' });
  });

  it('neutralizes KPI value/bar colors so the number itself does not imply state', async () => {
    renderContent();
    const grid = await screen.findByTestId('capacity-kpis');
    // KPI グリッド内に分類色(chart-*)は残らない。
    expect(grid.querySelectorAll('[class*="text-chart-"]').length).toBe(0);
    expect(grid.querySelectorAll('[class*="bg-chart-"]').length).toBe(0);
    // 進捗バーは単一中立色。
    expect(grid.querySelectorAll('[class*="bg-muted-foreground"]').length).toBeGreaterThan(0);
    // 値テキストは中立 text-foreground。
    expect(screen.getByText('72%').className).toContain('text-foreground');
  });

  it('flags an over-capacity staff utilization with a blocked status dot', async () => {
    stubCapacityFetch({
      ...BASE_PAYLOAD,
      kpis: { ...BASE_PAYLOAD.kpis, staff_utilization_percent: 100 },
    });
    renderContent();

    const dot = await screen.findByText('過負荷');
    expect(dot.closest('[data-role]')?.getAttribute('data-role')).toBe('blocked');
  });

  it('flags a strained staff utilization with a confirm status dot', async () => {
    stubCapacityFetch({
      ...BASE_PAYLOAD,
      kpis: { ...BASE_PAYLOAD.kpis, staff_utilization_percent: 85 },
    });
    renderContent();

    const dot = await screen.findByText('逼迫');
    expect(dot.closest('[data-role]')?.getAttribute('data-role')).toBe('confirm');
  });

  it('flags low emergency capacity with a confirm dot while progress KPIs stay neutral', async () => {
    stubCapacityFetch({
      ...BASE_PAYLOAD,
      kpis: { ...BASE_PAYLOAD.kpis, emergency_capacity_count: 1.5, staff_utilization_percent: 72 },
    });
    renderContent();

    const dot = await screen.findByText('余力僅少');
    expect(dot.closest('[data-role]')?.getAttribute('data-role')).toBe('confirm');
    // 進捗 KPI(訪問枠/調剤・セット)と稼働72%は状態 dot を出さない。
    expect(screen.queryByText('逼迫')).toBeNull();
    expect(screen.queryByText('過負荷')).toBeNull();
  });

  it('keeps every KPI neutral when nothing crosses a threshold', async () => {
    renderContent();
    await screen.findByTestId('capacity-kpis');

    for (const label of ['逼迫', '過負荷', '余力なし', '余力僅少']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('adds unit-bearing hover titles to each process and staff bar', async () => {
    renderContent();

    expect(await screen.findByTitle('訪問: 残り4件')).toBeTruthy();
    expect(screen.getByTitle('調剤: 残り3件')).toBeTruthy();
    expect(screen.getByTitle('田中: 80%')).toBeTruthy();
  });
});
