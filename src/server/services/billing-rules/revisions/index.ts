/**
 * 改定レジストリ — 医療保険(診療報酬)と介護保険(介護報酬)の改定を集約。
 *
 * 改定サイクル:
 *   医療保険(診療報酬改定): 2年ごと (2024, 2026, 2028, ...)
 *   介護保険(介護報酬改定): 3年ごと (2024, 2027, 2030, ...)
 *
 * 新しい改定を追加する手順:
 *   1. revisions/medical/2026.ts または revisions/care/2027.ts を作成
 *   2. このファイルの該当配列に追加
 *   3. 旧改定ファイルの effectiveTo を施行日前日に設定
 */

import type { BillingRevision, BillingRuleSeed } from '../types';

// ── 医療保険 (診療報酬改定: 2年ごと) ──
import { MEDICAL_REVISION as MEDICAL_2024, MEDICAL_RULES_2024 } from './medical/2024';

// ── 介護保険 (介護報酬改定: 3年ごと) ──
import { CARE_REVISION as CARE_2024, CARE_RULES_2024 } from './care/2024';

// Re-export individual revisions for direct access
export { MEDICAL_2024, MEDICAL_RULES_2024 };
export { CARE_2024, CARE_RULES_2024 };

export type RevisionEntry = {
  revision: BillingRevision;
  rules: BillingRuleSeed[];
};

/**
 * 全ての医療保険改定 (時系列順)
 * 新しい改定を追加する際はこの配列に追加する
 */
export const MEDICAL_REVISIONS: RevisionEntry[] = [
  { revision: MEDICAL_2024, rules: MEDICAL_RULES_2024 },
  // { revision: MEDICAL_2026, rules: MEDICAL_RULES_2026 },  // ← 2026年改定時に追加
];

/**
 * 全ての介護保険改定 (時系列順)
 * 新しい改定を追加する際はこの配列に追加する
 */
export const CARE_REVISIONS: RevisionEntry[] = [
  { revision: CARE_2024, rules: CARE_RULES_2024 },
  // { revision: CARE_2027, rules: CARE_RULES_2027 },  // ← 2027年改定時に追加
];

/** 全改定を統合した配列 (seeder に渡す用) */
export const ALL_REVISIONS: RevisionEntry[] = [
  ...MEDICAL_REVISIONS,
  ...CARE_REVISIONS,
];
