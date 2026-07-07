import type { Prisma } from '@prisma/client';
import {
  CHANNEL_LABELS,
  PRIORITY_LABELS,
  REPORT_STATUS_CONFIG,
  REPORT_TYPE_LABELS,
  SCHEDULE_STATUS_LABELS,
  VISIT_OUTCOME_LABELS,
} from '@/lib/constants/status-labels';
import { buildTasksHref } from '@/lib/dashboard/home-link-builders';
import { buildReportHref } from '@/lib/reports/navigation';
import { getTaskTypeDefinition } from '@/lib/tasks/task-registry';
import { buildVisitHref, buildVisitRecordHref } from '@/lib/visits/navigation';
import { getConferenceTypeLabel } from '@/lib/visits/visit-workflow-projection';
import {
  buildPharmacyPrescriptionTimelineHref,
  getPharmacyCycleStatusLabel,
} from '@/modules/pharmacy/patient-movement/timeline-links';
import { buildVisibleExternalAccessGrantWhere } from '@/server/services/external-access';
import {
  buildCareReportCaseScope,
  buildNullableCaseScope,
  buildVisitRecordCaseScope,
} from '@/server/services/patient-detail-scope';
import { buildPatientTimelineConferenceNoteWhere } from '@/server/services/patient-detail-timeline-query';
import {
  MANAGEMENT_PLAN_STATUS_LABELS,
  PRESCRIPTION_SOURCE_LABELS,
  SELF_REPORT_STATUS_LABELS,
  VISIT_TYPE_LABELS,
  type PartnerVisitRecordTimelineSource,
  type OperationalTaskTimelineSource,
  type ResidualMedicationTimelineSource,
  type PatientMcsMessageTimelineSource,
  type BillingCandidateTimelineSource,
  type CareReportTimelineSource,
  type CommunicationTimelineSource,
  type ConferenceNoteTimelineSource,
  type DispenseResultTimelineSource,
  type ExternalShareTimelineSource,
  type FirstVisitDocumentAction,
  type FirstVisitDocumentTimelineSource,
  type InquiryTimelineSource,
  type ManagementPlanTimelineSource,
  type PrescriptionIntakeTimelineSource,
  type SelfReportTimelineSource,
  type TimelineEvent,
  type TimelineHrefBundle,
  type VisitRecordTimelineSource,
  type VisitScheduleTimelineSource,
  buildPatientBillingCandidatesHref,
  compactTimelineValues,
  formatTimelineDate,
  formatTokyoMonthStart,
} from '@/server/services/patient-detail-timeline-events';

/** Shared frozen empty array; type-linked to each adapter's Row at the use site. */
export const EMPTY = Object.freeze([]) as readonly never[];

/** Minimal Prisma surface the timeline source fetchers depend on. */
export type PatientTimelineRegistryDb = {
  billingCandidate: Pick<Prisma.TransactionClient['billingCandidate'], 'findMany'>;
  careReport: Pick<Prisma.TransactionClient['careReport'], 'findMany'>;
  communicationEvent: Pick<Prisma.TransactionClient['communicationEvent'], 'findMany'>;
  conferenceNote: Pick<Prisma.TransactionClient['conferenceNote'], 'findMany'>;
  dispenseResult: Pick<Prisma.TransactionClient['dispenseResult'], 'findMany'>;
  externalAccessGrant: Pick<Prisma.TransactionClient['externalAccessGrant'], 'findMany'>;
  firstVisitDocument: Pick<Prisma.TransactionClient['firstVisitDocument'], 'findMany'>;
  inquiryRecord: Pick<Prisma.TransactionClient['inquiryRecord'], 'findMany'>;
  managementPlan: Pick<Prisma.TransactionClient['managementPlan'], 'findMany'>;
  patientSelfReport: Pick<Prisma.TransactionClient['patientSelfReport'], 'findMany'>;
  patientMcsMessage: Pick<Prisma.TransactionClient['patientMcsMessage'], 'findMany'>;
  partnerVisitRecord: Pick<Prisma.TransactionClient['partnerVisitRecord'], 'findMany'>;
  residualMedication: Pick<Prisma.TransactionClient['residualMedication'], 'findMany'>;
  task: Pick<Prisma.TransactionClient['task'], 'findMany'>;
  prescriptionIntake: Pick<Prisma.TransactionClient['prescriptionIntake'], 'findMany'>;
  visitRecord: Pick<Prisma.TransactionClient['visitRecord'], 'findMany'>;
  visitSchedule: Pick<Prisma.TransactionClient['visitSchedule'], 'findMany'>;
};

/** Captured-once fetch inputs. No actorNameMap (doesn't exist at fetch time). */
export interface TimelineFetchCtx {
  db: PatientTimelineRegistryDb;
  orgId: string;
  patientId: string;
  caseIds: string[];
  canManageBilling: boolean;
  billingRefs: { visitRecordIds: string[]; cycleIds: string[] };
}

/** Projection inputs. Superset of fetch ctx + post-fetch derived artifacts. */
export interface TimelineProjectCtx {
  patientId: string;
  actorNameMap: ReadonlyMap<string, string>;
  firstVisitDocumentActions: ReadonlyMap<string, FirstVisitDocumentAction>;
  hrefs: TimelineHrefBundle;
}

