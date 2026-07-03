import { describe, expect, it, vi } from 'vitest';
import {
  generateInformationProvisionCandidates,
  type InformationProvisionCandidatesTx,
} from './information-provision';
import type { RegeneratedBillingCandidateRecord } from './candidate-regeneration';

type TracingFixture = {
  id: string;
  patient_id: string;
  case_id: string | null;
  content: unknown;
  status: string;
  sent_at: Date | null;
};

function buildTx(tracingReports: TracingFixture[]) {
  const upsert = vi.fn().mockResolvedValue({});
  const tx = {
    billingCandidate: { upsert, updateMany: vi.fn(), findFirst: vi.fn() },
    tracingReport: { findMany: vi.fn().mockResolvedValue(tracingReports) },
    careReport: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as InformationProvisionCandidatesTx;
  return { tx, upsert };
}

function baseArgs(billingMonth: Date) {
  return {
    orgId: 'org_1',
    billingMonth,
    ruleIdByKey: new Map<string, string>(),
    existingByKey: new Map<string, RegeneratedBillingCandidateRecord>(),
    claimableEvidenceByPatient: new Map<string, { any: number; care: number }>(),
  };
}

// 服薬情報等提供料の点数は 2024/2026 改定で同額。レジストリ(billing-rules/revisions)を
// 唯一の値ソースとした後も現行点数が保存されることを固定する（回帰防止）。
describe('generateInformationProvisionCandidates registry points (regression)', () => {
  const feeCases: Array<{ feeType: string; expectedPoints: number }> = [
    { feeType: '1', expectedPoints: 30 },
    { feeType: '2_i', expectedPoints: 20 },
    { feeType: '2_ro', expectedPoints: 20 },
    { feeType: '3', expectedPoints: 50 },
  ];

  for (const billingMonth of [
    new Date('2024-07-01T00:00:00.000Z'),
    new Date('2026-06-01T00:00:00.000Z'),
  ]) {
    for (const { feeType, expectedPoints } of feeCases) {
      it(`persists ${expectedPoints}点 for fee type ${feeType} (${billingMonth.toISOString().slice(0, 7)})`, async () => {
        const { tx, upsert } = buildTx([
          {
            id: `trace_${feeType}`,
            patient_id: 'patient_1',
            case_id: 'case_1',
            content: { billing_fee_type: feeType },
            status: 'sent',
            sent_at: billingMonth,
          },
        ]);

        await generateInformationProvisionCandidates(tx, baseArgs(billingMonth));

        expect(upsert).toHaveBeenCalledTimes(1);
        const create = upsert.mock.calls[0][0].create as { points: number };
        expect(create.points).toBe(expectedPoints);
      });
    }
  }
});
