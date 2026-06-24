import { describe, expect, it } from 'vitest';
import { buildTracingReportPdfPath } from './tracing-report-pdf-path';

describe('buildTracingReportPdfPath', () => {
  it('encodes only the tracing report id path segment', () => {
    const path = buildTracingReportPdfPath('tracing/with space%2F?x=#');

    expect(path).toBe('/api/tracing-reports/tracing%2Fwith%20space%252F%3Fx%3D%23/pdf');
    expect(new URL(path, 'http://localhost').pathname).toBe(path);
  });

  it('rejects exact dot-segment ids that cannot be represented safely in this route', () => {
    expect(() => buildTracingReportPdfPath('.')).toThrow(RangeError);
    expect(() => buildTracingReportPdfPath('..')).toThrow(RangeError);

    const path = buildTracingReportPdfPath('../x');
    expect(path).toBe('/api/tracing-reports/..%2Fx/pdf');
    expect(new URL(path, 'http://localhost').pathname).toBe(path);
  });
});
