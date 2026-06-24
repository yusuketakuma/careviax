export function buildPartnerVisitRecordHref(recordId: string) {
  if (recordId === '.' || recordId === '..') {
    throw new RangeError('Partner visit record id cannot be a dot segment');
  }

  return `/partner-visit-records/${encodeURIComponent(recordId)}`;
}
