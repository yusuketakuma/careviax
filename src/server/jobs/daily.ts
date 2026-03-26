import { addDays } from 'date-fns';
import { prisma } from '@/lib/db';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from './runner';
import { generateVisitScheduleProposalDrafts } from '@/server/services/visit-schedule-planner';
import {
  scheduleManagementPlanReviewAlert,
  formatVisitWorkflowGateIssues,
  type VisitWorkflowGateIssue,
} from '@/server/services/management-plans';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { upsertBillingEvidenceForVisit } from '@/server/services/billing-evidence';

function buildVisitDemandTaskKey(cycleId: string) {
  return `visit-demand:${cycleId}`;
}

function buildGeocodeTaskKey(patientId: string) {
  return `geocode-review:${patientId}`;
}

function buildPreparationTaskKey(scheduleId: string) {
  return `visit-preparation:${scheduleId}`;
}

function buildContactTaskKey(proposalId: string) {
  return `visit-contact-followup:${proposalId}`;
}

function buildIntakeLinkageTaskKey(intakeId: string) {
  return `visit-intake-linkage:${intakeId}`;
}

function buildSelfReportTaskKey(reportId: string) {
  return `patient-self-report:${reportId}`;
}

function buildCommunityFollowupTaskKey(activityId: string) {
  return `community-activity-followup:${activityId}`;
}

function buildReportDeliveryTaskKey(reportId: string) {
  return `report-delivery-followup:${reportId}`;
}

function buildCarryItemReviewTaskKey(scheduleId: string) {
  return `visit-carry-item-review:${scheduleId}`;
}

function buildEmergencyCoverageGapTaskKey(dateKey: string, siteId: string | null) {
  return `emergency-coverage-gap:${dateKey}:${siteId ?? 'org'}`;
}

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
        })
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
        })
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
      if (
        intake.cycle?.visit_schedules.length ||
        intake.cycle?.visit_schedule_proposals.length
      ) {
        continue;
      }

      const dueDate =
        intake.refill_next_dispense_date ??
        intake.prescription_expiry_date ??
        addDays(today, 1);
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
    });

    return { processedCount: expiring.length };
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
        const drafts = await generateVisitScheduleProposalDrafts({
          orgId: cycle.org_id,
          caseId: cycle.case_id,
          visitType: 'regular',
          priority: visitDeadline <= addDays(startOfToday, 3) ? 'urgent' : 'normal',
          candidateCount: 3,
          startDate: addDays(startOfToday, 1),
        });

        if (drafts.length === 0) continue;

        await withOrgContext(cycle.org_id, async (tx) => {
          await Promise.all(
            drafts.map((draft) =>
              tx.visitScheduleProposal.create({
                data: draft,
              })
            )
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
        if (error instanceof Error && error.message.startsWith('VISIT_WORKFLOW_GATE:')) {
          const issues = error.message
            .replace('VISIT_WORKFLOW_GATE:', '')
            .split(',')
            .filter(Boolean) as VisitWorkflowGateIssue[];

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

        errors.push(
          error instanceof Error ? error.message : `cycle:${cycle.id}:unknown_error`
        );
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
        })
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
      await withOrgContext(log.org_id, (tx) =>
        upsertOperationalTask(tx, {
          orgId: log.org_id,
          taskType: 'visit_contact_followup',
          title: '患者への再架電が必要です',
          description: log.note ?? '折り返し期限を過ぎています。',
          priority: 'high',
          assignedTo: log.proposal.proposed_pharmacist_id,
          dueDate: log.callback_due_at,
          slaDueAt: log.callback_due_at,
          relatedEntityType: 'visit_schedule_proposal',
          relatedEntityId: log.proposal_id,
          dedupeKey: buildContactTaskKey(log.proposal_id),
          metadata: {
            case_id: log.case_id,
            patient_id: log.patient_id,
          },
        })
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
        OR: [
          { lat: null },
          { lng: null },
          { geocode_status: { not: 'verified' } },
        ],
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
        })
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
        })
      );
    }

    return { processedCount: schedules.length };
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
        ...(existingVisitRecordIds.length > 0
          ? { id: { notIn: existingVisitRecordIds } }
          : {}),
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
        })
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
      const dueAt = report.requested_callback ? addDays(new Date(report.created_at), 1) : addDays(new Date(report.created_at), 2);

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
          priority: activity.referrals_generated && activity.referrals_generated > 0 ? 'high' : 'normal',
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
        })
      );
    }

    return { processedCount: activities.length };
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

    for (const report of reports) {
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

    return { processedCount: reports.length };
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
        })
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
      shifts.map((shift) => `${shift.org_id}:${shift.site_id ?? 'org'}:${shift.date.toISOString().slice(0, 10)}`)
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
        })
      );
      processedCount += 1;
    }

    return { processedCount };
  });
}

export async function runDailyOperations() {
  return runJob('daily', async () => {
    const results = await Promise.all([
      checkMedicationDeadlines(),
      checkRefillPrescriptions(),
      checkIntakeToVisitLinkage(),
      checkPrescriptionExpiry(),
      generateVisitDemands(),
      checkManagementPlanReviews(),
      checkCallbackFollowups(),
      checkResidenceGeocodeQuality(),
      checkPreparationBacklog(),
      generateBillingEvidenceDaily(),
      checkSelfReportFollowups(),
      checkCommunityFollowups(),
      checkReportDeliveryBacklog(),
      checkCarryItemReadiness(),
      checkEmergencyCoverageGaps(),
    ]);

    return {
      processedCount: results.reduce((total, result) => total + result.processedCount, 0),
      errors: results.flatMap((result) => result.errors ?? []),
    };
  });
}
