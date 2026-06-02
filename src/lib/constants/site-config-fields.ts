/**
 * 薬局保険設定フォーム — 改定別フィールド定義
 *
 * 改定コードに応じて管理画面のドロップダウン・チェックボックスの
 * ラベルと選択肢を切り替える。
 * 点数は official-2024.ts / official-2026.ts と一致させること。
 */

// ── 型定義 ──

export type ConfigSelectField = {
  key: string;
  label: string;
  options: readonly (readonly [string, string])[];
};

export type ConfigBoolField = {
  key: string;
  label: string;
};

export type RevisionConfigFields = {
  configFields: readonly ConfigSelectField[];
  boolFields: readonly ConfigBoolField[];
};

export type RevisionMeta = {
  code: string;
  label: string;
  effectiveFrom: string;
};

// ── 改定メタデータ ──

export const MEDICAL_AVAILABLE_REVISIONS: readonly RevisionMeta[] = [
  { code: '2024', label: '令和6年度改定', effectiveFrom: '2024-06-01' },
  { code: '2026', label: '令和8年度改定', effectiveFrom: '2026-06-01' },
] as const;

export const CARE_AVAILABLE_REVISIONS: readonly RevisionMeta[] = [
  { code: '2024', label: '令和6年度改定', effectiveFrom: '2024-04-01' },
] as const;

// ── 2024改定 フィールド定義 ──

const MEDICAL_CONFIG_FIELDS_2024: readonly ConfigSelectField[] = [
  {
    key: 'dispensing_fee_category',
    label: '調剤基本料',
    options: [
      ['basic_1', '基本料1 (45点)'],
      ['basic_2', '基本料2 (29点)'],
      ['basic_3_i', '基本料3イ (24点)'],
      ['basic_3_ro', '基本料3ロ (19点)'],
      ['basic_3_ha', '基本料3ハ (35点)'],
      ['special_a', '特別調剤基本料A (5点)'],
      ['special_b', '特別調剤基本料B (3点)'],
    ],
  },
  {
    key: 'regional_support_level',
    label: '地域支援体制加算',
    options: [
      ['', 'なし'],
      ['level_1', '加算1 (32点)'],
      ['level_2', '加算2 (40点)'],
      ['level_3', '加算3 (10点)'],
      ['level_4', '加算4 (32点)'],
    ],
  },
  {
    key: 'generic_dispensing_level',
    label: '後発医薬品調剤体制加算',
    options: [
      ['', 'なし'],
      ['level_1', '加算1 (21点/80%以上)'],
      ['level_2', '加算2 (28点/85%以上)'],
      ['level_3', '加算3 (30点/90%以上)'],
    ],
  },
  {
    key: 'home_comprehensive_level',
    label: '在宅薬学総合体制加算',
    options: [
      ['', 'なし'],
      ['level_1', '加算1 (15点)'],
      ['level_2', '加算2 (50点)'],
    ],
  },
] as const;

const MEDICAL_BOOL_FIELDS_2024: readonly ConfigBoolField[] = [
  { key: 'cooperation_enhancement', label: '連携強化加算 (5点)' },
  { key: 'medical_dx_promotion', label: '医療DX推進体制整備加算 (4点)' },
  { key: 'narcotic_dealer_license', label: '麻薬小売業者の免許' },
  { key: 'high_care_medical_device_license', label: '高度管理医療機器販売業の許可' },
] as const;

// ── 2026改定 フィールド定義 ──

const MEDICAL_CONFIG_FIELDS_2026: readonly ConfigSelectField[] = [
  {
    key: 'dispensing_fee_category',
    label: '調剤基本料',
    options: [
      ['basic_1', '基本料1 (47点)'],
      ['basic_2', '基本料2 (30点)'],
      ['basic_3_i', '基本料3イ (25点)'],
      ['basic_3_ro', '基本料3ロ (20点)'],
      ['basic_3_ha', '基本料3ハ (37点)'],
      ['special_a', '特別調剤基本料A (5点)'],
      ['special_b', '特別調剤基本料B (3点)'],
    ],
  },
  {
    key: 'regional_support_level',
    label: '地域支援体制加算',
    options: [
      ['', 'なし'],
      ['level_1', '加算1 (27点)'],
      ['level_2', '加算2 (59点)'],
      ['level_3', '加算3 (67点)'],
      ['level_4', '加算4 (37点)'],
      ['level_5', '加算5 (59点)'],
    ],
  },
  {
    key: 'generic_dispensing_level',
    label: '後発医薬品調剤体制加算',
    options: [
      ['', 'なし'],
      ['level_1', '加算1 (21点/80%以上)'],
      ['level_2', '加算2 (28点/85%以上)'],
      ['level_3', '加算3 (30点/90%以上)'],
    ],
  },
  {
    key: 'home_comprehensive_level',
    label: '在宅薬学総合体制加算',
    options: [
      ['', 'なし'],
      ['level_1', '加算1 (30点)'],
      ['level_2', '加算2 (単一建物1人 100点 / その他 50点)'],
    ],
  },
] as const;

