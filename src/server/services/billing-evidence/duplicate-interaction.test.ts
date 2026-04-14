import { describe, expect, it } from 'vitest';
import { parseHomeDuplicateInteractionFeeType } from './duplicate-interaction';

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
