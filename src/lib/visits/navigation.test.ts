import { describe, expect, it } from 'vitest';
import { buildVisitHref, buildVisitRecordHref } from './navigation';

describe('visit navigation helpers', () => {
  it('encodes only the visit id path segment', () => {
    const visitId = 'visit/1?mode=x#frag';

    expect(buildVisitHref(visitId)).toBe(`/visits/${encodeURIComponent(visitId)}`);
  });

  it('builds the visit detail route for normal ids', () => {
    expect(buildVisitHref('visit_1')).toBe('/visits/visit_1');
  });

  it('builds record-entry hrefs with the record suffix outside the encoded schedule id', () => {
    const scheduleId = 'schedule/1?mode=x#frag';

    expect(buildVisitRecordHref(scheduleId)).toBe(
      `/visits/${encodeURIComponent(scheduleId)}/record`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment visit id %s', (visitId) => {
    expect(() => buildVisitHref(visitId)).toThrow(RangeError);
    expect(() => buildVisitRecordHref(visitId)).toThrow(RangeError);
  });
});
