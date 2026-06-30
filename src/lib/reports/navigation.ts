export function buildReportHref(reportId: string, suffix = '') {
  if (reportId === '.' || reportId === '..') {
    throw new RangeError('Report id cannot be a dot segment');
  }

  return `/reports/${encodeURIComponent(reportId)}${suffix}`;
}

export function buildReportSendHref(
  reportId: string,
  options: { action?: 'send' | 'resend'; deliveryRecordId?: string | null } = {},
) {
  const params = new URLSearchParams({ action: options.action ?? 'send' });
  if (options.deliveryRecordId?.trim()) {
    params.set('delivery_id', options.deliveryRecordId);
  }
  return `${buildReportHref(reportId)}?${params.toString()}`;
}
