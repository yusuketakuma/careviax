export function buildVisitHref(visitId: string, suffix = '') {
  if (visitId === '.' || visitId === '..') {
    throw new RangeError('Visit id cannot be a dot segment');
  }

  return `/visits/${encodeURIComponent(visitId)}${suffix}`;
}

export function buildVisitRecordHref(scheduleId: string) {
  return buildVisitHref(scheduleId, '/record');
}
