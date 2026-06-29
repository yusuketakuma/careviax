// ─── Report Generator ────────────────────────────────────────────────────────
// 訪問記録から医師向け報告書・ケアマネ向け情報提供書を自動生成する
// 保険種別 (BillingEvidence.payer_basis) によって生成対象を自動判定する

import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import {
  readJsonObject,
  readJsonObjectNumber,
  readJsonObjectString,
  toPrismaJsonInput,
} from '@/lib/db/json';
import type { StructuredSoap } from '@/types/structured-soap';
import {
  buildPhysicianReport,
  buildCareManagerReport,
  buildVisitingNurseReport,
  buildFacilityReport,
} from './report-templates';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import type { VisitWorkflowConferenceContext } from '@/lib/visits/visit-workflow-projection';
import { buildReportableConferenceHighlightsFromStructuredContent } from '@/lib/conferences/conference-report-disclosure';
import {
  canAccessCareReportSource,
  type CareReportAccessContext,
} from '@/server/services/care-report-access';

// CareReport.report_type は Prisma enum ReportType に対応する。
// 訪問看護向け = nurse_share / 施設向け = facility_handoff（schema 既存値を再利用）。
type ReportType = 'physician_report' | 'care_manager_report' | 'nurse_share' | 'facility_handoff';
type ExistingCareReport = {
  id: string;
  report_type: ReportType;
  status: string;
  updated_at: Date;
};
type GenerateReportsFromVisitOptions = {
  expectedVisitRecordUpdatedAt?: Date | null;
  expectedReportUpdatedAt?: Date | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readConferenceHighlights(
  noteType: VisitWorkflowConferenceContext['note_type'],
  structuredContent: unknown,
): string[] {
  const reportableHighlights = buildReportableConferenceHighlightsFromStructuredContent({
    noteType,
    structuredContent,
  });
  if (reportableHighlights.length > 0) return reportableHighlights;
  if (!isRecord(structuredContent)) return [];
  return [
    ...readTextArray(structuredContent.key_decisions),
    ...readTextArray(structuredContent.medication_issues),
    ...readTextArray(structuredContent.care_plan_changes),
  ].slice(0, 6);
}

function readConferenceActionItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!isRecord(item)) return null;
      if (typeof item.title === 'string') return item.title;
      if (typeof item.description === 'string') return item.description;
      if (typeof item.content === 'string') return item.content;
      return null;
    })
    .filter((item): item is string => Boolean(item?.trim()));
}