export interface SourceAdapter<Key extends string, Row> {
  readonly key: Key;
  fetch(ctx: TimelineFetchCtx): Promise<readonly Row[]>;
  readonly emptyFallback: readonly Row[];
  toEvents(rows: readonly Row[], ctx: TimelineProjectCtx): TimelineEvent[];
  collectActorIds?(row: Row): Array<string | null | undefined>;
}

export function defineTimelineSource<Key extends string, Row>(
  adapter: SourceAdapter<Key, Row>,
): SourceAdapter<Key, Row> {
  return adapter;
}

const PATIENT_TIMELINE_EXTERNAL_SHARE_LIMIT = 8;
const PARTNER_VISIT_RECORD_STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  submitted: '提出済み',
  confirmed: '確認済み',
  returned: '差戻し',
};
const TASK_STATUS_LABELS: Record<string, string> = {
  pending: '未着手',
  in_progress: '対応中',
  completed: '完了',
  cancelled: '取消',
};
const TASK_PRIORITY_LABELS: Record<string, string> = {
  urgent: '至急',
  high: '高',
  normal: '通常',
  low: '低',
};
const MEDICATION_STOCK_SIGNAL_TASK_TYPES = new Set([
  'pharmacy.medication_stock_shortage_expected',
  'pharmacy.medication_stock_usage_unknown',
  'pharmacy.medication_stock_equivalence_review_required',
  'pharmacy.medication_stock_external_observation_review_required',
  'pharmacy.inbound_medication_stock_signal_review_required',
  'pharmacy.inbound_low_stock_unquantified_report',
]);
const SAFETY_SIGNAL_TASK_TYPES = new Set(['pharmacy.inbound_medication_safety_review_required']);
const INBOUND_COMMUNICATION_TASK_TYPES = new Set(['core.inbound_communication_review_required']);
const INBOUND_COMMUNICATION_EVENT_TYPE_BY_CHANNEL: Record<string, string> = {
  phone: 'inbound_phone',
  fax: 'inbound_fax',
  email: 'inbound_email',
};

const FIRST_VISIT_DOCUMENT_ACTION_VERBS: Record<string, string> = {
  generated: '作成',
  printed: '印刷',
  recovered: '回収',
  image_saved: '画像保存',
  replaced: '差し替え',
  invalidated: '無効化',
};

function getCommunicationDirectionLabel(direction: string) {
  if (direction === 'inbound' || direction === 'incoming') return '受信';
  if (direction === 'outbound' || direction === 'outgoing') return '発信';
  return direction;
}

function getInboundCommunicationEventType(item: CommunicationTimelineSource) {
  if (getCommunicationDirectionLabel(item.direction) !== '受信') return null;
  return INBOUND_COMMUNICATION_EVENT_TYPE_BY_CHANNEL[item.channel] ?? null;
}

function getTaskMovementKind(
  taskType: string,
): 'task' | 'safety' | 'medication_stock' | 'interprofessional' {
  const canonicalTaskType = getTaskTypeDefinition(taskType)?.taskType ?? taskType;
  if (INBOUND_COMMUNICATION_TASK_TYPES.has(canonicalTaskType)) return 'interprofessional';
  if (MEDICATION_STOCK_SIGNAL_TASK_TYPES.has(canonicalTaskType)) return 'medication_stock';
  if (canonicalTaskType.includes('.risk_') || SAFETY_SIGNAL_TASK_TYPES.has(canonicalTaskType)) {
    return 'safety';
  }
  return 'task';
}

// --- visitSchedules ---------------------------------------------------------
export const visitSchedulesSource = defineTimelineSource<
  'visitSchedules',
  VisitScheduleTimelineSource
>({
  key: 'visitSchedules',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, caseIds }) =>
    caseIds.length === 0
      ? Promise.resolve([])
      : db.visitSchedule.findMany({
          where: {
            org_id: orgId,
            case_id: { in: caseIds },
          },
          orderBy: [{ scheduled_date: 'desc' }, { time_window_start: 'desc' }],
          take: 12,
          select: {
            id: true,
            visit_type: true,
            scheduled_date: true,
            schedule_status: true,
            priority: true,
            confirmed_at: true,
            route_order: true,
            created_at: true,
            updated_at: true,
            visit_record: {
              select: {
                id: true,
                outcome_status: true,
              },
            },
          },
        }),
  toEvents: (rows) =>
    rows.map((item) => ({
      id: `visit_schedule:${item.id}`,
      event_type: 'visit_schedule',
      category: 'visit',
      occurred_at: item.confirmed_at ?? item.updated_at ?? item.created_at,
      title: item.confirmed_at ? '訪問予定を確定' : '訪問予定を登録',
      summary:
        compactTimelineValues([
          VISIT_TYPE_LABELS[item.visit_type] ?? item.visit_type,
          formatTimelineDate(item.scheduled_date)
            ? `訪問日 ${formatTimelineDate(item.scheduled_date)}`
            : null,
          item.visit_record ? '訪問記録あり' : null,
        ]).join(' / ') || null,
      href: item.visit_record
        ? buildVisitHref(item.visit_record.id)
        : buildVisitRecordHref(item.id),
      action_label: item.visit_record ? '訪問記録を開く' : '訪問記録を入力',
      status: item.schedule_status,
      status_label: SCHEDULE_STATUS_LABELS[item.schedule_status] ?? item.schedule_status,
      actor_name: null,
      metadata: compactTimelineValues([
        item.priority ? `優先度 ${PRIORITY_LABELS[item.priority] ?? item.priority}` : null,
        item.route_order ? `ルート順 ${item.route_order}` : null,
      ]),
    })),
});

