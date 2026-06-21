import type { AuthContext } from '@/lib/auth/context';
import { logger } from '@/lib/utils/logger';

type SesFailureClassification = 'transient' | 'permanent' | 'unknown';

function readExternalErrorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return typeof error;
}

function readExternalHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('$metadata' in error)) return undefined;
  const metadata = error.$metadata;
  if (!metadata || typeof metadata !== 'object' || !('httpStatusCode' in metadata)) {
    return undefined;
  }
  const status = metadata.httpStatusCode;
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}

function classifySesFailure(
  errorName: string,
  httpStatus: number | undefined,
): SesFailureClassification {
  if (httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500)) return 'transient';
  if (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500) return 'permanent';
  if (/throttl|timeout|temporar|serviceunavailable|internal/i.test(errorName)) return 'transient';
  if (/messagerejected|mailfromdomainnotverified|configuration.*not.*exist/i.test(errorName)) {
    return 'permanent';
  }
  return 'unknown';
}

export function logCareReportEmailDeliveryFailure(args: {
  ctx: AuthContext;
  reportId: string;
  deliveryRecordId: string;
  error: unknown;
}) {
  const errorName = readExternalErrorName(args.error);
  const httpStatus = readExternalHttpStatus(args.error);
  const failureClass = classifySesFailure(errorName, httpStatus);

  logger.warn('care report email delivery failed', {
    event: 'care_report.email_delivery_failed',
    orgId: args.ctx.orgId,
    actorId: args.ctx.userId,
    entityType: 'care_report',
    entityId: args.reportId,
    targetId: args.deliveryRecordId,
    externalProvider: 'ses',
    error_name: errorName,
    status: httpStatus,
    failure_class: failureClass,
  });
}
