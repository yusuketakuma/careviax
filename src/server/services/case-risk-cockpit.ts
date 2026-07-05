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
import { describeBillingEvidenceBlockers } from '@/server/services/billing-evidence/core';
import {
  adaptBillingEvidenceBlockerToRiskFinding,
  adaptCareReportToRiskFinding,
  adaptConsentPlanLifecycleToRiskFindings,
  adaptDispenseTaskToRiskFinding,
  adaptNotificationToRiskFinding,
  adaptOperationalTaskToRiskFinding,
  adaptPatientMcsIntegrationToRiskFinding,
  adaptPatientSharePrivacyToRiskFindings,
  adaptPrescriptionLineReconciliationToRiskFinding,
  adaptResidenceGeocodeToRiskFinding,
  adaptUpcomingVisitPreparationToRiskFindings,
} from '@/server/services/risk-finding-registry';
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

type ConsentRow = {
  id: string;
  expiry_date: Date | null;
};

type ManagementPlanRow = {
  id: string;
  next_review_date: Date | null;
};

type FirstVisitDocumentRow = {
  id: string;
  delivered_at: Date | null;
};

type VisitScheduleRow = {
  id: string;
  display_id: string | null;
  schedule_status: string;
  scheduled_date: Date;
  carry_items_status: string | null;
  preparation: {
    id: string;
    medication_changes_reviewed: boolean;
    carry_items_confirmed: boolean;
    previous_issues_reviewed: boolean;
    route_confirmed: boolean;
    offline_synced: boolean;
  } | null;
  visit_record: {
    id: string;
  } | null;
};

type CareReportRow = {
  id: string;
  display_id: string | null;
  status: string;
  updated_at: Date;
};

type DispenseTaskRow = {
  id: string;
  priority: string | null;
  status: string;
  assigned_to: string | null;
  due_date: Date | null;
};

type PrescriptionLineRiskRow = {
  id: string;
  drug_master_id: string | null;
  drug_resolution_status: string | null;
};

type NotificationRiskRow = {
  id: string;
  type: string;
  event_type: string | null;
  link: string | null;
  created_at: Date;
};

type ResidenceRiskRow = {
  id: string;
  lat: number | null;
  lng: number | null;
  geocode_status: string | null;
  geocode_accuracy: string | null;
  updated_at: Date;
};

type PatientMcsLinkRiskRow = {
  id: string;
  last_sync_status: string | null;
  last_sync_attempt_at: Date | null;
  last_synced_at: Date | null;
  updated_at: Date;
};

type PatientShareCaseRiskRow = {
  id: string;
  status: string;
  share_scope: Prisma.JsonValue | null;
  ends_at: Date | null;
  updated_at: Date;
  consents: Array<{
    id: string;
    consent_date: Date;
    valid_until: Date | null;
    revoked_at: Date | null;
  }>;
};

type TaskRow = {
  id: string;
  task_type: string;
  title: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  status: string;
  assigned_to: string | null;
  due_date: Date | null;
  sla_due_at: Date | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
};

type BillingEvidenceRow = {
  id: string;
  patient_id: string | null;
  visit_record_id: string | null;
  claimable: boolean;
  exclusion_reason: string | null;
  same_month_exclusion_flags: Prisma.JsonValue | null;
  validation_notes: Prisma.JsonValue | null;
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

function pushConsentPlanFindings(args: {
  findings: CaseRiskFinding[];
  patientHref: string;
  patientId: string;
  caseId: string;
  consent: ConsentRow | null;
  managementPlan: ManagementPlanRow | null;
  firstVisitDocument: FirstVisitDocumentRow | null;
  now: Date;
}) {
  args.findings.push(
    ...adaptConsentPlanLifecycleToRiskFindings(
      {
        consent: args.consent,
        managementPlan: args.managementPlan,
        firstVisitDocument: args.firstVisitDocument,
        now: args.now,
      },
      {
        patientId: args.patientId,
        caseId: args.caseId,
        patientHref: args.patientHref,
      },
    ),
  );
}

function pushVisitFindings(args: {
  findings: CaseRiskFinding[];
  patientHref: string;
  patientId: string;
  caseId: string;
  schedules: VisitScheduleRow[];
}) {
  const schedule = args.schedules[0] ?? null;
  args.findings.push(
    ...adaptUpcomingVisitPreparationToRiskFindings(schedule, {
      patientId: args.patientId,
      caseId: args.caseId,
      patientHref: args.patientHref,
    }),
  );
}

function pushReportFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  reports: CareReportRow[];
}) {
  for (const report of args.reports) {
    const finding = adaptCareReportToRiskFinding(report, {
      patientId: args.patientId,
      caseId: args.caseId,
    });
    if (finding) args.findings.push(finding);
  }
}

function pushDispensingFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  dispenseTasks: DispenseTaskRow[];
  now: Date;
}) {
  for (const task of args.dispenseTasks) {
    args.findings.push(
      adaptDispenseTaskToRiskFinding(task, {
        patientId: args.patientId,
        caseId: args.caseId,
        now: args.now,
      }),
    );
  }
}

function pushMedicationFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  prescriptionLines: PrescriptionLineRiskRow[];
}) {
  for (const line of args.prescriptionLines) {
    args.findings.push(
      adaptPrescriptionLineReconciliationToRiskFinding(line, {
        patientId: args.patientId,
        caseId: args.caseId,
      }),
    );
  }
}

function pushNotificationFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  notifications: NotificationRiskRow[];
}) {
  for (const notification of args.notifications) {
    args.findings.push(
      adaptNotificationToRiskFinding(notification, {
        patientId: args.patientId,
        caseId: args.caseId,
      }),
    );
  }
}

function pushDataQualityFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  residences: ResidenceRiskRow[];
}) {
  for (const residence of args.residences) {
    const finding = adaptResidenceGeocodeToRiskFinding(residence, {
      patientId: args.patientId,
      caseId: args.caseId,
    });
    if (finding) args.findings.push(finding);
  }
}

function pushIntegrationFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  patientMcsLinks: PatientMcsLinkRiskRow[];
}) {
  for (const link of args.patientMcsLinks) {
    const finding = adaptPatientMcsIntegrationToRiskFinding(link, {
      patientId: args.patientId,
      caseId: args.caseId,
    });
    if (finding) args.findings.push(finding);
  }
}

function pushPrivacySecurityFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  patientShareCases: PatientShareCaseRiskRow[];
  now: Date;
}) {
  for (const shareCase of args.patientShareCases) {
    args.findings.push(
      ...adaptPatientSharePrivacyToRiskFindings(shareCase, {
        patientId: args.patientId,
        caseId: args.caseId,
        now: args.now,
      }),
    );
  }
}

function pushTaskFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  tasks: TaskRow[];
  now: Date;
}) {
  for (const task of args.tasks) {
    args.findings.push(
      adaptOperationalTaskToRiskFinding(task, {
        patientId: args.patientId,
        caseId: args.caseId,
        now: args.now,
      }),
    );
  }
}

function pushBillingFindings(args: {
  findings: CaseRiskFinding[];
  patientId: string;
  caseId: string;
  visitRecordIds: Set<string>;
  billingEvidence: BillingEvidenceRow[];
}) {
  for (const evidence of args.billingEvidence) {
    if (!evidence.visit_record_id || !args.visitRecordIds.has(evidence.visit_record_id)) continue;
    if (evidence.patient_id && evidence.patient_id !== args.patientId) continue;

    const blockers = describeBillingEvidenceBlockers({
      claimable: evidence.claimable,
      exclusionReason: evidence.exclusion_reason,
      sameMonthExclusionFlags: evidence.same_month_exclusion_flags,
      patientId: args.patientId,
      visitRecordId: evidence.visit_record_id,
    });

    for (const blocker of blockers) {
      args.findings.push(
        adaptBillingEvidenceBlockerToRiskFinding(blocker, {
          patientId: args.patientId,
          caseId: args.caseId,
          visitRecordId: evidence.visit_record_id,
          billingEvidenceId: evidence.id,
        }),
      );
    }
  }
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

  const findings: CaseRiskFinding[] = [];
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

  pushConsentPlanFindings({
    findings,
    patientHref,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    consent: scopedConsent,
    managementPlan: scopedManagementPlan,
    firstVisitDocument: scopedFirstVisitDocument,
    now,
  });
  pushVisitFindings({
    findings,
    patientHref,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    schedules: scopedSchedules,
  });
  pushReportFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    reports: scopedReports,
  });
  pushDispensingFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    dispenseTasks: selectedDispenseTasks,
    now,
  });
  pushMedicationFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    prescriptionLines: selectedPrescriptionLines,
  });
  pushNotificationFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    notifications: selectedNotifications,
  });
  pushDataQualityFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    residences: selectedResidences,
  });
  pushIntegrationFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    patientMcsLinks: selectedPatientMcsLinks,
  });
  pushPrivacySecurityFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    patientShareCases: selectedPatientShareCases,
    now,
  });
  pushTaskFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
    tasks: scopedTasks,
    now,
  });
  pushBillingFindings({
    findings,
    patientId: careCase.patient_id,
    caseId: careCase.id,
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
