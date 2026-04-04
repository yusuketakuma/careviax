import * as Sentry from '@sentry/nextjs';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

function buildEntry(level: LogLevel, message: string, ctx?: LogContext) {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: 'careviax',
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

export const logger = {
  debug(message: string, ctx?: LogContext) {
    if (process.env.NODE_ENV !== 'production') {
      log('debug', message, ctx);
    }
  },

  info(message: string, ctx?: LogContext) {
    log('info', message, ctx);
  },

  warn(message: string, ctx?: LogContext) {
    log('warn', message, ctx);
    if (process.env.NODE_ENV === 'production') {
      Sentry.captureMessage(message, { level: 'warning', extra: ctx });
    }
  },

  error(message: string, error?: unknown, ctx?: LogContext) {
    const errorMeta =
      error instanceof Error
        ? { error_message: error.message, error_name: error.name, stack: error.stack }
        : error !== undefined
          ? { error_raw: String(error) }
          : {};

    log('error', message, { ...errorMeta, ...ctx });

    if (process.env.NODE_ENV === 'production') {
      if (error instanceof Error) {
        Sentry.captureException(error, { extra: ctx });
      } else {
        Sentry.captureMessage(message, { level: 'error', extra: { ...errorMeta, ...ctx } });
      }
    }
  },
};
