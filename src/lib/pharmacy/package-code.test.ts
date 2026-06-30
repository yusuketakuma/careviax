import { describe, expect, it } from 'vitest';
import {
  buildPackageCodeCandidates,
  buildPackageLookupOr,
  normalizePackageCodeIdentity,
} from './package-code';

describe('package-code helpers', () => {
  it('normalizes 13-digit JAN into JAN plus 14-digit GTIN candidates', () => {
    expect(normalizePackageCodeIdentity('4900-0000 00000')).toEqual({
      janCode: '4900000000000',
      gtin: '04900000000000',
      valid: true,
    });
    expect(buildPackageCodeCandidates('4900000000000')).toEqual([
      '4900000000000',
      '04900000000000',
    ]);
  });

  it('normalizes 8-digit JAN into a zero-padded GTIN candidate', () => {
    expect(normalizePackageCodeIdentity('12345678')).toEqual({
      janCode: '12345678',
      gtin: '00000012345678',
      valid: true,
    });
  });

  it('uses the JAN candidate only when a 14-digit GTIN starts with zero', () => {
    expect(buildPackageCodeCandidates('04900000000000')).toEqual([
      '4900000000000',
      '04900000000000',
    ]);
    expect(buildPackageCodeCandidates('14900000000000')).toEqual(['14900000000000']);
  });

  it('builds DrugPackage lookup OR clauses from normalized candidates', () => {
    expect(buildPackageLookupOr('4900000000000')).toEqual([
      { gtin: '4900000000000' },
      { jan_code: '4900000000000' },
      { gtin: '04900000000000' },
      { jan_code: '04900000000000' },
    ]);
  });

  it('marks non-package codes invalid without inventing a GTIN', () => {
    expect(normalizePackageCodeIdentity('JAN001')).toEqual({
      janCode: 'JAN001',
      gtin: null,
      valid: false,
    });
    expect(buildPackageCodeCandidates('JAN001')).toEqual(['JAN001']);
  });
});
