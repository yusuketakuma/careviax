import { describe, expect, it } from 'vitest';
import {
  buildAdjustmentConfirmDescription,
  buildAdjustmentProposal,
  buildResidualAdjustmentPlan,
  deriveCurrentPrescriptionDays,
  formatRemainingLabel,
  pickPhysicianInstructions,
  resolveLatestVisitRecordId,
  resolveRemainingDays,
  type PhysicianInstructionSource,
  type ResidualMedicationRecord,
} from './residual-adjustment.shared';

function buildRecord(
  overrides: Partial<ResidualMedicationRecord> = {},
): ResidualMedicationRecord {
  return {
    id: 'resid_1',
    visit_record_id: 'vrec_1',
    drug_name: 'アムロジピン',
    prescribed_quantity: 28,
    remaining_quantity: 28,
    remaining_days: 28,
    excess_days: 28,
    is_reduction_target: true,
    is_prohibited_reduction: false,
    created_at: '2026-06-10T09:00:00.000Z',
    ...overrides,
  };
}

function buildInstruction(
  overrides: Partial<PhysicianInstructionSource> = {},
): PhysicianInstructionSource {
  return {
    id: 'inq_1',
    residual_adjustment: true,
    result: 'changed',
    change_detail: '医師へ確認済み。酸化Mgは14日分に調整。',
    inquiry_content: '残薬調整の照会',
    inquired_at: '2026-06-12T07:00:00.000Z',
    resolved_at: '2026-06-12T08:00:00.000Z',
    ...overrides,
  };
}

describe('resolveRemainingDays / formatRemainingLabel', () => {
  it('prefers remaining_days and falls back to excess_days', () => {
    expect(resolveRemainingDays(buildRecord({ remaining_days: 10, excess_days: 7 }))).toBe(10);
    expect(resolveRemainingDays(buildRecord({ remaining_days: null, excess_days: 7 }))).toBe(7);
    expect(resolveRemainingDays(buildRecord({ remaining_days: null, excess_days: null }))).toBe(
      null,
    );
  });

  it('formats the orange card label as 残 N日', () => {
    expect(formatRemainingLabel(buildRecord({ remaining_days: 28 }))).toBe('残 28日');
    expect(
      formatRemainingLabel(
        buildRecord({ remaining_days: null, excess_days: null, remaining_quantity: 12 }),
      ),
    ).toBe('残数 12');
  });
});

describe('deriveCurrentPrescriptionDays', () => {
  it('converts the prescribed quantity into days using the residual daily dose', () => {
    // アムロジピン: 28錠 ÷ (28錠/28日 = 1錠/日) = 28日
    expect(deriveCurrentPrescriptionDays(buildRecord())).toBe(28);
    // 酸化Mg: 84錠 ÷ (42錠/14日 = 3錠/日) = 28日
    expect(
      deriveCurrentPrescriptionDays(
        buildRecord({ prescribed_quantity: 84, remaining_quantity: 42, remaining_days: 14 }),
      ),
    ).toBe(28);
  });

  it('returns null when the prescription or residual basis is missing', () => {
    expect(deriveCurrentPrescriptionDays(buildRecord({ prescribed_quantity: null }))).toBe(null);
    expect(
      deriveCurrentPrescriptionDays(buildRecord({ remaining_days: null, excess_days: null })),
    ).toBe(null);
    expect(deriveCurrentPrescriptionDays(buildRecord({ remaining_quantity: 0 }))).toBe(null);
  });
});

describe('buildAdjustmentProposal', () => {
  it('proposes stop-and-collect when the residual covers the prescription', () => {
    expect(buildAdjustmentProposal({ remainingDays: 28, prescribedDays: 28 })).toEqual({
      kind: 'stop_and_collect',
      label: '今回は中止・回収',
    });
    expect(buildAdjustmentProposal({ remainingDays: 30, prescribedDays: 28 })?.kind).toBe(
      'stop_and_collect',
    );
  });

  it('proposes a reduced day count otherwise', () => {
    expect(buildAdjustmentProposal({ remainingDays: 14, prescribedDays: 28 })).toEqual({
      kind: 'reduce_days',
      adjustedDays: 14,
      label: '14日分へ調整',
    });
  });

  it('returns null without a residual or current prescription', () => {
    expect(buildAdjustmentProposal({ remainingDays: null, prescribedDays: 28 })).toBe(null);
    expect(buildAdjustmentProposal({ remainingDays: 0, prescribedDays: 28 })).toBe(null);
    expect(buildAdjustmentProposal({ remainingDays: 10, prescribedDays: null })).toBe(null);
  });
});

