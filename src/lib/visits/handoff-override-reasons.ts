export const VISIT_HANDOFF_OVERRIDE_REASON_CODES = [
  'assignee_unavailable',
  'urgent_operational_deadline',
  'care_continuity',
  'supervisor_directed',
  'data_correction',
  'legacy_unclassified',
] as const;

export type VisitHandoffOverrideReasonCode = (typeof VISIT_HANDOFF_OVERRIDE_REASON_CODES)[number];

export const VISIT_HANDOFF_SELECTABLE_OVERRIDE_REASON_CODES = [
  'assignee_unavailable',
  'urgent_operational_deadline',
  'care_continuity',
  'supervisor_directed',
  'data_correction',
] as const;

export type VisitHandoffSelectableOverrideReasonCode =
  (typeof VISIT_HANDOFF_SELECTABLE_OVERRIDE_REASON_CODES)[number];

export type VisitHandoffOverrideReasonOption = {
  code: VisitHandoffSelectableOverrideReasonCode;
  label: string;
  description: string;
};

export const VISIT_HANDOFF_OVERRIDE_REASON_OPTIONS = [
  {
    code: 'assignee_unavailable',
    label: '担当者不在',
    description: '担当者が確認できないため、管理者が代行確認する',
  },
  {
    code: 'urgent_operational_deadline',
    label: '訪問前の緊急確認',
    description: '訪問前の業務期限に間に合わせるため、管理者が確認する',
  },
  {
    code: 'care_continuity',
    label: 'ケア継続',
    description: '継続対応を止めないため、管理者が確認する',
  },
  {
    code: 'supervisor_directed',
    label: '上長指示',
    description: '上長判断により、管理者が確認する',
  },
  {
    code: 'data_correction',
    label: '割当・記録修正',
    description: '割当または記録状態の修正に伴い、管理者が確認する',
  },
] as const satisfies readonly VisitHandoffOverrideReasonOption[];

export function normalizeVisitHandoffOverrideReasonCode(
  value: VisitHandoffOverrideReasonCode | null | undefined,
): VisitHandoffOverrideReasonCode {
  return value ?? 'legacy_unclassified';
}
