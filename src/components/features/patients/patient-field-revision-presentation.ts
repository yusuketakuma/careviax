import { PATIENT_FIELD_REVISION_CATEGORY_LABELS } from '@/lib/patient/field-revision-categories';

type RevisionPresentationItem = {
  field_key: string;
  previous: unknown;
  current: unknown;
  value_label: string | null;
};

// 変更履歴タイムラインと反映 provenance カードで共有する表示定義(二重実装回避)。

export const REVISION_CATEGORY_LABELS: Record<string, string> =
  PATIENT_FIELD_REVISION_CATEGORY_LABELS;

export const REVISION_SOURCE_LABELS: Record<string, string> = {
  patient_detail_edit: '患者詳細編集',
  visit_record: '訪問記録',
  initial_visit_record: '初回訪問記録',
  mcs_sync: 'MCS連携',
  import: '取込',
};

export const LEGACY_MASKED_REVISION_VALUE = '〔記録あり〕';

export interface RevisionChangeTypeMeta {
  label: string;
  className: string;
}

export function revisionChangeTypeMeta(item: RevisionPresentationItem): RevisionChangeTypeMeta {
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

export function revisionDetailText(item: RevisionPresentationItem): string | null {
  return item.value_label;
}

export function isLegacyPresenceOnlyRevision(item: RevisionPresentationItem): boolean {
  if (item.value_label !== null) return false;
  const values = [item.previous, item.current].filter((value) => value != null && value !== '');
  return values.length > 0 && values.every((value) => value === LEGACY_MASKED_REVISION_VALUE);
}

export function hasStructuredRevisionValue(item: RevisionPresentationItem): boolean {
  return [item.previous, item.current].some((value) => typeof value === 'object' && value !== null);
}
