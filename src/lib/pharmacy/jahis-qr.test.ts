import { describe, expect, it } from 'vitest';
import {
  buildJahisQrExport,
  buildJahisQRText,
  parseJahisQR,
  validateJahisQrPatientIdentity,
  type JahisPatient,
  type JahisQrExportInput,
  type JahisQrExportMedication,
} from './jahis-qr';

const BASE_MEDICATION: JahisQrExportMedication = {
  drugCodeType: 2,
  drugCode: '612170709',
  drugName: 'アムロジピン錠5mg',
  dose: '1',
  unit: '錠',
  usageName: '1日1回朝食後',
  dispensingQuantity: '14',
  dispensingUnit: '日分',
  formCode: 1,
  usageCodeType: 1,
};

const BASE_INPUT: JahisQrExportInput = {
  patient: {
    name: '山田 太郎',
    nameKana: 'ヤマダ タロウ',
    gender: 'male',
    birthDate: '1945-02-03',
  },
  dispensingInstitution: {
    name: 'PH-OS薬局',
    prefCode: '13',
    scoreTableCode: '4',
    institutionCode: '7654321',
  },
  prescribingInstitution: {
    name: 'PH-OS Clinic',
    prefCode: '13',
    scoreTableCode: '1',
    institutionCode: '1234567',
  },
  prescribingDoctor: '田中 医師',
  prescribingDepartment: '内科',
  dispensingDate: '2026-03-29',
  medications: [BASE_MEDICATION],
};

function validInput(
  overrides: Partial<Omit<JahisQrExportInput, 'patient' | 'medications'>> & {
    patient?: Partial<JahisPatient>;
    medications?: readonly JahisQrExportMedication[];
  } = {},
): JahisQrExportInput {
  return {
    ...BASE_INPUT,
    ...overrides,
    patient: { ...BASE_INPUT.patient, ...overrides.patient },
    medications: overrides.medications ?? BASE_INPUT.medications,
  };
}

