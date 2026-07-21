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
import { buildPharmacyPrescriptionTimelineHref } from '@/modules/pharmacy/patient-movement/timeline-links';
import { buildVisibleExternalAccessGrantWhere } from '@/server/services/external-access';
import {
  buildCareReportCaseScope,
  buildNullableCaseScope,
  buildVisitRecordCaseScope,
} from '@/server/services/patient-detail-scope';
import {
  SELF_REPORT_STATUS_LABELS,
  VISIT_TYPE_LABELS,
  type PartnerVisitRecordTimelineSource,
  type OperationalTaskTimelineSource,
  type ResidualMedicationTimelineSource,
  type MedicationStockSnapshotTimelineSource,
  type PatientMcsMessageTimelineSource,
  type CareReportTimelineSource,
  type CommunicationTimelineSource,
  type ExternalShareTimelineSource,
  type InquiryTimelineSource,
  type SelfReportTimelineSource,
  type VisitRecordTimelineSource,
  type VisitScheduleTimelineSource,
  compactTimelineValues,
  formatTimelineDate,
} from '@/server/services/patient-detail-timeline-events';

import {
  EMPTY,
  defineTimelineSource,
  resolveTimelineSourceTake,
  type SourceAdapter,
} from '@/server/services/patient-detail-timeline-registry-contract';
export {
  EMPTY,
  defineTimelineSource,
  type PatientTimelineRegistryDb,
  type SourceAdapter,
  type TimelineFetchCtx,
  type TimelineProjectCtx,
} from '@/server/services/patient-detail-timeline-registry-contract';

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
const MEDICATION_STOCK_SNAPSHOT_RISK_LEVELS = ['urgent', 'shortage_expected'] as const;
const MEDICATION_STOCK_SNAPSHOT_RISK_LABELS: Record<string, string> = {
  urgent: '至急',
  shortage_expected: '不足見込み',
};
const SAFETY_SIGNAL_TASK_TYPES = new Set(['pharmacy.inbound_medication_safety_review_required']);
const INBOUND_COMMUNICATION_TASK_TYPES = new Set(['core.inbound_communication_review_required']);
const INBOUND_COMMUNICATION_EVENT_TYPE_BY_CHANNEL: Record<string, string> = {
  phone: 'inbound_phone',
  fax: 'inbound_fax',
  email: 'inbound_email',
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
  fetch: (ctx) => {
    const { db, orgId, caseIds } = ctx;
    return caseIds.length === 0
      ? Promise.resolve([])
      : db.visitSchedule.findMany({
          where: {
            org_id: orgId,
            case_id: { in: caseIds },
          },
          orderBy: [{ scheduled_date: 'desc' }, { time_window_start: 'desc' }, { id: 'desc' }],
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
        });
  },
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
  fetch: (ctx) => {
    const { db, orgId, patientId, caseIds } = ctx;
    return caseIds.length === 0
      ? Promise.resolve([])
      : db.visitRecord.findMany({
          where: {
            org_id: orgId,
            patient_id: patientId,
            ...buildVisitRecordCaseScope(caseIds),
          },
          orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
          take: resolveTimelineSourceTake(ctx, 12),
          select: {
            id: true,
            schedule_id: true,
            visit_date: true,
            outcome_status: true,
            next_visit_suggestion_date: true,
            created_at: true,
          },
        });
  },
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
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 8,
      select: {
        id: true,
        report_type: true,
        status: true,
        created_at: true,
        delivery_records: {
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
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
  fetch: (ctx) => {
    const { db, orgId, patientId, caseIds } = ctx;
    return db.communicationEvent.findMany({
      where: {
        org_id: orgId,
        patient_id: patientId,
        event_type: { not: 'patient_self_report' },
        ...buildNullableCaseScope(caseIds),
      },
      orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
      take: resolveTimelineSourceTake(ctx, 8),
      select: {
        id: true,
        event_type: true,
        channel: true,
        direction: true,
        occurred_at: true,
      },
    });
  },
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
  fetch: (ctx) => {
    const { db, orgId, patientId } = ctx;
    return db.patientMcsMessage.findMany({
      where: {
        org_id: orgId,
        patient_id: patientId,
      },
      orderBy: [{ posted_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      take: 8,
      select: {
        id: true,
        posted_at: true,
        reaction_count: true,
        reply_count: true,
        created_at: true,
      },
    });
  },
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
  fetch: (ctx) => {
    const { db, orgId, patientId } = ctx;
    return db.partnerVisitRecord.findMany({
      where: {
        org_id: orgId,
        share_case: {
          base_patient_id: patientId,
        },
        status: { in: ['submitted', 'confirmed'] },
      },
      orderBy: [
        { confirmed_at: 'desc' },
        { submitted_at: 'desc' },
        { visit_at: 'desc' },
        { id: 'desc' },
      ],
      take: 8,
      select: {
        id: true,
        status: true,
        visit_at: true,
        submitted_at: true,
        confirmed_at: true,
        updated_at: true,
      },
    });
  },
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
  fetch: (ctx) => {
    const { db, orgId, patientId, caseIds } = ctx;
    return db.task.findMany({
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
      orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
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
    });
  },
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
  fetch: async (ctx) => {
    const { db, orgId, patientId, caseIds } = ctx;
    if (caseIds.length === 0) return [];

    const visitRecords = await db.visitRecord.findMany({
      where: {
        org_id: orgId,
        patient_id: patientId,
        ...buildVisitRecordCaseScope(caseIds),
      },
      orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
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

// --- medicationStockSnapshots ----------------------------------------------
export const medicationStockSnapshotsSource = defineTimelineSource<
  'medicationStockSnapshots',
  MedicationStockSnapshotTimelineSource
>({
  key: 'medicationStockSnapshots',
  emptyFallback: EMPTY,
  fetch: (ctx) => {
    const { db, orgId, patientId, caseIds } = ctx;
    return caseIds.length === 0
      ? Promise.resolve([])
      : db.medicationStockSnapshot.findMany({
          where: {
            org_id: orgId,
            patient_id: patientId,
            case_id: { in: caseIds },
            stock_risk_level: { in: [...MEDICATION_STOCK_SNAPSHOT_RISK_LEVELS] },
          },
          orderBy: [
            { estimated_stockout_date: 'asc' },
            { days_until_stockout: 'asc' },
            { calculated_at: 'desc' },
            { id: 'asc' },
          ],
          take: resolveTimelineSourceTake(ctx, 8),
          select: {
            id: true,
            stock_risk_level: true,
            calculated_at: true,
          },
        });
  },
  toEvents: (rows, { hrefs }) =>
    rows.map((item) => ({
      id: `medication_stock_snapshot:${item.id}`,
      event_type: 'medication_stock_snapshot',
      category: 'medication_stock',
      occurred_at: item.calculated_at,
      title: '残数不足リスクを検出',
      summary: '現在の残数予測で不足リスクがあります。内容は薬剤・訪問で確認してください。',
      href: hrefs.patientMedicationHref,
      action_label: '残数を確認',
      status: item.stock_risk_level,
      status_label:
        MEDICATION_STOCK_SNAPSHOT_RISK_LABELS[item.stock_risk_level] ?? item.stock_risk_level,
      actor_name: null,
      metadata: [],
    })),
});

// --- selfReports ------------------------------------------------------------
export const selfReportsSource = defineTimelineSource<'selfReports', SelfReportTimelineSource>({
  key: 'selfReports',
  emptyFallback: EMPTY,
  fetch: (ctx) => {
    const { db, orgId, patientId } = ctx;
    return db.patientSelfReport.findMany({
      where: {
        org_id: orgId,
        patient_id: patientId,
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: resolveTimelineSourceTake(ctx, 8),
      select: {
        id: true,
        category: true,
        relation: true,
        status: true,
        requested_callback: true,
        preferred_contact_time: true,
        created_at: true,
      },
    });
  },
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
  fetch: (ctx) => {
    const { db, orgId, patientId, caseIds } = ctx;
    return db.externalAccessGrant.findMany({
      where: buildVisibleExternalAccessGrantWhere({
        orgId,
        patientId,
        caseIds,
      }),
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: resolveTimelineSourceTake(ctx, PATIENT_TIMELINE_EXTERNAL_SHARE_LIMIT),
      select: {
        id: true,
        expires_at: true,
        accessed_at: true,
        created_at: true,
      },
    });
  },
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
  fetch: (ctx) => {
    const { db, orgId, patientId, caseIds } = ctx;
    return caseIds.length === 0
      ? Promise.resolve([])
      : db.inquiryRecord.findMany({
          where: {
            org_id: orgId,
            cycle: {
              patient_id: patientId,
              case_id: { in: caseIds },
            },
          },
          orderBy: [
            { resolved_at: 'desc' },
            { inquired_at: 'desc' },
            { created_at: 'desc' },
            { id: 'desc' },
          ],
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
        });
  },
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

export {
  billingCandidatesSource,
  conferenceNotesSource,
  dispenseResultsSource,
  firstVisitDocumentsSource,
  managementPlansSource,
  prescriptionIntakesSource,
} from '@/server/services/patient-detail-timeline-registry-clinical';
import {
  billingCandidatesSource,
  conferenceNotesSource,
  dispenseResultsSource,
  firstVisitDocumentsSource,
  managementPlansSource,
  prescriptionIntakesSource,
} from '@/server/services/patient-detail-timeline-registry-clinical';

export const TIMELINE_SOURCES = [
  visitSchedulesSource,
  visitRecordsSource,
  careReportsSource,
  communicationEventsSource,
  patientMcsMessagesSource,
  partnerVisitRecordsSource,
  operationalTasksSource,
  residualMedicationsSource,
  medicationStockSnapshotsSource,
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
