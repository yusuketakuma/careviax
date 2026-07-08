import { notFound } from 'next/navigation';
import { PatientMovementTimeline } from '../[id]/patient-movement-timeline';

const fixtureTimelineEvents = [
  {
    id: 'fixture_visit_record',
    event_type: 'visit_record' as const,
    category: 'visit' as const,
    occurred_at: '2026-04-03T12:30:00.000Z',
    title: '訪問記録を登録',
    summary: '訪問予定または訪問記録が登録されました。',
    href: '/visits/fixture_visit_record/record',
    action_label: '訪問記録を開く',
    status: 'completed',
    status_label: '完了',
    actor_name: '薬剤師A',
    metadata: ['次回提案 2026/04/10'],
  },
  {
    id: 'fixture_inbound_signal',
    event_type: 'inbound_mcs' as const,
    category: 'interprofessional' as const,
    occurred_at: '2026-04-03T08:00:00.000Z',
    title: '訪問看護師から残数報告を受信',
    summary: '外部連携から確認待ちの更新を受信しました。',
    href: '/communications/inbound?status=needs_review',
    action_label: '受信情報を開く',
    status: 'needs_review',
    status_label: '確認待ち',
    actor_name: '訪問看護師A',
    metadata: ['MCS', '残数関連'],
  },
  {
    id: 'fixture_document',
    event_type: 'management_plan' as const,
    category: 'document' as const,
    occurred_at: '2026-04-02T13:00:00.000Z',
    title: '管理計画書を承認',
    summary: '管理計画書が登録されました。',
    href: '/patients/fixture_patient#patient-documents',
    action_label: '文書を開く',
    status: 'approved',
    status_label: '承認済み',
    actor_name: '薬剤師B',
    metadata: [],
  },
  {
    id: 'fixture_unsafe_legacy',
    event_type: 'communication' as const,
    category: 'interprofessional' as const,
    occurred_at: '2026-04-02T09:00:00.000Z',
    title: '旧詳細導線を含む受信候補',
    summary: '旧導線は current movement surface ではリンク化しません。',
    href: '/patients/fixture_patient/timeline/fixture_unsafe_legacy',
    action_label: '旧詳細を開く',
    status: 'needs_review',
    status_label: '確認待ち',
    actor_name: '連携先',
    metadata: ['legacy href guard'],
  },
];

export default function PatientMovementFixturePage() {
  if (process.env.PLAYWRIGHT !== '1' && process.env.PLAYWRIGHT_REUSE_SERVER !== '1') {
    notFound();
  }

  return (
    <div className="space-y-4" data-testid="patient-movement-fixture">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Patient Movement Browser Fixture</h1>
        <p className="text-sm text-muted-foreground">
          Current movement timeline browser, mobile, and accessibility validation fixture.
        </p>
      </div>
      <PatientMovementTimeline timelineEvents={fixtureTimelineEvents} selfReports={[]} />
    </div>
  );
}
