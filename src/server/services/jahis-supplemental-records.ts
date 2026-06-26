import { Prisma } from '@prisma/client';
import { readJsonObject } from '@/lib/db/json';
import {
  isSupplementalRecordType,
  type JahisPrescriptionInsurance,
  type JahisPrescriptionPublicSubsidy,
  type JahisSupplementalRecord,
} from '@/lib/pharmacy/jahis-qr';

const CLINICAL_SUPPLEMENTAL_RECORD_TYPES = new Set(['3', '31', '4', '411', '421', '601']);
const CLINICAL_NOTE_PATTERN =
  /(残薬|飲み忘れ|飲忘れ|服用中断|中断|自己判断|副作用|眠気|眠く|ふらつき|めまい|吐き気|発疹|かゆみ|アレルギ|アナフィラ|喘息|息苦し|eGFR|egfr|Cr|クレアチニン|K値|カリウム|PT-?INR|INR|検査値|腎機能)/i;
const SIDE_EFFECT_PATTERN =
  /(副作用|眠気|眠く|ふらつき|めまい|吐き気|発疹|かゆみ|アレルギ|アナフィラ|喘息|息苦し)/i;
const ALLERGY_PATTERN = /(アレルギ|アナフィラ|発疹|喘息|息苦し)/i;
const LAB_PATTERN = /(eGFR|egfr|Cr|クレアチニン|K値|カリウム|PT-?INR|INR|検査値|腎機能)/i;
const ADHERENCE_PATTERN = /(残薬|飲み忘れ|飲忘れ|服用中断|中断|自己判断)/;

