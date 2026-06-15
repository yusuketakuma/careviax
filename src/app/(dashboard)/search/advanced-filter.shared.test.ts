import { describe, expect, it } from 'vitest';
import { CYCLE_STATUS_OPTIONS } from './advanced-filter.shared';

describe('CYCLE_STATUS_OPTIONS', () => {
  it('labels set audit statuses by their actual workflow state', () => {
    const labelByValue = Object.fromEntries(
      CYCLE_STATUS_OPTIONS.map((option) => [option.value, option.label]),
    );

    expect(labelByValue.setting).toBe('セット監査待ち');
    expect(labelByValue.set_audited).toBe('セット監査済み');
  });
});
