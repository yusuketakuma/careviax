import { addDays, differenceInCalendarDays } from 'date-fns';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { conflict, success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import {
  createVisitRecordSchema,
  type CreateVisitRecordInput,
} from '@/lib/validations/visit-record';
import { prisma } from '@/lib/db/client';
import { getRequestAuthContext } from '@/lib/auth/request-context';
import { buildAllSoapTexts } from '@/lib/utils/soap-text-builder';
import { getNextSimpleRruleOccurrence } from '@/lib/visits/rrule';
import type { StructuredSoap } from '@/types/structured-soap';
import type { Prisma, LabAnalyteCode } from '@prisma/client';
import { upsertBillingEvidenceForVisit } from '@/server/services/billing-evidence';
import { processHandoffExtraction } from '@/server/services/visit-handoff';
import { upsertOperationalTask } from '@/server/services/operational-tasks';

const scheduleStatusByOutcome: Record<
  CreateVisitRecordInput['outcome_status'],
  'completed' | 'postponed' | 'cancelled'
> = {
  completed: 'completed',
  revisit_needed: 'completed',
  postponed: 'postponed',
  cancelled: 'cancelled',
  delivery_only: 'completed',
  completed_with_issue: 'completed',
};

const cycleCompletionOutcomes = new Set<CreateVisitRecordInput['outcome_status']>([
  'completed',
  'completed_with_issue',
  'revisit_needed',
]);

const firstVisitDocumentOutcomes = new Set<CreateVisitRecordInput['outcome_status']>([
  'completed',
  'completed_with_issue',
  'revisit_needed',
  'delivery_only',
]);

type VisitRecordConflictDetail = {
  id: string;
  version: number;
  patient_id: string;
  visit_date: string;
  outcome_status: string;
  soap_subjective: string | null;
  soap_objective: string | null;
  soap_assessment: string | null;
  soap_plan: string | null;
  next_visit_suggestion_date: string | null;
  residual_medications: Array<{
    drug_name: string;
    drug_code: string | null;
    prescribed_quantity: number | null;
    prescribed_daily_dose: number | null;
    remaining_quantity: number;
    is_prohibited_reduction: boolean;
  }>;
};

type VisitRecordHandoffExtractionPayload = {
  patientId: string;
  patientName: string;
  structuredSoap: StructuredSoap;
  soapAssessment: string | null;
  soapPlan: string | null;
};

async function loadExistingVisitRecordConflict(
  tx: Prisma.TransactionClient,
  orgId: string,
  scheduleId: string
): Promise<VisitRecordConflictDetail | null> {
  const existing = await tx.visitRecord.findFirst({
    where: {
      org_id: orgId,
      schedule_id: scheduleId,
    },
    select: {
      id: true,
      version: true,
      patient_id: true,
      visit_date: true,
      outcome_status: true,
      soap_subjective: true,
      soap_objective: true,
      soap_assessment: true,
      soap_plan: true,
      next_visit_suggestion_date: true,
    },
  });

  if (!existing) return null;

  const residualMedications = await tx.residualMedication.findMany({
    where: {
      org_id: orgId,
      visit_record_id: existing.id,
    },
    select: {
      drug_name: true,
      drug_code: true,
      prescribed_quantity: true,
      remaining_quantity: true,
      is_prohibited_reduction: true,
    },
  });

  return {
    id: existing.id,
    version: existing.version,
    patient_id: existing.patient_id,
    visit_date: existing.visit_date.toISOString().slice(0, 10),
    outcome_status: existing.outcome_status,
    soap_subjective: existing.soap_subjective,
    soap_objective: existing.soap_objective,
    soap_assessment: existing.soap_assessment,
    soap_plan: existing.soap_plan,
    next_visit_suggestion_date: existing.next_visit_suggestion_date?.toISOString() ?? null,
    residual_medications: residualMedications.map((item) => ({
      ...item,
      prescribed_quantity: item.prescribed_quantity ?? null,
      prescribed_daily_dose: null,
    })),
  };
}

const LAB_ANALYTE_CODES = new Set([
  'wbc', 'neut', 'hb', 'plt', 'pt_inr', 'ast', 'alt', 't_bil',
  'scr', 'egfr', 'bun', 'ck', 'bnp', 'nt_pro_bnp', 'na', 'k', 'cl',
  'hba1c', 'blood_glucose', 'alb', 'tp', 'crp',
]);

async function syncLabObservations(
  tx: Prisma.TransactionClient,
  orgId: string,
  patientId: string,
  visitRecordId: string,
  visitDate: Date,
  labValues: Record<string, unknown>,
) {
  const entries = Object.entries(labValues).filter(
    ([key, val]) => LAB_ANALYTE_CODES.has(key) && typeof val === 'number',
  ) as [string, number][];

  if (entries.length === 0) return;

  // Remove previous observations from this visit record on re-save
  await tx.patientLabObservation.deleteMany({
    where: { org_id: orgId, source_visit_record_id: visitRecordId },
  });

  await tx.patientLabObservation.createMany({
    data: entries.map(([key, val]) => ({
      org_id: orgId,
      patient_id: patientId,
      analyte_code: key as LabAnalyteCode,
      measured_at: visitDate,
      value_numeric: val,
      source_type: 'visit_record',
      source_visit_record_id: visitRecordId,
    })),
  });
}

async function replaceResidualMedications(
  tx: Prisma.TransactionClient,
  orgId: string,
  visitRecordId: string,
  residualMedications: CreateVisitRecordInput['residual_medications']
) {
  await tx.residualMedication.deleteMany({
    where: {
      org_id: orgId,
      visit_record_id: visitRecordId,
    },
  });

  if (!residualMedications || residualMedications.length === 0) return;

  await Promise.all(
    residualMedications.map((medication) => {
      let excessDays: number | undefined;
      if (
        medication.prescribed_daily_dose &&
        medication.prescribed_daily_dose > 0 &&
        medication.remaining_quantity > 0
      ) {
        excessDays = Math.floor(
          medication.remaining_quantity / medication.prescribed_daily_dose
        );
      }

      return tx.residualMedication.create({
        data: {
          org_id: orgId,
          visit_record_id: visitRecordId,
          drug_name: medication.drug_name,
          drug_code: medication.drug_code,
          prescribed_quantity: medication.prescribed_quantity,
          remaining_quantity: medication.remaining_quantity,
          excess_days: excessDays ?? null,
          is_reduction_target: excessDays !== undefined && excessDays > 7,
          is_prohibited_reduction: medication.is_prohibited_reduction,
        },
      });
    })
  );
}

type ResidualReductionCandidate = {
  drug_name: string;
  drug_code?: string;
  remaining_quantity: number;
  prescribed_daily_dose: number;
  excess_days: number;
  is_prohibited_reduction: boolean;
};

function collectResidualReductionCandidates(
  residualMedications: CreateVisitRecordInput['residual_medications']
): ResidualReductionCandidate[] {
  const candidates: ResidualReductionCandidate[] = [];

  for (const medication of residualMedications ?? []) {
      const prescribedDailyDose = medication.prescribed_daily_dose ?? 0;
      if (prescribedDailyDose <= 0 || medication.remaining_quantity <= 0) continue;

      const excessDays = Math.floor(medication.remaining_quantity / prescribedDailyDose);
      if (excessDays <= 7) continue;

      candidates.push({
        drug_name: medication.drug_name,
        drug_code: medication.drug_code ?? undefined,
        remaining_quantity: medication.remaining_quantity,
        prescribed_daily_dose: prescribedDailyDose,
        excess_days: excessDays,
        is_prohibited_reduction: medication.is_prohibited_reduction,
      });
  }

  return candidates;
}

async function upsertFirstVisitDocument(args: {
  tx: Prisma.TransactionClient;
  orgId: string;
  patientId: string;
  caseId: string;
  recordId: string;
  receiptAt?: string;
  receiptPersonName?: string;
}) {
  const contacts = await args.tx.contactParty.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      OR: [{ is_emergency_contact: true }, { relation: 'facility_staff' }],
    },
    orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
    select: {
      id: true,
      name: true,
      relation: true,
      phone: true,
      email: true,
      fax: true,
      organization_name: true,
      department: true,
      is_primary: true,
      is_emergency_contact: true,
    },
  });

  const emergencyContacts = contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    relation: contact.relation,
    phone: contact.phone,
    email: contact.email,
    fax: contact.fax,
    organization_name: contact.organization_name,
    department: contact.department,
    is_primary: contact.is_primary,
    is_emergency_contact: contact.is_emergency_contact,
  })) satisfies Prisma.InputJsonValue;

  const existing = await args.tx.firstVisitDocument.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      case_id: args.caseId,
    },
    select: {
      id: true,
      document_url: true,
      delivered_at: true,
      delivered_to: true,
    },
  });

  const documentUrl = existing?.document_url ?? `/api/visit-records/${args.recordId}/pdf`;
  const deliveredAt = args.receiptAt ? new Date(args.receiptAt) : existing?.delivered_at ?? null;
  const deliveredTo = args.receiptPersonName?.trim() || existing?.delivered_to || null;

  if (existing) {
    await args.tx.firstVisitDocument.update({
      where: { id: existing.id },
      data: {
        emergency_contacts: emergencyContacts,
        document_url: documentUrl,
        delivered_at: deliveredAt,
        delivered_to: deliveredTo,
      },
    });
    return;
  }

  await args.tx.firstVisitDocument.create({
    data: {
      org_id: args.orgId,
      patient_id: args.patientId,
      case_id: args.caseId,
      emergency_contacts: emergencyContacts,
      document_url: documentUrl,
      delivered_at: deliveredAt,
      delivered_to: deliveredTo,
    },
  });
}

