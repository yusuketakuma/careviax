import { describe, expect, it } from 'vitest';
import {
  CARE_REVISIONS,
  MEDICAL_REVISIONS,
  resolveBillingRulesForDate,
  resolveRevisionEntryForDate,
} from '../revisions';

describe('resolveRevisionEntryForDate', () => {
  it('uses the confirmed 2026 medical revision for dates on or after 2026-06-01', () => {
    const resolved = resolveRevisionEntryForDate(
      MEDICAL_REVISIONS,
      new Date('2026-06-15T00:00:00.000Z'),
    );

    expect(resolved?.revision.code).toBe('2026');
  });

  it('uses the confirmed 2024 medical revision for dates before 2026-06-01', () => {
    const resolved = resolveRevisionEntryForDate(
      MEDICAL_REVISIONS,
      new Date('2026-05-31T00:00:00.000Z'),
    );

    expect(resolved?.revision.code).toBe('2024');
  });

  it('keeps the current confirmed care revision active', () => {
    const resolved = resolveRevisionEntryForDate(
      CARE_REVISIONS,
      new Date('2026-06-15T00:00:00.000Z'),
    );

    expect(resolved?.revision.code).toBe('2024');
  });

  it('returns confirmed 2026 medical rules for dates after effectiveFrom', () => {
    const rules = resolveBillingRulesForDate({
      payerBasis: 'medical',
      asOfDate: new Date('2026-06-15T00:00:00.000Z'),
    });

    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => rule.ssot_key === 'medical.home_visit.single')).toBe(true);
  });

  it('ignores the draft 2027 care revision and keeps the confirmed 2024 revision active, even on/after the draft effectiveFrom', () => {
    const draftEntry = CARE_REVISIONS.find((entry) => entry.revision.code === '2027');
    expect(draftEntry?.revision.status).toBe('draft');

    const resolved = resolveRevisionEntryForDate(
      CARE_REVISIONS,
      // 2027 draft revision の effectiveFrom (2027-04-01) 以降の日付でも、
      // draft は as-of 解決の対象から除外され続けることを確認する。
      new Date('2027-04-01T00:00:00.000Z'),
    );

    expect(resolved?.revision.code).toBe('2024');

    const rules = resolveBillingRulesForDate({
      payerBasis: 'care',
      asOfDate: new Date('2027-04-01T00:00:00.000Z'),
    });

    // 2024 confirmed revision の実ルールが返る（2027 draft の空 seeds ではない）
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((rule) => rule.ssot_key === 'care.home_management.pharmacy.single')).toBe(
      true,
    );
  });
});
