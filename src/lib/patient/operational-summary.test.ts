import { describe, expect, it } from 'vitest';
import { buildPatientOperationalSummary, hasPatientAllergyInfo } from './operational-summary';

describe('patient operational summary', () => {
  it('builds a compact schedule-safe patient summary without raw insurance identifiers', () => {
    const summary = buildPatientOperationalSummary(
      {
        id: 'patient_1',
        name: '患者A',
        archived_at: new Date('2026-06-30T09:00:00.000Z'),
        allergy_info: [{ substance: 'ペニシリン' }],
        insurances: [
          {
            insurance_type: 'medical',
            application_status: 'confirmed',
            copay_ratio: 30,
            is_active: true,
            valid_from: new Date('2026-06-01T00:00:00.000Z'),
            valid_until: new Date('2026-06-30T00:00:00.000Z'),
            insurer_number: 'raw-insurer',
            number: 'raw-number',
          } as never,
        ],
        lab_observations: [
          {
            analyte_code: 'egfr',
            value_numeric: 38,
            value_text: null,
            unit: 'mL/min/1.73m2',
            measured_at: new Date('2026-06-10T00:00:00.000Z'),
            abnormal_flag: 'L',
          },
        ],
      },
      new Date('2026-06-15T00:00:00.000Z'),
    );

    expect(summary).toMatchObject({
      patient_id: 'patient_1',
      name: '患者A',
      archive: {
        status: 'archived',
        archived: true,
        archived_at: '2026-06-30T09:00:00.000Z',
      },
      insurance: {
        current_count: 1,
        missing: false,
        expires_soon_count: 1,
      },
      safety: {
        has_allergy: true,
        allergy_label: 'アレルギーあり',
        critical_lab_count: 1,
      },
    });
    expect(summary.safety.lab_flags[0]).toMatchObject({
      analyte_code: 'egfr',
      analyte_label: 'eGFR',
      value_label: '38 mL/min/1.73m2',
      abnormal: true,
    });
    expect(JSON.stringify(summary)).not.toMatch(/raw-insurer|raw-number|insurer_number/);
  });

  it('uses Japan business-day insurance boundaries and false-empty allergy handling', () => {
    const summary = buildPatientOperationalSummary(
      {
        id: 'patient_1',
        name: '患者A',
        allergy_info: 'なし',
        insurances: [
          {
            insurance_type: 'care',
            application_status: 'confirmed',
            copay_ratio: null,
            is_active: true,
            valid_from: new Date('2026-07-01T00:00:00.000Z'),
            valid_until: new Date('2026-07-01T00:00:00.000Z'),
          },
        ],
        lab_observations: [],
      },
      new Date('2026-06-30T16:00:00.000Z'),
    );

    expect(summary.insurance.current_count).toBe(1);
    expect(summary.insurance.missing).toBe(false);
    expect(summary.safety.has_allergy).toBe(false);
    expect(hasPatientAllergyInfo('none')).toBe(false);
  });
});
