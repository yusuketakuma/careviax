import { describe, expect, it } from 'vitest';
import { buildPatientMedicationStockSummaryResponseSchema } from './summary-response-schema';

const item = {
  id: 'stock_1',
  display_id: 'STK-1',
  patient_id: 'patient_1',
  case_id: null,
  display_name: '薬剤A',
  normalized_name: null,
  ingredient_name: null,
  strength: null,
  dosage_form: null,
  route: null,
  unit: '錠',
  source_type: 'manual',
  medication_category: 'other',
  managing_party: 'patient',
  equivalence_review_status: 'not_required',
  equivalence_confidence: null,
  active: true,
  snapshot_status: 'missing',
  snapshot: null,
};

const response = {
  data: {
    patient_id: 'patient_1',
    summary: {
      total_item_count: 1,
      visible_item_count: 1,
      active_item_count: 1,
      urgent_count: 0,
      shortage_expected_count: 0,
      watch_count: 0,
      unknown_risk_count: 1,
      usage_unknown_count: 0,
      equivalence_review_count: 0,
      pending_external_observation_count: 0,
      last_observed_at: null,
    },
    items: [item],
    recent_events: [],
  },
  meta: {
    generated_at: '2026-07-07T00:00:00.000Z',
    item_limit: 20,
    event_limit: 0,
    visible_count: 1,
    hidden_count: 0,
    count_basis: 'limited_items',
    partial_failures: [],
  },
};

describe('buildPatientMedicationStockSummaryResponseSchema', () => {
  const schema = buildPatientMedicationStockSummaryResponseSchema({
    patientId: 'patient_1',
    itemLimit: 20,
    eventLimit: 0,
  });

  it('accepts a count-consistent patient stock summary', () => {
    expect(schema.safeParse(response).success).toBe(true);
  });

  it('rejects wrong-patient items, aggregate drift, and hidden event references', () => {
    expect(
      schema.safeParse({ ...response, data: { ...response.data, patient_id: 'patient_2' } })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...response,
        data: { ...response.data, summary: { ...response.data.summary, unknown_risk_count: 0 } },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...response,
        data: {
          ...response.data,
          recent_events: [
            {
              id: 'event_1',
              stock_item_id: 'hidden',
              event_type: 'observation',
              event_at: '2026-07-07T00:00:00.000Z',
              recorded_at: '2026-07-07T00:00:00.000Z',
              quantity_kind: 'observed_absolute',
              quantity_delta: null,
              observed_quantity: 1,
              usage_quantity: null,
              usage_period_days: null,
              unit: '錠',
              source_entity_type: 'visit_record',
              has_source_entity: true,
            },
          ],
        },
        meta: { ...response.meta, event_limit: 1 },
      }).success,
    ).toBe(false);
  });
});
