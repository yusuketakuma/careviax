import { format } from 'date-fns';

export type WorkspaceConditionInput = {
  condition_type: string;
  name: string;
  is_active: boolean;
  noted_at: Date | null;
  notes: string | null;
};

export function compactPreviewValues(values: Array<string | null | undefined | false>) {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}

const HANDLING_TAG_PRIORITY = [
  'narcotic',
  'cold_storage',
  'unit_dose',
  'half_tablet',
  'crush_prohibited',
  'separate_pack',
  'staple_required',
  'label_required',
];

export function sortHandlingTags(tags: Iterable<string>): string[] {
  return [...new Set(tags)].sort((left, right) => {
    const leftIndex = HANDLING_TAG_PRIORITY.indexOf(left);
    const rightIndex = HANDLING_TAG_PRIORITY.indexOf(right);
    return (
      (leftIndex === -1 ? HANDLING_TAG_PRIORITY.length : leftIndex) -
      (rightIndex === -1 ? HANDLING_TAG_PRIORITY.length : rightIndex)
    );
  });
}

export function buildAllergyLabel(allergyInfo: unknown): string | null {
  if (!Array.isArray(allergyInfo)) return null;
  const labels = allergyInfo
    .filter(
      (entry): entry is { drug_name: string; confirmed_at?: string } =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { drug_name?: unknown }).drug_name === 'string' &&
        (entry as { drug_name: string }).drug_name.trim().length > 0,
    )
    .map((entry) => {
      const withReaction = entry as { reaction?: unknown; noted_year?: unknown };
      const reaction =
        typeof withReaction.reaction === 'string' && withReaction.reaction.trim().length > 0
          ? withReaction.reaction
          : null;
      const year =
        typeof withReaction.noted_year === 'number'
          ? String(withReaction.noted_year)
          : typeof entry.confirmed_at === 'string' && entry.confirmed_at.length >= 4
            ? entry.confirmed_at.slice(0, 4)
            : null;
      const detail = [reaction, year].filter(Boolean).join(' ');
      return detail ? `${entry.drug_name}(${detail})` : entry.drug_name;
    });
  return labels.length > 0 ? labels.join('、') : null;
}

export function buildCautionLabels(conditions: WorkspaceConditionInput[]): string[] {
  return conditions
    .filter((condition) => condition.condition_type === 'problem' && condition.is_active)
    .map((condition) => {
      const dateLabel = condition.noted_at ? format(condition.noted_at, 'M/d') : null;
      const notes = condition.notes?.trim() || null;
      if (dateLabel) return `${condition.name}(${dateLabel}〜${notes ?? ''})`;
      if (notes) return `${condition.name}(${notes})`;
      return condition.name;
    });
}
