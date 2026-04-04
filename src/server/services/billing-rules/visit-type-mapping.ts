/**
 * 訪問タイプから算定区分へのマッピング
 * VisitType (Prisma enum) → BillingVisitCategory
 */
export type BillingVisitCategory = 'home' | 'facility' | 'online' | 'emergency' | 'non_billable';

const VISIT_TYPE_CATEGORY_MAP: Record<string, BillingVisitCategory> = {
  initial: 'home',
  regular: 'home',
  temporary: 'home',
  revisit: 'home',
  delivery_only: 'non_billable',
  emergency: 'emergency',
  physician_co_visit: 'home',
};

export function resolveBillingVisitCategory(visitType: string): BillingVisitCategory {
  return VISIT_TYPE_CATEGORY_MAP[visitType] ?? 'non_billable';
}

/**
 * 介護保険の要介護/要支援区分と建物区分の組み合わせバリデーション
 */
export type CareLevelCategory = 'care_required' | 'support_required';

export function validateCareBillingEligibility(
  careLevelCategory: CareLevelCategory | null,
  buildingTier: 'single' | 'multi_2_9' | 'multi_10_plus',
): { eligible: boolean; reason?: string } {
  if (!careLevelCategory) {
    return { eligible: false, reason: '介護保険認定情報が未設定です' };
  }
  return { eligible: true };
}
