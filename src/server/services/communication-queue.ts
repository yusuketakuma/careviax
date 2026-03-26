import { addDays } from 'date-fns';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

type DbClient = typeof prisma | Prisma.TransactionClient;
type QueuePriority = 'urgent' | 'high' | 'normal';

export type CommunicationQueueItem = {
  id: string;
  queue_type: 'self_report' | 'callback' | 'request' | 'delivery' | 'external_share';
  title: string;
  summary: string;
  channel: string;
  status: string;
  priority: QueuePriority;
  patient_id: string | null;
  patient_name: string | null;
  due_at: string | null;
  action_href: string;
  action_label: string;
};

export type CommunicationQueueOverview = {
  summary: {
    pending_count: number;
    overdue_count: number;
    self_reports: number;
    callback_followups: number;
    open_requests: number;
    delivery_backlog: number;
    expiring_external_shares: number;
  };
  items: CommunicationQueueItem[];
};

function priorityRank(priority: QueuePriority) {
  switch (priority) {
    case 'urgent':
      return 0;
    case 'high':
      return 1;
    default:
      return 2;
  }
}

function isoOrNull(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function sortItems(left: CommunicationQueueItem, right: CommunicationQueueItem) {
  const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDelta !== 0) return priorityDelta;

  if (left.due_at && right.due_at) {
    return new Date(left.due_at).getTime() - new Date(right.due_at).getTime();
  }
  if (left.due_at) return -1;
  if (right.due_at) return 1;
  return left.title.localeCompare(right.title, 'ja');
}

