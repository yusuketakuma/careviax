import { describe, expect, it } from 'vitest';
import {
  assessQrPatientIdentity,
  collectMissingQrPatientIdentityFields,
  collectQrPatientIdentityMismatches,
  readQrPatientIdentityFromDraftParsedData,
} from './qr-patient-match';

describe('qr patient identity matching', () => {
  it('normalizes whitespace and width when comparing patient names', () => {
    expect(
      collectQrPatientIdentityMismatches(
        {
          name: '山田　太郎',
          nameKana: 'ﾔﾏﾀﾞ ﾀﾛｳ',
          birthDate: '1950-03-15',
          gender: 'male',
        },
        {
          name: '山田太郎',
          name_kana: 'ヤマダタロウ',
          birth_date: new Date('1950-03-15T00:00:00.000Z'),
          gender: 'male',
        },
      ),
    ).toEqual([]);
  });

  it('returns every provided QR identity mismatch', () => {
    expect(
      collectQrPatientIdentityMismatches(
        {
          name: '山田 太郎',
          nameKana: 'ヤマダ タロウ',
          birthDate: '1950-03-15',
          gender: 'male',
        },
        {
          name: '佐藤花子',
          name_kana: 'サトウハナコ',
          birth_date: '1960-06-15',
          gender: 'female',
        },
      ),
    ).toEqual(['name', 'name_kana', 'birth_date', 'gender']);
  });

  it('reads patient identity from flattened or nested draft parsed data', () => {
    expect(
      readQrPatientIdentityFromDraftParsedData({
        patientName: '山田 太郎',
        patientBirthdate: '1950-03-15',
        patient: { name: 'ignored', gender: 'male' },
      }),
    ).toEqual({
      name: '山田 太郎',
      nameKana: null,
      birthDate: '1950-03-15',
      gender: 'male',
    });
  });

  it('reports missing strong identifiers as unverifiable', () => {
    const qrPatient = {
      name: '山田 太郎',
      birthDate: null,
    };

    expect(collectMissingQrPatientIdentityFields(qrPatient)).toEqual(['birth_date']);
    expect(
      assessQrPatientIdentity(qrPatient, {
        name: '山田 太郎',
        name_kana: 'ヤマダ タロウ',
        birth_date: '1950-03-15',
        gender: 'male',
      }),
    ).toEqual({
      kind: 'unverifiable',
      missing: ['birth_date'],
    });
  });

  it('returns mismatch or matched assessments when strong identifiers are present', () => {
    const patient = {
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      birth_date: '1950-03-15',
      gender: 'male',
    };

    expect(
      assessQrPatientIdentity(
        { name: '山田 太郎', nameKana: 'ヤマダ タロウ', birthDate: '1950-03-15' },
        patient,
      ),
    ).toEqual({ kind: 'matched' });

    expect(
      assessQrPatientIdentity(
        { name: '山田 太郎', nameKana: 'ヤマダ タロウ', birthDate: '1950-03-16' },
        patient,
      ),
    ).toEqual({ kind: 'mismatch', mismatches: ['birth_date'] });
  });
});
