/**
 * 薬局情報 — 介護保険(介護報酬) 令和6年度(2024)改定
 *
 * PharmacySiteInsuranceConfig.config (Json) に格納する型。
 * 介護報酬改定は3年ごと (2024, 2027, 2030...)。
 */

// ── 地域加算 ──
export type CareSiteConfig2024 = {
  // 特別地域加算 (15%)
  region_special_15?: boolean;
  // 中山間地域等における小規模事業所加算 (10%)
  region_small_office_10?: boolean;
  // 中山間地域等に居住する者へのサービス提供加算 (5%)
  region_resident_5?: boolean;

  // 免許・許可 (介護保険側でも参照)
  narcotic_dealer_license?: boolean;
  high_care_medical_device_license?: boolean;
};

/** config から適用可能な地域加算キーの配列を取得 */
export function resolveRegionAddOns(
  config: CareSiteConfig2024
): Array<'special_15' | 'small_office_10' | 'resident_5'> {
  const result: Array<'special_15' | 'small_office_10' | 'resident_5'> = [];
  if (config.region_special_15) result.push('special_15');
  if (config.region_small_office_10) result.push('small_office_10');
  if (config.region_resident_5) result.push('resident_5');
  return result;
}
