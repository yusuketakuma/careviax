import { addDays } from 'date-fns';
import { isoOrNull } from '@/lib/utils/date';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { formatCommunicationRequestTypeLabel } from '@/lib/communications/request-labels';
import { buildExternalAccessGrantVisibilityWhere } from './external-access';

export type CommunicationQueueDbClient = typeof prisma | Prisma.TransactionClient;
export type CommunicationQueueReader = {
  patientSelfReport?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string;
        subject: string;
        category?: string | null;
        requested_callback: boolean;
        preferred_contact_time: string | null;
        reported_by_name: string | null;
        status: string;
        created_at: Date;
      }>
    >;
  };
  visitScheduleContactLog?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string;
        outcome: string;
        contact_name: string | null;
        contact_phone: string | null;
        note: string | null;
        callback_due_at: Date | null;
        called_at: Date;
      }>
    >;
  };
  communicationRequest?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string | null;
        request_type: string;
        subject: string;
        content?: string | null;
        template_key?: string | null;
        related_entity_type?: string | null;
        related_entity_id?: string | null;
        status: string;
        due_date: Date | null;
        requested_at: Date;
      }>
    >;
  };
  deliveryRecord?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        channel: string;
        recipient_name: string | null;
        status: string;
        failure_reason: string | null;
        sent_at: Date | null;
        confirmed_at: Date | null;
        updated_at: Date;
        report: {
          id: string;
          patient_id: string | null;
          report_type: string;
        };
      }>
    >;
  };
  externalAccessGrant?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string;
        granted_to_name: string;
        expires_at: Date;
        scope: string | null;
      }>
    >;
  };
  careReport?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string | null;
        report_type: string;
        status: string;
        created_at: Date;
        updated_at: Date | null;
      }>
    >;
  };
  tracingReport?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        patient_id: string;
        status: string;
        sent_to_physician: string | null;
        sent_at: Date | null;
        acknowledged_at: Date | null;
        updated_at: Date;
      }>
    >;
  };
  patient?: {
    findFirst?(args: unknown): Promise<{
      id: string;
      name: string;
      contacts?: Array<{
        name: string;
        relation: string;
        is_emergency_contact: boolean;
      }>;
      scheduling_preference?: {
        visit_before_contact_required: boolean | null;
      } | null;
    } | null>;
    findMany?(args: unknown): Promise<Array<{ id: string; name: string }>>;
  };
  medicationIssue?: {
    findMany(args: unknown): Promise<Array<{ title: string }>>;
  };
};

type DbClient = CommunicationQueueReader;
type QueuePriority = 'urgent' | 'high' | 'normal';
const DEFAULT_COMMUNICATION_QUEUE_LIMIT = 8;

function normalizeCommunicationQueueLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_COMMUNICATION_QUEUE_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_COMMUNICATION_QUEUE_LIMIT;

  const normalized = Math.trunc(value);
  if (!Number.isSafeInteger(normalized)) return DEFAULT_COMMUNICATION_QUEUE_LIMIT;

  return Math.max(normalized, 1);
}

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

export type CommunicationTimelineItem = {
  id: string;
  source_type: 'care_report' | 'tracing_report' | 'communication_request' | 'delivery_record';
  patient_id: string | null;
  patient_name: string | null;
  title: string;
  summary: string;
  status: string;
  occurred_at: string | null;
  action_href: string;
  action_label: string;
};

export type CommunicationDraftSuggestion = {
  id: string;
  patient_id: string;
  template_key:
    | 'missing_emergency_contact'
    | 'emergency_physician'
    | 'emergency_nurse'
    | 'emergency_family';
  request_type: string;
  target_name: string | null;
  target_role: string;
  title: string;
  summary: string;
  subject: string;
  content: string;
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
    unconfirmed_count: number;
    reply_waiting_count: number;
    failed_count: number;
  };
  items: CommunicationQueueItem[];
  timeline: CommunicationTimelineItem[];
  emergency_drafts: CommunicationDraftSuggestion[];
};