const MEDICAL_BOOL_FIELDS_2026: readonly ConfigBoolField[] = [
  { key: 'cooperation_enhancement', label: '連携強化加算 (5点)' },
  { key: 'medical_dx_promotion', label: '医療DX推進体制整備加算 (8点)' },
  {
    key: 'dispensing_base_up_evaluation',
    label: '調剤ベースアップ評価料 (4点 / 2027年6月以降 8点)',
  },
  { key: 'dispensing_price_response', label: '調剤物価対応料 (1点 / 3月に1回・2027年6月以降 2点)' },
  { key: 'narcotic_dealer_license', label: '麻薬小売業者の免許' },
  { key: 'high_care_medical_device_license', label: '高度管理医療機器販売業の許可' },
] as const;

// ── 介護保険 フィールド定義（改定共通） ──

export const CARE_BOOL_FIELDS: readonly ConfigBoolField[] = [
  { key: 'region_special_15', label: '特別地域加算 (15%)' },
  { key: 'region_small_office_10', label: '中山間地域等小規模事業所加算 (10%)' },
  { key: 'region_resident_5', label: '中山間地域等居住者サービス提供加算 (5%)' },
  { key: 'narcotic_dealer_license', label: '麻薬小売業者の免許' },
  { key: 'high_care_medical_device_license', label: '高度管理医療機器販売業の許可' },
] as const;

// ── 改定別フィールド解決 ──

const MEDICAL_FIELDS_BY_REVISION: Record<string, RevisionConfigFields> = {
  '2024': { configFields: MEDICAL_CONFIG_FIELDS_2024, boolFields: MEDICAL_BOOL_FIELDS_2024 },
  '2026': { configFields: MEDICAL_CONFIG_FIELDS_2026, boolFields: MEDICAL_BOOL_FIELDS_2026 },
};

/**
 * 改定コードに応じた医療保険フォームフィールド定義を返す。
 * 未知の改定コードの場合は最新の改定定義にフォールバック。
 */
export function getMedicalConfigFields(revisionCode: string): RevisionConfigFields {
  return MEDICAL_FIELDS_BY_REVISION[revisionCode] ?? MEDICAL_FIELDS_BY_REVISION['2026'];
}

export function getAvailableRevisions(insuranceType: string): readonly RevisionMeta[] {
  return insuranceType === 'care' ? CARE_AVAILABLE_REVISIONS : MEDICAL_AVAILABLE_REVISIONS;
}

/**
 * 今日の日付に基づくデフォルトの改定コードを返す。
 * 施行日の3か月前から次改定をデフォルトにする。
 */
export function getDefaultRevisionCode(insuranceType: string = 'medical'): string {
  const revisions = getAvailableRevisions(insuranceType);
  const today = new Date();
  // 新しい改定から順にチェック（施行3か月前からデフォルト対象）
  for (let i = revisions.length - 1; i >= 0; i--) {
    const rev = revisions[i];
    const notifyDate = new Date(rev.effectiveFrom);
    notifyDate.setMonth(notifyDate.getMonth() - 3);
    if (today >= notifyDate) return rev.code;
  }
  return revisions[0].code;
}

/**
 * 改定コードからメタデータを取得する。
 */
export function getRevisionMeta(
  revisionCode: string,
  insuranceType: string = 'medical',
): RevisionMeta | undefined {
  return getAvailableRevisions(insuranceType).find((r) => r.code === revisionCode);
}

export function normalizeInsuranceConfigForRevision(args: {
  insuranceType: string;
  revisionCode: string;
  config: Record<string, unknown>;
}): Record<string, unknown> {
  if (
    args.insuranceType === 'medical' &&
    args.revisionCode === '2026' &&
    (args.config.home_comprehensive_level === 'level_2_i' ||
      args.config.home_comprehensive_level === 'level_2_ro')
  ) {
    return {
      ...args.config,
      home_comprehensive_level: 'level_2',
    };
  }
  return { ...args.config };
}
