import { describe, expect, it } from 'vitest';
import {
  buildConsentListResponseSchema,
  buildConsentRecordResponseSchema,
  consentTemplateListResponseSchema,
} from './response-schemas';

function consentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'consent_1',
    patient_id: 'patient_1',
    template_id: null,
    template_version: null,
    template: null,
    consent_type: 'external_sharing',
    method: 'paper_scan',
    obtained_date: '2026-07-01T00:00:00.000Z',
    expiry_date: null,
    revoked_date: null,
    document_url: null,
    has_document_url: false,
    document_url_redacted: false,
    is_active: true,
    access_restricted: false,
    created_at: '2026-07-01T09:00:00.000Z',
    ...overrides,
  };
}

function consentList(data: unknown[]) {
  return {
    data,
    meta: { limit: 50, has_more: false, next_cursor: null, total_count: data.length },
  };
}

describe('consent response schemas', () => {
  it('accepts a complete untruncated template list and minimizes template fields', () => {
    const parsed = consentTemplateListResponseSchema.parse({
      data: [{ id: 'template_1', name: '同意書', version: 2, is_default: true, content: {} }],
      meta: {
        total_count: 1,
        visible_count: 1,
        hidden_count: 0,
        truncated: false,
        count_basis: 'templates',
        filters_applied: { template_type: 'consent_form', target_role: null },
        limit: 100,
      },
    });

    expect(parsed.data[0]).toEqual({
      id: 'template_1',
      name: '同意書',
      version: 2,
      is_default: true,
    });
  });

  it('rejects a truncated template list that the consumer cannot paginate', () => {
    expect(
      consentTemplateListResponseSchema.safeParse({
        data: [],
        meta: {
          total_count: 1,
          visible_count: 0,
          hidden_count: 1,
          truncated: true,
          count_basis: 'templates',
          filters_applied: { template_type: 'consent_form', target_role: null },
          limit: 100,
        },
      }).success,
    ).toBe(false);
  });

  it('accepts persisted ISO dates and a newest-first patient-scoped list', () => {
    const parsed = buildConsentListResponseSchema('patient_1').parse(
      consentList([
        consentRecord(),
        consentRecord({
          id: 'consent_2',
          obtained_date: '2026-06-01T00:00:00.000Z',
          is_active: false,
          revoked_date: '2026-06-10T00:00:00.000Z',
        }),
      ]),
    );

    expect(parsed.data).toHaveLength(2);
  });

  it.each([
    ['another patient', consentRecord({ patient_id: 'patient_2' })],
    ['active revoked record', consentRecord({ revoked_date: '2026-07-02T00:00:00.000Z' })],
    [
      'unsafe document URL',
      consentRecord({
        document_url: 'https://example.com/consent.pdf',
        has_document_url: true,
      }),
    ],
    ['expiry before obtainment', consentRecord({ expiry_date: '2026-06-30T00:00:00.000Z' })],
  ])('rejects %s', (_label, record) => {
    expect(
      buildConsentListResponseSchema('patient_1').safeParse(consentList([record])).success,
    ).toBe(false);
  });

  it('requires mutation responses to retain patient, record, and active-state scope', () => {
    const schema = buildConsentRecordResponseSchema({
      patientId: 'patient_1',
      recordId: 'consent_1',
      expectedActive: false,
    });

    expect(
      schema.safeParse({
        data: consentRecord({ is_active: false, revoked_date: '2026-07-02T00:00:00.000Z' }),
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ data: consentRecord() }).success).toBe(false);
  });
});
