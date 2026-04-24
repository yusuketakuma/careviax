import { Prisma } from '@prisma/client';
import type { JahisSupplementalRecord } from '@/lib/pharmacy/jahis-qr';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function readJahisSupplementalRecords(value: unknown): JahisSupplementalRecord[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): JahisSupplementalRecord[] => {
    if (!isRecord(item)) return [];

    const recordType = typeof item.recordType === 'string' ? item.recordType : null;
    const recordLabel = typeof item.recordLabel === 'string' ? item.recordLabel : null;
    const lineNumber =
      typeof item.lineNumber === 'number' && Number.isFinite(item.lineNumber)
        ? item.lineNumber
        : null;
    const fields = Array.isArray(item.fields)
      ? item.fields.filter((field): field is string => typeof field === 'string')
      : null;
    const details = Array.isArray(item.details)
      ? item.details.flatMap((detail): JahisSupplementalRecord['details'] => {
          if (!isRecord(detail)) return [];
          const label = typeof detail.label === 'string' ? detail.label : null;
          const value = typeof detail.value === 'string' ? detail.value : null;
          return label && value ? [{ label, value }] : [];
        })
      : [];
    const summary = typeof item.summary === 'string' ? item.summary : null;
    const rawLine = typeof item.rawLine === 'string' ? item.rawLine : null;

    if (!recordType || !recordLabel || lineNumber == null || !fields || !summary || !rawLine) {
      return [];
    }

    return [
      {
        recordType: recordType as JahisSupplementalRecord['recordType'],
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
