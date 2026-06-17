import { describe, expect, it } from 'vitest';

import {
  areQuantitiesEquivalentForUnit,
  isQuantityAllowedForUnit,
  quantityInputModeForUnit,
  quantityStepAttribute,
} from './quantity-unit';

describe('quantity unit step rules', () => {
  it('uses half-tablet steps for tablet-like units', () => {
    expect(quantityStepAttribute('錠', 14)).toBe('0.5');
    expect(quantityInputModeForUnit('錠', 14)).toBe('decimal');
    expect(isQuantityAllowedForUnit({ quantity: 13.5, unit: '錠', referenceQuantity: 14 })).toBe(
      true,
    );
    expect(isQuantityAllowedForUnit({ quantity: 13.25, unit: '錠', referenceQuantity: 14 })).toBe(
      false,
    );
  });

  it('uses integer steps for indivisible package units', () => {
    expect(quantityStepAttribute('包', 14)).toBe('1');
    expect(quantityInputModeForUnit('包', 14)).toBe('numeric');
    expect(isQuantityAllowedForUnit({ quantity: 12, unit: '包', referenceQuantity: 14 })).toBe(
      true,
    );
    expect(isQuantityAllowedForUnit({ quantity: 12.5, unit: '包', referenceQuantity: 14 })).toBe(
      false,
    );
  });

  it('uses decimal steps for weight and liquid units', () => {
    expect(quantityStepAttribute('g', 1.5)).toBe('0.001');
    expect(quantityStepAttribute('mL', 10.125)).toBe('0.001');
    expect(quantityStepAttribute('ｍｇ', 12.5)).toBe('0.001');
    expect(quantityStepAttribute('ＭＬ', 2.5)).toBe('0.001');
    expect(isQuantityAllowedForUnit({ quantity: 1.125, unit: 'g', referenceQuantity: 1.5 })).toBe(
      true,
    );
  });

  it('falls back to decimal when existing prescription quantity is more precise', () => {
    expect(quantityStepAttribute('包', 0.5)).toBe('0.001');
    expect(isQuantityAllowedForUnit({ quantity: 0.5, unit: '包', referenceQuantity: 0.5 })).toBe(
      true,
    );
  });

  it('compares quantities using the resolved unit step', () => {
    expect(
      areQuantitiesEquivalentForUnit({
        left: 0.1 + 0.2,
        right: 0.3,
        unit: 'g',
        referenceQuantity: 0.3,
      }),
    ).toBe(true);
    expect(
      areQuantitiesEquivalentForUnit({
        left: 12.25,
        right: 12.5,
        unit: '錠',
        referenceQuantity: 14,
      }),
    ).toBe(false);
  });
});
