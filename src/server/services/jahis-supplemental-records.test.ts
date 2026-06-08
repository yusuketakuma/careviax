import { describe, expect, it, vi } from 'vitest';
import {
  buildPrescriptionInsuranceSidecarRows,
  buildMedicationIssueCandidatesFromJahisSupplementalRecords,
  createMedicationIssueCandidatesFromPrescriptionInsurance,
  createMedicationIssueCandidatesFromJahisSupplementalRecords,
  readJahisPrescriptionInsurance,
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

  it('separates allergy-like and lab-like free text into explicit review candidates', () => {
    const candidates = buildMedicationIssueCandidatesFromJahisSupplementalRecords({
      ...baseArgs,
      records: [
        record('411', 'ペニシリンで発疹あり。アレルギー疑い。'),
        record('601', 'eGFR 35、Cr 1.8。腎機能確認が必要。'),
      ],
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.data).toMatchObject({
      category: 'side_effect',
      priority: 'high',
      title: expect.stringContaining('アレルギー・副作用歴確認候補'),
    });
    expect(candidates[1]?.data).toMatchObject({
      category: 'other',
      priority: 'medium',
      title: expect.stringContaining('検査値・腎機能確認候補'),
    });
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

describe('createMedicationIssueCandidatesFromPrescriptionInsurance', () => {
  it('creates masked review candidates for prescription QR insurance and public subsidy sidecars', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = {
      medicationIssue: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany,
      },
    };

    await createMedicationIssueCandidatesFromPrescriptionInsurance(tx as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseId: 'case_1',
      prescriptionIntakeId: 'intake_1',
      identifiedBy: 'user_1',
      prescriptionInsurance: {
        insuranceType: '01',
        insurerNumber: '06123456',
        symbol: 'ABC123',
        number: '987654321',
        branchNumber: '01',
        patientCopayRatio: 30,
        publicSubsidies: [
          {
            rank: 1,
            payerNumber: '12345678',
            recipientNumber: '87654321',
          },
        ],
      },
    });

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          title: 'QR由来の保険情報確認候補',
          category: 'other',
          description: expect.stringContaining('[qr_prescription_insurance:intake_1:insurance]'),
        }),
        expect.objectContaining({
          title: 'QR由来の公費情報確認候補: 公費1',
          description: expect.stringContaining('[qr_prescription_public_subsidy:intake_1:1]'),
        }),
      ],
    });
    const descriptions = createMany.mock.calls[0]?.[0].data.map(
      (row: { description: string }) => row.description,
    );
    expect(descriptions?.join('\n')).toContain('保険者番号 ****3456');
    expect(descriptions?.join('\n')).toContain('受給者番号 ****4321');
    expect(descriptions?.join('\n')).not.toContain('06123456');
    expect(descriptions?.join('\n')).not.toContain('87654321');
  });

  it('skips duplicate insurance review candidates with the same marker', async () => {
    const createMany = vi.fn();
    const tx = {
      medicationIssue: {
        findMany: vi.fn().mockResolvedValue([
          {
            description: '[qr_prescription_insurance:intake_1:insurance]\n既存候補',
          },
        ]),
        createMany,
      },
    };

    await createMedicationIssueCandidatesFromPrescriptionInsurance(tx as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      prescriptionIntakeId: 'intake_1',
      identifiedBy: 'user_1',
      prescriptionInsurance: {
        insurerNumber: '06123456',
        publicSubsidies: [],
      },
    });

    expect(createMany).not.toHaveBeenCalled();
  });
});

describe('prescription insurance sidecar helpers', () => {
  it('parses prescription QR insurance metadata and builds intake sidecar rows', () => {
    const prescriptionInsurance = readJahisPrescriptionInsurance({
      insuranceType: '1',
      insurerNumber: '06012345',
      symbol: '記号A',
      number: '1234567',
      insuredPersonType: '1',
      branchNumber: '05',
      patientCopayRatio: 30,
      benefitRatio: 70,
      publicSubsidies: [{ rank: 1, payerNumber: '54123456', recipientNumber: '7654321' }],
    });

    const rows = buildPrescriptionInsuranceSidecarRows({
      orgId: 'org_1',
      patientId: 'patient_1',
      qrDraftId: 'draft_1',
      prescriptionIntakeId: 'intake_1',
      prescriptionInsurance,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      record_type: 'prescription_insurance',
      record_label: '処方QR保険情報',
      summary: expect.stringContaining('保険者番号 ****2345'),
      raw_line: expect.stringContaining('番号 ***4567'),
      prescription_intake_id: 'intake_1',
    });
    expect(rows[0]?.summary).not.toContain('06012345');
    expect(rows[0]?.summary).not.toContain('1234567');
    expect(rows[1]).toMatchObject({
      record_type: 'prescription_public_subsidy',
      record_label: '処方QR公費情報',
      summary: expect.stringContaining('受給者番号 ***4321'),
      raw_line: expect.stringContaining('負担者番号 ****3456'),
    });
    expect(rows[1]?.summary).not.toContain('54123456');
    expect(rows[1]?.summary).not.toContain('7654321');
  });
});
