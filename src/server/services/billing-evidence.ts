import type { Prisma } from '@prisma/client';
import { findActiveVisitConsent, findCurrentManagementPlan } from './management-plans';
import { upsertOperationalTask, resolveOperationalTasks } from './operational-tasks';
import {
  buildBillingCandidateSpecs,
  ensureHomeCareBillingSsot,
} from './home-care-billing-ssot';

type Tx = Prisma.TransactionClient;

type BillingCandidateWorkflowState = {
  review_state: 'pending' | 'reviewed';
  resolution_state: 'unresolved' | 'confirmed' | 'excluded';
  reviewed_at: string | null;
  reviewed_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  note: string | null;
};

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function endOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfWeek(value: Date) {
  const date = new Date(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfWeek(value: Date) {
  const date = new Date(value);
  date.setDate(date.getDate() + 6);
  date.setHours(23, 59, 59, 999);
  return date;
}

function isClaimableOutcome(outcome: string) {
  return ['completed', 'completed_with_issue', 'revisit_needed'].includes(outcome);
}

function getPayerBasis(args: {
  medicalInsuranceNumber?: string | null;
  careInsuranceNumber?: string | null;
}) {
  if (args.careInsuranceNumber) return 'care' as const;
  if (args.medicalInsuranceNumber) return 'medical' as const;
  return 'self_pay' as const;
}

function buildBillingTaskKey(visitRecordId: string) {
  return `billing-evidence:${visitRecordId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBillingCandidateWorkflowState(
  sourceSnapshot: Prisma.JsonValue | null | undefined
): BillingCandidateWorkflowState {
  const workflow = isRecord(sourceSnapshot) && isRecord(sourceSnapshot.billing_close)
    ? sourceSnapshot.billing_close
    : {};

  return {
    review_state:
      workflow.review_state === 'reviewed' ? 'reviewed' : 'pending',
    resolution_state:
      workflow.resolution_state === 'confirmed' || workflow.resolution_state === 'excluded'
        ? workflow.resolution_state
        : 'unresolved',
    reviewed_at: typeof workflow.reviewed_at === 'string' ? workflow.reviewed_at : null,
    reviewed_by: typeof workflow.reviewed_by === 'string' ? workflow.reviewed_by : null,
    closed_at: typeof workflow.closed_at === 'string' ? workflow.closed_at : null,
    closed_by: typeof workflow.closed_by === 'string' ? workflow.closed_by : null,
    note: typeof workflow.note === 'string' ? workflow.note : null,
  };
}

function writeBillingCandidateWorkflowState(
  sourceSnapshot: Prisma.JsonValue | null | undefined,
  workflow: Partial<BillingCandidateWorkflowState>
): Prisma.InputJsonValue {
  const current = isRecord(sourceSnapshot) ? sourceSnapshot : {};
  const nextWorkflow = {
    ...readBillingCandidateWorkflowState(sourceSnapshot),
    ...workflow,
  };

  return {
    ...current,
    billing_close: nextWorkflow,
  } as Prisma.InputJsonValue;
}

async function resolveBuildingPatientCount(tx: Tx, args: { orgId: string; patientId: string }) {
  const primaryResidence = await tx.residence.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      is_primary: true,
    },
    select: {
      building_id: true,
    },
  });

  if (!primaryResidence?.building_id) return 1;

  return tx.residence.count({
    where: {
      org_id: args.orgId,
      building_id: primaryResidence.building_id,
      is_primary: true,
    },
  });
}

function monthLabel(value: Date) {
  return value.toISOString().slice(0, 7);
}

export async function upsertBillingEvidenceForVisit(
  tx: Tx,
  args: { orgId: string; visitRecordId: string }
) {
  const visitRecord = await tx.visitRecord.findFirst({
    where: {
      id: args.visitRecordId,
      org_id: args.orgId,
    },
    include: {
      schedule: {
        select: {
          cycle_id: true,
          case_id: true,
          pharmacist_id: true,
        },
      },
    },
  });

  if (!visitRecord || !visitRecord.schedule) {
    throw new Error('VISIT_RECORD_NOT_FOUND');
  }

  const patient = await tx.patient.findFirst({
    where: {
      id: visitRecord.patient_id,
      org_id: args.orgId,
    },
    select: {
      id: true,
      medical_insurance_number: true,
      care_insurance_number: true,
    },
  });
  if (!patient) {
    throw new Error('PATIENT_NOT_FOUND');
  }

  const billingMonth = startOfMonth(visitRecord.visit_date);
  const weekStart = startOfWeek(visitRecord.visit_date);
  const weekEnd = endOfWeek(weekStart);
  const [consent, plan, monthlyVisitCount, weeklyVisitCount, buildingPatientCount, reports, deliveryRecords] =
    await Promise.all([
    findActiveVisitConsent(tx, {
      orgId: args.orgId,
      patientId: visitRecord.patient_id,
      asOf: visitRecord.visit_date,
    }),
    findCurrentManagementPlan(tx, {
      orgId: args.orgId,
      caseId: visitRecord.schedule.case_id,
      asOf: visitRecord.visit_date,
    }),
    tx.visitRecord.count({
      where: {
        org_id: args.orgId,
        patient_id: visitRecord.patient_id,
        visit_date: {
          gte: billingMonth,
          lte: endOfMonth(visitRecord.visit_date),
        },
        outcome_status: {
          in: ['completed', 'completed_with_issue', 'revisit_needed', 'delivery_only'],
        },
      },
    }),
    tx.visitRecord.count({
      where: {
        org_id: args.orgId,
        schedule: {
          pharmacist_id: visitRecord.schedule.pharmacist_id,
        },
        visit_date: {
          gte: weekStart,
          lte: weekEnd,
        },
        outcome_status: {
          in: ['completed', 'completed_with_issue', 'revisit_needed', 'delivery_only'],
        },
      },
    }),
    resolveBuildingPatientCount(tx, {
      orgId: args.orgId,
      patientId: visitRecord.patient_id,
    }),
    tx.careReport.findMany({
      where: {
        org_id: args.orgId,
        visit_record_id: visitRecord.id,
      },
      select: {
        id: true,
        status: true,
      },
    }),
    tx.deliveryRecord.findMany({
      where: {
        org_id: args.orgId,
        report: {
          visit_record_id: visitRecord.id,
        },
      },
      select: {
        id: true,
        status: true,
      },
    }),
  ]);

  const payerBasis = getPayerBasis({
    medicalInsuranceNumber: patient.medical_insurance_number,
    careInsuranceNumber: patient.care_insurance_number,
  });
  const allReportsDelivered =
    reports.length > 0 &&
    reports.every((report) => ['sent', 'confirmed'].includes(report.status)) &&
    deliveryRecords.every((delivery) => ['sent', 'confirmed'].includes(delivery.status));

  const exclusionFlags = {
    missing_visit_consent: !consent,
    missing_management_plan: !plan.current,
    management_plan_review_overdue: plan.reviewOverdue,
    report_delivery_incomplete: !allReportsDelivered,
    outcome_not_claimable: !isClaimableOutcome(visitRecord.outcome_status),
    building_patient_count: buildingPatientCount,
    monthly_visit_count: monthlyVisitCount,
    weekly_visit_count: weeklyVisitCount,
  };

  const exclusionReason = exclusionFlags.missing_visit_consent
    ? '訪問薬剤管理の有効同意がありません'
    : exclusionFlags.missing_management_plan
      ? '承認済み管理計画書がありません'
      : exclusionFlags.management_plan_review_overdue
        ? '管理計画書の見直し期限を超過しています'
        : exclusionFlags.report_delivery_incomplete
          ? '報告書送付が未完了です'
          : exclusionFlags.outcome_not_claimable
            ? '訪問結果が算定対象外です'
            : null;

  const claimable = exclusionReason == null;

  await ensureHomeCareBillingSsot(tx, args.orgId);

  const billingServiceType =
    payerBasis === 'care' ? 'care_home_management' : 'medical_home_visit';
  const providerScope = payerBasis === 'care' ? 'pharmacy' : 'pharmacy';
  const candidateSpecs = await buildBillingCandidateSpecs(tx, {
    orgId: args.orgId,
    payerBasis,
    serviceType: billingServiceType,
    providerScope,
    buildingPatientCount,
    monthlyVisitCount,
    weeklyVisitCount,
    claimable,
    exclusionReason,
    specialCapEligible: false,
    onlineEligible: false,
    regionAddOnEligible: [],
  });

  const evidence = await tx.billingEvidence.upsert({
    where: {
      org_id_visit_record_id: {
        org_id: args.orgId,
        visit_record_id: visitRecord.id,
      },
    },
    create: {
      org_id: args.orgId,
      visit_record_id: visitRecord.id,
      patient_id: visitRecord.patient_id,
      cycle_id: visitRecord.schedule.cycle_id,
      billing_month: billingMonth,
      payer_basis: payerBasis,
      billing_service_type: billingServiceType,
      provider_scope: providerScope,
      claimable,
      exclusion_reason: exclusionReason,
      consent_ref: consent?.id ?? null,
      management_plan_ref: plan.current?.id ?? null,
      report_delivery_ref:
        deliveryRecords.length > 0 ? deliveryRecords.map((record) => record.id).join(',') : null,
      visit_record_ref: visitRecord.id,
      building_patient_count: buildingPatientCount,
      monthly_count_snapshot: monthlyVisitCount,
      weekly_count_snapshot: weeklyVisitCount,
      applied_rule_keys: candidateSpecs
        .filter((spec) => spec.status === 'confirmed')
        .map((spec) => spec.ssotKey) as Prisma.InputJsonValue,
      recommended_rule_keys: candidateSpecs
        .filter((spec) => spec.status === 'candidate')
        .map((spec) => spec.ssotKey) as Prisma.InputJsonValue,
      calculation_context: {
        billing_service_type: billingServiceType,
        provider_scope: providerScope,
        building_patient_count: buildingPatientCount,
        monthly_visit_count: monthlyVisitCount,
        weekly_visit_count: weeklyVisitCount,
      } as Prisma.InputJsonValue,
      same_month_exclusion_flags: exclusionFlags as Prisma.InputJsonValue,
      validation_notes: claimable
        ? '同意・管理計画書・報告送付を満たしています'
        : exclusionReason,
    },
    update: {
      patient_id: visitRecord.patient_id,
      cycle_id: visitRecord.schedule.cycle_id,
      billing_month: billingMonth,
      payer_basis: payerBasis,
      billing_service_type: billingServiceType,
      provider_scope: providerScope,
      claimable,
      exclusion_reason: exclusionReason,
      consent_ref: consent?.id ?? null,
      management_plan_ref: plan.current?.id ?? null,
      report_delivery_ref:
        deliveryRecords.length > 0 ? deliveryRecords.map((record) => record.id).join(',') : null,
      visit_record_ref: visitRecord.id,
      building_patient_count: buildingPatientCount,
      monthly_count_snapshot: monthlyVisitCount,
      weekly_count_snapshot: weeklyVisitCount,
      applied_rule_keys: candidateSpecs
        .filter((spec) => spec.status === 'confirmed')
        .map((spec) => spec.ssotKey) as Prisma.InputJsonValue,
      recommended_rule_keys: candidateSpecs
        .filter((spec) => spec.status === 'candidate')
        .map((spec) => spec.ssotKey) as Prisma.InputJsonValue,
      calculation_context: {
        billing_service_type: billingServiceType,
        provider_scope: providerScope,
        building_patient_count: buildingPatientCount,
        monthly_visit_count: monthlyVisitCount,
        weekly_visit_count: weeklyVisitCount,
      } as Prisma.InputJsonValue,
      same_month_exclusion_flags: exclusionFlags as Prisma.InputJsonValue,
      validation_notes: claimable
        ? '同意・管理計画書・報告送付を満たしています'
        : exclusionReason,
    },
  });

  const taskKey = buildBillingTaskKey(visitRecord.id);
  if (claimable) {
    await resolveOperationalTasks(tx, {
      orgId: args.orgId,
      dedupeKey: taskKey,
      status: 'completed',
    });
  } else {
    await upsertOperationalTask(tx, {
      orgId: args.orgId,
      taskType: 'billing_evidence_review',
      title: '請求根拠の確認が必要です',
      description: exclusionReason,
      priority: 'high',
      dueDate: visitRecord.visit_date,
      slaDueAt: visitRecord.visit_date,
      relatedEntityType: 'visit_record',
      relatedEntityId: visitRecord.id,
      dedupeKey: taskKey,
      metadata: {
        visit_record_id: visitRecord.id,
        patient_id: visitRecord.patient_id,
        cycle_id: visitRecord.schedule.cycle_id,
      } as Prisma.InputJsonValue,
    });
  }

  return evidence;
}

export async function getBillingCandidateWorkbenchSummary(
  tx: Tx,
  args: { orgId: string; billingMonth: Date }
) {
  const candidates = await tx.billingCandidate.findMany({
    where: {
      org_id: args.orgId,
      billing_month: startOfMonth(args.billingMonth),
    },
    select: {
      status: true,
      source_snapshot: true,
      exclusion_reason: true,
    },
    orderBy: [{ created_at: 'asc' }],
  });

  const summary = {
    total: candidates.length,
    pending_review: 0,
    confirmed: 0,
    excluded: 0,
    exported: 0,
    reviewed: 0,
    ready_to_close: 0,
    blocked_from_close: 0,
    blocker_reasons: [] as Array<{ reason: string; count: number }>,
  };

  const blockerReasons = new Map<string, number>();

  for (const candidate of candidates) {
    const workflow = readBillingCandidateWorkflowState(candidate.source_snapshot);
    if (workflow.review_state === 'reviewed') {
      summary.reviewed += 1;
    }

    switch (candidate.status) {
      case 'confirmed':
        summary.confirmed += 1;
        summary.ready_to_close += 1;
        break;
      case 'excluded':
        summary.excluded += 1;
        break;
      case 'exported':
        summary.exported += 1;
        break;
      default:
        summary.pending_review += 1;
        summary.blocked_from_close += 1;
        if (candidate.exclusion_reason) {
          blockerReasons.set(
            candidate.exclusion_reason,
            (blockerReasons.get(candidate.exclusion_reason) ?? 0) + 1
          );
        }
        break;
    }
  }

  summary.blocker_reasons = Array.from(blockerReasons.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason, 'ja'))
    .slice(0, 5);

  return summary;
}

export async function reviewBillingCandidate(
  tx: Tx,
  args: {
    orgId: string;
    billingCandidateId: string;
    action: 'confirm' | 'exclude' | 'reopen';
    note?: string | null;
    actorId: string;
  }
) {
  const candidate = await tx.billingCandidate.findFirst({
    where: {
      id: args.billingCandidateId,
      org_id: args.orgId,
    },
  });

  if (!candidate) {
    throw new Error('BILLING_CANDIDATE_NOT_FOUND');
  }
  if (candidate.status === 'exported') {
    throw new Error('BILLING_CANDIDATE_CLOSED');
  }

  const reviewedAt = new Date();
  const nextStatus =
    args.action === 'confirm' ? 'confirmed' : args.action === 'exclude' ? 'excluded' : 'candidate';
  const nextWorkflow =
    args.action === 'reopen'
      ? {
          review_state: 'pending' as const,
          resolution_state: 'unresolved' as const,
          reviewed_at: null,
          reviewed_by: null,
          closed_at: null,
          closed_by: null,
          note: args.note ?? null,
        }
      : {
          review_state: 'reviewed' as const,
          resolution_state:
            args.action === 'confirm'
              ? ('confirmed' as const)
              : ('excluded' as const),
          reviewed_at: reviewedAt.toISOString(),
          reviewed_by: args.actorId,
          closed_at: null,
          closed_by: null,
          note: args.note ?? (args.action === 'exclude' ? candidate.exclusion_reason ?? null : null),
        };

  return tx.billingCandidate.update({
    where: { id: candidate.id },
    data: {
      status: nextStatus,
      source_snapshot: writeBillingCandidateWorkflowState(candidate.source_snapshot, nextWorkflow),
    },
  });
}

export async function closeBillingCandidatesForMonth(
  tx: Tx,
  args: {
    orgId: string;
    billingMonth: Date;
    actorId: string;
  }
) {
  const billingMonth = startOfMonth(args.billingMonth);
  const candidates = await tx.billingCandidate.findMany({
    where: {
      org_id: args.orgId,
      billing_month: billingMonth,
    },
    select: {
      id: true,
      status: true,
      source_snapshot: true,
    },
  });

  const pendingReview = candidates.filter((candidate) => candidate.status === 'candidate');
  if (pendingReview.length > 0) {
    return {
      blocked: true,
      summary: await getBillingCandidateWorkbenchSummary(tx, {
        orgId: args.orgId,
        billingMonth,
      }),
      blockingCount: pendingReview.length,
    };
  }

  const closedAt = new Date();
  const exported = await Promise.all(
    candidates
      .filter((candidate) => candidate.status === 'confirmed')
      .map((candidate) =>
        tx.billingCandidate.update({
          where: { id: candidate.id },
          data: {
            status: 'exported',
            source_snapshot: writeBillingCandidateWorkflowState(candidate.source_snapshot, {
              review_state: 'reviewed',
              resolution_state: 'confirmed',
              closed_at: closedAt.toISOString(),
              closed_by: args.actorId,
              reviewed_at: readBillingCandidateWorkflowState(candidate.source_snapshot).reviewed_at,
              reviewed_by: readBillingCandidateWorkflowState(candidate.source_snapshot).reviewed_by,
            }),
          },
        })
      )
  );

  await tx.auditLog.create({
    data: {
      org_id: args.orgId,
      actor_id: args.actorId,
      action: 'billing_candidates_month_closed',
      target_type: 'BillingMonth',
      target_id: monthLabel(billingMonth),
      changes: {
        billing_month: billingMonth.toISOString(),
        exported_count: exported.length,
      },
    },
  });

  return {
    blocked: false,
    exported_count: exported.length,
    summary: await getBillingCandidateWorkbenchSummary(tx, {
      orgId: args.orgId,
      billingMonth,
    }),
  };
}

export async function generateBillingCandidatesForMonth(
  tx: Tx,
  args: { orgId: string; billingMonth: Date }
) {
  await ensureHomeCareBillingSsot(tx, args.orgId);
  const monthStart = startOfMonth(args.billingMonth);
  const evidences = await tx.billingEvidence.findMany({
    where: {
      org_id: args.orgId,
      billing_month: monthStart,
    },
    orderBy: [{ created_at: 'asc' }],
  });

  const created = [];
  const rules = await tx.billingRule.findMany({
    where: {
      org_id: args.orgId,
    },
    select: {
      id: true,
      ssot_key: true,
    },
  });
  const ruleIdByKey = new Map(
    rules
      .filter((rule) => rule.ssot_key)
      .map((rule) => [rule.ssot_key as string, rule.id])
  );
  const existingCandidates = await tx.billingCandidate.findMany({
    where: {
      org_id: args.orgId,
      billing_month: monthStart,
    },
    select: {
      dedupe_key: true,
      source_snapshot: true,
    },
  });
  const existingByKey = new Map(
    existingCandidates
      .filter((candidate) => candidate.dedupe_key)
      .map((candidate) => [candidate.dedupe_key as string, candidate])
  );

  for (const evidence of evidences) {
    if (!evidence.patient_id) continue;

    const specs = await buildBillingCandidateSpecs(tx, {
      orgId: args.orgId,
      payerBasis: evidence.payer_basis,
      serviceType:
        evidence.billing_service_type === 'care_home_management'
          ? 'care_home_management'
          : 'medical_home_visit',
      providerScope:
        evidence.provider_scope === 'hospital_clinic' ? 'hospital_clinic' : 'pharmacy',
      buildingPatientCount: evidence.building_patient_count ?? 1,
      monthlyVisitCount: evidence.monthly_count_snapshot ?? 0,
      weeklyVisitCount: evidence.weekly_count_snapshot ?? 0,
      claimable: evidence.claimable,
      exclusionReason: evidence.exclusion_reason,
      specialCapEligible: false,
      onlineEligible: false,
      regionAddOnEligible: [],
    });

    for (const spec of specs) {
      const dedupeKey = `${monthStart.toISOString().slice(0, 10)}:${evidence.id}:${spec.code}`;
      const existing = existingByKey.get(dedupeKey);
      const existingWorkflow = readBillingCandidateWorkflowState(existing?.source_snapshot);
      const preservedStatus =
        existingWorkflow.closed_at
          ? 'exported'
          : existingWorkflow.resolution_state === 'confirmed'
            ? 'confirmed'
            : existingWorkflow.resolution_state === 'excluded'
              ? 'excluded'
              : spec.status;
      const preservedExclusionReason =
        preservedStatus === 'excluded' && existingWorkflow.note
          ? existingWorkflow.note
          : spec.exclusionReason;

      const candidate = await tx.billingCandidate.upsert({
        where: {
          org_id_dedupe_key: {
            org_id: args.orgId,
            dedupe_key: dedupeKey,
          },
        },
        create: {
          org_id: args.orgId,
          patient_id: evidence.patient_id,
          cycle_id: evidence.cycle_id ?? null,
          evidence_id: evidence.id,
          rule_id: ruleIdByKey.get(spec.ssotKey) ?? null,
          dedupe_key: dedupeKey,
          billing_month: monthStart,
          billing_code: spec.code,
          billing_name: spec.name,
          points: spec.points,
          quantity: 1,
          calculation_breakdown: spec.calculationBreakdown as Prisma.InputJsonValue,
          source_snapshot: writeBillingCandidateWorkflowState(
            spec.sourceSnapshot as Prisma.JsonValue,
            existingWorkflow
          ),
          status: preservedStatus,
          exclusion_reason: preservedExclusionReason,
        },
        update: {
          evidence_id: evidence.id,
          cycle_id: evidence.cycle_id ?? null,
          rule_id: ruleIdByKey.get(spec.ssotKey) ?? null,
          billing_name: spec.name,
          points: spec.points,
          quantity: 1,
          calculation_breakdown: spec.calculationBreakdown as Prisma.InputJsonValue,
          source_snapshot: writeBillingCandidateWorkflowState(
            spec.sourceSnapshot as Prisma.JsonValue,
            existingWorkflow
          ),
          status: preservedStatus,
          exclusion_reason: preservedExclusionReason,
        },
      });

      created.push(candidate);
    }
  }

  return created;
}
