/**
 * 訪問準備チェックリストのテンプレート生成ユーティリティ。
 *
 * org/facility レベルのオプションに基づいてチェックリストの初期状態を生成する。
 * checklist は { [itemKey: string]: boolean } 形式で保存される。
 */

export type ChecklistTemplateOptions = {
  /** 麻薬を携行する場合 */
  narcoticsCarry?: boolean;
  /** 感染症対策が必要な施設 */
  infectionControl?: boolean;
  /** 冷蔵保管薬がある場合 */
  coldChainRequired?: boolean;
  /** 施設固有の追加チェック項目 */
  facilityCustomItems?: string[];
};

/** 標準チェック項目のキー定義 */
export const CHECKLIST_ITEM_KEYS = {
  MEDICATION_PREPARED: 'medication_prepared',
  PRESCRIPTION_CONFIRMED: 'prescription_confirmed',
  PATIENT_RECORD_REVIEWED: 'patient_record_reviewed',
  PREVIOUS_VISIT_REVIEWED: 'previous_visit_reviewed',
  ROUTE_CONFIRMED: 'route_confirmed',
  EMERGENCY_CONTACTS_CHECKED: 'emergency_contacts_checked',
  // 条件付き項目
  NARCOTICS_CARRY_CONFIRMED: 'narcotics_carry_confirmed',
  NARCOTICS_COUNT_VERIFIED: 'narcotics_count_verified',
  INFECTION_PPE_PREPARED: 'infection_ppe_prepared',
  INFECTION_WASTE_BAG_PREPARED: 'infection_waste_bag_prepared',
  COLD_CHAIN_COOLER_PREPARED: 'cold_chain_cooler_prepared',
} as const;

export type ChecklistItemKey = (typeof CHECKLIST_ITEM_KEYS)[keyof typeof CHECKLIST_ITEM_KEYS];

/**
 * テンプレートオプションからチェックリストの初期状態を生成する。
 * 全項目が false（未チェック）で返る。
 */
export function buildChecklistFromTemplate(
  options: ChecklistTemplateOptions = {}
): Record<string, boolean> {
  const items: Record<string, boolean> = {
    [CHECKLIST_ITEM_KEYS.MEDICATION_PREPARED]: false,
    [CHECKLIST_ITEM_KEYS.PRESCRIPTION_CONFIRMED]: false,
    [CHECKLIST_ITEM_KEYS.PATIENT_RECORD_REVIEWED]: false,
    [CHECKLIST_ITEM_KEYS.PREVIOUS_VISIT_REVIEWED]: false,
    [CHECKLIST_ITEM_KEYS.ROUTE_CONFIRMED]: false,
    [CHECKLIST_ITEM_KEYS.EMERGENCY_CONTACTS_CHECKED]: false,
  };

  if (options.narcoticsCarry) {
    items[CHECKLIST_ITEM_KEYS.NARCOTICS_CARRY_CONFIRMED] = false;
    items[CHECKLIST_ITEM_KEYS.NARCOTICS_COUNT_VERIFIED] = false;
  }

  if (options.infectionControl) {
    items[CHECKLIST_ITEM_KEYS.INFECTION_PPE_PREPARED] = false;
    items[CHECKLIST_ITEM_KEYS.INFECTION_WASTE_BAG_PREPARED] = false;
  }

  if (options.coldChainRequired) {
    items[CHECKLIST_ITEM_KEYS.COLD_CHAIN_COOLER_PREPARED] = false;
  }

  for (const customItem of options.facilityCustomItems ?? []) {
    const key = `custom_${customItem.toLowerCase().replace(/\s+/g, '_')}`;
    items[key] = false;
  }

  return items;
}

/**
 * 既存チェックリストにテンプレートの新規項目をマージする。
 * 既存のチェック状態は保持される。
 */
export function mergeChecklistWithTemplate(
  existing: Record<string, unknown>,
  options: ChecklistTemplateOptions = {}
): Record<string, boolean> {
  const template = buildChecklistFromTemplate(options);
  const merged: Record<string, boolean> = { ...template };

  for (const [key, value] of Object.entries(existing)) {
    if (typeof value === 'boolean') {
      merged[key] = value;
    }
  }

  return merged;
}
