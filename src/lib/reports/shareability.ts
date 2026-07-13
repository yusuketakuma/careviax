export const SHAREABLE_CARE_REPORT_STATUSES = [
  'confirmed',
  'sent',
  'failed',
  'response_waiting',
] as const;

const shareableCareReportStatusSet = new Set<string>(SHAREABLE_CARE_REPORT_STATUSES);

/**
 * A failed care report is still a finalized document: the delivery failed, not
 * report generation. It remains eligible for retry or an alternate share path.
 */
export function isShareableCareReportStatus(status: string): boolean {
  return shareableCareReportStatusSet.has(status);
}
