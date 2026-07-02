// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { SafetyTagBadge, selectVisibleSafetyTags } from './safety-tag-badge';

setupDomTestEnv();

describe('selectVisibleSafetyTags', () => {
  it('never hides critical tags behind the +N fold (medical safety)', () => {
    // server 順: 麻薬→…→アレルギー。末尾のアレルギーも必ず可視に残る。
    const result = selectVisibleSafetyTags(['narcotic', 'cold_storage', 'renal', 'allergy']);

    expect(result.tags).toContain('allergy');
    expect(result.tags).toContain('narcotic');
    expect(result.hiddenCount).toBe(4 - result.tags.length);
  });

  it('fills the remaining budget with non-critical tags preserving order', () => {
    const result = selectVisibleSafetyTags(['renal', 'swallowing', 'cold_storage', 'unit_dose']);

    expect(result.tags).toEqual(['renal', 'swallowing', 'cold_storage']);
    expect(result.hiddenCount).toBe(1);
  });

  it('expands the budget when critical tags alone exceed the limit', () => {
    const result = selectVisibleSafetyTags(['allergy', 'narcotic', 'renal'], 1);

    expect(result.tags).toEqual(['allergy', 'narcotic']);
    expect(result.hiddenCount).toBe(1);
  });
});

describe('SafetyTagBadge', () => {
  it('unifies the cross-screen palette: allergy=hazard, swallowing=confirm attribute', () => {
    render(
      <>
        <SafetyTagBadge tag="allergy" />
        <SafetyTagBadge tag="swallowing" />
      </>,
    );

    // 旧 patients-board(confirm) / visits-today(hazard) の乖離を一本化した契約。
    expect(screen.getByText('アレルギー').className).toContain('text-tag-hazard');
    expect(screen.getByText('嚥下').className).toContain('bg-state-confirm/15');
  });

  it('falls back to the SafetyBoard handling-tag palette for non-patient tags', () => {
    render(<SafetyTagBadge tag="narcotic" />);

    const badge = screen.getByText('麻薬');
    expect(badge.className).toContain('rounded-full');
  });
});
