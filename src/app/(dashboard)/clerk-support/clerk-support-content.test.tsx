// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { ClerkSupportResponse } from '@/types/clerk-support';

setupDomTestEnv();

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

import { ClerkSupportContent } from './clerk-support-content';

function buildFixture(): ClerkSupportResponse {
  return {
    generated_at: '2026-06-12T09:00:00.000Z',
    kpis: {
      intake_pending: 12,
      delivery_target_missing: 8,
      schedule_confirmation: 6,
      document_drafts: 11,
      reply_pending: 7,
      pharmacist_review: 5,
    },
    tasks: [
      {
        id: 'intake-1',
        kind_label: '処方受付',
        patient_name: '田中 一郎',
        next_action: '取込内容を確認して入力へ送る',
        due_label: null,
        href: '/prescriptions/intake',
      },
      {
        id: 'proposal-1',
        kind_label: '日程確認',
        patient_name: '鈴木 修',
        next_action: '候補日時を電話で確認',
        due_label: '2026-06-13',
        href: '/schedules/proposals?detail=proposal-1',
      },
    ],
    consult_items: ['処方内容の判断', '薬の変更理由', '服薬指導の内容', '算定できるかの判断'],
  };
}

describe('ClerkSupportContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildOrgHeaders).mockImplementation((orgId, extra) => ({
      'x-org-id': orgId,
      ...extra,
    }));
    useQueryMock.mockReturnValue({
      data: buildFixture(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading, six KPI tiles, tasks, and consult boundary list', () => {
    render(<ClerkSupportContent />);

    expect(screen.getByRole('heading', { name: '事務でできること' })).toBeTruthy();
    expect(screen.getByText('薬剤師の判断が必要なものは、迷わず相談へ回します。')).toBeTruthy();

    const grid = screen.getByTestId('clerk-kpi-grid');
    for (const label of [
      '処方受付',
      '送付先未設定',
      '日程確認',
      '文書記録',
      '返信待ち',
      '薬剤師確認',
    ]) {
      expect(within(grid).getByText(label)).toBeTruthy();
    }
    expect(within(grid).getByText('12')).toBeTruthy();
    expect(within(grid).getByText('8')).toBeTruthy();

    // DataTable はデスクトップ表とモバイルカードを同時描画するため、各タスク値は 2 回現れる。
    // 表示情報(内容 / 患者さん / 次にやること / 期限)の和集合が両ビューで保たれることを確認する。
    const taskSection = screen.getByTestId('clerk-task-section');
    expect(within(taskSection).getAllByText('田中 一郎')).toHaveLength(2);
    expect(within(taskSection).getAllByText('鈴木 修')).toHaveLength(2);
    expect(within(taskSection).getAllByText('日程確認')).toHaveLength(2);

    const nextActionLinks = within(taskSection).getAllByRole('link', {
      name: '候補日時を電話で確認',
    });
    expect(nextActionLinks).toHaveLength(2);
    for (const link of nextActionLinks) {
      expect(link.getAttribute('href')).toBe('/schedules/proposals?detail=proposal-1');
      // coarse 端末の 44px タッチターゲットを両ビューで確保。
      expect(link.className).toContain('min-h-11');
    }

    expect(within(taskSection).getAllByText('2026-06-13')).toHaveLength(2);
    // 期限なしタスク(intake-1)はダッシュで欠落を明示(desktop 表 + mobile カードで 2 回)。
    expect(within(taskSection).getAllByText('—')).toHaveLength(2);

    const consult = screen.getByTestId('clerk-consult-card');
    expect(within(consult).getByText('薬剤師に相談が必要')).toBeTruthy();
    expect(within(consult).getByText(/算定できるかの判断/)).toBeTruthy();
    // 気づき→起票導線: ハンドオフの相談起票へ繋ぐ CTA
    const handoffLink = within(consult).getByTestId('clerk-consult-handoff-link');
    expect(handoffLink.getAttribute('href')).toBe('/handoff');
  });

  it('does not paint state/ad-hoc colors on KPI counts and dims zero counts', () => {
    useQueryMock.mockReturnValue({
      data: {
        ...buildFixture(),
        kpis: {
          intake_pending: 0,
          delivery_target_missing: 8,
          schedule_confirmation: 6,
          document_drafts: 11,
          reply_pending: 7,
          pharmacist_review: 5,
        },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ClerkSupportContent />);
    const grid = screen.getByTestId('clerk-kpi-grid');

    // ゼロ件は明度コントラストで弱調、非ゼロ件は foreground 強調（色シグナルなし）。
    expect(within(grid).getByText('0').className).toContain('text-muted-foreground');
    const nonZero = within(grid).getByText('8');
    expect(nonZero.className).toContain('text-foreground');

    // 件数に ad-hoc 状態色を塗らない（赤=危険等の偽シグナル回避）。
    expect(grid.innerHTML).not.toMatch(/text-(red|amber|blue|emerald|violet|sky)-\d/);
    // 要対応 KPI に状態色の点/左罫を入れない判断(偽シグナル回避)の回帰防止。
    expect(grid.innerHTML).not.toMatch(/(border-l-state|bg-state|text-state)/);
  });

  it('shows the empty-task message when no clerk work is pending', () => {
    useQueryMock.mockReturnValue({
      data: { ...buildFixture(), tasks: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ClerkSupportContent />);
    // DataTable の空表示はデスクトップ表・モバイルカードの両方に出る(CSS hidden は jsdom 上は可視)。
    const taskSection = screen.getByTestId('clerk-task-section');
    expect(
      within(taskSection).getAllByText('いま事務側で止まっている作業はありません。'),
    ).toHaveLength(2);
  });

  it('fetches the clerk-support dashboard with shared org headers and raw query key', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: buildFixture() }),
    });
    vi.stubGlobal('fetch', fetchMock);

    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return {
          data: buildFixture(),
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      },
    );

    try {
      render(<ClerkSupportContent />);

      if (!captured) throw new Error('query config was not captured');
      expect(captured.queryKey).toEqual(['clerk-support', 'org_1']);
      await captured.queryFn();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/dashboard/clerk-support');
      expect(init.headers).toBe(sentinelHeaders);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