// --- visitRecords -----------------------------------------------------------
export const visitRecordsSource = defineTimelineSource<'visitRecords', VisitRecordTimelineSource>({
  key: 'visitRecords',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId, caseIds }) =>
    caseIds.length === 0
      ? Promise.resolve([])
      : db.visitRecord.findMany({
          where: {
            org_id: orgId,
            patient_id: patientId,
            ...buildVisitRecordCaseScope(caseIds),
          },
          orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
          take: 12,
          select: {
            id: true,
            schedule_id: true,
            visit_date: true,
            outcome_status: true,
            next_visit_suggestion_date: true,
            created_at: true,
          },
        }),
  toEvents: (rows) =>
    rows.map((item) => ({
      id: `visit_record:${item.id}`,
      event_type: 'visit_record',
      category: 'visit',
      occurred_at: item.visit_date ?? item.created_at,
      title: '訪問記録を登録',
      summary: '訪問記録が登録されました。内容は訪問記録で確認してください。',
      href: buildVisitHref(item.id),
      action_label: '訪問記録を開く',
      status: item.outcome_status,
      status_label: VISIT_OUTCOME_LABELS[item.outcome_status] ?? item.outcome_status,
      actor_name: null,
      metadata: compactTimelineValues([
        item.next_visit_suggestion_date
          ? `次回提案 ${formatTimelineDate(item.next_visit_suggestion_date)}`
          : null,
      ]),
    })),
});

// --- careReports ------------------------------------------------------------
export const careReportsSource = defineTimelineSource<'careReports', CareReportTimelineSource>({
  key: 'careReports',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId, caseIds }) =>
    db.careReport.findMany({
      where: {
        org_id: orgId,
        patient_id: patientId,
        ...buildCareReportCaseScope(caseIds),
      },
      orderBy: [{ created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        report_type: true,
        status: true,
        created_at: true,
        delivery_records: {
          orderBy: [{ created_at: 'desc' }],
          take: 4,
          select: {
            id: true,
            channel: true,
            status: true,
            sent_at: true,
            confirmed_at: true,
            created_at: true,
          },
        },
      },
    }),
  toEvents: (rows) =>
    rows.flatMap((item) => [
      {
        id: `care_report:${item.id}`,
        event_type: 'care_report',
        category: 'document',
        occurred_at: item.created_at,
        title: '報告書を作成',
        summary:
          compactTimelineValues([
            REPORT_TYPE_LABELS[item.report_type] ?? item.report_type,
            REPORT_STATUS_CONFIG[item.status]?.label ?? item.status,
          ]).join(' / ') || null,
        href: buildReportHref(item.id),
        action_label: '報告書を開く',
        status: item.status,
        status_label: REPORT_STATUS_CONFIG[item.status]?.label ?? item.status,
        actor_name: null,
        metadata: [],
      },
      ...item.delivery_records.map((delivery) => ({
        id: `delivery_record:${delivery.id}`,
        event_type: 'delivery_record',
        category: 'document',
        occurred_at: delivery.confirmed_at ?? delivery.sent_at ?? delivery.created_at,
        title: delivery.status === 'confirmed' ? '報告書の受領を確認' : '報告書を送付',
        summary:
          compactTimelineValues([
            CHANNEL_LABELS[delivery.channel] ?? delivery.channel,
            REPORT_TYPE_LABELS[item.report_type] ?? item.report_type,
          ]).join(' / ') || null,
        href: buildReportHref(item.id),
        action_label: '送付元報告書を開く',
        status: delivery.status,
        status_label: REPORT_STATUS_CONFIG[delivery.status]?.label ?? delivery.status,
        actor_name: null,
        metadata: [],
      })),
    ]),
});

// --- communicationEvents ----------------------------------------------------
export const communicationEventsSource = defineTimelineSource<
  'communicationEvents',
  CommunicationTimelineSource
