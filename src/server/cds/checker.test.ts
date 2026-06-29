import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prescriptionLineFindManyMock,
  medicationProfileFindManyMock,
  drugInteractionFindFirstMock,
  drugInteractionFindManyMock,
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
  drugInteractionFindManyMock: vi.fn(),
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
      findMany: drugInteractionFindManyMock,
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
    drugInteractionFindManyMock.mockResolvedValue([]);
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

  it('does not warn duplicate medication by name when the prescription line has a different resolved drug code', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: '同名薬',
        drug_code: 'YJ_NEW',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    medicationProfileFindManyMock.mockResolvedValue([
      {
        id: 'profile_existing',
        drug_name: '同名薬',
        drug_master_id: 'drug_old',
      },
    ]);
    drugMasterFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.id) {
        return [
          {
            id: 'drug_old',
            yj_code: 'YJ_OLD',
            drug_name: '同名薬',
            therapeutic_category: null,
          },
        ];
      }
      if (args?.where?.yj_code) {
        return [
          {
            id: 'drug_new',
            yj_code: 'YJ_NEW',
            drug_name: '同名薬',
            therapeutic_category: null,
            max_administration_days: null,
            transitional_expiry_date: null,
            is_narcotic: false,
            is_psychotropic: false,
            is_high_risk: false,
            is_lasa_risk: false,
            lasa_group_key: null,
          },
        ];
      }
      return [];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.find((alert) => alert.type === 'duplicate')).toBeUndefined();
  });

  it('warns duplicate medication when a prescription drug code matches a current medication master', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'コード一致薬',
        drug_code: 'YJ_SHARED',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    medicationProfileFindManyMock.mockResolvedValue([
      {
        id: 'profile_existing',
        drug_name: '別表示名',
        drug_master_id: 'drug_shared',
      },
    ]);
    drugMasterFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.id) {
        return [
          {
            id: 'drug_shared',
            yj_code: 'YJ_SHARED',
            drug_name: 'コード一致薬',
            therapeutic_category: null,
          },
        ];
      }
      if (args?.where?.yj_code) {
        return [
          {
            id: 'drug_shared',
            yj_code: 'YJ_SHARED',
            drug_name: 'コード一致薬',
            therapeutic_category: null,
            max_administration_days: null,
            transitional_expiry_date: null,
            is_narcotic: false,
            is_psychotropic: false,
            is_high_risk: false,
            is_lasa_risk: false,
            lasa_group_key: null,
          },
        ];
      }
      return [];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'duplicate',
          severity: 'warning',
          message: '重複投薬: コード一致薬',
        }),
      ]),
    );
  });

  it('does not warn duplicate medication by name when only the prescription side is code-resolved', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: '片側解決薬',
        drug_code: 'YJ_RESOLVED',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    medicationProfileFindManyMock.mockResolvedValue([
      {
        id: 'profile_existing',
        drug_name: '片側解決薬',
        drug_master_id: null,
      },
    ]);
    drugMasterFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.yj_code) {
        return [
          {
            id: 'drug_resolved',
            yj_code: 'YJ_RESOLVED',
            drug_name: '片側解決薬',
            therapeutic_category: null,
            max_administration_days: null,
            transitional_expiry_date: null,
            is_narcotic: false,
            is_psychotropic: false,
            is_high_risk: false,
            is_lasa_risk: false,
            lasa_group_key: null,
          },
        ];
      }
      return [];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.find((alert) => alert.type === 'duplicate')).toBeUndefined();
  });

  it('does not warn duplicate medication by name when only the current medication side is code-resolved', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: '片側解決薬',
        drug_code: null,
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    medicationProfileFindManyMock.mockResolvedValue([
      {
        id: 'profile_existing',
        drug_name: '片側解決薬',
        drug_master_id: 'drug_resolved',
      },
    ]);
    drugMasterFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.id) {
        return [
          {
            id: 'drug_resolved',
            yj_code: 'YJ_RESOLVED',
            drug_name: '片側解決薬',
            therapeutic_category: null,
          },
        ];
      }
      return [];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.find((alert) => alert.type === 'duplicate')).toBeUndefined();
  });

  it('keeps duplicate medication name fallback only when both sides are unresolved', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: '未解決薬',
        drug_code: null,
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    medicationProfileFindManyMock.mockResolvedValue([
      {
        id: 'profile_existing',
        drug_name: '未解決薬',
        drug_master_id: null,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'duplicate',
          severity: 'warning',
          message: '重複投薬: 未解決薬',
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

  it('uses allergy drug_code as the exact allergy identity before drug-name matching', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_allergy_1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: '2149001F1020',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    patientFindFirstMock.mockResolvedValue({
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      allergy_info: [
        {
          drug_name: 'アムロジピン',
          drug_code: '2149001F1020',
          category: 'drug',
          severity: 'moderate',
        },
      ],
    });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_allergy_1',
        yj_code: '2149001F1020',
        drug_name: 'アムロジピン錠5mg',
        tall_man_name: null,
        therapeutic_category: '2149',
        max_administration_days: null,
        transitional_expiry_date: null,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: false,
        is_lasa_risk: false,
        lasa_group_key: null,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'allergy_cross',
          severity: 'warning',
          details: expect.objectContaining({
            allergy_drug_code: '2149001F1020',
            prescribed_drug_code: '2149001F1020',
          }),
        }),
      ]),
    );
  });

  it('does not raise a direct name allergy alert when both allergy and prescription have different codes', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_allergy_1',
        drug_name: '同名薬錠5mg',
        drug_code: 'YJ0002B',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    patientFindFirstMock.mockResolvedValue({
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      allergy_info: [
        {
          drug_name: '同名薬',
          drug_code: 'YJ0001A',
          category: 'drug',
          severity: 'severe',
        },
      ],
    });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_allergy_1',
        yj_code: 'YJ0002B',
        drug_name: '同名薬錠5mg',
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

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.filter((alert) => alert.type === 'allergy_cross')).toEqual([]);
  });

  it('keeps direct allergy name alerts for same ingredient prefix even when full drug codes differ', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_allergy_1',
        drug_name: 'アセトアミノフェン注',
        drug_code: '1141001A1020',
        dose: '1管',
        frequency: '疼痛時',
        days: 1,
      },
    ]);
    patientFindFirstMock.mockResolvedValue({
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      allergy_info: [
        {
          drug_name: 'アセトアミノフェン',
          drug_code: '1141001F1020',
          category: 'drug',
          severity: 'severe',
        },
      ],
    });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_allergy_1',
        yj_code: '1141001A1020',
        drug_name: 'アセトアミノフェン注',
        tall_man_name: null,
        therapeutic_category: '1141',
        max_administration_days: null,
        transitional_expiry_date: null,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: false,
        is_lasa_risk: false,
        lasa_group_key: null,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'allergy_cross',
          severity: 'critical',
          details: expect.objectContaining({
            allergy_drug: 'アセトアミノフェン',
            allergy_drug_code: '1141001F1020',
            prescribed_drug: 'アセトアミノフェン注',
            prescribed_drug_code: '1141001A1020',
          }),
        }),
      ]),
    );
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

  it('treats same drug code with display-name drift as the same prescription content', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'ロキソプロフェンNa錠60mg',
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
            drug_name: 'ロキソプロフェンNa錠60mg',
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
          message: expect.stringContaining('ロキソプロフェンNa錠60mg'),
        }),
      ]),
    );
  });

  it('does not treat same-name different-code lines as the same prescription content', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: '同名リスク薬',
        drug_code: '1140001A',
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
            drug_name: '同名リスク薬',
            drug_code: '1140001A',
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
            drug_name: '同名リスク薬',
            drug_code: '1140001B',
            dose: '1錠',
            frequency: '1日3回',
            days: 14,
          },
        ],
      });

    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '1140001A',
        drug_name: '同名リスク薬',
        therapeutic_category: '1140',
        is_narcotic: false,
        is_psychotropic: false,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.find((alert) => alert.type === 'do_prescription')).toBeUndefined();
  });

  it('keeps DO prescription fallback for identical uncoded drug names', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'ロキソプロフェン錠60mg',
        drug_code: null,
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
            drug_code: null,
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
            drug_code: null,
            dose: '1錠',
            frequency: '1日3回',
            days: 14,
          },
        ],
      });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'do_prescription',
          severity: 'warning',
          message: expect.stringContaining('ロキソプロフェン錠60mg'),
        }),
      ]),
    );
  });

  it('does not compare a coded line to an uncoded same-name previous line', async () => {
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
            drug_code: null,
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

  it('formats transitional-expiry alert messages with the local calendar day', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00+09:00'));

    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_transitional_1',
        drug_name: '経過措置薬錠10mg',
        drug_code: '9999002',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_transitional_1',
        yj_code: '9999002',
        drug_name: '経過措置薬錠10mg',
        tall_man_name: null,
        therapeutic_category: '9999',
        max_administration_days: null,
        transitional_expiry_date: new Date('2026-03-30T15:30:00.000Z'),
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: false,
        is_lasa_risk: false,
        lasa_group_key: null,
      },
    ]);

    try {
      const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

      expect(alerts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'transitional_expiry',
            severity: 'warning',
            message: '経過措置期限接近: 経過措置薬錠10mg（残30日、2026-03-31）',
            details: expect.objectContaining({
              drug_code: '9999002',
              expiry_date: '2026-03-30T15:30:00.000Z',
              days_remaining: 30,
            }),
          }),
        ]),
      );
    } finally {
      vi.useRealTimers();
      process.env.TZ = originalTimezone;
    }
  });
});
