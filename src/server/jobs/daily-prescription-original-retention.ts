import { addDays, addYears } from 'date-fns';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { buildPatientHref } from '@/lib/patient/navigation';
import {
  buildFaxOriginalFollowupTaskKey,
  buildPrescriptionOriginalRetentionTaskKey,
  formatDateKey,
  startOfDay,
  syncGeneratedOperationalTasks,
  type GeneratedTaskSpec,
} from './daily-helpers';
import { runJob } from './runner';

async function createManyNotifications(notifications: Prisma.NotificationCreateManyInput[]) {
  if (notifications.length === 0) return { count: 0 };

  return prisma.notification.createMany({
    data: notifications,
    skipDuplicates: true,
  });
}

export async function checkPrescriptionOriginalRetention() {
  return runJob('prescription_original_retention_check', async () => {
    const now = startOfDay(new Date());
    const in30Days = startOfDay(addDays(now, 30));
    const expiringFrom = startOfDay(addYears(now, -5));
    const expiringTo = startOfDay(addYears(in30Days, -5));
    const faxFollowupThreshold = startOfDay(addDays(now, -3));

    // cross-org: by-design。システム全体 cron のため原本保存期限が近い処方箋を全org横断で走査する。
    // 通知(notification)は各行の intake.org_id を付与して発行し、対象者は org 毎に bucket 化した
    // adminsByOrg.get(intake.org_id) と同一 org の primary_pharmacist_id に限定するため org 境界を跨がない。
    const expiring = await prisma.prescriptionIntake.findMany({
      where: {
        source_type: { in: ['paper', 'fax'] },
        NOT: { original_document_url: null },
        prescribed_date: {
          gte: expiringFrom,
          lte: expiringTo,
        },
      },
      include: {
        cycle: {
          include: {
            case_: {
              select: {
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
    });
    const overdueFaxOriginals = await prisma.prescriptionIntake.findMany({
      where: {
        source_type: 'fax',
        original_collected_at: null,
        created_at: {
          lt: faxFollowupThreshold,
        },
      },
      include: {
        cycle: {
          include: {
            case_: {
              select: {
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
    });

    if (expiring.length === 0 && overdueFaxOriginals.length === 0) {
      await syncGeneratedOperationalTasks(
        [],
        ['prescription_original_retention', 'fax_original_followup'],
      );
      return { processedCount: 0 };
    }

    const orgIds = Array.from(
      new Set([...expiring, ...overdueFaxOriginals].map((intake) => intake.org_id)),
    );
    const admins = await prisma.membership.findMany({
      where: {
        org_id: { in: orgIds },
        role: { in: ['admin', 'owner'] },
        is_active: true,
      },
      select: {
        org_id: true,
        user_id: true,
      },
    });
    const adminsByOrg = new Map<string, string[]>();
    for (const admin of admins) {
      const bucket = adminsByOrg.get(admin.org_id) ?? [];
      bucket.push(admin.user_id);
      adminsByOrg.set(admin.org_id, bucket);
    }

    const taskSpecs: GeneratedTaskSpec[] = [];
    const notifications: Prisma.NotificationCreateManyInput[] = [];

    for (const intake of expiring) {
      const retentionUntil = startOfDay(addYears(intake.prescribed_date, 5));
      const daysUntilExpiry = Math.ceil(
        (retentionUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const priority = daysUntilExpiry <= 7 ? ('urgent' as const) : ('high' as const);
      const thresholdLabel = daysUntilExpiry <= 7 ? '7日以内' : '30日以内';
      const patientName =
        intake.cycle?.case_?.patient.name ?? intake.cycle?.case_?.patient_id ?? '患者不明';
      const notificationTargets = new Set<string>(adminsByOrg.get(intake.org_id) ?? []);
      if (intake.cycle?.case_?.primary_pharmacist_id) {
        notificationTargets.add(intake.cycle.case_.primary_pharmacist_id);
      }

      for (const userId of notificationTargets) {
        notifications.push({
          org_id: intake.org_id,
          user_id: userId,
          type: priority === 'urgent' ? 'urgent' : 'business',
          title: '処方箋原本スキャンの保存期限',
          message: `${patientName} さんの原本スキャンが${thresholdLabel}に5年保存期限を迎えます。保全状況を確認してください。`,
          link: '/workflow',
          dedupe_key: `prescription-original-retention:${intake.id}:${userId}:${priority}`,
        });
      }

      taskSpecs.push({
        orgId: intake.org_id,
        taskType: 'prescription_original_retention',
        dedupeKey: buildPrescriptionOriginalRetentionTaskKey(intake.id),
        title: `処方箋原本保存期限確認: ${patientName}`,
        description: `原本スキャンが ${formatDateKey(retentionUntil)} に5年保存期限を迎えます。Object Lock と保全状況を確認してください。`,
        priority,
        assignedTo: intake.cycle?.case_?.primary_pharmacist_id ?? null,
        dueDate: retentionUntil,
        relatedEntityType: 'prescription_intake',
        relatedEntityId: intake.id,
        metadata: {
          patient_id: intake.cycle?.case_?.patient_id ?? null,
          source_type: intake.source_type,
          retention_until: retentionUntil.toISOString(),
        } satisfies Prisma.InputJsonValue,
      });
    }

    for (const intake of overdueFaxOriginals) {
      const patientName =
        intake.cycle?.case_?.patient.name ?? intake.cycle?.case_?.patient_id ?? '患者不明';
      const notificationTargets = new Set<string>(adminsByOrg.get(intake.org_id) ?? []);
      if (intake.cycle?.case_?.primary_pharmacist_id) {
        notificationTargets.add(intake.cycle.case_.primary_pharmacist_id);
      }
      const overdueDays = Math.max(
        1,
        Math.ceil(
          (now.getTime() - startOfDay(intake.created_at).getTime()) / (1000 * 60 * 60 * 24),
        ),
      );
      const priority = overdueDays >= 5 ? ('urgent' as const) : ('high' as const);
      const dueDate = startOfDay(addDays(intake.created_at, 3));
      const patientId = intake.cycle?.case_?.patient_id ?? intake.cycle?.patient_id ?? null;
      const patientHref = patientId ? buildPatientHref(patientId, '/prescriptions') : '/workflow';

      for (const userId of notificationTargets) {
        notifications.push({
          org_id: intake.org_id,
          user_id: userId,
          type: priority === 'urgent' ? 'urgent' : 'business',
          title: 'FAX処方箋の原本未回収',
          message: `${patientName} さんの FAX 処方箋は受付から${overdueDays}日経過しています。訪問時の原本回収を確認してください。`,
          link: patientHref,
          dedupe_key: `fax-original-followup:${intake.id}:${userId}:${priority}`,
        });
      }

      taskSpecs.push({
        orgId: intake.org_id,
        taskType: 'fax_original_followup',
        dedupeKey: buildFaxOriginalFollowupTaskKey(intake.id),
        title: `FAX原本回収確認: ${patientName}`,
        description: `FAX受付から${overdueDays}日経過しています。訪問時に原本を回収し、回収日時を記録してください。`,
        priority,
        assignedTo: intake.cycle?.case_?.primary_pharmacist_id ?? null,
        dueDate,
        slaDueAt: dueDate,
        relatedEntityType: 'prescription_intake',
        relatedEntityId: intake.id,
        metadata: {
          patient_id: patientId,
          patient_name: patientName,
          action_href: patientHref,
          action_label: '原本回収を記録',
          fax_received_at: intake.created_at.toISOString(),
          overdue_days: overdueDays,
        } satisfies Prisma.InputJsonValue,
      });
    }

    let notificationCount = 0;
    if (taskSpecs.length > 0) {
      const notificationResult = await createManyNotifications(notifications);
      notificationCount = notificationResult.count;
      await syncGeneratedOperationalTasks(taskSpecs, [
        'prescription_original_retention',
        'fax_original_followup',
      ]);
    }

    return { processedCount: notificationCount };
  });
}
