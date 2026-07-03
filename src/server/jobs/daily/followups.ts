import { addDays } from 'date-fns';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from '../runner';
import {
  buildCommunityFollowupTaskKey,
  buildGeocodeTaskKey,
  buildSelfReportTaskKey,
} from '../daily-helpers';
import { scheduleManagementPlanReviewAlert } from '@/server/services/management-plans';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { buildVisitScheduleContactFollowupTask } from '@/server/services/visit-schedule-communication';

export async function checkManagementPlanReviews() {
  return runJob('management_plan_review_check', async () => {
    const today = new Date();
    const plans = await prisma.managementPlan.findMany({
      where: {
        status: 'approved',
        next_review_date: {
          lte: today,
        },
      },
      include: {
        case_: {
          select: {
            patient_id: true,
            primary_pharmacist_id: true,
          },
        },
      },
    });

    for (const plan of plans) {
      const nextReviewDate = plan.next_review_date;
      if (!nextReviewDate) continue;
      await withOrgContext(plan.org_id, (tx) =>
        scheduleManagementPlanReviewAlert(tx, {
          orgId: plan.org_id,
          planId: plan.id,
          caseId: plan.case_id,
          patientId: plan.case_.patient_id,
          dueDate: nextReviewDate,
          assignedTo: plan.case_.primary_pharmacist_id ?? null,
        }),
      );
    }

    return { processedCount: plans.length };
  });
}

export async function checkCallbackFollowups() {
  return runJob('callback_followup_check', async () => {
    // cross-org: by-design。システム全体 cron のため折り返し期限超過ログを全org横断で走査する。
    // タスク生成は withOrgContext(log.org_id) 内で行い、担当者(proposed_pharmacist_id)も
    // 同一行の proposal から解決するため org 境界を跨がない。
    const dueLogs = await prisma.visitScheduleContactLog.findMany({
      where: {
        callback_due_at: { lte: new Date() },
        outcome: { in: ['attempted', 'unreachable'] },
      },
      include: {
        proposal: {
          select: {
            proposed_pharmacist_id: true,
            case_id: true,
          },
        },
      },
    });

    for (const log of dueLogs) {
      const callbackDueAt = log.callback_due_at;
      if (!callbackDueAt) {
        continue;
      }

      await withOrgContext(log.org_id, (tx) =>
        upsertOperationalTask(
          tx,
          buildVisitScheduleContactFollowupTask({
            orgId: log.org_id,
            proposalId: log.proposal_id,
            caseId: log.case_id,
            patientId: log.patient_id,
            assignedTo: log.proposal.proposed_pharmacist_id,
            dueAt: callbackDueAt,
            description: log.note ?? '折り返し期限を過ぎています。',
          }),
        ),
      );
    }

    return { processedCount: dueLogs.length };
  });
}

export async function checkResidenceGeocodeQuality() {
  return runJob('geocode_quality_check', async () => {
    // cross-org: by-design。システム全体 cron のためジオコード品質不足の住所を全org横断で走査する。
    // タスク生成は withOrgContext(residence.org_id) 内で行い、担当者も同一 org の
    // patient.cases から解決するため org 境界を跨がない。
    const residences = await prisma.residence.findMany({
      where: {
        is_primary: true,
        OR: [{ lat: null }, { lng: null }, { geocode_status: { not: 'verified' } }],
      },
      include: {
        patient: {
          select: {
            id: true,
            cases: {
              where: {
                status: { in: ['assessment', 'active', 'on_hold'] },
              },
              orderBy: { updated_at: 'desc' },
              take: 1,
              select: {
                id: true,
                primary_pharmacist_id: true,
              },
            },
          },
        },
      },
    });

    for (const residence of residences) {
      const careCase = residence.patient.cases[0];
      await withOrgContext(residence.org_id, (tx) =>
        upsertOperationalTask(tx, {
          orgId: residence.org_id,
          taskType: 'geocode_review',
          title: '患者住所の座標補正が必要です',
          description: 'ルート最適化に必要な座標またはジオコード品質が不足しています。',
          priority: 'normal',
          assignedTo: careCase?.primary_pharmacist_id ?? null,
          dueDate: new Date(),
          slaDueAt: new Date(),
          relatedEntityType: 'patient',
          relatedEntityId: residence.patient.id,
          dedupeKey: buildGeocodeTaskKey(residence.patient.id),
          metadata: {
            residence_id: residence.id,
            case_id: careCase?.id ?? null,
          },
        }),
      );
    }

    return { processedCount: residences.length };
  });
}

