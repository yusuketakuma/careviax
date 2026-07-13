import { describe, expect, it } from 'vitest';
import {
  buildQrDraftCasesPageSchema,
  buildQrDraftConfirmResponseSchema,
  buildQrDraftDetailResponseSchema,
} from './page-response-schemas';

describe('QR draft detail response schemas', () => {
  it('validates requested draft identity and strips tenant and scanner metadata', () => {
    const result = buildQrDraftDetailResponseSchema('draft_1').parse({
      data: {
        id: 'draft_1',
        org_id: 'org_1',
        site_id: 'site_1',
        scanned_by: 'user_1',
        patient_id: 'patient_1',
        session_id: 'session_1',
        status: 'pending',
        parsed_data: {
          patientName: '患者A',
          splitInfo: { dataId: 'split_1', splitCount: 2, sequenceNumber: 1 },
          lines: [
            {
              drugName: '薬剤A',
              drugCodeResolutionStatus: 'resolved',
              days: 14,
            },
          ],
        },
        parse_errors: [],
        auto_completed: [],
        expected_qr_count: 2,
        jahis_supplemental_records: [],
        created_at: '2026-07-13T00:00:00.000Z',
      },
    });
    expect(result).not.toHaveProperty('org_id');
    expect(result).not.toHaveProperty('scanned_by');
    expect(() =>
      buildQrDraftDetailResponseSchema('draft_2').parse({ data: { ...result, id: 'draft_1' } }),
    ).toThrow();
  });

  it('rejects invalid split sequences and unknown parsed fields', () => {
    const base = {
      id: 'draft_1',
      patient_id: null,
      session_id: 'session_1',
      status: 'pending',
      parse_errors: null,
      auto_completed: null,
      expected_qr_count: null,
      created_at: '2026-07-13T00:00:00.000Z',
    } as const;
    expect(() =>
      buildQrDraftDetailResponseSchema('draft_1').parse({
        data: {
          ...base,
          parsed_data: {
            splitInfo: { dataId: 'split_1', splitCount: 2, sequenceNumber: 3 },
          },
        },
      }),
    ).toThrow('invalid QR split sequence');
    expect(() =>
      buildQrDraftDetailResponseSchema('draft_1').parse({
        data: { ...base, parsed_data: { rawText: 'must not enter client state' } },
      }),
    ).toThrow();
  });

  it('validates active case patient scope, cursor metadata, and projection', () => {
    const schema = buildQrDraftCasesPageSchema('patient_1');
    expect(
      schema.parse({
        data: [
          {
            id: 'case_1',
            patient_id: 'patient_1',
            display_id: 'cc0000000001',
            status: 'active',
            patient: { name: 'removed' },
          },
        ],
        meta: { limit: 20, has_more: false, next_cursor: null },
      }),
    ).toEqual({
      data: [{ id: 'case_1', display_id: 'cc0000000001', status: 'active' }],
      meta: { limit: 20, has_more: false, next_cursor: null },
    });
    expect(() =>
      schema.parse({
        data: [{ id: 'case_1', patient_id: 'patient_2', status: 'active' }],
        meta: { limit: 20, has_more: false, next_cursor: null },
      }),
    ).toThrow('case patient mismatch');
  });

  it('requires confirmation patient and case relations and strips hook metadata', () => {
    const schema = buildQrDraftConfirmResponseSchema('patient_1', 'case_1');
    expect(
      schema.parse({
        data: {
          intake: { id: 'intake_1', lines: [{ drug_name: 'removed' }] },
          cycle: { id: 'cycle_1', patient_id: 'patient_1', case_id: 'case_1' },
          medicationChanges: [{ drug_name: 'removed' }],
          profileSyncResult: { patient_name: 'removed' },
        },
      }),
    ).toEqual({ intake: { id: 'intake_1' }, cycle: { id: 'cycle_1' } });
    expect(() =>
      schema.parse({
        data: {
          intake: { id: 'intake_1' },
          cycle: { id: 'cycle_1', patient_id: 'patient_1', case_id: 'case_2' },
        },
      }),
    ).toThrow();
  });
});