describe('buildResidualAdjustmentPlan', () => {
  it('reproduces the p0_31 table: stop-and-collect plus 14-day adjustment', () => {
    const plan = buildResidualAdjustmentPlan([
      buildRecord(),
      buildRecord({
        id: 'resid_2',
        drug_name: 'ロキソニン',
        prescribed_quantity: null,
        remaining_quantity: 10,
        remaining_days: 10,
        excess_days: 10,
        is_reduction_target: false,
      }),
      buildRecord({
        id: 'resid_3',
        drug_name: '酸化Mg',
        prescribed_quantity: 84,
        remaining_quantity: 42,
        remaining_days: 14,
        excess_days: 14,
      }),
    ]);

    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]).toMatchObject({
      drugName: 'アムロジピン',
      remainingDays: 28,
      prescribedDays: 28,
      proposal: { label: '今回は中止・回収' },
    });
    expect(plan.rows[1]).toMatchObject({
      drugName: '酸化Mg',
      remainingDays: 14,
      prescribedDays: 28,
      proposal: { label: '14日分へ調整' },
    });
    expect(plan.prohibitedDrugNames).toEqual([]);
  });

  it('routes prohibited-reduction drugs to the blocked list instead of the table', () => {
    const plan = buildResidualAdjustmentPlan([
      buildRecord({ drug_name: 'オキシコドン', is_prohibited_reduction: true }),
    ]);
    expect(plan.rows).toHaveLength(0);
    expect(plan.prohibitedDrugNames).toEqual(['オキシコドン']);
  });
});

describe('buildAdjustmentConfirmDescription', () => {
  it('summarizes each proposal for the intervention record', () => {
    const plan = buildResidualAdjustmentPlan([
      buildRecord(),
      buildRecord({
        id: 'resid_3',
        drug_name: '酸化Mg',
        prescribed_quantity: 84,
        remaining_quantity: 42,
        remaining_days: 14,
      }),
    ]);
    expect(buildAdjustmentConfirmDescription(plan.rows)).toBe(
      '残薬調整の調整案を確定。アムロジピン: 今回は中止・回収 / 酸化Mg: 14日分へ調整',
    );
  });
});

describe('pickPhysicianInstructions', () => {
  it('keeps only answered residual-adjustment inquiries, newest first', () => {
    const instructions = pickPhysicianInstructions([
      buildInstruction({ id: 'inq_pending', result: null, change_detail: null }),
      buildInstruction({ id: 'inq_other', residual_adjustment: false }),
      buildInstruction({
        id: 'inq_old',
        resolved_at: '2026-06-10T08:00:00.000Z',
        change_detail: '前回の調整記録',
      }),
      buildInstruction({ id: 'inq_new' }),
    ]);

    expect(instructions.map((item) => item.id)).toEqual(['inq_new', 'inq_old']);
    expect(instructions[0].text).toBe('医師へ確認済み。酸化Mgは14日分に調整。');
  });

  it('falls back to the inquiry content with the answer kind', () => {
    const [instruction] = pickPhysicianInstructions([
      buildInstruction({ change_detail: null, result: 'unchanged' }),
    ]);
    expect(instruction.text).toBe('残薬調整の照会(回答: 変更なし)');
  });
});

describe('resolveLatestVisitRecordId', () => {
  it('returns the visit record of the most recent residual entry', () => {
    expect(
      resolveLatestVisitRecordId([
        buildRecord({ created_at: '2026-06-01T00:00:00.000Z', visit_record_id: 'vrec_old' }),
        buildRecord({
          id: 'resid_2',
          created_at: '2026-06-10T00:00:00.000Z',
          visit_record_id: 'vrec_new',
        }),
      ]),
    ).toBe('vrec_new');
    expect(resolveLatestVisitRecordId([])).toBe(null);
  });
});
