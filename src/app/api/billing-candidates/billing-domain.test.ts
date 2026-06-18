import { describe, expect, it } from 'vitest';
import { parseBillingDomainOrDefault, parseOptionalBillingDomain } from './billing-domain';

describe('billing-domain parser', () => {
  it('parses optional billing_domain values for query and body payloads', () => {
    expect(parseOptionalBillingDomain(null)).toBeUndefined();
    expect(parseOptionalBillingDomain(undefined)).toBeUndefined();
    expect(parseOptionalBillingDomain('')).toBeUndefined();
    expect(parseOptionalBillingDomain('home_care')).toBe('home_care');
    expect(parseOptionalBillingDomain('pca_rental')).toBe('pca_rental');
    expect(parseOptionalBillingDomain('invalid')).toBeNull();
  });

  it('applies the close-route default without accepting invalid values', () => {
    expect(parseBillingDomainOrDefault(undefined)).toBe('home_care');
    expect(parseBillingDomainOrDefault('')).toBe('home_care');
    expect(parseBillingDomainOrDefault('pca_rental')).toBe('pca_rental');
    expect(parseBillingDomainOrDefault('invalid')).toBeNull();
  });
});
