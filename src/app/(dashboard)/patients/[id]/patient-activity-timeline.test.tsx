// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientActivityTimeline } from './patient-activity-timeline';

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
    action_label: '調剤詳細を開く',
    status: 'dispensed',
    status_label: '調剤済',
    actor_name: '薬剤師C',
    metadata: [],
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
  },
];

describe('PatientActivityTimeline', () => {
  it('groups actions by day and renders patient-originated updates separately', () => {
    render(
      <PatientActivityTimeline
        timelineEvents={timelineEvents}
        selfReports={selfReports}
      />
    );

    expect(screen.getByText('2026年4月3日')).toBeTruthy();
    expect(screen.getByText('2026年4月2日')).toBeTruthy();
    expect(screen.getAllByText('訪問記録を登録').length).toBeGreaterThan(0);
    expect(screen.getAllByText('管理計画書を承認').length).toBeGreaterThan(0);
    expect(screen.getByText('夕方にふらつきあり')).toBeTruthy();
  });

  it('filters the timeline by category', () => {
    render(
      <PatientActivityTimeline
        timelineEvents={timelineEvents}
        selfReports={selfReports}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /訪問/ }));

    expect(screen.getAllByText('訪問記録を登録').length).toBeGreaterThan(0);
    expect(screen.queryByText('管理計画書を承認')).toBeNull();
    expect(screen.queryByText('調剤を記録')).toBeNull();
  });

  it('filters the timeline by search query', async () => {
    render(
      <PatientActivityTimeline
        timelineEvents={timelineEvents}
        selfReports={selfReports}
      />
    );

    fireEvent.change(screen.getByLabelText('タイムライン検索'), {
      target: { value: '計画書' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('管理計画書を承認').length).toBeGreaterThan(0);
      expect(screen.queryByText('訪問記録を登録')).toBeNull();
      expect(screen.queryByText('調剤を記録')).toBeNull();
    });
  });
});
