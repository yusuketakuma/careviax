import { parseJsonObjectOrNull, readJsonObject } from '@/lib/db/json';

export type RealtimeEventPayload = Record<string, unknown> & {
  type: string;
};

const KNOWN_REALTIME_EVENT_TYPES = new Set([
  'care_report_update',
  'comment_refresh',
  'cycle_transition',
  'notification',
  'notification_created',
  'presence_update',
  'prescription_intake_created',
  'qr_draft_confirmed',
  'qr_draft_created',
  'report_delivery_update',
  'visit_schedule_proposals_confirm',
  'workflow_refresh',
]);

const SAFE_EVENT_FIELDS = new Set([
  'active_field',
  'case_id',
  'created_at',
  'cycle_id',
  'entity_id',
  'entity_type',
  'event_type',
  'from',
  'from_status',
  'id',
  'is_read',
  'notification_id',
  'notification_type',
  'proposal_id',
  'report_id',
  'schedule_id',
  'source',
  'status',
  'task_id',
  'to',
  'to_status',
  'updated_at',
  'user_id',
]);

const SAFE_EVENT_FIELDS_BY_TYPE = new Map([['presence_update', new Set(['display_name'])]]);

const SAFE_SOURCE_PATTERN = /^[a-z0-9_.:-]{1,80}$/i;

function isSafeScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function readSafeSource(value: unknown): string | null {
  return typeof value === 'string' && SAFE_SOURCE_PATTERN.test(value) ? value : null;
}

function copySafeFields(source: Record<string, unknown>, target: RealtimeEventPayload) {
  const eventSpecificFields = SAFE_EVENT_FIELDS_BY_TYPE.get(target.type);
  for (const [key, value] of Object.entries(source)) {
    if (key === 'type') continue;
    if (!SAFE_EVENT_FIELDS.has(key) && !eventSpecificFields?.has(key)) continue;
    if (!isSafeScalar(value)) continue;
    if (key === 'source') {
      const safeSource = readSafeSource(value);
      if (safeSource) target.source = safeSource;
      continue;
    }
    target[key] = value;
  }
}

export function normalizeRealtimeEventPayload(value: unknown): RealtimeEventPayload | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const type = object.type;
  if (typeof type !== 'string' || type.trim() === '') return null;

  const normalizedType = type.trim();
  if (!KNOWN_REALTIME_EVENT_TYPES.has(normalizedType)) {
    return { type: 'workflow_refresh', source: 'unknown_event' };
  }

  const normalized: RealtimeEventPayload = { type: normalizedType };
  copySafeFields(object, normalized);

  const payload = readJsonObject(object.payload);
  if (payload) {
    copySafeFields(payload, normalized);
  }

  return normalized;
}

export function parseRealtimeEventPayload(raw: string): RealtimeEventPayload | null {
  return normalizeRealtimeEventPayload(parseJsonObjectOrNull(raw));
}
