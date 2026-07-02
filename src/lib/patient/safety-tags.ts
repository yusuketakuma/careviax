export const CRITICAL_SAFETY_TAGS = new Set(['allergy', 'narcotic']);

export const PATIENT_SAFETY_TAG_ORDER = [
  'narcotic',
  'cold_storage',
  'unit_dose',
  'half_tablet',
  'crush_prohibited',
  'infection_isolation',
  'renal',
  'swallowing',
  'allergy',
] as const;

const DEFAULT_SAFETY_TAG_DISPLAY_LIMIT = 3;

export function sortPatientSafetyTags(
  tags: Iterable<string>,
  options: { extraSortedPrefixes?: readonly string[] } = {},
): string[] {
  const uniqueTags = [...new Set(tags)].filter((tag) => tag.trim().length > 0);
  const tagSet = new Set(uniqueTags);
  const orderedTags = PATIENT_SAFETY_TAG_ORDER.filter((tag) => tagSet.has(tag));
  const knownTags = new Set<string>(PATIENT_SAFETY_TAG_ORDER);
  const extraTags = uniqueTags
    .filter(
      (tag) =>
        !knownTags.has(tag) &&
        (options.extraSortedPrefixes ?? []).some((prefix) => tag.startsWith(prefix)),
    )
    .sort((left, right) => left.localeCompare(right, 'ja'));
  return [...orderedTags, ...extraTags];
}

export function selectVisibleSafetyTags(
  safetyTags: string[],
  limit: number = DEFAULT_SAFETY_TAG_DISPLAY_LIMIT,
): { tags: string[]; hiddenCount: number } {
  const criticalCount = safetyTags.filter((tag) => CRITICAL_SAFETY_TAGS.has(tag)).length;
  const budget = Math.max(limit, criticalCount);
  const visible = new Set<string>();
  for (const tag of safetyTags) {
    if (CRITICAL_SAFETY_TAGS.has(tag)) visible.add(tag);
  }
  for (const tag of safetyTags) {
    if (visible.size >= budget) break;
    visible.add(tag);
  }
  const tags = safetyTags.filter((tag) => visible.has(tag));
  return { tags, hiddenCount: safetyTags.length - tags.length };
}
