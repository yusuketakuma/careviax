import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prescriptionLineFindManyMock,
  medicationProfileFindManyMock,
  drugInteractionFindFirstMock,
  drugMasterFindFirstMock,
  drugMasterFindManyMock,
  patientFindFirstMock,
  drugAlertRuleFindManyMock,
  drugPackageInsertFindManyMock,
  prescriptionIntakeFindFirstMock,
  patientLabObservationFindFirstMock,
  patientLabObservationFindManyMock,
} = vi.hoisted(() => ({
  prescriptionLineFindManyMock: vi.fn(),
  medicationProfileFindManyMock: vi.fn(),
  drugInteractionFindFirstMock: vi.fn(),
  drugMasterFindFirstMock: vi.fn(),
  drugMasterFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  drugAlertRuleFindManyMock: vi.fn(),
  drugPackageInsertFindManyMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  patientLabObservationFindFirstMock: vi.fn(),
  patientLabObservationFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    prescriptionLine: {
      findMany: prescriptionLineFindManyMock,
    },
    medicationProfile: {
      findMany: medicationProfileFindManyMock,
    },
    drugInteraction: {
      findFirst: drugInteractionFindFirstMock,
    },
    drugMaster: {
      findFirst: drugMasterFindFirstMock,
      findMany: drugMasterFindManyMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    drugAlertRule: {
      findMany: drugAlertRuleFindManyMock,
    },
    drugPackageInsert: {
      findMany: drugPackageInsertFindManyMock,
    },
    prescriptionIntake: {
      findFirst: prescriptionIntakeFindFirstMock,
    },
    patientLabObservation: {
      findFirst: patientLabObservationFindFirstMock,
      findMany: patientLabObservationFindManyMock,
    },
  },
}));

import { checkDispenseAlerts } from './checker';

