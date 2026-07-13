import { describe, expect, it } from 'vitest';
import {
  buildBillingCandidateGenerationResponseSchema,
  buildBillingCandidateReviewResponseSchema,
  buildBillingCandidatesPageResponseSchema,
  buildBillingCloseResponseSchema,
  buildBillingExportPreviewResponseSchema,
} from './billing-candidates-response-schemas';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'candidate_1',
    patient_id: 'patient_1',
    patient_name: '患者A',
    billing_domain: 'home_care',
    billing_month: '2026-07-01T00:00:00.000Z',
    billing_code: 'MED_HOME_VISIT',
    billing_name: '在宅患者訪問薬剤管理指導料',
    points: 650,
    quantity: 1,
    status: 'confirmed',
    exclusion_reason: null,
    updated_at: '2026-07-13T00:00:00.000Z',
    source_snapshot: {
      validation_layers: {
        evidence: { label: '証跡', state: 'passed', message: '確認済み' },
      },
      raw_patient_detail: 'removed',
    },
    workflow_state: { review_state: 'reviewed', resolution_state: 'confirmed' },
    ...overrides,
  };
}

describe('billing candidate response schemas', () => {
  it('validates page scope, cursor, summary arithmetic, and strips provider-only fields', () => {
    const schema = buildBillingCandidatesPageResponseSchema({
      billingMonth: '2026-07-01',
      billingDomain: 'home_care',
      patientId: 'patient_1',
    });
    const result = schema.parse({
      data: [candidate()],
      meta: {
        limit: 50,
        has_more: false,
        next_cursor: null,
        summary: {
          total: 1,
          pending_review: 0,
          confirmed: 1,
          excluded: 0,
          exported: 0,
          reviewed: 1,
          ready_to_close: 1,
          blocked_from_close: 0,
          blocker_reasons: [],
        },
      },
    });
    expect(result.data[0]?.source_snapshot).not.toHaveProperty('raw_patient_detail');
    expect(() =>
      schema.parse({
        data: [candidate({ patient_id: 'patient_2' })],
        meta: { ...result.meta, summary: null },
      }),
    ).toThrow('billing candidate outside requested scope');
  });

  it('validates export preview totals and exact request scope', () => {
    const schema = buildBillingExportPreviewResponseSchema({
      billingMonth: '2026-07-01',
      billingDomain: 'home_care',
    });
    const valid = {
      data: {
        billing_month: '2026-07-01',
        billing_domain: 'home_care',
        total_count: 2,
        exportable_count: 1,
        total_points: 650,
        total_amount_yen: 0,
        status_counts: { candidate: 1, confirmed: 1 },
        insurance_type_counts: { medical: 1, care: 0, self: 0 },
        exclusion_reasons: [],
        generated_at: '2026-07-13T00:00:00.000Z',
      },
    } as const;
    expect(schema.parse(valid).data.exportable_count).toBe(1);
    expect(() => schema.parse({ ...valid, data: { ...valid.data, total_count: 3 } })).toThrow(
      'billing preview count mismatch',
    );
  });

  it('validates generation count partitions and rejects mixed-root success', () => {
    const schema = buildBillingCandidateGenerationResponseSchema('home_care');
    const valid = {
      data: {
        message: '請求候補を生成しました',
        billing_domain: 'home_care',
        generated: 2,
        home_care_generated: 2,
        pca_rental_generated: 0,
        confirmed: 1,
        review_required: 1,
        excluded: 0,
      },
    } as const;
    expect(schema.parse(valid).data.generated).toBe(2);
    expect(() => schema.parse({ ...valid, message: 'legacy root' })).toThrow();
    expect(() => schema.parse({ ...valid, data: { ...valid.data, generated: 3 } })).toThrow(
      'generation count mismatch',
    );
  });

  it('checks review identity, action outcome, and optimistic version advance', () => {
    const schema = buildBillingCandidateReviewResponseSchema({
      candidateId: 'candidate_1',
      action: 'confirm',
      previousUpdatedAt: '2026-07-13T00:00:00.000Z',
    });
    expect(
      schema.parse({
        data: {
          id: 'candidate_1',
          status: 'confirmed',
          updated_at: '2026-07-13T00:01:00.000Z',
          patient_name: 'removed',
        },
      }),
    ).toEqual({
      id: 'candidate_1',
      status: 'confirmed',
      updated_at: '2026-07-13T00:01:00.000Z',
    });
    expect(() =>
      schema.parse({
        data: {
          id: 'candidate_1',
          status: 'confirmed',
          updated_at: '2026-07-13T00:00:00.000Z',
        },
      }),
    ).toThrow('billing version did not advance');
  });

  it('validates close domain and strips claims-export metadata', () => {
    expect(
      buildBillingCloseResponseSchema('home_care').parse({
        data: {
          message: '月次締めしました',
          billing_domain: 'home_care',
          exported_count: 2,
          summary: { total: 2 },
          claims_export: { transmitted: true, recordCount: 2 },
        },
      }),
    ).toEqual({ message: '月次締めしました', billing_domain: 'home_care', exported_count: 2 });
  });
});
