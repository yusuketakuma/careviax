// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { useUIStore } from '@/lib/stores/ui-store';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import type {
  VisitPreparationBoardResponse,
  VisitPreparationCard,
} from '@/types/visit-preparation-board';

setupDomTestEnv();

const { useRealtimeQueryMock, refetchMock } = vi.hoisted(() => ({
  useRealtimeQueryMock: vi.fn(),
  refetchMock: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

// Actual-backed spy so the board fetch test can prove org-header helper adoption via return identity.
vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

import { VisitsToday } from './visits-today';

function localIso(hours: number, minutes = 0) {
  return new Date(2026, 5, 12, hours, minutes).toISOString();
}

function buildCards(): VisitPreparationCard[] {
  return [
    {
      schedule_id: 'sch_ito',
      visit_mode_href: '/visits/sch_ito/record',
      time_label: '10:30',
      title: '伊藤 キヨ',
      is_facility: false,
      patient_count: null,
      meta_label: '在宅・滞在45分',
      safety_tags: ['swallowing'],
      prep_done: 4,
      prep_total: 4,
      accent: 'ready',
      checks: [
        { id: 'packet', label: 'パケット', state: 'done' },
        { id: 'route', label: 'ルート', state: 'done' },
        { id: 'set', label: 'セット', state: 'done' },
        { id: 'changes', label: '前回からの変化を確認済', state: 'done' },
      ],
      note: null,
      note_tone: null,
      actions: [
        { label: 'カードへ', href: '/patients/pt_ito' },
        { label: 'ルート詳細', href: '/schedules' },
      ],
    },
    {
      schedule_id: 'sch_tanaka',
      visit_mode_href: '/visits/sch_tanaka/record',
      time_label: '14:00',
      title: '田中 一郎',
      is_facility: false,
      patient_count: null,
      meta_label: '在宅・滞在45分',
      safety_tags: ['narcotic', 'cold_storage', 'infection_isolation', 'procedure:home_oxygen'],
      prep_done: 3,
      prep_total: 4,
      accent: 'caution',
      checks: [
        { id: 'packet', label: 'パケット', state: 'done' },
        { id: 'route', label: 'ルート', state: 'done' },
        { id: 'carry-narcotic', label: '持参薬 — 麻薬監査待ち(期限12:00)', state: 'alert' },
        { id: 'cold-bag', label: '保冷バッグ', state: 'done' },
      ],
      note: '監査が間に合わない場合: 15:00繰り下げ案を反映できます(スケジュールで調整)',
      note_tone: 'warning',
      actions: [
        { label: '監査へ', href: '/audit' },
        { label: 'カードへ', href: '/patients/pt_tanaka' },
      ],
    },
    {
      schedule_id: 'sch_gh',
      visit_mode_href: '/visits/sch_gh/record',
      time_label: '15:30',
      title: '施設グリーンヒル',
      is_facility: true,
      patient_count: 12,
      meta_label: '12名・滞在90分',
      safety_tags: ['narcotic', 'cold_storage', 'allergy', 'procedure:tpn'],
      prep_done: 3,
      prep_total: 4,
      accent: 'progress',
      checks: [
        { id: 'room-order', label: '居室順', state: 'done' },
        { id: 'set', label: 'セット 9/12 — 事務が先行準備中', state: 'progress' },
        { id: 'facility-checklist', label: '施設チェックリスト', state: 'done' },
        { id: 'cart-map', label: '配薬カート対応表', state: 'done' },
      ],
      note: 'セット残り3名分の確認が残っています — 完了後に配薬カートへ積み込めます',
      note_tone: 'info',
      actions: [
        { label: 'セットへ', href: '/set' },
        { label: '施設パケット', href: '/schedules' },
      ],
    },
  ];
}

function buildFixture(): VisitPreparationBoardResponse {
  return {
    generated_at: localIso(9, 42),
    visit_count: 2,
    facility_patient_count: 12,
    cards: buildCards(),
    next_action: {
      patient_name: '田中 一郎',
      due_at: localIso(12, 0),
      has_narcotic: true,
    },
    blocked_reasons: [
      {
        id: 'ex_1',
        label: 'ご家族の同意待ち(新規契約)',
        severity: 'warning',
        category: '患者',
        age_minutes: 24 * 60,
        action_label: '再連絡する →',
        action_href: '/communications/requests',
      },
      {
        id: 'ex_2',
        label: '送付先の確認(やまもと内科)',
        severity: 'warning',
        category: '事務',
        age_minutes: 30,
        action_label: '状況を見る →',
        action_href: '/admin/contact-profiles',
      },
    ],
    evidence: {
      route_calculated_at: localIso(9, 40),
      vehicle_label: '軽バン1号',
      prior_record_count: 3,
    },
  };
}

describe('VisitsToday', () => {
  beforeEach(() => {
    useUIStore.setState({ workspaceRailOpen: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 12, 9, 42));
    refetchMock.mockClear();
    useRealtimeQueryMock.mockReturnValue({
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

  it('renders the header with the single primary visit-mode action', () => {
    render(<VisitsToday />);

    expect(screen.getByRole('heading', { name: '訪問' })).toBeTruthy();
    expect(screen.getByText(/6\/12\(金\) — 出発前の最終確認/)).toBeTruthy();

    // 主操作(青)は先頭訪問の訪問モードへ
    const primary = screen.getByRole('link', { name: '訪問モードを開始' });
    expect(primary.getAttribute('href')).toBe('/visits/sch_ito/record');
  });

  it('renders the preparation list with counts, progress and check chips', () => {
    render(<VisitsToday />);

    const list = screen.getByTestId('visits-today-list');
    expect(within(list).getByText('今日の訪問 — 出発前確認')).toBeTruthy();
    expect(within(list).getByText('未完了チェックを0にしてから訪問モードへ進みます')).toBeTruthy();
    expect(within(list).getByText('2件＋施設12名')).toBeTruthy();

    const cards = within(list).getAllByTestId('visit-prep-card');
    expect(cards).toHaveLength(3);

    // 1枚目: 準備完了(緑)。チェック済チップ
    expect(within(cards[0]).getByText('10:30')).toBeTruthy();
    expect(within(cards[0]).getByText('伊藤 キヨ 様')).toBeTruthy();
    expect(within(cards[0]).getByText('在宅・滞在45分')).toBeTruthy();
    expect(within(cards[0]).getByText('準備 4/4')).toBeTruthy();
    expect(cards[0].getAttribute('data-accent')).toBe('ready');
    expect(within(cards[0]).getByText('前回からの変化を確認済')).toBeTruthy();
    expect(within(cards[0]).getByRole('link', { name: '→ カードへ' })).toBeTruthy();
    expect(within(cards[0]).getByRole('link', { name: '→ ルート詳細' }).getAttribute('href')).toBe(
      '/schedules?focus=schedule&schedule_id=sch_ito',
    );

    // 2枚目: 危険タグを隠さない + 未完アラート + 繰り下げ注記 + 監査導線
    expect(within(cards[1]).getByText('田中 一郎 様')).toBeTruthy();
    expect(within(cards[1]).getByText('麻薬')).toBeTruthy();
    expect(within(cards[1]).getByText('冷所')).toBeTruthy();
    expect(within(cards[1]).getByText('感染隔離')).toBeTruthy();
    expect(within(cards[1]).getByText('在宅酸素')).toBeTruthy();
    expect(within(cards[1]).getByText(/持参薬 — 麻薬監査待ち\(期限12:00\)/)).toBeTruthy();
    expect(cards[1].getAttribute('data-accent')).toBe('caution');
    expect(
      within(cards[1]).getByText(
        '監査が間に合わない場合: 15:00繰り下げ案を反映できます(スケジュールで調整)',
      ),
    ).toBeTruthy();
    expect(within(cards[1]).getByRole('link', { name: '→ 監査へ' })).toBeTruthy();

    // 3枚目: 施設一括(進行=青) + セット進捗 + 施設導線
    expect(within(cards[2]).getByText('施設グリーンヒル')).toBeTruthy();
    expect(within(cards[2]).getByText('12名・滞在90分')).toBeTruthy();
    expect(within(cards[2]).getByText('セット 9/12 — 事務が先行準備中')).toBeTruthy();
    expect(cards[2].getAttribute('data-accent')).toBe('progress');
    expect(within(cards[2]).getByText('アレルギー')).toBeTruthy();
    expect(within(cards[2]).getByText('TPN')).toBeTruthy();
    expect(within(cards[2]).getByRole('link', { name: '→ セットへ' })).toBeTruthy();
    expect(
      within(cards[2]).getByRole('link', { name: '→ 施設パケット' }).getAttribute('href'),
    ).toBe('/schedules?focus=schedule&schedule_id=sch_gh');

    // フッターのオフライン注記
    expect(screen.getByTestId('visits-today-offline-note').textContent).toContain(
      '訪問モードはオフラインでも全機能が動きます',
    );
  });

  it('renders the action rail with next action, blocked reasons and evidence', () => {
    render(<VisitsToday />);

    const nextAction = screen.getByTestId('next-action-panel');
    expect(
      within(nextAction).getByRole('link', { name: '麻薬監査を開始 — 12:00期限' }),
    ).toBeTruthy();

    const blocked = screen.getByTestId('blocked-reasons-panel');
    expect(within(blocked).getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(within(blocked).getByText('患者')).toBeTruthy();
    expect(within(blocked).getByText('1日')).toBeTruthy();
    expect(within(blocked).getByText('送付先の確認(やまもと内科)')).toBeTruthy();
    expect(within(blocked).getByText('30分')).toBeTruthy();

    const evidence = screen.getByTestId('evidence-panel');
    expect(within(evidence).getByText('本日のルート')).toBeTruthy();
    expect(within(evidence).getByText('計算 09:40')).toBeTruthy();
    expect(within(evidence).getByText('保冷バッグ')).toBeTruthy();
    expect(within(evidence).getByText('車両: 軽バン1号')).toBeTruthy();
    expect(within(evidence).getByText('前回訪問記録')).toBeTruthy();
    expect(within(evidence).getByText('3件')).toBeTruthy();
    const evidenceLinks = within(evidence).getAllByRole('link', { name: '開く' });
    expect(evidenceLinks[0].getAttribute('href')).toBe(
      '/schedules?focus=schedule&schedule_id=sch_ito',
    );
    expect(evidenceLinks[1].getAttribute('href')).toBe(
      '/schedules?focus=schedule&schedule_id=sch_ito',
    );
    expect(evidenceLinks[2].getAttribute('href')).toBe('/visits/sch_ito/record');
  });

  it('focuses the route next action on the first schedule when no audit is pending', () => {
    useRealtimeQueryMock.mockReturnValue({
      data: {
        ...buildFixture(),
        next_action: null,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });

    render(<VisitsToday />);

    expect(
      within(screen.getByTestId('next-action-panel'))
        .getByRole('link', { name: '今日のルートを確認する' })
        .getAttribute('href'),
    ).toBe('/schedules?focus=schedule&schedule_id=sch_ito');
  });

  it('disables the primary action and shows the empty state when no visits exist', () => {
    useRealtimeQueryMock.mockReturnValue({
      data: {
        ...buildFixture(),
        cards: [],
        visit_count: 0,
        facility_patient_count: 0,
        next_action: null,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });

    render(<VisitsToday />);

    const primary = screen.getByRole('button', { name: '訪問モードを開始' });
    expect(primary.hasAttribute('disabled')).toBe(true);
    // 無効ボタンは理由を支援技術に接続し、解消導線を提示する
    const reasonId = primary.getAttribute('aria-describedby');
    expect(reasonId).toBe('visit-start-disabled-reason');
    const reason = document.getElementById(reasonId!);
    expect(reason?.textContent).toContain('本日の訪問予定がないため開始できません');
    expect(screen.getByRole('link', { name: '訪問予定を確認' })).toBeTruthy();
    expect(screen.getByText('本日の訪問予定はありません。')).toBeTruthy();
    expect(screen.getByRole('link', { name: '今日のルートを確認する' })).toBeTruthy();
  });

  it('fetches the today-preparation board with helper org headers and a raw query key', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useRealtimeQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return {
          data: buildFixture(),
          isLoading: false,
          isError: false,
          error: null,
          refetch: refetchMock,
        };
      },
    );
    // the route returns success({ data }) and fetchVisitPreparationBoard unwraps json.data.
    const boardFixture = buildFixture();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: boardFixture }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<VisitsToday />);

      if (!captured) throw new Error('useRealtimeQuery config was not captured');
      expect(captured.queryKey).toEqual(['visits', 'today-preparation', 'org_1']);
      const result = await captured.queryFn();

      // the queryFn must unwrap the { data } envelope and return the board itself.
      expect(result).toBe(boardFixture);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/visits/today-preparation');
      expect(init.headers).toBe(sentinelHeaders);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenNthCalledWith(1, 'org_1');
    } finally {
      vi.unstubAllGlobals();
      vi.mocked(buildOrgHeaders).mockReset();
    }
  });
});
