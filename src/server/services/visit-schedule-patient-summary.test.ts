import { describe, expect, it } from 'vitest';
import { attachVisitSchedulePatientSummary } from './visit-schedule-patient-summary';

describe('attachVisitSchedulePatientSummary', () => {
  it('attaches a compact patient summary and strips raw source fields', () => {
    const enriched = attachVisitSchedulePatientSummary({
      id: 'schedule_1',
      case_: {
        patient: {
          id: 'patient_1',
          name: '患者A',
          residences: [],
          archived_at: new Date('2026-06-30T09:00:00.000Z'),
          allergy_info: [{ substance: 'ペニシリン' }],
          insurances: [
            {
              insurance_type: 'medical',
              application_status: 'confirmed',
              copay_ratio: 30,
              is_active: true,
              valid_from: new Date('2026-06-01T00:00:00.000Z'),
              valid_until: new Date('2026-07-31T00:00:00.000Z'),
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
      },
    });

    expect(enriched.patient_summary).toMatchObject({
      patient_id: 'patient_1',
      name: '患者A',
      archive: { status: 'archived', archived: true },
      insurance: { current_count: 1, missing: false },
      safety: { has_allergy: true, critical_lab_count: 1 },
    });
    expect(enriched.case_.patient).toMatchObject({
      id: 'patient_1',
      name: '患者A',
      residences: [],
    });
    expect(enriched.case_.patient).not.toHaveProperty('archived_at');
    expect(enriched.case_.patient).not.toHaveProperty('allergy_info');
    expect(enriched.case_.patient).not.toHaveProperty('insurances');
    expect(enriched.case_.patient).not.toHaveProperty('lab_observations');
    expect(JSON.stringify(enriched)).not.toMatch(/raw-insurer|raw-number|insurer_number/);
  });

  it('strips raw source fields even when the patient shape cannot build a summary', () => {
    const enriched = attachVisitSchedulePatientSummary({
      id: 'schedule_missing_patient_identity',
      case_: {
        patient: {
          residences: [],
          archived_at: new Date('2026-06-30T09:00:00.000Z'),
          allergy_info: [{ substance: 'ペニシリン詳細' }],
          insurances: [{ number: 'raw-number' }],
          lab_observations: [{ note: 'raw-lab-note' }],
        },
      },
    });

    expect(enriched.patient_summary).toBeNull();
    expect(enriched.case_.patient).toEqual({ residences: [] });
    expect(JSON.stringify(enriched)).not.toMatch(
      /archived_at|allergy_info|insurances|lab_observations|raw-number|raw-lab-note/,
    );
  });
});
