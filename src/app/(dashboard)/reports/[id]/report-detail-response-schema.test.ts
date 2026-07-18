import { describe, expect, it } from 'vitest';
import {
  buildCareReportDetailResponseSchema,
  externalProfessionalSuggestionsResponseSchema,
} from './report-detail-response-schema';

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'professional_1',
    name: '山田 ケアマネ',
    profession_type: 'care_manager',
    organization_name: '居宅支援A',
    department: null,
    phone: '03-1111-2222',
    email: null,
    fax: '03-1111-3333',
    address: null,
    preferred_contact_method: 'fax',
    preferred_contact_time: null,
    last_contacted_at: '2026-03-30T00:00:00.000Z',
    last_success_channel: 'fax',
    recommended_channels: ['fax', 'phone'],
    contact_reliability: { ready: true, warnings: [], missing_channel_labels: [] },
    is_primary: true,
    source: 'external_professional_master',
    ...overrides,
  };
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    visit_record_id: 'visit_1',
    report_type: 'physician_report',
    status: 'confirmed',
    content: { assessment: 'stable' },
    template_id: null,
    pdf_url: null,
    created_by: 'user_1',
    created_at: '2026-05-12T00:00:00.000Z',
    updated_at: '2026-05-12T00:00:00.000Z',
    delivery_records: [],
    patient_summary: {
      id: 'patient_1',
      name: '患者A',
      name_kana: 'カンジャエー',
      birth_date: '1940-01-01',
      archive: { status: 'active', archived: false, archived_at: null },
    },
    visit_summary: { id: 'visit_1', visit_date: '2026-05-10T00:00:00.000Z' },
    intake_baseline_context: null,
    permissions: {
      can_edit: true,
      can_send: true,
      can_create_external_share: true,
      can_create_followup_task: true,
      can_view_patient: true,
      can_view_related_requests: true,
    },
    delivery_rule_suggestion: null,
    external_professional_suggestions: [suggestion()],
    prescriber_institution_suggestion: null,
    ...overrides,
  };
}

describe('report detail response schemas', () => {
  it('accepts the canonical stored-file PDF path returned by the provider', () => {
    const parsed = buildCareReportDetailResponseSchema('report_1').parse({
      data: report({ pdf_url: '/api/files/file_1/download' }),
    });

    expect(parsed.data.pdf_url).toBe('/api/files/file_1/download');
  });

  it('validates the report scope and strips unused provider metadata', () => {
    const parsed = buildCareReportDetailResponseSchema('report_1').parse({ data: report() });
    expect(parsed.data.id).toBe('report_1');
    expect(parsed.data).not.toHaveProperty('visit_record_id');
    expect(parsed.data).not.toHaveProperty('template_id');
    expect(parsed.data).not.toHaveProperty('intake_baseline_context');
    expect(parsed.data.external_professional_suggestions?.[0]).not.toHaveProperty(
      'contact_reliability',
    );
  });

  it.each([
    ['another report', report({ id: 'report_2' })],
    [
      'cross-patient summary',
      report({
        patient_summary: {
          id: 'patient_2',
          name: '患者B',
          name_kana: null,
          birth_date: null,
          archive: { status: 'active', archived: false, archived_at: null },
        },
      }),
    ],
    [
      'content hidden despite edit permission',
      (() => {
        const value = report();
        delete (value as { content?: unknown }).content;
        return value;
      })(),
    ],
    [
      'recipient contact exposed without send permission',
      report({
        content: undefined,
        permissions: {
          can_edit: false,
          can_send: false,
          can_create_external_share: false,
          can_create_followup_task: false,
          can_view_patient: true,
          can_view_related_requests: false,
        },
        delivery_records: [
          {
            id: 'delivery_1',
            channel: 'fax',
            recipient_name: '医療機関A',
            recipient_contact: '03-1111-2222',
            status: 'sent',
            sent_at: '2026-05-12T01:00:00.000Z',
            created_at: '2026-05-12T00:00:00.000Z',
          },
        ],
        external_professional_suggestions: [],
      }),
    ],
  ])('rejects %s', (_label, data) => {
    expect(buildCareReportDetailResponseSchema('report_1').safeParse({ data }).success).toBe(false);
  });

  it('validates suggestions and removes reliability internals', () => {
    expect(externalProfessionalSuggestionsResponseSchema.parse({ data: [suggestion()] })).toEqual({
      data: [expect.not.objectContaining({ contact_reliability: expect.anything() })],
    });
    expect(
      externalProfessionalSuggestionsResponseSchema.safeParse({
        data: [suggestion(), suggestion()],
      }).success,
    ).toBe(false);
  });
});
