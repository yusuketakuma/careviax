// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { useUIStore } from '@/lib/stores/ui-store';
import type { MasterHubResponse } from '@/types/master-hub';

setupDomTestEnv();

const useQueryMock = vi.hoisted(() => vi.fn());
const refetchMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn(() => 'org_1'));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
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
        title: '医薬品マスター',
        count: 1248,
        count_unit: '件',
        last_updated_at: localIso(6, 10),
        status: 'healthy',
        status_count: null,
        note: '安全タグ・代替薬・在庫連動の列を含む',
        issue_count: 0,
        next_action_hint: '採用品と安全タグを確認する',
        action_label: '→ 医薬品へ',
        action_href: '/admin/drug-masters',
      },
      {
        key: 'institutions',
        title: '医療機関マスター',
        count: 42,
        count_unit: '件',
        last_updated_at: localIso(6, 11, 9, 12),
        status: 'checking',
        status_count: 1,
        note: 'やまもと内科の送付先FAXを事務が確認中 — 完了まで同院宛の送付はブロックされます',
        issue_count: 1,
        next_action_hint: 'やまもと内科の送付先FAXを確認する',
        action_label: '→ 医療機関へ',
        action_href: '/admin/institutions',
      },
      {
        key: 'professionals',
        title: '他職種マスター',
        count: 44,
        count_unit: '件',
        last_updated_at: localIso(6, 10, 15, 0),
        status: 'healthy',
        status_count: null,
        note: 'ケアマネ、訪問看護、施設職員など患者支援に関わる連携先を管理します',
        issue_count: 0,
        next_action_hint: '職種・所属・送付チャネルを点検する',
        action_label: '→ 他職種へ',
        action_href: '/admin/external-professionals',
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
        issue_count: 0,
        next_action_hint: '最新施設の訪問条件を確認する',
        action_label: '→ 施設へ',
        action_href: '/admin/facilities',
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
        issue_count: 0,
        next_action_hint: '本日のシフトと権限を確認する',
        action_label: '→ スタッフへ',
        action_href: '/admin/staff',
      },
      {
        key: 'equipment',
        title: '備品マスター',
        count: 4,
        count_unit: '台',
        last_updated_at: localIso(6, 8),
        status: 'healthy',
        status_count: null,
        note: 'PCAポンプなど貸出機器の資産番号、状態、保守期限を管理します',
        issue_count: 0,
        next_action_hint: '貸出機器と保守期限を点検する',
        action_label: '→ 備品へ',
        action_href: '/admin/pca-pumps',
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
        issue_count: 1,
        next_action_hint: '軽バン2号の点検を予約する',
        action_label: '点検を予約',
        action_href: '/admin/vehicles',
      },
      {
        key: 'pharmacy_sites',
        title: '薬局拠点マスター',
        count: 2,
        count_unit: '拠点',
        last_updated_at: localIso(6, 8),
        status: 'healthy',
        status_count: null,
        note: '本店と訪問エリア 3件を管理しています',
        issue_count: 0,
        next_action_hint: '拠点情報と訪問範囲を点検する',
        action_label: '→ 薬局拠点へ',
        action_href: '/admin/pharmacy-sites',
      },
      {
        key: 'operating_hours',
        title: '稼働日設定',
        count: 2,
        count_unit: '拠点',
        last_updated_at: localIso(6, 8),
        status: 'healthy',
        status_count: null,
        note: '週次営業時間・定休・休日カレンダーを訪問可能日の判定に反映します',
        issue_count: 0,
        next_action_hint: '拠点ごとの営業時間と稼働日を確認する',
        action_label: '→ 稼働日設定へ',
        action_href: '/admin/operating-hours',
      },
      {
        key: 'dispensing',
        title: '配薬・帳票マスター',
        count: 7,
        count_unit: '件',
        last_updated_at: localIso(6, 9),
        status: 'healthy',
        status_count: null,
        note: '配薬方法 3件 / 帳票テンプレート 4件を管理しています',
        issue_count: 0,
        next_action_hint: '配薬方法と帳票テンプレートを点検する',
        action_label: '→ 帳票へ',
        action_href: '/admin/document-templates',
      },
      {
        key: 'billing',
        title: '請求ルールマスター',
        count: 18,
        count_unit: '件',
        last_updated_at: localIso(6, 7),
        status: 'healthy',
        status_count: null,
        note: '在宅算定、加算、減算、保険別の根拠ルールを管理します',
        issue_count: 0,
        next_action_hint: '改定年度と有効ルールを点検する',
        action_label: '→ 請求ルールへ',
        action_href: '/admin/billing-rules',
      },
    ],
    change_log_month_count: 18,
    rail: {
      next_action: {
        label: '麻薬監査を開始 — 12:00期限',
        description: '14:00訪問(田中様)の持参薬です。完了で午後の予定がすべて確定します。',
        href: '/audit',
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
    useUIStore.setState({ workspaceRailOpen: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 11, 9, 42));
    refetchMock.mockClear();
    useOrgIdMock.mockReturnValue('org_1');
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders the header row with the freshness subtitle and cross-master search link', () => {
    render(<MasterHubContent />);

    expect(screen.getByRole('heading', { name: 'マスター' })).toBeTruthy();
    expect(screen.getByText('· 11マスター — 鮮度がすべて')).toBeTruthy();

    const searchLink = screen.getByRole('link', { name: 'マスター横断検索' });
    expect(searchLink.getAttribute('href')).toBe('/admin/data-explorer');
  });

  it('renders each master card title as a level-2 heading under the page h1 (no skipped level)', () => {
    render(<MasterHubContent />);

    // ページ見出しは h1「マスター」。
    expect(screen.getByRole('heading', { level: 1, name: 'マスター' })).toBeTruthy();

    // カードタイトルは h2（h1 直下で h2 を飛ばして h3 にしない）。
    const cards = screen.getAllByTestId('master-hub-card');
    const cardHeading = within(cards[0]).getByRole('heading', { level: 2 });
    expect(cardHeading.textContent).toBe('医薬品マスター');
    // teeth: カード内に h3 見出しは存在しない（h2 へ昇格済み）。
    expect(within(cards[0]).queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('starts the master hub query even before the org store is hydrated', () => {
    useOrgIdMock.mockReturnValue('');

    render(<MasterHubContent />);

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin', 'master-hub', 'session-org'],
      }),
    );
  });

  it('fetches the master hub through the static API path and unwraps the data envelope', async () => {
    const fixture = buildFixture();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: fixture }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<MasterHubContent />);

    const queryOptions = useQueryMock.mock.calls.at(-1)?.[0] as
      | { queryKey: unknown[]; queryFn: () => Promise<MasterHubResponse> }
      | undefined;
    expect(queryOptions?.queryKey).toEqual(['admin', 'master-hub', 'org_1']);
    await expect(queryOptions?.queryFn()).resolves.toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/master-hub');
  });

  it('renders master cards with freshness badges, meta, narrative, and outline actions', () => {
    render(<MasterHubContent />);

    const cards = screen.getAllByTestId('master-hub-card');
    expect(cards).toHaveLength(11);

    // 医薬品マスター(健全)
    expect(within(cards[0]).getByText('医薬品マスター')).toBeTruthy();
    expect(within(cards[0]).getByText('健全')).toBeTruthy();
    expect(within(cards[0]).getByText('1,248件').className).toContain('tabular-nums');
    expect(within(cards[0]).getByText(/最終更新 6\/10/)).toBeTruthy();
    expect(within(cards[0]).getByText('採用品と安全タグを確認する')).toBeTruthy();
    expect(within(cards[0]).getByText('未処理なし')).toBeTruthy();
    expect(within(cards[0]).getByRole('link', { name: '→ 医薬品へ' }).getAttribute('href')).toBe(
      '/admin/drug-masters',
    );

    // 医療機関マスター(確認中 1 + ブロック文言を隠さない)
    expect(within(cards[1]).getByText('確認中 1')).toBeTruthy();
    expect(within(cards[1]).getByText(/最終更新 6\/11 09:12/)).toBeTruthy();
    expect(
      within(cards[1]).getByText(
        'やまもと内科の送付先FAXを事務が確認中 — 完了まで同院宛の送付はブロックされます',
      ),
    ).toBeTruthy();
    expect(within(cards[1]).getByText('やまもと内科の送付先FAXを確認する')).toBeTruthy();
    expect(within(cards[1]).getByText('未処理 1件')).toBeTruthy();
    expect(within(cards[1]).getByRole('link', { name: '→ 医療機関へ' })).toBeTruthy();

    // 他職種・備品・薬局拠点・稼働日設定・配薬帳票・請求ルールをハブに含める
    expect(within(cards[2]).getByText('他職種マスター')).toBeTruthy();
    expect(within(cards[3]).getByRole('link', { name: '→ 施設へ' }).getAttribute('href')).toBe(
      '/admin/facilities',
    );
    expect(within(cards[4]).getByRole('link', { name: '→ スタッフへ' }).getAttribute('href')).toBe(
      '/admin/staff',
    );
    expect(within(cards[5]).getByText('備品マスター')).toBeTruthy();
    expect(within(cards[7]).getByText('薬局拠点マスター')).toBeTruthy();
    expect(within(cards[8]).getByText('稼働日設定')).toBeTruthy();
    expect(within(cards[9]).getByText('配薬・帳票マスター')).toBeTruthy();
    expect(within(cards[10]).getByText('請求ルールマスター')).toBeTruthy();
    expect(within(cards[5]).getByRole('link', { name: '→ 備品へ' }).getAttribute('href')).toBe(
      '/admin/pca-pumps',
    );
    expect(
      within(cards[8]).getByRole('link', { name: '→ 稼働日設定へ' }).getAttribute('href'),
    ).toBe('/admin/operating-hours');

    // 車両マスター(期限接近)
    expect(within(cards[6]).getByText('期限接近')).toBeTruthy();
    expect(
      within(cards[6]).getByText(
        '軽バン2号の点検期限 6/20(あと9日) — 期限切れで配車候補から自動除外されます',
      ),
    ).toBeTruthy();
    expect(within(cards[6]).getByText('軽バン2号の点検を予約する')).toBeTruthy();
    expect(within(cards[6]).getByRole('link', { name: '点検を予約' }).getAttribute('href')).toBe(
      '/admin/vehicles',
    );

    expect(screen.getByTestId('master-hub-freshness-note').textContent).toContain(
      'マスターは鮮度の画面',
    );
  });

  it('shows a decision summary before the master cards', () => {
    render(<MasterHubContent />);

    const summary = screen.getByTestId('master-hub-summary');
    expect(summary.querySelector('.grid')?.className).toContain('grid-cols-3');
    expect(within(summary).getByText('今日の判定')).toBeTruthy();
    expect(within(summary).getByText('確認あり')).toBeTruthy();
    expect(summary.textContent).toContain('2マスターに注意');
    expect(within(summary).getByText('未処理')).toBeTruthy();
    expect(within(summary).getByText('2件').className).toContain('tabular-nums');
    expect(within(summary).getByText('医療機関マスター')).toBeTruthy();
    expect(within(summary).getByText('やまもと内科の送付先FAXを確認する')).toBeTruthy();
  });

  it('renders expired master status as blocked and prioritizes it in the summary', () => {
    const fixture = buildFixture();
    fixture.masters[6] = {
      ...fixture.masters[6],
      status: 'expired',
      note: '軽バン2号の点検期限 6/1 が10日過ぎています — 配車候補から除外して点検を予約してください',
      next_action_hint: '軽バン2号を配車候補から外して点検を予約する',
      issue_count: 1,
    };
    useQueryMock.mockReturnValue({
      data: fixture,
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });

    render(<MasterHubContent />);

    const vehicleCard = screen.getAllByTestId('master-hub-card')[6];
    expect(within(vehicleCard).getByText('期限切れ').closest('[data-role="blocked"]')).toBeTruthy();
    expect(
      within(vehicleCard).getByText(
        '軽バン2号の点検期限 6/1 が10日過ぎています — 配車候補から除外して点検を予約してください',
      ),
    ).toBeTruthy();
    const summary = screen.getByTestId('master-hub-summary');
    expect(within(summary).getByText('車両マスター')).toBeTruthy();
    expect(within(summary).getByText('軽バン2号を配車候補から外して点検を予約する')).toBeTruthy();
  });

  it('keeps card and search actions at the PH-OS 44px target size', () => {
    render(<MasterHubContent />);

    expect(screen.getByRole('link', { name: 'マスター横断検索' }).className).toContain(
      'min-h-[44px]',
    );

    const firstCard = screen.getAllByTestId('master-hub-card')[0];
    expect(within(firstCard).getByRole('link', { name: '→ 医薬品へ' }).className).toContain(
      'min-h-[44px]',
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