export async function checkSelfReportFollowups() {
  return runJob('self_report_followup_check', async () => {
    // cross-org: by-design。システム全体 cron のため未対応の自己申告を全org横断で走査する。
    // タスク/通知は withOrgContext(report.org_id) 内で生成し、対象者も report.patient_id
    // (同一 org)の careCase から解決するため org 境界を跨いだ漏洩は無い。
    const reports = await prisma.patientSelfReport.findMany({
      where: {
        status: { in: ['submitted', 'triaged', 'converted_to_task'] },
      },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        subject: true,
        preferred_contact_time: true,
        requested_callback: true,
        created_at: true,
      },
    });

    const patientIds = Array.from(new Set(reports.map((report) => report.patient_id)));
    const patients =
      patientIds.length === 0
        ? []
        : await prisma.patient.findMany({
            where: {
              id: { in: patientIds },
            },
            select: {
              id: true,
              name: true,
              cases: {
                where: {
                  status: { in: ['assessment', 'active', 'on_hold'] },
                },
                orderBy: { updated_at: 'desc' },
                take: 1,
                select: {
                  id: true,
                  primary_pharmacist_id: true,
                },
              },
            },
          });
    const patientMap = new Map(patients.map((patient) => [patient.id, patient]));

    for (const report of reports) {
      const patient = patientMap.get(report.patient_id);
      const careCase = patient?.cases[0];
      const dueAt = report.requested_callback
        ? addDays(new Date(report.created_at), 1)
        : addDays(new Date(report.created_at), 2);

      await withOrgContext(report.org_id, async (tx) => {
        await upsertOperationalTask(tx, {
          orgId: report.org_id,
          taskType: 'patient_self_report_followup',
          title: `${patient?.name ?? '患者'} からの自己申告対応`,
          description: `${report.subject}${report.preferred_contact_time ? ` / 希望時間 ${report.preferred_contact_time}` : ''}`,
          priority: report.requested_callback ? 'urgent' : 'high',
          assignedTo: careCase?.primary_pharmacist_id ?? null,
          dueDate: dueAt,
          slaDueAt: dueAt,
          relatedEntityType: 'patient_self_report',
          relatedEntityId: report.id,
          dedupeKey: buildSelfReportTaskKey(report.id),
          metadata: {
            patient_id: report.patient_id,
            case_id: careCase?.id ?? null,
            patient_name: patient?.name ?? null,
            requested_callback: report.requested_callback,
          },
        });

        if (careCase?.primary_pharmacist_id) {
          await dispatchNotificationEvent(tx, {
            orgId: report.org_id,
            eventType: 'patient_self_report_followup_due',
            type: report.requested_callback ? 'urgent' : 'business',
            title: '患者・家族の自己申告対応が必要です',
            message: `${patient?.name ?? '患者'}さんの自己申告「${report.subject}」への対応が必要です。`,
            link: '/external',
            explicitUserIds: [careCase.primary_pharmacist_id],
            dedupeKey: buildSelfReportTaskKey(report.id),
            metadata: {
              patient_id: report.patient_id,
              report_id: report.id,
            },
          });
        }
      });
    }

    return { processedCount: reports.length };
  });
}

export async function checkCommunityFollowups() {
  return runJob('community_followup_check', async () => {
    const activities = await prisma.communityActivity.findMany({
      where: {
        follow_up_required: true,
      },
      orderBy: [{ activity_date: 'asc' }],
    });

    for (const activity of activities) {
      await withOrgContext(activity.org_id, (tx) =>
        upsertOperationalTask(tx, {
          orgId: activity.org_id,
          taskType: 'community_activity_followup',
          title: `地域活動フォロー: ${activity.title}`,
          description:
            activity.outcome_summary ??
            `${activity.partner_name ?? '地域連携先'} へのフォローが必要です。`,
          priority:
            activity.referrals_generated && activity.referrals_generated > 0 ? 'high' : 'normal',
          assignedTo: activity.created_by,
          dueDate: addDays(new Date(activity.activity_date), 7),
          slaDueAt: addDays(new Date(activity.activity_date), 7),
          relatedEntityType: 'community_activity',
          relatedEntityId: activity.id,
          dedupeKey: buildCommunityFollowupTaskKey(activity.id),
          metadata: {
            activity_type: activity.activity_type,
            partner_name: activity.partner_name,
            referrals_generated: activity.referrals_generated,
          },
        }),
      );
    }

    return { processedCount: activities.length };
  });
}
