import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { readJsonObjectString } from '@/lib/db/json';
import { success } from '@/lib/api/response';
import { billingMonthForJapanTimestamp } from '@/server/services/billing-evidence';

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '請求根拠統計の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;
  const monthStart = billingMonthForJapanTimestamp(new Date());

  const [
    notClaimable,
    evidenceInsufficient,
    deliveryIncomplete,
    ssotRuleCount,
    confirmedCandidates,
    reviewRequiredCandidates,
    exportedCandidates,
    currentMonthCandidates,
    currentMonthEvidence,
    reviewTasks,
    previsitSchedules,
    undraftedReports,
  ] = await Promise.all([
    prisma.billingEvidence.count({
      where: {
        org_id: ctx.orgId,
        claimable: false,
      },
    }),
    prisma.billingEvidence.count({
      where: {
        org_id: ctx.orgId,
        OR: [{ consent_ref: null }, { management_plan_ref: null }],
      },
    }),
    prisma.billingEvidence.count({
      where: {
        org_id: ctx.orgId,
        report_delivery_ref: null,
      },
    }),
    prisma.billingRule.count({
      where: {
        org_id: ctx.orgId,
        billing_scope: 'home_care_ssot',
        is_active: true,
      },
    }),
    prisma.billingCandidate.count({
      where: {
        org_id: ctx.orgId,
        status: 'confirmed',
      },
    }),
    prisma.billingCandidate.count({
      where: {
        org_id: ctx.orgId,
        status: 'candidate',
      },
    }),
    prisma.billingCandidate.count({
      where: {
        org_id: ctx.orgId,
        status: 'exported',
      },
    }),
    prisma.billingCandidate.count({
      where: {
        org_id: ctx.orgId,
        billing_month: monthStart,
      },
    }),
    prisma.billingEvidence.findMany({
      where: {
        org_id: ctx.orgId,
        billing_month: monthStart,
      },
      select: {
        claimable: true,
        exclusion_reason: true,
        calculation_context: true,
      },
    }),
    prisma.task.count({
      where: {
        org_id: ctx.orgId,
        task_type: 'billing_evidence_review',
        status: {
          in: ['pending', 'in_progress'],
        },
      },
    }),
    prisma.visitSchedule.findMany({
      where: {
        org_id: ctx.orgId,
        scheduled_date: {
          gte: monthStart,
        },
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
      },
      select: {
        case_id: true,
        case_: {
          select: {
            patient_id: true,
          },
        },
      },
      take: 120,
    }),
    prisma.careReport.count({
      where: {
        org_id: ctx.orgId,
        status: {
          in: ['draft', 'failed', 'response_waiting'],
        },
      },
    }),
  ]);

  const patientIds = Array.from(
    new Set(previsitSchedules.map((schedule) => schedule.case_.patient_id)),
  );
  const caseIds = Array.from(new Set(previsitSchedules.map((schedule) => schedule.case_id)));
  const [consents, plans] = await Promise.all([
    patientIds.length === 0
      ? []
      : prisma.consentRecord.findMany({
          where: {
            org_id: ctx.orgId,
            patient_id: { in: patientIds },
            consent_type: 'visit_medication_management',
            is_active: true,
            revoked_date: null,
            OR: [{ expiry_date: null }, { expiry_date: { gte: monthStart } }],
          },
          select: {
            patient_id: true,
          },
        }),
    caseIds.length === 0
      ? []
      : prisma.managementPlan.findMany({
          where: {
            org_id: ctx.orgId,
            case_id: { in: caseIds },
            status: 'approved',
            approved_at: { not: null },
            OR: [{ next_review_date: null }, { next_review_date: { gte: monthStart } }],
          },
          select: {
            case_id: true,
          },
        }),
  ]);
  const consentedPatientIds = new Set(consents.map((item) => item.patient_id));
  const plannedCaseIds = new Set(plans.map((item) => item.case_id));
  const previsitBlockers = previsitSchedules.filter(
    (schedule) =>
      !consentedPatientIds.has(schedule.case_.patient_id) || !plannedCaseIds.has(schedule.case_id),
  ).length;

  const currentMonthClaimableEvidence = currentMonthEvidence.filter(
    (item) => item.claimable,
  ).length;
  const currentMonthUnclaimableEvidence = currentMonthEvidence.filter(
    (item) => !item.claimable,
  ).length;
  const currentMonthRevisionBreakdown = currentMonthEvidence.reduce<Record<string, number>>(
    (acc, item) => {
      const revisionCode =
        readJsonObjectString(item.calculation_context, 'effective_revision_code') ?? 'unknown';
      acc[revisionCode] = (acc[revisionCode] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const currentMonthSiteConfigIssues = currentMonthEvidence.reduce(
    (acc, item) => {
      const siteConfigStatus = readJsonObjectString(item.calculation_context, 'site_config_status');
      if (siteConfigStatus === 'config_missing') acc.missing += 1;
      if (siteConfigStatus === 'revision_mismatch') acc.revision_mismatch += 1;
      return acc;
    },
    { missing: 0, revision_mismatch: 0 },
  );
  const currentMonthCloseReady = await prisma.billingCandidate.count({
    where: {
      org_id: ctx.orgId,
      billing_month: monthStart,
      status: 'confirmed',
    },
  });
  const currentMonthCloseBlocked = await prisma.billingCandidate.count({
    where: {
      org_id: ctx.orgId,
      billing_month: monthStart,
      status: 'candidate',
    },
  });

  return success({
    data: {
      not_claimable: notClaimable,
      evidence_insufficient: evidenceInsufficient,
      delivery_incomplete: deliveryIncomplete,
      ssot_rule_count: ssotRuleCount,
      confirmed_candidates: confirmedCandidates,
      review_required_candidates: reviewRequiredCandidates,
      exported_candidates: exportedCandidates,
      current_month_candidates: currentMonthCandidates,
      current_month_claimable_evidence: currentMonthClaimableEvidence,
      current_month_unclaimable_evidence: currentMonthUnclaimableEvidence,
      current_month_revision_breakdown: currentMonthRevisionBreakdown,
      current_month_site_config_issues: currentMonthSiteConfigIssues,
      current_month_close_ready: currentMonthCloseReady,
      current_month_close_blocked: currentMonthCloseBlocked,
      open_billing_review_tasks: reviewTasks,
      previsit_blockers: previsitBlockers,
      undrafted_reports: undraftedReports,
    },
  });
}
