import { describe, expect, it } from 'vitest';
import {
  CARE_REVISIONS,
  MEDICAL_REVISIONS,
  resolveBillingRulesForDate,
  resolveRevisionEntryForDate,
} from '../revisions';

describe('resolveRevisionEntryForDate', () => {
  it('uses the confirmed 2024 medical revision while 2026 remains draft', () => {
    const resolved = resolveRevisionEntryForDate(
      MEDICAL_REVISIONS,
      new Date('2026-06-15T00:00:00.000Z'),
    );

    expect(resolved?.revision.code).toBe('2024');
  });

  it('can opt into draft medical revisions explicitly', () => {
    const resolved = resolveRevisionEntryForDate(
      MEDICAL_REVISIONS,
      new Date('2026-06-15T00:00:00.000Z'),
      { includeDraft: true },
    );

    expect(resolved?.revision.code).toBe('2026');
  });

  it('keeps the current confirmed care revision active', () => {
    const resolved = resolveRevisionEntryForDate(
      CARE_REVISIONS,
      new Date('2026-06-15T00:00:00.000Z'),
    );

    expect(resolved?.revision.code).toBe('2024');
  });

  it('returns confirmed medical rules while the future revision remains draft', () => {
    const rules = resolveBillingRulesForDate({
      payerBasis: 'medical',
      asOfDate: new Date('2026-06-15T00:00:00.000Z'),
    });

    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => rule.ssot_key === 'medical.home_visit.single')).toBe(true);
  });
});