function buildSupplementalRecordText(record: JahisSupplementalRecord) {
  return [
    record.summary,
    ...record.details.map((detail) => `${detail.label}: ${detail.value}`),
    record.rawLine,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n');
}

function classifySupplementalRecordIssue(record: JahisSupplementalRecord) {
  if (!CLINICAL_SUPPLEMENTAL_RECORD_TYPES.has(record.recordType)) return null;

  const text = buildSupplementalRecordText(record);
  if (!text.trim()) return null;
  if (record.recordType === '3' || record.recordType === '31') {
    return {
      category: 'other' as const,
      priority: 'medium' as const,
      title: `QR由来のOTC・一般用薬確認候補: ${record.recordLabel}`,
    };
  }
  if (record.recordType !== '421' && !CLINICAL_NOTE_PATTERN.test(text)) return null;

  if (ALLERGY_PATTERN.test(text)) {
    return {
      category: 'side_effect' as const,
      priority: 'high' as const,
      title: `QR由来のアレルギー・副作用歴確認候補: ${record.recordLabel}`,
    };
  }

  if (SIDE_EFFECT_PATTERN.test(text)) {
    return {
      category: 'side_effect' as const,
      priority: 'high' as const,
      title: `QR由来の副作用・体調変化候補: ${record.recordLabel}`,
    };
  }

  if (record.recordType === '421' || ADHERENCE_PATTERN.test(text)) {
    return {
      category: 'adherence' as const,
      priority: 'medium' as const,
      title: `QR由来の服薬状況確認候補: ${record.recordLabel}`,
    };
  }

  if (LAB_PATTERN.test(text)) {
    return {
      category: 'other' as const,
      priority: 'medium' as const,
      title: `QR由来の検査値・腎機能確認候補: ${record.recordLabel}`,
    };
  }

  return {
    category: 'other' as const,
    priority: 'medium' as const,
    title: `QR由来の確認候補: ${record.recordLabel}`,
  };
}

function buildIssueMarker(args: { prescriptionIntakeId: string; record: JahisSupplementalRecord }) {
  return `[qr_supplemental:${args.prescriptionIntakeId}:${args.record.recordType}:${args.record.lineNumber}]`;
}

export function buildMedicationIssueCandidatesFromJahisSupplementalRecords(args: {
  orgId: string;
  patientId: string;
  caseId?: string | null;
  prescriptionIntakeId: string;
  identifiedBy: string;
  records: JahisSupplementalRecord[];
}) {
  return args.records.flatMap((record) => {
    const classification = classifySupplementalRecordIssue(record);
    if (!classification) return [];

    const marker = buildIssueMarker({ prescriptionIntakeId: args.prescriptionIntakeId, record });
    const text = buildSupplementalRecordText(record);
    return [
      {
        marker,
        data: {
          org_id: args.orgId,
          patient_id: args.patientId,
          case_id: args.caseId ?? null,
          title: classification.title,
          description: [
            marker,
            `QR補助レコード ${record.recordType} (${record.recordLabel}) から自動起票したレビュー候補です。確定情報として扱う前に薬剤師が確認してください。`,
            text,
          ].join('\n'),
          status: 'open' as const,
          priority: classification.priority,
          category: classification.category,
          identified_by: args.identifiedBy,
        },
      },
    ];
  });
}

export function readJahisSupplementalRecords(value: unknown): JahisSupplementalRecord[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): JahisSupplementalRecord[] => {
    const record = readJsonObject(item);
    if (!record) return [];

    const recordType =
      typeof record.recordType === 'string' && isSupplementalRecordType(record.recordType)
        ? record.recordType
        : null;
    const recordLabel = typeof record.recordLabel === 'string' ? record.recordLabel : null;
    const lineNumber =
      typeof record.lineNumber === 'number' && Number.isFinite(record.lineNumber)
        ? record.lineNumber
        : null;
    const fields = Array.isArray(record.fields)
      ? record.fields.filter((field): field is string => typeof field === 'string')
      : null;
    const details = Array.isArray(record.details)
      ? record.details.flatMap((detail): JahisSupplementalRecord['details'] => {
          const detailRecord = readJsonObject(detail);
          if (!detailRecord) return [];
          const label = typeof detailRecord.label === 'string' ? detailRecord.label : null;
          const value = typeof detailRecord.value === 'string' ? detailRecord.value : null;
          return label && value ? [{ label, value }] : [];
        })
      : [];
    const summary = typeof record.summary === 'string' ? record.summary : null;
    const rawLine = typeof record.rawLine === 'string' ? record.rawLine : (summary ?? '');

    if (!recordType || !recordLabel || lineNumber == null || !fields || !summary) {
      return [];
    }

    return [
      {
        recordType,
        recordLabel,
        lineNumber,
        fields,
        details,
        summary,
        rawLine,
      },
    ];
  });
}

function readTextField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readPublicSubsidyRank(record: Record<string, unknown>) {
  const rank = readNumberField(record, 'rank');
  return rank === 1 || rank === 2 || rank === 3 ? rank : undefined;
}

export function readJahisPrescriptionInsurance(value: unknown): JahisPrescriptionInsurance | null {
  const record = readJsonObject(value);
  if (!record) return null;

  const publicSubsidies = Array.isArray(record.publicSubsidies)
    ? record.publicSubsidies.flatMap((item): JahisPrescriptionPublicSubsidy[] => {
        const subsidy = readJsonObject(item);
        if (!subsidy) return [];
        const rank = readPublicSubsidyRank(subsidy);
        const payerNumber = readTextField(subsidy, 'payerNumber');
        if (rank == null || !payerNumber) return [];
        return [
          {
            rank,
            payerNumber,
            recipientNumber: readTextField(subsidy, 'recipientNumber'),
          },
        ];
      })
    : [];

  const insurance: JahisPrescriptionInsurance = {
    insuranceType: readTextField(record, 'insuranceType'),
    insurerNumber: readTextField(record, 'insurerNumber'),
    symbol: readTextField(record, 'symbol'),
    number: readTextField(record, 'number'),
    insuredPersonType: readTextField(record, 'insuredPersonType'),
    branchNumber: readTextField(record, 'branchNumber'),
    patientCopayRatio: readNumberField(record, 'patientCopayRatio'),
    benefitRatio: readNumberField(record, 'benefitRatio'),
    publicSubsidies,
  };

  const hasInsuranceValue = Object.entries(insurance).some(([key, fieldValue]) =>
    key === 'publicSubsidies' ? false : fieldValue !== undefined,
  );
  return hasInsuranceValue || publicSubsidies.length > 0 ? insurance : null;
}

