// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { PatientBoardCard, PatientBoardResponse } from '@/types/patient-board';

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

import { PatientsBoard, formatNextVisitLabel } from './patients-board';

function localIso(hours: number, minutes = 0) {
  return new Date(2026, 5, 12, hours, minutes).toISOString();
}

function card(overrides: Partial<PatientBoardCard>): PatientBoardCard {
  return {
    patient_id: 'pt_default',
    name: '患者 既定',
    age: 80,
    residence_kind: 'home',
    residence_label: '在宅',
    address: null,
    attention: 'steady',
    safety_tags: [],
    next_visit_date: null,
    next_visit_time: null,
    next_visit_label: null,
    current_step: 'set',
    status_text: 'セット作成中(通常レーン)',
    status_tone: 'neutral',
    link_label: 'セットへ',
    link_href: '/medication-sets',
    ...overrides,
  };
}

function buildFixture(): PatientBoardResponse {
  return {
    generated_at: localIso(9, 42),
    scope: 'mine',
    assigned_total: 28,
    cards: [
      card({
        patient_id: 'pt_tanaka',
        name: '田中 一郎',
        age: 84,
        attention: 'urgent_now',
        safety_tags: ['narcotic', 'cold_storage'],
        next_visit_date: '2026-06-12',
        next_visit_time: '14:00',
        current_step: 'audit',
        status_text: '麻薬監査 期限12:00 — 持参薬が未確定',
        status_tone: 'critical',
        link_label: '監査へ',
        link_href: '/auditing',
      }),
      card({
        patient_id: 'pt_sasaki',
        name: '佐々木 ハル',
        age: 79,
        attention: 'wait_release',
        safety_tags: ['renal'],
        next_visit_date: '2026-06-13',
        next_visit_time: '10:00',
        current_step: 'decision',
        status_text: '照会回答が届きました(09:31) — 調剤を再開できます',
        status_tone: 'positive',
        link_label: '調剤へ',
        link_href: '/dispensing',
      }),
      card({
        patient_id: 'pt_suzuki',
        name: '鈴木 新',
        age: 76,
        attention: 'acceptance',
        next_visit_label: '未定(調整中)',
        current_step: null,
        status_text: '受入の返答待ち — 訪問枠を調整中',
        status_tone: 'caution',
        link_label: 'スケジュールへ',
        link_href: '/schedules',
      }),
      card({
        patient_id: 'pt_ito',
        name: '伊藤 キヨ',
        age: 88,
        attention: 'visit_today',
        safety_tags: ['swallowing'],
        next_visit_date: '2026-06-12',
        next_visit_time: '10:30',
        current_step: 'visit',
        status_text: '準備完了 — パケット・ルート・セット✓',
        status_tone: 'info',
        link_label: '訪問へ',
        link_href: '/visits',
      }),
      card({
        patient_id: 'pt_yoshida',
        name: '吉田 進',
        age: 80,
        residence_kind: 'hospital',
        residence_label: '入院中',
        attention: 'paused',
        next_visit_label: '退院連絡待ち',
        current_step: null,
        status_text: '入院中 — 退院時共同指導の対象',
        status_tone: 'neutral',
        link_label: '算定チェックへ',
        link_href: '/billing',
      }),
    ],
    chip_counts: { urgent_now: 1, external_wait: 0, visit_today: 1, paused: 1 },
    today_facility_patient_count: 12,
    today_visit_count: 3,
    safety_tagged_count: 9,
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
  };
}

