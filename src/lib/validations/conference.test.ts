import { describe, expect, it } from 'vitest';
import { buildConferenceMetadata, createConferenceNoteSchema } from './conference';

describe('conference validation metadata', () => {
  it('preserves patient-detail conference operation metadata', () => {
    const parsed = createConferenceNoteSchema.safeParse({
      patient_id: 'patient_1',
      note_type: 'service_manager',
      conference_type: 'service_manager',
      title: '田中 一郎様 サービス担当者会議',
      content: '訪問頻度と報告先を確認した',
      conference_date: '2026-06-16T09:00:00.000Z',
      participants: [],
      metadata: {
        visit_brief: { patient_id: 'patient_1' },
        conference_operation: {
          format: 'mcs',
          organizer: 'visiting_nurse',
          report_type: 'nurse_share',
        },
      },
      action_items: [{ title: '訪看へ共有', assignee: '薬剤師' }],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(buildConferenceMetadata('service_manager', parsed.data.metadata)).toMatchObject({
      billing: expect.objectContaining({
        link_status: 'candidate',
        code: 'MED_INFO_PROVISION_2_HA',
      }),
      visit_brief: { patient_id: 'patient_1' },
      conference_operation: {
        format: 'mcs',
        organizer: 'visiting_nurse',
        report_type: 'nurse_share',
      },
    });
  });

  it('rejects unsupported conference operation metadata values', () => {
    const parsed = createConferenceNoteSchema.safeParse({
      patient_id: 'patient_1',
      note_type: 'service_manager',
      conference_type: 'service_manager',
      title: '田中 一郎様 サービス担当者会議',
      content: '訪問頻度と報告先を確認した',
      conference_date: '2026-06-16T09:00:00.000Z',
      participants: [],
      metadata: {
        conference_operation: {
          format: 'iframe',
          report_type: 'public_url',
        },
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('requires action items and report purpose for patient-detail conference operations', () => {
    const parsed = createConferenceNoteSchema.safeParse({
      patient_id: 'patient_1',
      note_type: 'service_manager',
      conference_type: 'service_manager',
      title: '田中 一郎様 サービス担当者会議',
      content: '訪問頻度と報告先を確認した',
      conference_date: '2026-06-16T09:00:00.000Z',
      participants: [],
      metadata: {
        conference_operation: {
          format: 'mcs',
          organizer: 'visiting_nurse',
        },
      },
      action_items: [],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['metadata', 'conference_operation', 'report_type'],
          message: '会議後の報告書用途を指定してください',
        }),
        expect.objectContaining({
          path: ['action_items'],
          message: '会議後の薬局タスクを1件以上入力してください',
        }),
      ]),
    );
  });

  it('requires a target discharge date for patient-detail pre-discharge operations', () => {
    const parsed = createConferenceNoteSchema.safeParse({
      patient_id: 'patient_1',
      note_type: 'pre_discharge',
      conference_type: 'pre_discharge',
      title: '田中 一郎様 退院前カンファレンス',
      content: '退院後の服薬支援を確認した',
      conference_date: '2026-06-16T09:00:00.000Z',
      participants: [],
      structured_content: {
        template: 'pre_discharge',
        sections: [{ key: 'discharge_background', label: '退院背景', body: '在宅復帰予定' }],
      },
      metadata: {
        conference_operation: {
          format: 'web',
          organizer: 'hospital',
          report_type: 'physician_report',
        },
      },
      action_items: [{ title: '初回訪問予定を確認', assignee: '薬剤師' }],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['structured_content', 'sections'],
          message: '退院前カンファレンスでは退院予定日を入力してください',
        }),
      ]),
    );
  });
});
