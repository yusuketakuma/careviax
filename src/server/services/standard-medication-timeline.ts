import type { Prisma } from '@prisma/client';
import { MedicationTimelineSourceKind } from '@prisma/client';
import { readJsonObject } from '@/lib/db/json';

type MedicationTimelineDb = {
  medicationTimelineItem: {
    findMany(args: {
      where: Prisma.MedicationTimelineItemWhereInput;
      orderBy: Prisma.MedicationTimelineItemOrderByWithRelationInput[];
      take: number;
      select: {
        id: true;
        source_kind: true;
        medication_coding: true;
        medication_display: true;
        medication_text: true;
        status: true;
        authored_at: true;
        effective_at: true;
        dispensed_at: true;
        asserted_at: true;
        quantity_value: true;
        quantity_unit: true;
        dosage_text: true;
        sync_status: true;
        updated_at: true;
      };
    }): Promise<
      Array<{
        id: string;
        source_kind: MedicationTimelineSourceKind;
        medication_coding: Prisma.JsonValue;
        medication_display: string | null;
        medication_text: string | null;
        status: string | null;
        authored_at: Date | null;
        effective_at: Date | null;
        dispensed_at: Date | null;
        asserted_at: Date | null;
        quantity_value: Prisma.Decimal | null;
        quantity_unit: string | null;
        dosage_text: string | null;
        sync_status: string;
        updated_at: Date;
      }>
    >;
  };
};

export interface ListStandardMedicationTimelineInput {
  readonly orgId: string;
  readonly patientId: string;
  readonly caseId?: string;
  readonly limit: number;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function sourceCategory(sourceKind: MedicationTimelineSourceKind) {
  switch (sourceKind) {
    case MedicationTimelineSourceKind.medication_request:
      return 'prescription';
    case MedicationTimelineSourceKind.medication_dispense:
      return 'dispensing';
    case MedicationTimelineSourceKind.medication_statement:
      return 'adherence';
    case MedicationTimelineSourceKind.residual_assessment:
      return 'residual';
    case MedicationTimelineSourceKind.followup:
      return 'followup';
    case MedicationTimelineSourceKind.visit_execution:
      return 'visit';
    default:
      return 'other';
  }
}

function firstMedicationCode(coding: Prisma.JsonValue): string | null {
  const values = Array.isArray(coding) ? coding : [];
  for (const value of values) {
    const item = readJsonObject(value);
    const code = typeof item?.code === 'string' ? item.code : null;
    if (code) return code;
  }
  return null;
}

function medicationLabel(row: {
  medication_display: string | null;
  medication_text: string | null;
  medication_coding: Prisma.JsonValue;
}) {
  return (
    row.medication_display?.trim() ||
    row.medication_text?.trim() ||
    firstMedicationCode(row.medication_coding) ||
    '薬剤情報'
  );
}

export async function listStandardMedicationTimeline(
  db: MedicationTimelineDb,
  input: ListStandardMedicationTimelineInput,
) {
  const rows = await db.medicationTimelineItem.findMany({
    where: {
      org_id: input.orgId,
      patient_id: input.patientId,
      ...(input.caseId ? { case_id: input.caseId } : {}),
    },
    orderBy: [{ effective_at: 'desc' }, { updated_at: 'desc' }],
    take: input.limit,
    select: {
      id: true,
      source_kind: true,
      medication_coding: true,
      medication_display: true,
      medication_text: true,
      status: true,
      authored_at: true,
      effective_at: true,
      dispensed_at: true,
      asserted_at: true,
      quantity_value: true,
      quantity_unit: true,
      dosage_text: true,
      sync_status: true,
      updated_at: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    category: sourceCategory(row.source_kind),
    medication_label: medicationLabel(row),
    medication_coding: row.medication_coding,
    status: row.status,
    authored_at: toIso(row.authored_at),
    effective_at: toIso(row.effective_at),
    dispensed_at: toIso(row.dispensed_at),
    asserted_at: toIso(row.asserted_at),
    quantity:
      row.quantity_value && row.quantity_unit
        ? { value: row.quantity_value.toString(), unit: row.quantity_unit }
        : null,
    dosage_text: row.dosage_text,
    sync_status: row.sync_status,
    updated_at: row.updated_at.toISOString(),
  }));
}
