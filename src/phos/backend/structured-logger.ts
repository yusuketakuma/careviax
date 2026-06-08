import type { ActionCode, CurrentStep } from '@/phos/contracts/phos_contracts';
import type { TenantContext } from './tenant-context';

export type PhosLogLevel = 'INFO' | 'WARNING' | 'ERROR';

export type PhosLogEntry = {
  level: PhosLogLevel;
  message: string;
  tenant_id: string;
  user_id: string;
  request_id: string;
  correlation_id: string;
  route_key: string;
  action_code?: ActionCode;
  card_id?: string;
  current_step?: CurrentStep;
  error_code?: string;
  latency_ms?: number;
  details?: Record<string, unknown>;
};

const REDACTED = '[REDACTED]';
const PHI_KEY_PATTERN =
  /patient|name|kana|address|drug|medication|report|photo|image|body|note|summary/i;

export function sanitizeLogDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeLogDetails(item));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      PHI_KEY_PATTERN.test(key) ? REDACTED : sanitizeLogDetails(child),
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
  latency_ms?: number;
  details?: Record<string, unknown>;
}): PhosLogEntry {
  return {
    level: input.level,
    message: input.message,
    tenant_id: input.ctx.tenant_id,
    user_id: input.ctx.user_id,
    request_id: input.ctx.request_id,
    correlation_id: input.ctx.correlation_id,
    route_key: input.route_key,
    ...(input.action_code ? { action_code: input.action_code } : {}),
    ...(input.card_id ? { card_id: input.card_id } : {}),
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
