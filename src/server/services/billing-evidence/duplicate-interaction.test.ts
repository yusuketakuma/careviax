import { describe, expect, it } from 'vitest';
import {
  parseHomeDuplicateInteractionFeeType,
  resolveHomeDuplicateRules,
} from './duplicate-interaction';

describe('parseHomeDuplicateInteractionFeeType', () => {
  it('prefers structured pre-issuance residual metadata over free-text parsing', () => {
    expect(
      parseHomeDuplicateInteractionFeeType({
        reason: 'その他',
        changeDetail: '自由記載だけでは分類不能',
        proposalOrigin: 'pre_issuance',
        residualAdjustment: true,
      }),
    ).toBe('2_ro');
  });

  it('falls back to legacy change_detail parsing when structured metadata is absent', () => {
    expect(
      parseHomeDuplicateInteractionFeeType({
        reason: '重複',
        changeDetail: 'proposal_origin:pre_issuance | residual_adjustment:true',
      }),
    ).toBe('2_ro');
  });
});

describe('resolveHomeDuplicateRules', () => {
  it('uses the 2026 adverse event rules for a canonical UTC June 2026 billing month', () => {
    expect(resolveHomeDuplicateRules(new Date('2026-06-01T00:00:00.000Z'))['1_i']).toMatchObject({
      code: 'MED_ADVERSE_EVENT_HOME_CHANGE',
      points: 50,
    });
  });

  it('maps 2026 pre-issuance residual proposals to residual adjustment type i', () => {
    expect(resolveHomeDuplicateRules(new Date('2026-06-01T00:00:00.000Z'))['2_ro']).toMatchObject({
      ssotKey: 'medical.residual_adjustment.home_proposal',
      code: 'MED_RESIDUAL_ADJUSTMENT_HOME_PROPOSAL',
      name: '調剤時残薬調整加算 イ（在宅・処方提案反映）',
      points: 50,
    });
  });
});
