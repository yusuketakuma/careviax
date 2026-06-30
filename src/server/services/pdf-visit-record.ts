import { prisma } from '@/lib/db/client';
import {
  applyPatientAssignmentWhere,
  buildVisitRecordScheduleAssignmentWhere,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { PdfNotFoundError } from './pdf-errors';
import {
  buildPdfPatientSummary,
  PDF_PATIENT_SUMMARY_SELECT,
  type PdfPatientSummary,
} from './pdf-patient-summary';

export type VisitRecordResidualRow = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  prescribed_quantity: number | null;
  remaining_quantity: number;
  excess_days: number | null;
  is_prohibited_reduction: boolean;
  is_reduction_target: boolean;
};

export type VisitRecordPdfEntry = {
  id: string;
  visit_date: Date;
  outcome_status: string;
  soap_subjective: string | null;
  soap_objective: string | null;
  soap_assessment: string | null;
  soap_plan: string | null;
  receipt_person_name: string | null;
  receipt_person_relation: string | null;
  receipt_at: Date | null;
  next_visit_suggestion_date: Date | null;
  cancellation_reason: string | null;
  postpone_reason: string | null;
  revisit_reason: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  pharmacist_id: string;
  pharmacist_name: string | null;
  last_modified_by_id: string | null;
  last_modified_by_name: string | null;
  schedule: {
    visit_type: string;
    scheduled_date: Date;
  } | null;
  patient: PdfPatientSummary;
  residuals: VisitRecordResidualRow[];
};

export type PatientVisitRecordPdfRecord = {
  patient: VisitRecordPdfEntry['patient'];
  dateFrom: Date | null;
  dateTo: Date | null;
  records: VisitRecordPdfEntry[];
};

