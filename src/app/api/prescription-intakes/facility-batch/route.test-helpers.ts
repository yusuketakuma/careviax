import { addDays, subDays } from 'date-fns';
import { NextRequest } from 'next/server';
import { vi, type Mock } from 'vitest';
import { japanDateKey } from '@/lib/utils/date-boundary';

export const TODAY = japanDateKey();
export const FUTURE_DATE = japanDateKey(addDays(new Date(), 1));
export const EXPIRED_DATE = japanDateKey(subDays(new Date(), 5));

export function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/prescription-intakes/facility-batch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

export function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/prescription-intakes/facility-batch', {
    method: 'POST',
    body: '{"entries":',
    headers: { 'content-type': 'application/json' },
  });
}

export const PATIENT_1_IDENTITY_SNAPSHOT = {
  name: '山田 花子',
  name_kana: 'ヤマダ ハナコ',
  birth_date: '1940-01-01',
};

export const PATIENT_2_IDENTITY_SNAPSHOT = {
  name: '佐藤 次郎',
  name_kana: 'サトウ ジロウ',
  birth_date: '1942-02-02',
};

export function createValidFacilityBatchBody(overrides: Record<string, unknown> = {}) {
  return {
    source_type: 'facility_batch',
    prescribed_date: TODAY,
    entries: [
      {
        case_id: 'case_1',
        patient_id: 'patient_1',
        patient_identity_snapshot: { ...PATIENT_1_IDENTITY_SNAPSHOT },
        lines: [
          {
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
          },
        ],
      },
      {
        case_id: 'case_2',
        patient_id: 'patient_2',
        patient_identity_snapshot: { ...PATIENT_2_IDENTITY_SNAPSHOT },
        lines: [
          {
            line_number: 1,
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '1149019',
            dose: '1錠',
            frequency: '疼痛時',
            days: 7,
          },
        ],
      },
    ],
    ...overrides,
  };
}

export function installMixedFacilityTransactionMock(withOrgContextMock: Mock) {
  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({
      drugMaster: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'drug_master_amlodipine',
            yj_code: '2149001',
            receipt_code: null,
            hot_code: null,
            outpatient_injection_eligible: false,
          },
          {
            id: 'drug_master_loxoprofen',
            yj_code: '1149019',
            receipt_code: null,
            hot_code: null,
            outpatient_injection_eligible: false,
          },
        ]),
      },
      careCase: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'case_1',
            patient_id: 'patient_1',
            patient: {
              id: 'patient_1',
              name: '山田 花子',
              name_kana: 'ヤマダ ハナコ',
              birth_date: new Date('1940-01-01T00:00:00.000Z'),
              residences: [{ building_id: 'facility_a', address: '東京都A区1-1-1' }],
            },
          },
          {
            id: 'case_2',
            patient_id: 'patient_2',
            patient: {
              id: 'patient_2',
              name: '佐藤 次郎',
              name_kana: 'サトウ ジロウ',
              birth_date: new Date('1942-02-02T00:00:00.000Z'),
              residences: [{ building_id: 'facility_b', address: '東京都B区2-2-2' }],
            },
          },
        ]),
      },
      medicationCycle: { create: vi.fn() },
      prescriptionIntake: { create: vi.fn() },
    }),
  );
}
