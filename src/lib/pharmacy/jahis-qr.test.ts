import { describe, expect, it } from 'vitest';
import { buildJahisQRText, parseJahisQR, validateJahisQrPatientIdentity } from './jahis-qr';

describe('buildJahisQRText', () => {
  it('builds export text that can be parsed back for the main patient and medication fields', () => {
    const text = buildJahisQRText({
      patient: {
        name: '山田 太郎',
        nameKana: 'ヤマダ タロウ',
        gender: 'male',
        birthDate: '1945-02-03',
      },
      prescribingInstitution: {
        institutionCode: '1234567',
        name: 'PH-OS Clinic',
      },
      prescribingDoctor: '田中 医師',
      prescribingDepartment: '内科',
      dispensingDate: '2026-03-29',
      medications: [
        {
          drugCode: '123456789',
          drugName: 'アムロジピン錠5mg',
          dose: '1錠',
          frequency: '1日1回朝食後',
          daysOrTimes: '14日分',
        },
      ],
    });

    expect(text).toContain('JAHISTC');
    // Record 1: name at field[1], gender at field[2], birthdate at field[3]
    expect(text).toContain('1,山田 太郎,1,19450203');
    // Record 5: dispensing date
    expect(text).toContain('5,20260329');
    // Record 55: prescribing doctor
    expect(text).toContain('55,田中 医師,内科,1');

    const parsed = parseJahisQR(text);
    expect(parsed.patient).toMatchObject({
      name: '山田 太郎',
      gender: 'male',
      birthDate: '1945-02-03',
    });
    expect(parsed.prescribingInstitution.name).toBe('PH-OS Clinic');
    expect(parsed.prescribingDoctor).toBe('田中 医師');
    expect(parsed.dispensingDate).toBe('2026-03-29');
    expect(parsed.medications[0]).toMatchObject({
      drugName: 'アムロジピン錠5mg',
      dose: '1錠',
    });
    // usage comes from record 301 field[2]
    expect(parsed.medications[0].usage).toBe('1日1回朝食後');
  });

  it('supports backward-compat pharmacy field in input', () => {
    const text = buildJahisQRText({
      patient: { name: '田中 花子', gender: 'female', birthDate: '1960-06-15' },
      pharmacy: {
        institutionCode: '9876543',
        institutionName: 'テスト病院',
        doctorName: '山田 医師',
      },
      dispensingDate: '2026-04-01',
      medications: [],
    });

    expect(text).toContain('JAHISTC');
    expect(text).toContain('5,20260401');
    // Doctor name written to record 55
    expect(text).toContain('55,山田 医師');
  });

  it('normalizes a validated API datetime birth date to the exact JAHIS date field', () => {
    const text = buildJahisQRText({
      patient: {
        name: '山田 花子',
        nameKana: 'ヤマダ ハナコ',
        gender: 'female',
        birthDate: '1950-04-01T00:00:00.000Z',
      },
      medications: [],
    });

    expect(text.split('\r\n')[1]).toBe('1,山田 花子,2,19500401,,,,,,,ヤマダ ハナコ');
  });

  it('terminates every export record with CRLF and omits EOF for QR payloads', () => {
    const text = buildJahisQRText({
      patient: {
        name: '山田 花子',
        nameKana: 'ヤマダ ハナコ',
        gender: 'female',
        birthDate: '1950-04-01',
      },
      medications: [],
    });

    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(text).not.toContain('\u001a');
  });

  it.each([
    ['lone CR in name', { name: '山田花子\r' }, 'name'],
    ['LF in birth date', { name: '山田花子', birthDate: '1950-04-01\n' }, 'birth_date'],
    ['EOF in name kana', { name: '山田花子', nameKana: 'ヤマダハナコ\u001a' }, 'name'],
    ['TAB in name', { name: '\t山田花子' }, 'name'],
    ['NUL in name', { name: '山田\u0000花子' }, 'name'],
  ] as const)(
    'rejects %s before patient record serialization',
    (_label, patientOverrides, reason) => {
      const patient = {
        gender: 'female' as const,
        birthDate: '1950-04-01',
        ...patientOverrides,
      };

      expect(validateJahisQrPatientIdentity(patient)).toEqual({ success: false, reason });
      expect(() => buildJahisQRText({ patient, medications: [] })).toThrow(
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
  ])('rejects %s in a medication field before record serialization', (_label, drugName) => {
    expect(() =>
      buildJahisQRText({
        patient: { name: '山田 花子', gender: 'female', birthDate: '1950-04-01' },
        medications: [{ drugName, dose: '1錠', frequency: '朝食後' }],
      }),
    ).toThrow('JAHIS_FIELD_CONTROL_CHARACTER_INVALID');
  });

  it('preserves record boundaries by replacing field commas with fullwidth commas', () => {
    const text = buildJahisQRText({
      patient: { name: '山田,花子', gender: 'female', birthDate: '1950-04-01' },
      medications: [{ drugName: '薬剤,5mg', dose: '1錠' }],
    });

    expect(text).toContain('1,山田，花子,2,19500401');
    expect(text).toContain('201,1,薬剤，5mg,1錠');
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
    expect(() => buildJahisQRText({ patient, medications: [] })).toThrow(
      `JAHIS_PATIENT_IDENTITY_INVALID:${reason}`,
    );
  });
});
