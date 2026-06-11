// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { MasterHubResponse } from '@/types/master-hub';

setupDomTestEnv();

const useQueryMock = vi.hoisted(() => vi.fn());
const refetchMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

import { MasterHubContent, formatLastUpdatedLabel } from './master-hub-content';

function localIso(month: number, day: number, hours = 0, minutes = 0) {
  return new Date(2026, month - 1, day, hours, minutes).toISOString();
}

function buildFixture(): MasterHubResponse {
  return {
    generated_at: localIso(6, 11, 9, 42),
    masters: [
      {
        key: 'drugs',
        title: '薬剤マスター',
        count: 1248,
        count_unit: '件',
        last_updated_at: localIso(6, 10),
        status: 'healthy',
        status_count: null,
        note: '安全タグ・代替薬・在庫連動の列を含む',
        action_label: '→ 在庫へ',
        action_href: '/admin/drug-stock',
      },
      {
        key: 'professionals',
        title: '医療者マスター',
        count: 86,
        count_unit: '件',
        last_updated_at: localIso(6, 11, 9, 12),
        status: 'checking',
        status_count: 1,
        note: 'やまもと内科の送付先FAXを事務が確認中 — 完了まで同院宛の送付はブロックされます',
        action_label: '→ ハンドオフへ',
        action_href: '/handoff',
      },
      {
        key: 'facilities',
        title: '施設マスター',
        count: 12,
        count_unit: '件',
        last_updated_at: localIso(6, 9),
        status: 'healthy',
        status_count: null,
        note: 'グリーンヒルの鍵・駐車情報は6/9更新 — 訪問パケットに反映済み',
        action_label: '→ 訪問へ',
        action_href: '/visits',
      },
      {
        key: 'staff',
        title: 'スタッフ・権限',
        count: 8,
        count_unit: '名',
        last_updated_at: localIso(6, 11),
        status: 'healthy',
        status_count: null,
        note: '本日の休みはスケジュールに反映済み。権限はロール×モードのマトリクス管理',
        action_label: '→ スケジュールへ',
        action_href: '/schedules',
      },
      {
        key: 'vehicles',
        title: '車両マスター',
        count: 3,
        count_unit: '台',
        last_updated_at: localIso(6, 2),
        status: 'due_soon',
        status_count: null,
        note: '軽バン2号の点検期限 6/20(あと9日) — 期限切れで配車候補から自動除外されます',
        action_label: '点検を予約',
        action_href: '/schedules',
      },
    ],
    change_log_month_count: 18,
    rail: {
      next_action: {
        label: '麻薬監査を開始 — 12:00期限',
        description: '14:00訪問(田中様)の持参薬です。完了で午後の予定がすべて確定します。',
        href: '/auditing',
      },
      blocked_reasons: [
        {
          id: 'exception_1',
          label: 'ご家族の同意待ち(新規契約)',
          severity: 'critical',
          category: '患者',
          age_minutes: 25 * 60,
          action_label: '再連絡する →',
          action_href: '/communications/requests',
        },
        {
          id: 'exception_2',
          label: '送付先の確認(やまもと内科)',
          severity: 'warning',
          category: '事務',
          age_minutes: 30,
          action_label: '状況を見る →',
          action_href: '/admin/contact-profiles',
        },
      ],
    },
  };
}