function maskIdentifier(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '*'.repeat(trimmed.length);
  return `${'*'.repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

function buildInsuranceSummary(insurance: JahisPrescriptionInsurance) {
  return [
    insurance.insurerNumber ? `保険者番号 ${maskIdentifier(insurance.insurerNumber)}` : null,
    insurance.symbol ? `記号 ${maskIdentifier(insurance.symbol)}` : null,
    insurance.number ? `番号 ${maskIdentifier(insurance.number)}` : null,
    insurance.branchNumber ? `枝番 ${maskIdentifier(insurance.branchNumber)}` : null,
    insurance.patientCopayRatio != null ? `負担割合 ${insurance.patientCopayRatio}%` : null,
  ]
    .filter(Boolean)
    .join(' / ');
}

function buildPrescriptionInsuranceIssueCandidates(args: {
  orgId: string;
  patientId: string;
  caseId?: string | null;
  prescriptionIntakeId: string;
  identifiedBy: string;
  prescriptionInsurance: JahisPrescriptionInsurance | null;
}) {
  const insurance = args.prescriptionInsurance;
  if (!insurance) return [];

  const candidates: Array<{
    marker: string;
    data: Prisma.MedicationIssueCreateManyInput;
  }> = [];

  const insuranceDetails = [
    insurance.insurerNumber ? `保険者番号 ${maskIdentifier(insurance.insurerNumber)}` : null,
    insurance.symbol ? `記号 ${maskIdentifier(insurance.symbol)}` : null,
    insurance.number ? `番号 ${maskIdentifier(insurance.number)}` : null,
    insurance.branchNumber ? `枝番 ${maskIdentifier(insurance.branchNumber)}` : null,
    insurance.patientCopayRatio != null ? `負担割合 ${insurance.patientCopayRatio}%` : null,
  ].filter(Boolean);
  if (insuranceDetails.length > 0) {
    const marker = `[qr_prescription_insurance:${args.prescriptionIntakeId}:insurance]`;
    candidates.push({
      marker,
      data: {
        org_id: args.orgId,
        patient_id: args.patientId,
        case_id: args.caseId ?? null,
        title: 'QR由来の保険情報確認候補',
        description: [
          marker,
          '処方QRから読み取った保険情報です。PatientInsuranceへは自動反映していません。請求前に原本・資格確認結果と照合してください。',
          ...insuranceDetails,
        ].join('\n'),
        status: 'open',
        priority: 'medium',
        category: 'other',
        identified_by: args.identifiedBy,
      },
    });
  }

  for (const subsidy of insurance.publicSubsidies) {
    const marker = `[qr_prescription_public_subsidy:${args.prescriptionIntakeId}:${subsidy.rank}]`;
    candidates.push({
      marker,
      data: {
        org_id: args.orgId,
        patient_id: args.patientId,
        case_id: args.caseId ?? null,
        title: `QR由来の公費情報確認候補: 公費${subsidy.rank}`,
        description: [
          marker,
          '処方QRから読み取った公費情報です。PatientInsuranceへは自動反映していません。請求前に受給者証・資格確認結果と照合してください。',
          `負担者番号 ${maskIdentifier(subsidy.payerNumber)}`,
          subsidy.recipientNumber ? `受給者番号 ${maskIdentifier(subsidy.recipientNumber)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        status: 'open',
        priority: 'medium',
        category: 'other',
        identified_by: args.identifiedBy,
      },
    });
  }

  return candidates;
}

