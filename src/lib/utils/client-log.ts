import { logger } from '@/lib/utils/logger';

/**
 * PHI-safe client observability helper.
 *
 * Passing raw Error objects, provider messages, or payloads directly to the
 * browser console/Sentry can leak patient names, addresses, insurance numbers,
 * or other PHI through error messages and stacks.
 *
 * This helper keeps only a coded `event` name and allowlisted safe context
 * values such as requestId/code. The error is passed through the shared logger's
 * SafeLogContext path, which extracts only `error_name` from allowlisted
 * standard Error types. It never emits error.message or error.stack.
 *
 * Boundaries that need full Sentry exceptions should call `Sentry.captureException`
 * separately so the global beforeSend/sanitizeSentryEvent redaction path applies.
 * Console output for captured errors should go through this helper.
 */

/** Accepts only context values safe for console/Sentry. Free text is redacted by logger. */
export type ClientLogContext = {
  /** Coded reason or status code, for example 'S3_TIMEOUT' or error.digest. */
  code?: string | number | null;
  /** Request correlation ID. */
  requestId?: string | null;
  /** Route identifier, for example '/notifications'. */
  route?: string | null;
  /** HTTP status. */
  status?: string | number | null;
  /** Entity type, not the entity value itself. */
  entityType?: string | null;
  /** Safe numeric count. */
  count?: number | null;
};

const REDACTED = 'redacted';
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const JAPAN_PHONE_PATTERN = /(?:\+81[-\s]?)?0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/u;
const DYNAMIC_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|(?:pat|patient|org|case|visit|user|usr|staff|file|rx|task|report|prescription)_[A-Za-z0-9-]+)$/iu;

function redactIdentifierLikeString(value: string): string {
  if (EMAIL_PATTERN.test(value) || JAPAN_PHONE_PATTERN.test(value)) return REDACTED;
  return value;
}

function redactDynamicRouteSegments(route: string): string {
  const [pathPart, hashPart = ''] = route.split('#', 2);
  const [pathname] = pathPart.split('?', 1);
  return (
    pathname
      .split('/')
      .map((segment) => (DYNAMIC_ID_PATTERN.test(segment) ? '[redacted]' : segment))
      .join('/') + (hashPart ? '#[redacted]' : '')
  );
}

function safeStringContext(key: keyof ClientLogContext, value: string): string {
  const identifierRedacted = redactIdentifierLikeString(value);
  if (identifierRedacted === REDACTED) return REDACTED;
  if (key === 'route') return redactDynamicRouteSegments(identifierRedacted);
  return identifierRedacted;
}

function toSafeContext(event: string, ctx?: ClientLogContext) {
  return {
    event,
    ...(ctx?.code != null
      ? { code: typeof ctx.code === 'string' ? safeStringContext('code', ctx.code) : ctx.code }
      : {}),
    ...(ctx?.requestId != null ? { requestId: safeStringContext('requestId', ctx.requestId) } : {}),
    ...(ctx?.route != null ? { route: safeStringContext('route', ctx.route) } : {}),
    ...(ctx?.status != null
      ? {
          status:
            typeof ctx.status === 'string' ? safeStringContext('status', ctx.status) : ctx.status,
        }
      : {}),
    ...(ctx?.entityType != null
      ? { entityType: safeStringContext('entityType', ctx.entityType) }
      : {}),
    ...(ctx?.count != null ? { count: ctx.count } : {}),
  };
}

export const clientLog = {
  /**
   * Records a non-fatal client event in a PHI-safe shape.
   * @param event Coded event name, usually lower-case dot-separated.
   * @param error Captured error. Only the type is emitted; message/stack are not.
   * @param ctx Safe context values such as requestId/code.
   */
  warn(event: string, error?: unknown, ctx?: ClientLogContext) {
    logger.warn(toSafeContext(event, ctx), error);
  },

  /**
   * Records a fatal client event in a PHI-safe shape.
   * @param event Coded event name, usually lower-case dot-separated.
   * @param error Captured error. Only the type is emitted; message/stack are not.
   * @param ctx Safe context values such as requestId/code.
   */
  error(event: string, error?: unknown, ctx?: ClientLogContext) {
    logger.error(toSafeContext(event, ctx), error);
  },
};
