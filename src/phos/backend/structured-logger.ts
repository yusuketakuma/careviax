import { createHash } from 'node:crypto';
import type { ActionCode, CurrentStep } from '@/phos/contracts/phos_contracts';
import type { TenantContext } from './tenant-context';

export type PhosLogLevel = 'INFO' | 'WARNING' | 'ERROR';

export type PhosLogEntry = {
  level: PhosLogLevel;
  message: string;
  result?: 'SUCCESS' | 'ERROR';
  status_code?: number;
  tenant_id: string;
  user_id: string;
  request_id: string;
  correlation_id: string;
  route_key: string;
  action_code?: ActionCode;
  card_id_hash?: string;
  current_step?: CurrentStep;
  error_code?: string;
  latency_ms?: number;
  details?: Record<string, unknown>;
};

const REDACTED = '[REDACTED]';
const PHI_KEY_PATTERN =
  /patient|name|kana|address|drug|medication|report|photo|image|body|note|summary|authorization|token|password|secret|cookie|database_url|api_key|sha256|checksum|s3_key|evidence_key|mime|content_type|content_length|size_bytes|metadata|file_name|^key$/i;
const WORKFLOW_OBJECT_ID_KEY_PATTERN =
  /(^|_)(card|packet|handoff|delivery|candidate|evidence|report|visit)_?id$|^idempotency_key$/i;

export function hashLogIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function sanitizeIdentifierValue(value: unknown): unknown {
  if (typeof value === 'string') return hashLogIdentifier(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeIdentifierValue(item));
  return value;
}

export function sanitizeLogDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeLogDetails(item));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      PHI_KEY_PATTERN.test(key)
        ? REDACTED
        : WORKFLOW_OBJECT_ID_KEY_PATTERN.test(key)
          ? sanitizeIdentifierValue(child)
          : sanitizeLogDetails(child),
    ]),
  );
}

export function buildLogEntry(input: {
  level: PhosLogLevel;
  message: string;
  ctx: TenantContext;
  route_key: string;
  action_code?: ActionCode;
  card_id?: string;
  current_step?: CurrentStep;
  error_code?: string;
  result?: 'SUCCESS' | 'ERROR';
  status_code?: number;
  latency_ms?: number;
  details?: Record<string, unknown>;
}): PhosLogEntry {
  return {
    level: input.level,
    message: input.message,
    ...(input.result ? { result: input.result } : {}),
    ...(input.status_code != null ? { status_code: input.status_code } : {}),
    tenant_id: input.ctx.tenant_id,
    user_id: input.ctx.user_id,
    request_id: input.ctx.request_id,
    correlation_id: input.ctx.correlation_id,
    route_key: input.route_key,
    ...(input.action_code ? { action_code: input.action_code } : {}),
    ...(input.card_id ? { card_id_hash: hashLogIdentifier(input.card_id) } : {}),
    ...(input.current_step ? { current_step: input.current_step } : {}),
    ...(input.error_code ? { error_code: input.error_code } : {}),
    ...(input.latency_ms != null ? { latency_ms: input.latency_ms } : {}),
    ...(input.details
      ? { details: sanitizeLogDetails(input.details) as Record<string, unknown> }
      : {}),
  };
}

export function logPhosEvent(entry: PhosLogEntry) {
  const line = JSON.stringify(entry);
  if (entry.level === 'ERROR' || entry.level === 'WARNING') {
    console.error(line);
  } else {
    console.log(line);
  }
}