async function getVisitRecordEntries(
  orgId: string,
  where: { id?: string; patientId?: string; dateFrom?: Date | null; dateTo?: Date | null },
  accessContext?: VisitScheduleAccessContext,
): Promise<VisitRecordPdfEntry[]> {
  const assignmentWhere = accessContext
    ? buildVisitRecordScheduleAssignmentWhere(accessContext)
    : null;

  const records = await prisma.visitRecord.findMany({
    where: {
      org_id: orgId,
      ...(where.id ? { id: where.id } : {}),
      ...(where.patientId ? { patient_id: where.patientId } : {}),
      ...(where.dateFrom || where.dateTo
        ? {
            visit_date: {
              ...(where.dateFrom ? { gte: where.dateFrom } : {}),
              ...(where.dateTo ? { lte: where.dateTo } : {}),
            },
          }
        : {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      patient_id: true,
      pharmacist_id: true,
      visit_date: true,
      outcome_status: true,
      soap_subjective: true,
      soap_objective: true,
      soap_assessment: true,
      soap_plan: true,
      receipt_person_name: true,
      receipt_person_relation: true,
      receipt_at: true,
      next_visit_suggestion_date: true,
      cancellation_reason: true,
      postpone_reason: true,
      revisit_reason: true,
      version: true,
      created_at: true,
      updated_at: true,
      schedule: {
        select: {
          case_id: true,
          visit_type: true,
          scheduled_date: true,
          case_: {
            select: {
              patient_id: true,
            },
          },
        },
      },
    },
  });

  const scopedRecords = records.filter(
    (record) => record.schedule?.case_?.patient_id === record.patient_id,
  );

  if (scopedRecords.length === 0) {
    throw new PdfNotFoundError('visitRecord');
  }

  const patientIds = Array.from(new Set(scopedRecords.map((record) => record.patient_id)));
  const recordIds = scopedRecords.map((record) => record.id);

  const [patients, residuals, auditLogs] = await Promise.all([
    prisma.patient.findMany({
      where: {
        org_id: orgId,
        id: { in: patientIds },
      },
      select: {
        ...PDF_PATIENT_SUMMARY_SELECT,
      },
    }),
    prisma.residualMedication.findMany({
      where: {
        org_id: orgId,
        visit_record_id: { in: recordIds },
      },
      orderBy: [{ created_at: 'asc' }],
      select: {
        id: true,
        visit_record_id: true,
        drug_name: true,
        drug_code: true,
        prescribed_quantity: true,
        remaining_quantity: true,
        excess_days: true,
        is_prohibited_reduction: true,
        is_reduction_target: true,
      },
    }),
    prisma.auditLog.findMany({
      where: {
        org_id: orgId,
        target_type: 'visit_record',
        target_id: { in: recordIds },
      },
      orderBy: [{ created_at: 'desc' }],
      select: {
        target_id: true,
        actor_id: true,
        created_at: true,
      },
    }),
  ]);

  const patientById = new Map(
    patients.map((patient) => [patient.id, buildPdfPatientSummary(patient)]),
  );
  const latestAuditByRecordId = new Map<string, { actor_id: string; created_at: Date }>();
  const userIds = new Set(records.map((record) => record.pharmacist_id));

  for (const audit of auditLogs) {
    if (!latestAuditByRecordId.has(audit.target_id)) {
      latestAuditByRecordId.set(audit.target_id, {
        actor_id: audit.actor_id,
        created_at: audit.created_at,
      });
      userIds.add(audit.actor_id);
    }
  }

  const users = await prisma.user.findMany({
    where: {
      org_id: orgId,
      id: { in: Array.from(userIds) },
    },
    select: {
      id: true,
      name: true,
    },
  });

  const userById = new Map(users.map((user) => [user.id, user.name]));
  const residualsByRecordId = new Map<string, VisitRecordResidualRow[]>();
  for (const residual of residuals) {
    const bucket = residualsByRecordId.get(residual.visit_record_id) ?? [];
    bucket.push({
      id: residual.id,
      drug_name: residual.drug_name,
      drug_code: residual.drug_code,
      prescribed_quantity: residual.prescribed_quantity,
      remaining_quantity: residual.remaining_quantity,
      excess_days: residual.excess_days,
      is_prohibited_reduction: residual.is_prohibited_reduction,
      is_reduction_target: residual.is_reduction_target,
    });
    residualsByRecordId.set(residual.visit_record_id, bucket);
  }

  return scopedRecords.map((record) => {
    const patient = patientById.get(record.patient_id);
    if (!patient) {
      throw new PdfNotFoundError('patient');
    }

    const latestAudit = latestAuditByRecordId.get(record.id);
    return {
      id: record.id,
      visit_date: record.visit_date,
      outcome_status: record.outcome_status,
      soap_subjective: record.soap_subjective,
      soap_objective: record.soap_objective,
      soap_assessment: record.soap_assessment,
      soap_plan: record.soap_plan,
      receipt_person_name: record.receipt_person_name,
      receipt_person_relation: record.receipt_person_relation,
      receipt_at: record.receipt_at,
      next_visit_suggestion_date: record.next_visit_suggestion_date,
      cancellation_reason: record.cancellation_reason,
      postpone_reason: record.postpone_reason,
      revisit_reason: record.revisit_reason,
      version: record.version,
      created_at: record.created_at,
      updated_at: record.updated_at,
      pharmacist_id: record.pharmacist_id,
      pharmacist_name: userById.get(record.pharmacist_id) ?? null,
      last_modified_by_id: latestAudit?.actor_id ?? record.pharmacist_id,
      last_modified_by_name:
        (latestAudit ? userById.get(latestAudit.actor_id) : null) ??
        userById.get(record.pharmacist_id) ??
        null,
      schedule: record.schedule,
      patient,
      residuals: residualsByRecordId.get(record.id) ?? [],
    };
  });
}

export async function getVisitRecordEntry(
  orgId: string,
  recordId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<VisitRecordPdfEntry> {
  const entries = await getVisitRecordEntries(orgId, { id: recordId }, accessContext);
  const entry = entries[0];
  if (!entry) {
    throw new PdfNotFoundError('visitRecord');
  }
  return entry;
}

export async function getPatientVisitRecordRecord(
  orgId: string,
  patientId: string,
  dateFrom?: Date | null,
  dateTo?: Date | null,
  accessContext?: VisitScheduleAccessContext,
): Promise<PatientVisitRecordPdfRecord> {
  const patient = await prisma.patient.findFirst({
    where: accessContext
      ? applyPatientAssignmentWhere({ id: patientId, org_id: orgId }, accessContext)
      : { id: patientId, org_id: orgId },
    select: {
      ...PDF_PATIENT_SUMMARY_SELECT,
    },
  });

  if (!patient) {
    throw new PdfNotFoundError('patient');
  }

  const records = await getVisitRecordEntries(
    orgId,
    { patientId, dateFrom, dateTo },
    accessContext,
  );

  return {
    patient: buildPdfPatientSummary(patient),
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    records,
  };
}
