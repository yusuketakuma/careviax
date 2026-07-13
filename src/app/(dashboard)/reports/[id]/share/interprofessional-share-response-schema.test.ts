import { describe, expect, it } from 'vitest';
import { buildInterprofessionalShareReportResponseSchema } from './interprofessional-share-response-schema';

const report = {
  id: 'report_1',
  patient_id: 'patient_1',
  case_id: 'case_1',
  report_type: 'care_manager_report',
  updated_at: '2026-07-13T00:00:00.000Z',
  status: 'sent',
  content: { summary: '服薬状況' },
  pdf_url: '/api/files/file_1/download',
  patient_summary: {
    id: 'patient_1',
    name: '佐藤 花子',
    archive: { status: 'active', archived: false, archived_at: null },
    birth_date: '1940-01-01',
  },
  permissions: {
    can_edit: true,
    can_send: true,
    can_create_external_share: true,
    can_create_followup_task: true,
    can_view_patient: true,
    can_view_related_requests: true,
  },
  delivery_records: [{ id: 'must-not-enter-client-state' }],
};

describe('interprofessional share report response schema', () => {
  it('binds the requested report and projects PDF presence without caching its URL', () => {
    const parsed = buildInterprofessionalShareReportResponseSchema('report_1').parse({
      data: report,
    });

    expect(parsed.data.has_pdf).toBe(true);
    expect(parsed.data).not.toHaveProperty('pdf_url');
    expect(parsed.data).not.toHaveProperty('delivery_records');
    expect(parsed.data.patient_summary).not.toHaveProperty('birth_date');
  });

  it('rejects report, patient, and permission visibility drift', () => {
    const schema = buildInterprofessionalShareReportResponseSchema('report_1');
    expect(schema.safeParse({ data: { ...report, id: 'report_2' } }).success).toBe(false);
    expect(
      schema.safeParse({
        data: {
          ...report,
          patient_summary: { ...report.patient_summary, id: 'patient_2' },
        },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: {
          ...report,
          permissions: { ...report.permissions, can_send: false },
        },
      }).success,
    ).toBe(false);
  });

  it('keeps null PDF absence distinct from an available PDF', () => {
    const parsed = buildInterprofessionalShareReportResponseSchema('report_1').parse({
      data: { ...report, pdf_url: null },
    });
    expect(parsed.data.has_pdf).toBe(false);
  });
});
