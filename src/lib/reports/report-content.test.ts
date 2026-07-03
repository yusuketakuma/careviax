import { describe, expect, it } from 'vitest';
import {
  readPartnerVisitSourceRevision,
  readReportSourceProvenance,
  readVisitRecordSourceRevision,
} from './report-content';

describe('readReportSourceProvenance', () => {
  it('returns the source_provenance object when present', () => {
    const content = { source_provenance: { visit_record_id: 'visit_1', source: 'visit_record' } };
    expect(readReportSourceProvenance(content)).toEqual({
      visit_record_id: 'visit_1',
      source: 'visit_record',
    });
  });

  it('returns null for missing / non-object provenance and non-object content', () => {
    expect(readReportSourceProvenance({})).toBeNull();
    expect(readReportSourceProvenance({ source_provenance: null })).toBeNull();
    expect(readReportSourceProvenance({ source_provenance: 'nope' })).toBeNull();
    expect(readReportSourceProvenance(null)).toBeNull();
    expect(readReportSourceProvenance([1, 2, 3])).toBeNull();
    expect(readReportSourceProvenance('string')).toBeNull();
  });
});

describe('readVisitRecordSourceRevision', () => {
  it('extracts version and updated_at from a visit-record provenance', () => {
    const content = {
      source_provenance: {
        visit_record_version: 3,
        visit_record_updated_at: '2026-03-28T08:45:00.000Z',
      },
    };
    expect(readVisitRecordSourceRevision(content)).toEqual({
      visitRecordVersion: 3,
      visitRecordUpdatedAt: '2026-03-28T08:45:00.000Z',
    });
  });

  it('nulls out non-number version and blank / non-string updated_at', () => {
    expect(
      readVisitRecordSourceRevision({
        source_provenance: { visit_record_version: '3', visit_record_updated_at: '   ' },
      }),
    ).toEqual({ visitRecordVersion: null, visitRecordUpdatedAt: null });
    expect(readVisitRecordSourceRevision({})).toEqual({
      visitRecordVersion: null,
      visitRecordUpdatedAt: null,
    });
  });
});

describe('readPartnerVisitSourceRevision', () => {
  it('extracts revision fields and matches when the source id equals the target', () => {
    const content = {
      source_provenance: {
        partner_visit_record_id: 'pvr_1',
        partner_visit_record_revision_no: 2,
        partner_visit_record_updated_at: '2026-03-28T09:00:00.000Z',
      },
    };
    expect(readPartnerVisitSourceRevision(content, 'pvr_1')).toEqual({
      partnerVisitRecordId: 'pvr_1',
      partnerVisitRecordRevisionNo: 2,
      partnerVisitRecordUpdatedAt: '2026-03-28T09:00:00.000Z',
      matchesReportSource: true,
    });
  });

  it('reports mismatch and nulls invalid revision / blank id', () => {
    const content = {
      source_provenance: {
        partner_visit_record_id: 'pvr_other',
        partner_visit_record_revision_no: 1.5,
        partner_visit_record_updated_at: '',
      },
    };
    expect(readPartnerVisitSourceRevision(content, 'pvr_1')).toEqual({
      partnerVisitRecordId: 'pvr_other',
      partnerVisitRecordRevisionNo: null,
      partnerVisitRecordUpdatedAt: null,
      matchesReportSource: false,
    });
  });

  it('nulls the id and does not match when provenance is absent', () => {
    expect(readPartnerVisitSourceRevision({}, 'pvr_1')).toEqual({
      partnerVisitRecordId: null,
      partnerVisitRecordRevisionNo: null,
      partnerVisitRecordUpdatedAt: null,
      matchesReportSource: false,
    });
  });
});
