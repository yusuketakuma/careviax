import { describe, expect, it } from 'vitest';
import { buildVisitMedicationStockObservationResponseSchema } from './medication-stock-observation-response-schema';

const observation = {
  client_observation_id: 'client_1',
  stock_item_id: 'stock_1',
  stock_event_id: 'event_1',
  observation_context_id: 'context_1',
  event_type: 'visit_observation',
  observation_kind: 'observed_absolute',
  quantity_kind: 'observed_absolute',
  snapshot: {
    current_quantity: 10,
    stock_risk_level: 'ok',
    calculated_at: '2026-06-20T01:00:00.000Z',
  },
  idempotent_replay: false,
};

describe('buildVisitMedicationStockObservationResponseSchema', () => {
  const schema = buildVisitMedicationStockObservationResponseSchema('visit_1');

  it('accepts a count-consistent observation result', () => {
    expect(
      schema.safeParse({
        data: { visit_record_id: 'visit_1', observations: [observation] },
        meta: { generated_at: '2026-06-20T01:00:00.000Z', applied_count: 1, replay_count: 0 },
      }).success,
    ).toBe(true);
  });

  it('rejects wrong visit, duplicate identity, and count drift', () => {
    const meta = { generated_at: '2026-06-20T01:00:00.000Z', applied_count: 1, replay_count: 0 };
    expect(
      schema.safeParse({ data: { visit_record_id: 'visit_2', observations: [observation] }, meta })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: { visit_record_id: 'visit_1', observations: [observation, observation] },
        meta,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: { visit_record_id: 'visit_1', observations: [observation] },
        meta: { ...meta, applied_count: 0 },
      }).success,
    ).toBe(false);
  });
});