type TimelineSeed = {
  source_type: CommunicationTimelineItem['source_type'];
  id: string;
  patient_id: string | null;
  title: string;
  summary: string;
  status: string;
  occurred_at: Date | null;
  action_href: string;
  action_label: string;
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

function sortTimeline(left: TimelineSeed, right: TimelineSeed) {
  const leftTime = left.occurred_at?.getTime() ?? 0;
  const rightTime = right.occurred_at?.getTime() ?? 0;
  return rightTime - leftTime;
}

function buildEmergencyContactGapDraft(patientName: string): CommunicationDraftSuggestion {
  return {
    id: 'missing_emergency_contact',
    patient_id: '',
    template_key: 'missing_emergency_contact',
    request_type: 'emergency_contact_review',
    target_name: null,
    target_role: 'internal',
    title: '緊急連絡先の整備が必要です',
    summary: `${patientName} の緊急連絡先が不足しています。先に連絡先と共有先を登録してください。`,
    subject: `${patientName} の緊急連絡先確認`,
    content: `${patientName} さんの急変時に連絡できる家族・主治医・訪看の連絡先確認が必要です。`,
    action_href: '/patients',
    action_label: '患者詳細を開く',
  };
}

function buildDraftSignalSummary(args: {
  patientName: string;
  urgentIssueTitle: string | null;
  recentSelfReportTitle: string | null;
}) {
  if (args.urgentIssueTitle) {
    return `${args.patientName} で急変または薬学的緊急対応の可能性があります。要点: ${args.urgentIssueTitle}`;
  }
  if (args.recentSelfReportTitle) {
    return `${args.patientName} の自己申告から緊急連絡候補を生成しました。要点: ${args.recentSelfReportTitle}`;
  }
  return `${args.patientName} の緊急時共有テンプレートです。`;
}

function buildEmergencyDraft(args: {
  templateKey: CommunicationDraftSuggestion['template_key'];
  requestType: string;
  patientId: string;
  patientName: string;
  targetName: string | null;
  targetRole: string;
  summary: string;
}) {
  const recipient = args.targetName ?? args.targetRole;
  return {
    id: `${args.templateKey}:${recipient}`,
    patient_id: args.patientId,
    template_key: args.templateKey,
    request_type: args.requestType,
    target_name: args.targetName,
    target_role: args.targetRole,
    title: `${recipient} 宛の緊急連絡ドラフト`,
    summary: `${args.summary} / 宛先: ${recipient}`,
    subject: `${args.patientName} の緊急連絡`,
    content: [
      `【患者】${args.patientName}`,
      `【想定宛先】${recipient}`,
      `【共有要点】${args.summary}`,
      '【依頼】急変時対応または至急の情報共有が必要です。必要時は折返しをお願いします。',
    ].join('\n'),
    action_href: '/communications/requests',
    action_label: 'ドラフト化する',
  } satisfies CommunicationDraftSuggestion;
}

async function buildEmergencyDrafts(
  db: DbClient,
  args: { orgId: string; patientId?: string; caseIds?: string[] },
): Promise<CommunicationDraftSuggestion[]> {
  if (!args.patientId) return [];
  if (!db.patient?.findFirst) return [];

  const patient = await db.patient.findFirst({
    where: {
      org_id: args.orgId,
      id: args.patientId,
    },
    select: {
      id: true,
      name: true,
      contacts: {
        select: {
          name: true,
          relation: true,
          is_emergency_contact: true,
        },
      },
    },
  });

  if (!patient) return [];

  const urgentIssuesPromise =
    db.medicationIssue?.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        ...(args.caseIds === undefined
          ? {}
          : {
              OR: [
                { case_id: null },
                ...(args.caseIds.length > 0 ? [{ case_id: { in: args.caseIds } }] : []),
              ],
            }),
        status: {
          in: ['open', 'in_progress'],
        },
        priority: {
          in: ['critical', 'high'],
        },
      },
      orderBy: [{ identified_at: 'desc' }],
      take: 2,
      select: {
        title: true,
      },
    }) ?? Promise.resolve([]);
  const recentSelfReportsPromise =
    db.patientSelfReport?.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        status: {
          in: ['submitted', 'triaged', 'converted_to_task'],
        },
      },
      orderBy: [{ requested_callback: 'desc' }, { created_at: 'desc' }],
      take: 2,
      select: {
        subject: true,
        requested_callback: true,
      },
    }) ?? Promise.resolve([]);
  const [urgentIssues, recentSelfReports] = await Promise.all([
    urgentIssuesPromise,
    recentSelfReportsPromise,
  ]);

  const contacts = patient.contacts ?? [];
  const emergencyContacts = contacts.filter((contact) => contact.is_emergency_contact);
  const physician = contacts.find((contact) => contact.relation === 'physician') ?? null;
  const nurse = contacts.find((contact) => contact.relation === 'nurse') ?? null;
  const family =
    emergencyContacts[0] ??
    contacts.find((contact) => ['spouse', 'child', 'parent', 'sibling'].includes(contact.relation));

  const summary = buildDraftSignalSummary({
    patientName: patient.name,
    urgentIssueTitle: urgentIssues[0]?.title ?? null,
    recentSelfReportTitle: recentSelfReports[0]?.subject ?? null,
  });

  const drafts: CommunicationDraftSuggestion[] = [];
  if (emergencyContacts.length === 0) {
    drafts.push({
      ...buildEmergencyContactGapDraft(patient.name),
      patient_id: patient.id,
    });
  }
  if (physician) {
    drafts.push(
      buildEmergencyDraft({
        templateKey: 'emergency_physician',
        requestType: 'emergency_physician',
        patientId: patient.id,
        patientName: patient.name,
        targetName: physician.name,
        targetRole: 'physician',
        summary,
      }),
    );
  }
  if (nurse) {
    drafts.push(
      buildEmergencyDraft({
        templateKey: 'emergency_nurse',
        requestType: 'emergency_nurse',
        patientId: patient.id,
        patientName: patient.name,
        targetName: nurse.name,
        targetRole: 'nurse',
        summary,
      }),
    );
  }
  if (family) {
    drafts.push(
      buildEmergencyDraft({
        templateKey: 'emergency_family',
        requestType: 'emergency_family',
        patientId: patient.id,
        patientName: patient.name,
        targetName: family.name,
        targetRole: 'family',
        summary,
      }),
    );
  }

  return drafts.slice(0, 4);
}

