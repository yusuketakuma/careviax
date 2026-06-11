// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type { IntakeTriageResponse, IntakeTriageRow } from './intake-triage.shared';

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

import { IntakeTriageContent, formatReceivedAt } from './intake-triage-content';

function localIso(year: number, month: number, day: number, hours: number, minutes = 0) {
  return new Date(year, month, day, hours, minutes).toISOString();
}

function buildRow(args: Partial<IntakeTriageRow> & { intake_id: string }): IntakeTriageRow {
  return {
    cycle_id: `cycle_${args.intake_id}`,
    patient_id: `patient_${args.intake_id}`,
    patient_name: '佐々木 ハル',
    received_at: localIso(2026, 5, 11, 9, 35),
    lane: 'fax',
    issuer: 'やまもと内科',
    content_label: '定期処方',
    rx_number: null,
    auto_read_percent: null,
    status: 'imported',
    duplicate_of_date: null,
    action: 'to_card',
    ...args,
  };
}

function buildTriageFixture(): IntakeTriageResponse {
  return {
    generated_at: localIso(2026, 5, 11, 9, 42),
    new_today_count: 2,
    needs_decision_count: 1,
    lane_counts: { fax: 3, online: 1, walk_in: 1 },
    rows: [
      buildRow({
        intake_id: 'intake_sasaki',
        patient_name: '佐々木 ハル',
        received_at: localIso(2026, 5, 11, 9, 35),
        content_label: '処方変更(照会回答の反映)',
        auto_read_percent: 98,
        status: 'unblock_related',
        action: 'send_to_entry',
      }),
      buildRow({
        intake_id: 'intake_suzuki',
        patient_name: '鈴木 新',
        lane: 'online',
        issuer: 'きたきゅうケアプラン',
        received_at: localIso(2026, 5, 11, 9, 12),
        content_label: '定期処方',
        status: 'acceptance_pending',
        action: 'to_dashboard',
      }),
      buildRow({
        intake_id: 'intake_takahashi',
        patient_name: '高橋 茂',
        issuer: 'みどり医院',
        received_at: localIso(2026, 5, 11, 8, 55),
        auto_read_percent: 96,
        status: 'duplicate_suspected',
        duplicate_of_date: '6/9',
        action: 'compare',
      }),
      buildRow({
        intake_id: 'intake_tanaka',
        patient_name: '田中 一郎',
        received_at: localIso(2026, 5, 10, 17, 20),
        rx_number: 'RX-2024-0500',
        auto_read_percent: 99,
        status: 'entered_in_progress',
        action: 'to_audit',
      }),
      buildRow({
        intake_id: 'intake_watanabe',
        patient_name: '渡辺 フミ',
        lane: 'walk_in',
        issuer: 'ご家族',
        received_at: localIso(2026, 5, 10, 16, 5),
        status: 'imported',
        action: 'to_card',
      }),
    ],
    duplicate_notices: [
      {
        intake_id: 'intake_takahashi',
        patient_name: '高橋 茂',
        lane: 'fax',
        matched_date: '6/9',
      },
    ],
    evidence: {
      fax_document_count: 3,
      reader_model_version: 'v1',
      discard_count_this_month: 2,
    },
  };
}

function buildCockpitFixture(): DashboardCockpitResponse {
  return {
    generated_at: localIso(2026, 5, 11, 9, 42),
    cycle_status_counts: {},
    audit_pending_count: 1,
    narcotic_audit_count: 1,
    audit_queue: [
      {
        task_id: 'task_1',
        cycle_id: 'cycle_1',
        patient_name: '田中 一郎',
        priority: 'urgent',
        due_at: localIso(2026, 5, 11, 12, 0),
        intake_id: 'intake_0500',
        prescribed_date: '2024-05-01',
        handling_tags: ['narcotic'],
        has_narcotic: true,
        waiting_since: localIso(2026, 5, 11, 8, 0),
      },
    ],
    today_visits: [
      {
        id: 'visit_1',
        patient_name: '田中 一郎',
        visit_type: 'regular',
        schedule_status: 'planned',
        time_start: localIso(2026, 5, 11, 14, 0),
        time_end: localIso(2026, 5, 11, 15, 0),
        facility_batch_id: null,
      },
    ],
    blocked_reasons: [
      {
        id: 'exception_1',
        label: 'ご家族の同意待ち(新規契約)',
        severity: 'warning',
        category: '患者',
        age_minutes: 24 * 60,
        action_label: '再連絡する →',
        action_href: '/patients',
      },
      {
        id: 'exception_2',
        label: '送付先の確認(やまもと内科)',
        severity: 'warning',
        category: '事務',
        age_minutes: 30,
        action_label: '状況を見る →',
        action_href: '/workflow',
      },
    ],
    carryover_count: 0,
  };
}

function mockQueries({
  triage,
  cockpit,
}: {
  triage: IntakeTriageResponse | null;
  cockpit: DashboardCockpitResponse | null;
}) {
  useRealtimeQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
    const isCockpit = options.queryKey[0] === 'dashboard';
    return {
      data: isCockpit ? cockpit : triage,
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    };
  });
}

