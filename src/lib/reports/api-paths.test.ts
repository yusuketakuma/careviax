import { describe, expect, it } from 'vitest';
import { buildCareReportApiPath, buildCareReportPrintAuditApiPath } from './api-paths';

describe('care report API path helpers', () => {
  it('builds care report detail paths for normal ids', () => {
    expect(buildCareReportApiPath('report_1')).toBe('/api/care-reports/report_1');
  });

  it('encodes only the report id path segment', () => {
    const reportId = 'report/1?mode=x#frag';

    expect(buildCareReportApiPath(reportId)).toBe(
      `/api/care-reports/${encodeURIComponent(reportId)}`,
    );
  });

  it('keeps trusted suffixes outside the encoded report id segment', () => {
    const reportId = 'report/1?mode=x#frag';

    expect(buildCareReportApiPath(reportId, '/send')).toBe(
      `/api/care-reports/${encodeURIComponent(reportId)}/send`,
    );
    expect(buildCareReportApiPath(reportId, '/pdf')).toBe(
      `/api/care-reports/${encodeURIComponent(reportId)}/pdf`,
    );
  });

  it('builds print audit paths through the same segment contract', () => {
    const reportId = 'report/1?mode=x#frag';

    expect(buildCareReportPrintAuditApiPath(reportId)).toBe(
      `/api/care-reports/${encodeURIComponent(reportId)}/print-audit`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment report id %s', (reportId) => {
    expect(() => buildCareReportApiPath(reportId)).toThrow(RangeError);
    expect(() => buildCareReportPrintAuditApiPath(reportId)).toThrow(RangeError);
  });
});
