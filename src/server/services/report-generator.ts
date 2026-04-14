// ─── Report Generator ────────────────────────────────────────────────────────
// 訪問記録から医師向け報告書・ケアマネ向け情報提供書を自動生成する
// 保険種別 (BillingEvidence.payer_basis) によって生成対象を自動判定する

import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import type { StructuredSoap } from '@/types/structured-soap';
import { buildPhysicianReport, buildCareManagerReport } from './report-templates';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';

type ReportType = 'physician_report' | 'care_manager_report';

export async function generateReportsFromVisit(
  orgId: string,
  userId: string,
  visitRecordId: string,
  reportType?: ReportType,
): Promise<{ reports: Array<{ id: string; report_type: string }> }> {
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
    },
  });

  if (!visitRecord) {
    throw new Error(`VisitRecord not found: ${visitRecordId}`);
  }

  // ─── 2. Schedule → Case 取得 ───────────────────────────────────────────────
  const schedule = await prisma.visitSchedule.findUnique({
    where: { id: visitRecord.schedule_id },
    select: { case_id: true, org_id: true },
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

  // ─── 3-7. 独立クエリを並列実行 ────────────────────────────────────────────
  const [
    patient,
    medicationCycle,
    residualMedications,
    careTeamLinks,
    pharmacistUser,
    billingEvidence,
    careCase,
  ] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: visitRecord.patient_id, org_id: orgId },
      select: { id: true, name: true, birth_date: true, gender: true },
    }),
    prisma.medicationCycle.findFirst({
      where: { case_id: caseId, org_id: orgId },
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
  ]);

  if (!patient) {
    throw new Error(`Patient not found: ${visitRecord.patient_id}`);
  }

  // intake コンテキスト（required_visit_support.home_visit_intake）
  const intake = getHomeVisitIntake(careCase?.required_visit_support) ?? undefined;

  // ─── PrescriptionLines（medicationCycle に依存） ───────────────────────────
  const prescriptionLines =
    medicationCycle != null
      ? await prisma.prescriptionLine.findMany({
          where: { org_id: orgId, intake: { cycle_id: medicationCycle.id } },
          select: {
            drug_name: true,
            dose: true,
            frequency: true,
            days: true,
            route: true,
            dispensing_method: true,
          },
          orderBy: [{ intake: { prescribed_date: 'desc' } }, { line_number: 'asc' }],
        })
      : [];

  const prescriptionLinesNormalized = prescriptionLines.map((l) => ({
    drug_name: l.drug_name,
    dose: l.dose,
    frequency: l.frequency,
    days_supply: l.days,
    route: l.route,
    dispensing_method: l.dispensing_method,
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
    select: { id: true, report_type: true },
  });
  const existingByType = new Map(
    existingReports.map((report) => [report.report_type as ReportType, report]),
  );
  const missingTypes = typesToGenerate.filter((type) => !existingByType.has(type));

  // ─── 9. structured_soap を型アサート ──────────────────────────────────────
  // DB の Json フィールドから StructuredSoap を取得する。
  // 未入力の場合はデフォルト値でフォールバック。
  const structuredSoap = (visitRecord.structured_soap as StructuredSoap | null) ?? {
    subjective: { symptom_checks: [] },
    objective: {
      medication_status: 'full_compliance',
      adherence_score: 3 as const,
      side_effect_checks: [],
    },
    assessment: { problem_checks: [] },
    plan: { intervention_checks: [] },
  };

  const calculationContext = billingEvidence?.calculation_context as Record<string, unknown> | null;
  const billingContext = billingEvidence
    ? {
        payer_basis: billingEvidence.payer_basis,
        applied_rule_keys: billingEvidence.applied_rule_keys ?? [],
        recommended_rule_keys: billingEvidence.recommended_rule_keys ?? [],
        validation_notes: billingEvidence.validation_notes ?? null,
        effective_revision_code:
          typeof calculationContext?.effective_revision_code === 'string'
            ? calculationContext.effective_revision_code
            : null,
        site_config_status:
          typeof calculationContext?.site_config_status === 'string'
            ? calculationContext.site_config_status
            : null,
        site_config_revision_code:
          typeof calculationContext?.site_config_revision_code === 'string'
            ? calculationContext.site_config_revision_code
            : null,
      }
    : null;

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
        ...(buildPhysicianReport({
          patient: patientInput,
          visitRecord: visitRecordInput,
          structuredSoap,
          prescriptionLines: prescriptionLinesNormalized,
          residualMedications: residualMedicationsNormalized,
          prescriber: { name: prescriber.name, organization_name: prescriber.organization_name },
          pharmacistName,
          intake,
        }) as unknown as Record<string, unknown>),
        billing_context: billingContext,
      });
    } else {
      contentByType.set(type, {
        ...(buildCareManagerReport({
          patient: { name: patient.name, birth_date: patient.birth_date },
          visitRecord: visitRecordInput,
          structuredSoap,
          prescriptionLines: prescriptionLinesNormalized,
          residualMedications: residualMedicationsNormalized,
          careManager: { name: careManager.name, organization_name: careManager.organization_name },
          pharmacistName,
          intake,
        }) as unknown as Record<string, unknown>),
        billing_context: billingContext,
      });
    }
  }

  // Create all reports in a single transaction
  const createdReports =
    missingTypes.length === 0
      ? []
      : await withOrgContext(orgId, async (tx) => {
          return Promise.all(
            missingTypes.map((type) =>
              tx.careReport.create({
                data: {
                  org_id: orgId,
                  patient_id: visitRecord.patient_id,
                  case_id: caseId,
                  visit_record_id: visitRecordId,
                  report_type: type,
                  status: 'draft',
                  content: contentByType.get(
                    type,
                  ) as import('@prisma/client').Prisma.InputJsonValue,
                  created_by: userId,
                },
                select: { id: true, report_type: true },
              }),
            ),
          );
        });

  const reports = typesToGenerate
    .map(
      (type) =>
        existingByType.get(type) ?? createdReports.find((report) => report.report_type === type),
    )
    .filter((report): report is { id: string; report_type: ReportType } => report != null);

  return { reports: reports.map((report) => ({ id: report.id, report_type: report.report_type })) };
}