describe('MasterHubContent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 11, 9, 42));
    refetchMock.mockClear();
    useQueryMock.mockReturnValue({
      data: buildFixture(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the header row with the freshness subtitle and cross-master search link', () => {
    render(<MasterHubContent />);

    expect(screen.getByRole('heading', { name: 'マスター' })).toBeTruthy();
    expect(screen.getByText('· 5マスター — 鮮度がすべて')).toBeTruthy();

    const searchLink = screen.getByRole('link', { name: 'マスター横断検索' });
    expect(searchLink.getAttribute('href')).toBe('/admin/data-explorer');
  });

  it('renders the 5 master cards with freshness badges, meta, narrative, and outline actions', () => {
    render(<MasterHubContent />);

    const cards = screen.getAllByTestId('master-hub-card');
    expect(cards).toHaveLength(5);

    // 薬剤マスター(健全)
    expect(within(cards[0]).getByText('薬剤マスター')).toBeTruthy();
    expect(within(cards[0]).getByText('健全')).toBeTruthy();
    expect(within(cards[0]).getByText('1,248件')).toBeTruthy();
    expect(within(cards[0]).getByText(/最終更新 6\/10/)).toBeTruthy();
    expect(within(cards[0]).getByRole('link', { name: '→ 在庫へ' })).toBeTruthy();

    // 医療者マスター(確認中 1 + ブロック文言を隠さない)
    expect(within(cards[1]).getByText('確認中 1')).toBeTruthy();
    expect(within(cards[1]).getByText(/最終更新 6\/11 09:12/)).toBeTruthy();
    expect(
      within(cards[1]).getByText(
        'やまもと内科の送付先FAXを事務が確認中 — 完了まで同院宛の送付はブロックされます',
      ),
    ).toBeTruthy();
    expect(within(cards[1]).getByRole('link', { name: '→ ハンドオフへ' })).toBeTruthy();

    // 車両マスター(期限接近)
    expect(within(cards[4]).getByText('期限接近')).toBeTruthy();
    expect(
      within(cards[4]).getByText(
        '軽バン2号の点検期限 6/20(あと9日) — 期限切れで配車候補から自動除外されます',
      ),
    ).toBeTruthy();
    expect(within(cards[4]).getByRole('link', { name: '点検を予約' })).toBeTruthy();

    expect(screen.getByTestId('master-hub-freshness-note').textContent).toContain(
      'マスターは鮮度の画面',
    );
  });

  it('renders the action rail with a single primary action and 根拠・記録 rows', () => {
    render(<MasterHubContent />);

    const nextAction = screen.getByTestId('next-action-panel');
    expect(
      within(nextAction).getByRole('link', { name: '麻薬監査を開始 — 12:00期限' }),
    ).toBeTruthy();
    expect(
      within(nextAction).getByText(
        '14:00訪問(田中様)の持参薬です。完了で午後の予定がすべて確定します。',
      ),
    ).toBeTruthy();

    const blocked = screen.getByTestId('blocked-reasons-panel');
    expect(within(blocked).getByText('患者')).toBeTruthy();
    expect(within(blocked).getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(within(blocked).getByText('1日')).toBeTruthy();
    expect(within(blocked).getByText('事務')).toBeTruthy();
    expect(within(blocked).getByText('送付先の確認(やまもと内科)')).toBeTruthy();
    expect(within(blocked).getByText('30分')).toBeTruthy();

    const evidence = screen.getByTestId('evidence-panel');
    expect(within(evidence).getByText('変更履歴')).toBeTruthy();
    expect(within(evidence).getByText('今月18件')).toBeTruthy();
    expect(within(evidence).getByText('鮮度ルール')).toBeTruthy();
    expect(within(evidence).getByText('90日で再確認')).toBeTruthy();
  });

  it('shows the error state with retry when the fetch fails', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: refetchMock,
    });

    render(<MasterHubContent />);

    expect(screen.getByText('マスターを表示できません')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchMock).toHaveBeenCalled();
  });
});

describe('formatLastUpdatedLabel', () => {
  it('shows time for same-day updates and date otherwise', () => {
    const now = new Date(2026, 5, 11, 10, 0);
    expect(formatLastUpdatedLabel(new Date(2026, 5, 11, 9, 12).toISOString(), now)).toBe(
      '6/11 09:12',
    );
    expect(formatLastUpdatedLabel(new Date(2026, 5, 10, 18, 0).toISOString(), now)).toBe('6/10');
    expect(formatLastUpdatedLabel(null, now)).toBe('—');
  });
});
