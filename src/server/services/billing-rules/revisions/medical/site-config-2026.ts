/**
 * 薬局情報 — 医療保険(診療報酬) 令和8年度(2026)改定
 *
 * PharmacySiteInsuranceConfig.config (Json) に格納する型。
 */

// ── 調剤基本料 (処方箋受付1回) ──
export type DispensingFeeCategory2026 =
  | 'basic_1' // 47点
  | 'basic_2' // 30点
  | 'basic_3_i' // 25点
  | 'basic_3_ro' // 20点
  | 'basic_3_ha' // 37点
  | 'special_a' // 5点
  | 'special_b'; // 3点

export const DISPENSING_FEE_POINTS_2026: Record<DispensingFeeCategory2026, number> = {
  basic_1: 47,
  basic_2: 30,
  basic_3_i: 25,
  basic_3_ro: 20,
  basic_3_ha: 37,
  special_a: 5,
  special_b: 3,
};

// ── 地域支援体制加算 (処方箋受付1回) ──
export type RegionalSupportLevel2026 =
  | 'level_1' // 27点
  | 'level_2' // 59点
  | 'level_3' // 67点
  | 'level_4' // 37点
  | 'level_5'; // 59点

export const REGIONAL_SUPPORT_POINTS_2026: Record<RegionalSupportLevel2026, number> = {
  level_1: 27,
  level_2: 59,
  level_3: 67,
  level_4: 37,
  level_5: 59,
};

// ── 後発医薬品調剤体制加算 (処方箋受付1回) ──
export type GenericDispensingLevel2026 =
  | 'level_1' // 21点
  | 'level_2' // 28点
  | 'level_3'; // 30点

export const GENERIC_DISPENSING_POINTS_2026: Record<GenericDispensingLevel2026, number> = {
  level_1: 21,
  level_2: 28,
  level_3: 30,
};

// ── 在宅薬学総合体制加算 (訪問1回) ──
// 2026改定: 薬局の届出は加算1/2の2段階のまま。
// ただし加算2の点数は訪問時の建物区分で変わるため、site config には
// 「加算2の届出がある」事実だけを保持し、点数は訪問時に解決する。
export type HomeComprehensiveLevel2026 =
  | 'level_1' // 30点
  | 'level_2'; // 単一建物1人: 100点 / その他: 50点

export type HomeComprehensiveVisitTier2026 = 'single' | 'other';

export const HOME_COMPREHENSIVE_POINTS_2026: Record<
  HomeComprehensiveLevel2026,
  Record<HomeComprehensiveVisitTier2026, number>
> = {
  level_1: {
    single: 30,
    other: 30,
  },
  level_2: {
    single: 100,
    other: 50,
  },
};

// ── 連携強化加算・医療DX推進体制整備加算・その他 ──
export const COOPERATION_ENHANCEMENT_POINTS_2026 = 5;
export const MEDICAL_DX_PROMOTION_POINTS_2026 = 8;
export const DISPENSING_BASE_UP_EVALUATION_POINTS_2026 = {
  until20270531: 4,
  from20270601: 8,
} as const;
export const DISPENSING_PRICE_RESPONSE_POINTS_2026 = {
  until20270531: 1,
  from20270601: 2,
} as const;

// ── 薬局情報 config 型 (PharmacySiteInsuranceConfig.config に格納) ──
export type MedicalSiteConfig2026 = {
  // 調剤基本料
  dispensing_fee_category?: DispensingFeeCategory2026;

  // 体制加算 (処方箋受付1回)
  regional_support_level?: RegionalSupportLevel2026;
  generic_dispensing_level?: GenericDispensingLevel2026;
  cooperation_enhancement?: boolean; // 連携強化加算
  medical_dx_promotion?: boolean; // 医療DX推進体制整備加算
  dispensing_base_up_evaluation?: boolean; // 調剤ベースアップ評価料
  dispensing_price_response?: boolean; // 調剤物価対応料

  // 在宅関連体制加算 (訪問1回) — 2026改定: 加算2がイ/ロに分割
  home_comprehensive_level?: HomeComprehensiveLevel2026;

  // 免許・許可
  narcotic_dealer_license?: boolean; // 麻薬小売業者の免許
  high_care_medical_device_license?: boolean; // 高度管理医療機器販売業の許可
};

export function normalizeHomeComprehensiveLevel2026(
  value: unknown,
): HomeComprehensiveLevel2026 | undefined {
  if (value === 'level_1') return 'level_1';
  if (value === 'level_2' || value === 'level_2_i' || value === 'level_2_ro') return 'level_2';
  return undefined;
}

/** 点数解決: config と訪問時建物区分から在宅薬学総合体制加算の点数を取得 */
export function resolveHomeComprehensivePoints2026(
  config: MedicalSiteConfig2026,
  buildingPatientCount: number,
): number {
  const level = normalizeHomeComprehensiveLevel2026(config.home_comprehensive_level);
  if (!level) return 0;
  const tier: HomeComprehensiveVisitTier2026 = buildingPatientCount <= 1 ? 'single' : 'other';
  return HOME_COMPREHENSIVE_POINTS_2026[level][tier] ?? 0;
}
