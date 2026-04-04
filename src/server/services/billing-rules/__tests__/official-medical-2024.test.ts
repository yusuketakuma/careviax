import { describe, expect, it } from 'vitest';
import { MEDICAL_RULES_2024 } from '../revisions/medical/2024';
import {
  DISPENSING_FEE_POINTS_2024,
  GENERIC_DISPENSING_POINTS_2024,
  HOME_COMPREHENSIVE_POINTS_2024,
  MEDICAL_2024_OFFICIAL_RULE_POINTS,
  MEDICAL_2024_OFFICIAL_SITE_CONFIG_POINTS,
  REGIONAL_SUPPORT_POINTS_2024,
} from '../revisions';

describe('MEDICAL_2024 official reference coverage', () => {
  it('matches the official 2024 medical fee table for modeled rules', () => {
    const amountByCode = Object.fromEntries(MEDICAL_RULES_2024.map((rule) => [rule.code, rule.amount]));

    expect(amountByCode).toMatchObject(MEDICAL_2024_OFFICIAL_RULE_POINTS);
  });

  it('matches the official 2024 site config point table', () => {
    expect(DISPENSING_FEE_POINTS_2024).toEqual(MEDICAL_2024_OFFICIAL_SITE_CONFIG_POINTS.dispensingFee);
    expect(REGIONAL_SUPPORT_POINTS_2024).toEqual(MEDICAL_2024_OFFICIAL_SITE_CONFIG_POINTS.regionalSupport);
    expect(GENERIC_DISPENSING_POINTS_2024).toEqual(MEDICAL_2024_OFFICIAL_SITE_CONFIG_POINTS.genericDispensing);
    expect(HOME_COMPREHENSIVE_POINTS_2024).toEqual(MEDICAL_2024_OFFICIAL_SITE_CONFIG_POINTS.homeComprehensive);
  });
});
