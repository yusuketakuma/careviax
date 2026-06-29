import { describe, expect, it } from 'vitest';
import {
  buildDrugIdentityResolutionByCode,
  normalizeMedicationCode,
  resolveMedicationCode,
  type DrugIdentityResolutionMaster,
} from './drug-identity-resolution';

const masters: DrugIdentityResolutionMaster[] = [
  {
    id: 'master_yj',
    yj_code: 'YJ001',
    receipt_code: 'RC001',
    hot_code: 'HOT001',
    jan_code: 'JAN001',
  },
  {
    id: 'master_receipt_a',
    yj_code: 'YJ_RECEIPT_A',
    receipt_code: 'RC_DUP',
    hot_code: null,
  },
  {
    id: 'master_receipt_b',
    yj_code: 'YJ_RECEIPT_B',
    receipt_code: 'RC_DUP',
    hot_code: null,
  },
  {
    id: 'master_hot',
    yj_code: 'YJ_HOT',
    receipt_code: null,
    hot_code: 'HOT_UNIQUE',
  },
];

describe('drug identity resolution', () => {
  it('normalizes medication codes by removing whitespace', () => {
    expect(normalizeMedicationCode('  YJ 001\t')).toBe('YJ001');
    expect(normalizeMedicationCode('   ')).toBeNull();
    expect(normalizeMedicationCode(null)).toBeNull();
  });

  it('resolves YJ codes as canonical medication identity first', () => {
    const resolutions = buildDrugIdentityResolutionByCode([
      ...masters,
      {
        id: 'receipt_collision',
        yj_code: 'YJ_COLLISION',
        receipt_code: 'YJ001',
        hot_code: null,
      },
    ]);

    expect(resolveMedicationCode(' YJ001 ', resolutions)).toMatchObject({
      status: 'resolved',
      sourceCodeSystem: 'yj',
      canonicalDrugCode: 'YJ001',
      drug: { id: 'master_yj', yj_code: 'YJ001' },
    });
  });

  it('resolves unique receipt and HOT codes to canonical YJ identity', () => {
    const resolutions = buildDrugIdentityResolutionByCode(masters);

    expect(resolveMedicationCode('RC001', resolutions)).toMatchObject({
      status: 'resolved',
      sourceCodeSystem: 'receipt',
      canonicalDrugCode: 'YJ001',
      drug: { id: 'master_yj' },
    });
    expect(resolveMedicationCode('HOT_UNIQUE', resolutions)).toMatchObject({
      status: 'resolved',
      sourceCodeSystem: 'hot',
      canonicalDrugCode: 'YJ_HOT',
      drug: { id: 'master_hot' },
    });
  });

  it('marks duplicate receipt or HOT candidates as ambiguous instead of picking DB order', () => {
    const resolutions = buildDrugIdentityResolutionByCode([
      ...masters,
      {
        id: 'master_hot_dup_a',
        yj_code: 'YJ_HOT_DUP_A',
        receipt_code: null,
        hot_code: 'HOT_DUP',
      },
      {
        id: 'master_hot_dup_b',
        yj_code: 'YJ_HOT_DUP_B',
        receipt_code: null,
        hot_code: 'HOT_DUP',
      },
    ]);

    expect(resolveMedicationCode('RC_DUP', resolutions)).toMatchObject({
      status: 'ambiguous_code',
      sourceCode: 'RC_DUP',
      sourceCodeSystem: 'receipt',
      candidateCount: 2,
    });
    expect(resolveMedicationCode('HOT_DUP', resolutions)).toMatchObject({
      status: 'ambiguous_code',
      sourceCode: 'HOT_DUP',
      sourceCodeSystem: 'hot',
      candidateCount: 2,
    });
  });

  it('keeps JAN out of prescription identity resolution unless explicitly enabled', () => {
    const defaultResolutions = buildDrugIdentityResolutionByCode(masters);
    expect(resolveMedicationCode('JAN001', defaultResolutions)).toEqual({
      status: 'code_not_found',
      sourceCode: 'JAN001',
    });

    const withJan = buildDrugIdentityResolutionByCode(masters, { includeJan: true });
    expect(resolveMedicationCode('JAN001', withJan)).toMatchObject({
      status: 'resolved',
      sourceCodeSystem: 'jan',
      canonicalDrugCode: 'YJ001',
    });
  });

  it('classifies missing and unknown source codes separately', () => {
    const resolutions = buildDrugIdentityResolutionByCode(masters);

    expect(resolveMedicationCode('', resolutions)).toEqual({
      status: 'missing_code',
      sourceCode: null,
    });
    expect(resolveMedicationCode('UNKNOWN', resolutions)).toEqual({
      status: 'code_not_found',
      sourceCode: 'UNKNOWN',
    });
  });
});
