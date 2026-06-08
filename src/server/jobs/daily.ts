import { addDays, addYears, subHours } from 'date-fns';
import { deriveFacilityLabel } from '@/lib/utils/facility';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { normalizeJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { runJob } from './runner';
import { checkDrugMasterFreshness } from './drug-master';
import {
  buildCarryItemReviewTaskKey,
  buildCommunityFollowupTaskKey,
  buildConsentExpiryTaskKey,
  buildDosageSupportTaskKey,
  buildEmergencyContactReviewTaskKey,
  buildEmergencyCoverageGapTaskKey,
  buildFacilityBatchTrackerTaskKey,
  buildFacilityStandardExpiryTaskKey,
  buildGeocodeTaskKey,
  buildInitialAssessmentTaskKey,
  buildInquiryWorkbenchTaskKey,
  buildIntakeLinkageTaskKey,
  buildMobileVisitModeTaskKey,
  buildPcaPumpReturnInspectionPendingTaskKey,
  buildPcaPumpRentalOverdueTaskKey,
  buildPreparationTaskKey,
  buildReportDeliveryTaskKey,
  buildSelfReportTaskKey,
  buildVisitDemandTaskKey,
  buildVisitRecordRetentionTaskKey,
  formatDateKey,
  hasAnyKeyword,
  parseConferenceSections,
  parseDateFromConferenceText,
  startOfDay,
  syncGeneratedOperationalTasks,
  type GeneratedTaskSpec,
} from './daily-helpers';
import { checkPrescriptionOriginalRetention } from './daily-prescription-original-retention';
import { generateVisitScheduleProposalDrafts } from '@/server/services/visit-schedule-planner';
import {
  scheduleManagementPlanReviewAlert,
  formatVisitWorkflowGateIssues,
  parseVisitWorkflowGateErrorMessage,
  VISIT_WORKFLOW_GATE_ERROR_PREFIX,
} from '@/server/services/management-plans';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import {
  evaluateInitialHomeVisitAssessmentRequirement,
  upsertBillingEvidenceForVisit,
} from '@/server/services/billing-evidence';
import { queueOverdueReportResponseReminders } from '@/server/services/report-reminders';
import { trackPatientStatusChanges } from '@/server/services/patient-status-tracker';
import { buildVisitScheduleContactFollowupTask } from '@/server/services/visit-schedule-communication';

const DOSAGE_SUPPORT_KEYWORDS = [
  '飲みにく',
  '飲めない',
  'むせ',
  '嚥下',
  '粉砕',
  '一包化',
  '剤形',
  '貼付',
  '服用しづら',
] as const;

export { checkPrescriptionOriginalRetention };

type JobExecutionContext = {
  orgId?: string;
};

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

export async function checkPcaPumpRentalOverdues(context: JobExecutionContext = {}) {
  return runJob(
    'pca_pump_rental_overdue_check',
    async () => {
      const today = startOfDay();
      const overdueRentals = await prisma.pcaPumpRental.findMany({
        where: {
          ...(context.orgId ? { org_id: context.orgId } : {}),
          status: { in: ['scheduled', 'active'] },
          due_at: { lt: today },
        },
        select: {
          id: true,
          org_id: true,
          pump_id: true,
          institution_id: true,
          rented_at: true,
          due_at: true,
          rental_fee_yen: true,
          pump: {
            select: {
              asset_code: true,
              model_name: true,
            },
          },
          institution: {
            select: {
              name: true,
            },
          },
        },
        orderBy: [{ due_at: 'asc' }, { created_at: 'asc' }],
      });

      for (const rental of overdueRentals) {
        await withOrgContext(rental.org_id, async (tx) => {
          await tx.pcaPumpRental.updateMany({
            where: {
              id: rental.id,
              org_id: rental.org_id,
              status: { in: ['scheduled', 'active'] },
              due_at: { lt: today },
            },
            data: {
              status: 'overdue',
            },
          });

          const overdueDays = rental.due_at
            ? Math.max(
                1,
                Math.floor((today.getTime() - startOfDay(rental.due_at).getTime()) / 86_400_000),
              )
            : 0;
          const pumpLabel = `${rental.pump.asset_code} ${rental.pump.model_name}`.trim();
          await upsertOperationalTask(tx, {
            orgId: rental.org_id,
            taskType: 'pca_pump_rental_overdue',
            title: 'PCAポンプの返却期限を超過しています',
            description: `${rental.institution.name} への貸出 ${pumpLabel} が返却予定日を${overdueDays}日超過しています。返却予定の確認、延長可否、請求調整を確認してください。`,
            priority: overdueDays >= 7 ? 'urgent' : 'high',
            assignedTo: null,
            dueDate: rental.due_at,
            slaDueAt: rental.due_at,
            relatedEntityType: 'pca_pump_rental',
            relatedEntityId: rental.id,
            dedupeKey: buildPcaPumpRentalOverdueTaskKey(rental.id),
            metadata: {
              rental_id: rental.id,
              pump_id: rental.pump_id,
              pump_asset_code: rental.pump.asset_code,
              institution_id: rental.institution_id,
              institution_name: rental.institution.name,
              rented_at: rental.rented_at.toISOString().slice(0, 10),
              due_at: rental.due_at?.toISOString().slice(0, 10) ?? null,
              overdue_days: overdueDays,
              rental_fee_yen: rental.rental_fee_yen,
              action_href: '/admin/pca-pumps',
              action_label: 'PCAポンプ貸出を確認',
            },
          });
        });
      }

      return { processedCount: overdueRentals.length };
    },
    context.orgId,
  );
}

export async function checkPcaPumpReturnInspectionPending(context: JobExecutionContext = {}) {
  return runJob(
    'pca_pump_return_inspection_pending_check',
    async () => {
      const today = startOfDay();
      const rentals = await prisma.pcaPumpRental.findMany({
        where: {
          ...(context.orgId ? { org_id: context.orgId } : {}),
          status: 'returned',
          return_inspection_status: 'pending',
        },
        select: {
          id: true,
          org_id: true,
          pump_id: true,
          institution_id: true,
          rented_at: true,
          due_at: true,
          returned_at: true,
          pump: {
            select: {
              asset_code: true,
              model_name: true,
            },
          },
          institution: {
            select: {
              name: true,
            },
          },
        },
        orderBy: [{ returned_at: 'asc' }, { updated_at: 'asc' }],
        take: 200,
      });

      const taskSpecs: GeneratedTaskSpec[] = rentals.map((rental) => {
        const returnedAt = rental.returned_at ? startOfDay(rental.returned_at) : today;
        const pendingDays = Math.max(
          0,
          Math.floor((today.getTime() - returnedAt.getTime()) / 86_400_000),
        );
        const pumpLabel = `${rental.pump.asset_code} ${rental.pump.model_name}`.trim();
        return {
          orgId: rental.org_id,
          taskType: 'pca_pump_return_inspection_pending',
          title: 'PCAポンプの返却検品が未完了です',
          description: `${rental.institution.name} から返却された ${pumpLabel} の返却検品が未完了です。付属品、清拭、動作確認を完了し、利用可否を確定してください。`,
          priority: pendingDays >= 2 ? 'high' : 'normal',
          assignedTo: null,
          dueDate: rental.returned_at,
          slaDueAt: rental.returned_at,
          relatedEntityType: 'pca_pump_rental',
          relatedEntityId: rental.id,
          dedupeKey: buildPcaPumpReturnInspectionPendingTaskKey(rental.id),
          metadata: {
            rental_id: rental.id,
            pump_id: rental.pump_id,
            pump_asset_code: rental.pump.asset_code,
            institution_id: rental.institution_id,
            institution_name: rental.institution.name,
            rented_at: rental.rented_at.toISOString().slice(0, 10),
            due_at: rental.due_at?.toISOString().slice(0, 10) ?? null,
            returned_at: rental.returned_at?.toISOString().slice(0, 10) ?? null,
            pending_days: pendingDays,
            action_href: '/admin/pca-pumps',
            action_label: '返却検品を確認',
          },
        };
      });

      await syncGeneratedOperationalTasks(taskSpecs, ['pca_pump_return_inspection_pending'], {
        scopeOrgIds: context.orgId ? [context.orgId] : undefined,
      });

      return { processedCount: rentals.length };
    },
    context.orgId,
  );
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

    for (const intake of expiring) {
      if (!intake.cycle?.case_) continue;
      const orgId = intake.cycle.case_.org_id;

      // Notify the case pharmacist
      const caseRecord = intake.cycle.case_;
      if (caseRecord.primary_pharmacist_id) {
        await prisma.notification.create({
          data: {
            org_id: orgId,
            user_id: caseRecord.primary_pharmacist_id,
            type: 'urgent',
            title: '処方箋有効期限切れ間近',
            message: `処方箋の有効期限が ${intake.prescription_expiry_date?.toISOString().slice(0, 10) ?? '不明'} です。早急に対応してください。`,
            link: `/patients/${caseRecord.patient_id}`,
            dedupe_key: `prescription-expiry:${intake.id}`,
          },
        });
      }
    }

    return { processedCount: expiring.length };
  });
}

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
    let notificationCount = 0;

    for (const record of expiring) {
      const retentionUntil = startOfDay(addYears(record.visit_date, 5));
      const daysUntilExpiry = Math.ceil(
        (retentionUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const priority = daysUntilExpiry <= 7 ? ('urgent' as const) : ('high' as const);
      const thresholdLabel = daysUntilExpiry <= 7 ? '7日以内' : '30日以内';
      const patientName = patientById.get(record.patient_id) ?? record.patient_id;

      for (const adminId of adminsByOrg.get(record.org_id) ?? []) {
        await prisma.notification.create({
          data: {
            org_id: record.org_id,
            user_id: adminId,
            type: priority === 'urgent' ? 'urgent' : 'business',
            title: '薬歴の保存期限',
            message: `${patientName} さんの訪問記録が${thresholdLabel}に保存期限を迎えます。保全状況を確認してください。`,
            link: `/visits/${record.id}`,
            dedupe_key: `visit-record-retention:${record.id}:${adminId}:${priority}`,
          },
        });
        notificationCount += 1;
      }

      taskSpecs.push({
        orgId: record.org_id,
        taskType: 'visit_record_retention',
        dedupeKey: buildVisitRecordRetentionTaskKey(record.id),
        title: `薬歴保存期限確認: ${patientName}`,
        description: `訪問記録が ${retentionUntil.toISOString().slice(0, 10)} に5年保存期限を迎えます。PDF出力・保全状況を確認してください。`,
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

    if (taskSpecs.length > 0) {
      await syncGeneratedOperationalTasks(taskSpecs, ['visit_record_retention']);
    }

    return { processedCount: notificationCount };
  });
}

export async function generateVisitDemands() {
  return runJob('visit_demand_generation', async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const demandWindow = addDays(startOfToday, 7);

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
          priority: visitDeadline <= addDays(startOfToday, 3) ? 'urgent' : 'normal',
          candidateCount: 3,
          startDate: addDays(startOfToday, 1),
        });
        const drafts = result.drafts;

        if (drafts.length === 0) continue;

        await withOrgContext(cycle.org_id, async (tx) => {
          await Promise.all(
            drafts.map((draft) =>
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
            priority: visitDeadline <= addDays(startOfToday, 3) ? 'urgent' : 'high',
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
    const tomorrow = addDays(startOfDay(), 1);
    const dayAfterTomorrow = addDays(tomorrow, 1);

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

export async function generateBillingEvidenceDaily() {
  return runJob('billing_evidence_generation', async () => {
    const existingEvidence = await prisma.billingEvidence.findMany({
      select: {
        visit_record_id: true,
      },
    });
    const existingVisitRecordIds = existingEvidence.map((record) => record.visit_record_id);

    const visitRecords = await prisma.visitRecord.findMany({
      where: {
        ...(existingVisitRecordIds.length > 0 ? { id: { notIn: existingVisitRecordIds } } : {}),
      },
      select: {
        id: true,
        org_id: true,
      },
    });

    for (const visitRecord of visitRecords) {
      await withOrgContext(visitRecord.org_id, (tx) =>
        upsertBillingEvidenceForVisit(tx, {
          orgId: visitRecord.org_id,
          visitRecordId: visitRecord.id,
        }),
      );
    }

    return { processedCount: visitRecords.length };
  });
}

export async function checkSelfReportFollowups() {
  return runJob('self_report_followup_check', async () => {
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

export async function checkConferenceMeetingReminders() {
  return runJob('conference_meeting_reminders', async () => {
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);

    const notes = await prisma.conferenceNote.findMany({
      where: {
        note_type: 'service_manager',
      },
      select: {
        id: true,
        org_id: true,
        case_id: true,
        title: true,
        structured_content: true,
      },
    });

    const caseIds = Array.from(
      new Set(notes.map((note) => note.case_id).filter((value): value is string => Boolean(value))),
    );
    const careCases =
      caseIds.length > 0
        ? await prisma.careCase.findMany({
            where: {
              id: { in: caseIds },
            },
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
          })
        : [];
    const careCaseById = new Map(careCases.map((careCase) => [careCase.id, careCase]));

    let processedCount = 0;

    for (const note of notes) {
      if (!note.case_id) continue;

      const sections = parseConferenceSections(note.structured_content);
      const nextMeetingSection = sections.find((section) => section.key === 'next_meeting_date');
      const meetingDate = parseDateFromConferenceText(nextMeetingSection?.body);
      if (!meetingDate) continue;

      const isReminderWindow =
        meetingDate.getTime() === today.getTime() || meetingDate.getTime() === tomorrow.getTime();
      if (!isReminderWindow) continue;

      const careCase = careCaseById.get(note.case_id);
      const primaryPharmacistId = careCase?.primary_pharmacist_id;
      if (!primaryPharmacistId) continue;

      await withOrgContext(note.org_id, async (tx) =>
        dispatchNotificationEvent(tx, {
          orgId: note.org_id,
          eventType: 'conference_next_meeting_due',
          type: 'reminder',
          title: '次回担当者会議の予定確認',
          message: `${careCase.patient.name ?? '患者'} の担当者会議が ${formatDateKey(meetingDate)} に予定されています。`,
          link: '/conferences',
          explicitUserIds: [primaryPharmacistId],
          dedupeKey: `conference-next-meeting:${note.id}:${formatDateKey(meetingDate)}`,
          metadata: {
            conference_note_id: note.id,
            case_id: note.case_id,
            patient_id: careCase.patient_id,
            next_meeting_date: formatDateKey(meetingDate),
          } satisfies Prisma.InputJsonValue,
        }),
      );
      processedCount++;
    }

    return { processedCount };
  });
}

export async function checkReportDeliveryBacklog() {
  return runJob('report_delivery_backlog_check', async () => {
    const reports = await prisma.careReport.findMany({
      where: {
        status: { in: ['draft', 'failed', 'response_waiting'] },
      },
      include: {
        delivery_records: {
          where: {
            status: { in: ['draft', 'failed', 'response_waiting'] },
          },
          select: {
            id: true,
            status: true,
            recipient_name: true,
            failure_reason: true,
          },
        },
      },
    });
    const orgIds = new Set<string>();

    for (const report of reports) {
      orgIds.add(report.org_id);
      const dueAt = addDays(new Date(report.updated_at), 1);
      await withOrgContext(report.org_id, async (tx) => {
        await upsertOperationalTask(tx, {
          orgId: report.org_id,
          taskType: 'report_delivery_followup',
          title: `報告送達の確認が必要です`,
          description:
            report.delivery_records[0]?.failure_reason ??
            `${report.report_type} が ${report.status} のまま残っています。`,
          priority: report.status === 'failed' ? 'urgent' : 'high',
          assignedTo: report.created_by,
          dueDate: dueAt,
          slaDueAt: dueAt,
          relatedEntityType: 'care_report',
          relatedEntityId: report.id,
          dedupeKey: buildReportDeliveryTaskKey(report.id),
          metadata: {
            patient_id: report.patient_id,
            case_id: report.case_id,
            report_type: report.report_type,
            delivery_statuses: report.delivery_records.map((record) => record.status),
          },
        });
      });
    }

    let queuedResponseReminders = 0;
    for (const orgId of orgIds) {
      const result = await withOrgContext(orgId, (tx) =>
        queueOverdueReportResponseReminders(tx, orgId),
      );
      queuedResponseReminders += result.queued_count;
    }

    return { processedCount: reports.length, queuedResponseReminders };
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

export async function checkEmergencyCoverageGaps() {
  return runJob('emergency_coverage_gap_check', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = addDays(today, 3);

    const [holidays, shifts] = await Promise.all([
      prisma.businessHoliday.findMany({
        where: {
          date: {
            gte: today,
            lte: horizon,
          },
        },
        select: {
          org_id: true,
          site_id: true,
          date: true,
          name: true,
          is_closed: true,
        },
      }),
      prisma.pharmacistShift.findMany({
        where: {
          date: {
            gte: today,
            lte: horizon,
          },
          available: true,
          user: {
            is_active: true,
            can_accept_emergency: true,
          },
        },
        select: {
          org_id: true,
          site_id: true,
          date: true,
          user_id: true,
        },
      }),
    ]);

    const shiftCoverage = new Set(
      shifts.map(
        (shift) =>
          `${shift.org_id}:${shift.site_id ?? 'org'}:${shift.date.toISOString().slice(0, 10)}`,
      ),
    );

    let processedCount = 0;
    for (const holiday of holidays.filter((item) => item.is_closed)) {
      const dateKey = holiday.date.toISOString().slice(0, 10);
      const coverageKey = `${holiday.org_id}:${holiday.site_id ?? 'org'}:${dateKey}`;
      if (shiftCoverage.has(coverageKey)) continue;

      await withOrgContext(holiday.org_id, (tx) =>
        upsertOperationalTask(tx, {
          orgId: holiday.org_id,
          taskType: 'emergency_coverage_gap',
          title: `${dateKey} の時間外・緊急対応体制が未設定です`,
          description: `${holiday.name} の当番薬剤師または応援体制を確認してください。`,
          priority: 'urgent',
          dueDate: holiday.date,
          slaDueAt: holiday.date,
          relatedEntityType: 'business_holiday',
          relatedEntityId: `${holiday.site_id ?? 'org'}:${dateKey}`,
          dedupeKey: buildEmergencyCoverageGapTaskKey(dateKey, holiday.site_id),
          metadata: {
            holiday_name: holiday.name,
            site_id: holiday.site_id,
          },
        }),
      );
      processedCount += 1;
    }

    return { processedCount };
  });
}

export async function syncVisitSupportFeatureTasks() {
  return runJob('visit_support_feature_task_sync', async () => {
    const today = startOfDay();
    const sevenDaysFromNow = addDays(today, 7);
    const twoDaysFromNow = addDays(today, 2);

    const [activeCases, firstVisitDocs, openSelfReports, unresolvedInquiries, upcomingSchedules] =
      await Promise.all([
        prisma.careCase.findMany({
          where: {
            status: { in: ['assessment', 'active', 'on_hold'] },
          },
          select: {
            id: true,
            org_id: true,
            patient_id: true,
            primary_pharmacist_id: true,
            patient: {
              select: {
                name: true,
                contacts: {
                  select: {
                    relation: true,
                    is_emergency_contact: true,
                  },
                },
              },
            },
          },
        }),
        prisma.firstVisitDocument.findMany({
          select: {
            case_id: true,
          },
        }),
        prisma.patientSelfReport.findMany({
          where: {
            status: { in: ['submitted', 'triaged', 'converted_to_task'] },
          },
          select: {
            id: true,
            org_id: true,
            patient_id: true,
            subject: true,
            category: true,
            content: true,
            created_at: true,
          },
        }),
        prisma.inquiryRecord.findMany({
          where: {
            OR: [{ result: null }, { result: 'pending' }],
          },
          select: {
            id: true,
            org_id: true,
            reason: true,
            created_at: true,
            cycle: {
              select: {
                id: true,
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
              },
            },
          },
        }),
        prisma.visitSchedule.findMany({
          where: {
            scheduled_date: {
              gte: today,
              lte: sevenDaysFromNow,
            },
            schedule_status: {
              in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
            },
          },
          select: {
            id: true,
            org_id: true,
            pharmacist_id: true,
            site_id: true,
            scheduled_date: true,
            priority: true,
            schedule_status: true,
            preparation: {
              select: {
                offline_synced: true,
              },
            },
            case_: {
              select: {
                id: true,
                patient_id: true,
                patient: {
                  select: {
                    name: true,
                    residences: {
                      where: { is_primary: true },
                      take: 1,
                      select: {
                        building_id: true,
                        address: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);

    const firstVisitCaseIds = new Set(firstVisitDocs.map((item) => item.case_id));
    const patientCaseMap = new Map(activeCases.map((careCase) => [careCase.patient_id, careCase]));
    const taskSpecs: GeneratedTaskSpec[] = [];

    for (const careCase of activeCases) {
      const hasEmergencyContact = careCase.patient.contacts.some(
        (contact) => contact.is_emergency_contact || contact.relation === 'facility_staff',
      );
      const hasFirstVisitDoc = firstVisitCaseIds.has(careCase.id);
      if (hasEmergencyContact && hasFirstVisitDoc) continue;

      const dueAt = addDays(today, 1);
      const missingItems = [
        !hasEmergencyContact ? '緊急連絡先' : null,
        !hasFirstVisitDoc ? '初回文書' : null,
      ].filter((value): value is string => Boolean(value));

      taskSpecs.push({
        orgId: careCase.org_id,
        taskType: 'emergency_contact_review',
        dedupeKey: buildEmergencyContactReviewTaskKey(careCase.id),
        title: `${careCase.patient.name} の緊急連絡先・初回文書確認`,
        description: `${missingItems.join(' / ')} が不足しています。`,
        priority: 'high',
        assignedTo: careCase.primary_pharmacist_id ?? null,
        dueDate: dueAt,
        slaDueAt: dueAt,
        relatedEntityType: 'case',
        relatedEntityId: careCase.id,
        metadata: {
          case_id: careCase.id,
          patient_id: careCase.patient_id,
          patient_name: careCase.patient.name,
          missing_items: missingItems,
        },
      });
    }

    for (const report of openSelfReports) {
      if (
        !hasAnyKeyword([report.category, report.subject, report.content], DOSAGE_SUPPORT_KEYWORDS)
      ) {
        continue;
      }

      const careCase = patientCaseMap.get(report.patient_id);
      const dueAt = addDays(new Date(report.created_at), 1);

      taskSpecs.push({
        orgId: report.org_id,
        taskType: 'dosage_form_support',
        dedupeKey: buildDosageSupportTaskKey(report.id),
        title: `${careCase?.patient.name ?? '患者'} の剤形・服用支援確認`,
        description: `${report.subject} に対して剤形調整や一包化の検討が必要です。`,
        priority: 'high',
        assignedTo: careCase?.primary_pharmacist_id ?? null,
        dueDate: dueAt,
        slaDueAt: dueAt,
        relatedEntityType: 'patient_self_report',
        relatedEntityId: report.id,
        metadata: {
          patient_id: report.patient_id,
          case_id: careCase?.id ?? null,
          patient_name: careCase?.patient.name ?? null,
          report_subject: report.subject,
        },
      });
    }

    for (const inquiry of unresolvedInquiries) {
      const careCase = inquiry.cycle?.case_;
      if (!careCase) continue;

      const dueAt = addDays(new Date(inquiry.created_at), 1);
      taskSpecs.push({
        orgId: inquiry.org_id,
        taskType: 'inquiry_workbench',
        dedupeKey: buildInquiryWorkbenchTaskKey(inquiry.id),
        title: `${careCase.patient.name} の疑義照会確認`,
        description: inquiry.reason || '未解決の疑義照会または処方提案があります。',
        priority: 'high',
        assignedTo: careCase.primary_pharmacist_id ?? null,
        dueDate: dueAt,
        slaDueAt: dueAt,
        relatedEntityType: 'inquiry_record',
        relatedEntityId: inquiry.id,
        metadata: {
          cycle_id: inquiry.cycle.id,
          case_id: careCase.id,
          patient_id: careCase.patient_id,
          patient_name: careCase.patient.name,
        },
      });
    }

    const facilityGroups = new Map<
      string,
      {
        orgId: string;
        dateKey: string;
        pharmacistId: string;
        groupLabel: string;
        patientNames: string[];
        dueDate: Date;
      }
    >();

    for (const schedule of upcomingSchedules) {
      const residence = schedule.case_.patient.residences[0] ?? null;
      const locationKey = deriveFacilityLabel(residence ?? null);
      if (!locationKey) continue;

      const dateKey = schedule.scheduled_date.toISOString().slice(0, 10);
      const groupId = [
        dateKey,
        schedule.site_id ?? 'site:none',
        schedule.pharmacist_id,
        locationKey,
      ].join(':');
      const existing = facilityGroups.get(groupId);
      if (existing) {
        existing.patientNames.push(schedule.case_.patient.name);
        continue;
      }

      facilityGroups.set(groupId, {
        orgId: schedule.org_id,
        dateKey,
        pharmacistId: schedule.pharmacist_id,
        groupLabel: locationKey,
        patientNames: [schedule.case_.patient.name],
        dueDate: schedule.scheduled_date,
      });
    }

    for (const [groupId, group] of facilityGroups) {
      if (group.patientNames.length <= 1) continue;
      taskSpecs.push({
        orgId: group.orgId,
        taskType: 'facility_batch_tracker',
        dedupeKey: buildFacilityBatchTrackerTaskKey(groupId),
        title: `${group.dateKey} の施設訪問バッチ確認`,
        description: `${group.patientNames.join('、')} を同一ルートで束ねられる可能性があります。`,
        priority: group.patientNames.length >= 3 ? 'high' : 'normal',
        assignedTo: group.pharmacistId,
        dueDate: group.dueDate,
        slaDueAt: group.dueDate,
        relatedEntityType: 'visit_schedule_group',
        relatedEntityId: groupId,
        metadata: {
          facility_label: group.groupLabel,
          patient_names: group.patientNames,
          patient_count: group.patientNames.length,
        },
      });
    }

    for (const schedule of upcomingSchedules) {
      const needsOfflineSync =
        schedule.scheduled_date <= twoDaysFromNow && !schedule.preparation?.offline_synced;
      if (!needsOfflineSync) continue;

      taskSpecs.push({
        orgId: schedule.org_id,
        taskType: 'mobile_visit_mode',
        dedupeKey: buildMobileVisitModeTaskKey(schedule.id),
        title: `${schedule.case_.patient.name} のオフライン同期確認`,
        description: '訪問前に端末同期とモバイル準備を完了してください。',
        priority:
          schedule.priority === 'emergency' || schedule.priority === 'urgent' ? 'urgent' : 'high',
        assignedTo: schedule.pharmacist_id,
        dueDate: schedule.scheduled_date,
        slaDueAt: schedule.scheduled_date,
        relatedEntityType: 'visit_schedule',
        relatedEntityId: schedule.id,
        metadata: {
          patient_id: schedule.case_.patient_id,
          case_id: schedule.case_.id,
          patient_name: schedule.case_.patient.name,
          schedule_status: schedule.schedule_status,
        },
      });
    }

    await syncGeneratedOperationalTasks(taskSpecs, [
      'emergency_contact_review',
      'dosage_form_support',
      'inquiry_workbench',
      'facility_batch_tracker',
      'mobile_visit_mode',
    ]);

    return { processedCount: taskSpecs.length };
  });
}

export async function checkFacilityStandardExpiry() {
  return runJob('facility_standard_expiry_check', async () => {
    const now = new Date();
    const in60Days = addDays(now, 60);

    const expiring = await prisma.facilityStandardRegistration.findMany({
      where: {
        expiry_date: { lte: in60Days, gte: now },
      },
      include: {
        site: true,
      },
    });

    const thresholds = [
      { days: 7, priority: 'urgent' as const, label: '7日以内' },
      { days: 30, priority: 'high' as const, label: '30日以内' },
      { days: 60, priority: 'normal' as const, label: '60日以内' },
    ];

    const taskSpecs: GeneratedTaskSpec[] = [];
    let notificationCount = 0;

    for (const reg of expiring) {
      if (!reg.expiry_date) continue;
      const daysUntilExpiry = Math.ceil(
        (reg.expiry_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const threshold = thresholds.find((t) => daysUntilExpiry <= t.days);
      if (!threshold) continue;

      // Find admin users for the org to notify
      const adminMemberships = await prisma.membership.findMany({
        where: { org_id: reg.org_id, role: { in: ['admin', 'owner'] }, is_active: true },
        select: { user_id: true },
      });
      const admins = adminMemberships.map((m) => ({ id: m.user_id }));

      for (const admin of admins) {
        await prisma.notification.create({
          data: {
            org_id: reg.org_id,
            user_id: admin.id,
            type: threshold.priority === 'urgent' ? 'urgent' : 'business',
            title: '施設基準の有効期限',
            message: `${reg.standard_type}（${reg.site?.name ?? '不明'}）の有効期限が${threshold.label}に迫っています。`,
            link: '/admin/facility-standards',
            dedupe_key: `facility-std-expiry:${reg.id}:${threshold.days}`,
          },
        });
        notificationCount++;
      }

      taskSpecs.push({
        orgId: reg.org_id,
        taskType: 'facility_standard_expiry',
        dedupeKey: buildFacilityStandardExpiryTaskKey(reg.id),
        title: `施設基準更新: ${reg.standard_type}`,
        description: `${reg.site?.name ?? '不明'} の ${reg.standard_type} が ${reg.expiry_date.toISOString().slice(0, 10)} に期限切れ`,
        priority: threshold.priority,
        dueDate: reg.expiry_date,
        relatedEntityType: 'facility_standard_registration',
        relatedEntityId: reg.id,
      });
    }

    if (taskSpecs.length > 0) {
      await syncGeneratedOperationalTasks(taskSpecs, ['facility_standard_expiry']);
    }

    return { processedCount: notificationCount };
  });
}

// ---------------------------------------------------------------------------
// Pharmacist credential expiry check
// ---------------------------------------------------------------------------
export async function checkCredentialExpiry() {
  return runJob('credential_expiry_check', async () => {
    const now = new Date();
    const in90Days = addDays(now, 90);

    const expiring = await prisma.pharmacistCredential.findMany({
      where: {
        expiry_date: { lte: in90Days, gte: now },
      },
      include: {
        user: { select: { id: true, org_id: true, name: true } },
      },
    });

    const thresholds = [
      { days: 30, priority: 'urgent' as const, label: '30日以内' },
      { days: 90, priority: 'high' as const, label: '90日以内' },
    ];

    let notificationCount = 0;

    for (const cred of expiring) {
      if (!cred.expiry_date) continue;
      const daysUntilExpiry = Math.ceil(
        (cred.expiry_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const threshold = thresholds.find((t) => daysUntilExpiry <= t.days);
      if (!threshold) continue;

      // Notify the pharmacist themselves
      await prisma.notification.create({
        data: {
          org_id: cred.org_id,
          user_id: cred.user_id,
          type: threshold.priority === 'urgent' ? 'urgent' : 'reminder',
          title: '資格・認定の有効期限',
          message: `${cred.certification_type} の有効期限が${threshold.label}に迫っています。更新手続きを行ってください。`,
          link: '/settings/credentials',
          dedupe_key: `credential-expiry:${cred.id}:${threshold.days}`,
        },
      });
      notificationCount++;

      // Also notify admins
      const adminMemberships = await prisma.membership.findMany({
        where: { org_id: cred.org_id, role: { in: ['admin', 'owner'] }, is_active: true },
        select: { user_id: true },
      });
      const admins = adminMemberships.map((m) => ({ id: m.user_id }));

      for (const admin of admins) {
        if (admin.id === cred.user_id) continue; // skip if admin is the pharmacist
        await prisma.notification.create({
          data: {
            org_id: cred.org_id,
            user_id: admin.id,
            type: 'business',
            title: '薬剤師資格の有効期限',
            message: `${cred.user?.name ?? '薬剤師'} の ${cred.certification_type} が${threshold.label}に期限切れ。`,
            link: '/admin/staff',
            dedupe_key: `credential-expiry-admin:${cred.id}:${admin.id}:${threshold.days}`,
          },
        });
        notificationCount++;
      }
    }

    return { processedCount: notificationCount };
  });
}

export async function checkConsentExpiry() {
  return runJob('consent_expiry_check', async () => {
    const now = new Date();
    const in30Days = addDays(now, 30);

    const expiring = await prisma.consentRecord.findMany({
      where: {
        is_active: true,
        expiry_date: { lte: in30Days, gte: now },
      },
      include: {
        patient: { select: { id: true, name: true } },
      },
    });

    const taskSpecs: GeneratedTaskSpec[] = [];
    let notificationCount = 0;

    for (const consent of expiring) {
      if (!consent.expiry_date) continue;
      const daysUntilExpiry = Math.ceil(
        (consent.expiry_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const priority = daysUntilExpiry <= 7 ? ('urgent' as const) : ('high' as const);
      const patientName = consent.patient?.name ?? '不明';

      // Find the primary pharmacist from the patient's active case
      const activeCase = consent.case_id
        ? await prisma.careCase.findFirst({
            where: { id: consent.case_id, status: { notIn: ['discharged', 'terminated'] } },
            select: { primary_pharmacist_id: true },
          })
        : await prisma.careCase.findFirst({
            where: {
              patient_id: consent.patient_id,
              status: { notIn: ['discharged', 'terminated'] },
            },
            select: { primary_pharmacist_id: true },
          });

      const pharmacistId = activeCase?.primary_pharmacist_id;
      if (pharmacistId) {
        await prisma.notification.create({
          data: {
            org_id: consent.org_id,
            user_id: pharmacistId,
            type: priority === 'urgent' ? 'urgent' : 'business',
            title: '同意書の有効期限',
            message: `${patientName} さんの ${consent.consent_type} 同意が ${consent.expiry_date.toISOString().slice(0, 10)} に期限切れ。再取得が必要です。`,
            link: `/patients/${consent.patient_id}`,
            dedupe_key: `consent-expiry:${consent.id}:${daysUntilExpiry <= 7 ? '7' : '30'}`,
          },
        });
        notificationCount++;
      }

      taskSpecs.push({
        orgId: consent.org_id,
        taskType: 'consent_expiry',
        dedupeKey: buildConsentExpiryTaskKey(consent.id),
        title: `同意書更新: ${patientName}`,
        description: `${consent.consent_type} の同意が ${consent.expiry_date.toISOString().slice(0, 10)} に期限切れ`,
        priority,
        assignedTo: pharmacistId,
        dueDate: consent.expiry_date,
        relatedEntityType: 'consent_record',
        relatedEntityId: consent.id,
      });
    }

    if (taskSpecs.length > 0) {
      await syncGeneratedOperationalTasks(taskSpecs, ['consent_expiry']);
    }

    return { processedCount: notificationCount };
  });
}

export async function trackAllOrgPatientStatuses() {
  return runJob('patient_status_tracking', async () => {
    const orgs = await prisma.organization.findMany({
      select: { id: true },
    });

    let totalChanged = 0;
    for (const org of orgs) {
      const result = await trackPatientStatusChanges(prisma, {
        orgId: org.id,
        actorId: 'system',
      });
      totalChanged += result.changed.length;
    }

    return { processedCount: totalChanged };
  });
}

export async function cleanupAbandonedQrDrafts() {
  return runJob('cleanup_abandoned_qr_drafts', async () => {
    const cutoff = subHours(new Date(), 24);
    const abandonedDrafts = await prisma.qrScanDraft.findMany({
      where: {
        status: 'pending',
        created_at: { lt: cutoff },
      },
      select: { id: true },
    });
    const abandonedDraftIds = abandonedDrafts.map((draft) => draft.id);
    if (abandonedDraftIds.length === 0) return { processedCount: 0 };

    const result = await prisma.qrScanDraft.updateMany({
      where: {
        id: { in: abandonedDraftIds },
      },
      data: {
        status: 'discarded',
        raw_qr_texts: [],
        qr_payload_hash: null,
        parsed_data: {
          discarded: true,
          discarded_by: 'cleanup_abandoned_qr_drafts',
          discarded_at: new Date().toISOString(),
        },
        parse_errors: Prisma.JsonNull,
        auto_completed: Prisma.JsonNull,
        expected_qr_count: null,
      },
    });
    await prisma.jahisSupplementalRecord.deleteMany({
      where: {
        qr_draft_id: { in: abandonedDraftIds },
        prescription_intake_id: null,
      },
    });
    if (result.count > 0) {
      logger.info('[daily] discarded abandoned QR scan drafts', { count: result.count });
    }
    return { processedCount: result.count };
  });
}

export async function cleanupTerminalQrDraftPayloads() {
  return runJob('cleanup_terminal_qr_draft_payloads', async () => {
    const scrubbedAt = new Date().toISOString();
    const result = await prisma.qrScanDraft.updateMany({
      where: {
        status: { in: ['confirmed', 'discarded'] },
      },
      data: {
        raw_qr_texts: [],
        qr_payload_hash: null,
        parsed_data: {
          scrubbed: true,
          scrubbed_by: 'cleanup_terminal_qr_draft_payloads',
          scrubbed_at: scrubbedAt,
        },
        parse_errors: Prisma.JsonNull,
        auto_completed: Prisma.JsonNull,
        expected_qr_count: null,
      },
    });

    if (result.count > 0) {
      logger.info('[daily] scrubbed terminal QR scan draft payloads', { count: result.count });
    }

    return { processedCount: result.count };
  });
}

export async function runDailyOperations() {
  return runJob('daily', async () => {
    const settled = await Promise.allSettled([
      checkMedicationDeadlines(),
      checkRefillPrescriptions(),
      checkPcaPumpRentalOverdues(),
      checkPcaPumpReturnInspectionPending(),
      checkIntakeToVisitLinkage(),
      checkPrescriptionExpiry(),
      checkVisitRecordRetention(),
      checkPrescriptionOriginalRetention(),
      generateVisitDemands(),
      checkManagementPlanReviews(),
      checkCallbackFollowups(),
      checkResidenceGeocodeQuality(),
      checkPreparationBacklog(),
      checkInitialHomeVisitAssessmentBacklog(),
      generateBillingEvidenceDaily(),
      checkSelfReportFollowups(),
      checkCommunityFollowups(),
      checkConferenceMeetingReminders(),
      checkReportDeliveryBacklog(),
      checkCarryItemReadiness(),
      checkEmergencyCoverageGaps(),
      syncVisitSupportFeatureTasks(),
      checkFacilityStandardExpiry(),
      checkCredentialExpiry(),
      checkConsentExpiry(),
      trackAllOrgPatientStatuses(),
      cleanupAbandonedQrDrafts(),
      cleanupTerminalQrDraftPayloads(),
      checkDrugMasterFreshness(),
    ]);

    let processedCount = 0;
    const errors: string[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        processedCount += result.value.processedCount;
        if ('errors' in result.value && result.value.errors) {
          errors.push(...result.value.errors);
        }
      } else {
        errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    }

    return { processedCount, errors };
  });
}
