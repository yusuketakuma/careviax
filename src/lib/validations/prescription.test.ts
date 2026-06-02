import { describe, expect, it } from 'vitest';
import { createPrescriptionIntakeSchema } from './prescription';

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
});
