import { describe, expect, it, vi } from 'vitest';
import {
  generateHomeDuplicateInteractionCandidates,
  parseHomeDuplicateInteractionFeeType,
  resolveHomeDuplicateRules,
  type HomeDuplicateInteractionCandidatesTx,
} from './duplicate-interaction';
import type { RegeneratedBillingCandidateRecord } from './candidate-regeneration';

type InquiryFixture = {
  id: string;
  cycle_id: string | null;
  reason: string;
  result: string;
  proposal_origin: string | null;
  residual_adjustment: boolean | null;
  change_detail: string | null;
  cycle: { patient_id: string | null } | null;
  issue: { category: string | null } | null;
};

function inquiry(overrides: Partial<InquiryFixture> = {}): InquiryFixture {
  return {
    id: 'inq_1',
    cycle_id: 'cycle_1',
    reason: '相互作用',
    result: 'changed',
    proposal_origin: null,
    residual_adjustment: null,
    change_detail: null,
    cycle: { patient_id: 'patient_1' },
    issue: { category: null },
    ...overrides,
  };
}

function buildTx(
  inquiries: InquiryFixture[],
  candidateMocks: {
    upsert?: ReturnType<typeof vi.fn>;
    updateMany?: ReturnType<typeof vi.fn>;
    findFirst?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const upsert = candidateMocks.upsert ?? vi.fn().mockResolvedValue({});
  const updateMany = candidateMocks.updateMany ?? vi.fn().mockResolvedValue({ count: 1 });
  const findFirst = candidateMocks.findFirst ?? vi.fn().mockResolvedValue(null);
  const findManyMock = vi.fn().mockResolvedValue(inquiries);
  const tx = {
    billingCandidate: { upsert, updateMany, findFirst },
    inquiryRecord: { findMany: findManyMock },
  } as unknown as HomeDuplicateInteractionCandidatesTx;
  return { tx, upsert, updateMany, findFirst, findManyMock };
}

const BILLING_MONTH = new Date('2026-06-01T00:00:00.000Z');

function baseArgs(existingByKey = new Map<string, RegeneratedBillingCandidateRecord>()) {
  return {
    orgId: 'org_1',
    billingMonth: BILLING_MONTH,
    ruleIdByKey: new Map<string, string>(),
    existingByKey,
  };
}

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

describe('generateHomeDuplicateInteractionCandidates', () => {
  it("treats inquiry result 'changed' as a claimable candidate with no exclusion reason", async () => {
    const { tx, upsert } = buildTx([inquiry({ result: 'changed' })]);

    const created = await generateHomeDuplicateInteractionCandidates(tx, baseArgs());

    // 2026-06 → '1_i' rule for 相互作用 with no proposal/residual metadata
    const rule = resolveHomeDuplicateRules(BILLING_MONTH)['1_i'];
    expect(created).toEqual([{ status: 'candidate' }]);
    expect(upsert).toHaveBeenCalledTimes(1);

    const upsertArg = upsert.mock.calls[0][0] as {
      create: {
        status: string;
        exclusion_reason: string | null;
        billing_code: string;
        billing_name: string;
        source_snapshot: {
          validation_layers: {
            evidence: { state: string; message: string };
            rule_engine: { state: string; message: string };
          };
        };
      };
    };
    expect(upsertArg.create.status).toBe('candidate');
    expect(upsertArg.create.exclusion_reason).toBeNull();
    expect(upsertArg.create.billing_code).toBe(rule.code);
    expect(upsertArg.create.billing_name).toBe(rule.name);
    const layers = upsertArg.create.source_snapshot.validation_layers;
    expect(layers.evidence.state).toBe('passed');
    expect(layers.evidence.message).toBe('照会結果の変更確定を確認');
    expect(layers.rule_engine.state).toBe('manual_review');
    expect(layers.rule_engine.message).toBe(`${rule.targetLabel} の加算候補`);
  });

  it("excludes inquiry result 'unchanged' with the prescription-not-changed message", async () => {
    const { tx, upsert } = buildTx([inquiry({ result: 'unchanged' })]);

    const created = await generateHomeDuplicateInteractionCandidates(tx, baseArgs());

    const rule = resolveHomeDuplicateRules(BILLING_MONTH)['1_i'];
    const expectedMessage = `処方変更に至っていないため${rule.name}は算定できません`;
    expect(created).toEqual([{ status: 'excluded' }]);

    const upsertArg = upsert.mock.calls[0][0] as {
      create: {
        status: string;
        exclusion_reason: string | null;
        source_snapshot: {
          validation_layers: {
            evidence: { state: string; message: string };
            rule_engine: { state: string; message: string };
          };
        };
      };
    };
    expect(upsertArg.create.status).toBe('excluded');
    expect(upsertArg.create.exclusion_reason).toBe(expectedMessage);
    const layers = upsertArg.create.source_snapshot.validation_layers;
    expect(layers.evidence.state).toBe('blocked');
    expect(layers.evidence.message).toBe(expectedMessage);
    expect(layers.rule_engine.state).toBe('blocked');
    expect(layers.rule_engine.message).toBe(expectedMessage);
  });

  it('excludes an ambiguous/other inquiry result with the pending message', async () => {
    const { tx, upsert } = buildTx([inquiry({ result: 'pending' })]);

    const created = await generateHomeDuplicateInteractionCandidates(tx, baseArgs());

    const rule = resolveHomeDuplicateRules(BILLING_MONTH)['1_i'];
    const expectedMessage = `疑義照会の結果が未確定のため${rule.name}は保留です`;
    expect(created).toEqual([{ status: 'excluded' }]);

    const upsertArg = upsert.mock.calls[0][0] as {
      create: { status: string; exclusion_reason: string | null };
    };
    expect(upsertArg.create.status).toBe('excluded');
    expect(upsertArg.create.exclusion_reason).toBe(expectedMessage);
  });

  it('persists points resolved from the billing-rules registry per revision (regression: no hardcoded drift)', async () => {
    // 2026-06 billing 月 → 2026改定: 1_i = 薬学的有害事象等防止加算 ロ (50点)
    const { tx: tx2026, upsert: upsert2026 } = buildTx([inquiry({ result: 'changed' })]);
    await generateHomeDuplicateInteractionCandidates(tx2026, {
      orgId: 'org_1',
      billingMonth: new Date('2026-06-01T00:00:00.000Z'),
      ruleIdByKey: new Map<string, string>(),
      existingByKey: new Map<string, RegeneratedBillingCandidateRecord>(),
    });
    const create2026 = upsert2026.mock.calls[0][0].create as { points: number };
    expect(create2026.points).toBe(50);

    // 2024改定期(2024-07) → 1_i = 在宅患者重複投薬・相互作用等防止管理料1 イ (40点)
    const { tx: tx2024, upsert: upsert2024 } = buildTx([inquiry({ result: 'changed' })]);
    await generateHomeDuplicateInteractionCandidates(tx2024, {
      orgId: 'org_1',
      billingMonth: new Date('2024-07-01T00:00:00.000Z'),
      ruleIdByKey: new Map<string, string>(),
      existingByKey: new Map<string, RegeneratedBillingCandidateRecord>(),
    });
    const create2024 = upsert2024.mock.calls[0][0].create as { points: number };
    expect(create2024.points).toBe(40);
  });

  it('skips an inquiry whose cycle has no patient_id', async () => {
    const { tx, upsert, findManyMock } = buildTx([
      inquiry({ id: 'inq_no_patient', cycle: { patient_id: null } }),
    ]);

    const created = await generateHomeDuplicateInteractionCandidates(tx, baseArgs());

    expect(created).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it('also skips an inquiry whose cycle is null', async () => {
    const { tx, upsert } = buildTx([inquiry({ id: 'inq_no_cycle', cycle: null })]);

    const created = await generateHomeDuplicateInteractionCandidates(tx, baseArgs());

    expect(created).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('preserves the exclusion from an existing reviewed+excluded record via workflow note', async () => {
    const feeType = '1_i';
    const dedupeKey = `2026-06:home-dup:inq_existing:${feeType}`;
    const preservedNote = 'レビューで手動除外しました';
    const existing: RegeneratedBillingCandidateRecord = {
      id: 'cand_existing',
      dedupe_key: dedupeKey,
      status: 'excluded',
      updated_at: new Date('2026-06-10T00:00:00.000Z'),
      source_snapshot: {
        billing_close: {
          review_state: 'reviewed',
          resolution_state: 'excluded',
          note: preservedNote,
        },
      },
    };
    const existingByKey = new Map<string, RegeneratedBillingCandidateRecord>([
      [dedupeKey, existing],
    ]);

    const upsert = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const { tx } = buildTx(
      // result 'changed' would normally be a claimable candidate; existing review must keep it excluded
      [inquiry({ id: 'inq_existing', result: 'changed' })],
      { upsert, updateMany },
    );

    const created = await generateHomeDuplicateInteractionCandidates(tx, baseArgs(existingByKey));

    // existing record is review-locked → persist returns existing.status without upsert/updateMany write
    expect(created).toEqual([{ status: 'excluded' }]);
    expect(upsert).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
