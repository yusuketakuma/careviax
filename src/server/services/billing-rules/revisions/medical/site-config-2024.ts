/**
 * 薬局情報 — 医療保険(診療報酬) 令和6年度(2024)改定
 *
 * PharmacySiteInsuranceConfig.config (Json) に格納する型。
 * 改定で項目が変わった場合は site-config-2026.ts を新規作成し、
 * DB マイグレーション不要で対応できる。
 */

// ── 調剤基本料 (処方箋受付1回) ──
export type DispensingFeeCategory2024 =
  | 'basic_1'     // 45点
  | 'basic_2'     // 29点
  | 'basic_3_i'   // 24点
  | 'basic_3_ro'  // 19点
  | 'basic_3_ha'  // 35点
  | 'special_a'   // 5点
  | 'special_b';  // 3点

export const DISPENSING_FEE_POINTS_2024: Record<DispensingFeeCategory2024, number> = {
  basic_1: 45,
  basic_2: 29,
  basic_3_i: 24,
  basic_3_ro: 19,
  basic_3_ha: 35,
  special_a: 5,
  special_b: 3,
};

// ── 地域支援体制加算 (処方箋受付1回) ──
export type RegionalSupportLevel2024 =
  | 'level_1'  // 32点 (調剤基本料1算定薬局向け)
  | 'level_2'  // 40点 (調剤基本料1算定薬局向け・上位)
  | 'level_3'  // 10点 (調剤基本料1以外の薬局向け)
  | 'level_4'; // 32点 (調剤基本料1以外の薬局向け・上位)

export const REGIONAL_SUPPORT_POINTS_2024: Record<RegionalSupportLevel2024, number> = {
  level_1: 32,
  level_2: 40,
  level_3: 10,
  level_4: 32,
};

// ── 後発医薬品調剤体制加算 (処方箋受付1回) ──
export type GenericDispensingLevel2024 =
  | 'level_1'  // 21点 (80%以上)
  | 'level_2'  // 28点 (85%以上)
  | 'level_3'; // 30点 (90%以上)

export const GENERIC_DISPENSING_POINTS_2024: Record<GenericDispensingLevel2024, number> = {
  level_1: 21,
  level_2: 28,
  level_3: 30,
};

// ── 在宅薬学総合体制加算 (訪問1回) ──
export type HomeComprehensiveLevel2024 =
  | 'level_1'  // 15点
  | 'level_2'; // 50点

export const HOME_COMPREHENSIVE_POINTS_2024: Record<HomeComprehensiveLevel2024, number> = {
  level_1: 15,
  level_2: 50,
};

// ── 薬局情報 config 型 (PharmacySiteInsuranceConfig.config に格納) ──
export type MedicalSiteConfig2024 = {
  // 調剤基本料
  dispensing_fee_category?: DispensingFeeCategory2024;

  // 体制加算 (処方箋受付1回)
  regional_support_level?: RegionalSupportLevel2024;
  generic_dispensing_level?: GenericDispensingLevel2024;
  cooperation_enhancement?: boolean;      // 連携強化加算 5点
  medical_dx_promotion?: boolean;         // 医療DX推進体制整備加算 4点

  // 在宅関連体制加算 (訪問1回)
  home_comprehensive_level?: HomeComprehensiveLevel2024;

  // 免許・許可
  narcotic_dealer_license?: boolean;          // 麻薬小売業者の免許
  high_care_medical_device_license?: boolean; // 高度管理医療機器販売業の許可
};

/** 点数解決: config から在宅薬学総合体制加算の点数を取得 */
export function resolveHomeComprehensivePoints(config: MedicalSiteConfig2024): number {
  if (!config.home_comprehensive_level) return 0;
  return HOME_COMPREHENSIVE_POINTS_2024[config.home_comprehensive_level] ?? 0;
}
