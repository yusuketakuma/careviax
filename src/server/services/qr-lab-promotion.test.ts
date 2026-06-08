import { describe, expect, it, vi } from 'vitest';
import {
  buildQrLabObservationsFromMedicationIssue,
  extractQrLabCandidates,
  promoteResolvedQrLabIssueToPatientLabs,
} from './qr-lab-promotion';

describe('extractQrLabCandidates', () => {
  it('extracts supported QR lab values from clinical free text', () => {
    expect(
      extractQrLabCandidates(
        ['eGFR 42.5 mL/min/1.73m2', 'Cr: 1.24 mg/dL', 'K値 5.6', 'PT-INR=2.8'].join('\n'),
      ),
    ).toEqual([
      { analyte_code: 'egfr', value_numeric: 42.5, unit: 'mL/min/1.73m2', measured_at: null },
      { analyte_code: 'scr', value_numeric: 1.24, unit: 'mg/dL', measured_at: null },
      { analyte_code: 'k', value_numeric: 5.6, unit: 'mEq/L', measured_at: null },
      { analyte_code: 'pt_inr', value_numeric: 2.8, unit: null, measured_at: null },
    ]);
  });

  it('ignores QR boilerplate and implausible values', () => {
    expect(
      extractQrLabCandidates(
        [
          '[qr_supplemental:intake_1:601:8]',
          'QR補助レコード 601 から自動起票したレビュー候補です。',
          '確定情報として扱う前に薬剤師が確認してください。',
          'eGFR 999',
          'K 5.0',
        ].join('\n'),
      ),
    ).toEqual([{ analyte_code: 'k', value_numeric: 5, unit: 'mEq/L', measured_at: null }]);
  });

  it('uses an explicit measured date from the clinical line when present', () => {
    expect(extractQrLabCandidates('2026/06/01 eGFR 42', new Date('2026-06-08T12:00:00Z'))).toEqual([
      {
        analyte_code: 'egfr',
        value_numeric: 42,
        unit: 'mL/min/1.73m2',
        measured_at: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
  });

  it('skips uncertain, ambiguous, or unsupported-unit lines', () => {
    expect(
      extractQrLabCandidates(
        [
          '2026/06/01 前回PT-INR 2.8',
          '2026/06/01 K 3.2くらい',
          '2026/06/01 ビタミンK 4.0',
          '2026/06/01 Cr 80 umol/L',
        ].join('\n'),
        new Date('2026-06-08T12:00:00Z'),
      ),
    ).toEqual([]);
  });
});

describe('buildQrLabObservationsFromMedicationIssue', () => {
  it('builds import lab observations from a resolved QR lab issue', () => {
    const confirmedAt = new Date('2026-06-08T12:00:00.000Z');
    expect(
      buildQrLabObservationsFromMedicationIssue({
        confirmedAt,
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'other',
          title: 'QR由来の検査値・腎機能確認候補: 患者等記入事項',
          description:
            '[qr_supplemental:intake_1:601:8]\n2026/06/01 eGFR 42\n2026/06/01 Cr 1.2 mg/dL',
        },
      }),
    ).toEqual([
      {
        analyte_code: 'egfr',
        value_numeric: 42,
        unit: 'mL/min/1.73m2',
        measured_at: new Date('2026-06-01T00:00:00.000Z'),
        source_type: 'import',
        note: '[qr_supplemental:intake_1:601:8] medication_issue_id=issue_1 analyte=egfr',
      },
      {
        analyte_code: 'scr',
        value_numeric: 1.2,
        unit: 'mg/dL',
        measured_at: new Date('2026-06-01T00:00:00.000Z'),
        source_type: 'import',
        note: '[qr_supplemental:intake_1:601:8] medication_issue_id=issue_1 analyte=scr',
      },
    ]);
  });

  it('does not build observations from non-lab QR issues', () => {
    expect(
      buildQrLabObservationsFromMedicationIssue({
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'side_effect',
          title: 'QR由来のアレルギー・副作用歴確認候補',
          description: '[qr_supplemental:intake_1:601:7]\neGFR 42',
        },
      }),
    ).toEqual([]);
  });

  it('does not build observations when the measured date is missing', () => {
    expect(
      buildQrLabObservationsFromMedicationIssue({
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'other',
          title: 'QR由来の検査値・腎機能確認候補',
          description: '[qr_supplemental:intake_1:601:8]\neGFR 42',
        },
      }),
    ).toEqual([]);
  });
});

describe('promoteResolvedQrLabIssueToPatientLabs', () => {
  it('creates one lab observation per supported analyte', async () => {
    const patientLabObservationCreate = vi.fn().mockResolvedValue({});
    const result = await promoteResolvedQrLabIssueToPatientLabs(
      {
        patient: {
          findFirst: vi.fn().mockResolvedValue({ id: 'patient_1' }),
        },
        patientLabObservation: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: patientLabObservationCreate,
        },
      },
      {
        orgId: 'org_1',
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'other',
          title: 'QR由来の検査値・腎機能確認候補: 患者等記入事項',
          description:
            '[qr_supplemental:intake_1:601:8]\n2026/06/01 eGFR 42\n2026/06/01 PT-INR 2.8',
        },
      },
    );

    expect(result).toMatchObject({ promotedCount: 2 });
    expect(patientLabObservationCreate).toHaveBeenCalledTimes(2);
    expect(patientLabObservationCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        analyte_code: 'egfr',
        value_numeric: 42,
        source_type: 'import',
        note: '[qr_supplemental:intake_1:601:8] medication_issue_id=issue_1 analyte=egfr',
      }),
    });
    expect(patientLabObservationCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        analyte_code: 'pt_inr',
        value_numeric: 2.8,
      }),
    });
  });

  it('skips existing observations for the same QR marker and analyte', async () => {
    const patientLabObservationCreate = vi.fn().mockResolvedValue({});
    const result = await promoteResolvedQrLabIssueToPatientLabs(
      {
        patient: {
          findFirst: vi.fn().mockResolvedValue({ id: 'patient_1' }),
        },
        patientLabObservation: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: 'lab_1' }).mockResolvedValueOnce(null),
          create: patientLabObservationCreate,
        },
      },
      {
        orgId: 'org_1',
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'other',
          title: 'QR由来の検査値・腎機能確認候補: 患者等記入事項',
          description: '[qr_supplemental:intake_1:601:8]\n2026/06/01 eGFR 42\n2026/06/01 K 5.2',
        },
      },
    );

    expect(result).toMatchObject({ promotedCount: 1 });
    expect(patientLabObservationCreate).toHaveBeenCalledTimes(1);
    expect(patientLabObservationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        analyte_code: 'k',
        value_numeric: 5.2,
      }),
    });
  });
});