describe('buildJahisQRText', () => {
  it('emits the required provider-to-patient records with exact structured fields', () => {
    const text = buildJahisQRText(BASE_INPUT);
    const lines = text.split('\r\n');

    expect(lines.slice(0, 8)).toEqual([
      'JAHISTC08,1',
      '1,山田 太郎,1,19450203,,,,,,,ヤマダ タロウ',
      '5,20260329,1',
      '11,PH-OS薬局,13,4,7654321,,,,1',
      '51,PH-OS Clinic,13,1,1234567,1',
      '55,田中 医師,内科,1',
      '201,1,アムロジピン錠5mg,1,錠,2,612170709,1,,,',
      '301,1,1日1回朝食後,14,日分,1,1,,1',
    ]);

    const parsed = parseJahisQR(text);
    expect(parsed.patient).toMatchObject({
      name: '山田 太郎',
      gender: 'male',
      birthDate: '1945-02-03',
    });
    expect(parsed.dispensingInstitution).toMatchObject({
      name: 'PH-OS薬局',
      prefCode: '13',
      scoreTableCode: '4',
      institutionCode: '7654321',
    });
    expect(parsed.prescribingInstitution).toMatchObject({
      name: 'PH-OS Clinic',
      prefCode: '13',
      scoreTableCode: '1',
      institutionCode: '1234567',
    });
    expect(parsed.medications[0]).toMatchObject({
      drugName: 'アムロジピン錠5mg',
      dose: '1',
      unit: '錠',
      usage: '1日1回朝食後',
      usageQuantity: '14',
      usageUnit: '日分',
    });
  });

  it('normalizes a validated API datetime birth date to the exact JAHIS date field', () => {
    const text = buildJahisQRText(
      validInput({ patient: { birthDate: '1950-04-01T00:00:00.000Z' } }),
    );

    expect(text.split('\r\n')[1]).toBe('1,山田 太郎,1,19500401,,,,,,,ヤマダ タロウ');
  });

  it('returns canonical bytes, CRLF record boundaries, and no EOF marker', () => {
    const payload = buildJahisQrExport(validInput({ patient: { nameKana: 'ﾔﾏﾀﾞ ﾀﾛｳ' } }));

    expect(new TextDecoder('shift_jis').decode(payload.bytes)).toBe(payload.text);
    expect(payload.text.endsWith('\r\n')).toBe(true);
    expect(payload.text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/u);
    expect(payload.text).not.toContain('\u001a');
    expect([...payload.bytes]).toContain(0xd4);
  });

  it.each([
    ['lone CR in name', { name: '山田花子\r' }, 'name'],
    ['LF in birth date', { birthDate: '1950-04-01\n' }, 'birth_date'],
    ['EOF in name kana', { nameKana: 'ヤマダハナコ\u001a' }, 'name'],
    ['TAB in name', { name: '\t山田花子' }, 'name'],
    ['NUL in name', { name: '山田\u0000花子' }, 'name'],
  ] as const)(
    'rejects %s before patient record serialization',
    (_label, patientOverrides, reason) => {
      const patient = { ...BASE_INPUT.patient, ...patientOverrides };

      expect(validateJahisQrPatientIdentity(patient)).toEqual({ success: false, reason });
      expect(() => buildJahisQRText(validInput({ patient }))).toThrow(
        `JAHIS_PATIENT_IDENTITY_INVALID:${reason}`,
      );
    },
  );

  it.each([
    ['lone CR', 'アムロジピン\r錠5mg'],
    ['LF', 'アムロジピン\n錠5mg'],
    ['EOF', 'アムロジピン\u001a錠5mg'],
    ['TAB', 'アムロジピン\t錠5mg'],
    ['NUL', 'アムロジピン\u0000錠5mg'],
    ['DEL', 'アムロジピン\u007f錠5mg'],
  ])('rejects %s in a medication field before serialization', (_label, drugName) => {
    expect(() =>
      buildJahisQRText(validInput({ medications: [{ ...BASE_MEDICATION, drugName }] })),
    ).toThrow('JAHIS_FIELD_CONTROL_CHARACTER_INVALID');
  });

  it('preserves record boundaries by replacing field commas with fullwidth commas', () => {
    const text = buildJahisQRText(
      validInput({
        patient: { name: '山田,花子' },
        medications: [{ ...BASE_MEDICATION, drugName: '薬剤,5mg' }],
      }),
    );

    expect(text).toContain('1,山田，花子,1,19450203');
    expect(text).toContain('201,1,薬剤，5mg,1,錠');
  });

  it('enforces official patient and medication Shift-JIS byte limits', () => {
    expect(() =>
      buildJahisQRText(
        validInput({
          patient: { name: '漢'.repeat(20) },
          medications: [{ ...BASE_MEDICATION, drugName: '薬'.repeat(60) }],
        }),
      ),
    ).not.toThrow();

    expect(() =>
      buildJahisQRText(validInput({ patient: { name: `${'漢'.repeat(20)}A` } })),
    ).toThrow('JAHIS_FIELD_BYTE_LIMIT_EXCEEDED:1:patient_name');
    expect(() =>
      buildJahisQRText(
        validInput({
          medications: [{ ...BASE_MEDICATION, drugName: `${'薬'.repeat(60)}A` }],
        }),
      ),
    ).toThrow('JAHIS_FIELD_BYTE_LIMIT_EXCEEDED:201:drug_name');
  });

  it.each(['😀', '髙', '■'])(
    'rejects unsupported or replacement characters before QR rendering: %s',
    (unsafeCharacter) => {
      expect(() =>
        buildJahisQRText(validInput({ patient: { name: `山田${unsafeCharacter}花子` } })),
      ).toThrow('JAHIS_SHIFT_JIS_UNREPRESENTABLE');
    },
  );

  it('rejects missing mandatory medication and usage records', () => {
    expect(() => buildJahisQRText(validInput({ medications: [] }))).toThrow(
      'JAHIS_REQUIRED_RECORD_MISSING:201',
    );
  });

  it.each([
    [
      'a coded drug without its code',
      { ...BASE_MEDICATION, drugCodeType: 2 as const, drugCode: null },
      'JAHIS_DRUG_CODE_CONTRACT_INVALID',
    ],
    [
      'an uncoded drug with a code',
      { ...BASE_MEDICATION, drugCodeType: 1 as const, drugCode: '612170709' },
      'JAHIS_DRUG_CODE_CONTRACT_INVALID',
    ],
    [
      'a coded generic without its code',
      { ...BASE_MEDICATION, genericCodeType: 2 as const, genericCode: null },
      'JAHIS_GENERIC_CODE_CONTRACT_INVALID',
    ],
    [
      'an uncoded generic with a code',
      { ...BASE_MEDICATION, genericCodeType: 1 as const, genericCode: '123456789012' },
      'JAHIS_GENERIC_CODE_CONTRACT_INVALID',
    ],
    [
      'a coded usage without its code',
      { ...BASE_MEDICATION, usageCodeType: 2 as const, usageCode: null },
      'JAHIS_USAGE_CODE_CONTRACT_INVALID',
    ],
    [
      'an uncoded usage with a code',
      { ...BASE_MEDICATION, usageCodeType: 1 as const, usageCode: '1011000400000000' },
      'JAHIS_USAGE_CODE_CONTRACT_INVALID',
    ],
  ])('rejects %s', (_label, medication, message) => {
    expect(() => buildJahisQRText(validInput({ medications: [medication] }))).toThrow(message);
  });

  it.each([
    [{ name: '患者', gender: 'female', birthDate: '1950-04-01' }, 'name'],
    [{ name: '山田 花子', gender: 'female' }, 'birth_date'],
    [{ name: '山田 花子', gender: 'female', birthDate: '1950-02-30' }, 'birth_date'],
    [{ name: '山田 花子', gender: 'female', birthDate: '1950-04-01T24:00:00Z' }, 'birth_date'],
    [{ name: '山田 花子', gender: 'female', birthDate: '1950-04-01T23:60:00Z' }, 'birth_date'],
    [{ name: '山田 花子', gender: 'female', birthDate: '1950-04-01T23:59:60Z' }, 'birth_date'],
    [{ name: '山田 花子', gender: 'other', birthDate: '1950-04-01' }, 'gender'],
    [{ name: '山田 花子', birthDate: '1950-04-01' }, 'gender'],
  ] as const)('rejects an unsafe patient identity before serialization: %s', (patient, reason) => {
    expect(validateJahisQrPatientIdentity(patient)).toEqual({ success: false, reason });
    expect(() => buildJahisQRText({ ...BASE_INPUT, patient: patient as JahisPatient })).toThrow(
      `JAHIS_PATIENT_IDENTITY_INVALID:${reason}`,
    );
  });
});
