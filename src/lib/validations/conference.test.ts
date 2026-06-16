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
});