export async function listCommunicationQueue(
  db: DbClient,
  args: {
    orgId: string;
    patientId?: string;
    limit?: number;
  }
): Promise<CommunicationQueueOverview> {
  const now = new Date();
  const shareWindow = addDays(now, 7);
  const limit = Math.max(args.limit ?? 8, 1);

  const [selfReports, callbackLogs, openRequests, deliveryRecords, externalShares] =
    await Promise.all([
      db.patientSelfReport.findMany({
        where: {
          org_id: args.orgId,
          ...(args.patientId ? { patient_id: args.patientId } : {}),
          status: {
            in: ['submitted', 'triaged', 'converted_to_task'],
          },
        },
        orderBy: [{ requested_callback: 'desc' }, { created_at: 'asc' }],
        take: limit,
        select: {
          id: true,
          patient_id: true,
          subject: true,
          category: true,
          requested_callback: true,
          preferred_contact_time: true,
          reported_by_name: true,
          status: true,
          created_at: true,
        },
      }),
      db.visitScheduleContactLog.findMany({
        where: {
          org_id: args.orgId,
          ...(args.patientId ? { patient_id: args.patientId } : {}),
          OR: [
            {
              callback_due_at: {
                not: null,
              },
            },
            {
              outcome: {
                in: ['attempted', 'unreachable'],
              },
            },
          ],
        },
        orderBy: [{ callback_due_at: 'asc' }, { called_at: 'desc' }],
        take: limit,
        select: {
          id: true,
          patient_id: true,
          outcome: true,
          contact_name: true,
          contact_phone: true,
          note: true,
          callback_due_at: true,
          called_at: true,
          schedule_id: true,
          proposal_id: true,
        },
      }),
      db.communicationRequest.findMany({
        where: {
          org_id: args.orgId,
          ...(args.patientId ? { patient_id: args.patientId } : {}),
          status: {
            in: ['sent', 'received', 'in_progress', 'escalated'],
          },
        },
        orderBy: [{ due_date: 'asc' }, { requested_at: 'asc' }],
        take: limit,
        select: {
          id: true,
          patient_id: true,
          request_type: true,
          subject: true,
          status: true,
          due_date: true,
          requested_at: true,
        },
      }),
      db.deliveryRecord.findMany({
        where: {
          org_id: args.orgId,
          status: {
            in: ['draft', 'failed', 'response_waiting'],
          },
          ...(args.patientId
            ? {
                report: {
                  patient_id: args.patientId,
                },
              }
            : {}),
        },
        orderBy: [{ updated_at: 'desc' }],
        take: limit,
        select: {
          id: true,
          channel: true,
          recipient_name: true,
          status: true,
          failure_reason: true,
          sent_at: true,
          updated_at: true,
          report: {
            select: {
              id: true,
              patient_id: true,
              report_type: true,
            },
          },
        },
      }),
      db.externalAccessGrant.findMany({
        where: {
          org_id: args.orgId,
          ...(args.patientId ? { patient_id: args.patientId } : {}),
          revoked_at: null,
          accessed_at: null,
          expires_at: {
            lte: shareWindow,
          },
        },
        orderBy: [{ expires_at: 'asc' }],
        take: limit,
        select: {
          id: true,
          patient_id: true,
          granted_to_name: true,
          expires_at: true,
        },
      }),
    ]);

  const patientIds = Array.from(
    new Set(
      [
        ...selfReports.map((item) => item.patient_id),
        ...callbackLogs.map((item) => item.patient_id),
        ...openRequests
          .map((item) => item.patient_id)
          .filter((value): value is string => Boolean(value)),
        ...deliveryRecords
          .map((item) => item.report.patient_id)
          .filter((value): value is string => Boolean(value)),
        ...externalShares.map((item) => item.patient_id),
      ].filter((value): value is string => Boolean(value))
    )
  );

  const patients =
    patientIds.length === 0
      ? []
      : await db.patient.findMany({
          where: {
            org_id: args.orgId,
            id: { in: patientIds },
          },
          select: {
            id: true,
            name: true,
          },
        });
  const patientNameById = new Map(patients.map((patient) => [patient.id, patient.name]));

  const items: CommunicationQueueItem[] = [
    ...selfReports.map((report) => ({
      id: `self_report:${report.id}`,
      queue_type: 'self_report' as const,
      title: `${patientNameById.get(report.patient_id) ?? '患者'} の自己申告`,
      summary: `${report.subject} / ${report.reported_by_name}${report.preferred_contact_time ? ` / 希望時間 ${report.preferred_contact_time}` : ''}`,
      channel: 'patient_portal',
      status: report.status,
      priority: (report.requested_callback ? 'urgent' : 'high') as QueuePriority,
      patient_id: report.patient_id,
      patient_name: patientNameById.get(report.patient_id) ?? null,
      due_at: report.created_at.toISOString(),
      action_href: '/external',
      action_label: '自己申告を確認',
    })),
    ...callbackLogs.map((log) => ({
      id: `callback:${log.id}`,
      queue_type: 'callback' as const,
      title: `${patientNameById.get(log.patient_id) ?? '患者'} への再架電`,
      summary:
        log.note ??
        `${log.contact_name ?? '連絡先'}${log.contact_phone ? ` / ${log.contact_phone}` : ''}`,
      channel: 'phone',
      status: log.outcome,
      priority:
        (log.callback_due_at && log.callback_due_at <= now ? 'urgent' : 'high') as QueuePriority,
      patient_id: log.patient_id,
      patient_name: patientNameById.get(log.patient_id) ?? null,
      due_at: isoOrNull(log.callback_due_at ?? log.called_at),
      action_href: '/schedules',
      action_label: '架電履歴を確認',
    })),
    ...openRequests.map((request) => ({
      id: `request:${request.id}`,
      queue_type: 'request' as const,
      title: request.subject,
      summary: `多職種連携 ${request.request_type}`,
      channel: 'collaboration',
      status: request.status,
      priority:
        (request.due_date && request.due_date <= now ? 'urgent' : 'normal') as QueuePriority,
      patient_id: request.patient_id ?? null,
      patient_name:
        request.patient_id != null ? patientNameById.get(request.patient_id) ?? null : null,
      due_at: isoOrNull(request.due_date ?? request.requested_at),
      action_href: '/conferences',
      action_label: '依頼を確認',
    })),
    ...deliveryRecords.map((record) => ({
      id: `delivery:${record.id}`,
      queue_type: 'delivery' as const,
      title: `${record.report.report_type} の送達確認`,
      summary:
        record.failure_reason ??
        `${record.recipient_name} への送達状況: ${record.status}`,
      channel: record.channel,
      status: record.status,
      priority: (record.status === 'failed' ? 'urgent' : 'high') as QueuePriority,
      patient_id: record.report.patient_id,
      patient_name: record.report.patient_id
        ? patientNameById.get(record.report.patient_id) ?? null
        : null,
      due_at: isoOrNull(record.sent_at ?? record.updated_at),
      action_href: '/reports',
      action_label: '報告送達を確認',
    })),
    ...externalShares.map((grant) => ({
      id: `external_share:${grant.id}`,
      queue_type: 'external_share' as const,
      title: `${patientNameById.get(grant.patient_id) ?? '患者'} の共有期限が近づいています`,
      summary: `${grant.granted_to_name} への共有リンクが未閲覧のまま期限切れ間近です。`,
      channel: 'external_portal',
      status: 'expires_soon',
      priority:
        (grant.expires_at <= addDays(now, 2) ? 'high' : 'normal') as QueuePriority,
      patient_id: grant.patient_id,
      patient_name: patientNameById.get(grant.patient_id) ?? null,
      due_at: grant.expires_at.toISOString(),
      action_href: '/external',
      action_label: '共有状況を確認',
    })),
  ]
    .sort(sortItems)
    .slice(0, limit);

  return {
    summary: {
      pending_count: items.length,
      overdue_count: items.filter(
        (item) => item.due_at != null && new Date(item.due_at) < now
      ).length,
      self_reports: selfReports.length,
      callback_followups: callbackLogs.length,
      open_requests: openRequests.length,
      delivery_backlog: deliveryRecords.length,
      expiring_external_shares: externalShares.length,
    },
    items,
  };
}
