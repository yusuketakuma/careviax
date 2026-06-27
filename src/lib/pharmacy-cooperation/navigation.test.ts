import { describe, expect, it } from 'vitest';
import { buildPartnerVisitRecordApiPath, buildPartnerVisitRecordHref } from './navigation';

describe('buildPartnerVisitRecordHref', () => {
  it('encodes only the partner visit record id path segment', () => {
    const recordId = 'partner_visit_record/1?tab=x#frag';

    expect(buildPartnerVisitRecordHref(recordId)).toBe(
      `/partner-visit-records/${encodeURIComponent(recordId)}`,
    );
  });

  it('builds the partner visit record detail route for normal ids', () => {
    expect(buildPartnerVisitRecordHref('partner_visit_record_1')).toBe(
      '/partner-visit-records/partner_visit_record_1',
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment record id %s', (recordId) => {
    expect(() => buildPartnerVisitRecordHref(recordId)).toThrow(RangeError);
    expect(() => buildPartnerVisitRecordApiPath(recordId, '/submit')).toThrow(RangeError);
  });
});

describe('buildPartnerVisitRecordApiPath', () => {
  it('builds API paths with the suffix outside the encoded record id', () => {
    const recordId = 'partner_record/1?tab=x#frag';

    expect(buildPartnerVisitRecordApiPath(recordId, '/review')).toBe(
      `/api/partner-visit-records/${encodeURIComponent(recordId)}/review`,
    );
  });

  it('builds the partner visit record API base path without a suffix', () => {
    expect(buildPartnerVisitRecordApiPath('partner_record_1')).toBe(
      '/api/partner-visit-records/partner_record_1',
    );
  });
});