export async function listCommunicationQueue(
  db: CommunicationQueueDbClient,
  args: {
    orgId: string;
    patientId?: string;
    patientIds?: string[];
    caseIds?: string[];
    limit?: number;
  },
): Promise<CommunicationQueueOverview>;
export async function listCommunicationQueue(
  db: CommunicationQueueReader,
  args: {
    orgId: string;
    patientId?: string;
    patientIds?: string[];
    caseIds?: string[];
    limit?: number;
  },
): Promise<CommunicationQueueOverview>;
export async function listCommunicationQueue(
  db: CommunicationQueueDbClient | CommunicationQueueReader,
  args: {
    orgId: string;
    patientId?: string;
    patientIds?: string[];
    caseIds?: string[];
    limit?: number;
  },
): Promise<CommunicationQueueOverview>;
export async function listCommunicationQueue(
  db: object,
  args: {
    orgId: string;
    patientId?: string;
    patientIds?: string[];
    caseIds?: string[];
    limit?: number;
  },
): Promise<CommunicationQueueOverview>;
export async function listCommunicationQueue(
  db: CommunicationQueueDbClient | CommunicationQueueReader,
  args: {
    orgId: string;
    patientId?: string;
    patientIds?: string[];
    caseIds?: string[];
    limit?: number;
  },
): Promise<CommunicationQueueOverview> {
  const reader = db as CommunicationQueueReader;
  const now = new Date();
  const shareWindow = addDays(now, 7);
  const limit = normalizeCommunicationQueueLimit(args.limit);
  const patientScope =
    args.patientId !== undefined
      ? { patient_id: args.patientId }
      : args.patientIds !== undefined
        ? { patient_id: { in: args.patientIds } }
        : {};
  const caseScope =
    args.caseIds === undefined
      ? undefined
      : {
          OR: [
            { case_id: null },
            ...(args.caseIds.length > 0 ? [{ case_id: { in: args.caseIds } }] : []),
          ],
        };

  async function listVisibleExternalShares() {
    if (!reader.externalAccessGrant) return [];
    const externalShareWhere = {
      org_id: args.orgId,
      ...patientScope,
      revoked_at: null,
      accessed_at: null,
      expires_at: {
        lte: shareWindow,
      },
    };

    return reader.externalAccessGrant.findMany({
      where: {
        ...externalShareWhere,
        ...buildExternalAccessGrantVisibilityWhere(args.caseIds),
      },
      orderBy: [{ expires_at: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        patient_id: true,
        granted_to_name: true,
        expires_at: true,
        scope: true,
      },
    });
  }

  const [
    selfReports,
    callbackLogs,
    openRequests,
    deliveryRecords,
    externalShares,
    careReports,
    tracingReports,
    emergencyDrafts,
  ] = await Promise.all([
    reader.patientSelfReport?.findMany({
      where: {
        org_id: args.orgId,
        ...patientScope,
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
    }) ?? Promise.resolve([]),
    // VisitScheduleContactLog.case_id is non-null. When the caller passed an
    // explicit empty caseIds list (i.e. the user has access to no cases),
    // skip the query — `case_id: { in: [] }` would silently return zero rows
    // anyway, but the intent is clearer with an explicit fast-path.
    args.caseIds !== undefined && args.caseIds.length === 0
      ? Promise.resolve([])
      : (reader.visitScheduleContactLog?.findMany({
          where: {
            org_id: args.orgId,
            ...patientScope,
            // Outer fast-path already returned for empty caseIds; here caseIds is
            // either undefined (no filter) or has at least one element.
            ...(args.caseIds ? { case_id: { in: args.caseIds } } : {}),
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
          },
        }) ?? Promise.resolve([])),
    reader.communicationRequest?.findMany({
      where: {
        org_id: args.orgId,
        ...patientScope,
        ...(caseScope ? { AND: [caseScope] } : {}),
        status: {
          in: ['draft', 'sent', 'received', 'in_progress', 'responded', 'escalated', 'closed'],
        },
      },
      orderBy: [{ due_date: 'asc' }, { requested_at: 'desc' }],
      take: limit,
      select: {
        id: true,
        patient_id: true,
        request_type: true,
        subject: true,
        content: true,
        template_key: true,
        related_entity_type: true,
        related_entity_id: true,
        status: true,
        due_date: true,
        requested_at: true,
      },
    }) ?? Promise.resolve([]),
    reader.deliveryRecord?.findMany({
      where: {
        org_id: args.orgId,
        status: {
          in: ['draft', 'failed', 'response_waiting', 'sent', 'confirmed'],
        },
        ...(args.patientId || args.patientIds !== undefined || caseScope
          ? {
              report: {
                ...patientScope,
                ...(caseScope ? { AND: [caseScope] } : {}),
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
        confirmed_at: true,
        updated_at: true,
        report: {
          select: {
            id: true,
            patient_id: true,
            report_type: true,
          },
        },
      },
    }) ?? Promise.resolve([]),
    listVisibleExternalShares(),
    reader.careReport?.findMany({
      where: {
        org_id: args.orgId,
        ...patientScope,
        ...(caseScope ? { AND: [caseScope] } : {}),
        status: {
          in: ['sent', 'failed', 'response_waiting', 'confirmed'],
        },
      },
      orderBy: [{ updated_at: 'desc' }],
      take: limit,
      select: {
        id: true,
        patient_id: true,
        report_type: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    }) ?? Promise.resolve([]),
    reader.tracingReport?.findMany({
      where: {
        org_id: args.orgId,
        ...patientScope,
        ...(caseScope ? { AND: [caseScope] } : {}),
        status: {
          in: ['sent', 'received', 'acknowledged'],
        },
      },
      orderBy: [{ updated_at: 'desc' }],
      take: limit,
      select: {
        id: true,
        patient_id: true,
        status: true,
        sent_to_physician: true,
        sent_at: true,
        acknowledged_at: true,
        updated_at: true,
      },
    }) ?? Promise.resolve([]),
    buildEmergencyDrafts(reader, args),
  ]);

  const visibleExternalShares = externalShares;

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
        ...visibleExternalShares.map((item) => item.patient_id),
        ...careReports
          .map((item) => item.patient_id)
          .filter((value): value is string => Boolean(value)),
        ...tracingReports.map((item) => item.patient_id),
      ].filter((value): value is string => Boolean(value)),
    ),
  );

  const patients =
    patientIds.length === 0
      ? []
      : reader.patient?.findMany
        ? await reader.patient.findMany({
            where: {
              org_id: args.orgId,
              id: { in: patientIds },
            },
            select: {
              id: true,
              name: true,
            },
          })
        : [];
  const patientNameById = new Map(patients.map((patient) => [patient.id, patient.name]));

  const actionableRequests = openRequests.filter((request) =>
    ['draft', 'sent', 'received', 'in_progress', 'escalated'].includes(request.status),
  );
  const actionableDeliveries = deliveryRecords.filter((record) =>
    ['draft', 'failed', 'response_waiting'].includes(record.status),
  );

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
      priority: (log.callback_due_at && log.callback_due_at <= now
        ? 'urgent'
        : 'high') as QueuePriority,
      patient_id: log.patient_id,
      patient_name: patientNameById.get(log.patient_id) ?? null,
      due_at: isoOrNull(log.callback_due_at ?? log.called_at),
      action_href: '/schedules',
      action_label: '架電履歴を確認',
    })),
    ...actionableRequests.map((request) => ({
      id: `request:${request.id}`,
      queue_type: 'request' as const,
      title: request.subject,
      summary: `多職種連携 ${formatCommunicationRequestTypeLabel(request.request_type)}`,
      channel: 'collaboration',
      status: request.status,
      priority: (request.due_date && request.due_date <= now
        ? 'urgent'
        : 'normal') as QueuePriority,
      patient_id: request.patient_id ?? null,
      patient_name:
        request.patient_id != null ? (patientNameById.get(request.patient_id) ?? null) : null,
      due_at: isoOrNull(request.due_date ?? request.requested_at),
      action_href: buildCommunicationRequestsHref({
        status: request.status,
        patientId: request.patient_id,
        requestId: request.id,
        relatedEntityType: request.related_entity_type,
        relatedEntityId: request.related_entity_id,
      }),
      action_label: '依頼を確認',
    })),
    ...actionableDeliveries.map((record) => ({
      id: `delivery:${record.id}`,
      queue_type: 'delivery' as const,
      title: `${record.report.report_type} の送達確認`,
      summary: record.failure_reason ?? `${record.recipient_name} への送達状況: ${record.status}`,
      channel: record.channel,
      status: record.status,
      priority: (record.status === 'failed' ? 'urgent' : 'high') as QueuePriority,
      patient_id: record.report.patient_id,
      patient_name: record.report.patient_id
        ? (patientNameById.get(record.report.patient_id) ?? null)
        : null,
      due_at: isoOrNull(record.sent_at ?? record.updated_at),
      action_href: '/reports',
      action_label: '報告送達を確認',
    })),
    ...visibleExternalShares.map((grant) => ({
      id: `external_share:${grant.id}`,
      queue_type: 'external_share' as const,
      title: `${patientNameById.get(grant.patient_id) ?? '患者'} の共有期限が近づいています`,
      summary: `${grant.granted_to_name} への共有リンクが未閲覧のまま期限切れ間近です。`,
      channel: 'external_portal',
      status: 'expires_soon',
      priority: (grant.expires_at <= addDays(now, 2) ? 'high' : 'normal') as QueuePriority,
      patient_id: grant.patient_id,
      patient_name: patientNameById.get(grant.patient_id) ?? null,
      due_at: grant.expires_at.toISOString(),
      action_href: '/external',
      action_label: '共有状況を確認',
    })),
  ]
    .sort(sortItems)
    .slice(0, limit);

  const timelineSeeds: TimelineSeed[] = [
    ...careReports.map((report) => ({
      id: `care_report:${report.id}`,
      source_type: 'care_report' as const,
      patient_id: report.patient_id,
      title: `報告書 ${report.report_type}`,
      summary: `状態: ${report.status}`,
      status: report.status,
      occurred_at: report.updated_at ?? report.created_at,
      action_href: '/reports',
      action_label: '報告書を確認',
    })),
    ...tracingReports.map((report) => ({
      id: `tracing_report:${report.id}`,
      source_type: 'tracing_report' as const,
      patient_id: report.patient_id,
      title: '服薬情報提供書',
      summary: `${report.sent_to_physician ?? '送付先未設定'} / ${report.status}`,
      status: report.status,
      occurred_at: report.acknowledged_at ?? report.sent_at ?? report.updated_at,
      action_href: '/communications/requests',
      action_label: 'tracing を確認',
    })),
    ...openRequests.map((request) => ({
      id: `communication_request:${request.id}`,
      source_type: 'communication_request' as const,
      patient_id: request.patient_id ?? null,
      title: request.subject,
      summary: `${formatCommunicationRequestTypeLabel(request.request_type)} / ${
        request.content ?? '内容未記録'
      }`,
      status: request.status,
      occurred_at: request.due_date ?? request.requested_at,
      action_href: buildCommunicationRequestsHref({
        status: request.status,
        patientId: request.patient_id,
        requestId: request.id,
        relatedEntityType: request.related_entity_type,
        relatedEntityId: request.related_entity_id,
      }),
      action_label: '依頼を確認',
    })),
    ...deliveryRecords.map((record) => ({
      id: `delivery_record:${record.id}`,
      source_type: 'delivery_record' as const,
      patient_id: record.report.patient_id,
      title: `${record.report.report_type} の送達`,
      summary:
        record.failure_reason ?? `${record.recipient_name} / ${record.channel} / ${record.status}`,
      status: record.status,
      occurred_at: record.confirmed_at ?? record.sent_at ?? record.updated_at,
      action_href: '/reports',
      action_label: '送達履歴を確認',
    })),
  ];

  const timeline = timelineSeeds
    .sort(sortTimeline)
    .slice(0, limit)
    .map((item) => ({
      ...item,
      patient_name: item.patient_id ? (patientNameById.get(item.patient_id) ?? null) : null,
      occurred_at: isoOrNull(item.occurred_at),
    }));

  const unconfirmedCount = deliveryRecords.filter((record) => record.status === 'draft').length;
  const requestDraftCount = actionableRequests.filter(
    (request) => request.status === 'draft',
  ).length;
  const replyWaitingCount =
    deliveryRecords.filter((record) => record.status === 'response_waiting').length +
    actionableRequests.filter((request) =>
      ['received', 'in_progress', 'escalated'].includes(request.status),
    ).length;
  const failedCount = deliveryRecords.filter((record) => record.status === 'failed').length;

  return {
    summary: {
      pending_count: items.length,
      overdue_count: items.filter((item) => item.due_at != null && new Date(item.due_at) < now)
        .length,
      self_reports: selfReports.length,
      callback_followups: callbackLogs.length,
      open_requests: actionableRequests.length,
      delivery_backlog: actionableDeliveries.length,
      expiring_external_shares: visibleExternalShares.length,
      unconfirmed_count: unconfirmedCount + requestDraftCount,
      reply_waiting_count: replyWaitingCount,
      failed_count: failedCount,
    },
    items,
    timeline,
    emergency_drafts: emergencyDrafts,
  };
}