export function buildPrescriptionInsuranceSidecarRows(args: {
  orgId: string;
  patientId: string;
  qrDraftId: string;
  prescriptionIntakeId: string;
  prescriptionInsurance: JahisPrescriptionInsurance | null;
}): Prisma.JahisSupplementalRecordCreateManyInput[] {
  const insurance = args.prescriptionInsurance;
  if (!insurance) return [];

  const rows: Prisma.JahisSupplementalRecordCreateManyInput[] = [];
  const insuranceSummary = buildInsuranceSummary(insurance);
  if (insuranceSummary) {
    rows.push({
      org_id: args.orgId,
      patient_id: args.patientId,
      qr_draft_id: args.qrDraftId,
      prescription_intake_id: args.prescriptionIntakeId,
      record_type: 'prescription_insurance',
      record_label: '処方QR保険情報',
      line_number: 21,
      summary: insuranceSummary,
      payload: {
        insuranceType: insurance.insuranceType ?? null,
        insurerNumber: insurance.insurerNumber ?? null,
        symbol: insurance.symbol ?? null,
        number: insurance.number ?? null,
        insuredPersonType: insurance.insuredPersonType ?? null,
        branchNumber: insurance.branchNumber ?? null,
        patientCopayRatio: insurance.patientCopayRatio ?? null,
        benefitRatio: insurance.benefitRatio ?? null,
      } satisfies Prisma.InputJsonObject,
      raw_line: insuranceSummary,
    });
  }

  for (const subsidy of insurance.publicSubsidies) {
    const summary = [
      `公費${subsidy.rank}`,
      `負担者番号 ${maskIdentifier(subsidy.payerNumber)}`,
      subsidy.recipientNumber ? `受給者番号 ${maskIdentifier(subsidy.recipientNumber)}` : null,
    ]
      .filter(Boolean)
      .join(' / ');
    rows.push({
      org_id: args.orgId,
      patient_id: args.patientId,
      qr_draft_id: args.qrDraftId,
      prescription_intake_id: args.prescriptionIntakeId,
      record_type: 'prescription_public_subsidy',
      record_label: '処方QR公費情報',
      line_number: 26 + subsidy.rank,
      summary,
      payload: {
        rank: subsidy.rank,
        payerNumber: subsidy.payerNumber,
        recipientNumber: subsidy.recipientNumber ?? null,
      } satisfies Prisma.InputJsonObject,
      raw_line: summary,
    });
  }

  return rows;
}

export async function replaceJahisSupplementalRecords(
  tx: Prisma.TransactionClient,
  args: {
    orgId: string;
    patientId?: string | null;
    qrDraftId?: string | null;
    prescriptionIntakeId?: string | null;
    records: JahisSupplementalRecord[] | undefined;
  },
) {
  const records = args.records ?? [];

  if (args.qrDraftId) {
    await tx.jahisSupplementalRecord.deleteMany({
      where: { org_id: args.orgId, qr_draft_id: args.qrDraftId },
    });
  }

  if (args.prescriptionIntakeId) {
    await tx.jahisSupplementalRecord.deleteMany({
      where: { org_id: args.orgId, prescription_intake_id: args.prescriptionIntakeId },
    });
  }

  if (records.length === 0) return { count: 0 };

  return tx.jahisSupplementalRecord.createMany({
    data: records.map((record) => ({
      org_id: args.orgId,
      patient_id: args.patientId ?? null,
      qr_draft_id: args.qrDraftId ?? null,
      prescription_intake_id: args.prescriptionIntakeId ?? null,
      record_type: record.recordType,
      record_label: record.recordLabel,
      line_number: record.lineNumber,
      summary: record.summary,
      payload: {
        fields: record.fields,
        details: record.details.map((detail) => ({
          label: detail.label,
          value: detail.value,
        })),
      } satisfies Prisma.InputJsonObject,
      raw_line: record.rawLine,
    })),
  });
}

