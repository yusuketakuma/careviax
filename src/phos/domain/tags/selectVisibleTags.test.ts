import { describe, expect, it } from 'vitest';
import { BlockerSeverity, SAFETY_CRITICAL_TAGS, Tag } from '@/phos/contracts/phos_contracts';
import type { TagView } from '@/phos/contracts/phos_contracts';
import { selectVisibleTags } from './selectVisibleTags';

function tag(code: Tag, safety = SAFETY_CRITICAL_TAGS.includes(code)): TagView {
  return {
    code,
    label: code,
    severity: safety ? BlockerSeverity.ERROR : BlockerSeverity.INFO,
    icon: 'info',
    safety_critical: safety,
  };
}

describe('selectVisibleTags', () => {
  it('displays all safety tags and does not count them in +N', () => {
    const result = selectVisibleTags([
      tag(Tag.NARCOTIC),
      tag(Tag.OPIOID),
      tag(Tag.HIGH_RISK),
      tag(Tag.COLD_CHAIN),
      tag(Tag.INSULIN),
      tag(Tag.ANTICOAGULANT),
    ]);

    expect(result.visible.map((item) => item.code)).toEqual([
      Tag.NARCOTIC,
      Tag.OPIOID,
      Tag.HIGH_RISK,
      Tag.COLD_CHAIN,
      Tag.INSULIN,
      Tag.ANTICOAGULANT,
    ]);
    expect(result.hidden_non_safety_count).toBe(0);
  });

  it('shows four safety tags and hides only non-safety tags behind +N', () => {
    const result = selectVisibleTags([
      tag(Tag.NARCOTIC),
      tag(Tag.OPIOID),
      tag(Tag.HIGH_RISK),
      tag(Tag.COLD_CHAIN),
      tag(Tag.PRESCRIPTION_DIFF, false),
      tag(Tag.SET_DIFF, false),
      tag(Tag.RESIDUAL, false),
    ]);

    expect(result.visible.map((item) => item.code)).toEqual([
      Tag.NARCOTIC,
      Tag.OPIOID,
      Tag.HIGH_RISK,
      Tag.COLD_CHAIN,
    ]);
    expect(result.hidden_non_safety_count).toBe(3);
  });

  it('limits non-safety tags while keeping safety tags visible', () => {
    const result = selectVisibleTags([
      tag(Tag.NARCOTIC),
      tag(Tag.OPIOID),
      tag(Tag.PRESCRIPTION_DIFF, false),
      tag(Tag.SET_DIFF, false),
      tag(Tag.RESIDUAL, false),
      tag(Tag.FALL_RISK, false),
    ]);

    expect(result.visible.map((item) => item.code)).toEqual([
      Tag.NARCOTIC,
      Tag.OPIOID,
      Tag.PRESCRIPTION_DIFF,
      Tag.SET_DIFF,
    ]);
    expect(result.hidden_non_safety_count).toBe(2);
  });
});
