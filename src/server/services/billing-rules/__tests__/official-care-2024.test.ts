import { describe, expect, it } from 'vitest';
import { CARE_RULES_2024 } from '../revisions/care/2024';
import { CARE_2024_OFFICIAL_RULE_POINTS } from '../revisions';

describe('CARE_2024 official reference coverage', () => {
  it('matches the official 2024 care fee table for modeled pharmacy rules', () => {
    const amountByCode = Object.fromEntries(CARE_RULES_2024.map((rule) => [rule.code, rule.amount]));

    expect(amountByCode).toMatchObject(CARE_2024_OFFICIAL_RULE_POINTS);
  });
});
