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
  patientConditionFindManyMock,
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
  patientConditionFindManyMock: vi.fn(),
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
    patientCondition: {
      findMany: patientConditionFindManyMock,
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
    patientConditionFindManyMock.mockResolvedValue([]);
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

  it('X05: keeps high-severity package insert entries when truncating and surfaces a hidden-count marker', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'テスト薬C錠',
        drug_code: '7777001',
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
        yj_code: '7777001',
        drug_name: 'テスト薬C錠',
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
          drug_master: { yj_code: '7777001', drug_name: 'テスト薬C錠' },
          // 重大な禁忌が 4 件目（index 3）に居る。unsorted な slice(0,3) では落ちる。
          contraindications: [
            { text: '軽微な禁忌1' },
            { text: '軽微な禁忌2' },
            { text: '軽微な禁忌3' },
            { text: '重大な禁忌（見落とし厳禁）', severity: 'serious' },
            { text: '軽微な禁忌5' },
          ],
          // 重大な副作用が上限（2件）を超える。3件目が無言で落ちてはならない。
          adverse_effects: [
            { text: '重大副作用A', severity: 'serious' },
            { text: '重大副作用B', severity: '重大' },
            { text: '重大副作用C', severity: 'serious' },
          ],
          // 高齢者注意が上限（2件）を超える。
          precautions_elderly: [
            { text: '高齢者注意1' },
            { text: '高齢者注意2' },
            { text: '高齢者注意3' },
          ],
        },
      ];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    // 重大な禁忌は 4 件目に居ても、severity 降順ソートで表示に残る（false-negative 防止）。
    const contraindicationAlerts = alerts.filter(
      (alert) => alert.type === 'package_insert_contraindication',
    );
    expect(contraindicationAlerts).toHaveLength(3);
    expect(contraindicationAlerts[0]?.message).toContain('重大な禁忌（見落とし厳禁）');
    expect(contraindicationAlerts.map((alert) => alert.message).join('\n')).toContain(
      '重大な禁忌（見落とし厳禁）',
    );

    // 切り捨てが起きたことを件数で明示する marker（counted-list 契約）。
    const contraindicationTruncation = alerts.filter(
      (alert) => alert.type === 'package_insert_contraindication_truncated',
    );
    expect(contraindicationTruncation).toHaveLength(1);
    expect(contraindicationTruncation[0]?.severity).toBe('warning');
    expect(contraindicationTruncation[0]?.details).toMatchObject({
      shown_count: 3,
      hidden_count: 2,
      total_count: 5,
      truncated: true,
    });
    // 表示件数 + 隠れ件数 = 総件数（隠れ件数の一致）。
    const contraDetails = contraindicationTruncation[0]?.details as {
      shown_count: number;
      hidden_count: number;
      total_count: number;
    };
    expect(contraDetails.shown_count + contraDetails.hidden_count).toBe(contraDetails.total_count);
    expect(contraindicationAlerts).toHaveLength(contraDetails.shown_count);

    // 重大な副作用: 上限 2 件表示 + 隠れ 1 件の marker。
    const adverseAlerts = alerts.filter((alert) => alert.type === 'package_insert_adverse_effect');
    expect(adverseAlerts).toHaveLength(2);
    const adverseTruncation = alerts.filter(
      (alert) => alert.type === 'package_insert_adverse_effect_truncated',
    );
    expect(adverseTruncation).toHaveLength(1);
    expect(adverseTruncation[0]?.details).toMatchObject({
      shown_count: 2,
      hidden_count: 1,
      total_count: 3,
    });

    // 高齢者注意: 上限 2 件表示 + 隠れ 1 件の marker。
    const elderlyAlerts = alerts.filter((alert) => alert.type === 'package_insert_elderly');
    expect(elderlyAlerts).toHaveLength(2);
    const elderlyTruncation = alerts.filter(
      (alert) => alert.type === 'package_insert_elderly_truncated',
    );
    expect(elderlyTruncation).toHaveLength(1);
    expect(elderlyTruncation[0]?.details).toMatchObject({
      shown_count: 2,
      hidden_count: 1,
      total_count: 3,
    });
  });

  it('X05: emits no truncation marker when package insert entries are within the display limit', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'テスト薬D錠',
        drug_code: '7777002',
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
        yj_code: '7777002',
        drug_name: 'テスト薬D錠',
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
          drug_master: { yj_code: '7777002', drug_name: 'テスト薬D錠' },
          contraindications: [{ text: '禁忌1' }, { text: '禁忌2' }],
          adverse_effects: [{ text: '重大副作用A', severity: 'serious' }],
          precautions_elderly: [{ text: '高齢者注意1' }],
        },
      ];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts.filter((alert) => alert.type.endsWith('_truncated'))).toHaveLength(0);
    expect(alerts.filter((alert) => alert.type === 'package_insert_contraindication')).toHaveLength(
      2,
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

  it('X04: surfaces an unchecked coverage notice (not silent-clean) when eGFR is unrecorded but a renal-adjusted drug is prescribed', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_renal_1',
        drug_name: '腎機能調整薬錠',
        drug_code: '8888001',
        dose: '1錠',
        frequency: '1日1回',
        days: 7,
      },
    ]);
    // eGFR 未記録（PatientLabObservation に該当なし）
    patientLabObservationFindFirstMock.mockResolvedValue(null);
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
          dosage_adjustment_renal: [{ egfr_min: 30, egfr_max: 60, recommendation: '45では減量' }],
        },
      ];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    // eGFR 未記録なので判定（renal_dose）は出さない
    expect(alerts.filter((alert) => alert.type === 'renal_dose')).toEqual([]);
    // 無言 clean に倒さず「未チェック（要確認）」coverage notice を必ず出す
    const coverage = alerts.filter(
      (alert) =>
        alert.type === 'cds_data_quality' && alert.details?.source === 'renal_dose_coverage',
    );
    expect(coverage).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('腎機能用量チェック未完了'),
        details: expect.objectContaining({
          source: 'renal_dose_coverage',
          unchecked_drug_count: 1,
          unchecked_drug_names: ['腎機能調整薬錠'],
          unchecked_drug_codes: ['8888001'],
        }),
      }),
    ]);
  });

  it('X04: stays quiet when eGFR is unrecorded and no prescribed drug has renal dose-adjustment data', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_plain_1',
        drug_name: '非腎排泄薬錠',
        drug_code: '7777001',
        dose: '1錠',
        frequency: '1日1回',
        days: 7,
      },
    ]);
    patientLabObservationFindFirstMock.mockResolvedValue(null);
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_2',
        yj_code: '7777001',
        drug_name: '非腎排泄薬錠',
        tall_man_name: null,
        therapeutic_category: '9998',
        max_administration_days: null,
        transitional_expiry_date: null,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: false,
        is_lasa_risk: false,
        lasa_group_key: null,
      },
    ]);
    // 腎機能用量調整データを持つ添付文書なし
    drugPackageInsertFindManyMock.mockResolvedValue([]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    // 照合対象が無いので coverage notice も判定も出さない（ノイズを出さない）
    expect(
      alerts.filter(
        (alert) =>
          alert.type === 'cds_data_quality' && alert.details?.source === 'renal_dose_coverage',
      ),
    ).toEqual([]);
    expect(alerts.filter((alert) => alert.type === 'renal_dose')).toEqual([]);
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

  it('X02: still raises a name-based allergy alert for a prescription line whose drug_code is unresolved', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_allergy_nullcode',
        drug_name: 'アムロジピン錠5mg',
        drug_master_id: null,
        drug_code: null,
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
          category: 'drug',
          severity: 'severe',
        },
      ],
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    // Previously the null drug_code caused the whole line to be skipped (no alert at all).
    const allergyCross = alerts.filter((a) => a.type === 'allergy_cross');
    expect(allergyCross).toEqual([
      expect.objectContaining({
        type: 'allergy_cross',
        severity: 'critical',
        details: expect.objectContaining({
          allergy_drug: 'アムロジピン',
          prescribed_drug: 'アムロジピン錠5mg',
        }),
      }),
    ]);
    // prescribed_drug_code must be omitted because the code is unresolved.
    expect(allergyCross[0].details).not.toHaveProperty('prescribed_drug_code');
  });

  it('X02: emits an allergy cross-check-incomplete (要確認) alert when a prescription line drug_code is unresolved', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_allergy_nullcode',
        drug_name: '未解決の外用薬',
        drug_master_id: null,
        drug_code: null,
        dose: '1本',
        frequency: '1日2回',
        days: 14,
      },
    ]);
    // Patient DOES have a (structured) known allergy — the unresolved line means the
    // code/category cross-check could not run, so it must fail toward 要確認.
    patientFindFirstMock.mockResolvedValue({
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      allergy_info: [
        {
          drug_name: 'ペニシリン',
          drug_code: '6111001',
          category: 'drug',
          severity: 'severe',
        },
      ],
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'cds_data_quality',
          severity: 'warning',
          details: expect.objectContaining({
            source: 'allergy_cross_check',
            line_id: 'line_allergy_nullcode',
            unresolved: 'drug_code',
          }),
        }),
      ]),
    );
    // It must NOT be silently treated as allergy-clean: the incomplete signal is present.
    expect(
      alerts.some(
        (a) => a.type === 'cds_data_quality' && a.details?.source === 'allergy_cross_check',
      ),
    ).toBe(true);
  });

  it('does not emit an allergy cross-check-incomplete alert when the line drug_code resolves', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_allergy_resolved',
        drug_name: 'アムロジピン錠5mg',
        drug_master_id: null,
        drug_code: '2149001F1020',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    patientFindFirstMock.mockResolvedValue({
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      allergy_info: [{ drug_name: 'ペニシリン', drug_code: '6111001', severity: 'severe' }],
    });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_resolved',
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

    expect(
      alerts.some(
        (a) => a.type === 'cds_data_quality' && a.details?.source === 'allergy_cross_check',
      ),
    ).toBe(false);
  });

  it('CXR1-MSR01: flags legacy free-text (string) allergy_info as unstructured (要確認) instead of allergy-clean', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'アモキシシリンカプセル250mg',
        drug_master_id: null,
        drug_code: '6111001F1020',
        dose: '1cap',
        frequency: '1日3回',
        days: 7,
      },
    ]);
    patientFindFirstMock.mockResolvedValue({
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      allergy_info: 'ペニシリンアレルギーあり', // legacy free-text form
    });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
        yj_code: '6111001F1020',
        drug_name: 'アモキシシリンカプセル250mg',
        tall_man_name: null,
        therapeutic_category: '6111',
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
          type: 'cds_data_quality',
          severity: 'warning',
          details: expect.objectContaining({ source: 'allergy_info_format' }),
        }),
      ]),
    );
  });

  it('CXR1-MSR01: uses a legacy single-object allergy_info entry for cross-checking', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_current_1',
        drug_name: 'アムロジピン錠5mg',
        drug_master_id: null,
        drug_code: '2149001F1020',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    // Legacy object form (not wrapped in an array).
    patientFindFirstMock.mockResolvedValue({
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      allergy_info: {
        drug_name: 'アムロジピン',
        drug_code: '2149001F1020',
        category: 'drug',
        severity: 'moderate',
      },
    });
    drugMasterFindManyMock.mockResolvedValue([
      {
        id: 'drug_1',
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
          details: expect.objectContaining({
            allergy_drug_code: '2149001F1020',
            prescribed_drug_code: '2149001F1020',
          }),
        }),
      ]),
    );
    // A structured legacy object must NOT be flagged as unstructured.
    expect(
      alerts.some(
        (a) => a.type === 'cds_data_quality' && a.details?.source === 'allergy_info_format',
      ),
    ).toBe(false);
  });

  // CDS-CATEGORY-DISABLE-COLLATERAL-001:
  // カスタム DrugAlertRule を1件 is_active=false にしても、組み込みの患者データ
  // チェック（allergy_info クロスチェック、interaction、renal など）と fail-close
  // カバレッジ通知は決して無効化されてはならない。以前はカテゴリ enablement を
  // per-rule is_active から算出していたため、単一の非アクティブルールが重篤アレルギー
  // 等の組み込みチェックを無言で消していた（患者安全 false-negative）。
  it('CDS-CATEGORY-DISABLE-COLLATERAL-001: still fires the built-in allergy_info cross-check (and its X02 coverage notice) when the org has an inactive allergy_cross custom rule', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_allergy_nullcode',
        drug_name: 'アムロジピン錠5mg',
        drug_master_id: null,
        drug_code: null,
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
          category: 'drug',
          severity: 'severe',
        },
      ],
    });
    // The org has exactly ONE custom allergy_cross rule and it is inactive.
    // - The legacy managed-state probe (`alert_type: { in: [...] }`) would have seen an
    //   inactive rule and disabled the whole allergy category.
    // - The per-category custom-rule query filters `is_active: true`, so a real DB returns
    //   nothing for the inactive rule (mocked as []).
    drugAlertRuleFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.alert_type?.in) {
        return [{ alert_type: 'allergy_cross', is_active: false }];
      }
      return [];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    // Built-in allergy cross-check must still fire the critical alert — NOT [].
    const allergyCross = alerts.filter((a) => a.type === 'allergy_cross');
    expect(allergyCross).toEqual([
      expect.objectContaining({
        type: 'allergy_cross',
        severity: 'critical',
        details: expect.objectContaining({
          allergy_drug: 'アムロジピン',
          prescribed_drug: 'アムロジピン錠5mg',
        }),
      }),
    ]);
    // The X02 fail-close coverage notice (unresolved drug_code) must still emit.
    expect(
      alerts.some(
        (a) => a.type === 'cds_data_quality' && a.details?.source === 'allergy_cross_check',
      ),
    ).toBe(true);
  });

  it('CDS-CATEGORY-DISABLE-COLLATERAL-001: still fires the built-in interaction check when the org has an inactive interaction custom rule', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_interaction_1',
        drug_name: 'ワルファリンK錠1mg',
        drug_master_id: null,
        drug_code: '3332001',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    medicationProfileFindManyMock.mockResolvedValue([
      {
        id: 'profile_aspirin',
        drug_name: 'アスピリン腸溶錠100mg',
        drug_master_id: 'drug_med',
      },
    ]);
    drugMasterFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.id) {
        return [
          {
            id: 'drug_med',
            yj_code: '3399001',
            drug_name: 'アスピリン腸溶錠100mg',
            tall_man_name: null,
            therapeutic_category: '3399',
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
      if (args?.where?.yj_code) {
        return [
          {
            id: 'drug_line',
            yj_code: '3332001',
            drug_name: 'ワルファリンK錠1mg',
            tall_man_name: null,
            therapeutic_category: '3332',
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
    drugInteractionFindManyMock.mockResolvedValue([
      {
        severity: 'contraindicated',
        mechanism: '抗凝固作用増強',
        clinical_effect: '出血リスク',
        drug_a: { yj_code: '3332001' },
        drug_b: { yj_code: '3399001' },
      },
    ]);
    // One inactive interaction custom rule present in the org.
    drugAlertRuleFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.alert_type?.in) {
        return [{ alert_type: 'interaction', is_active: false }];
      }
      return [];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'interaction',
          severity: 'critical',
          message: expect.stringContaining('併用禁忌'),
        }),
      ]),
    );
  });

  it('CDS-CATEGORY-DISABLE-COLLATERAL-001: still emits the built-in renal X04 coverage notice when the org has an inactive renal_dose custom rule', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_renal_1',
        drug_name: '腎機能調整薬錠',
        drug_code: '8888001',
        dose: '1錠',
        frequency: '1日1回',
        days: 7,
      },
    ]);
    // eGFR unrecorded → the built-in check must fail-close with a coverage notice.
    patientLabObservationFindFirstMock.mockResolvedValue(null);
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
          dosage_adjustment_renal: [{ egfr_min: 30, egfr_max: 60, recommendation: '45では減量' }],
        },
      ];
    });
    // One inactive renal_dose custom rule present in the org.
    drugAlertRuleFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.alert_type?.in) {
        return [{ alert_type: 'renal_dose', is_active: false }];
      }
      return [];
    });

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    expect(
      alerts.filter(
        (alert) =>
          alert.type === 'cds_data_quality' && alert.details?.source === 'renal_dose_coverage',
      ),
    ).toEqual([
      expect.objectContaining({
        severity: 'warning',
        details: expect.objectContaining({ source: 'renal_dose_coverage' }),
      }),
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

  it('F81: warns that an identity-unresolved current medication is excluded from the interaction cross-check', async () => {
    // Prescription line resolves cleanly (drug_code present) so it is NOT counted as unresolved.
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_resolved_1',
        drug_name: 'ワルファリンK錠1mg',
        drug_master_id: null,
        drug_code: '3332001',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    // Current medication has no drug_master_id → cannot resolve to DrugMaster → checkInteractions
    // silently skips it. This must now surface as a data-quality (要確認) alert.
    medicationProfileFindManyMock.mockResolvedValue([
      {
        id: 'profile_unresolved',
        drug_name: '未解決の併用薬',
        drug_master_id: null,
      },
    ]);
    drugMasterFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.yj_code) {
        return [
          {
            id: 'drug_line',
            yj_code: '3332001',
            drug_name: 'ワルファリンK錠1mg',
            tall_man_name: null,
            therapeutic_category: '3332',
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

    const identityAlerts = alerts.filter(
      (a) => a.type === 'cds_data_quality' && a.details?.source === 'cds_identity_unresolved',
    );
    expect(identityAlerts).toHaveLength(1);
    expect(identityAlerts[0]).toMatchObject({
      type: 'cds_data_quality',
      severity: 'warning',
      details: {
        source: 'cds_identity_unresolved',
        unresolved_current_med_count: 1,
        unresolved_prescription_line_count: 0,
        unresolved_current_med_ids: ['profile_unresolved'],
        unresolved_prescription_line_ids: [],
      },
    });
    expect(identityAlerts[0].message).toContain('併用薬1件');
  });

  it('X03: warns that a fully identity-unresolved prescription line is excluded from code-based CDS checks', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_unresolved_1',
        drug_name: 'コード未解決の外用薬',
        drug_master_id: null,
        drug_code: null,
        dose: '1本',
        frequency: '1日2回',
        days: 14,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    const identityAlerts = alerts.filter(
      (a) => a.type === 'cds_data_quality' && a.details?.source === 'cds_identity_unresolved',
    );
    expect(identityAlerts).toHaveLength(1);
    expect(identityAlerts[0]).toMatchObject({
      severity: 'warning',
      details: {
        source: 'cds_identity_unresolved',
        unresolved_prescription_line_count: 1,
        unresolved_current_med_count: 0,
        unresolved_prescription_line_ids: ['line_unresolved_1'],
        unresolved_current_med_ids: [],
      },
    });
    expect(identityAlerts[0].message).toContain('処方1件');
  });

  it('F81+X03: aggregates both unresolved prescription lines and current meds into one 要確認 alert', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_unresolved_1',
        drug_name: 'コード未解決薬',
        drug_master_id: null,
        drug_code: null,
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    medicationProfileFindManyMock.mockResolvedValue([
      {
        id: 'profile_unresolved',
        drug_name: '未解決の併用薬',
        drug_master_id: null,
      },
    ]);

    const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

    const identityAlerts = alerts.filter(
      (a) => a.type === 'cds_data_quality' && a.details?.source === 'cds_identity_unresolved',
    );
    expect(identityAlerts).toHaveLength(1);
    expect(identityAlerts[0].details).toMatchObject({
      unresolved_prescription_line_count: 1,
      unresolved_current_med_count: 1,
    });
    expect(identityAlerts[0].message).toContain('2件');
    expect(identityAlerts[0].message).toContain('処方1件');
    expect(identityAlerts[0].message).toContain('併用薬1件');
  });

  it('does not emit an identity-unresolved alert when every prescription line and current med resolves', async () => {
    prescriptionLineFindManyMock.mockResolvedValue([
      {
        id: 'line_resolved_1',
        drug_name: 'ワルファリンK錠1mg',
        drug_master_id: null,
        drug_code: '3332001',
        dose: '1錠',
        frequency: '1日1回',
        days: 14,
      },
    ]);
    medicationProfileFindManyMock.mockResolvedValue([
      {
        id: 'profile_resolved',
        drug_name: '解決済み併用薬',
        drug_master_id: 'drug_current',
      },
    ]);
    drugMasterFindManyMock.mockImplementation(async (args) => {
      if (args?.where?.id) {
        return [
          {
            id: 'drug_current',
            yj_code: 'YJ_CURRENT',
            drug_name: '解決済み併用薬',
            therapeutic_category: '2149',
          },
        ];
      }
      if (args?.where?.yj_code) {
        return [
          {
            id: 'drug_line',
            yj_code: '3332001',
            drug_name: 'ワルファリンK錠1mg',
            tall_man_name: null,
            therapeutic_category: '3332',
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

    expect(
      alerts.some(
        (a) => a.type === 'cds_data_quality' && a.details?.source === 'cds_identity_unresolved',
      ),
    ).toBe(false);
  });

  describe('病名／問題リスト禁忌クロスチェック (F82)', () => {
    const coverageNotices = (alerts: Awaited<ReturnType<typeof checkDispenseAlerts>>) =>
      alerts.filter(
        (a) =>
          a.type === 'cds_data_quality' &&
          a.details?.source === 'condition_contraindication_coverage',
      );

    it('病名が禁忌欄テキストに一致したら critical を surface し、常に coverage notice も出す', async () => {
      prescriptionLineFindManyMock.mockResolvedValue([
        {
          id: 'line_1',
          drug_name: 'チモロール点眼液0.5%',
          drug_master_id: null,
          drug_code: '1319001',
          dose: '1回1滴',
          frequency: '1日2回',
          days: 30,
        },
      ]);
      patientConditionFindManyMock.mockResolvedValue([
        { name: '気管支喘息', condition_type: 'disease' },
        // 表記ゆれ: 禁忌欄は「緑内障」だが病名は「閉塞隅角緑内障」→ 名称照合では一致しない
        { name: '閉塞隅角緑内障', condition_type: 'disease' },
      ]);
      drugPackageInsertFindManyMock.mockImplementation(async (args) => {
        if (args?.where?.dosage_adjustment_renal) return [];
        return [
          {
            drug_master: { yj_code: '1319001', drug_name: 'チモロール点眼液0.5%' },
            contraindications: ['気管支喘息の患者には投与しないこと', { text: '重症筋無力症' }],
          },
        ];
      });

      const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

      // (2) fail-safe: 一致した病名は critical で surface
      const conditionAlerts = alerts.filter((a) => a.type === 'condition_contraindication');
      expect(conditionAlerts).toEqual([
        expect.objectContaining({
          type: 'condition_contraindication',
          severity: 'critical',
          message: expect.stringContaining('気管支喘息'),
          details: expect.objectContaining({
            source: 'condition_contraindication',
            drug_code: '1319001',
            condition_name: '気管支喘息',
            condition_type: 'disease',
          }),
        }),
      ]);
      // 表記ゆれで一致しなかった病名は surface されない（＝false-negative は起こりうる）
      expect(conditionAlerts.some((a) => a.details?.condition_name === '閉塞隅角緑内障')).toBe(
        false,
      );

      // (1) fail-close: 取りこぼしを補う coverage notice が必ず1件出る
      const notices = coverageNotices(alerts);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toEqual(
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('病名禁忌チェック未完了'),
          details: expect.objectContaining({
            condition_count: 2,
            condition_names: ['気管支喘息', '閉塞隅角緑内障'],
          }),
        }),
      );
    });

    it('病名／問題が無ければ coverage notice も condition_contraindication も出さない', async () => {
      prescriptionLineFindManyMock.mockResolvedValue([
        {
          id: 'line_1',
          drug_name: 'チモロール点眼液0.5%',
          drug_master_id: null,
          drug_code: '1319001',
          dose: '1回1滴',
          frequency: '1日2回',
          days: 30,
        },
      ]);
      patientConditionFindManyMock.mockResolvedValue([]);
      drugPackageInsertFindManyMock.mockImplementation(async (args) => {
        if (args?.where?.dosage_adjustment_renal) return [];
        return [
          {
            drug_master: { yj_code: '1319001', drug_name: 'チモロール点眼液0.5%' },
            contraindications: ['気管支喘息の患者には投与しないこと'],
          },
        ];
      });

      const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

      expect(coverageNotices(alerts)).toHaveLength(0);
      expect(alerts.some((a) => a.type === 'condition_contraindication')).toBe(false);
    });

    it('病名はあるが照合先データが無くても coverage notice は必ず出す（fail-close）', async () => {
      prescriptionLineFindManyMock.mockResolvedValue([
        {
          id: 'line_1',
          drug_name: 'アセトアミノフェン錠',
          drug_master_id: null,
          drug_code: '1141001',
          dose: '1錠',
          frequency: '1日3回',
          days: 14,
        },
      ]);
      patientConditionFindManyMock.mockResolvedValue([
        { name: '重症筋無力症', condition_type: 'disease' },
      ]);
      // 添付文書データ無し（禁忌欄で照合できない）
      drugPackageInsertFindManyMock.mockResolvedValue([]);

      const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

      const notices = coverageNotices(alerts);
      expect(notices).toHaveLength(1);
      expect(notices[0].details).toEqual(
        expect.objectContaining({ condition_count: 1, condition_names: ['重症筋無力症'] }),
      );
      // 照合先が無いので critical は上げない（無言 clean に倒さず coverage で宣言）
      expect(alerts.some((a) => a.type === 'condition_contraindication')).toBe(false);
    });

    it('1文字病名は名称照合の暴発を避けて surface しないが coverage notice は出す', async () => {
      prescriptionLineFindManyMock.mockResolvedValue([
        {
          id: 'line_1',
          drug_name: '抗がん剤X',
          drug_master_id: null,
          drug_code: '4200001',
          dose: '1錠',
          frequency: '1日1回',
          days: 14,
        },
      ]);
      patientConditionFindManyMock.mockResolvedValue([{ name: '癌', condition_type: 'problem' }]);
      drugPackageInsertFindManyMock.mockImplementation(async (args) => {
        if (args?.where?.dosage_adjustment_renal) return [];
        return [
          {
            drug_master: { yj_code: '4200001', drug_name: '抗がん剤X' },
            contraindications: ['癌の既往のある患者'],
          },
        ];
      });

      const alerts = await checkDispenseAlerts('org_1', 'cycle_current', 'patient_1');

      expect(alerts.some((a) => a.type === 'condition_contraindication')).toBe(false);
      expect(coverageNotices(alerts)).toHaveLength(1);
    });
  });
});
