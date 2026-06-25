/**
 * Patient Status Change Tracker
 *
 * Tracks changes in patient status icons and:
 * 1. Writes audit log entries when status changes
 * 2. Triggers notifications for critical status transitions
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { derivePatientStatusIcon, STATUS_ICON_CONFIG } from '@/lib/patient/status-icon';
import { buildPatientHref } from '@/lib/patient/navigation';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { listPatientRiskSummaries } from '@/server/services/patient-risk';
import type { PatientStatusIcon } from '@/types/dashboard-home';

type DbClient = typeof prisma | Prisma.TransactionClient;

// Status transitions that should trigger notifications
const NOTIFICATION_TRIGGERS: Array<{
  from: PatientStatusIcon[];
  to: PatientStatusIcon;
  severity: 'urgent' | 'high' | 'normal';
  titleTemplate: string;
}> = [
  {
    from: ['stable', 'attention', 'new', 'first_visit_soon'],
    to: 'urgent',
    severity: 'urgent',
    titleTemplate: '{patient_name}が要対応になりました',
  },
  {
    from: ['stable', 'attention', 'new', 'first_visit_soon'],
    to: 'overdue_visit',
    severity: 'high',
    titleTemplate: '{patient_name}の訪問が遅延しています',
  },
  {
    from: ['stable', 'attention', 'new', 'first_visit_soon', 'urgent'],
    to: 'no_contact',
    severity: 'high',
    titleTemplate: '{patient_name}に連絡がつきません',
  },
  {
    from: ['stable', 'attention', 'new', 'first_visit_soon', 'urgent'],
    to: 'hospitalized',
    severity: 'high',
    titleTemplate: '{patient_name}が入院しました',
  },
  {
    from: ['hospitalized'],
    to: 'discharged',
    severity: 'normal',
    titleTemplate: '{patient_name}が退院しました',
  },
  {
    from: ['stable', 'attention'],
    to: 'report_pending',
    severity: 'normal',
    titleTemplate: '{patient_name}の報告書が未提出です',
  },
];

function readPatientStatusIcon(value: unknown): PatientStatusIcon | null {
  switch (value) {
    case 'stable':
    case 'new':
    case 'first_visit_soon':
    case 'attention':
    case 'urgent':
    case 'overdue_visit':
    case 'report_pending':
    case 'medication_change':
    case 'hospitalized':
    case 'discharged':
    case 'no_contact':
    case 'paused':
      return value;
    default:
      return null;
  }
}

/**
 * Check all patients' status and log changes.
 * Intended to be called from the daily job or on-demand.
 */
