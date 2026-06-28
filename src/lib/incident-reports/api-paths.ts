import { encodePathSegment } from '@/lib/http/path-segment';

export const INCIDENT_REPORTS_API_PATH = '/api/incident-reports';

export function buildIncidentReportApiPath(reportId: string) {
  return `${INCIDENT_REPORTS_API_PATH}/${encodePathSegment(reportId)}`;
}
