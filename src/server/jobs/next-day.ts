import { subDays } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { formatDateKey } from '@/lib/date-key';
import { runJob } from './runner';

function startOfDay(value: Date) {
  const normalized = new Date(value);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function addDays(value: Date, days: number) {
  const normalized = new Date(value);
  normalized.setDate(normalized.getDate() + days);
  return normalized;
}

function isWeekend(value: Date) {
  const day = value.getDay();
  return day === 0 || day === 6;
}

function resolveNextBusinessDay(visitDate: Date, holidayKeys: Set<string>, orgId: string) {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDays(startOfDay(visitDate), offset);
    if (isWeekend(candidate)) continue;
    if (holidayKeys.has(`${orgId}:${formatDateKey(candidate)}`)) continue;
    return candidate;
  }
  return addDays(startOfDay(visitDate), 1);
}

/**
 * Check for visit records that have been created but where
 * the corresponding CareReport or DeliveryRecord has not been sent.
 * Notifies the responsible pharmacist to complete the reporting workflow.
 */
export async function checkUnsentReports() {
  return runJob('unsent_report_check', async () => {
    const today = startOfDay(new Date());
    const searchStart = subDays(today, 7);
    const holidaySearchEnd = addDays(today, 7);

    const visitRecords = await prisma.visitRecord.findMany({
      where: {
        visit_date: { gte: searchStart, lt: today },
        outcome_status: 'completed',
      },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        pharmacist_id: true,
        schedule_id: true,
        visit_date: true,
      },
    });

    if (visitRecords.length === 0) {
      return { processedCount: 0 };
    }

    const orgIds = Array.from(new Set(visitRecords.map((vr) => vr.org_id)));
    const holidays =
      orgIds.length === 0
        ? []
        : await prisma.businessHoliday.findMany({
            where: {
              org_id: { in: orgIds },
              site_id: null,
              is_closed: true,
              date: { gte: searchStart, lte: holidaySearchEnd },
            },
            select: {
              org_id: true,
              date: true,
            },
          });
    const holidayKeys = new Set(
      holidays.map((holiday) => `${holiday.org_id}:${formatDateKey(holiday.date)}`),
    );

    const visitRecordIds = visitRecords.map((vr) => vr.id);

    // Find CareReports already linked to these visit records
    const existingReports = await prisma.careReport.findMany({
      where: {
        visit_record_id: { in: visitRecordIds },
        status: { in: ['sent', 'confirmed'] },
      },
      select: { visit_record_id: true },
    });
    const reportedVisitIds = new Set(existingReports.map((r) => r.visit_record_id).filter(Boolean));

    const dueUnreported = visitRecords.filter((vr) => {
      if (reportedVisitIds.has(vr.id)) return false;
      const nextBusinessDay = resolveNextBusinessDay(vr.visit_date, holidayKeys, vr.org_id);
      return nextBusinessDay <= today;
    });

    const notifications: Prisma.NotificationCreateManyInput[] = [];
    for (const vr of dueUnreported) {
      notifications.push({
        org_id: vr.org_id,
        user_id: vr.pharmacist_id,
        type: 'reminder',
        title: '報告書未送付',
        message:
          '訪問記録に対する報告書（居宅療養管理指導報告書等）が未送付です。作成・送付を行ってください。',
        link: `/patients/${vr.patient_id}/reports`,
        dedupe_key: `unsent-report:${vr.id}`,
      });
    }

    const notificationResult =
      notifications.length === 0
        ? { count: 0 }
        : await prisma.notification.createMany({
            data: notifications,
            skipDuplicates: true,
          });

    return {
      processedCount: notificationResult.count,
      overdueVisitRecordIds: dueUnreported.map((vr) => vr.id),
    };
  });
}

export async function runNextDayOperations() {
  return runJob('next-day', async () => {
    const results = await Promise.all([checkUnsentReports()]);

    return {
      processedCount: results.reduce((total, r) => total + r.processedCount, 0),
      errors: results.flatMap((r) => ('errors' in r ? (r.errors ?? []) : [])),
    };
  });
}
