export function buildReportHref(reportId: string, suffix = '') {
  if (reportId === '.' || reportId === '..') {
    throw new RangeError('Report id cannot be a dot segment');
  }

  return `/reports/${encodeURIComponent(reportId)}${suffix}`;
}
