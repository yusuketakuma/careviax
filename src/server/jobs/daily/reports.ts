import { addDays } from 'date-fns';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from '../runner';
import { buildReportDeliveryTaskKey } from '../daily-helpers';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { queueOverdueReportResponseReminders } from '@/server/services/report-reminders';
import { listOrganizationIds } from '../organization-iteration';

export async function checkReportDeliveryBacklog() {
  return runJob('report_delivery_backlog_check', async () => {
    const orgIds = await listOrganizationIds(prisma);
    let processedCount = 0;
    let queuedResponseReminders = 0;

    for (const orgId of orgIds) {
      const reports = await withOrgContext(orgId, (tx) =>
        tx.careReport.findMany({
          where: {
            org_id: orgId,
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
        }),
      );

      processedCount += reports.length;
      for (const report of reports) {
        const dueAt = addDays(new Date(report.updated_at), 1);
        await withOrgContext(orgId, async (tx) => {
          await upsertOperationalTask(tx, {
            orgId,
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

      const result = await withOrgContext(orgId, (tx) =>
        queueOverdueReportResponseReminders(tx, orgId),
      );
      queuedResponseReminders += result.queued_count;
    }

    return { processedCount, queuedResponseReminders };
  });
}
