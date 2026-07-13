import { describe, expect, it } from 'vitest';
import {
  buildPrintHubPatientDocumentsResponseSchema,
  buildPrintHubPrescriptionsPageSchema,
  buildPrintHubSetPlansResponseSchema,
} from './print-hub-response-schemas';

describe('print hub response schemas', () => {
  it('validates set-plan patient and cycle relations and strips provider-only fields', () => {
    const schema = buildPrintHubSetPlansResponseSchema('patient_1');
    const result = schema.parse({
      data: [
        {
          id: 'plan_1',
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          target_period_start: '2026-07-01T00:00:00.000Z',
          target_period_end: '2026-07-28T00:00:00.000Z',
          set_method: 'facility_calendar',
          packaging_summary_snapshot: null,
          notes: null,
          created_at: '2026-07-01T00:00:00.000Z',
          packaging_method_ref: null,
          cycle: {
            id: 'cycle_1',
            patient_id: 'patient_1',
            overall_status: 'set_in_progress',
            case_: {
              patient: {
                id: 'patient_1',
                name: '患者A',
                name_kana: 'カンジャエー',
              },
            },
          },
          audits: [],
        },
      ],
    });
    expect(result.data[0]).not.toHaveProperty('org_id');
    expect(result.data[0]?.cycle).not.toHaveProperty('overall_status');
    expect(() =>
      schema.parse({
        data: [
          {
            ...result.data[0],
            cycle: { ...result.data[0]?.cycle, patient_id: 'patient_2' },
          },
        ],
      }),
    ).toThrow('set plan patient or cycle relation mismatch');
  });

  it('validates prescription page identity, bounds, and cursor contract', () => {
    const schema = buildPrintHubPrescriptionsPageSchema('patient_1');
    expect(
      schema.parse({
        data: {
          patient: { id: 'patient_1', name: '患者A', name_kana: 'カンジャエー' },
          data: [
            {
              id: 'intake_1',
              cycle_id: 'cycle_1',
              prescribed_date: '2026-07-01',
              prescriber_name: null,
              prescriber_institution: null,
              provider_only: 'removed',
              lines: [
                {
                  id: 'line_1',
                  line_number: 1,
                  drug_name: '薬剤A',
                  dose: null,
                  frequency: null,
                  days: null,
                  quantity: null,
                  unit: null,
                  notes: null,
                  drug_code: 'removed',
                },
              ],
            },
          ],
          hasMore: true,
          nextCursor: 'cursor_2',
        },
      }).data[0],
    ).not.toHaveProperty('provider_only');
    expect(() =>
      schema.parse({
        data: {
          patient: { id: 'patient_1', name: '患者A', name_kana: '' },
          data: [],
          hasMore: true,
          nextCursor: null,
        },
      }),
    ).toThrow('prescription cursor mismatch');
  });

  it('validates document patient identity, safe links, readiness arithmetic, and uniqueness', () => {
    const schema = buildPrintHubPatientDocumentsResponseSchema('patient_1');
    const valid = {
      data: {
        patient: { id: 'patient_1', name: '患者A', name_kana: 'カンジャエー' },
        print_readiness: {
          overall_status: 'warning',
          missing_required_count: 0,
          warning_count: 1,
          template_versions: [],
          checks: [
            {
              key: 'warning_1',
              label: '任意確認',
              completed: false,
              severity: 'warning',
              description: '確認してください',
              action_href: '/patients/patient_1/edit',
              action_label: '確認する',
            },
          ],
        },
        first_visit_documents: [
          {
            id: 'doc_1',
            case_id: 'case_1',
            document_url: '/reports/print?copy=1',
            delivered_at: null,
            delivered_to: null,
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-01T00:00:00.000Z',
            emergency_contacts: [],
            history: [],
          },
        ],
      },
    } as const;
    expect(schema.parse(valid).first_visit_documents).toHaveLength(1);
    expect(() =>
      schema.parse({
        ...valid,
        data: {
          ...valid.data,
          print_readiness: { ...valid.data.print_readiness, warning_count: 0 },
        },
      }),
    ).toThrow('print readiness counts mismatch');
    expect(() =>
      schema.parse({
        ...valid,
        data: {
          ...valid.data,
          first_visit_documents: [
            { ...valid.data.first_visit_documents[0], document_url: '//evil.example/document' },
          ],
        },
      }),
    ).toThrow();
  });
});
