import { Prisma } from '@prisma/client';
import { readJsonObject } from '@/lib/db/json';
import { isSupplementalRecordType, type JahisSupplementalRecord } from '@/lib/pharmacy/jahis-qr';

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
