import type { PatientFieldRevisionListItem } from '@/server/services/patient-field-revision-list';

// 変更履歴タイムラインと反映 provenance カードで共有する表示定義(二重実装回避)。

export const REVISION_CATEGORY_LABELS: Record<string, string> = {
  basic: '基本情報',
  residence: '住所',
  contacts: '連絡先',
  conditions: '病名',
  clinical: '臨床',
  insurance: '保険',
  medical_care: '医療処置',
  narcotic: '麻薬',
};

export const REVISION_SOURCE_LABELS: Record<string, string> = {
  patient_detail_edit: '患者詳細編集',
  visit_record: '訪問記録',
  mcs_sync: 'MCS連携',
  import: '取込',
};

// 識別子系(電話/住所)は変更履歴で生値を露出しない(UI/UX ガイドライン: PHI の取り扱い)
const SENSITIVE_FIELD_KEYS = new Set(['phone', 'address', 'building_id']);

export interface RevisionChangeTypeMeta {
  label: string;
  className: string;
}

export function revisionChangeTypeMeta(item: PatientFieldRevisionListItem): RevisionChangeTypeMeta {
  const hasPrev = item.previous != null && item.previous !== '';
  const hasCur = item.current != null && item.current !== '';
  if (!hasPrev && hasCur) {
    return { label: '追加', className: 'border-sky-200 bg-sky-50 text-sky-700' };
  }
  if (hasPrev && !hasCur) {
    return { label: '解除', className: 'border-slate-200 bg-slate-50 text-slate-600' };
  }
  return { label: '変更', className: 'border-amber-200 bg-amber-50 text-amber-700' };
}

export function revisionDetailText(item: PatientFieldRevisionListItem): string | null {
  if (SENSITIVE_FIELD_KEYS.has(item.field_key)) return null; // 生値を出さず変更の事実のみ
  return item.value_label;
}
