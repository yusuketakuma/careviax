import { describe, expect, it, vi } from 'vitest';
import {
  buildMedicationIssueCandidatesFromJahisSupplementalRecords,
  createMedicationIssueCandidatesFromJahisSupplementalRecords,
} from './jahis-supplemental-records';
import type { JahisSupplementalRecord } from '@/lib/pharmacy/jahis-qr';

function record(
  recordType: JahisSupplementalRecord['recordType'],
  summary: string,
): JahisSupplementalRecord {
  return {
    recordType,
    recordLabel:
      recordType === '3'
        ? '要指導医薬品・一般用医薬品服用'
        : recordType === '31'
          ? '要指導医薬品・一般用医薬品成分'
          : recordType === '421'
            ? '残薬確認'
            : recordType === '601'
              ? '患者等記入'
              : '備考',
    lineNumber: Number(recordType),
    fields: [summary],
    details: [{ label: '内容', value: summary }],
    summary,
    rawLine: `${recordType},${summary}`,
  };
}

const baseArgs = {
  orgId: 'org_1',
  patientId: 'patient_1',
  caseId: 'case_1',
  prescriptionIntakeId: 'intake_1',
  identifiedBy: 'user_1',
};

describe('buildMedicationIssueCandidatesFromJahisSupplementalRecords', () => {
  it('creates reviewable adherence and side-effect candidates from clinical QR supplemental records', () => {
    const candidates = buildMedicationIssueCandidatesFromJahisSupplementalRecords({
      ...baseArgs,
      records: [
        record('421', 'アムロジピンが10錠残薬。自己判断で中断あり。'),
        record('601', '昼に眠くなる。副作用疑いあり。'),
      ],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.data).toMatchObject({
      category: 'adherence',
      priority: 'medium',
      title: expect.stringContaining('服薬状況確認候補'),
      patient_id: 'patient_1',
      case_id: 'case_1',
      identified_by: 'user_1',
    });
    expect(candidates[0]?.data.description).toContain('[qr_supplemental:intake_1:421:421]');
    expect(candidates[1]?.data).toMatchObject({
      category: 'side_effect',
      priority: 'high',
      title: expect.stringContaining('副作用・体調変化候補'),
    });
  });

  it('does not create issues from non-clinical supplemental notes', () => {
    const candidates = buildMedicationIssueCandidatesFromJahisSupplementalRecords({
      ...baseArgs,
      records: [record('601', '家族からの一般的な連絡事項のみ')],
    });

    expect(candidates).toEqual([]);
  });

  it('creates OTC and ingredient review candidates so non-prescription drugs do not stop at storage', () => {
    const candidates = buildMedicationIssueCandidatesFromJahisSupplementalRecords({
      ...baseArgs,
      records: [record('3', 'バファリンAを服用中'), record('31', 'アスピリン')],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.data).toMatchObject({
      category: 'other',
      priority: 'medium',
      title: expect.stringContaining('OTC・一般用薬確認候補'),
    });
    expect(candidates[1]?.data.description).toContain('[qr_supplemental:intake_1:31:31]');
  });
});

describe('createMedicationIssueCandidatesFromJahisSupplementalRecords', () => {
  it('skips candidates that already have the same marker', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        description: '[qr_supplemental:intake_1:421:421]\n既存のQR由来レビュー候補',
      },
    ]);
    const createMany = vi.fn();
    const tx = {
      medicationIssue: {
        findMany,
        createMany,
      },
    };

    const result = await createMedicationIssueCandidatesFromJahisSupplementalRecords(tx as never, {
      ...baseArgs,
      records: [record('421', 'アムロジピンが10錠残薬。')],
    });

    expect(result).toEqual({ count: 0 });
    expect(findMany).toHaveBeenCalledOnce();
    expect(createMany).not.toHaveBeenCalled();
  });
});
