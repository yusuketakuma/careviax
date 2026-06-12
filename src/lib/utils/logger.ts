import * as Sentry from '@sentry/nextjs';
import { sanitizeSentryValue } from '@/lib/observability/sentry-redaction';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;
type SafeLogValue = string | number | boolean | null | undefined;
type SafeLogContext = {
  event: string;
  orgId?: SafeLogValue;
  actorId?: SafeLogValue;
  userId?: SafeLogValue;
  entityType?: SafeLogValue;
  entityId?: SafeLogValue;
  targetId?: SafeLogValue;
  code?: SafeLogValue;
  route?: SafeLogValue;
  method?: SafeLogValue;
  status?: SafeLogValue;
  operation?: SafeLogValue;
  jobType?: SafeLogValue;
  filePurpose?: SafeLogValue;
  runtime?: SafeLogValue;
  phase?: SafeLogValue;
  attempt?: SafeLogValue;
  count?: SafeLogValue;
  durationMs?: SafeLogValue;
  requestId?: SafeLogValue;
  externalProvider?: SafeLogValue;
};

const SAFE_EVENT_PATTERN = /^[a-z][a-z0-9_.-]{1,127}$/;
const SAFE_STRING_PATTERN = /^[A-Za-z0-9_.:/@-]{1,160}$/;

function normalizeSafeString(value: string): string {
  const trimmed = value.trim();
  if (SAFE_STRING_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return 'redacted';
}

function normalizeSafeValue(value: SafeLogValue): string | number | boolean | null | undefined {
  if (value === undefined || value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  return normalizeSafeString(value);
}

export function buildSafeLogContext(ctx: SafeLogContext): LogContext {
  const normalized: LogContext = {
    event: SAFE_EVENT_PATTERN.test(ctx.event) ? ctx.event : 'invalid_event_name',
  };

  for (const [key, value] of Object.entries(ctx)) {
    if (key === 'event') continue;
    const safeValue = normalizeSafeValue(value as SafeLogValue);
    if (safeValue !== undefined) {
      normalized[key] = safeValue;
    }
  }

  return normalized;
}

function buildSafeErrorMeta(error: unknown): LogContext {
  if (error instanceof Error) {
    return { error_name: normalizeSafeString(error.name || 'Error') };
  }
  if (error === undefined) {
    return {};
  }
  return { error_name: typeof error };
}

function redactCtx(ctx: LogContext | undefined): LogContext | undefined {
  if (!ctx) return ctx;
  return sanitizeSentryValue(ctx) as LogContext;
}

function buildEntry(level: LogLevel, message: string, ctx?: LogContext) {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: 'ph-os',
    ...(ctx ?? {}),
  };
}

function log(level: LogLevel, message: string, ctx?: LogContext) {
  const entry = buildEntry(level, message, ctx);
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

function safeLog(level: 'warn' | 'error', ctx: SafeLogContext, error?: unknown) {
  const safeContext = {
    ...buildSafeErrorMeta(error),
    ...buildSafeLogContext(ctx),
  };
  const event = String(safeContext.event);
  log(level, event, safeContext);

  if (process.env.NODE_ENV === 'production') {
    Sentry.captureMessage(event, {
      level: level === 'warn' ? 'warning' : 'error',
      extra: redactCtx(safeContext),
    });
  }
}

function warn(message: string, ctx?: LogContext): void;
function warn(ctx: SafeLogContext): void;
function warn(messageOrContext: string | SafeLogContext, ctx?: LogContext) {
  if (typeof messageOrContext !== 'string') {
    safeLog('warn', messageOrContext);
    return;
  }
  const message = messageOrContext;
  log('warn', message, ctx);
  if (process.env.NODE_ENV === 'production') {
    Sentry.captureMessage(message, { level: 'warning', extra: redactCtx(ctx) });
  }
}

function error(message: string, error?: unknown, ctx?: LogContext): void;
function error(ctx: SafeLogContext, error?: unknown): void;
function error(messageOrContext: string | SafeLogContext, error?: unknown, ctx?: LogContext) {
  if (typeof messageOrContext !== 'string') {
    safeLog('error', messageOrContext, error);
    return;
  }
  const message = messageOrContext;
  const errorMeta =
    error instanceof Error
      ? { error_message: error.message, error_name: error.name, stack: error.stack }
      : error !== undefined
        ? { error_raw: String(error) }
        : {};

  log('error', message, { ...errorMeta, ...ctx });

  if (process.env.NODE_ENV === 'production') {
    if (error instanceof Error) {
      Sentry.captureException(error, { extra: redactCtx(ctx) });
    } else {
      Sentry.captureMessage(message, {
        level: 'error',
        extra: redactCtx({ ...errorMeta, ...ctx }),
      });
    }
  }
}

export const logger = {
  debug(message: string, ctx?: LogContext) {
    if (process.env.NODE_ENV !== 'production') {
      log('debug', message, ctx);
    }
  },

  info(message: string, ctx?: LogContext) {
    log('info', message, ctx);
  },

  warn,
  error,
};
