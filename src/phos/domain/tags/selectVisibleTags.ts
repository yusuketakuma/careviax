import { SAFETY_CRITICAL_TAGS } from '@/phos/contracts/phos_contracts';
import type { TagView } from '@/phos/contracts/phos_contracts';

export type VisibleTagSelection = {
  visible: TagView[];
  hidden_non_safety_count: number;
};

export function selectVisibleTags(tags: TagView[], nonSafetyLimit = 4): VisibleTagSelection {
  const safety = tags.filter(
    (tag) => tag.safety_critical || SAFETY_CRITICAL_TAGS.includes(tag.code),
  );
  const nonSafety = tags.filter(
    (tag) => !tag.safety_critical && !SAFETY_CRITICAL_TAGS.includes(tag.code),
  );
  const visibleNonSafety = nonSafety.slice(0, Math.max(0, nonSafetyLimit - safety.length));

  return {
    visible: [...safety, ...visibleNonSafety],
    hidden_non_safety_count: Math.max(0, nonSafety.length - visibleNonSafety.length),
  };
}
