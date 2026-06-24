import { describe, expect, it } from 'vitest';
import { buildReportHref } from './navigation';

describe('buildReportHref', () => {
  it('encodes only the report id path segment', () => {
    const reportId = 'report/1?tab=x#frag';

    expect(buildReportHref(reportId)).toBe(`/reports/${encodeURIComponent(reportId)}`);
  });

  it('builds the report detail route for normal ids', () => {
    expect(buildReportHref('report_1')).toBe('/reports/report_1');
  });

  it.each(['.', '..'])('rejects exact dot-segment report id %s', (reportId) => {
    expect(() => buildReportHref(reportId)).toThrow(RangeError);
  });
});
