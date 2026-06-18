import { addDays } from 'date-fns';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from '../runner';
import { buildReportDeliveryTaskKey } from '../daily-helpers';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { queueOverdueReportResponseReminders } from '@/server/services/report-reminders';

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