function readGeneratedReportContent(value: unknown): Record<string, unknown> {
  return readJsonObject(value) ?? {};
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isReportableAdherenceScore(
  value: unknown,
): value is StructuredSoap['objective']['adherence_score'] {
  return Number.isInteger(value) && [1, 2, 3, 4, 5].includes(value as number);
}

function readReportableStructuredSoap(value: unknown): StructuredSoap | null {
  if (!isRecord(value)) return null;

  const subjective = value.subjective;
  const objective = value.objective;
  const assessment = value.assessment;
  const plan = value.plan;
  if (!isRecord(subjective) || !isRecord(objective) || !isRecord(assessment) || !isRecord(plan)) {
    return null;
  }

  const adverseEvents = objective.adverse_events;
  const hasReportableMedicationAssessment =
    typeof objective.medication_status === 'string' &&
    objective.medication_status.trim().length > 0 &&
    isReportableAdherenceScore(objective.adherence_score) &&
    isStringArray(objective.side_effect_checks) &&
    isRecord(adverseEvents) &&
    typeof adverseEvents.has_events === 'boolean' &&
    isStringArray(adverseEvents.events);
  if (!hasReportableMedicationAssessment) return null;

  if (!isStringArray(assessment.problem_checks)) return null;
  if (!isStringArray(plan.intervention_checks)) return null;

  return value as StructuredSoap;
}

function toIsoStringOrNull(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

export async function generateReportsFromVisit(
  orgId: string,
  userId: string,
  visitRecordId: string,
  reportType?: ReportType,
  accessContext?: CareReportAccessContext,
  options: GenerateReportsFromVisitOptions = {},
): Promise<{
  reports: Array<{ id: string; report_type: string; status: string; updated_at: Date }>;
}> {
  // ─── 1. VisitRecord 取得 ────────────────────────────────────────────────────
  const visitRecord = await prisma.visitRecord.findFirst({
    where: { id: visitRecordId, org_id: orgId },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      pharmacist_id: true,
      visit_date: true,
      structured_soap: true,
      schedule_id: true,
      version: true,
      updated_at: true,
    },
  });

  if (!visitRecord) {
    throw new Error(`VisitRecord not found: ${visitRecordId}`);
  }
  const expectedVisitRecordUpdatedAt = options.expectedVisitRecordUpdatedAt ?? null;
  if (
    expectedVisitRecordUpdatedAt &&
    visitRecord.updated_at.getTime() !== expectedVisitRecordUpdatedAt.getTime()
  ) {
    throw new Error('VISIT_RECORD_STALE_FOR_REPORT_GENERATION');
  }

  // ─── 2. Schedule → Case 取得 ───────────────────────────────────────────────
  const schedule = await prisma.visitSchedule.findUnique({
    where: { id: visitRecord.schedule_id },
    select: { case_id: true, cycle_id: true, org_id: true },
  });

  // required_visit_support は schedule 確定後に取得（case_id が必要）

  // org_id を二重確認（RLS は withOrgContext 内のみ有効なため）
  if (schedule && schedule.org_id !== orgId) {
    throw new Error(`VisitSchedule not found for schedule_id: ${visitRecord.schedule_id}`);
  }

  if (!schedule) {
    throw new Error(`VisitSchedule not found for schedule_id: ${visitRecord.schedule_id}`);
  }

  const caseId = schedule.case_id;
  if (!schedule.cycle_id) {
    throw new Error('VISIT_SCHEDULE_CYCLE_REQUIRED_FOR_REPORT');
  }
  if (!visitRecord.structured_soap) {
    throw new Error('STRUCTURED_SOAP_REQUIRED_FOR_REPORT');
  }
  const structuredSoap = readReportableStructuredSoap(visitRecord.structured_soap);
  if (!structuredSoap) {
    throw new Error('REPORTABLE_STRUCTURED_SOAP_REQUIRED_FOR_REPORT');
  }
  if (
    accessContext &&
    !(await canAccessCareReportSource(prisma, orgId, accessContext, {
      patientId: visitRecord.patient_id,
      caseId,
      visitRecordId,
    }))
  ) {
    throw new Error(`VisitRecord not accessible: ${visitRecordId}`);
  }
  const conferenceNoteClient = (
    prisma as unknown as {
      conferenceNote?: {
        findMany?: (args: Record<string, unknown>) => Promise<
          Array<{
            id: string;
            note_type: string;
            title: string;
            conference_date: Date;
            structured_content: unknown;
            metadata: unknown;
            action_items: unknown;
          }>
        >;
      };
    }
  ).conferenceNote;

  // ─── 3-7. 独立クエリを並列実行 ────────────────────────────────────────────
  const [
    patient,
    medicationCycle,
    residualMedications,
    careTeamLinks,
    pharmacistUser,
    billingEvidence,
    careCase,
    recentConferenceNotes,
  ] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: visitRecord.patient_id, org_id: orgId },
      select: { id: true, name: true, birth_date: true, gender: true },
    }),
    prisma.medicationCycle.findFirst({
      where: { id: schedule.cycle_id, org_id: orgId },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    }),
    prisma.residualMedication.findMany({
      where: { org_id: orgId, visit_record_id: visitRecordId },
      select: {
        drug_name: true,
        remaining_quantity: true,
        excess_days: true,
        is_reduction_target: true,
      },
    }),
    prisma.careTeamLink.findMany({
      where: { case_id: caseId, org_id: orgId, role: { in: ['physician', 'care_manager'] } },
      select: { role: true, name: true, organization_name: true },
      orderBy: { is_primary: 'desc' },
    }),
    prisma.user.findFirst({
      where: { id: visitRecord.pharmacist_id },
      select: { name: true },
    }),
    prisma.billingEvidence.findFirst({
      where: { visit_record_id: visitRecordId, org_id: orgId },
      select: {
        id: true,
        cycle_id: true,
        patient_id: true,
        claimable: true,
        exclusion_reason: true,
        report_delivery_ref: true,
        updated_at: true,
        payer_basis: true,
        applied_rule_keys: true,
        recommended_rule_keys: true,
        validation_notes: true,
        calculation_context: true,
      },
      orderBy: { created_at: 'desc' },
    }),
    prisma.careCase.findFirst({
      where: { id: caseId, org_id: orgId },
      select: { required_visit_support: true },
    }),
    conferenceNoteClient?.findMany
      ? conferenceNoteClient.findMany({
          where: {
            org_id: orgId,
            OR: [{ patient_id: visitRecord.patient_id }, { case_id: caseId }],
            note_type: { in: ['pre_discharge', 'service_manager'] },
          },
          orderBy: [{ conference_date: 'desc' }],
          take: 4,
          select: {
            id: true,
            note_type: true,
            title: true,
            conference_date: true,
            structured_content: true,
            metadata: true,
            action_items: true,
          },
        })
      : Promise.resolve([]),
  ]);

  if (!patient) {
    throw new Error(`Patient not found: ${visitRecord.patient_id}`);
  }
  if (!medicationCycle) {
    throw new Error('MEDICATION_CYCLE_NOT_FOUND_FOR_REPORT');
  }

  // intake コンテキスト（required_visit_support.home_visit_intake）
  const intake = getHomeVisitIntake(careCase?.required_visit_support) ?? undefined;

  // ─── PrescriptionLines（medicationCycle に依存） ───────────────────────────
  const prescriptionLines = await prisma.prescriptionLine.findMany({
    where: { org_id: orgId, intake: { cycle_id: medicationCycle.id } },
    select: {
      id: true,
      intake_id: true,
      drug_name: true,
      drug_code: true,
      dose: true,
      frequency: true,
      days: true,
      dosage_form: true,
      quantity: true,
      unit: true,
      route: true,
      dispensing_method: true,
      packaging_instructions: true,
      packaging_instruction_tags: true,
      notes: true,
      intake: {
        select: {
          prescribed_date: true,
        },
      },
    },
    orderBy: [{ intake: { prescribed_date: 'desc' } }, { line_number: 'asc' }],
  });

  const prescriptionLinesNormalized = prescriptionLines.map((l) => ({
    drug_name: l.drug_name,
    dose: l.dose,
    frequency: l.frequency,
    days_supply: l.days,
    dosage_form: l.dosage_form,
    route: l.route,
    dispensing_method: l.dispensing_method,
    packaging_instructions: l.packaging_instructions,
    packaging_instruction_tags: l.packaging_instruction_tags,
    notes: l.notes,
    unit: l.unit,
  }));

  const residualMedicationsNormalized = residualMedications.map((r) => ({
    drug_name: r.drug_name,
    remaining_quantity: r.remaining_quantity,
    excess_days: r.excess_days ?? 0,
    is_reduction_target: r.is_reduction_target,
  }));

  // 依頼元が医師の場合、intake.requester をケアチームの主治医として優先使用
  const careTeamPhysician = careTeamLinks.find((l) => l.role === 'physician');
  const prescriberFromIntake =
    intake?.requester?.profession === 'physician' && intake.requester.contact_name
      ? {
          name: intake.requester.contact_name,
          organization_name: intake.requester.organization_name ?? null,
        }
      : null;
  const prescriber = careTeamPhysician ??
    prescriberFromIntake ?? { name: '主治医', organization_name: null };

  // intake.care_manager があればケアチームの未登録情報を補完
  const careTeamCareManager = careTeamLinks.find((l) => l.role === 'care_manager');
  const careManagerFromIntake = intake?.care_manager?.name
    ? {
        name: intake.care_manager.name,
        organization_name: intake.care_manager.organization_name ?? null,
      }
    : null;
  const careManager = careTeamCareManager ??
    careManagerFromIntake ?? { name: 'ケアマネジャー', organization_name: null };
  const pharmacistName = pharmacistUser?.name ?? '担当薬剤師';
  const conferenceContext: VisitWorkflowConferenceContext[] = recentConferenceNotes.map((note) => ({
    id: note.id,
    note_type: note.note_type as VisitWorkflowConferenceContext['note_type'],
    title: note.title,
    conference_date: note.conference_date.toISOString(),
    highlights: readConferenceHighlights(
      note.note_type as VisitWorkflowConferenceContext['note_type'],
      note.structured_content,
    ),
    action_items: readConferenceActionItems(note.action_items),
  }));

  // ─── 保険種別で報告書タイプを判定 ──────────────────────────────────────────
  let typesToGenerate: ReportType[];

  if (reportType) {
    typesToGenerate = [reportType];
  } else {
    const payerBasis = billingEvidence?.payer_basis ?? 'medical';
    typesToGenerate = ['physician_report'];
    if (payerBasis === 'care') {
      typesToGenerate.push('care_manager_report');
    }
  }

  const existingReports = await prisma.careReport.findMany({
    where: {
      org_id: orgId,
      visit_record_id: visitRecordId,
      report_type: { in: typesToGenerate },
    },
    select: { id: true, report_type: true, status: true, updated_at: true },
  });
  const existingByType = new Map<ReportType, ExistingCareReport>();
  for (const report of existingReports) {
    existingByType.set(report.report_type as ReportType, {
      ...report,
      report_type: report.report_type as ReportType,
    });
  }
  const missingTypes = typesToGenerate.filter((type) => !existingByType.has(type));

  const billingContext = billingEvidence
    ? {
        billing_evidence_id: billingEvidence.id,
        payer_basis: billingEvidence.payer_basis,
        claimable: billingEvidence.claimable,
        exclusion_reason: billingEvidence.exclusion_reason,
        report_delivery_ref: billingEvidence.report_delivery_ref,
        applied_rule_keys: billingEvidence.applied_rule_keys ?? [],
        recommended_rule_keys: billingEvidence.recommended_rule_keys ?? [],
        validation_notes: billingEvidence.validation_notes ?? null,
        updated_at: toIsoStringOrNull(billingEvidence.updated_at),
        effective_revision_code: readJsonObjectString(
          billingEvidence.calculation_context,
          'effective_revision_code',
        ),
        site_config_status: readJsonObjectString(
          billingEvidence.calculation_context,
          'site_config_status',
        ),
        site_config_revision_code: readJsonObjectString(
          billingEvidence.calculation_context,
          'site_config_revision_code',
        ),
        jahis_supplemental_record_count: readJsonObjectNumber(
          billingEvidence.calculation_context,
          'jahis_supplemental_record_count',
        ),
        jahis_residual_confirmation_count: readJsonObjectNumber(
          billingEvidence.calculation_context,
          'jahis_residual_confirmation_count',
        ),
      }
    : null;
  const sourceProvenance = {
    schema_version: 1,
    visit_record_id: visitRecord.id,
    visit_record_version: visitRecord.version ?? null,
    visit_record_updated_at: toIsoStringOrNull(visitRecord.updated_at),
    schedule_id: visitRecord.schedule_id,
    patient_id: visitRecord.patient_id,
    case_id: caseId,
    medication_cycle_id: medicationCycle?.id ?? null,
    prescription_intake_ids: Array.from(new Set(prescriptionLines.map((line) => line.intake_id))),
    prescription_line_ids: prescriptionLines.map((line) => line.id),
    prescription_lines: prescriptionLines.map((line) => ({
      prescription_line_id: line.id,
      prescription_intake_id: line.intake_id,
      prescribed_date: line.intake.prescribed_date.toISOString(),
      drug_code: line.drug_code,
      drug_name: line.drug_name,
      quantity: line.quantity,
      unit: line.unit,
    })),
    billing_evidence_id: billingEvidence?.id ?? null,
    billing_evidence_updated_at: toIsoStringOrNull(billingEvidence?.updated_at),
    patient_insurance_basis: billingEvidence
      ? {
          payer_basis: billingEvidence.payer_basis,
          patient_id: billingEvidence.patient_id,
          cycle_id: billingEvidence.cycle_id,
          claimable: billingEvidence.claimable,
          exclusion_reason: billingEvidence.exclusion_reason,
        }
      : null,
    generated_at: new Date().toISOString(),
  };

  // ─── 10. 各 type でテンプレート呼び出し → CareReport 作成 ─────────────────
  const visitRecordInput = { visited_at: visitRecord.visit_date };
  const patientInput = {
    name: patient.name,
    birth_date: patient.birth_date,
    gender: patient.gender,
  };

  // Build content for each report type
  const contentByType = new Map<ReportType, Record<string, unknown>>();
  for (const type of typesToGenerate) {
    if (type === 'physician_report') {
      contentByType.set(type, {
        ...readGeneratedReportContent(
          buildPhysicianReport({
            patient: patientInput,
            visitRecord: visitRecordInput,
            structuredSoap,
            prescriptionLines: prescriptionLinesNormalized,
            residualMedications: residualMedicationsNormalized,
            prescriber: { name: prescriber.name, organization_name: prescriber.organization_name },
            pharmacistName,
            intake,
            conferenceContext,
          }),
        ),
        billing_context: billingContext,
        source_provenance: sourceProvenance,
      });
    } else if (type === 'care_manager_report') {
      contentByType.set(type, {
        ...readGeneratedReportContent(
          buildCareManagerReport({
            patient: { name: patient.name, birth_date: patient.birth_date },
            visitRecord: visitRecordInput,
            structuredSoap,
            prescriptionLines: prescriptionLinesNormalized,
            residualMedications: residualMedicationsNormalized,
            careManager: {
              name: careManager.name,
              organization_name: careManager.organization_name,
            },
            pharmacistName,
            intake,
            conferenceContext,
          }),
        ),
        billing_context: billingContext,
        source_provenance: sourceProvenance,
      });
    } else {
      // 訪問看護向け / 施設向け: design 準拠の決定論的 5見出し射影（LLM 不使用）
      const audienceContext = {
        patient: { name: patient.name, birth_date: patient.birth_date },
        visitRecord: visitRecordInput,
        structuredSoap,
        prescriptionLines: prescriptionLinesNormalized,
        residualMedications: residualMedicationsNormalized,
        pharmacistName,
        intake,
        conferenceContext,
      };
      const audienceContent =
        type === 'nurse_share'
          ? buildVisitingNurseReport(audienceContext)
          : buildFacilityReport(audienceContext);
      contentByType.set(type, {
        ...readGeneratedReportContent(audienceContent),
        billing_context: billingContext,
        source_provenance: sourceProvenance,
      });
    }
  }

  const draftReportsToRefresh = typesToGenerate
    .map((type) => existingByType.get(type))
    .filter(
      (report): report is ExistingCareReport =>
        report?.status === 'draft' &&
        contentByType.has(report.report_type) &&
        options.expectedReportUpdatedAt != null,
    );
  const existingDraftsRequiringVersion = typesToGenerate
    .map((type) => existingByType.get(type))
    .filter(
      (report): report is ExistingCareReport =>
        report?.status === 'draft' && contentByType.has(report.report_type),
    );
  if (existingDraftsRequiringVersion.length > 0 && options.expectedReportUpdatedAt == null) {
    throw new Error('CARE_REPORT_DRAFT_VERSION_REQUIRED_FOR_REPORT_GENERATION');
  }
  if (draftReportsToRefresh.length > 0 && options.expectedReportUpdatedAt) {
    for (const report of draftReportsToRefresh) {
      if (report.updated_at.getTime() !== options.expectedReportUpdatedAt.getTime()) {
        throw new Error('CARE_REPORT_DRAFT_STALE_FOR_REPORT_GENERATION');
      }
    }
  }

  const persistedReports =
    missingTypes.length === 0 && draftReportsToRefresh.length === 0
      ? existingReports
      : await withOrgContext(orgId, async (tx) => {
          if (expectedVisitRecordUpdatedAt) {
            const currentVisitRecord = await tx.visitRecord.findFirst({
              where: {
                id: visitRecordId,
                org_id: orgId,
                updated_at: expectedVisitRecordUpdatedAt,
              },
              select: { id: true },
            });
            if (!currentVisitRecord) {
              throw new Error('VISIT_RECORD_STALE_FOR_REPORT_GENERATION');
            }
          }

          const refreshedDraftResults = await Promise.all(
            draftReportsToRefresh.map((report) =>
              tx.careReport.updateMany({
                where: {
                  id: report.id,
                  org_id: orgId,
                  status: 'draft',
                  updated_at: options.expectedReportUpdatedAt ?? undefined,
                },
                data: { content: toPrismaJsonInput(contentByType.get(report.report_type)) },
              }),
            ),
          );
          if (refreshedDraftResults.some((result) => result.count !== 1)) {
            throw new Error('CARE_REPORT_DRAFT_STALE_FOR_REPORT_GENERATION');
          }

          if (missingTypes.length > 0) {
            await tx.careReport.createMany({
              data: missingTypes.map((type) => ({
                org_id: orgId,
                patient_id: visitRecord.patient_id,
                case_id: caseId,
                visit_record_id: visitRecordId,
                report_type: type,
                status: 'draft',
                content: toPrismaJsonInput(contentByType.get(type)),
                created_by: userId,
              })),
              skipDuplicates: true,
            });
          }

          return tx.careReport.findMany({
            where: {
              org_id: orgId,
              visit_record_id: visitRecordId,
              report_type: { in: typesToGenerate },
            },
            select: { id: true, report_type: true, status: true, updated_at: true },
          });
        });

  const persistedByType = new Map<ReportType, ExistingCareReport>();
  for (const report of persistedReports) {
    persistedByType.set(report.report_type as ReportType, {
      ...report,
      report_type: report.report_type as ReportType,
    });
  }
  const reports = typesToGenerate
    .map((type) => persistedByType.get(type) ?? existingByType.get(type))
    .filter((report): report is ExistingCareReport => report != null);

  return {
    reports: reports.map((report) => ({
      id: report.id,
      report_type: report.report_type,
      status: report.status,
      updated_at: report.updated_at,
    })),
  };
}