function getNextVisitSuggestionDate(args: {
  explicitSuggestion: string | undefined;
  recurrenceRule: string | null;
  visitRecordedAt: Date;
  medicationEndDate: Date | null;
  visitDeadlineDate: Date | null;
}) {
  if (args.explicitSuggestion) {
    return new Date(args.explicitSuggestion);
  }

  if (!args.recurrenceRule) {
    return null;
  }

  const cutoffCandidates = [args.medicationEndDate, args.visitDeadlineDate].filter(
    (value): value is Date => value instanceof Date
  );
  const cutoff =
    cutoffCandidates.length > 0
      ? new Date(Math.min(...cutoffCandidates.map((value) => value.getTime())))
      : addDays(args.visitRecordedAt, 90);

  return getNextSimpleRruleOccurrence(args.recurrenceRule, args.visitRecordedAt, cutoff);
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const patientId = searchParams.get('patient_id') ?? undefined;
  const pharmacistId = searchParams.get('pharmacist_id') ?? undefined;
  const dateFrom = searchParams.get('date_from') ?? undefined;
  const dateTo = searchParams.get('date_to') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(patientId ? { patient_id: patientId } : {}),
    ...(pharmacistId ? { pharmacist_id: pharmacistId } : {}),
    ...(dateFrom || dateTo
      ? {
          visit_date: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59') } : {}),
          },
        }
      : {}),
  };

  const records = await prisma.visitRecord.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { visit_date: 'desc' },
    select: {
      id: true,
      schedule_id: true,
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
      version: true,
      created_at: true,
      updated_at: true,
      schedule: {
        select: {
          visit_type: true,
          scheduled_date: true,
        },
      },
    },
  });

  const hasMore = records.length > limit;
  const data = hasMore ? records.slice(0, limit) : records;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
}, {
  permission: 'canVisit',
  message: '訪問記録の閲覧権限がありません',
});