>({
  key: 'communicationEvents',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId, caseIds }) =>
    db.communicationEvent.findMany({
      where: {
        org_id: orgId,
        patient_id: patientId,
        event_type: { not: 'patient_self_report' },
        ...buildNullableCaseScope(caseIds),
      },
      orderBy: [{ occurred_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        event_type: true,
        channel: true,
        direction: true,
        occurred_at: true,
      },
    }),
  toEvents: (rows, { hrefs }) =>
    rows
      .filter((item) => item.event_type !== 'patient_self_report')
      .map((item) => {
        const directionLabel = getCommunicationDirectionLabel(item.direction);
        const channelLabel = CHANNEL_LABELS[item.channel] ?? item.channel;
        const inboundEventType = getInboundCommunicationEventType(item);

        return {
          id: `communication:${item.id}`,
          event_type: inboundEventType ?? 'communication',
          category: inboundEventType ? 'interprofessional' : 'communication',
          occurred_at: item.occurred_at,
          title: inboundEventType
            ? `${channelLabel}連絡を受信`
            : directionLabel === '受信'
              ? '連絡を受信'
              : '連絡を発信',
          summary: inboundEventType
            ? '他職種からの受信情報がありました。内容は連絡履歴で確認してください。'
            : '連絡履歴が更新されました。内容は連絡履歴で確認してください。',
          href: hrefs.patientConferencesHref,
          action_label: '連絡履歴を開く',
          status: item.direction,
          status_label: directionLabel,
          actor_name: null,
          metadata: compactTimelineValues([channelLabel]),
        };
      }),
});

// --- patientMcsMessages -----------------------------------------------------
export const patientMcsMessagesSource = defineTimelineSource<
  'patientMcsMessages',
  PatientMcsMessageTimelineSource
>({
  key: 'patientMcsMessages',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId }) =>
    db.patientMcsMessage.findMany({
      where: {
        org_id: orgId,
        patient_id: patientId,
      },
      orderBy: [{ posted_at: 'desc' }, { created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        posted_at: true,
        reaction_count: true,
        reply_count: true,
        created_at: true,
      },
    }),
  toEvents: (rows, { hrefs }) =>
    rows.map((item) => ({
      id: `patient_mcs_message:${item.id}`,
      event_type: 'inbound_mcs',
      category: 'interprofessional',
      occurred_at: item.posted_at ?? item.created_at,
      title: 'MCS投稿を受信',
      summary:
        compactTimelineValues([
          item.reply_count > 0 ? `返信 ${item.reply_count}件` : null,
          item.reaction_count > 0 ? `リアクション ${item.reaction_count}件` : null,
        ]).join(' / ') || null,
      href: hrefs.patientMcsHref,
      action_label: 'MCS連携を開く',
      status: 'received',
      status_label: '受信',
      actor_name: null,
      metadata: [],
    })),
});

// --- partnerVisitRecords ----------------------------------------------------
export const partnerVisitRecordsSource = defineTimelineSource<
  'partnerVisitRecords',
  PartnerVisitRecordTimelineSource
>({
  key: 'partnerVisitRecords',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId }) =>
    db.partnerVisitRecord.findMany({
      where: {
        org_id: orgId,
        share_case: {
          base_patient_id: patientId,
        },
        status: { in: ['submitted', 'confirmed'] },
      },
      orderBy: [{ confirmed_at: 'desc' }, { submitted_at: 'desc' }, { visit_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        status: true,
        visit_at: true,
        submitted_at: true,
        confirmed_at: true,
        updated_at: true,
      },
    }),
  toEvents: (rows, { hrefs }) =>
    rows.map((item) => ({
      id: `partner_visit_record:${item.id}`,
      event_type: 'interprofessional_note',
      category: 'interprofessional',
      occurred_at: item.confirmed_at ?? item.submitted_at ?? item.updated_at,
      title: item.status === 'confirmed' ? '協力薬局の訪問記録を確認' : '協力薬局の訪問記録を受信',
      summary:
        compactTimelineValues([`訪問日 ${formatTimelineDate(item.visit_at)}`]).join(' / ') || null,
      href: hrefs.patientCollaborationHref,
      action_label: '連携記録を開く',
      status: item.status,
      status_label: PARTNER_VISIT_RECORD_STATUS_LABELS[item.status] ?? item.status,
      actor_name: null,
      metadata: [],
    })),
});

// --- operationalTasks -------------------------------------------------------
export const operationalTasksSource = defineTimelineSource<
  'operationalTasks',
  OperationalTaskTimelineSource
