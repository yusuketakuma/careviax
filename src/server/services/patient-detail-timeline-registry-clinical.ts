import { getConferenceTypeLabel } from '@/lib/visits/visit-workflow-projection';
import {
  buildPharmacyPrescriptionTimelineHref,
  getPharmacyCycleStatusLabel,
} from '@/modules/pharmacy/patient-movement/timeline-links';
import { buildPatientTimelineConferenceNoteWhere } from '@/server/services/patient-detail-timeline-query';
import {
  MANAGEMENT_PLAN_STATUS_LABELS,
  PRESCRIPTION_SOURCE_LABELS,
  type BillingCandidateTimelineSource,
  type ConferenceNoteTimelineSource,
  type DispenseResultTimelineSource,
  type FirstVisitDocumentTimelineSource,
  type ManagementPlanTimelineSource,
  type PrescriptionIntakeTimelineSource,
  buildPatientBillingCandidatesHref,
  compactTimelineValues,
  formatTimelineDate,
  formatTokyoMonthStart,
} from '@/server/services/patient-detail-timeline-events';
import {
  EMPTY,
  defineTimelineSource,
  resolveTimelineSourceTake,
} from '@/server/services/patient-detail-timeline-registry-contract';

const FIRST_VISIT_DOCUMENT_ACTION_VERBS: Record<string, string> = {
  generated: '作成',
  printed: '印刷',
  recovered: '回収',
  image_saved: '画像保存',
  replaced: '差し替え',
  invalidated: '無効化',
};

// --- prescriptionIntakes ----------------------------------------------------
export const prescriptionIntakesSource = defineTimelineSource<
  'prescriptionIntakes',
  PrescriptionIntakeTimelineSource
>({
  key: 'prescriptionIntakes',
  emptyFallback: EMPTY,
  fetch: (ctx) => {
    const { db, orgId, patientId, caseIds } = ctx;
    return caseIds.length === 0
      ? Promise.resolve([])
      : db.prescriptionIntake.findMany({
          where: {
            org_id: orgId,
            cycle: {
              patient_id: patientId,
              case_id: { in: caseIds },
            },
          },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
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
        });
  },
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
  fetch: (ctx) => {
    const { db, orgId, patientId, caseIds } = ctx;
    return caseIds.length === 0
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
          orderBy: [{ dispensed_at: 'desc' }, { id: 'desc' }],
          take: resolveTimelineSourceTake(ctx, 12),
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
        });
  },
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
  fetch: (ctx) => {
    const { db, orgId, caseIds } = ctx;
    return caseIds.length === 0
      ? Promise.resolve([])
      : db.managementPlan.findMany({
          where: {
            org_id: orgId,
            case_id: {
              in: caseIds,
            },
          },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
          take: 6,
          select: {
            id: true,
            status: true,
            approved_at: true,
            reviewed_at: true,
            created_at: true,
          },
        });
  },
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
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
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
  fetch: (ctx) => {
    const { db, orgId, patientId, caseIds } = ctx;
    return db.conferenceNote.findMany({
      where: {
        ...buildPatientTimelineConferenceNoteWhere({
          orgId,
          patientId,
          caseIds,
        }),
      },
      orderBy: [{ conference_date: 'desc' }, { id: 'desc' }],
      take: 8,
      select: {
        id: true,
        note_type: true,
        conference_date: true,
        follow_up_date: true,
        follow_up_completed: true,
        generated_report_id: true,
      },
    });
  },
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
  fetch: (ctx) => {
    const { db, orgId, patientId, canManageBilling, billingRefs } = ctx;
    return canManageBilling
      ? db.billingCandidate.findMany({
          where: {
            org_id: orgId,
            patient_id: patientId,
            ...(billingRefs.cycleIds.length === 0
              ? { id: { in: [] } }
              : { cycle_id: { in: billingRefs.cycleIds } }),
          },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
          take: 8,
          select: {
            id: true,
            billing_month: true,
            billing_code: true,
            status: true,
            updated_at: true,
          },
        })
      : Promise.resolve([]);
  },
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
