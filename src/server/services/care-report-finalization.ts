import { createHash } from 'node:crypto';
import { readJsonObject } from '@/lib/db/json';

const DELIVERY_METADATA_CONTENT_KEYS = new Set([
  'report_delivery_targets',
  'delivery_records',
  'delivery_status',
  'send_request_id',
  'send_request_ids',
  'delivery_ack_state',
  'delivery_proof',
  'delivery_retry',
]);

function stableJsonStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
      .join(',')}}`;
  }
  return 'null';
}

export function buildFinalizedCareReportContentSnapshot(content: unknown) {
  const object = readJsonObject(content);
  if (!object) return {};
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => !DELIVERY_METADATA_CONTENT_KEYS.has(key)),
  );
}

export function computeFinalizedCareReportContentHash(content: unknown) {
  return createHash('sha256')
    .update(stableJsonStringify(buildFinalizedCareReportContentSnapshot(content)))
    .digest('hex');
}

export function isCredentialActive(credential: { expiry_date: Date | null }, now: Date) {
  return credential.expiry_date == null || credential.expiry_date.getTime() >= now.getTime();
}
