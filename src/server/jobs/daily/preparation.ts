import { addDays } from 'date-fns';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { prisma } from '@/lib/db/client';
import { normalizeJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from '../runner';
import {
  buildCarryItemReviewTaskKey,
  buildInitialAssessmentTaskKey,
  buildPreparationTaskKey,
  syncGeneratedOperationalTasks,
  type GeneratedTaskSpec,
} from '../daily-helpers';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { evaluateInitialHomeVisitAssessmentRequirement } from '@/server/services/billing-evidence';

export async function checkPreparationBacklog() {
  return runJob('visit_preparation_check', async () => {
    const tomorrow = addDays(new Date(), 1);
    const schedules = await prisma.visitSchedule.findMany({
      where: {
        scheduled_date: { lte: tomorrow },
        schedule_status: { in: ['planned', 'in_preparation'] },
      },
      include: {
        preparation: true,
      },
    });

    for (const schedule of schedules) {
      const preparation = schedule.preparation;
      const ready =
        preparation?.medication_changes_reviewed &&
        preparation.carry_items_confirmed &&
        preparation.previous_issues_reviewed &&
        preparation.route_confirmed &&
        preparation.offline_synced;
      if (ready) continue;

      await withOrgContext(schedule.org_id, (tx) =>
        upsertOperationalTask(tx, {
          orgId: schedule.org_id,
          taskType: 'visit_preparation',
          title: '訪問準備が未完了です',
          description: '明日までの訪問予定に必要な準備が完了していません。',
          priority: 'high',
          assignedTo: schedule.pharmacist_id,
          dueDate: schedule.scheduled_date,
          slaDueAt: schedule.scheduled_date,
          relatedEntityType: 'visit_schedule',
          relatedEntityId: schedule.id,
          dedupeKey: buildPreparationTaskKey(schedule.id),
        }),
      );
    }

    return { processedCount: schedules.length };
  });
}

export async function checkInitialHomeVisitAssessmentBacklog() {
  return runJob('initial_home_visit_assessment_check', async () => {
    // scheduled_date(@db.Date)比較用: ローカル日付の UTC 深夜境界
    const tomorrow = addUtcDays(utcDateFromLocalKey(localDateKey()), 1);
    const dayAfterTomorrow = addUtcDays(tomorrow, 1);

    const schedules = await prisma.visitSchedule.findMany({
      where: {
        scheduled_date: {
          gte: tomorrow,
          lt: dayAfterTomorrow,
        },
        schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
      },
      select: {
        id: true,
        org_id: true,
        scheduled_date: true,
        pharmacist_id: true,
        case_: {
          select: {
            patient_id: true,
            patient: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    const taskSpecs: GeneratedTaskSpec[] = [];
    let notificationCount = 0;

    for (const schedule of schedules) {
      const patientId = schedule.case_.patient_id;
      const patientName = schedule.case_.patient.name;
      const requirement = await withOrgContext(schedule.org_id, (tx) =>
        evaluateInitialHomeVisitAssessmentRequirement(tx, {
          orgId: schedule.org_id,
          patientId,
          targetDate: schedule.scheduled_date,
        }),
      );

      if (!requirement.required || requirement.satisfied) continue;

      const dedupeKey = buildInitialAssessmentTaskKey(schedule.id);
      taskSpecs.push({
        orgId: schedule.org_id,
        taskType: 'initial_home_visit_assessment',
        dedupeKey,
        title: '初回算定月の事前訪問要件を確認してください',
        description:
          requirement.reason ?? '初回訪問前日までの患家訪問・環境聴取記録が不足しています。',
        priority: 'high',
        assignedTo: schedule.pharmacist_id,
        dueDate: schedule.scheduled_date,
        slaDueAt: schedule.scheduled_date,
        relatedEntityType: 'visit_schedule',
        relatedEntityId: schedule.id,
        metadata:
          normalizeJsonInput({
            patient_id: patientId,
            patient_name: patientName,
            schedule_id: schedule.id,
            action_href: `/patients/${patientId}`,
            action_label: '患者記録を確認',
          }) ?? {},
      });

      await withOrgContext(schedule.org_id, (tx) =>
        dispatchNotificationEvent(tx, {
          orgId: schedule.org_id,
          eventType: 'billing_initial_assessment_due',
          type: 'urgent',
          title: '初回算定月の事前訪問要件が未確認です',
          message: `${patientName}さんの初回訪問前日までの患家訪問・環境聴取記録を確認してください。`,
          link: `/patients/${patientId}`,
          explicitUserIds: [schedule.pharmacist_id],
          dedupeKey,
          metadata:
            normalizeJsonInput({
              patient_id: patientId,
              schedule_id: schedule.id,
            }) ?? {},
        }),
      );
      notificationCount += 1;
    }

    await syncGeneratedOperationalTasks(taskSpecs, ['initial_home_visit_assessment']);

    return { processedCount: taskSpecs.length + notificationCount };
  });
}

export async function checkCarryItemReadiness() {
  return runJob('carry_item_readiness_check', async () => {
    const schedules = await prisma.visitSchedule.findMany({
      where: {
        scheduled_date: {
          gte: new Date(),
          lte: addDays(new Date(), 2),
        },
        schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
        carry_items_status: { in: ['blocked', 'partial'] },
      },
      include: {
        case_: {
          select: {
            patient: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    for (const schedule of schedules) {
      await withOrgContext(schedule.org_id, (tx) =>
        upsertOperationalTask(tx, {
          orgId: schedule.org_id,
          taskType: 'visit_carry_item_review',
          title: `${schedule.case_.patient.name} の持参物確認`,
          description: '持参薬・物品の準備状況を確認してください。',
          priority: schedule.carry_items_status === 'blocked' ? 'urgent' : 'high',
          assignedTo: schedule.pharmacist_id,
          dueDate: schedule.scheduled_date,
          slaDueAt: schedule.scheduled_date,
          relatedEntityType: 'visit_schedule',
          relatedEntityId: schedule.id,
          dedupeKey: buildCarryItemReviewTaskKey(schedule.id),
          metadata: {
            patient_name: schedule.case_.patient.name,
            patient_id: schedule.case_.patient.id,
            carry_items_status: schedule.carry_items_status,
          },
        }),
      );
    }

    return { processedCount: schedules.length };
  });
}
