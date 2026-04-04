/**
 * 薬局情報 — 医療保険(診療報酬) 令和8年度(2026)改定
 *
 * PharmacySiteInsuranceConfig.config (Json) に格納する型。
 * TODO: 令和8年改定確定後に全点数を更新
 */

// ── 調剤基本料 (処方箋受付1回) ──
export type DispensingFeeCategory2026 =
  | 'basic_1'     // 45点 TODO: 令和8年改定確定後に更新
  | 'basic_2'     // 29点
  | 'basic_3_i'   // 24点
  | 'basic_3_ro'  // 19点
  | 'basic_3_ha'  // 35点
  | 'special_a'   // 5点
  | 'special_b';  // 3点

export const DISPENSING_FEE_POINTS_2026: Record<DispensingFeeCategory2026, number> = {
  basic_1: 45,    // TODO: 令和8年改定確定後に更新
  basic_2: 29,    // TODO: 令和8年改定確定後に更新
  basic_3_i: 24,  // TODO: 令和8年改定確定後に更新
  basic_3_ro: 19, // TODO: 令和8年改定確定後に更新
  basic_3_ha: 35, // TODO: 令和8年改定確定後に更新
  special_a: 5,   // TODO: 令和8年改定確定後に更新
  special_b: 3,   // TODO: 令和8年改定確定後に更新
};

// ── 地域支援体制加算 (処方箋受付1回) ──
export type RegionalSupportLevel2026 =
  | 'level_1'  // 32点
  | 'level_2'  // 40点
  | 'level_3'  // 10点
  | 'level_4'; // 32点

export const REGIONAL_SUPPORT_POINTS_2026: Record<RegionalSupportLevel2026, number> = {
  level_1: 32, // TODO: 令和8年改定確定後に更新
  level_2: 40, // TODO: 令和8年改定確定後に更新
  level_3: 10, // TODO: 令和8年改定確定後に更新
  level_4: 32, // TODO: 令和8年改定確定後に更新
};

// ── 後発医薬品調剤体制加算 (処方箋受付1回) ──
export type GenericDispensingLevel2026 =
  | 'level_1'  // 21点
  | 'level_2'  // 28点
  | 'level_3'; // 30点

export const GENERIC_DISPENSING_POINTS_2026: Record<GenericDispensingLevel2026, number> = {
  level_1: 21, // TODO: 令和8年改定確定後に更新
  level_2: 28, // TODO: 令和8年改定確定後に更新
  level_3: 30, // TODO: 令和8年改定確定後に更新
};

// ── 在宅薬学総合体制加算 (訪問1回) ──
export type HomeComprehensiveLevel2026 =
  | 'level_1'  // 15点
  | 'level_2'; // 50点

export const HOME_COMPREHENSIVE_POINTS_2026: Record<HomeComprehensiveLevel2026, number> = {
  level_1: 15, // TODO: 令和8年改定確定後に更新
  level_2: 50, // TODO: 令和8年改定確定後に更新
};

// ── 連携強化加算・医療DX推進体制整備加算 ──
export const COOPERATION_ENHANCEMENT_POINTS_2026 = 5;  // TODO: 令和8年改定確定後に更新
export const MEDICAL_DX_PROMOTION_POINTS_2026 = 4;     // TODO: 令和8年改定確定後に更新

// ── 薬局情報 config 型 (PharmacySiteInsuranceConfig.config に格納) ──
export type MedicalSiteConfig2026 = {
  // 調剤基本料
  dispensing_fee_category?: DispensingFeeCategory2026;

  // 体制加算 (処方箋受付1回)
  regional_support_level?: RegionalSupportLevel2026;
  generic_dispensing_level?: GenericDispensingLevel2026;
  cooperation_enhancement?: boolean;      // 連携強化加算
  medical_dx_promotion?: boolean;         // 医療DX推進体制整備加算

  // 在宅関連体制加算 (訪問1回)
  home_comprehensive_level?: HomeComprehensiveLevel2026;

  // 免許・許可
  narcotic_dealer_license?: boolean;          // 麻薬小売業者の免許
  high_care_medical_device_license?: boolean; // 高度管理医療機器販売業の許可
};

/** 点数解決: config から在宅薬学総合体制加算の点数を取得 */
export function resolveHomeComprehensivePoints2026(config: MedicalSiteConfig2026): number {
  if (!config.home_comprehensive_level) return 0;
  return HOME_COMPREHENSIVE_POINTS_2026[config.home_comprehensive_level] ?? 0;
}