async function saveVisitRecord(
  req: AuthenticatedRequest,
  input: CreateVisitRecordInput
) {
  const {
    schedule_id,
    patient_id,
    visit_date,
    outcome_status,
    next_visit_suggestion_date,
    structured_soap,
    visit_geo_log,
    receipt_at,
    residual_medications,
    conflict_resolution,
    existing_record_id,
    expected_version,
    ...rest
  } = input;
  const visitRecordedAt = new Date(visit_date);
  const scheduleStatus = scheduleStatusByOutcome[outcome_status];
  const shouldAdvanceVisitWorkflow = cycleCompletionOutcomes.has(outcome_status);
  const reductionCandidates = collectResidualReductionCandidates(residual_medications);

  const soapTextOverrides: Partial<ReturnType<typeof buildAllSoapTexts>> = structured_soap
    ? buildAllSoapTexts(structured_soap as StructuredSoap)
    : {};
  const soapAssessment =
    typeof soapTextOverrides.soap_assessment === 'string'
      ? soapTextOverrides.soap_assessment
      : (rest.soap_assessment ?? null);
  const soapPlan =
    typeof soapTextOverrides.soap_plan === 'string'
      ? soapTextOverrides.soap_plan
      : (rest.soap_plan ?? null);

  return withOrgContext(req.orgId, async (tx) => {
    const schedule = await tx.visitSchedule.findFirst({
      where: { id: schedule_id, org_id: req.orgId },
      select: {
        id: true,
        case_id: true,
        schedule_status: true,
        recurrence_rule: true,
        cycle_id: true,
        visit_type: true,
        pharmacist_id: true,
        site_id: true,
        time_window_start: true,
        time_window_end: true,
        medication_end_date: true,
        visit_deadline_date: true,
      },
    });
    if (!schedule) {
      return { error: 'schedule_not_found' as const };
    }

    const suggestedNextVisitDate = getNextVisitSuggestionDate({
      explicitSuggestion: next_visit_suggestion_date,
      recurrenceRule: schedule.recurrence_rule,
      visitRecordedAt,
      medicationEndDate: schedule.medication_end_date,
      visitDeadlineDate: schedule.visit_deadline_date,
    });
    const nextVisitSuggestionDateInput = suggestedNextVisitDate
      ? new Date(suggestedNextVisitDate)
      : null;

    const careCase = await tx.careCase.findFirst({
      where: {
        id: schedule.case_id,
        org_id: req.orgId,
      },
      select: {
        patient_id: true,
      },
    });
    if (!careCase) {
      return { error: 'case_not_found' as const };
    }
    if (careCase.patient_id !== patient_id) {
      return { error: 'patient_mismatch' as const };
    }

    const existingRecord = await loadExistingVisitRecordConflict(tx, req.orgId, schedule_id);
    if (existingRecord) {
      const canOverwrite =
        conflict_resolution === 'overwrite' &&
        existing_record_id === existingRecord.id &&
        expected_version === existingRecord.version;

      if (!canOverwrite) {
        return {
          error: 'record_conflict' as const,
          existingRecord,
        };
      }
    }

    const record =
      existingRecord && conflict_resolution === 'overwrite'
        ? await tx.visitRecord.update({
            where: { id: existingRecord.id },
            data: {
              patient_id: careCase.patient_id,
              pharmacist_id: req.userId,
              visit_date: visitRecordedAt,
              next_visit_suggestion_date: nextVisitSuggestionDateInput,
              receipt_at: receipt_at ? new Date(receipt_at) : null,
              ...rest,
              outcome_status,
              ...soapTextOverrides,
              structured_soap: (structured_soap as Prisma.InputJsonValue) ?? undefined,
              visit_geo_log: (visit_geo_log as Prisma.InputJsonValue) ?? undefined,
              version: { increment: 1 },
            } as Prisma.VisitRecordUncheckedUpdateInput,
          })
        : await tx.visitRecord.create({
            data: {
              org_id: req.orgId,
              schedule_id,
              patient_id: careCase.patient_id,
              pharmacist_id: req.userId,
              visit_date: visitRecordedAt,
              next_visit_suggestion_date: nextVisitSuggestionDateInput ?? undefined,
              receipt_at: receipt_at ? new Date(receipt_at) : undefined,
              ...rest,
              outcome_status,
              ...soapTextOverrides,
              structured_soap: (structured_soap as Prisma.InputJsonValue) ?? undefined,
              visit_geo_log: (visit_geo_log as Prisma.InputJsonValue) ?? undefined,
            } as Prisma.VisitRecordUncheckedCreateInput,
          });

    await replaceResidualMedications(tx, req.orgId, record.id, residual_medications);

    // Sync structured lab values to PatientLabObservation
    const labValues = (structured_soap as StructuredSoap | undefined)?.objective?.lab_values;
    if (labValues) {
      await syncLabObservations(tx, req.orgId, careCase.patient_id, record.id, visitRecordedAt, labValues as Record<string, unknown>);
    }

    if (schedule.visit_type === 'initial' && firstVisitDocumentOutcomes.has(outcome_status)) {
      await upsertFirstVisitDocument({
        tx,
        orgId: req.orgId,
        patientId: careCase.patient_id,
        caseId: schedule.case_id,
        recordId: record.id,
        receiptAt: receipt_at || undefined,
        receiptPersonName: rest.receipt_person_name,
      });
    }

    if (reductionCandidates.length > 0) {
      const prohibitedCandidates = reductionCandidates.filter(
        (candidate) => candidate.is_prohibited_reduction
      );
      const allowedCandidates = reductionCandidates.filter(
        (candidate) => !candidate.is_prohibited_reduction
      );

      for (const candidate of allowedCandidates) {
        const existingIssue = await tx.medicationIssue.findFirst({
          where: {
            org_id: req.orgId,
            patient_id: careCase.patient_id,
            case_id: schedule.case_id,
            title: `${candidate.drug_name} の残薬調整`,
            status: {
              in: ['open', 'in_progress'],
            },
          },
          select: { id: true },
        });

        const issue =
          existingIssue ??
          (await tx.medicationIssue.create({
            data: {
              org_id: req.orgId,
              patient_id: careCase.patient_id,
              case_id: schedule.case_id,
              title: `${candidate.drug_name} の残薬調整`,
              description: `${candidate.drug_name} に残薬超過（約${candidate.excess_days}日分）があります。処方医への報告と減数調剤可否の確認が必要です。`,
              status: 'open',
              priority: candidate.excess_days >= 14 ? 'high' : 'medium',
              category: 'adherence',
              identified_by: req.userId,
            },
            select: { id: true },
          }));

        const existingTracingReport = await tx.tracingReport.findFirst({
          where: {
            org_id: req.orgId,
            patient_id: careCase.patient_id,
            issue_id: issue.id,
            status: {
              in: ['draft', 'sent', 'received'],
            },
          },
          select: { id: true },
        });

        const tracingReport =
          existingTracingReport ??
          (await tx.tracingReport.create({
            data: {
              org_id: req.orgId,
              patient_id: careCase.patient_id,
              case_id: schedule.case_id,
              issue_id: issue.id,
              status: 'draft',
              content: {
                category: 'residual_reduction',
                drug_name: candidate.drug_name,
                drug_code: candidate.drug_code ?? null,
                remaining_quantity: candidate.remaining_quantity,
                prescribed_daily_dose: candidate.prescribed_daily_dose,
                excess_days: candidate.excess_days,
                recommendation: '処方医へ残薬調整の可否を照会する',
                source_visit_record_id: record.id,
              } satisfies Prisma.InputJsonValue,
              sent_to_physician: null,
            },
            select: { id: true },
          }));

        const existingTracingRequest = await tx.communicationRequest.findFirst({
          where: {
            org_id: req.orgId,
            related_entity_type: 'tracing_report',
            related_entity_id: tracingReport.id,
          },
          select: { id: true },
        });

        if (!existingTracingRequest) {
          await tx.communicationRequest.create({
            data: {
              org_id: req.orgId,
              patient_id: careCase.patient_id,
              case_id: schedule.case_id,
              request_type: 'tracing_report',
              template_key: 'tracing_report',
              recipient_name: null,
              recipient_role: 'physician',
              related_entity_type: 'tracing_report',
              related_entity_id: tracingReport.id,
              status: 'draft',
              subject: `${candidate.drug_name} の服薬情報提供書`,
              content: `${candidate.drug_name} の残薬調整について処方医へ共有します。`,
              requested_by: req.userId,
              due_date: null,
            },
          });
        }

        await upsertOperationalTask(tx, {
          orgId: req.orgId,
          taskType: 'tracing_report_followup',
          title: `${candidate.drug_name} の残薬調整を確認`,
          description: '残薬調整の処方医報告と tracing report 起票を確認してください。',
          priority: candidate.excess_days >= 14 ? 'high' : 'normal',
          assignedTo: req.userId,
          dueDate: visitRecordedAt,
          slaDueAt: visitRecordedAt,
          relatedEntityType: 'visit_record',
          relatedEntityId: record.id,
          dedupeKey: `tracing-report-followup:${record.id}:${candidate.drug_code ?? candidate.drug_name}`,
          metadata: {
            patient_id: careCase.patient_id,
            case_id: schedule.case_id,
            issue_id: issue.id,
            tracing_report_id: tracingReport.id,
            drug_name: candidate.drug_name,
            excess_days: candidate.excess_days,
          } satisfies Prisma.InputJsonValue,
        });
      }

      if (prohibitedCandidates.length > 0) {
        if (schedule.cycle_id) {
          const description = `減数調剤禁止薬剤が残薬調整候補です: ${prohibitedCandidates
            .map((candidate) => `${candidate.drug_name}（約${candidate.excess_days}日分）`)
            .join(' / ')}`;

          const existingException = await tx.workflowException.findFirst({
            where: {
              org_id: req.orgId,
              cycle_id: schedule.cycle_id,
              exception_type: 'reduction_prohibited_drug',
              status: 'open',
            },
            select: { id: true },
          });

          if (!existingException) {
            await tx.workflowException.create({
              data: {
                org_id: req.orgId,
                cycle_id: schedule.cycle_id,
                exception_type: 'reduction_prohibited_drug',
                description,
                severity: 'critical',
                status: 'open',
              },
            });
          }
        }

        await upsertOperationalTask(tx, {
          orgId: req.orgId,
          taskType: 'residual_reduction_review',
          title: '減数調剤禁止薬の残薬を確認',
          description: prohibitedCandidates
            .map((candidate) => `${candidate.drug_name} は減数調剤禁止です。処方医へ通常報告のみ行ってください。`)
            .join(' / '),
          priority: 'high',
          assignedTo: req.userId,
          dueDate: visitRecordedAt,
          slaDueAt: visitRecordedAt,
          relatedEntityType: 'visit_record',
          relatedEntityId: record.id,
          dedupeKey: `residual-reduction-review:${record.id}`,
          metadata: {
            patient_id: careCase.patient_id,
            case_id: schedule.case_id,
            drugs: prohibitedCandidates.map((candidate) => ({
              drug_name: candidate.drug_name,
              excess_days: candidate.excess_days,
            })),
          } satisfies Prisma.InputJsonValue,
        });
      }
    }

    await tx.visitSchedule.update({
      where: { id: schedule_id },
      data: { schedule_status: scheduleStatus },
    });

    if (shouldAdvanceVisitWorkflow && schedule.cycle_id) {
      const activeVisitConsent = await tx.consentRecord.findFirst({
        where: {
          org_id: req.orgId,
          patient_id: careCase.patient_id,
          consent_type: 'visit_medication_management',
          is_active: true,
          revoked_date: null,
          OR: [{ expiry_date: null }, { expiry_date: { gte: visitRecordedAt } }],
        },
        select: { id: true },
      });

      const cycle = await tx.medicationCycle.findFirst({
        where: { id: schedule.cycle_id, org_id: req.orgId },
        select: { id: true, overall_status: true },
      });

      if (
        cycle &&
        (cycle.overall_status === 'set_audited' || cycle.overall_status === 'visit_ready')
      ) {
        await tx.medicationCycle.update({
          where: { id: cycle.id },
          data: { overall_status: 'visit_completed' },
        });
      }

      if (!activeVisitConsent) {
        const existingException = await tx.workflowException.findFirst({
          where: {
            org_id: req.orgId,
            cycle_id: schedule.cycle_id,
            exception_type: 'missing_visit_consent',
            status: 'open',
          },
          select: { id: true },
        });

        if (!existingException) {
          await tx.workflowException.create({
            data: {
              org_id: req.orgId,
              cycle_id: schedule.cycle_id,
              exception_type: 'missing_visit_consent',
              description:
                '訪問薬剤管理の有効な同意記録がない状態で訪問記録が登録されました',
              severity: 'critical',
              status: 'open',
            },
          });

          await tx.medicationCycle.update({
            where: { id: schedule.cycle_id },
            data: { exception_status: 'missing_visit_consent' },
          });
        }
      }
    }

    let suggestedSchedule = null;
    if (nextVisitSuggestionDateInput) {
      const intervalDays = differenceInCalendarDays(nextVisitSuggestionDateInput, visitRecordedAt);
      suggestedSchedule = {
        suggested_date: nextVisitSuggestionDateInput.toISOString().slice(0, 10),
        auto_generated: !next_visit_suggestion_date,
        interval_days: intervalDays,
        message: '次回訪問日の作成を検討してください',
      };

      await upsertOperationalTask(tx, {
        orgId: req.orgId,
        taskType: 'visit_followup',
        title: '次回訪問候補の調整が必要です',
        description: '訪問記録で次回訪問日の提案が入力されています。',
        priority: outcome_status === 'revisit_needed' ? 'urgent' : 'high',
        assignedTo: req.userId,
        dueDate: nextVisitSuggestionDateInput,
        slaDueAt: nextVisitSuggestionDateInput,
        relatedEntityType: 'visit_record',
        relatedEntityId: record.id,
        dedupeKey: `visit-followup:${record.id}`,
        metadata: {
          patient_id: careCase.patient_id,
          case_id: schedule.case_id,
          schedule_id,
          auto_generated: !next_visit_suggestion_date,
          source_visit_type: schedule.visit_type,
        } as Prisma.InputJsonValue,
      });
    }

    await upsertOperationalTask(tx, {
      orgId: req.orgId,
      taskType: 'care_report_followup',
      title: '訪問後報告の送付確認が必要です',
      description: '医師・ケアマネ向け報告書の送付状況を確認してください。',
      priority: 'high',
      assignedTo: req.userId,
      dueDate: visitRecordedAt,
      slaDueAt: visitRecordedAt,
      relatedEntityType: 'visit_record',
      relatedEntityId: record.id,
      dedupeKey: `care-report-followup:${record.id}`,
      metadata: {
        patient_id: careCase.patient_id,
        case_id: schedule.case_id,
      } as Prisma.InputJsonValue,
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: req.orgId,
      visitRecordId: record.id,
    });

    let handoffExtraction: VisitRecordHandoffExtractionPayload | null = null;
    if (structured_soap) {
      const patient = await tx.patient.findFirst({
        where: {
          id: careCase.patient_id,
          org_id: req.orgId,
        },
        select: {
          name: true,
        },
      });

      if (patient) {
        handoffExtraction = {
          patientId: careCase.patient_id,
          patientName: patient.name,
          structuredSoap: structured_soap as StructuredSoap,
          soapAssessment,
          soapPlan,
        };
      }
    }

    return {
      record,
      suggestedSchedule,
      conflictResolved: existingRecord != null && conflict_resolution === 'overwrite',
      handoffExtraction,
    };
  });
}

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createVisitRecordSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const result = await saveVisitRecord(req, parsed.data);

  if ('error' in result) {
    if (result.error === 'schedule_not_found') {
      return validationError('指定されたスケジュールが見つかりません');
    }
    if (result.error === 'case_not_found') {
      return validationError('訪問予定に紐づくケースが見つかりません');
    }
    if (result.error === 'patient_mismatch') {
      return validationError('訪問予定に紐づく患者と記録対象患者が一致しません');
    }
    if (result.error === 'record_conflict') {
      return conflict('この訪問予定には既に記録があります。サーバー版との差分を確認してください。', {
        existing_record: result.existingRecord,
      });
    }
    return validationError('指定されたスケジュールが見つかりません');
  }

  const requestContext = getRequestAuthContext();
  if (result.handoffExtraction) {
    void processHandoffExtraction(prisma, {
      orgId: req.orgId,
      visitRecordId: result.record.id,
      patientId: result.handoffExtraction.patientId,
      patientName: result.handoffExtraction.patientName,
      structuredSoap: result.handoffExtraction.structuredSoap,
      soapAssessment: result.handoffExtraction.soapAssessment,
      soapPlan: result.handoffExtraction.soapPlan,
      requestContext,
    }).catch((cause) => {
      console.warn('[visit-records] handoff extraction failed', cause);
    });
  }

  const responsePayload = {
    record: result.record,
    suggestedSchedule: result.suggestedSchedule,
    conflictResolved: result.conflictResolved,
  };
  return success(responsePayload, result.conflictResolved ? 200 : 201);
}, {
  permission: 'canVisit',
  message: '訪問記録の作成権限がありません',
});
