import { describe, expect, it, vi } from 'vitest';
import { buildPatientStateSnapshot } from './patient-detail';

type SnapshotDb = Parameters<typeof buildPatientStateSnapshot>[0];

function createDb(patient: unknown, insurances: unknown[] = []) {
  const patientFindFirst = vi.fn().mockResolvedValue(patient);
  const insuranceFindMany = vi.fn().mockResolvedValue(insurances);
  const db = {
    patient: { findFirst: patientFindFirst },
    patientInsurance: { findMany: insuranceFindMany },
  } as unknown as SnapshotDb;
  return { db, patientFindFirst, insuranceFindMany };
}

const basePatient = {
  id: 'patient_1',
  name: '山田 太郎',
  name_kana: 'ヤマダ タロウ',
  birth_date: new Date('1944-01-01T00:00:00.000Z'),
  gender: 'male',
  phone: '090-1111-2222',
  medical_insurance_number: '1234567890',
  care_insurance_number: null,
  allergy_info: [{ substance: 'ペニシリン' }],
  notes: 'メモ',
  residences: [
    { id: 'res_2', address: '旧住所', is_primary: false },
    { id: 'res_1', address: '東京都千代田区1-2-3', is_primary: true, unit_name: '301' },
  ],
  scheduling_preference: {
    care_level: '要介護2',
    adl_level: 'partial',
    swallowing_route: 'oral',
    dementia_level: null,
    infection_isolation: false,
  },
  contacts: [{ id: 'c1', name: '山田 花子', relation: 'child' }],
  conditions: [{ id: 'cond1', name: '膵癌', is_primary: true }],
  consents: [],
  cases: [
    { id: 'case_2', required_visit_support: null, care_team_links: [] },
    {
      id: 'case_1',
      required_visit_support: { home_visit_intake: { special_procedures: ['tpn'] } },
      care_team_links: [{ id: 'ctl1', role: 'physician', name: '佐藤医師' }],
    },
  ],
};

const baseArgs = {
  orgId: 'org_1',
  patientId: 'patient_1',
  caseId: 'case_1',
  role: 'pharmacist' as const,
  userId: 'user_actor',
  capturedAt: new Date('2026-06-16T00:00:00.000Z'),
};

describe('buildPatientStateSnapshot', () => {
  it('訪問時点の患者現在値を JSON 安全な凍結オブジェクトとして返す', async () => {
    const { db, insuranceFindMany } = createDb(basePatient, [
      { insurance_type: 'medical', copay_ratio: 30, valid_from: new Date('2026-01-01'), valid_until: null },
    ]);

    const result = (await buildPatientStateSnapshot(db, baseArgs)) as Record<string, unknown>;

    expect(result).not.toBeNull();
    expect(result.source).toBe('visit_record');
    expect(result.captured_at).toBe('2026-06-16T00:00:00.000Z');
    expect(result.case_id).toBe('case_1');

    const patient = result.patient as Record<string, unknown>;
    expect(patient.name).toBe('山田 太郎');
    // Date は ISO 文字列へ正規化される
    expect(patient.birth_date).toBe('1944-01-01T00:00:00.000Z');

    // 居住情報は is_primary を優先採用
    expect((result.primary_residence as Record<string, unknown>).id).toBe('res_1');
    expect((result.scheduling_preference as Record<string, unknown>).care_level).toBe('要介護2');
    expect((result.conditions as unknown[]).length).toBe(1);
    // 訪問対象ケースの多職種(主治医)が採られる
    const careTeam = result.care_team_links as Array<Record<string, unknown>>;
    expect(careTeam[0].role).toBe('physician');
    expect((result.insurances as unknown[]).length).toBe(1);

    expect(insuranceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', patient_id: 'patient_1', is_active: true },
      }),
    );
  });

  it('患者が見つからない場合は null を返す', async () => {
    const { db, insuranceFindMany } = createDb(null);
    const result = await buildPatientStateSnapshot(db, baseArgs);
    expect(result).toBeNull();
    // base が無ければ保険照会もしない
    expect(insuranceFindMany).not.toHaveBeenCalled();
  });

  it('relations 欠落(最小データ)でも例外を投げず凍結する', async () => {
    const { db } = createDb({ id: 'patient_1', name: '患者A' });
    const result = (await buildPatientStateSnapshot(db, baseArgs)) as Record<string, unknown>;
    expect((result.patient as Record<string, unknown>).name).toBe('患者A');
    expect(result.primary_residence).toBeNull();
    expect(result.care_team_links).toEqual([]);
    expect(result.conditions).toEqual([]);
  });
});
