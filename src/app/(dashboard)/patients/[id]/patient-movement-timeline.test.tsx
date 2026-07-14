// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { PatientMovementTimelineEvent } from '@/types/patient-movement-timeline';
import { PatientMovementTimeline } from './patient-movement-timeline';

setupDomTestEnv();

function movementEvent(
  input: Pick<
    PatientMovementTimelineEvent,
    'id' | 'event_type' | 'category' | 'occurred_at' | 'title' | 'href' | 'action_label'
  > &
    Partial<PatientMovementTimelineEvent>,
): PatientMovementTimelineEvent {
  return {
    recorded_at: null,
    summary: null,
    status: null,
    status_label: null,
    actor_name: null,
    actor_role: null,
    source_channel: 'internal',
    source_label: 'PH-OS',
    related_entity_type: null,
    related_entity_id: null,
    severity: 'normal',
    badges: [],
    metadata: [],
    privacy_level: 'summary',
    raw_available: false,
    ...input,
  };
}

const timelineEvents = [
  movementEvent({
    id: 'event_visit',
    event_type: 'visit_record' as const,
    category: 'visit' as const,
    occurred_at: '2026-04-03T12:30:00.000Z',
    title: '訪問記録を登録',
    summary: '服薬状況は安定しています。',
    href: '/visits/visit_1/record',
    action_label: '訪問記録を開く',
    status: 'completed',
    status_label: '完了',
    actor_name: '薬剤師A',
    metadata: ['次回提案 2026/04/10'],
  }),
  movementEvent({
    id: 'event_document',
    event_type: 'management_plan' as const,
    category: 'document' as const,
    occurred_at: '2026-04-02T13:00:00.000Z',
    title: '管理計画書を承認',
    summary: '訪問薬剤管理指導計画書 / 次回見直し 2026/05/01',
    href: '/patients/patient_1/management-plan',
    action_label: '計画書を開く',
    status: 'approved',
    status_label: '承認済み',
    actor_name: '薬剤師B',
    metadata: [],
  }),
  movementEvent({
    id: 'event_dispense',
    event_type: 'dispense_result' as const,
    category: 'prescription' as const,
    occurred_at: '2026-04-02T10:00:00.000Z',
    title: '調剤を記録',
    summary: 'アムロジピン 30錠 / 持参',
    href: '/prescriptions/intake_1',
    action_label: '処方記録を開く',
    status: 'dispensed',
    status_label: '調剤済',
    actor_name: '薬剤師C',
    metadata: [],
  }),
  movementEvent({
    id: 'event_billing',
    event_type: 'billing_candidate' as const,
    category: 'billing' as const,
    occurred_at: '2026-04-01T10:00:00.000Z',
    title: '算定候補を更新',
    summary: '居宅療養管理指導 / 650点',
    href: '/billing/candidates?patient_id=patient_1',
    action_label: '算定候補を開く',
    status: 'confirmed',
    status_label: '確定',
    actor_name: null,
    metadata: ['算定月 2026/04/01'],
  }),
];

const selfReports = [
  {
    id: 'self_report_1',
    category: '体調変化',
    relation: '本人',
    status: 'submitted',
    requested_callback: true,
    preferred_contact_time: '18:00以降',
    created_at: '2026-04-03T09:00:00.000Z',
  },
];

const selfReportTimelineEvent = movementEvent({
  id: 'event_self_report',
  event_type: 'self_report' as const,
  category: 'communication' as const,
  occurred_at: '2026-04-03T09:00:00.000Z',
  title: '患者から自己申告を受信',
  summary: '夕食後の飲み忘れ / adherence / 夕食後薬を2日続けて飲み忘れています。',
  href: '/patients/patient_1/collaboration',
  action_label: '連携を確認',
  status: 'submitted',
  status_label: '未対応',
  actor_name: '家族A',
  metadata: ['関係 家族', '折返し希望', '希望時間 18時以降'],
});

const mcsTimelineEvent = movementEvent({
  id: 'event_mcs',
  event_type: 'operation_history' as const,
  category: 'communication' as const,
  occurred_at: '2026-04-03T08:30:00.000Z',
  title: 'MCS確認ログを登録',
  summary: '報告確認 / 訪看投稿を確認 / 次 医師へ返信',
  href: '/patients/patient_1/mcs',
  action_label: 'MCS連携を開く',
  status: 'patient_mcs_check_log_created',
  status_label: 'MCS確認',
  actor_name: '薬剤師D',
  metadata: ['patient_external_link', 'patient_1'],
});