export async function trackPatientStatusChanges(
  db: DbClient,
  args: {
    orgId: string;
    actorId: string;
  },
): Promise<{
  changed: Array<{
    patientId: string;
    patientName: string;
    from: PatientStatusIcon;
    to: PatientStatusIcon;
  }>;
  notifications: Array<{
    patientId: string;
    patientName: string;
    severity: string;
    title: string;
  }>;
}> {
  // Get current risk summaries for all patients
  const riskSummaries = await listPatientRiskSummaries(db as typeof prisma, {
    orgId: args.orgId,
    includeStable: true,
    limit: 500,
  });

  const patientIds = riskSummaries.map((p) => p.patient_id);
  if (patientIds.length === 0) {
    return { changed: [], notifications: [] };
  }

  // scheduled_date(@db.Date)比較用: ローカル日付の UTC 深夜
  const today = utcDateFromLocalKey(localDateKey());

  // Fetch supplemental data for status derivation
  const [cases, completedVisitCases, upcomingVisitCases, overdueVisitCases, recentCycles] =
    await Promise.all([
      db.careCase.findMany({
        where: {
          org_id: args.orgId,
          patient_id: { in: patientIds },
          status: { in: ['assessment', 'active', 'on_hold'] },
        },
        select: { patient_id: true, status: true },
        orderBy: { created_at: 'desc' },
      }),
      // 訪問の有無は「該当 case が条件を満たす訪問を 1 件でも持つか」という所属判定にしか
      // 使わない。visitSchedule を全件取得して JS で Set 化すると患者あたりの訪問件数に比例して
      // 行数が膨らむ(最大 500 患者 × daily job で数千行になり得る)。careCase 側の some(EXISTS)で
      // 患者単位の所属だけを問い合わせ、DB が返す行を該当 case のみ(<= 患者数)に絞る。
      db.careCase.findMany({
        where: {
          org_id: args.orgId,
          patient_id: { in: patientIds },
          visit_schedules: { some: { org_id: args.orgId, schedule_status: 'completed' } },
        },
        select: { patient_id: true },
      }),
      db.careCase.findMany({
        where: {
          org_id: args.orgId,
          patient_id: { in: patientIds },
          visit_schedules: {
            some: {
              org_id: args.orgId,
              scheduled_date: { gte: today },
              schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
            },
          },
        },
        select: { patient_id: true },
      }),
      db.careCase.findMany({
        where: {
          org_id: args.orgId,
          patient_id: { in: patientIds },
          visit_schedules: {
            some: {
              org_id: args.orgId,
              scheduled_date: { lt: today },
              schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
            },
          },
        },
        select: { patient_id: true },
      }),
      db.medicationCycle.findMany({
        where: {
          org_id: args.orgId,
          patient_id: { in: patientIds },
          overall_status: { notIn: ['cancelled'] },
        },
        orderBy: { created_at: 'desc' },
        select: {
          patient_id: true,
          exception_status: true,
          created_at: true,
          overall_status: true,
        },
      }),
    ]);

  // Build lookup sets
  const caseStatusMap = new Map<string, string>();
  for (const c of cases) {
    if (!caseStatusMap.has(c.patient_id)) caseStatusMap.set(c.patient_id, c.status);
  }
  const completedVisitSet = new Set(completedVisitCases.map((c) => c.patient_id));
  const nextVisitSet = new Set(upcomingVisitCases.map((c) => c.patient_id));
  const overdueSet = new Set(overdueVisitCases.map((c) => c.patient_id));
  const exceptionMap = new Map<string, string>();
  // created_at(DateTime, 実時刻)比較用: 従来どおりローカル深夜基準
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setHours(0, 0, 0, 0);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentMedChangeSet = new Set<string>();
  for (const rx of recentCycles) {
    if (rx.exception_status && !exceptionMap.has(rx.patient_id)) {
      exceptionMap.set(rx.patient_id, rx.exception_status);
    }
    if (rx.created_at >= sevenDaysAgo && rx.overall_status !== 'intake_received') {
      recentMedChangeSet.add(rx.patient_id);
    }
  }

  // Get previous status from the most recent audit log
  const previousStatusLogs = await db.auditLog.findMany({
    where: {
      org_id: args.orgId,
      action: 'patient_status_change',
      target_type: 'patient',
      target_id: { in: patientIds },
    },
    orderBy: { created_at: 'desc' },
    select: { target_id: true, changes: true },
  });

  const previousStatusMap = new Map<string, PatientStatusIcon>();
  for (const log of previousStatusLogs) {
    if (!previousStatusMap.has(log.target_id) && log.changes) {
      const previousStatus = readPatientStatusIcon(readJsonObject(log.changes)?.to);
      if (previousStatus) previousStatusMap.set(log.target_id, previousStatus);
    }
  }

  const changed: Array<{
    patientId: string;
    patientName: string;
    from: PatientStatusIcon;
    to: PatientStatusIcon;
  }> = [];
  const notifications: Array<{
    patientId: string;
    patientName: string;
    severity: string;
    title: string;
  }> = [];
  const notificationRows: Prisma.NotificationCreateManyInput[] = [];
  const statusChangeDateKey = localDateKey();

  for (const p of riskSummaries) {
    const currentStatus = derivePatientStatusIcon({
      score: p.score,
      level: p.level,
      open_tasks: p.open_tasks,
      pending_reports: p.pending_reports,
      hasCompletedVisit: completedVisitSet.has(p.patient_id),
      hasNextVisit: nextVisitSet.has(p.patient_id),
      hasOverdueVisit: overdueSet.has(p.patient_id),
      hasRecentMedChange: recentMedChangeSet.has(p.patient_id),
      hasUnresolvedSelfReports: p.unresolved_self_reports > 0,
      caseStatus: caseStatusMap.get(p.patient_id) ?? null,
      exceptionStatus: exceptionMap.get(p.patient_id) ?? null,
    });

    const previousStatus = previousStatusMap.get(p.patient_id) ?? 'stable';

    if (currentStatus !== previousStatus) {
      changed.push({
        patientId: p.patient_id,
        patientName: p.patient_name,
        from: previousStatus,
        to: currentStatus,
      });

      // Write audit log
      await createAuditLogEntry(
        db,
        { orgId: args.orgId, userId: args.actorId },
        {
          action: 'patient_status_change',
          targetType: 'patient',
          targetId: p.patient_id,
          changes: {
            from: previousStatus,
            from_label: STATUS_ICON_CONFIG[previousStatus].label,
            to: currentStatus,
            to_label: STATUS_ICON_CONFIG[currentStatus].label,
            score: p.score,
          },
        },
      );

      // Check notification triggers
      for (const trigger of NOTIFICATION_TRIGGERS) {
        if (trigger.to === currentStatus && trigger.from.includes(previousStatus)) {
          const title = trigger.titleTemplate.replace('{patient_name}', p.patient_name);
          notifications.push({
            patientId: p.patient_id,
            patientName: p.patient_name,
            severity: trigger.severity,
            title,
          });

          notificationRows.push({
            org_id: args.orgId,
            user_id: args.actorId,
            event_type: `patient_status_${currentStatus}`,
            type: trigger.severity === 'urgent' ? 'urgent' : 'business',
            title,
            message: `${STATUS_ICON_CONFIG[previousStatus].label} → ${STATUS_ICON_CONFIG[currentStatus].label}`,
            link: buildPatientHref(p.patient_id),
            is_read: false,
            dedupe_key: `patient-status:${p.patient_id}:${previousStatus}:${currentStatus}:${statusChangeDateKey}`,
          });
        }
      }
    }
  }

  if (notificationRows.length > 0) {
    await db.notification.createMany({
      data: notificationRows,
      skipDuplicates: true,
    });
  }

  return { changed, notifications };
}
