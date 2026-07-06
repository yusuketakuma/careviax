import type { MemberRole, Prisma, PrismaClient } from '@prisma/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { buildPatientHref } from '@/lib/patient/navigation';
import {
  RISK_DOMAIN_LABELS,
  RISK_DOMAIN_ORDER,
  RISK_SEVERITY_RANK,
  statusFromRiskFindings,
  summarizeRiskFindings,
} from '@/lib/risk/risk-finding';
import { activeCaseRiskFindingProviderRegistry } from '@/server/risk/active-case-risk-registry';
import type {
  BillingEvidenceRow,
  CareReportRow,
  ConsentRow,
  DispenseTaskRow,
  FirstVisitDocumentRow,
  ManagementPlanRow,
  NotificationRiskRow,
  PatientMcsLinkRiskRow,
  PatientShareCaseRiskRow,
  PrescriptionLineRiskRow,
  ResidenceRiskRow,
  TaskRow,
  VisitScheduleRow,
} from '@/server/risk/case-risk-provider-types';
import type {
  CaseRiskCockpitResponse,
  CaseRiskCockpitSection,
  CaseRiskFinding,
  CaseRiskNextAction,
} from '@/types/case-risk-cockpit';

type FindFirstDelegate<T> = {
  findFirst(args: unknown): Promise<T | null>;
};

type FindManyDelegate<T> = {
  findMany(args: unknown): Promise<T[]>;
};

type CaseRiskCockpitDbReader = {
  careCase: FindFirstDelegate<CaseRiskCaseRow>;
  consentRecord: FindFirstDelegate<ConsentRow>;
  firstVisitDocument: FindFirstDelegate<FirstVisitDocumentRow>;
  managementPlan: FindFirstDelegate<ManagementPlanRow>;
  visitSchedule: FindManyDelegate<VisitScheduleRow>;
  careReport: FindManyDelegate<CareReportRow>;
  dispenseTask: FindManyDelegate<DispenseTaskRow>;
  prescriptionLine: FindManyDelegate<PrescriptionLineRiskRow>;
  notification: FindManyDelegate<NotificationRiskRow>;
  residence: FindManyDelegate<ResidenceRiskRow>;
  patientMcsLink: FindManyDelegate<PatientMcsLinkRiskRow>;
  patientShareCase: FindManyDelegate<PatientShareCaseRiskRow>;
  task: FindManyDelegate<TaskRow>;
  billingEvidence: FindManyDelegate<BillingEvidenceRow>;
};

export type CaseRiskCockpitDb = PrismaClient | Prisma.TransactionClient | CaseRiskCockpitDbReader;

type CaseRiskCaseRow = {
  id: string;
  display_id: string | null;
  status: string;
  patient_id: string;
  primary_pharmacist_id: string | null;
  primary_staff_id: string | null;
  patient: {
    id: string;
    display_id: string | null;
    name: string;
  };
};

type GetCaseRiskCockpitArgs = {
  orgId: string;
  caseId: string;
  userId: string;
  role: MemberRole;
  now?: Date;
};

const CASE_RISK_NEXT_ACTION_LIMIT = 12;

function priorityFromSeverity(
  severity: CaseRiskFinding['severity'],
): CaseRiskNextAction['priority'] {
  if (severity === 'blocking' || severity === 'urgent') return 'urgent';
  if (severity === 'warning') return 'high';
  return 'normal';
}

function buildSections(findings: CaseRiskFinding[]): CaseRiskCockpitSection[] {
  const byDomain = new Map<CaseRiskFinding['domain'], CaseRiskFinding[]>();
  for (const finding of findings) {
    const bucket = byDomain.get(finding.domain) ?? [];
    bucket.push(finding);
    byDomain.set(finding.domain, bucket);
  }

  return RISK_DOMAIN_ORDER.map((domain) => {
    const sectionFindings = (byDomain.get(domain) ?? []).sort(
      (left, right) =>
        RISK_SEVERITY_RANK[left.severity] - RISK_SEVERITY_RANK[right.severity] ||
        left.key.localeCompare(right.key),
    );
    return {
      domain,
      label: RISK_DOMAIN_LABELS[domain],
      status: statusFromRiskFindings(sectionFindings),
      findings: sectionFindings,
    };
  });
}

function buildNextActions(findings: readonly CaseRiskFinding[]): CaseRiskNextAction[] {
  return findings
    .filter((finding) => finding.resolution_state === 'open' && finding.severity !== 'info')
    .sort((left, right) => {
      const severityDiff = RISK_SEVERITY_RANK[left.severity] - RISK_SEVERITY_RANK[right.severity];
      if (severityDiff !== 0) return severityDiff;
      return (
        (left.due_at ?? '').localeCompare(right.due_at ?? '') || left.key.localeCompare(right.key)
      );
    })
    .slice(0, CASE_RISK_NEXT_ACTION_LIMIT)
    .map((finding) => ({
      task_id: finding.related_entity_type === 'task' ? finding.related_entity_id : null,
      label: finding.action_label,
      priority: priorityFromSeverity(finding.severity),
      due_at: finding.due_at ?? null,
      action_href: finding.action_href,
    }));
}

