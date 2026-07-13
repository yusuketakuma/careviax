import { describe, expect, it } from 'vitest';

import {
  buildConferenceNoteDetailResponseSchema,
  communityActivityCreateResponseSchema,
  conferenceExternalProfessionalsResponseSchema,
  convertConferenceActionItemResponseSchema,
  generateConferenceReportResponseSchema,
  prescriberInstitutionSuggestionResponseSchema,
} from './conference-response-schemas';

const at = '2026-07-13T00:00:00.000Z';

describe('conference response schemas', () => {
  it('binds a full conference detail to the requested note', () => {
    const schema = buildConferenceNoteDetailResponseSchema('note_1');
    const payload = {
      data: {
        id: 'note_1',
        note_type: 'regular',
        title: '定例会議',
        content: '会議内容',
        participants: [{ name: '医師A', role: 'physician', attended: true }],
        conference_date: at,
        action_items: [{ title: '確認', converted_task_id: 'task_1', converted_at: at }],
        case_id: 'case_1',
        patient_id: 'patient_1',
        sync_summary: null,
        generated_report_id: null,
        created_at: at,
      },
    };
    expect(schema.safeParse(payload).success).toBe(true);
    expect(
      schema.safeParse({ ...payload, data: { ...payload.data, id: 'note_other' } }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...payload,
        data: {
          ...payload.data,
          action_items: [{ title: '確認', converted_task_id: 'task_1' }],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate external professionals and malformed institution suggestions', () => {
    const professional = {
      id: 'professional_1',
      profession_type: 'physician',
      name: '医師A',
      organization_name: '病院A',
      department: null,
      phone: null,
      email: null,
      fax: null,
    };
    expect(
      conferenceExternalProfessionalsResponseSchema.safeParse({
        data: [professional, professional],
      }).success,
    ).toBe(false);
    expect(
      prescriberInstitutionSuggestionResponseSchema.safeParse({
        data: {
          id: 'institution_1',
          name: '病院A',
          phone: null,
          fax: null,
          address: null,
          prescribed_date: 'invalid',
          prescriber_name: null,
        },
      }).success,
    ).toBe(false);
  });

  it('validates activity, task conversion, and report generation outcomes', () => {
    expect(
      communityActivityCreateResponseSchema.safeParse({
        data: {
          id: 'activity_1',
          activity_type: 'lecture',
          title: '地域講座',
          description: null,
          partner_name: null,
          activity_date: at,
          target_population: null,
          attendee_count: 10,
          referrals_generated: 1,
          follow_up_required: false,
          outcome_summary: null,
          created_at: at,
        },
      }).success,
    ).toBe(true);
    expect(
      convertConferenceActionItemResponseSchema.safeParse({ data: { task_id: '' } }).success,
    ).toBe(false);
    expect(
      generateConferenceReportResponseSchema.safeParse({
        data: { report_draft_count: 1, queued_recipient_count: 2 },
      }).success,
    ).toBe(false);
  });
});
