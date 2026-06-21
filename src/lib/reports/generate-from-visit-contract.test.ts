import { describe, expect, it } from 'vitest';
import { generatedCareReportFromVisitResponseSchema } from './generate-from-visit-contract';

describe('generate-from-visit contract', () => {
  it('accepts generated report summaries returned by the API route', () => {
    expect(
      generatedCareReportFromVisitResponseSchema.safeParse({
        data: [
          {
            id: 'report_1',
            report_type: 'physician_report',
            status: 'draft',
            updated_at: '2026-06-18T02:30:00.000Z',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects incomplete generated report summaries', () => {
    expect(
      generatedCareReportFromVisitResponseSchema.safeParse({
        data: [
          {
            id: 'report_1',
            report_type: 'physician_report',
            updated_at: '2026-06-18T02:30:00.000Z',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects malformed generated report version tokens', () => {
    expect(
      generatedCareReportFromVisitResponseSchema.safeParse({
        data: [
          {
            id: 'report_1',
            report_type: 'physician_report',
            status: 'draft',
            updated_at: 'not-a-date',
          },
        ],
      }).success,
    ).toBe(false);
  });
});
