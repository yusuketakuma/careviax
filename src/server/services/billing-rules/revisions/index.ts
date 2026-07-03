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
import {
  MEDICAL_2024_REVISION as MEDICAL_2024,
  MEDICAL_RULES_2024,
  MEDICAL_2026_REVISION as MEDICAL_2026,
  MEDICAL_RULES_2026,
} from './medical';

// ── 介護保険 (介護報酬改定: 3年ごと) ──
import {
  CARE_2024_REVISION as CARE_2024,
  CARE_RULES_2024,
  CARE_2027_REVISION as CARE_2027,
  CARE_RULES_2027,
} from './care';

// ── 薬局情報の改定別 config 型 ──
export type { MedicalSiteConfig2024, MedicalSiteConfig2026 } from './medical';
export {
  resolveHomeComprehensivePoints,
  HOME_COMPREHENSIVE_POINTS_2024,
  DISPENSING_FEE_POINTS_2024,
  REGIONAL_SUPPORT_POINTS_2024,
  GENERIC_DISPENSING_POINTS_2024,
  resolveHomeComprehensivePoints2026,
  HOME_COMPREHENSIVE_POINTS_2026,
  DISPENSING_FEE_POINTS_2026,
  REGIONAL_SUPPORT_POINTS_2026,
  GENERIC_DISPENSING_POINTS_2026,
  COOPERATION_ENHANCEMENT_POINTS_2026,
  MEDICAL_DX_PROMOTION_POINTS_2026,
  ELECTRONIC_DISPENSING_INFO_COLLABORATION_POINTS_2026,
  DISPENSING_BASE_UP_EVALUATION_POINTS_2026,
  DISPENSING_PRICE_RESPONSE_POINTS_2026,
  MEDICAL_2024_OFFICIAL_RULE_POINTS,
  MEDICAL_2024_OFFICIAL_SITE_CONFIG_POINTS,
  MEDICAL_2024_OFFICIAL_SOURCES,
  MEDICAL_2026_OFFICIAL_RULE_POINTS,
  MEDICAL_2026_OFFICIAL_SITE_CONFIG_POINTS,
  MEDICAL_2026_OFFICIAL_SOURCES,
} from './medical';
export type { CareSiteConfig2024 } from './care';
export {
  resolveRegionAddOns,
  CARE_2024_OFFICIAL_RULE_POINTS,
  CARE_2024_OFFICIAL_SOURCES,
} from './care';

// Re-export individual revisions for direct access
export { MEDICAL_2024, MEDICAL_RULES_2024 };
export { MEDICAL_2026, MEDICAL_RULES_2026 };
export { CARE_2024, CARE_RULES_2024 };
export { CARE_2027, CARE_RULES_2027 };

export type RevisionEntry = {
  revision: BillingRevision;
  rules: BillingRuleSeed[];
};

function toUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function isRevisionRuntimeEnabled(revision: BillingRevision, includeDraft = false) {
  return includeDraft || revision.status !== 'draft';
}

export function isRevisionEffectiveForDate(revision: BillingRevision, asOfDate: Date) {
  const targetDay = toUtcDay(asOfDate).getTime();
  const effectiveFrom = toUtcDay(revision.effectiveFrom).getTime();
  const effectiveTo = revision.effectiveTo ? toUtcDay(revision.effectiveTo).getTime() : null;

  return effectiveFrom <= targetDay && (effectiveTo == null || effectiveTo >= targetDay);
}

export function resolveRevisionEntryForDate(
  revisions: RevisionEntry[],
  asOfDate: Date,
  options: { includeDraft?: boolean } = {},
) {
  const runtimeEnabled = revisions
    .filter((entry) => isRevisionRuntimeEnabled(entry.revision, options.includeDraft))
    .sort(
      (left, right) =>
        right.revision.effectiveFrom.getTime() - left.revision.effectiveFrom.getTime(),
    );
  const applicable = runtimeEnabled
    .filter((entry) => isRevisionEffectiveForDate(entry.revision, asOfDate))
    .sort(
      (left, right) =>
        right.revision.effectiveFrom.getTime() - left.revision.effectiveFrom.getTime(),
    );

  if (applicable.length > 0) {
    return applicable[0];
  }

  return (
    runtimeEnabled.find((entry) => entry.revision.effectiveFrom.getTime() <= asOfDate.getTime()) ??
    null
  );
}

/**
 * 全ての医療保険改定 (時系列順)
 * 新しい改定を追加する際はこの配列に追加する
 */
export const MEDICAL_REVISIONS: RevisionEntry[] = [
  { revision: MEDICAL_2024, rules: MEDICAL_RULES_2024 },
  { revision: MEDICAL_2026, rules: MEDICAL_RULES_2026 },
];

/**
 * 全ての介護保険改定 (時系列順)
 * 新しい改定を追加する際はこの配列に追加する
 */
export const CARE_REVISIONS: RevisionEntry[] = [
  { revision: CARE_2024, rules: CARE_RULES_2024 },
  // draft: 官報確定まで resolveRevisionEntryForDate のデフォルト解決には現れない
  { revision: CARE_2027, rules: CARE_RULES_2027 },
];

/** 全改定を統合した配列 (seeder に渡す用) */
export const ALL_REVISIONS: RevisionEntry[] = [...MEDICAL_REVISIONS, ...CARE_REVISIONS];

export function resolveBillingRulesForDate(args: {
  payerBasis: 'medical' | 'care';
  asOfDate: Date;
  includeDraft?: boolean;
}) {
  const revisions = args.payerBasis === 'care' ? CARE_REVISIONS : MEDICAL_REVISIONS;
  return (
    resolveRevisionEntryForDate(revisions, args.asOfDate, {
      includeDraft: args.includeDraft,
    })?.rules ?? []
  );
}
