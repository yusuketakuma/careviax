import { describe, expect, it, vi } from 'vitest';

import {
  buildVisitMedicationStockObservationRequest,
  submitVisitMedicationStockObservations,
  validateVisitMedicationStockObservationDrafts,
} from './medication-stock-observation';
import type { VisitMedicationStockObservationDraft } from '@/types/medication-stock';

function makeDraft(
  overrides: Partial<VisitMedicationStockObservationDraft> = {},
): VisitMedicationStockObservationDraft {
  return {
    client_observation_id: 'visit-stock-observation-1',
    stock_item_id: 'stock_1',
    unit: '枚',
    kind: 'observed_absolute',
    quantity_input: '4',
    used_quantity_input: '',
    usage_quantity_input: '',
    usage_period_days_input: '',
    last_used_date: '2026-07-09',
    unobserved_reason_code: '',
    source_preset: 'pharmacist_counted',
    ...overrides,
  };
}

describe('visit medication stock observation request builder', () => {
  const observedAt = new Date('2026-07-10T01:30:00.000Z');

  it('maps a pharmacist-counted absolute observation to the strict API payload', () => {
    const result = buildVisitMedicationStockObservationRequest([makeDraft()], observedAt);

    expect(result).toEqual({
      ok: true,
      data: {
        observed_at: '2026-07-10T01:30:00.000Z',
        observations: [
          {
            client_observation_id: 'visit-stock-observation-1',
            stock_item_id: 'stock_1',
            kind: 'observed_absolute',
            unit: '枚',
            quantity: 4,
            last_used_at: '2026-07-09T00:00:00+09:00',
            last_used_precision: 'date_only',
            source_confidence: 'structured_exact',
            source_context_code: 'pharmacist_direct_observation',
            confirmation_level: 'counted_by_pharmacist',
          },
        ],
      },
    });
  });

  it('keeps usage delta and usage frequency payloads semantically distinct', () => {
    const result = buildVisitMedicationStockObservationRequest(
      [
        makeDraft({
          stock_item_id: 'stock_delta',
          client_observation_id: 'obs-delta',
          kind: 'usage_delta',
          quantity_input: '',
          used_quantity_input: '2',
          last_used_date: '',
          source_preset: 'patient_reported',
        }),
        makeDraft({
          stock_item_id: 'stock_frequency',
          client_observation_id: 'obs-frequency',
          kind: 'usage_frequency',
          quantity_input: '',
          usage_quantity_input: '1.5',
          usage_period_days_input: '3',
          last_used_date: '',
          source_preset: 'caregiver_reported',
        }),
      ],
      observedAt,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        observations: [
          {
            stock_item_id: 'stock_delta',
            kind: 'usage_delta',
            used_quantity: 2,
            source_context_code: 'patient_report',
            confirmation_level: 'patient_reported',
          },
          {
            stock_item_id: 'stock_frequency',
            kind: 'usage_frequency',
            usage_quantity: 1.5,
            usage_period_days: 3,
            source_context_code: 'caregiver_report',
            confirmation_level: 'caregiver_reported',
          },
        ],
      },
    });
    if (result.ok) {
      expect(result.data.observations[0]).not.toHaveProperty('quantity');
      expect(result.data.observations[1]).not.toHaveProperty('used_quantity');
    }
  });

  it('requires a controlled source and the fields for each observation kind', () => {
    const errors = validateVisitMedicationStockObservationDrafts(
      [
        makeDraft({ quantity_input: '', source_preset: '' }),
        makeDraft({
          stock_item_id: 'stock_not_observed',
          client_observation_id: 'obs-not-observed',
          kind: 'not_observed',
          quantity_input: '',
          unobserved_reason_code: '',
        }),
      ],
      observedAt,
    );

    expect(errors['visit-stock-observation-1']).toMatchObject({
      quantity_input: '今回残数は0以上の数値で入力してください。',
      source_preset: '確認元を選択してください。',
    });
    expect(errors['obs-not-observed']).toMatchObject({
      unobserved_reason_code: '未確認理由を選択してください。',
    });
  });

  it('rejects future last-use dates on the Japan business date basis', () => {
    const result = buildVisitMedicationStockObservationRequest(
      [makeDraft({ last_used_date: '2026-07-11' })],
      observedAt,
    );

    expect(result).toEqual({
      ok: false,
      errors: {
        'visit-stock-observation-1': {
          last_used_date: '未来の最終使用日は入力できません。',
        },
      },
    });
  });

  it('rejects duplicate client observation ids before sending', () => {
    const errors = validateVisitMedicationStockObservationDrafts(
      [makeDraft(), makeDraft({ stock_item_id: 'stock_2' })],
      observedAt,
    );

    expect(errors['visit-stock-observation-1']?.client_observation_id).toBe(
      '同じ観測IDが重複しています。入力をやり直してください。',
    );
  });

  it('posts with the visit path helper and request-level idempotency key', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { visit_record_id: 'record_1', observations: [] },
          meta: { generated_at: observedAt.toISOString(), applied_count: 0, replay_count: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const request = buildVisitMedicationStockObservationRequest([makeDraft()], observedAt);
    if (!request.ok) throw new Error('expected a valid request');

    const result = await submitVisitMedicationStockObservations({
      visitRecordId: 'record/1',
      orgId: 'org_1',
      idempotencyKey: 'visit-stock-request-1',
      request: request.data,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/visit-records/record%2F1/medication-stock-observations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-org-id': 'org_1',
          'Idempotency-Key': 'visit-stock-request-1',
        }),
      }),
    );
  });

  it.each([
    [409, 'conflict'],
    [503, 'unavailable'],
    [500, 'error'],
  ] as const)('maps HTTP %i to persistent submission state %s', async (status, expectedStatus) => {
    const result = await submitVisitMedicationStockObservations({
      visitRecordId: 'record_1',
      orgId: 'org_1',
      idempotencyKey: 'visit-stock-request-1',
      request: { observed_at: observedAt.toISOString(), observations: [] },
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: '入力内容を保持しています' }), { status }),
        ),
    });

    expect(result).toEqual({
      ok: false,
      status: expectedStatus,
      message: '入力内容を保持しています',
    });
  });
});
