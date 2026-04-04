import { describe, it, expect } from 'vitest';
import {
  resolveBillingVisitCategory,
  validateCareBillingEligibility,
} from '../visit-type-mapping';

describe('resolveBillingVisitCategory', () => {
  it('全 VisitType 値にマッピングが定義されていること', () => {
    const allVisitTypes = [
      'initial',
      'regular',
      'temporary',
      'revisit',
      'delivery_only',
      'emergency',
      'physician_co_visit',
    ];
    for (const visitType of allVisitTypes) {
      const result = resolveBillingVisitCategory(visitType);
      expect(result).toBeDefined();
    }
  });

  it('delivery_only は non_billable であること', () => {
    expect(resolveBillingVisitCategory('delivery_only')).toBe('non_billable');
  });

  it('emergency は emergency であること', () => {
    expect(resolveBillingVisitCategory('emergency')).toBe('emergency');
  });

  it('未定義の値は non_billable にフォールバックすること', () => {
    expect(resolveBillingVisitCategory('unknown_type')).toBe('non_billable');
    expect(resolveBillingVisitCategory('')).toBe('non_billable');
  });

  it('home 系の訪問タイプは home であること', () => {
    expect(resolveBillingVisitCategory('initial')).toBe('home');
    expect(resolveBillingVisitCategory('regular')).toBe('home');
    expect(resolveBillingVisitCategory('temporary')).toBe('home');
    expect(resolveBillingVisitCategory('revisit')).toBe('home');
    expect(resolveBillingVisitCategory('physician_co_visit')).toBe('home');
  });
});

describe('validateCareBillingEligibility', () => {
  it('careLevelCategory が null の場合は eligible: false', () => {
    const result = validateCareBillingEligibility(null, 'single');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('介護保険認定情報が未設定です');
  });

  it('care_required + single は eligible: true', () => {
    const result = validateCareBillingEligibility('care_required', 'single');
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('support_required + multi_2_9 は eligible: true', () => {
    const result = validateCareBillingEligibility('support_required', 'multi_2_9');
    expect(result.eligible).toBe(true);
  });

  it('care_required + multi_10_plus は eligible: true', () => {
    const result = validateCareBillingEligibility('care_required', 'multi_10_plus');
    expect(result.eligible).toBe(true);
  });
});