>({
  key: 'operationalTasks',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId, caseIds }) =>
    db.task.findMany({
      where: {
        org_id: orgId,
        OR: [
          {
            related_entity_type: 'patient',
            related_entity_id: patientId,
          },
          ...(caseIds.length > 0
            ? [
                {
                  related_entity_type: 'case',
                  related_entity_id: {
                    in: caseIds,
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
      take: 12,
      select: {
        id: true,
        task_type: true,
        status: true,
        priority: true,
        due_date: true,
        sla_due_at: true,
        completed_at: true,
        related_entity_type: true,
        related_entity_id: true,
        created_at: true,
        updated_at: true,
      },
    }),
  toEvents: (rows) =>
    rows.map((item) => {
      const isResolved = item.status === 'completed' || item.status === 'cancelled';
      const taskType = getTaskTypeDefinition(item.task_type);
      const taskLabel = taskType?.label ?? item.task_type;
      const statusLabel = TASK_STATUS_LABELS[item.status] ?? item.status;
      const priorityLabel = TASK_PRIORITY_LABELS[item.priority] ?? item.priority;
      const movementKind = getTaskMovementKind(item.task_type);
      const isSafetySignal = movementKind === 'safety';
      const isMedicationStockSignal = movementKind === 'medication_stock';
      const isInboundCommunication = movementKind === 'interprofessional';
      return {
        id: `task:${item.id}`,
        event_type: isInboundCommunication
          ? 'inbound_communication'
          : isSafetySignal
            ? 'safety_signal'
            : isMedicationStockSignal
              ? 'inbound_medication_stock_signal'
              : isResolved
                ? 'task_resolved'
                : 'task_created',
        category: isInboundCommunication
          ? 'interprofessional'
          : isSafetySignal
            ? 'safety'
            : isMedicationStockSignal
              ? 'medication_stock'
              : 'task',
        occurred_at: isResolved ? (item.completed_at ?? item.updated_at) : item.created_at,
        title: isInboundCommunication
          ? isResolved
            ? '他職種受信確認タスクを完了'
            : '他職種受信確認タスクを作成'
          : isSafetySignal
            ? isResolved
              ? '安全確認タスクを完了'
              : '安全確認タスクを作成'
            : isMedicationStockSignal
              ? isResolved
                ? '残数確認タスクを完了'
                : '残数確認タスクを作成'
              : isResolved
                ? '運用タスクを完了'
                : '運用タスクを作成',
        summary:
          compactTimelineValues([
            taskLabel,
            `優先度 ${priorityLabel}`,
            item.sla_due_at ? `SLA ${formatTimelineDate(item.sla_due_at)}` : null,
            item.due_date ? `期限 ${formatTimelineDate(item.due_date)}` : null,
          ]).join(' / ') || null,
        href: buildTasksHref({
          status: '',
          taskType: item.task_type,
          relatedEntityType: item.related_entity_type ?? undefined,
          relatedEntityId: item.related_entity_id ?? undefined,
        }),
        action_label: 'タスクを開く',
        status: item.status,
        status_label: statusLabel,
        actor_name: null,
        metadata: compactTimelineValues([item.related_entity_type]),
      };
    }),
});

// --- residualMedications ----------------------------------------------------
export const residualMedicationsSource = defineTimelineSource<
  'residualMedications',
  ResidualMedicationTimelineSource
>({
  key: 'residualMedications',
  emptyFallback: EMPTY,
  fetch: async ({ db, orgId, patientId, caseIds }) => {
    if (caseIds.length === 0) return [];

    const visitRecords = await db.visitRecord.findMany({
      where: {
        org_id: orgId,
        patient_id: patientId,
        ...buildVisitRecordCaseScope(caseIds),
      },
      orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
      take: 12,
      select: {
        id: true,
        visit_date: true,
        outcome_status: true,
        created_at: true,
      },
    });
    const visitRecordById = new Map(visitRecords.map((record) => [record.id, record]));
    const visitRecordIds = Array.from(visitRecordById.keys());
    if (visitRecordIds.length === 0) return [];

    const residuals = await db.residualMedication.findMany({
      where: {
        org_id: orgId,
        visit_record_id: { in: visitRecordIds },
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        visit_record_id: true,
        is_reduction_target: true,
        is_prohibited_reduction: true,
        created_at: true,
      },
    });

    return residuals.flatMap((item) => {
      const visitRecord = visitRecordById.get(item.visit_record_id);
      if (!visitRecord) return [];
      return [
        {
          ...item,
          visit_record: visitRecord,
        },
      ];
    });
  },
  toEvents: (rows) => {
    const byVisitRecord = new Map<string, ResidualMedicationTimelineSource[]>();
    for (const item of rows) {
      const group = byVisitRecord.get(item.visit_record_id) ?? [];
      group.push(item);
      byVisitRecord.set(item.visit_record_id, group);
    }

    return Array.from(byVisitRecord.entries()).map(([visitRecordId, items]) => {
      const representative = items[0];
      const hasProhibitedReduction = items.some((item) => item.is_prohibited_reduction);
      const hasReductionTarget = items.some((item) => item.is_reduction_target);
      const status = hasProhibitedReduction
        ? 'prohibited_reduction'
        : hasReductionTarget
          ? 'reduction_target'
          : 'recorded';
      const statusLabel = hasProhibitedReduction
        ? '減数不可'
        : hasReductionTarget
          ? '減数検討'
          : '記録済み';

      return {
        id: `residual_medication:${visitRecordId}`,
        event_type: 'medication_stock_event',
        category: 'medication_stock',
        occurred_at: representative.visit_record.visit_date ?? representative.created_at,
        title: '残薬確認を記録',
        summary: '訪問記録に残薬確認が記録されました。内容は訪問記録で確認してください。',
        href: buildVisitHref(representative.visit_record.id),
        action_label: '訪問記録を開く',
        status,
        status_label: statusLabel,
        actor_name: null,
        metadata: compactTimelineValues([
          `残薬記録 ${items.length}件`,
          VISIT_OUTCOME_LABELS[representative.visit_record.outcome_status] ??
            representative.visit_record.outcome_status,
        ]),
      };
    });
  },
});

// --- selfReports ------------------------------------------------------------
export const selfReportsSource = defineTimelineSource<'selfReports', SelfReportTimelineSource>({
  key: 'selfReports',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId }) =>
    db.patientSelfReport.findMany({
      where: {
        org_id: orgId,
        patient_id: patientId,
      },
      orderBy: [{ created_at: 'desc' }],
      take: 8,
      select: {
        id: true,
        category: true,
        relation: true,
        status: true,
        requested_callback: true,
        preferred_contact_time: true,
        created_at: true,
      },
    }),
  toEvents: (rows, { hrefs }) =>
    rows.map((item) => ({
      id: `self_report:${item.id}`,
      event_type: 'self_report',
      category: 'communication',
      occurred_at: item.created_at,
      title: '患者から自己申告を受信',
      summary:
        compactTimelineValues([item.category, item.requested_callback ? '折返し希望' : null]).join(
          ' / ',
        ) || null,
      href: hrefs.patientCollaborationHref,
      action_label: '連携を確認',
      status: item.status,
      status_label: SELF_REPORT_STATUS_LABELS[item.status] ?? item.status,
      actor_name: null,
      metadata: compactTimelineValues([
        item.relation ? `関係 ${item.relation}` : null,
        item.requested_callback ? '折返し希望' : null,
        item.preferred_contact_time ? `希望時間 ${item.preferred_contact_time}` : null,
      ]),
    })),
});

// --- externalShares ---------------------------------------------------------
export const externalSharesSource = defineTimelineSource<
  'externalShares',
  ExternalShareTimelineSource
>({
  key: 'externalShares',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId, caseIds }) =>
    db.externalAccessGrant.findMany({
      where: buildVisibleExternalAccessGrantWhere({
        orgId,
        patientId,
        caseIds,
      }),
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: PATIENT_TIMELINE_EXTERNAL_SHARE_LIMIT,
      select: {
        id: true,
        expires_at: true,
        accessed_at: true,
        created_at: true,
      },
    }),
  toEvents: (rows, { hrefs }) =>
    rows.map((item) => ({
      id: `external_share:${item.id}`,
      event_type: 'external_share',
      category: 'communication',
      occurred_at: item.created_at,
      title: '外部共有リンクを発行',
      summary: item.accessed_at
        ? '外部共有リンクが閲覧されました。共有先や詳細は共有設定で確認してください。'
        : '外部共有リンクが発行されました。共有先や詳細は共有設定で確認してください。',
      href: hrefs.patientShareHref,
      action_label: '共有設定を開く',
      status: item.accessed_at ? 'accessed' : 'issued',
      status_label: item.accessed_at ? '閲覧済み' : '共有中',
      actor_name: null,
      metadata: compactTimelineValues([`期限 ${formatTimelineDate(item.expires_at)}`]),
    })),
});

