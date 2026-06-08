import { Prisma } from '@prisma/client';
import { readJsonObject } from '@/lib/db/json';
import { isSupplementalRecordType, type JahisSupplementalRecord } from '@/lib/pharmacy/jahis-qr';

const CLINICAL_SUPPLEMENTAL_RECORD_TYPES = new Set(['4', '411', '421', '601']);
const CLINICAL_NOTE_PATTERN =
  /(残薬|飲み忘れ|飲忘れ|服用中断|中断|自己判断|副作用|眠気|眠く|ふらつき|めまい|吐き気|発疹|かゆみ|アレルギ|アナフィラ|喘息|息苦し|eGFR|egfr|Cr|クレアチニン|K値|カリウム|PT-?INR|INR|検査値|腎機能)/i;
const SIDE_EFFECT_PATTERN =
  /(副作用|眠気|眠く|ふらつき|めまい|吐き気|発疹|かゆみ|アレルギ|アナフィラ|喘息|息苦し)/i;
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
  if (record.recordType !== '421' && !CLINICAL_NOTE_PATTERN.test(text)) return null;

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
    const rawLine = typeof record.rawLine === 'string' ? record.rawLine : null;

    if (!recordType || !recordLabel || lineNumber == null || !fields || !summary || !rawLine) {
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
