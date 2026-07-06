// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientMovementTimeline } from './patient-movement-timeline';

setupDomTestEnv();

const timelineEvents = [
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
];

const selfReports = [
  {
    id: 'self_report_1',
    subject: '夕方にふらつきあり',
    category: '体調変化',
    relation: '本人',
    status: 'submitted',
    reported_by_name: '山田花子',
    requested_callback: true,
    preferred_contact_time: '18:00以降',
    created_at: '2026-04-03T09:00:00.000Z',
    content: '立ち上がり時にふらつきがあり、折り返し連絡を希望しています。',
  },
];

const selfReportTimelineEvent = {
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
};

const mcsTimelineEvent = {
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
};

const conferenceTimelineEvent = {
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
};

describe('PatientMovementTimeline', () => {
  it('groups actions by day and renders patient-originated updates separately', () => {
    render(<PatientMovementTimeline timelineEvents={timelineEvents} selfReports={selfReports} />);

    for (const heading of ['患者の動き', 'タイムライン要約', '患者からの更新']) {
      expect(screen.getByRole('heading', { level: 2, name: heading }).tagName).toBe('H2');
    }
    expect(screen.getByText('2026年4月3日')).toBeTruthy();
    expect(screen.getByText('2026年4月2日')).toBeTruthy();
    expect(screen.getAllByText('訪問記録を登録').length).toBeGreaterThan(0);
    expect(screen.getAllByText('管理計画書を承認').length).toBeGreaterThan(0);
    expect(screen.getByText('夕方にふらつきあり')).toBeTruthy();
    expect(screen.getByText(/未対応/)).toBeTruthy();
    expect(screen.getByText('在宅運用履歴')).toBeTruthy();
    expect(screen.getByText('処方・訪問')).toBeTruthy();
    expect(screen.getByText('文書登録')).toBeTruthy();
    for (const label of [
      '契約・同意・書類',
      'MCS・外部連携',
      '処方せん管理',
      '請求・集金管理',
      'カンファレンス',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(
      screen.getByText('立ち上がり時にふらつきがあり、折り返し連絡を希望しています。'),
    ).toBeTruthy();
    expect(screen.queryByText('服薬状況は安定しています。')).toBeNull();
    expect(screen.queryByText('アムロジピン 30錠 / 持参')).toBeNull();
    expect(screen.queryByText('訪問薬剤管理指導計画書 / 次回見直し 2026/05/01')).toBeNull();
    expect(screen.getByRole('link', { name: /訪問記録を開く/ }).getAttribute('href')).toBe(
      '/visits/visit_1/record',
    );
    expect(screen.getByRole('link', { name: /処方記録を開く/ }).getAttribute('href')).toBe(
      '/prescriptions/intake_1',
    );
    expect(screen.getByRole('link', { name: /計画書を開く/ }).getAttribute('href')).toBe(
      '/patients/patient_1/management-plan',
    );
  });

  it('styles categories and event types with chart series tokens, not bespoke palette colors', () => {
    render(<PatientMovementTimeline timelineEvents={timelineEvents} selfReports={selfReports} />);

    // Category filter chip resolves to a --chart-* series utility once active.
    const visitButton = screen.getByRole('button', { name: /訪問/ });
    fireEvent.click(visitButton);
    expect(visitButton.className).toContain('chart-1');
    expect(visitButton.className).not.toMatch(/sky-|emerald-|violet-|amber-|slate-|rose-|cyan-/);

    // Event-type badge uses the same chart series idiom (kind-of-event series).
    const eventBadge = screen.getByText('訪問記録');
    expect(eventBadge.className).toContain('chart-1');
    expect(eventBadge.className).not.toMatch(/sky-|emerald-|violet-|amber-|slate-|rose-|cyan-/);
  });

  it('styles home-operation focus badges with chart series tokens', () => {
    render(<PatientMovementTimeline timelineEvents={[mcsTimelineEvent]} selfReports={[]} />);

    const focusBadge = screen.getByText('MCS');
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

    fireEvent.click(screen.getByRole('button', { name: /訪問/ }));

    expect(screen.getAllByText('訪問記録を登録').length).toBeGreaterThan(0);
    expect(screen.queryByText('管理計画書を承認')).toBeNull();
    expect(screen.queryByText('調剤を記録')).toBeNull();
  });

  it('filters billing and collection events separately from documents', () => {
    render(<PatientMovementTimeline timelineEvents={timelineEvents} selfReports={selfReports} />);

    fireEvent.click(screen.getByRole('button', { name: /請求・集金/ }));

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

  it('renders self report events in the main communication timeline', () => {
    render(
      <PatientMovementTimeline
        timelineEvents={[selfReportTimelineEvent, ...timelineEvents]}
        selfReports={[]}
      />,
    );

    expect(screen.getAllByText('患者から自己申告を受信').length).toBeGreaterThan(0);
    expect(screen.getByText('自己申告')).toBeTruthy();
    expect(screen.getByText('未対応')).toBeTruthy();
    expect(screen.getAllByText(/家族A/).length).toBeGreaterThan(0);
    expect(screen.getByText('関係 家族')).toBeTruthy();
    expect(screen.getByText('折返し希望')).toBeTruthy();
    expect(screen.getByText('希望時間 18時以降')).toBeTruthy();
    expect(screen.getByRole('link', { name: /連携を確認/ }).getAttribute('href')).toBe(
      '/patients/patient_1/collaboration',
    );

    fireEvent.click(screen.getByRole('button', { name: /共有・連絡/ }));

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
