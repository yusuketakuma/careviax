export const OUTCOME_LABELS: Record<string, string> = {
  completed: '完了',
  revisit_needed: '再訪必要',
  postponed: '延期',
  cancelled: 'キャンセル',
  delivery_only: '投薬のみ',
  completed_with_issue: '完了（課題あり）',
};

export const OUTCOME_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  completed: 'default',
  revisit_needed: 'secondary',
  postponed: 'outline',
  cancelled: 'destructive',
  delivery_only: 'secondary',
  completed_with_issue: 'outline',
};

export const ACTIVE_VISIT_SCHEDULE_STATUSES = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
] as const;
