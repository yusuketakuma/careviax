import { describe, expect, it } from 'vitest';
import { createPrescriptionIntakeSchema, updatePrescriptionIntakeSchema } from './prescription';

const validIntake = {
  case_id: 'case_1',
  patient_id: 'patient_1',
  source_type: 'qr_scan',
  prescribed_date: '2026-04-01',
  lines: [
    {
      line_number: 1,
      drug_name: 'アムロジピン錠5mg',
      dose: '1錠',
      frequency: '1日1回朝食後',
      days: 14,
    },
  ],
};

describe('createPrescriptionIntakeSchema', () => {
  it('rejects invalid calendar dates', () => {
    const result = createPrescriptionIntakeSchema.safeParse({
      ...validIntake,
      prescribed_date: '2026-02-30',
    });

    expect(result.success).toBe(false);
  });

  it('rejects prescription lines whose end date is before start date', () => {
    const result = createPrescriptionIntakeSchema.safeParse({
      ...validIntake,
      lines: [
        {
          ...validIntake.lines[0],
          start_date: '2026-04-10',
          end_date: '2026-04-01',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('accepts relative, HTTPS, and local development original document URLs', () => {
    for (const original_document_url of [
      '/uploads/prescriptions/original.pdf',
      'https://storage.example.com/original.pdf',
      'http://localhost:3000/uploads/original.pdf',
    ]) {
      expect(
        createPrescriptionIntakeSchema.safeParse({
          ...validIntake,
          original_document_url,
        }).success,
      ).toBe(true);
      expect(
        updatePrescriptionIntakeSchema.safeParse({
          original_document_url,
        }).success,
      ).toBe(true);
    }
  });

  it('rejects non-local HTTP and protocol-relative original document URLs', () => {
    for (const original_document_url of [
      'http://storage.example.com/original.pdf',
      '//storage.example.com/original.pdf',
    ]) {
      expect(
        createPrescriptionIntakeSchema.safeParse({
          ...validIntake,
          original_document_url,
        }).success,
      ).toBe(false);
      expect(
        updatePrescriptionIntakeSchema.safeParse({
          original_document_url,
        }).success,
      ).toBe(false);
    }
  });
});

describe('updatePrescriptionIntakeSchema', () => {
  it('rejects completed original management without a storage location', () => {
    const result = updatePrescriptionIntakeSchema.safeParse({
      original_management: {
        reconciliation_result: 'matched',
        storage_location: 'not_stored',
        e_prescription_acquired_status: 'not_applicable',
        dispensing_result_registration: 'registered',
      },
    });

    expect(result.success).toBe(false);
  });

  it('allows not-stored original management while reconciliation and result registration are pending', () => {
    const result = updatePrescriptionIntakeSchema.safeParse({
      original_management: {
        reconciliation_result: 'not_checked',
        storage_location: 'not_stored',
        e_prescription_acquired_status: 'not_applicable',
        dispensing_result_registration: 'pending',
      },
    });

    expect(result.success).toBe(true);
  });
});