// --- inquiryRecords ---------------------------------------------------------
export const inquiryRecordsSource = defineTimelineSource<'inquiryRecords', InquiryTimelineSource>({
  key: 'inquiryRecords',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId, caseIds }) =>
    caseIds.length === 0
      ? Promise.resolve([])
      : db.inquiryRecord.findMany({
          where: {
            org_id: orgId,
            cycle: {
              patient_id: patientId,
              case_id: { in: caseIds },
            },
          },
          orderBy: [{ resolved_at: 'desc' }, { inquired_at: 'desc' }, { created_at: 'desc' }],
          take: 8,
          select: {
            id: true,
            result: true,
            inquired_at: true,
            resolved_at: true,
            created_at: true,
            line: {
              select: {
                intake: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        }),
  toEvents: (rows, { hrefs }) =>
    rows.map((item) => {
      const inquiryStatus =
        item.result === 'changed'
          ? '変更あり'
          : item.result === 'unchanged'
            ? '変更なし'
            : '回答待ち';

      return {
        id: `inquiry:${item.id}`,
        event_type: 'inquiry',
        category: 'prescription',
        occurred_at: item.resolved_at ?? item.inquired_at ?? item.created_at,
        title: `疑義照会 ${inquiryStatus}`,
        summary: '疑義照会が記録されました。内容は処方詳細で確認してください。',
        href: item.line?.intake?.id
          ? buildPharmacyPrescriptionTimelineHref(item.line.intake.id)
          : hrefs.patientMedicationHref,
        action_label: item.line?.intake?.id ? '処方受付を開く' : '薬剤・訪問を開く',
        status: item.result ?? 'pending',
        status_label: inquiryStatus,
        actor_name: null,
        metadata: compactTimelineValues([
          item.inquired_at ? `照会 ${formatTimelineDate(item.inquired_at)}` : null,
        ]),
      };
    }),
});

// --- prescriptionIntakes ----------------------------------------------------
export const prescriptionIntakesSource = defineTimelineSource<
  'prescriptionIntakes',
  PrescriptionIntakeTimelineSource
>({
  key: 'prescriptionIntakes',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId, caseIds }) =>
    caseIds.length === 0
      ? Promise.resolve([])
      : db.prescriptionIntake.findMany({
          where: {
            org_id: orgId,
            cycle: {
              patient_id: patientId,
              case_id: { in: caseIds },
            },
          },
          orderBy: [{ created_at: 'desc' }],
          take: 10,
          select: {
            id: true,
            source_type: true,
            prescribed_date: true,
            created_at: true,
            cycle: {
              select: {
                overall_status: true,
              },
            },
          },
        }),
  toEvents: (rows) =>
    rows.map((item) => ({
      id: `prescription_intake:${item.id}`,
      event_type: 'prescription_intake',
      category: 'prescription',
      occurred_at: item.created_at,
      title: '処方受付を登録',
      summary:
        compactTimelineValues([
          PRESCRIPTION_SOURCE_LABELS[item.source_type] ?? item.source_type,
          formatTimelineDate(item.prescribed_date)
            ? `処方日 ${formatTimelineDate(item.prescribed_date)}`
            : null,
        ]).join(' / ') || null,
      href: buildPharmacyPrescriptionTimelineHref(item.id),
      action_label: '処方受付を開く',
      status: item.cycle.overall_status,
      status_label: getPharmacyCycleStatusLabel(item.cycle.overall_status),
      actor_name: null,
      metadata: [],
    })),
});