export async function attachJahisSupplementalRecordsToIntake(
  tx: Prisma.TransactionClient,
  args: {
    orgId: string;
    patientId: string;
    qrDraftId: string;
    prescriptionIntakeId: string;
    fallbackRecords: JahisSupplementalRecord[];
  },
) {
  const updated = await tx.jahisSupplementalRecord.updateMany({
    where: {
      org_id: args.orgId,
      qr_draft_id: args.qrDraftId,
      prescription_intake_id: null,
    },
    data: {
      patient_id: args.patientId,
      prescription_intake_id: args.prescriptionIntakeId,
    },
  });

  if (updated.count > 0 || args.fallbackRecords.length === 0) {
    return updated;
  }

  return replaceJahisSupplementalRecords(tx, {
    orgId: args.orgId,
    patientId: args.patientId,
    qrDraftId: args.qrDraftId,
    prescriptionIntakeId: args.prescriptionIntakeId,
    records: args.fallbackRecords,
  });
}

export async function attachJahisPrescriptionInsuranceSidecarToIntake(
  tx: Prisma.TransactionClient,
  args: {
    orgId: string;
    patientId: string;
    qrDraftId: string;
    prescriptionIntakeId: string;
    prescriptionInsurance: JahisPrescriptionInsurance | null;
  },
) {
  const rows = buildPrescriptionInsuranceSidecarRows(args);
  if (rows.length === 0) return { count: 0 };

  await tx.jahisSupplementalRecord.deleteMany({
    where: {
      org_id: args.orgId,
      qr_draft_id: args.qrDraftId,
      prescription_intake_id: args.prescriptionIntakeId,
      record_type: { in: ['prescription_insurance', 'prescription_public_subsidy'] },
    },
  });

  return tx.jahisSupplementalRecord.createMany({ data: rows });
}

export async function createMedicationIssueCandidatesFromJahisSupplementalRecords(
  tx: Prisma.TransactionClient,
  args: {
    orgId: string;
    patientId: string;
    caseId?: string | null;
    prescriptionIntakeId: string;
    identifiedBy: string;
    records: JahisSupplementalRecord[];
  },
) {
  const candidates = buildMedicationIssueCandidatesFromJahisSupplementalRecords(args);
  if (candidates.length === 0) return { count: 0 };

  const existingIssues = await tx.medicationIssue.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      status: { in: ['open', 'in_progress'] },
      OR: candidates.map((candidate) => ({
        description: { contains: candidate.marker },
      })),
    },
    select: { description: true },
  });
  const existingDescriptions = existingIssues.map((issue) => issue.description);
  const newCandidates = candidates.filter(
    (candidate) =>
      !existingDescriptions.some((description) => description.includes(candidate.marker)),
  );

  if (newCandidates.length === 0) return { count: 0 };

  return tx.medicationIssue.createMany({
    data: newCandidates.map((candidate) => candidate.data),
  });
}

export async function createMedicationIssueCandidatesFromPrescriptionInsurance(
  tx: Prisma.TransactionClient,
  args: {
    orgId: string;
    patientId: string;
    caseId?: string | null;
    prescriptionIntakeId: string;
    identifiedBy: string;
    prescriptionInsurance: JahisPrescriptionInsurance | null;
  },
) {
  const candidates = buildPrescriptionInsuranceIssueCandidates(args);
  if (candidates.length === 0) return { count: 0 };

  const existingIssues = await tx.medicationIssue.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      status: { in: ['open', 'in_progress'] },
      OR: candidates.map((candidate) => ({
        description: { contains: candidate.marker },
      })),
    },
    select: { description: true },
  });
  const existingDescriptions = existingIssues.map((issue) => issue.description);
  const newCandidates = candidates.filter(
    (candidate) =>
      !existingDescriptions.some((description) => description.includes(candidate.marker)),
  );

  if (newCandidates.length === 0) return { count: 0 };

  return tx.medicationIssue.createMany({
    data: newCandidates.map((candidate) => candidate.data),
  });
}
