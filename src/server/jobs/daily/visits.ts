import { addDays, addYears } from 'date-fns';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from '../runner';
import {
  buildVisitDemandTaskKey,
  buildVisitRecordRetentionTaskKey,
  formatDateKey,
  startOfDay,
  syncGeneratedOperationalTasks,
  type GeneratedTaskSpec,
} from '../daily-helpers';
import { generateVisitScheduleProposalDrafts } from '@/server/services/visit-schedule-planner';
import { allocateProposalRouteOrders } from '@/lib/visit-schedule-proposals/route-order';
import {
  formatVisitWorkflowGateIssues,
  parseVisitWorkflowGateErrorMessage,
  VISIT_WORKFLOW_GATE_ERROR_PREFIX,
} from '@/server/services/management-plans';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { createManyNotifications } from './shared';

export async function checkVisitRecordRetention() {
  return runJob('visit_record_retention_check', async () => {
    const now = startOfDay(new Date());
    const in30Days = startOfDay(addDays(now, 30));
    const expiringFrom = startOfDay(addYears(now, -5));
    const expiringTo = startOfDay(addYears(in30Days, -5));

    const expiring = await prisma.visitRecord.findMany({
      where: {
        visit_date: {
          gte: expiringFrom,
          lte: expiringTo,
        },
      },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        visit_date: true,
      },
    });

    if (expiring.length === 0) {
      return { processedCount: 0 };
    }

    const orgIds = Array.from(new Set(expiring.map((record) => record.org_id)));
    const patientIds = Array.from(new Set(expiring.map((record) => record.patient_id)));
    const [admins, patients] = await Promise.all([
      prisma.membership.findMany({
        where: {
          org_id: { in: orgIds },
          role: { in: ['admin', 'owner'] },
          is_active: true,
        },
        select: {
          org_id: true,
          user_id: true,
        },
      }),
      prisma.patient.findMany({
        where: {
          org_id: { in: orgIds },
          id: { in: patientIds },
        },
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    const adminsByOrg = new Map<string, string[]>();
    for (const admin of admins) {
      const bucket = adminsByOrg.get(admin.org_id) ?? [];
      bucket.push(admin.user_id);
      adminsByOrg.set(admin.org_id, bucket);
    }
    const patientById = new Map(patients.map((patient) => [patient.id, patient.name]));

    const taskSpecs: GeneratedTaskSpec[] = [];
    const notificationData: Prisma.NotificationCreateManyInput[] = [];

    for (const record of expiring) {
      const retentionUntil = startOfDay(addYears(record.visit_date, 5));
      const daysUntilExpiry = Math.ceil(
        (retentionUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const priority = daysUntilExpiry <= 7 ? ('urgent' as const) : ('high' as const);
      const thresholdLabel = daysUntilExpiry <= 7 ? '7日以内' : '30日以内';
      const patientName = patientById.get(record.patient_id) ?? record.patient_id;
      const visitRecordHref = `/visits/${encodeURIComponent(record.id)}`;

      for (const adminId of adminsByOrg.get(record.org_id) ?? []) {
        notificationData.push({
          org_id: record.org_id,
          user_id: adminId,
          type: priority === 'urgent' ? 'urgent' : 'business',
          title: '薬歴の保存期限',
          message: `${patientName} さんの訪問記録が${thresholdLabel}に保存期限を迎えます。保全状況を確認してください。`,
          link: visitRecordHref,
          dedupe_key: `visit-record-retention:${record.id}:${adminId}:${priority}`,
        });
      }

      taskSpecs.push({
        orgId: record.org_id,
        taskType: 'visit_record_retention',
        dedupeKey: buildVisitRecordRetentionTaskKey(record.id),
        title: `薬歴保存期限確認: ${patientName}`,
        description: `訪問記録が ${formatDateKey(retentionUntil)} に5年保存期限を迎えます。PDF出力・保全状況を確認してください。`,
        priority,
        dueDate: retentionUntil,
        relatedEntityType: 'visit_record',
        relatedEntityId: record.id,
        metadata: {
          patient_id: record.patient_id,
          retention_until: retentionUntil.toISOString(),
        } satisfies Prisma.InputJsonValue,
      });
    }

    const notificationResult = await createManyNotifications(notificationData);

    if (taskSpecs.length > 0) {
      await syncGeneratedOperationalTasks(taskSpecs, ['visit_record_retention']);
    }

    return { processedCount: notificationResult.count };
  });
}

export async function generateVisitDemands() {
  return runJob('visit_demand_generation', async () => {
    // end_date / refill_next_dispense_date 等の服薬期限(@db.Date 規約の UTC 深夜値)と
    // 比較するため、今日もローカル日付の UTC 深夜で表す
    const startOfToday = utcDateFromLocalKey(localDateKey());
    const demandWindow = addUtcDays(startOfToday, 7);

    const cycles = await prisma.medicationCycle.findMany({
      where: {
        overall_status: { in: ['set_audited', 'visit_ready', 'visit_completed'] },
      },
      include: {
        case_: {
          include: {
            patient: {
              include: {
                residences: {
                  where: { is_primary: true },
                  take: 1,
                },
              },
            },
          },
        },
        prescription_intakes: {
          include: {
            lines: {
              select: {
                end_date: true,
              },
            },
          },
        },
        visit_schedules: {
          where: {
            schedule_status: {
              in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
            },
          },
          select: { id: true },
        },
        visit_schedule_proposals: {
          where: {
            proposal_status: {
              in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
            },
          },
          select: { id: true },
        },
      },
    });

    let processedCount = 0;
    const errors: string[] = [];

    for (const cycle of cycles) {
      if (cycle.visit_schedules.length > 0 || cycle.visit_schedule_proposals.length > 0) {
        continue;
      }

      const deadlines = cycle.prescription_intakes.flatMap((intake) => [
        ...intake.lines
          .map((line) => line.end_date)
          .filter((value): value is Date => value != null),
        ...(intake.refill_next_dispense_date ? [intake.refill_next_dispense_date] : []),
      ]);
      const visitDeadline =
        deadlines.length > 0
          ? new Date(Math.max(...deadlines.map((deadline) => deadline.getTime())))
          : null;
      if (!visitDeadline || visitDeadline > demandWindow) {
        continue;
      }

      try {
        const result = await generateVisitScheduleProposalDrafts({
          orgId: cycle.org_id,
          caseId: cycle.case_id,
          visitType: 'regular',
          priority: visitDeadline <= addUtcDays(startOfToday, 3) ? 'urgent' : 'normal',
          candidateCount: 3,
          startDate: addUtcDays(startOfToday, 1),
        });
        const drafts = result.drafts;

        if (drafts.length === 0) continue;

        await withOrgContext(cycle.org_id, async (tx) => {
          const routeOrderDrafts = await allocateProposalRouteOrders(tx, {
            orgId: cycle.org_id,
            drafts,
          });

          await Promise.all(
            routeOrderDrafts.map((draft) =>
              tx.visitScheduleProposal.create({
                data: draft,
              }),
            ),
          );

          await upsertOperationalTask(tx, {
            orgId: cycle.org_id,
            taskType: 'visit_demand',
            title: '訪問候補の承認が必要です',
            description: '服薬期限前の訪問候補を自動提案しました。',
            priority: visitDeadline <= addUtcDays(startOfToday, 3) ? 'urgent' : 'high',
            assignedTo: cycle.case_.primary_pharmacist_id ?? null,
            dueDate: visitDeadline,
            slaDueAt: visitDeadline,
            relatedEntityType: 'cycle',
            relatedEntityId: cycle.id,
            dedupeKey: buildVisitDemandTaskKey(cycle.id),
            metadata: {
              case_id: cycle.case_id,
              patient_id: cycle.patient_id,
              proposal_count: drafts.length,
            },
          });

          if (cycle.case_.primary_pharmacist_id) {
            await dispatchNotificationEvent(tx, {
              orgId: cycle.org_id,
              eventType: 'visit_demand_created',
              type: 'business',
              title: '訪問候補を自動提案しました',
              message: '服薬期限に合わせて訪問候補を生成しました。承認と架電対応を進めてください。',
              link: '/schedules',
              explicitUserIds: [cycle.case_.primary_pharmacist_id],
              dedupeKey: buildVisitDemandTaskKey(cycle.id),
              metadata: {
                case_id: cycle.case_id,
                patient_id: cycle.patient_id,
              },
            });
          }
        });

        processedCount += 1;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith(VISIT_WORKFLOW_GATE_ERROR_PREFIX)) {
          const issues = parseVisitWorkflowGateErrorMessage(error.message);

          await withOrgContext(cycle.org_id, async (tx) => {
            await upsertOperationalTask(tx, {
              orgId: cycle.org_id,
              taskType: 'visit_demand',
              title: '訪問候補生成の前提が不足しています',
              description: formatVisitWorkflowGateIssues(issues),
              priority: 'high',
              assignedTo: cycle.case_.primary_pharmacist_id ?? null,
              dueDate: visitDeadline,
              slaDueAt: visitDeadline,
              relatedEntityType: 'cycle',
              relatedEntityId: cycle.id,
              dedupeKey: buildVisitDemandTaskKey(cycle.id),
            });
          });
          processedCount += 1;
          continue;
        }

        errors.push(error instanceof Error ? error.message : `cycle:${cycle.id}:unknown_error`);
      }
    }

    return { processedCount, ...(errors.length > 0 ? { errors } : {}) };
  });
}
