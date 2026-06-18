import { addDays } from 'date-fns';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from '../runner';
import { buildIntakeLinkageTaskKey, formatDateKey } from '../daily-helpers';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { createManyNotifications } from './shared';

/**
 * 服用最終日接近チェック（3日以内）
 */
export async function checkMedicationDeadlines() {
  return runJob('medication_deadline_check', async () => {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    const approaching = await prisma.visitSchedule.findMany({
      where: {
        medication_end_date: { lte: threeDaysFromNow },
        schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
      },
    });

    for (const schedule of approaching) {
      await withOrgContext(schedule.org_id, (tx) =>
        dispatchNotificationEvent(tx, {
          orgId: schedule.org_id,
          eventType: 'medication_deadline_approaching',
          type: 'reminder',
          title: '服用最終日接近',
          message: '訪問予定の患者の服薬最終日が3日以内です。',
          link: `/schedules`,
          explicitUserIds: [schedule.pharmacist_id],
          dedupeKey: `medication-deadline:${schedule.id}`,
          metadata: {
            schedule_id: schedule.id,
          },
        }),
      );
    }

    return { processedCount: approaching.length };
  });
}

/**
 * リフィル処方箋の次回調剤日通知（7日以内）
 */
export async function checkRefillPrescriptions() {
  return runJob('refill_prescription_check', async () => {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const upcoming = await prisma.prescriptionIntake.findMany({
      where: {
        source_type: 'refill',
        refill_next_dispense_date: { lte: sevenDaysFromNow },
        refill_remaining_count: { gt: 0 },
      },
      include: {
        cycle: {
          include: {
            case_: true,
          },
        },
      },
    });

    for (const intake of upcoming) {
      const primaryPharmacistId = intake.cycle?.case_.primary_pharmacist_id;
      if (!primaryPharmacistId) continue;
      await withOrgContext(intake.org_id, (tx) =>
        dispatchNotificationEvent(tx, {
          orgId: intake.org_id,
          eventType: 'refill_due_soon',
          type: 'reminder',
          title: 'リフィル調剤日が近づいています',
          message: '次回調剤日が近いため訪問候補の確認が必要です。',
          link: `/workflow`,
          explicitUserIds: [primaryPharmacistId],
          dedupeKey: `refill-due:${intake.id}`,
          metadata: {
            cycle_id: intake.cycle_id,
            intake_id: intake.id,
          },
        }),
      );
    }

    return { processedCount: upcoming.length };
  });
}

export async function checkIntakeToVisitLinkage() {
  return runJob('visit_intake_linkage_check', async () => {
    const today = new Date();
    const refillWindow = addDays(today, 14);
    const expiryWindow = addDays(today, 7);

    const intakes = await prisma.prescriptionIntake.findMany({
      where: {
        OR: [
          {
            source_type: 'refill',
            refill_remaining_count: { gt: 0 },
            refill_next_dispense_date: {
              gte: today,
              lte: refillWindow,
            },
          },
          {
            prescription_expiry_date: {
              gte: today,
              lte: expiryWindow,
            },
          },
        ],
      },
      include: {
        cycle: {
          include: {
            case_: {
              select: {
                id: true,
                patient_id: true,
                primary_pharmacist_id: true,
                patient: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            visit_schedules: {
              where: {
                schedule_status: {
                  in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
                },
                scheduled_date: {
                  gte: today,
                },
              },
              select: {
                id: true,
              },
            },
            visit_schedule_proposals: {
              where: {
                proposal_status: {
                  in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
                },
              },
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    let processedCount = 0;

    for (const intake of intakes) {
      const careCase = intake.cycle?.case_;
      if (!careCase) continue;
      if (intake.cycle?.visit_schedules.length || intake.cycle?.visit_schedule_proposals.length) {
        continue;
      }

      const dueDate =
        intake.refill_next_dispense_date ?? intake.prescription_expiry_date ?? addDays(today, 1);
      const reason =
        intake.source_type === 'refill'
          ? 'リフィルの次回調剤日に向けた訪問候補が未連携です。'
          : '処方受付から次回訪問候補への接続が未完了です。';

      await withOrgContext(intake.org_id, async (tx) => {
        await upsertOperationalTask(tx, {
          orgId: intake.org_id,
          taskType: 'visit_intake_linkage',
          title: '処方受付から訪問導線への接続が必要です',
          description: reason,
          priority: dueDate <= addDays(today, 3) ? 'urgent' : 'high',
          assignedTo: careCase.primary_pharmacist_id ?? null,
          dueDate,
          slaDueAt: dueDate,
          relatedEntityType: 'cycle',
          relatedEntityId: intake.cycle_id,
          dedupeKey: buildIntakeLinkageTaskKey(intake.id),
          metadata: {
            intake_id: intake.id,
            cycle_id: intake.cycle_id,
            case_id: careCase.id,
            patient_id: careCase.patient_id,
            patient_name: careCase.patient.name,
            due_date: dueDate.toISOString(),
            source_type: intake.source_type,
          },
        });

        if (careCase.primary_pharmacist_id) {
          await dispatchNotificationEvent(tx, {
            orgId: intake.org_id,
            eventType: 'visit_intake_linkage_due',
            type: 'business',
            title: '処方受付から訪問候補への接続が必要です',
            message: `${careCase.patient.name}さんの訪問候補または架電導線が未作成です。`,
            link: '/workflow',
            explicitUserIds: [careCase.primary_pharmacist_id],
            dedupeKey: buildIntakeLinkageTaskKey(intake.id),
            metadata: {
              intake_id: intake.id,
              cycle_id: intake.cycle_id,
              case_id: careCase.id,
              patient_id: careCase.patient_id,
            },
          });
        }
      });

      processedCount += 1;
    }

    return { processedCount };
  });
}

/**
 * 処方箋有効期限チェック（翌日期限切れ）
 */
export async function checkPrescriptionExpiry() {
  return runJob('prescription_expiry_check', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const expiring = await prisma.prescriptionIntake.findMany({
      where: {
        prescription_expiry_date: { lte: tomorrow },
      },
      include: {
        cycle: {
          include: {
            case_: true,
          },
        },
      },
    });

    const notificationData: Prisma.NotificationCreateManyInput[] = [];

    for (const intake of expiring) {
      if (!intake.cycle?.case_) continue;
      const orgId = intake.cycle.case_.org_id;

      // Notify the case pharmacist
      const caseRecord = intake.cycle.case_;
      if (caseRecord.primary_pharmacist_id) {
        notificationData.push({
          org_id: orgId,
          user_id: caseRecord.primary_pharmacist_id,
          type: 'urgent',
          title: '処方箋有効期限切れ間近',
          message: `処方箋の有効期限が ${intake.prescription_expiry_date ? formatDateKey(intake.prescription_expiry_date) : '不明'} です。早急に対応してください。`,
          link: `/patients/${caseRecord.patient_id}`,
          dedupe_key: `prescription-expiry:${intake.id}`,
        });
      }
    }

    const notificationResult = await createManyNotifications(notificationData);

    return { processedCount: notificationResult.count };
  });
}