export async function getCaseRiskCockpit(
  db: CaseRiskCockpitDb,
  args: GetCaseRiskCockpitArgs,
): Promise<CaseRiskCockpitResponse | null> {
  const now = args.now ?? new Date();
  const assignmentWhere = buildCareCaseAssignmentWhere({
    userId: args.userId,
    role: args.role,
  });

  const careCase = (await db.careCase.findFirst({
    where: {
      id: args.caseId,
      org_id: args.orgId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    select: {
      id: true,
      display_id: true,
      status: true,
      patient_id: true,
      primary_pharmacist_id: true,
      primary_staff_id: true,
      patient: {
        select: {
          id: true,
          display_id: true,
          name: true,
        },
      },
    },
  })) as CaseRiskCaseRow | null;
  if (!careCase) return null;

  const patientHref = buildPatientHref(careCase.patient.id);

  const [
    consent,
    managementPlan,
    firstVisitDocument,
    schedules,
    reports,
    dispenseTasks,
    prescriptionLines,
    notifications,
    residences,
    patientMcsLinks,
    patientShareCases,
    tasks,
  ] = await Promise.all([
    db.consentRecord.findFirst({
      where: {
        org_id: args.orgId,
        patient_id: careCase.patient_id,
        consent_type: 'visit_medication_management',
        is_active: true,
        revoked_date: null,
        OR: [{ expiry_date: null }, { expiry_date: { gte: now } }],
      },
      orderBy: [{ obtained_date: 'desc' }],
      select: {
        id: true,
        expiry_date: true,
      },
    }),
    db.managementPlan.findFirst({
      where: {
        org_id: args.orgId,
        case_id: careCase.id,
        status: 'approved',
        approved_at: { not: null },
        OR: [{ effective_from: null }, { effective_from: { lte: now } }],
      },
      orderBy: [{ effective_from: 'desc' }, { version: 'desc' }, { approved_at: 'desc' }],
      select: {
        id: true,
        next_review_date: true,
      },
    }),
    db.firstVisitDocument.findFirst({
      where: {
        org_id: args.orgId,
        patient_id: careCase.patient_id,
        case_id: careCase.id,
      },
      orderBy: [{ created_at: 'desc' }],
      select: {
        id: true,
        delivered_at: true,
      },
    }),
    db.visitSchedule.findMany({
      where: {
        org_id: args.orgId,
        case_id: careCase.id,
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
      },
      orderBy: [{ scheduled_date: 'asc' }, { updated_at: 'desc' }],
      take: 5,
      select: {
        id: true,
        display_id: true,
        schedule_status: true,
        scheduled_date: true,
        carry_items_status: true,
        preparation: {
          select: {
            id: true,
            medication_changes_reviewed: true,
            carry_items_confirmed: true,
            previous_issues_reviewed: true,
            route_confirmed: true,
            offline_synced: true,
          },
        },
        visit_record: {
          select: {
            id: true,
          },
        },
      },
    }),
    db.careReport.findMany({
      where: {
        org_id: args.orgId,
        patient_id: careCase.patient_id,
        case_id: careCase.id,
        status: { in: ['failed', 'response_waiting'] },
      },
      orderBy: [{ updated_at: 'desc' }],
      take: 5,
      select: {
        id: true,
        display_id: true,
        status: true,
        updated_at: true,
      },
    }),
    db.dispenseTask.findMany({
      where: {
        org_id: args.orgId,
        status: { in: ['pending', 'in_progress'] },
        cycle: {
          org_id: args.orgId,
          case_id: careCase.id,
          patient_id: careCase.patient_id,
        },
      },
      orderBy: [{ priority: 'asc' }, { due_date: 'asc' }, { updated_at: 'desc' }],
      take: 5,
      select: {
        id: true,
        priority: true,
        status: true,
        assigned_to: true,
        due_date: true,
      },
    }),
    db.prescriptionLine.findMany({
      where: {
        org_id: args.orgId,
        intake: {
          cycle: {
            org_id: args.orgId,
            case_id: careCase.id,
            patient_id: careCase.patient_id,
          },
        },
        OR: [
          { drug_master_id: null },
          {
            AND: [
              { drug_resolution_status: { not: null } },
              { drug_resolution_status: { not: 'resolved' } },
            ],
          },
        ],
      },
      orderBy: [{ updated_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        drug_master_id: true,
        drug_resolution_status: true,
      },
    }),
    db.notification.findMany({
      where: {
        org_id: args.orgId,
        user_id: args.userId,
        is_read: false,
        type: 'urgent',
        OR: [{ link: patientHref }, { link: { startsWith: `${patientHref}/` } }],
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        id: true,
        type: true,
        event_type: true,
        link: true,
        created_at: true,
      },
    }),
    db.residence.findMany({
      where: {
        org_id: args.orgId,
        patient_id: careCase.patient_id,
        is_primary: true,
      },
      orderBy: [{ updated_at: 'desc' }],
      take: 2,
      select: {
        id: true,
        lat: true,
        lng: true,
        geocode_status: true,
        geocode_accuracy: true,
        updated_at: true,
      },
    }),
    db.patientMcsLink.findMany({
      where: {
        org_id: args.orgId,
        patient_id: careCase.patient_id,
        AND: [{ last_sync_status: { not: null } }, { last_sync_status: { not: 'success' } }],
      },
      orderBy: [{ last_sync_attempt_at: 'desc' }, { updated_at: 'desc' }],
      take: 1,
      select: {
        id: true,
        last_sync_status: true,
        last_sync_attempt_at: true,
        last_synced_at: true,
        updated_at: true,
      },
    }),
    db.patientShareCase.findMany({
      where: {
        org_id: args.orgId,
        base_patient_id: careCase.patient_id,
        status: 'active',
        OR: [{ base_case_id: careCase.id }, { base_case_id: null }],
      },
      orderBy: [{ updated_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        status: true,
        share_scope: true,
        ends_at: true,
        updated_at: true,
        consents: {
          orderBy: [{ created_at: 'desc' }],
          take: 3,
          select: {
            id: true,
            consent_date: true,
            valid_until: true,
            revoked_at: true,
          },
        },
      },
    }),
    db.task.findMany({
      where: {
        org_id: args.orgId,
        status: { in: ['pending', 'in_progress'] },
        OR: [
          { related_entity_type: 'case', related_entity_id: careCase.id },
          { related_entity_type: 'patient', related_entity_id: careCase.patient_id },
        ],
      },
      orderBy: [{ priority: 'asc' }, { sla_due_at: 'asc' }, { due_date: 'asc' }],
      take: 8,
      select: {
        id: true,
        task_type: true,
        title: true,
        priority: true,
        status: true,
        assigned_to: true,
        due_date: true,
        sla_due_at: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    }),
  ]);

  const scopedConsent = consent as ConsentRow | null;
  const scopedManagementPlan = managementPlan as ManagementPlanRow | null;
  const scopedFirstVisitDocument = firstVisitDocument as FirstVisitDocumentRow | null;
  const selectedSchedules = schedules as VisitScheduleRow[];
  const selectedReports = reports as CareReportRow[];
  const selectedDispenseTasks = dispenseTasks as DispenseTaskRow[];
  const selectedPrescriptionLines = prescriptionLines as PrescriptionLineRiskRow[];
  const selectedNotifications = notifications as NotificationRiskRow[];
  const selectedResidences = residences as ResidenceRiskRow[];
  const selectedPatientMcsLinks = patientMcsLinks as PatientMcsLinkRiskRow[];
  const selectedPatientShareCases = patientShareCases as PatientShareCaseRiskRow[];
  const selectedTasks = tasks as TaskRow[];

  const visitRecordIds = selectedSchedules
    .map((schedule) => schedule.visit_record?.id)
    .filter((id): id is string => Boolean(id));

  const billingEvidence =
    visitRecordIds.length === 0
      ? []
      : ((await db.billingEvidence.findMany({
          where: {
            org_id: args.orgId,
            claimable: false,
            OR: [{ patient_id: null }, { patient_id: careCase.patient_id }],
            visit_record_id: { in: visitRecordIds },
          },
          orderBy: [{ billing_month: 'desc' }, { updated_at: 'desc' }],
          take: 4,
          select: {
            id: true,
            patient_id: true,
            visit_record_id: true,
            claimable: true,
            exclusion_reason: true,
            same_month_exclusion_flags: true,
            validation_notes: true,
          },
        })) as BillingEvidenceRow[]);

  const scopedSchedules = selectedSchedules.filter((schedule) => schedule.id);
  const scopedReports = selectedReports.filter(
    (report) => report.status === 'failed' || report.status === 'response_waiting',
  );
  const scopedTasks = selectedTasks.filter(
    (task) =>
      (task.related_entity_type === 'case' && task.related_entity_id === careCase.id) ||
      (task.related_entity_type === 'patient' && task.related_entity_id === careCase.patient_id),
  );
  const scopedVisitRecordIds = new Set(visitRecordIds);

  const findings = activeCaseRiskFindingProviderRegistry.collectAll({
    patientHref,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    now,
    consent: scopedConsent,
    managementPlan: scopedManagementPlan,
    firstVisitDocument: scopedFirstVisitDocument,
    schedules: scopedSchedules,
    reports: scopedReports,
    dispenseTasks: selectedDispenseTasks,
    prescriptionLines: selectedPrescriptionLines,
    notifications: selectedNotifications,
    residences: selectedResidences,
    patientMcsLinks: selectedPatientMcsLinks,
    patientShareCases: selectedPatientShareCases,
    tasks: scopedTasks,
    visitRecordIds: scopedVisitRecordIds,
    billingEvidence,
  });

  const sections = buildSections(findings);
  const overall = summarizeRiskFindings(findings);

  return {
    generated_at: now.toISOString(),
    patient: {
      id: careCase.patient.id,
      display_id: careCase.patient.display_id,
      name: careCase.patient.name,
    },
    case: {
      id: careCase.id,
      display_id: careCase.display_id,
      status: careCase.status,
    },
    overall,
    sections,
    next_actions: buildNextActions(findings),
  };
}
