import { NextRequest } from 'next/server';

const CONFERENCE_NOTE_URL = 'http://localhost/api/conference-notes/note_1';

export function createConferenceNoteGetRequest() {
  return new NextRequest(CONFERENCE_NOTE_URL, { method: 'GET' });
}

export function createConferenceNotePatchRequest(body?: unknown) {
  return new NextRequest(CONFERENCE_NOTE_URL, {
    method: 'PATCH',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export const unavailableCaseResponse = {
  code: 'VALIDATION_ERROR',
  message: '入力値が不正です',
  details: {
    case_id: ['指定されたケースを確認できません'],
  },
};

export function buildConferenceNote(participantRole: string) {
  return {
    id: 'note_1',
    case_id: 'case_1',
    patient_id: 'patient_1',
    facility_id: 'facility_1',
    note_type: 'service_manager',
    title: '担当者会議',
    content: '会議目的: 訪問頻度の見直し',
    structured_content: {
      template: 'service_manager',
      sections: [{ key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' }],
    },
    metadata: {
      generated_report_id: 'report_prev',
      legacy_note: 'preserve me',
      sync_summary: {
        report_draft_ids: ['report_prev'],
      },
    },
    billing_eligible: true,
    billing_code: 'MED_INFO_PROVISION_2_HA',
    follow_up_date: new Date('2026-04-15T00:00:00.000Z'),
    follow_up_completed: false,
    generated_report_id: 'report_prev',
    participants: [{ name: '佐藤CM', role: participantRole, legacy_debug: undefined }],
    conference_date: new Date('2026-03-30T10:00:00.000Z'),
    action_items: [{ title: 'サービス調整を反映', assignee: '薬剤師', legacy_debug: undefined }],
  };
}

export function buildUpdatedConferenceNote(participantRole: string, metadata?: unknown) {
  return {
    id: 'note_1',
    case_id: 'case_1',
    patient_id: 'patient_1',
    facility_id: 'facility_1',
    note_type: 'service_manager',
    title: '担当者会議（更新）',
    content: '会議目的: 訪問頻度の見直し\nサービス調整: 月2回から月4回へ変更',
    structured_content: {
      template: 'service_manager',
      sections: [
        { key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' },
        { key: 'care_plan_changes', label: 'ケアプラン変更点', body: '服薬支援を強化' },
        { key: 'service_adjustments', label: 'サービス調整', body: '月2回から月4回へ変更' },
      ],
    },
    metadata: metadata ?? {
      billing: {
        link_status: 'candidate',
        code: 'MED_INFO_PROVISION_2_HA',
        label: '服薬情報等提供料2 ハ',
        points: 20,
      },
      sync_summary: {
        report_draft_ids: ['report_prev'],
      },
    },
    billing_eligible: true,
    billing_code: 'MED_INFO_PROVISION_2_HA',
    follow_up_date: new Date('2026-04-15T00:00:00.000Z'),
    follow_up_completed: false,
    generated_report_id: 'report_prev',
    participants: [{ name: '佐藤CM', role: participantRole, attended: true }],
    conference_date: new Date('2026-03-30T10:00:00.000Z'),
    action_items: [{ title: 'サービス調整を反映', assignee: '薬剤師' }],
  };
}

export function buildConferenceCareCase() {
  return {
    id: 'case_1',
    patient_id: 'patient_1',
    primary_pharmacist_id: 'pharm_1',
    required_visit_support: null,
  };
}

export function buildUpdatedConferenceCareCase() {
  return {
    id: 'case_1',
    required_visit_support: {
      conference_sync: {
        service_manager: {
          care_plan_update: {
            summary: '服薬支援を強化',
          },
        },
      },
    },
  };
}

export function buildLatestConferenceVisitSchedule() {
  return {
    id: 'schedule_latest',
    cycle_id: 'cycle_1',
    site_id: 'site_1',
    visit_type: 'regular',
    priority: 'normal',
    scheduled_date: new Date('2026-03-25T00:00:00.000Z'),
    time_window_start: new Date('1970-01-01T09:00:00.000Z'),
    time_window_end: new Date('1970-01-01T10:00:00.000Z'),
    medication_end_date: null,
    visit_deadline_date: null,
    route_order: 1,
    recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
  };
}

export function buildConferenceFacility() {
  return {
    acceptance_time_from: new Date('1970-01-01T09:00:00.000Z'),
    acceptance_time_to: new Date('1970-01-01T17:00:00.000Z'),
  };
}

export async function findConferenceCareReports(args?: {
  where?: { report_type?: { in?: string[] } };
}) {
  if (args?.where?.report_type?.in?.length) {
    return [{ id: 'report_cm_1', report_type: args.where.report_type.in[0] }];
  }
  return [];
}
