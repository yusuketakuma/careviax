export type ConferenceNoteTestFixture = {
  id: string;
  note_type: string;
  title: string;
  content: string;
  participants: Array<{ name: string; role: string }>;
  conference_date: string;
  action_items: Array<{ title: string; assignee?: string; converted_task_id?: string }> | null;
  case_id: string | null;
  patient_id?: string | null;
  sync_summary?: {
    report_draft_ids?: string[];
    billing_candidate_id?: string | null;
    visit_proposal_id?: string | null;
    tasks_created?: number;
    medication_issues_created?: number;
  } | null;
  generated_report_id?: string | null;
  created_at: string;
};

export function buildConferenceNote(
  participantRole: string,
  overrides: Partial<ConferenceNoteTestFixture> = {},
): ConferenceNoteTestFixture {
  return {
    id: 'note_1',
    note_type: 'service_manager',
    title: '担当者会議',
    content: '会議目的: 訪問頻度の見直し',
    participants: [{ name: '佐藤CM', role: participantRole }],
    conference_date: '2026-03-30T10:00:00.000Z',
    action_items: [{ title: 'サービス調整を反映', assignee: '薬剤師' }],
    case_id: 'case_1',
    patient_id: 'patient_1',
    sync_summary: {
      report_draft_ids: ['report_1'],
      tasks_created: 1,
    },
    generated_report_id: null,
    created_at: '2026-03-30T11:00:00.000Z',
    ...overrides,
  };
}