describe('IntakeTriageContent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 11, 9, 42));
    useRealtimeQueryMock.mockReset();
    refetchMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('取込キュー(FAX レーン既定)・重複バナー・工程ストリップ・右レールを描画する', () => {
    mockQueries({ triage: buildTriageFixture(), cockpit: buildCockpitFixture() });
    render(<IntakeTriageContent />);

    // ヘッダー: 見出し + 新着/確認待ちサマリ + 手動取込(outline)
    expect(screen.getByRole('heading', { name: '処方取込' })).toBeTruthy();
    expect(screen.getByText(/新着2件・確認待ち1件/)).toBeTruthy();
    const manualLink = screen.getByTestId('intake-manual-entry-link');
    expect(manualLink.getAttribute('href')).toBe('/prescriptions/new');

    // 取込キュー: 既定は FAX レーンの 3 行
    expect(screen.getByRole('heading', { name: '取込キュー' })).toBeTruthy();
    expect(
      screen.getByText('新着が上・読取の確からしさは必ず人が確認してから入力へ'),
    ).toBeTruthy();
    expect(screen.getAllByTestId('intake-triage-row')).toHaveLength(3);

    // 行内容: 状態語彙 + 自動読取 % + RX 番号 + 動的アクション
    expect(screen.getByText('待ち解除に関連')).toBeTruthy();
    expect(screen.getByText('98%')).toBeTruthy();
    expect(screen.getByText('重複の疑い(6/9取込分と同一?)')).toBeTruthy();
    expect(screen.getByText('入力済 → 監査中')).toBeTruthy();
    expect(screen.getByText(/田中 一郎 様 — 定期処方 RX-2024-0500/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '入力へ送る' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '並べて比較' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '→ 監査へ' })).toBeTruthy();

    // 受信時刻の相対表記(昨日)
    expect(screen.getByText('昨日 17:20')).toBeTruthy();

    // 重複検知バナー(破棄理由の記録に言及)
    const banner = screen.getByTestId('intake-duplicate-banner');
    expect(within(banner).getByText(/重複検知 1件:/)).toBeTruthy();
    expect(banner.textContent).toContain('6/9 取込分と発行日・Rp構成が一致しています');
    expect(banner.textContent).toContain('破棄理由は記録されます');

    // 工程ストリップ: 取込(緑)→入力→判断→··· + 8 工程コピー
    const strip = screen.getByTestId('intake-process-strip');
    expect(within(strip).getByText('取込')).toBeTruthy();
    expect(within(strip).getByText('入力')).toBeTruthy();
    expect(within(strip).getByText('判断')).toBeTruthy();
    expect(within(strip).getByText('···')).toBeTruthy();
    expect(
      within(strip).getByText('取込の正確さが、この先8工程すべての速さを決めます'),
    ).toBeTruthy();

    // 右レール: 主操作(麻薬監査)+ 止まっている理由 + 根拠・記録(取込メタ)
    expect(screen.getByRole('link', { name: '麻薬監査を開始 — 12:00期限' })).toBeTruthy();
    expect(screen.getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(screen.getByText('元FAX画像')).toBeTruthy();
    expect(screen.getByText('読取モデルの版')).toBeTruthy();
    expect(screen.getByText('破棄ログ')).toBeTruthy();
    expect(screen.getByText('今月2件')).toBeTruthy();
  });

  it('レーンチップの再クリックで全件表示に切り替わる', () => {
    mockQueries({ triage: buildTriageFixture(), cockpit: buildCockpitFixture() });
    render(<IntakeTriageContent />);

    expect(screen.getAllByTestId('intake-triage-row')).toHaveLength(3);

    // FAX(選択中)をもう一度押す → 全レーン表示
    fireEvent.click(screen.getByRole('button', { name: /FAX/ }));
    expect(screen.getAllByTestId('intake-triage-row')).toHaveLength(5);

    // オンラインを選ぶ → 1 行
    fireEvent.click(screen.getByRole('button', { name: /オンライン/ }));
    expect(screen.getAllByTestId('intake-triage-row')).toHaveLength(1);
    expect(screen.getByText('受入判断待ち')).toBeTruthy();
  });

  it('キューが空のレーンでは空状態メッセージを出す', () => {
    const fixture = buildTriageFixture();
    fixture.rows = fixture.rows.filter((row) => row.lane !== 'fax');
    fixture.duplicate_notices = [];
    mockQueries({ triage: fixture, cockpit: buildCockpitFixture() });
    render(<IntakeTriageContent />);

    expect(
      screen.getByText('この経路の取込はいまありません。受信すると新着が上に並びます。'),
    ).toBeTruthy();
  });
});

describe('formatReceivedAt', () => {
  const now = new Date(2026, 5, 11, 9, 42);

  it('当日は HH:mm、昨日は「昨日 HH:mm」、それ以前は M/d HH:mm', () => {
    expect(formatReceivedAt(localIso(2026, 5, 11, 9, 35), now)).toBe('09:35');
    expect(formatReceivedAt(localIso(2026, 5, 10, 17, 20), now)).toBe('昨日 17:20');
    expect(formatReceivedAt(localIso(2026, 5, 8, 11, 0), now)).toBe('6/8 11:00');
  });
});
