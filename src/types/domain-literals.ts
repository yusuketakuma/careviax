export const EXCEPTION_SEVERITIES = ['critical', 'warning', 'info'] as const;
export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

export const EXCEPTION_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];
