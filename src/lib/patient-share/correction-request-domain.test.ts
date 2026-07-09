import { describe, expect, it } from 'vitest';
import {
  correctionRequestFieldPathSchema,
  correctionTargetTypeSchema,
  isPatientShareCorrectionFieldPath,
  patientShareCorrectionRequestPageSchema,
  patientShareCorrectionRequestRowSchema,
  patientShareCorrectionFieldPaths,
  toPatientShareCorrectionRequestRow,
} from './correction-request-domain';

describe('correction-request-domain', () => {
  it('validates correction target types shared by workflow UI and API route', () => {
    expect(correctionTargetTypeSchema.parse('partner_visit_record')).toBe('partner_visit_record');
    expect(correctionTargetTypeSchema.safeParse('unknown_target').success).toBe(false);
  });

  it('shares allowed correction field paths by target type', () => {
    expect(isPatientShareCorrectionFieldPath('patient_profile', 'primary_residence.address')).toBe(
      true,
    );
    expect(isPatientShareCorrectionFieldPath('patient_profile', 'medical_insurance_number')).toBe(
      false,
    );
    expect(isPatientShareCorrectionFieldPath('partner_visit_record', 'record_content')).toBe(true);
    expect(patientShareCorrectionFieldPaths('claim_note')).toContain('claim_note_text');
  });

  it('keeps field path syntax suitable for route validation', () => {
    expect(correctionRequestFieldPathSchema.parse('primary_residence.address')).toBe(
      'primary_residence.address',
    );
    expect(correctionRequestFieldPathSchema.safeParse('patient name').success).toBe(false);
  });

  it('validates PHI-minimized correction request rows and cursor pages', () => {
    const row = {
      id: 'correction_1',
      share_case_id: 'share_case_1',
      target_owner: 'partner_pharmacy',
      target_type: 'partner_visit_record',
      target_id: 'partner_visit_record_1',
      field_path: 'record_content',
      request_type: 'correction',
      status: 'open',
      requested_by: 'user_1',
      responded_by: null,
      resolved_by: null,
      resolved_at: null,
      created_at: '2026-06-19T01:00:00.000Z',
      updated_at: '2026-06-19T01:00:00.000Z',
    };

    expect(patientShareCorrectionRequestRowSchema.safeParse(row).success).toBe(true);
    expect(
      patientShareCorrectionRequestPageSchema.safeParse({
        data: [row],
        meta: { has_more: false, next_cursor: null },
      }).success,
    ).toBe(true);
    const parsedWithReason = patientShareCorrectionRequestRowSchema.safeParse({
      ...row,
      reason: '患者名 山田花子',
    });
    expect(parsedWithReason.success).toBe(true);
    if (!parsedWithReason.success) throw new Error('expected row schema to parse');
    expect(parsedWithReason.data).not.toHaveProperty('reason');
  });

  it('serializes database dates while keeping route output target types fail-closed', () => {
    const row = {
      id: 'correction_1',
      share_case_id: 'share_case_1',
      target_owner: 'partner_pharmacy',
      target_type: 'partner_visit_record',
      target_id: 'partner_visit_record_1',
      field_path: 'record_content',
      request_type: 'correction',
      status: 'open',
      requested_by: 'user_1',
      responded_by: null,
      resolved_by: null,
      resolved_at: null,
      created_at: new Date('2026-06-19T01:00:00.000Z'),
      updated_at: new Date('2026-06-19T01:00:00.000Z'),
    };

    expect(toPatientShareCorrectionRequestRow(row)).toMatchObject({
      target_type: 'partner_visit_record',
      created_at: '2026-06-19T01:00:00.000Z',
      updated_at: '2026-06-19T01:00:00.000Z',
    });
    expect(() =>
      toPatientShareCorrectionRequestRow({ ...row, target_type: 'unexpected_target' }),
    ).toThrow();
  });
});