const conferenceTimelineEvent = movementEvent({
  id: 'event_conference',
  event_type: 'conference_note' as const,
  category: 'communication' as const,
  occurred_at: '2026-04-02T15:00:00.000Z',
  title: '退院前カンファレンスを記録',
  summary: '初回訪問前確認 / 合意事項 3件 / 報告ドラフトあり',
  href: '/conferences?patient_id=patient_1',
  action_label: '会議を開く',
  status: 'open',
  status_label: 'フォロー中',
  actor_name: null,
  metadata: ['フォロー期限 2026/04/04'],
});

const inboundTimelineEvent = movementEvent({
  id: 'event_inbound_mcs',
  event_type: 'inbound_mcs' as const,
  category: 'interprofessional' as const,
  occurred_at: '2026-04-03T08:00:00.000Z',
  title: '訪問看護師から残数報告を受信',
  summary: '湿布の残り枚数について確認が必要です。',
  href: '/patients/patient_1/inbound-communications/event_inbound_mcs',
  action_label: '受信情報を開く',
  status: 'needs_review',
  status_label: '確認待ち',
  actor_name: '訪問看護師A',
  metadata: ['MCS', '残数関連'],
});

describe('PatientMovementTimeline', () => {
  it('groups actions by day and renders patient-originated updates separately', () => {
    render(
      <PatientMovementTimeline
        timelineEvents={timelineEvents}
        selfReports={selfReports}
        currentEventId="event_visit"
        presentationTerminalEventId="event_visit"
        presentationOrder="occurred_at_asc_id_asc"
      />,
    );

    for (const heading of ['患者の動き', 'タイムライン要約', '患者からの更新']) {
      expect(screen.getByRole('heading', { level: 2, name: heading }).tagName).toBe('H2');
    }
    expect(screen.getByText('2026年4月3日')).toBeTruthy();
    expect(screen.getByText('2026年4月2日')).toBeTruthy();
    expect(screen.getAllByText('訪問記録を登録').length).toBeGreaterThan(0);
    expect(screen.getAllByText('管理計画書を承認').length).toBeGreaterThan(0);
    expect(screen.getByText('自己申告あり')).toBeTruthy();
    expect(screen.getByText(/未対応/)).toBeTruthy();
    expect(screen.getByText('在宅運用履歴')).toBeTruthy();
    expect(screen.getByText('処方・訪問')).toBeTruthy();
    expect(screen.getByText('文書登録')).toBeTruthy();
    expect(screen.getByText('訪問 1件')).toBeTruthy();
    expect(screen.getByText('処方・調剤 1件')).toBeTruthy();
    expect(screen.getByText('文書 1件')).toBeTruthy();
    expect(screen.getByText('読込済み 4 件表示')).toBeTruthy();
    expect(screen.queryByText(/全 4 件/)).toBeNull();
    expect(screen.getByRole('button', { name: /読込済み/ }).className).toContain('min-h-[44px]');
    for (const label of ['今日', '昨日', '7日', '30日', '期間を適用', 'リセット']) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeTruthy();
      expect(button.className).toMatch(/(?:min-h-11|min-h-\[44px\])/);
    }
    const april2Card = screen.getByTestId('movement-day-card-2026-04-02');
    expect(within(april2Card).getByText('この日の表示中 2件')).toBeTruthy();
    expect(within(april2Card).getByText('処方・調剤 1件')).toBeTruthy();
    expect(within(april2Card).getByText('文書 1件')).toBeTruthy();
    for (const label of [
      '契約・同意・書類',
      'MCS・外部連携',
      '処方せん管理',
      '請求・集金管理',
      'カンファレンス',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText('夕方にふらつきあり')).toBeNull();
    expect(
      screen.queryByText('立ち上がり時にふらつきがあり、折り返し連絡を希望しています。'),
    ).toBeNull();
    expect(screen.queryByText('服薬状況は安定しています。')).toBeNull();
    expect(screen.queryByText('アムロジピン 30錠 / 持参')).toBeNull();
    expect(screen.queryByText('訪問薬剤管理指導計画書 / 次回見直し 2026/05/01')).toBeNull();
    for (const [title, action, href] of [
      ['訪問記録を登録', '訪問記録を開く', '/visits/visit_1/record'],
      ['調剤を記録', '処方記録を開く', '/prescriptions/intake_1'],
      ['管理計画書を承認', '計画書を開く', '/patients/patient_1/management-plan'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: `${title}の証跡を確認` }));
      expect(
        screen
          .getByRole('link', {
            name: `選択中イベントの詳細を開く: ${action}`,
          })
          .getAttribute('href'),
      ).toBe(href);
    }
    expect(screen.getByText('現在 / 最新')).toBeTruthy();
    expect(document.querySelectorAll('[aria-current="time"]')).toHaveLength(1);
  });

  it('keeps the current movement date-card shell accessible and mobile-safe', () => {
    render(<PatientMovementTimeline timelineEvents={timelineEvents} selfReports={selfReports} />);

    expect(document.querySelector('table')).toBeNull();
    expect(screen.getByLabelText('タイムライン検索').className).toContain('min-h-11');
    expect(screen.getByLabelText('日付範囲フィルタ')).toBeTruthy();
    expect(screen.getByLabelText('確認フィルタ')).toBeTruthy();
    expect(screen.getByLabelText('タイムライン種別フィルタ')).toBeTruthy();

    const april3Card = screen.getByTestId('movement-day-card-2026-04-03');
    expect(april3Card.getAttribute('aria-labelledby')).toBe('movement-day-heading-2026-04-03');
    expect(
      within(april3Card).getByRole('heading', { level: 3, name: /2026年4月3日/ }),
    ).toBeTruthy();
    expect(
      within(april3Card).getByRole('heading', { level: 4, name: '訪問記録を登録' }),
    ).toBeTruthy();
    expect(within(april3Card).getByText('この日の表示中 1件')).toBeTruthy();

    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toMatch(/(?:min-h-11|min-h-\[44px\]|size-11)/);
    }

    expect(
      screen.getByRole('link', {
        name: '選択中イベントの詳細を開く: 訪問記録を開く',
      }),
    ).toBeTruthy();

    const renderedHrefs = Array.from(document.querySelectorAll('a')).map((link) =>
      link.getAttribute('href'),
    );
    expect(renderedHrefs.every((href) => !href?.startsWith('/api'))).toBe(true);
    expect(
      renderedHrefs.every((href) => !/\/patients\/[^/?#]+\/timeline(?:[/?#]|$)/.test(href ?? '')),
    ).toBe(true);
  });

  it('projects the bounded API window from newest-first into a stable past-to-current DOM order', () => {
    const equalTimeA = movementEvent({
      ...timelineEvents[0],
      id: 'event_equal_a',
      occurred_at: '2026-04-03T12:30:00.000Z',
      title: '同時刻A',
    });
    const equalTimeB = movementEvent({
      ...timelineEvents[0],
      id: 'event_equal_b',
      occurred_at: '2026-04-03T12:30:00.000Z',
      title: '同時刻B',
    });
    const older = movementEvent({
      ...timelineEvents[0],
      id: 'event_older',
      occurred_at: '2026-04-01T12:30:00.000Z',
      title: '最古',
    });

    render(
      <PatientMovementTimeline
        timelineEvents={[equalTimeB, equalTimeA, older]}
        selfReports={[]}
        currentEventId="event_equal_b"
        presentationTerminalEventId="event_equal_b"
        presentationOrder="occurred_at_asc_id_asc"
      />,
    );

    const renderedTitles = Array.from(
      document.querySelectorAll('[data-testid^="movement-day-card-"] ol > li h4'),
    ).map((node) => node.textContent);
    expect(renderedTitles).toEqual(['最古', '同時刻A', '同時刻B']);
    expect(document.querySelectorAll('[aria-current="time"]')).toHaveLength(1);
    expect(document.querySelector('[aria-current="time"]')?.textContent).toContain('同時刻B');
    expect(document.querySelectorAll('ol a')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: '同時刻Bの証跡を確認' }).getAttribute('aria-controls'),
    ).toBe('patient-movement-evidence-panel');
  });

  it('groups and formats instants on the Japan business day boundary', () => {
    const beforeJstMidnight = movementEvent({
      ...timelineEvents[0],
      id: 'event_before_jst_midnight',
      occurred_at: '2026-04-02T14:30:00.000Z',
      title: 'JST前日',
    });
    const afterJstMidnight = movementEvent({
      ...timelineEvents[0],
      id: 'event_after_jst_midnight',
      occurred_at: '2026-04-02T15:30:00.000Z',
      title: 'JST当日',
    });

    render(
      <PatientMovementTimeline
        timelineEvents={[afterJstMidnight, beforeJstMidnight]}
        selfReports={[]}
      />,
    );

    expect(
      within(screen.getByTestId('movement-day-card-2026-04-02')).getByText('JST前日'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('movement-day-card-2026-04-03')).getByText('JST当日'),
    ).toBeTruthy();
    expect(screen.getByText('2026年4月2日')).toBeTruthy();
    expect(screen.getByText('2026年4月3日')).toBeTruthy();
  });

  it('keeps local search bounded to loaded rows while server-backed temporal filters retain provenance', () => {
    const onFiltersChange = vi.fn();
    const provenanceEvent = movementEvent({
      ...timelineEvents[0],
      id: 'event_provenance',
      recorded_at: '2026-04-03T13:00:00.000Z',
      source_channel: 'mcs',
      source_label: 'MCS連携',
      actor_name: '薬剤師A',
      actor_role: '確認担当',
      title: '連携記録',
    });

    render(
      <PatientMovementTimeline
        timelineEvents={[provenanceEvent]}
        selfReports={[]}
        onFiltersChange={onFiltersChange}
      />,
    );

    expect(screen.getByText(/読込済み範囲を即時検索/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('タイムライン検索'), {
      target: { value: 'MCS連携' },
    });
    expect(screen.getAllByText('連携記録').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MCS連携').length).toBeGreaterThan(0);
    expect(screen.getAllByText('薬剤師A（確認担当）').length).toBeGreaterThan(0);
    expect(
      document.querySelectorAll('time[datetime="2026-04-03T13:00:00.000Z"]').length,
    ).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-04-01' } });
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: '2026-04-03' } });
    fireEvent.click(screen.getByRole('button', { name: '期間を適用' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      category: null,
      date_from: '2026-04-01',
      date_to: '2026-04-03',
    });
  });

  it('does not label a filtered or partial terminal event as the patient current state', () => {
    render(
      <PatientMovementTimeline
        timelineEvents={timelineEvents}
        selfReports={[]}
        currentEventId="event_visit"
        presentationTerminalEventId="event_visit"
        appliedFilters={{ category: 'visit', date_from: null, date_to: null }}
      />,
    );

    expect(document.querySelector('[aria-current="time"]')).toBeNull();
    expect(screen.getByText('絞込内最新')).toBeTruthy();
    expect(screen.queryByText('現在 / 最新')).toBeNull();
  });

  it('scopes the terminal marker when loaded-window search still matches the patient current event', async () => {
    render(
      <PatientMovementTimeline
        timelineEvents={timelineEvents}
        selfReports={[]}
        currentEventId="event_visit"
        presentationTerminalEventId="event_visit"
      />,
    );

    expect(document.querySelector('[aria-current="time"]')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('タイムライン検索'), {
      target: { value: '訪問記録' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('訪問記録を登録').length).toBeGreaterThan(0);
      expect(document.querySelector('[aria-current="time"]')).toBeNull();
    });
    expect(screen.getByText('読込済み絞込内最新')).toBeTruthy();
    expect(screen.queryByText('現在 / 最新')).toBeNull();
  });

  it('does not submit uncommitted custom date drafts when changing the server category', () => {
    const onFiltersChange = vi.fn();
    render(
      <PatientMovementTimeline
        timelineEvents={timelineEvents}
        selfReports={[]}
        onFiltersChange={onFiltersChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-04-01' } });
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: '2026-04-03' } });
    fireEvent.click(screen.getByRole('button', { name: /^訪問1$/ }));

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      category: 'visit',
      date_from: null,
      date_to: null,
    });

    fireEvent.click(screen.getByRole('button', { name: '期間を適用' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      category: 'visit',
      date_from: '2026-04-01',
      date_to: '2026-04-03',
    });
  });

  it('keeps the scoped latest-action summary stable when an older event is selected', () => {
    render(
      <PatientMovementTimeline
        timelineEvents={timelineEvents}
        selfReports={[]}
        currentEventId="event_visit"
        presentationTerminalEventId="event_visit"
      />,
    );

    const latestActionCard = screen.getByText('最新アクション').parentElement;
    expect(latestActionCard).toBeTruthy();
    expect(within(latestActionCard!).getByText('訪問記録を登録')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '管理計画書を承認の証跡を確認' }));

    expect(within(latestActionCard!).getByText('訪問記録を登録')).toBeTruthy();
    expect(within(latestActionCard!).queryByText('管理計画書を承認')).toBeNull();
    expect(
      within(screen.getByRole('region', { name: '選択中イベントの証跡' })).getByText(
        '管理計画書を承認',
      ),
    ).toBeTruthy();
  });

  it('distinguishes filtered and partial false-empty states from a genuine empty timeline', () => {
    const { rerender } = render(
      <PatientMovementTimeline key="filtered" timelineEvents={timelineEvents} selfReports={[]} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /安全関連0/ }));
    expect(screen.getByText(/読込済み範囲には一致がありません/)).toBeTruthy();
    expect(screen.queryByText(/記録されると、ここに時系列で表示/)).toBeNull();

    rerender(
      <PatientMovementTimeline
        key="partial"
        timelineEvents={[]}
        selfReports={[]}
        partialFailures={[
          {
            source: 'conferenceNotes',
            message: '一部のタイムライン情報を取得できませんでした',
          },
        ]}
      />,
    );
    expect(screen.getByText(/取得できた履歴範囲には一致がありません/)).toBeTruthy();
    expect(screen.queryByText(/記録されると、ここに時系列で表示/)).toBeNull();

    rerender(<PatientMovementTimeline key="empty" timelineEvents={[]} selfReports={[]} />);
    expect(screen.getByText(/記録されると、ここに時系列で表示/)).toBeTruthy();
  });

  it('recovers a false-empty timeline by clearing local and server-backed filters together', async () => {
    const onFiltersChange = vi.fn();
    render(
      <PatientMovementTimeline
        timelineEvents={timelineEvents}
        selfReports={[]}
        onFiltersChange={onFiltersChange}
      />,
    );

    fireEvent.click(
      within(screen.getByLabelText('タイムライン種別フィルタ')).getByRole('button', {
        name: /^訪問1$/,
      }),
    );
    fireEvent.click(
      within(screen.getByLabelText('確認フィルタ')).getByRole('button', {
        name: /^安全関連0$/,
      }),
    );
    fireEvent.change(screen.getByLabelText('タイムライン検索'), {
      target: { value: '一致しない検索語' },
    });

    const clearButton = await screen.findByRole('button', { name: '表示条件を解除' });
    fireEvent.click(clearButton);

    expect((screen.getByLabelText('タイムライン検索') as HTMLInputElement).value).toBe('');
    expect(
      within(screen.getByLabelText('確認フィルタ'))
        .getByRole('button', { name: /^読込済み4$/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      within(screen.getByLabelText('タイムライン種別フィルタ'))
        .getByRole('button', { name: /^すべて4$/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      category: null,
      date_from: null,
      date_to: null,
    });
    await waitFor(() => {
      expect(screen.getAllByText('訪問記録を登録').length).toBeGreaterThan(0);
      expect(screen.getAllByText('管理計画書を承認').length).toBeGreaterThan(0);
    });
  });

  it('filters unprocessed inbound events and updates the selected-event preview', () => {
    render(
      <PatientMovementTimeline
        timelineEvents={[inboundTimelineEvent, ...timelineEvents]}
        selfReports={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /未処理/ }));

    expect(screen.getAllByText('訪問看護師から残数報告を受信').length).toBeGreaterThan(0);
    expect(screen.queryByText('訪問記録を登録')).toBeNull();
    expect(screen.queryByText('調剤を記録')).toBeNull();

    const previewButton = screen.getByRole('button', {
      name: '訪問看護師から残数報告を受信の証跡を確認',
    });
    fireEvent.click(previewButton);
    expect(previewButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByText('MCS受信').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /受信情報を開く/ }).length).toBeGreaterThan(0);
    expect(screen.getByText('読込済み 5 件中 1 件表示')).toBeTruthy();
    expect(screen.queryByText(/表示 1 \/ 全 5 件/)).toBeNull();
  });

  it('styles categories and event types with chart series tokens, not bespoke palette colors', () => {
    render(<PatientMovementTimeline timelineEvents={timelineEvents} selfReports={selfReports} />);

    // Category filter chip resolves to a --chart-* series utility once active.
    const visitButton = screen.getByRole('button', { name: /^訪問1$/ });
    fireEvent.click(visitButton);
    expect(visitButton.className).toContain('chart-1');
    expect(visitButton.className).not.toMatch(/sky-|emerald-|violet-|amber-|slate-|rose-|cyan-/);

    // Event-type badge uses the same chart series idiom (kind-of-event series).
    const eventBadge = screen.getAllByText('訪問記録')[0];
    expect(eventBadge.className).toContain('chart-1');
    expect(eventBadge.className).not.toMatch(/sky-|emerald-|violet-|amber-|slate-|rose-|cyan-/);
  });

  it('styles home-operation focus badges with chart series tokens', () => {
    render(<PatientMovementTimeline timelineEvents={[mcsTimelineEvent]} selfReports={[]} />);

    const focusBadge = screen.getAllByText('MCS')[0];
    expect(focusBadge.className).toContain('chart-4');
    expect(focusBadge.className).not.toMatch(/sky-|emerald-|violet-|amber-|slate-|rose-|cyan-/);
  });

  it('shows a recent-activity (not full history) completeness note', () => {
    render(
      <PatientMovementTimeline
        timelineEvents={timelineEvents}
        selfReports={selfReports}
        isPartial
      />,
    );

    const note = screen.getByTestId('timeline-completeness-note');
    expect(note.textContent).toContain('直近');
  });

  it('filters the timeline by category', () => {
    render(<PatientMovementTimeline timelineEvents={timelineEvents} selfReports={selfReports} />);

    fireEvent.click(screen.getByRole('button', { name: /^訪問1$/ }));

    expect(screen.getAllByText('訪問記録を登録').length).toBeGreaterThan(0);
    expect(screen.queryByText('管理計画書を承認')).toBeNull();
    expect(screen.queryByText('調剤を記録')).toBeNull();
  });

  it('filters billing and collection events separately from documents', () => {
    render(<PatientMovementTimeline timelineEvents={timelineEvents} selfReports={selfReports} />);

    fireEvent.click(screen.getByRole('button', { name: /^請求・集金1$/ }));

    expect(screen.getAllByText('算定候補を更新').length).toBeGreaterThan(0);
    expect(screen.queryByText('管理計画書を承認')).toBeNull();
    expect(screen.queryByText('調剤を記録')).toBeNull();
  });

  it('filters the timeline by search query', async () => {
    render(<PatientMovementTimeline timelineEvents={timelineEvents} selfReports={selfReports} />);

    fireEvent.change(screen.getByLabelText('タイムライン検索'), {
      target: { value: '計画書' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('管理計画書を承認').length).toBeGreaterThan(0);
      expect(screen.queryByText('訪問記録を登録')).toBeNull();
      expect(screen.queryByText('調剤を記録')).toBeNull();
    });
    expect(screen.getByText('読込済み絞込内最新')).toBeTruthy();
    expect(document.querySelector('[aria-current="time"]')).toBeNull();
    expect(document.getElementById('patient-activity-search-result')?.textContent).toContain(
      '1件が検索条件に一致',
    );
  });

  it('does not match occurrence-only prescription and visit raw summaries in search', async () => {
    render(<PatientMovementTimeline timelineEvents={timelineEvents} selfReports={selfReports} />);

    fireEvent.change(screen.getByLabelText('タイムライン検索'), {
      target: { value: 'アムロジピン' },
    });

    await waitFor(() => {
      expect(screen.queryByText('調剤を記録')).toBeNull();
      expect(screen.queryByText('訪問記録を登録')).toBeNull();
      expect(screen.queryByText('管理計画書を承認')).toBeNull();
    });

    fireEvent.change(screen.getByLabelText('タイムライン検索'), {
      target: { value: '処方登録' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('調剤を記録').length).toBeGreaterThan(0);
    });
  });

  it('does not render or search document body and attachment filenames for document markers', async () => {
    render(
      <PatientMovementTimeline
        timelineEvents={[
          {
            ...timelineEvents[1],
            summary: '重要事項説明本文 / patient-yamada-plan.pdf',
            metadata: ['patient-yamada-plan.pdf', 'OCR全文あり'],
          },
        ]}
        selfReports={[]}
      />,
    );

    const renderedText = document.body.textContent ?? '';
    expect(screen.getAllByText('管理計画書を承認').length).toBeGreaterThan(0);
    expect(renderedText).not.toContain('重要事項説明本文');
    expect(renderedText).not.toContain('patient-yamada-plan.pdf');
    expect(renderedText).not.toContain('OCR全文あり');

    fireEvent.change(screen.getByLabelText('タイムライン検索'), {
      target: { value: 'patient-yamada-plan.pdf' },
    });

    await waitFor(() => {
      expect(screen.queryByText('管理計画書を承認')).toBeNull();
    });
  });

  it('keeps prescription, visit, and document markers as occurrence-only canonical links', () => {
    render(
      <PatientMovementTimeline
        timelineEvents={[
          {
            ...timelineEvents[0],
            id: 'event_visit_detail_guard',
            summary: 'SOAP本文: 血圧と痛みの観察内容 / voice-note-yamada.m4a',
            metadata: ['位置情報 33.0,130.0', 'visit-photo-yamada.jpg'],
            href: '/visits/visit_1/record',
            action_label: '訪問記録を開く',
          },
          {
            ...timelineEvents[1],
            id: 'event_document_detail_guard',
            summary: '文書本文: 重要事項説明 / OCR全文 / signed-url',
            metadata: ['document-yamada.pdf', 'storage_key=private/doc.pdf'],
            href: '/patients/patient_1#patient-documents',
            action_label: '文書を開く',
          },
          {
            ...timelineEvents[2],
            id: 'event_prescription_detail_guard',
            summary: '処方内容: アムロジピン 30錠 / 用法用量 / file_id=file_1',
            metadata: ['薬剤明細 アムロジピン', '処方箋OCR全文'],
            href: '/prescriptions/intake_1',
            action_label: '処方記録を開く',
          },
        ]}
        selfReports={[]}
      />,
    );

    for (const [title, action, href] of [
      ['訪問記録を登録', '訪問記録を開く', '/visits/visit_1/record'],
      ['管理計画書を承認', '文書を開く', '/patients/patient_1#patient-documents'],
      ['調剤を記録', '処方記録を開く', '/prescriptions/intake_1'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: `${title}の証跡を確認` }));
      expect(
        screen
          .getByRole('link', {
            name: `選択中イベントの詳細を開く: ${action}`,
          })
          .getAttribute('href'),
      ).toBe(href);
    }

    const hrefs = Array.from(document.querySelectorAll('a')).map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).not.toContain('/patients/patient_1/timeline/event_visit_detail_guard');
    expect(hrefs).not.toContain('/patients/patient_1/timeline/event_document_detail_guard');
    expect(hrefs).not.toContain('/patients/patient_1/timeline/event_prescription_detail_guard');

    const renderedText = document.body.textContent ?? '';
    for (const forbidden of [
      'SOAP本文',
      'voice-note-yamada.m4a',
      'visit-photo-yamada.jpg',
      '33.0,130.0',
      '文書本文',
      'OCR全文',
      'document-yamada.pdf',
      'storage_key',
      '処方内容',
      'アムロジピン 30錠',
      '用法用量',
      'file_id=file_1',
      '薬剤明細',
      '処方箋OCR全文',
    ]) {
      expect(renderedText).not.toContain(forbidden);
    }
  });

  it('does not render unsafe movement hrefs as links', () => {
    render(
      <PatientMovementTimeline
        timelineEvents={[
          {
            ...inboundTimelineEvent,
            id: 'event_external_href',
            title: '外部URLを含む受信候補',
            href: 'https://example.invalid/signed-url',
            action_label: '外部URLを開く',
          },
          {
            ...inboundTimelineEvent,
            id: 'event_protocol_relative_href',
            title: 'protocol-relative URLを含む受信候補',
            href: '//example.invalid/file',
            action_label: '外部ファイルを開く',
          },
          {
            ...inboundTimelineEvent,
            id: 'event_api_root_href',
            title: 'API rootを含む受信候補',
            href: '/api',
            action_label: 'API rootを開く',
          },
          {
            ...inboundTimelineEvent,
            id: 'event_api_query_href',
            title: 'API queryを含む受信候補',
            href: '/api?patient_id=patient_1',
            action_label: 'API queryを開く',
          },
          {
            ...inboundTimelineEvent,
            id: 'event_api_href',
            title: 'API pathを含む受信候補',
            href: '/api/patients/patient_1/movement-timeline',
            action_label: 'APIを開く',
          },
          {
            ...inboundTimelineEvent,
            id: 'event_legacy_list_href',
            title: '旧timeline一覧を含む受信候補',
            href: '/patients/patient_1/timeline',
            action_label: '旧timelineを開く',
          },
          {
            ...inboundTimelineEvent,
            id: 'event_legacy_detail_href',
            title: '旧timeline詳細を含む受信候補',
            href: '/patients/patient_1/timeline/visit_record:visit_1?raw=1',
            action_label: '旧timeline詳細を開く',
          },
          {
            ...inboundTimelineEvent,
            id: 'event_script_href',
            title: 'script URLを含む受信候補',
            href: 'javascript:alert(1)',
            action_label: 'scriptを開く',
          },
        ]}
        selfReports={[]}
      />,
    );

    const hrefs = Array.from(document.querySelectorAll('a')).map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).not.toContain('https://example.invalid/signed-url');
    expect(hrefs).not.toContain('//example.invalid/file');
    expect(hrefs).not.toContain('/api');
    expect(hrefs).not.toContain('/api?patient_id=patient_1');
    expect(hrefs).not.toContain('/api/patients/patient_1/movement-timeline');
    expect(hrefs).not.toContain('/patients/patient_1/timeline');
    expect(hrefs).not.toContain('/patients/patient_1/timeline/visit_record:visit_1?raw=1');
    expect(hrefs).not.toContain('javascript:alert(1)');
    expect(screen.getAllByText('詳細導線未設定').length).toBeGreaterThan(0);
  });

  it('renders fallback patient-movement anchors without synthesizing the legacy timeline shell', () => {
    render(
      <PatientMovementTimeline
        timelineEvents={[
          {
            ...timelineEvents[0],
            id: 'visit_record:visit_1',
            href: '/patients/patient_1#patient-movement',
            action_label: '患者の動きを開く',
          },
        ]}
        selfReports={[]}
      />,
    );

    expect(
      screen
        .getAllByRole('link', { name: /患者の動きを開く/ })
        .some((link) => link.getAttribute('href') === '/patients/patient_1#patient-movement'),
    ).toBe(true);
    const hrefs = Array.from(document.querySelectorAll('a')).map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs.some((href) => href?.includes('/patients/patient_1/timeline'))).toBe(false);
  });

  it('renders self report events in the main communication timeline', () => {
    render(
      <PatientMovementTimeline
        timelineEvents={[selfReportTimelineEvent, ...timelineEvents]}
        selfReports={[]}
      />,
    );

    expect(screen.getAllByText('患者から自己申告を受信').length).toBeGreaterThan(0);
    expect(screen.getAllByText('自己申告').length).toBeGreaterThan(0);
    expect(screen.getAllByText('未対応').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/家族A/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('関係 家族').length).toBeGreaterThan(0);
    expect(screen.getAllByText('折返し希望').length).toBeGreaterThan(0);
    expect(screen.getAllByText('希望時間 18時以降').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '患者から自己申告を受信の証跡を確認' }));
    expect(
      screen
        .getAllByRole('link', { name: /連携を確認/ })
        .some((link) => link.getAttribute('href') === '/patients/patient_1/collaboration'),
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^共有・連絡1$/ }));

    expect(screen.getAllByText('患者から自己申告を受信').length).toBeGreaterThan(0);
    expect(screen.queryByText('訪問記録を登録')).toBeNull();
  });

  it('marks MCS and conference history inside the communication category', async () => {
    render(
      <PatientMovementTimeline
        timelineEvents={[mcsTimelineEvent, conferenceTimelineEvent, ...timelineEvents]}
        selfReports={[]}
      />,
    );

    expect(screen.getAllByText('MCS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('カンファレンス').length).toBeGreaterThan(0);
    expect(screen.getByText('MCS・外部連携')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('タイムライン検索'), {
      target: { value: '外部連携' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('MCS確認ログを登録').length).toBeGreaterThan(0);
      expect(screen.queryByText('退院前カンファレンスを記録')).toBeNull();
    });

    fireEvent.change(screen.getByLabelText('タイムライン検索'), {
      target: { value: 'カンファレンス' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('退院前カンファレンスを記録').length).toBeGreaterThan(0);
      expect(screen.queryByText('MCS確認ログを登録')).toBeNull();
    });
  });
});
