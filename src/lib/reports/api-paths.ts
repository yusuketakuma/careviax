import { encodePathSegment } from '@/lib/http/path-segment';

export function buildCareReportApiPath(reportId: string, suffix = '') {
  return `/api/care-reports/${encodePathSegment(reportId)}${suffix}`;
}

export function buildCareReportPrintAuditApiPath(reportId: string) {
  return buildCareReportApiPath(reportId, '/print-audit');
}
