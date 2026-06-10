import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildQrAllergyEntryFromMedicationIssue,
  extractQrAllergyDrugName,
  promoteResolvedQrAllergyIssueToPatient,
} from './qr-allergy-promotion';

const originalTimezone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'Asia/Tokyo';
});

afterAll(() => {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimezone;
  }
});

describe('extractQrAllergyDrugName', () => {
  it('extracts a drug name from QR allergy free text', () => {
    expect(extractQrAllergyDrugName('ペニシリンで発疹あり')).toBe('ペニシリン');
    expect(extractQrAllergyDrugName('薬剤名: セフェム系\n症状: じんましん')).toBe('セフェム系');
  });

  it('ignores QR boilerplate and non-drug placeholders', () => {
    expect(
      extractQrAllergyDrugName(
        [
          '[qr_supplemental:intake_1:601:7]',
          'QR補助レコード 601 から自動起票したレビュー候補です。',
          '確定情報として扱う前に薬剤師確認が必要です。',
          'ペニシリンで発疹あり',
        ].join('\n'),
      ),
    ).toBe('ペニシリン');
    expect(extractQrAllergyDrugName('薬剤名: なし\n症状: 発疹')).toBeNull();
    expect(extractQrAllergyDrugName('薬剤名: 不明\n症状: かゆみ')).toBeNull();
  });
});

describe('buildQrAllergyEntryFromMedicationIssue', () => {
  it('builds a patient allergy entry from a resolved QR allergy issue', () => {
    expect(
      buildQrAllergyEntryFromMedicationIssue({
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'side_effect',
          title: 'QR由来のアレルギー・副作用歴確認候補: 患者等記入事項',
          description: [
            '[qr_supplemental:intake_1:601:7]',
            'QR補助レコード 601 から自動起票したレビュー候補です。',
            'ペニシリンで発疹あり',
          ].join('\n'),
        },
      }),
    ).toEqual({
      drug_name: 'ペニシリン',
      category: 'drug',
      severity: 'unknown',
      confirmed_at: '2026-06-08',
      source: 'qr_supplemental:issue_1',
    });
  });

  it('formats confirmed_at by the local pharmacy calendar day', () => {
    expect(
      buildQrAllergyEntryFromMedicationIssue({
        confirmedAt: new Date('2026-06-08T15:30:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'side_effect',
          title: 'QR由来のアレルギー・副作用歴確認候補: 患者等記入事項',
          description: [
            '[qr_supplemental:intake_1:601:7]',
            'QR補助レコード 601 から自動起票したレビュー候補です。',
            'ペニシリンで発疹あり',
          ].join('\n'),
        },
      }),
    ).toMatchObject({
      confirmed_at: '2026-06-09',
    });
  });

  it('does not build an entry when the issue is not a QR allergy candidate', () => {
    expect(
      buildQrAllergyEntryFromMedicationIssue({
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'adherence',
          title: 'QR由来の服薬状況確認候補',
          description: '[qr_supplemental:intake_1:421:1]\n残薬あり',
        },
      }),
    ).toBeNull();
  });
});

describe('promoteResolvedQrAllergyIssueToPatient', () => {
  it('appends the allergy entry to patient allergy_info once', async () => {
    const patientFindFirst = vi.fn().mockResolvedValue({
      id: 'patient_1',
      allergy_info: [],
    });
    const patientUpdate = vi.fn().mockResolvedValue({});

    const result = await promoteResolvedQrAllergyIssueToPatient(
      {
        patient: {
          findFirst: patientFindFirst,
          update: patientUpdate,
        },
      },
      {
        orgId: 'org_1',
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'side_effect',
          title: 'QR由来のアレルギー・副作用歴確認候補: 患者等記入事項',
          description: '[qr_supplemental:intake_1:601:7]\nペニシリンで発疹あり',
        },
      },
    );

    expect(result).toMatchObject({ promoted: true });
    expect(patientUpdate).toHaveBeenCalledWith({
      where: { id: 'patient_1' },
      data: {
        allergy_info: [
          {
            drug_name: 'ペニシリン',
            category: 'drug',
            severity: 'unknown',
            confirmed_at: '2026-06-08',
            source: 'qr_supplemental:issue_1',
          },
        ],
      },
    });
  });

  it('preserves legacy allergy_info values when appending a QR allergy entry', async () => {
    const patientUpdate = vi.fn().mockResolvedValue({});
    const legacyString = 'ペニシリン allergy note';
    const legacyObject = { drug_name: '造影剤', memo: 'legacy format' };

    const result = await promoteResolvedQrAllergyIssueToPatient(
      {
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            allergy_info: [legacyString, legacyObject],
          }),
          update: patientUpdate,
        },
      },
      {
        orgId: 'org_1',
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'side_effect',
          title: 'QR由来のアレルギー・副作用歴確認候補: 患者等記入事項',
          description: '[qr_supplemental:intake_1:601:7]\nセフェム系で発疹あり',
        },
      },
    );

    expect(result).toMatchObject({ promoted: true });
    expect(patientUpdate).toHaveBeenCalledWith({
      where: { id: 'patient_1' },
      data: {
        allergy_info: [
          legacyString,
          legacyObject,
          {
            drug_name: 'セフェム系',
            category: 'drug',
            severity: 'unknown',
            confirmed_at: '2026-06-08',
            source: 'qr_supplemental:issue_1',
          },
        ],
      },
    });
  });

  it('skips duplicate source entries', async () => {
    const patientUpdate = vi.fn().mockResolvedValue({});
    const result = await promoteResolvedQrAllergyIssueToPatient(
      {
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            allergy_info: [
              {
                drug_name: 'ペニシリン',
                category: 'drug',
                severity: 'unknown',
                source: 'qr_supplemental:issue_1',
              },
            ],
          }),
          update: patientUpdate,
        },
      },
      {
        orgId: 'org_1',
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'side_effect',
          title: 'QR由来のアレルギー・副作用歴確認候補: 患者等記入事項',
          description: '[qr_supplemental:intake_1:601:7]\nペニシリンで発疹あり',
        },
      },
    );

    expect(result).toEqual({ promoted: false, reason: 'duplicate_source' });
    expect(patientUpdate).not.toHaveBeenCalled();
  });

  it('skips duplicate drug names even when the source differs', async () => {
    const patientUpdate = vi.fn().mockResolvedValue({});
    const result = await promoteResolvedQrAllergyIssueToPatient(
      {
        patient: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'patient_1',
            allergy_info: [
              {
                drug_name: 'ペニシリン',
                category: 'drug',
                severity: 'unknown',
                source: 'manual',
              },
            ],
          }),
          update: patientUpdate,
        },
      },
      {
        orgId: 'org_1',
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_2',
          patient_id: 'patient_1',
          category: 'side_effect',
          title: 'QR由来のアレルギー・副作用歴確認候補: 患者等記入事項',
          description: '[qr_supplemental:intake_1:601:8]\nペニシリンで発疹あり',
        },
      },
    );

    expect(result).toEqual({ promoted: false, reason: 'duplicate_drug_name' });
    expect(patientUpdate).not.toHaveBeenCalled();
  });
});
