import { describe, expect, it } from 'vitest';
import { resolveBillingPayerBasis } from './billing-payer-basis';

describe('resolveBillingPayerBasis', () => {
  it('prefers care insurance for regular visits', () => {
    expect(
      resolveBillingPayerBasis({
        medicalInsuranceNumber: 'med-1',
        careInsuranceNumber: 'care-1',
        visitType: 'regular',
      }),
    ).toBe('care');
  });

  it('forces emergency visits onto medical billing when any insurance exists', () => {
    expect(
      resolveBillingPayerBasis({
        medicalInsuranceNumber: null,
        careInsuranceNumber: 'care-1',
        visitType: 'emergency',
      }),
    ).toBe('medical');
  });

  it('returns self_pay when no insurance exists', () => {
    expect(
      resolveBillingPayerBasis({
        medicalInsuranceNumber: null,
        careInsuranceNumber: null,
        visitType: 'regular',
      }),
    ).toBe('self_pay');
  });
});
