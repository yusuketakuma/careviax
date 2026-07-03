import type { PatientFieldRevisionListItem } from '@/server/services/patient-field-revision-list';
import { PATIENT_FIELD_REVISION_CATEGORY_LABELS } from '@/lib/patient/field-revision-categories';

// 変更履歴タイムラインと反映 provenance カードで共有する表示定義(二重実装回避)。

export const REVISION_CATEGORY_LABELS: Record<string, string> =
  PATIENT_FIELD_REVISION_CATEGORY_LABELS;

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
  // 変更種別は「状態」ではなく識別。警告色(amber)を非警告に流用せず、追加のみ情報タグ(青)で強調し、
  // 変更/解除は中立トークンでラベル(追加/変更/解除)に区別を委ねる(SSOT §2: 生 Tailwind 状態色禁止)。
  if (!hasPrev && hasCur) {
    return { label: '追加', className: 'border-tag-info/30 bg-tag-info/10 text-tag-info' };
  }
  if (hasPrev && !hasCur) {
    return { label: '解除', className: 'border-border bg-muted text-muted-foreground' };
  }
  return { label: '変更', className: 'border-border bg-muted text-muted-foreground' };
}

export function revisionDetailText(item: PatientFieldRevisionListItem): string | null {
  if (SENSITIVE_FIELD_KEYS.has(item.field_key)) return null; // 生値を出さず変更の事実のみ
  return item.value_label;
}