describe('checkDispenseAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prescriptionLineFindManyMock.mockResolvedValue([]);
    medicationProfileFindManyMock.mockResolvedValue([]);
    drugInteractionFindFirstMock.mockResolvedValue(null);
    drugMasterFindFirstMock.mockResolvedValue(null);
    drugMasterFindManyMock.mockImplementation(async () => []);
    patientFindFirstMock.mockResolvedValue(null);
    drugAlertRuleFindManyMock.mockResolvedValue([]);
    drugPackageInsertFindManyMock.mockResolvedValue([]);
    prescriptionIntakeFindFirstMock.mockResolvedValue(null);
    patientLabObservationFindFirstMock.mockResolvedValue(null);
    patientLabObservationFindManyMock.mockResolvedValue([]);
  });

  it('warns when the current intake is a risky DO prescription continued from the previous intake', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'ロキソプロフェン錠60mg',
        drug_code: '1140001',
        dose: '1錠',
        frequency: '1日3回',
        days: 14,
      },
    ]);

    prescriptionIntakeFindFirstMock
      .mockResolvedValueOnce({
        id: 'intake_current',
        prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
        lines: [
          {
            id: 'line_current_1',
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '1140001',
            dose: '1錠',
            frequency: '1日3回',
            days: 14,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'intake_previous',
        prescribed_date: new Date('2026-03-14T00:00:00.000Z'),
        lines: [
          {
            id: 'line_prev_1',
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '1140001',
            dose: '1錠',
            frequency: '1日3回',
            days: 14,
          },
        ],
      });

    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '1140001',
        drug_name: 'ロキソプロフェン錠60mg',
        therapeutic_category: '1140',
        is_narcotic: false,
        is_psychotropic: false,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'do_prescription',
          severity: 'warning',
          message: expect.stringContaining('ロキソプロフェン錠60mg'),
          details: expect.objectContaining({
            current_intake_id: 'intake_current',
            previous_intake_id: 'intake_previous',
          }),
        }),
      ]),
    );
  });

  it('surfaces DrugMaster LASA and Tall Man safety flags as medication-safety alerts', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'ドブタミン注100mg',
        drug_code: '2119401A1020',
        dose: '1アンプル',
        frequency: '必要時',
        days: 1,
      },
    ]);

    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '2119401A1020',
        drug_name: 'ドブタミン注100mg',
        tall_man_name: 'DOBUTamine注100mg',
        therapeutic_category: '2119',
        max_administration_days: null,
        transitional_expiry_date: null,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: true,
        is_lasa_risk: true,
        lasa_group_key: 'dobutamine_dopamine',
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'lasa_drug_name',
          severity: 'warning',
          message: expect.stringContaining('DOBUTamine注100mg'),
          details: expect.objectContaining({
            tall_man_name: 'DOBUTamine注100mg',
            lasa_group_key: 'dobutamine_dopamine',
            source: 'drug_master_safety_flags',
          }),
        }),
      ]),
    );
  });

  it('ignores malformed alert rule conditions when matching high-risk rules', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'テスト薬A錠',
        drug_code: '1234567890123',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);

    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '1234567890123',
        drug_name: 'テスト薬A錠',
        tall_man_name: null,
        therapeutic_category: 'C03',
        max_administration_days: null,
        transitional_expiry_date: null,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: false,
        is_lasa_risk: false,
        lasa_group_key: null,
      },
    ]);

    drugAlertRuleFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.alert_type?.in) return [];
      if (args?.where?.alert_type !== 'high_risk') return [];
      return [
        {
          id: 'rule_empty_condition',
          message: '空条件はデータ品質警告',
          condition: {},
        },
        {
          id: 'rule_empty_arrays',
          message: '空配列条件はデータ品質警告',
          condition: { yj_codes: [], therapeutic_categories: [] },
        },
        {
          id: 'rule_array_condition',
          message: '配列ルートは無視',
          condition: ['unexpected'],
        },
        {
          id: 'rule_string_codes',
          message: '文字列コードは配列扱いしない',
          condition: { yj_codes: '1234567890123', therapeutic_categories: 'C03' },
        },
        {
          id: 'rule_valid_code',
          message: '有効なコードだけで判定',
          condition: { yj_codes: ['1234567890123', 123], therapeutic_categories: [false] },
        },
      ];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    const highRiskAlerts = alerts.filter((alert) => alert.type === 'high_risk');
    expect(highRiskAlerts).toHaveLength(1);
    expect(highRiskAlerts[0]).toMatchObject({
      message: '有効なコードだけで判定',
      details: { rule_id: 'rule_valid_code' },
    });
    expect(alerts.filter((alert) => alert.type === 'cds_data_quality')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('高リスク薬ルール'),
          details: expect.objectContaining({ rule_id: 'rule_empty_condition' }),
        }),
        expect.objectContaining({
          message: expect.stringContaining('高リスク薬ルール'),
          details: expect.objectContaining({ rule_id: 'rule_empty_arrays' }),
        }),
      ]),
    );
  });

  it('accepts string package insert entries and reports malformed safety text entries', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'テスト薬B錠',
        drug_code: '9999001',
        dose: '1錠',
        frequency: '1日1回',
        days: 7,
      },
    ]);
    patientFindFirstMock.mockResolvedValue({
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      allergy_info: null,
    });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '9999001',
        drug_name: 'テスト薬B錠',
        tall_man_name: null,
        therapeutic_category: '9999',
        max_administration_days: null,
        transitional_expiry_date: null,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: false,
        is_lasa_risk: false,
        lasa_group_key: null,
      },
    ]);
    drugPackageInsertFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.dosage_adjustment_renal) return [];
      return [
        {
          drug_master: { yj_code: '9999001', drug_name: 'テスト薬B錠' },
          contraindications: [
            '文字列形式の禁忌',
            { text: 123 },
            { text: '有効な禁忌' },
            { text: '   ' },
          ],
          adverse_effects: [
            { text: '通常副作用', severity: 'normal' },
            { text: '重大副作用', severity: 'serious' },
            { text: 456, severity: 'serious' },
            { text: '重大副作用2', severity: '重大' },
          ],
          precautions_elderly: [
            '文字列形式の高齢者注意',
            { text: 789 },
            { text: '高齢者は慎重投与' },
          ],
        },
      ];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.filter((alert) => alert.type === 'package_insert_contraindication')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('文字列形式の禁忌') }),
      expect.objectContaining({ message: expect.stringContaining('有効な禁忌') }),
    ]);
    expect(alerts.filter((alert) => alert.type === 'package_insert_adverse_effect')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('重大副作用') }),
      expect.objectContaining({ message: expect.stringContaining('重大副作用2') }),
    ]);
    expect(alerts.filter((alert) => alert.type === 'package_insert_elderly')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('文字列形式の高齢者注意') }),
      expect.objectContaining({ message: expect.stringContaining('高齢者は慎重投与') }),
    ]);
    expect(alerts.filter((alert) => alert.type === 'cds_data_quality')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('禁忌') }),
        expect.objectContaining({ message: expect.stringContaining('重大な副作用') }),
        expect.objectContaining({ message: expect.stringContaining('高齢者注意') }),
      ]),
    );
  });

  it('ignores malformed renal dose entries while surfacing valid eGFR range recommendations', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: '腎機能調整薬錠',
        drug_code: '8888001',
        dose: '1錠',
        frequency: '1日1回',
        days: 7,
      },
    ]);
    patientLabObservationFindFirstMock.mockResolvedValue({ value_numeric: 45 });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '8888001',
        drug_name: '腎機能調整薬錠',
        tall_man_name: null,
        therapeutic_category: '9999',
        max_administration_days: null,
        transitional_expiry_date: null,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: false,
        is_lasa_risk: false,
        lasa_group_key: null,
      },
    ]);
    drugPackageInsertFindManyMock.mockImplementation(async (args) => {
      if (!args?.where?.dosage_adjustment_renal) return [];
      return [
        {
          drug_master: { yj_code: '8888001', drug_name: '腎機能調整薬錠' },
          dosage_adjustment_renal: [
            'bad',
            { egfr_min: '30', egfr_max: 60, recommendation: '不正な最小値' },
            { egfr_min: 30, egfr_max: 60, recommendation: '45では減量' },
            { egfr_min: 0, egfr_max: 30, recommendation: '' },
          ],
        },
      ];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.filter((alert) => alert.type === 'renal_dose')).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('45では減量'),
        details: expect.objectContaining({ egfr_range: '30-60' }),
      }),
    ]);
    expect(alerts.filter((alert) => alert.type === 'cds_data_quality')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('腎機能用量調整') }),
    ]);
  });

  it('does not warn when the previous intake is not identical', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'ロキソプロフェン錠60mg',
        drug_code: '1140001',
        dose: '1錠',
        frequency: '1日3回',
        days: 14,
      },
    ]);

    prescriptionIntakeFindFirstMock
      .mockResolvedValueOnce({
        id: 'intake_current',
        prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
        lines: [
          {
            id: 'line_current_1',
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '1140001',
            dose: '1錠',
            frequency: '1日3回',
            days: 14,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'intake_previous',
        prescribed_date: new Date('2026-03-14T00:00:00.000Z'),
        lines: [
          {
            id: 'line_prev_1',
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '1140001',
            dose: '1錠',
            frequency: '1日2回',
            days: 14,
          },
        ],
      });

    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '1140001',
        drug_name: 'ロキソプロフェン錠60mg',
        therapeutic_category: '1140',
        is_narcotic: false,
        is_psychotropic: false,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.find((alert) => alert.type === 'do_prescription')).toBeUndefined();
  });

  it('does not warn when the identical prescription is outside risky continuation categories', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: '2149001',
        dose: '1錠',
        frequency: '1日1回',
        days: 30,
      },
    ]);

    prescriptionIntakeFindFirstMock
      .mockResolvedValueOnce({
        id: 'intake_current',
        prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
        lines: [
          {
            id: 'line_current_1',
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回',
            days: 30,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'intake_previous',
        prescribed_date: new Date('2026-02-28T00:00:00.000Z'),
        lines: [
          {
            id: 'line_prev_1',
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dose: '1錠',
            frequency: '1日1回',
            days: 30,
          },
        ],
      });

    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '2149001',
        drug_name: 'アムロジピン錠5mg',
        therapeutic_category: '2149',
        is_narcotic: false,
        is_psychotropic: false,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.find((alert) => alert.type === 'do_prescription')).toBeUndefined();
  });
});
