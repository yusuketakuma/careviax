import { encodePathSegment } from '@/lib/http/path-segment';

export const GENERATE_CARE_REPORT_FROM_VISIT_API_PATH = '/api/care-reports/generate-from-visit';

export function buildGenerateCareReportFromVisitApiPath() {
  return GENERATE_CARE_REPORT_FROM_VISIT_API_PATH;
}

export function buildCareReportApiPath(reportId: string, suffix = '') {
  return `/api/care-reports/${encodePathSegment(reportId)}${suffix}`;
}

export function buildCareReportPrintAuditApiPath(reportId: string) {
  return buildCareReportApiPath(reportId, '/print-audit');
}
