import { describe, expect, it } from 'vitest';
import { buildJahisQRText, parseJahisQR } from './jahis-qr';

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
});
