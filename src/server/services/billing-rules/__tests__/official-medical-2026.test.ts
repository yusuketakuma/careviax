import { describe, expect, it } from 'vitest';
import { MEDICAL_RULES_2026 } from '../revisions/medical/2026';
import {
  DISPENSING_FEE_POINTS_2026,
  DISPENSING_BASE_UP_EVALUATION_POINTS_2026,
  DISPENSING_PRICE_RESPONSE_POINTS_2026,
  GENERIC_DISPENSING_POINTS_2026,
  HOME_COMPREHENSIVE_POINTS_2026,
  MEDICAL_2026_OFFICIAL_RULE_POINTS,
  MEDICAL_2026_OFFICIAL_SOURCES,
  MEDICAL_2026_OFFICIAL_SITE_CONFIG_POINTS,
  REGIONAL_SUPPORT_POINTS_2026,
} from '../revisions';

describe('MEDICAL_2026 official reference coverage', () => {
  it('matches the official 2026 medical fee table for modeled rules', () => {
    const amountByCode = Object.fromEntries(
      MEDICAL_RULES_2026.map((rule) => [rule.code, rule.amount]),
    );

    expect(amountByCode).toMatchObject(MEDICAL_2026_OFFICIAL_RULE_POINTS);
  });

  it('matches the official 2026 site config point table', () => {
    expect(DISPENSING_FEE_POINTS_2026).toEqual(
      MEDICAL_2026_OFFICIAL_SITE_CONFIG_POINTS.dispensingFee,
    );
    expect(REGIONAL_SUPPORT_POINTS_2026).toEqual(
      MEDICAL_2026_OFFICIAL_SITE_CONFIG_POINTS.regionalSupport,
    );
    expect(GENERIC_DISPENSING_POINTS_2026).toEqual(
      MEDICAL_2026_OFFICIAL_SITE_CONFIG_POINTS.genericDispensing,
    );
    expect(HOME_COMPREHENSIVE_POINTS_2026).toEqual(
      MEDICAL_2026_OFFICIAL_SITE_CONFIG_POINTS.homeComprehensive,
    );
    expect(DISPENSING_BASE_UP_EVALUATION_POINTS_2026).toEqual(
      MEDICAL_2026_OFFICIAL_SITE_CONFIG_POINTS.dispensingBaseUpEvaluation,
    );
    expect(DISPENSING_PRICE_RESPONSE_POINTS_2026).toEqual(
      MEDICAL_2026_OFFICIAL_SITE_CONFIG_POINTS.dispensingPriceResponse,
    );
  });

  it('tracks the latest official 2026 notices checked for dispensing fee support', () => {
    expect(MEDICAL_2026_OFFICIAL_SOURCES).toMatchObject({
      summaryPage: 'https://www.mhlw.go.jp/stf/newpage_67729.html',
      feeTablePdf: 'https://www.mhlw.go.jp/content/12400000/001665294.pdf',
      implementationNoticePdf: 'https://www.mhlw.go.jp/content/12400000/001697755.pdf',
      inquiryInterpretation7Pdf: 'https://www.mhlw.go.jp/content/12400000/001706317.pdf',
      correctionNotice0529Pdf: 'https://www.mhlw.go.jp/content/12400000/001705942.pdf',
    });
  });
});