// --- dispenseResults --------------------------------------------------------
export const dispenseResultsSource = defineTimelineSource<
  'dispenseResults',
  DispenseResultTimelineSource
>({
  key: 'dispenseResults',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId, caseIds }) =>
    caseIds.length === 0
      ? Promise.resolve([])
      : db.dispenseResult.findMany({
          where: {
            org_id: orgId,
            line: {
              intake: {
                cycle: {
                  patient_id: patientId,
                  case_id: { in: caseIds },
                },
              },
            },
          },
          orderBy: [{ dispensed_at: 'desc' }],
          take: 12,
          select: {
            id: true,
            dispensed_at: true,
            task: {
              select: {
                cycle: {
                  select: {
                    overall_status: true,
                  },
                },
              },
            },
            line: {
              select: {
                intake: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        }),
  toEvents: (rows) =>
    rows.map((item) => ({
      id: `dispense_result:${item.id}`,
      event_type: 'dispense_result',
      category: 'prescription',
      occurred_at: item.dispensed_at,
      title: '調剤を記録',
      summary: '調剤結果が記録されました。内容は処方詳細で確認してください。',
      href: buildPharmacyPrescriptionTimelineHref(item.line.intake.id),
      action_label: '処方記録を開く',
      status: item.task.cycle?.overall_status ?? 'dispensed',
      status_label: getPharmacyCycleStatusLabel(item.task.cycle?.overall_status ?? 'dispensed'),
      actor_name: null,
      metadata: [],
    })),
});

// --- managementPlans --------------------------------------------------------
export const managementPlansSource = defineTimelineSource<
  'managementPlans',
  ManagementPlanTimelineSource
>({
  key: 'managementPlans',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, caseIds }) =>
    caseIds.length === 0
      ? Promise.resolve([])
      : db.managementPlan.findMany({
          where: {
            org_id: orgId,
            case_id: {
              in: caseIds,
            },
          },
          orderBy: [{ updated_at: 'desc' }],
          take: 6,
          select: {
            id: true,
            status: true,
            approved_at: true,
            reviewed_at: true,
            created_at: true,
          },
        }),
  toEvents: (rows, { hrefs }) =>
    rows.map((item) => {
      const occurredAt = item.approved_at ?? item.reviewed_at ?? item.created_at;

      return {
        id: `management_plan:${item.id}`,
        event_type: 'management_plan',
        category: 'document',
        occurred_at: occurredAt,
        title: item.approved_at ? '管理計画書を承認' : '管理計画書を作成',
        summary: '管理計画書が登録または更新されました。内容は計画書で確認してください。',
        href: hrefs.patientManagementPlanHref,
        action_label: '計画書を開く',
        status: item.status,
        status_label: MANAGEMENT_PLAN_STATUS_LABELS[item.status] ?? item.status,
        actor_name: null,
        metadata: [],
      };
    }),
});

// --- firstVisitDocuments ----------------------------------------------------
export const firstVisitDocumentsSource = defineTimelineSource<
  'firstVisitDocuments',
  FirstVisitDocumentTimelineSource
>({
  key: 'firstVisitDocuments',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId, caseIds }) =>
    caseIds.length === 0
      ? Promise.resolve([])
      : db.firstVisitDocument.findMany({
          where: {
            org_id: orgId,
            patient_id: patientId,
            case_id: { in: caseIds },
          },
          orderBy: [{ created_at: 'desc' }],
          take: 8,
          select: {
            id: true,
            delivered_at: true,
            created_at: true,
          },
        }),
  toEvents: (rows, { firstVisitDocumentActions, hrefs }) =>
    rows.map((item) => {
      const isDelivered = Boolean(item.delivered_at);
      const latestAction = firstVisitDocumentActions.get(item.id) ?? null;
      const knownAction = latestAction
        ? FIRST_VISIT_DOCUMENT_ACTION_VERBS[latestAction.action]
          ? latestAction.action
          : 'updated'
        : null;
      const actionVerb = latestAction
        ? (FIRST_VISIT_DOCUMENT_ACTION_VERBS[latestAction.action] ?? '更新')
        : isDelivered
          ? '交付'
          : '作成';
      return {
        id: `first_visit_document:${item.id}`,
        event_type: 'first_visit_document',
        category: 'document',
        occurred_at: latestAction?.occurredAt ?? item.delivered_at ?? item.created_at,
        title: `初回訪問文書を${actionVerb}`,
        summary: isDelivered
          ? '初回訪問文書の交付記録が更新されました。内容は共有・文書で確認してください。'
          : '初回訪問文書が登録されました。内容は共有・文書で確認してください。',
        href: hrefs.patientDocumentsHref,
        action_label: '文書状態を開く',
        status: knownAction ?? (isDelivered ? 'delivered' : 'created'),
        status_label: latestAction
          ? (FIRST_VISIT_DOCUMENT_ACTION_VERBS[latestAction.action] ?? '更新')
          : isDelivered
            ? '交付済み'
            : '作成済み',
        actor_name: null,
        metadata: [],
      };
    }),
});

