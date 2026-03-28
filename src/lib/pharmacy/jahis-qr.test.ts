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
      pharmacy: {
        institutionCode: '1234567',
        institutionName: 'Careviax Clinic',
        doctorName: '田中 医師',
      },
      prescriptionDate: '2026-03-28',
      dispensingDate: '2026-03-29',
      medications: [
        {
          drugCode: '123456789',
          drugName: 'アムロジピン錠5mg',
          dose: '1錠',
          frequency: '1日1回朝食後',
          daysOrTimes: '14日分',
          dispensedQuantity: '14',
        },
      ],
    });

    expect(text).toContain('JAHISTC');
    expect(text).toContain('1,山田 太郎,ヤマダ タロウ,1,19450203');
    expect(text).toContain('11,20260328');
    expect(text).toContain('311,20260329');

    const parsed = parseJahisQR(text);
    expect(parsed.patient).toMatchObject({
      name: '山田 太郎',
      nameKana: 'ヤマダ タロウ',
      gender: 'male',
      birthDate: '1945-02-03',
    });
    expect(parsed.pharmacy).toMatchObject({
      institutionCode: '1234567',
      institutionName: 'Careviax Clinic',
      doctorName: '田中 医師',
    });
    expect(parsed.medications[0]).toMatchObject({
      drugCode: '123456789',
      drugName: 'アムロジピン錠5mg',
      dose: '1錠',
      usage: '1日1回朝食後',
      daysOrTimes: '14日分',
      dispensedQuantity: '14',
    });
  });
});
