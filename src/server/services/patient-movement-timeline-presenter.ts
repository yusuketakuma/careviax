import type { TimelineEvent } from '@/server/services/patient-detail-timeline-events';
import type {
  PatientMovementCategory,
  PatientMovementEventType,
  PatientMovementSeverity,
  PatientMovementTimelineEvent,
} from '@/types/patient-movement-timeline';

type MovementProjectionOptions = {
  patientId: string;
};

const GENERIC_DETAIL_SUMMARIES = {
  prescription: '処方登録または処方変更がありました。内容は処方詳細で確認してください。',
  visit: '訪問予定または訪問記録が登録されました。内容は訪問詳細で確認してください。',
  document: '文書登録または文書状態の更新がありました。本文は詳細画面で確認してください。',
} as const;

const VISIT_EVENT_TYPES = new Set(['visit_schedule', 'visit_record']);
const PRESCRIPTION_EVENT_TYPES = new Set(['prescription_intake', 'dispense_result', 'inquiry']);
const DOCUMENT_EVENT_TYPES = new Set([
  'care_report',
  'delivery_record',
  'management_plan',
  'first_visit_document',
]);
const DIRECT_MOVEMENT_EVENT_TYPES = new Set<PatientMovementEventType>([
  'communication',
  'self_report',
  'external_share',
  'conference_note',
  'billing_candidate',
  'operation_history',
  'inbound_communication',
  'inbound_mcs',
  'inbound_phone',
  'inbound_fax',
  'inbound_email',
  'inbound_medication_stock_signal',
  'medication_stock_event',
  'medication_stock_snapshot',
  'medication_equivalence_review',
  'interprofessional_note',
  'care_team_update',
  'safety_signal',
  'task_created',
  'task_resolved',
  'support_session',
]);

function normalizeRelativeHref(href: string | null | undefined, fallback: string) {
  if (!href) return fallback;
  if (!href.startsWith('/') || href.startsWith('//')) return fallback;
  return href;
}

function movementCategoryOf(event: TimelineEvent): PatientMovementCategory {
  if (event.category === 'visit') return 'visit';
  if (event.category === 'prescription') return 'prescription';
  if (event.category === 'document') return 'document';
  if (event.category === 'billing') return 'billing';
  if (event.category === 'communication') return 'communication';
  if (event.category === 'interprofessional') return 'interprofessional';
  if (event.category === 'medication_stock') return 'medication_stock';
  if (event.category === 'safety') return 'safety';
  if (event.category === 'task') return 'task';
  return 'system';
}

function movementTypeOf(event: TimelineEvent): PatientMovementEventType {
  if (event.category === 'visit') return 'visit_event';
  if (event.category === 'prescription') return 'prescription_event';
  if (event.category === 'document') return 'document_registered';
  if (VISIT_EVENT_TYPES.has(event.event_type)) return 'visit_event';
  if (PRESCRIPTION_EVENT_TYPES.has(event.event_type)) return 'prescription_event';
  if (DOCUMENT_EVENT_TYPES.has(event.event_type)) return 'document_registered';
  if (DIRECT_MOVEMENT_EVENT_TYPES.has(event.event_type as PatientMovementEventType)) {
    return event.event_type as PatientMovementEventType;
  }
  return 'operation_history';
}

function severityOf(event: TimelineEvent): PatientMovementSeverity {
  const status = event.status.toLowerCase();
  const statusLabel = event.status_label.toLowerCase();
  if (
    status.includes('failed') ||
    status.includes('blocked') ||
    status.includes('cancel') ||
    statusLabel.includes('失敗') ||
    statusLabel.includes('中止')
  ) {
    return 'warning';
  }
  return 'normal';
}

function statusBadgeTone(
  event: TimelineEvent,
): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  const severity = severityOf(event);
  if (severity === 'warning' || severity === 'urgent' || severity === 'blocking') return 'warning';
  if (
    event.status_label.includes('済') ||
    event.status_label.includes('完了') ||
    event.status_label.includes('承認')
  ) {
    return 'success';
  }
  return 'neutral';
}

function summaryOf(event: TimelineEvent) {
  if (event.category === 'prescription') return GENERIC_DETAIL_SUMMARIES.prescription;
  if (event.category === 'visit') return GENERIC_DETAIL_SUMMARIES.visit;
  if (event.category === 'document') return GENERIC_DETAIL_SUMMARIES.document;
  return event.summary;
}

function metadataOf(event: TimelineEvent) {
  if (
    event.category === 'prescription' ||
    event.category === 'visit' ||
    event.category === 'document'
  ) {
    return [];
  }
  return event.metadata;
}

function relatedEntityTypeOf(event: TimelineEvent) {
  const [prefix] = event.id.split(':');
  return prefix || null;
}

function relatedEntityIdOf(event: TimelineEvent) {
  const [, ...rest] = event.id.split(':');
  return rest.length > 0 ? rest.join(':') : null;
}

function privacyLevelOf(event: TimelineEvent, category: PatientMovementCategory) {
  if (category === 'communication') return 'detail';
  return 'summary';
}

export function toPatientMovementTimelineEvent(
  event: TimelineEvent,
  options: MovementProjectionOptions,
): PatientMovementTimelineEvent<Date> {
  const fallbackHref = `/patients/${encodeURIComponent(options.patientId)}#patient-movement`;
  const category = movementCategoryOf(event);
  const statusLabel = event.status_label || null;

  return {
    id: event.id,
    event_type: movementTypeOf(event),
    category,
    occurred_at: event.occurred_at,
    recorded_at: null,
    title: event.title,
    summary: summaryOf(event),
    href: normalizeRelativeHref(event.href, fallbackHref),
    action_label: event.action_label ?? '詳細を開く',
    status: event.status || null,
    status_label: statusLabel,
    actor_name: event.actor_name,
    actor_role: null,
    source_channel: null,
    source_label: null,
    related_entity_type: relatedEntityTypeOf(event),
    related_entity_id: relatedEntityIdOf(event),
    severity: severityOf(event),
    badges: statusLabel ? [{ label: statusLabel, tone: statusBadgeTone(event) }] : [],
    metadata: metadataOf(event),
    privacy_level: privacyLevelOf(event, category),
    raw_available: false,
  };
}

export function buildPatientMovementTimelineEvents(
  events: readonly TimelineEvent[],
  options: MovementProjectionOptions,
): PatientMovementTimelineEvent<Date>[] {
  return events.map((event) => toPatientMovementTimelineEvent(event, options));
}