// --- conferenceNotes --------------------------------------------------------
export const conferenceNotesSource = defineTimelineSource<
  'conferenceNotes',
  ConferenceNoteTimelineSource
>({
  key: 'conferenceNotes',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId, caseIds }) =>
    db.conferenceNote.findMany({
      where: {
        ...buildPatientTimelineConferenceNoteWhere({
          orgId,
          patientId,
          caseIds,
        }),
      },
      orderBy: [{ conference_date: 'desc' }],
      take: 8,
      select: {
        id: true,
        note_type: true,
        conference_date: true,
        follow_up_date: true,
        follow_up_completed: true,
        generated_report_id: true,
      },
    }),
  toEvents: (rows, { hrefs }) =>
    rows.map((item) => ({
      id: `conference_note:${item.id}`,
      event_type: 'conference_note',
      category: 'communication',
      occurred_at: item.conference_date,
      title: `${getConferenceTypeLabel(item.note_type)}を記録`,
      summary: item.generated_report_id
        ? '会議記録が登録され、報告ドラフトが作成されています。内容は会議記録で確認してください。'
        : '会議記録が登録されました。内容は会議記録で確認してください。',
      href: hrefs.patientConferencesHref,
      action_label: '会議を開く',
      status: item.follow_up_completed ? 'completed' : 'open',
      status_label: item.follow_up_completed ? 'フォロー完了' : 'フォロー中',
      actor_name: null,
      metadata: compactTimelineValues([
        item.follow_up_date ? `フォロー期限 ${formatTimelineDate(item.follow_up_date)}` : null,
      ]),
    })),
});

// --- billingCandidates ------------------------------------------------------
export const billingCandidatesSource = defineTimelineSource<
  'billingCandidates',
  BillingCandidateTimelineSource
>({
  key: 'billingCandidates',
  emptyFallback: EMPTY,
  fetch: ({ db, orgId, patientId, canManageBilling, billingRefs }) =>
    canManageBilling
      ? db.billingCandidate.findMany({
          where: {
            org_id: orgId,
            patient_id: patientId,
            ...(billingRefs.cycleIds.length === 0
              ? { id: { in: [] } }
              : { cycle_id: { in: billingRefs.cycleIds } }),
          },
          orderBy: [{ updated_at: 'desc' }],
          take: 8,
          select: {
            id: true,
            billing_month: true,
            billing_code: true,
            status: true,
            updated_at: true,
          },
        })
      : Promise.resolve([]),
  toEvents: (rows, { patientId }) =>
    rows.map((item) => ({
      id: `billing_candidate:${item.id}`,
      event_type: 'billing_candidate',
      category: 'billing',
      occurred_at: item.updated_at,
      title: '算定候補を更新',
      summary: '算定候補が更新されました。算定名・点数・除外理由は算定候補で確認してください。',
      href: buildPatientBillingCandidatesHref(patientId, {
        billingMonth: formatTokyoMonthStart(item.billing_month),
      }),
      action_label: '算定候補を開く',
      status: item.status,
      status_label:
        item.status === 'candidate'
          ? '候補'
          : item.status === 'confirmed'
            ? '確定'
            : item.status === 'excluded'
              ? '除外'
              : item.status === 'exported'
                ? '締め済み'
                : item.status,
      actor_name: null,
      metadata: compactTimelineValues([
        item.billing_code,
        `算定月 ${formatTimelineDate(item.billing_month)}`,
      ]),
    })),
});

export const TIMELINE_SOURCES = [
  visitSchedulesSource,
  visitRecordsSource,
  careReportsSource,
  communicationEventsSource,
  patientMcsMessagesSource,
  partnerVisitRecordsSource,
  operationalTasksSource,
  residualMedicationsSource,
  selfReportsSource,
  externalSharesSource,
  inquiryRecordsSource,
  prescriptionIntakesSource,
  dispenseResultsSource,
  managementPlansSource,
  firstVisitDocumentsSource,
  conferenceNotesSource,
  billingCandidatesSource,
] as const;

type Entry<R> = R extends SourceAdapter<infer K, infer Row> ? { key: K; row: Row } : never;
type TimelineSourceEntry = Entry<(typeof TIMELINE_SOURCES)[number]>;

export type TimelineTasks = {
  [X in TimelineSourceEntry as X['key']]: () => Promise<readonly X['row'][]>;
};
export type TimelineFallbacks = {
  [X in TimelineSourceEntry as X['key']]: readonly X['row'][];
};
export type TimelineSourceResults = {
  [X in TimelineSourceEntry as X['key']]: readonly X['row'][];
};
