export function buildTracingReportPdfPath(reportId: string) {
  if (reportId === '.' || reportId === '..') {
    throw new RangeError('Tracing report id cannot be a dot segment');
  }

  const encodedReportId = encodeURIComponent(reportId);
  return `/api/tracing-reports/${encodedReportId}/pdf`;
}
