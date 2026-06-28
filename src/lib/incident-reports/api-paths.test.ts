import { describe, expect, it } from 'vitest';
import { INCIDENT_REPORTS_API_PATH, buildIncidentReportApiPath } from './api-paths';

describe('incident report API path helpers', () => {
  it('builds the collection API path', () => {
    expect(INCIDENT_REPORTS_API_PATH).toBe('/api/incident-reports');
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildIncidentReportApiPath('incident_1')).toBe('/api/incident-reports/incident_1');
  });

  it('encodes hostile ids as a single path segment', () => {
    const hostileId = 'incident/1?mode=x#frag';

    expect(buildIncidentReportApiPath(hostileId)).toBe(
      `/api/incident-reports/${encodeURIComponent(hostileId)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment report id %s', (reportId) => {
    expect(() => buildIncidentReportApiPath(reportId)).toThrow(RangeError);
  });
});
