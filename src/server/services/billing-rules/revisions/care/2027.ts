import type { BillingRevision, BillingRuleSeed } from '../../types';

// TODO(2027介護報酬改定): 官報確定後に本ファイルへ実データを投入する。
// - CARE_REVISION の effectiveFrom / source / status を確定告示に合わせて更新
// - CARE_RULES_2027 に確定した算定ルール（care/2024.ts のパターンに倣う）を追加
// - status を 'confirmed' に変更するまでは resolveRevisionEntryForDate の
//   デフォルト解決（includeDraft 未指定）には現れない
export const CARE_REVISION: BillingRevision = {
  code: '2027',
  label: '令和9年度 介護報酬改定（未確定）',
  effectiveFrom: new Date('2027-04-01'),
  effectiveTo: null,
  source: '',
  status: 'draft',
};

export const CARE_RULES_2027: BillingRuleSeed[] = [
  // TODO(2027介護報酬改定): 官報確定後に care/2024.ts の構造に倣ってルールを追加する。
];