describe('PatientsBoard', () => {
  beforeEach(() => {
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

  it('renders the header with the color legend, scope toggle and filter chips', () => {
    render(<PatientsBoard />);

    expect(screen.getByRole('heading', { name: '患者一覧' })).toBeTruthy();
    expect(screen.getByText(/6\/12\(金\) 09:42 — カードの色＝いま必要な対応/)).toBeTruthy();

    const scopeBar = screen.getByRole('group', { name: '担当範囲の切替' });
    expect(within(scopeBar).getByRole('button', { name: '私の担当' })).toBeTruthy();
    expect(within(scopeBar).getByRole('button', { name: '全員' })).toBeTruthy();

    const summary = screen.getByLabelText('今日の患者判断サマリー');
    expect(within(summary).getByText('最初に見る')).toBeTruthy();
    expect(within(summary).getByText('田中 一郎様から確認')).toBeTruthy();
    expect(within(summary).getByText('再開できる')).toBeTruthy();
    expect(within(summary).getAllByText('1名')).toHaveLength(3);
    expect(within(summary).getByText('本日訪問')).toBeTruthy();
    expect(within(summary).getByText('2名+施設12名')).toBeTruthy();
    expect(within(summary).getByText('止まっている')).toBeTruthy();
    expect(within(summary).getByText('外部待ち0名 / 休止1名')).toBeTruthy();

    expect(screen.getByText('並び: 対応が必要な順')).toBeTruthy();
    const chipBar = screen.getByRole('group', { name: '対応カテゴリの絞り込み' });
    expect(within(chipBar).getByRole('button', { name: /今すぐ対応/ })).toBeTruthy();
    expect(within(chipBar).getByRole('button', { name: /本日訪問 3＋施設12名/ })).toBeTruthy();
    expect(within(chipBar).getByRole('button', { name: /休止/ })).toBeTruthy();

    expect(screen.getByTestId('patients-board-scope-note').textContent).toContain(
      '私の担当 28名のうち 5名を表示',
    );
    expect(screen.getByRole('searchbox', { name: '氏名・住所で検索' })).toBeTruthy();
  });

  it('renders patient cards with hazard tags, next visit, process dots and step shortcuts', () => {
    render(<PatientsBoard />);

    const cards = screen.getAllByTestId('patient-board-card');
    expect(cards).toHaveLength(5);

    // 今すぐ対応カード: 危険タグを隠さない + 状態自然文 + 工程ショートカット
    const urgent = cards.find((node) => node.getAttribute('data-attention') === 'urgent_now');
    expect(urgent).toBeTruthy();
    expect(within(urgent as HTMLElement).getByText('田中 一郎')).toBeTruthy();
    expect(within(urgent as HTMLElement).getByText('今すぐ対応')).toBeTruthy();
    expect(within(urgent as HTMLElement).getByText('麻薬')).toBeTruthy();
    expect(within(urgent as HTMLElement).getByText('冷所')).toBeTruthy();
    expect(within(urgent as HTMLElement).getByText('本日 14:00')).toBeTruthy();
    expect(
      within(urgent as HTMLElement).getByText('麻薬監査 期限12:00 — 持参薬が未確定'),
    ).toBeTruthy();
    expect(within(urgent as HTMLElement).getByRole('link', { name: '→ 監査へ' })).toBeTruthy();
    expect(
      within(urgent as HTMLElement)
        .getByTestId('process-progress-dots')
        .getAttribute('aria-label'),
    ).toContain('監査');

    // タグなしは「安全タグなし」を明示
    const acceptance = cards.find((node) => node.getAttribute('data-attention') === 'acceptance');
    expect(within(acceptance as HTMLElement).getByText('安全タグなし')).toBeTruthy();
    expect(within(acceptance as HTMLElement).getByText('未定(調整中)')).toBeTruthy();

    // 休止カード: 全点灰ドット + 休止ラベル
    const paused = cards.find((node) => node.getAttribute('data-attention') === 'paused');
    expect(within(paused as HTMLElement).getByTestId('paused-progress-dots')).toBeTruthy();
    expect(within(paused as HTMLElement).getByText('退院連絡待ち')).toBeTruthy();
    expect(within(paused as HTMLElement).getByText(/80歳・入院中/)).toBeTruthy();
  });

  it('filters cards by chip selection and search query', () => {
    render(<PatientsBoard />);

    const chipBar = screen.getByRole('group', { name: '対応カテゴリの絞り込み' });

    fireEvent.click(within(chipBar).getByRole('button', { name: /休止/ }));
    expect(screen.getAllByTestId('patient-board-card')).toHaveLength(1);
    expect(screen.getByText('吉田 進')).toBeTruthy();

    // 本日訪問チップは対応カテゴリに関わらず「今日訪問がある患者」(今すぐ対応の田中も含む)
    fireEvent.click(within(chipBar).getByRole('button', { name: /本日訪問/ }));
    expect(screen.getAllByTestId('patient-board-card')).toHaveLength(2);
    expect(screen.getByText('田中 一郎')).toBeTruthy();
    expect(screen.getByText('伊藤 キヨ')).toBeTruthy();

    fireEvent.click(within(chipBar).getByRole('button', { name: /今すぐ対応/ }));
    expect(screen.getAllByTestId('patient-board-card')).toHaveLength(5);

    fireEvent.change(screen.getByRole('searchbox', { name: '氏名・住所で検索' }), {
      target: { value: '伊藤' },
    });
    expect(screen.getAllByTestId('patient-board-card')).toHaveLength(1);
    expect(screen.getByText('伊藤 キヨ')).toBeTruthy();
  });

  it('uses summary tiles as shortcuts into the visible patient groups', () => {
    render(<PatientsBoard />);

    fireEvent.click(screen.getByRole('button', { name: /本日訪問2名\+施設12名/ }));

    expect(screen.getAllByTestId('patient-board-card')).toHaveLength(2);
    expect(screen.getByText('田中 一郎')).toBeTruthy();
    expect(screen.getByText('伊藤 キヨ')).toBeTruthy();
  });

  it('renders the action rail with the single primary action, blocked reasons and evidence', () => {
    render(<PatientsBoard />);

    const nextAction = screen.getByTestId('next-action-panel');
    expect(
      within(nextAction).getByRole('link', { name: '麻薬監査を開始 — 12:00期限' }),
    ).toBeTruthy();

    const blocked = screen.getByTestId('blocked-reasons-panel');
    expect(within(blocked).getByText('止まっている理由')).toBeTruthy();
    expect(within(blocked).getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(within(blocked).getByText('患者')).toBeTruthy();
    expect(within(blocked).getByText('1日')).toBeTruthy();
    expect(within(blocked).getByText('送付先の確認(やまもと内科)')).toBeTruthy();
    expect(within(blocked).getByText('30分')).toBeTruthy();

    const evidence = screen.getByTestId('evidence-panel');
    expect(within(evidence).getByText('担当患者')).toBeTruthy();
    expect(within(evidence).getByText('28名')).toBeTruthy();
    expect(within(evidence).getByText('本日の訪問')).toBeTruthy();
    expect(within(evidence).getByText('3件＋施設')).toBeTruthy();
    expect(within(evidence).getByText('安全タグあり')).toBeTruthy();
    expect(within(evidence).getByText('9名')).toBeTruthy();
    expect(within(evidence).getAllByRole('link', { name: /開く/ })).toHaveLength(3);
  });
});

describe('formatNextVisitLabel', () => {
  const now = new Date(2026, 5, 12, 9, 42);

  it('formats today / future dates / undecided labels', () => {
    expect(
      formatNextVisitLabel(card({ next_visit_date: '2026-06-12', next_visit_time: '14:00' }), now),
    ).toBe('本日 14:00');
    expect(
      formatNextVisitLabel(card({ next_visit_date: '2026-06-16', next_visit_time: null }), now),
    ).toBe('6/16(火)');
    expect(
      formatNextVisitLabel(card({ next_visit_date: null, next_visit_label: '退院連絡待ち' }), now),
    ).toBe('退院連絡待ち');
    expect(formatNextVisitLabel(card({ next_visit_date: null }), now)).toBe('未定');
  });
});
