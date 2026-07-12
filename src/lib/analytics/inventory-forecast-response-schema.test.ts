import { describe, expect, it } from 'vitest';
import { inventoryForecastResponseSchema } from './inventory-forecast-response-schema';

function response() {
  return {
    data: {
      week: { start_date: '2026-06-22', end_date: '2026-06-28' },
      drugs: [
        {
          drugIdentityKey: 'master:drug_1',
          drugCode: 'YJ_1',
          drugKey: '確認薬',
          requiredQty: 7,
          stockQty: 3,
          unit: '錠',
          status: 'order_required',
          stockRegistered: true,
          stockEvidence: 'registered_stock',
        },
      ],
      patients: [],
      unresolvedDrugs: [],
    },
  };
}

describe('inventoryForecastResponseSchema', () => {
  it('accepts the provider forecast envelope', () => {
    expect(inventoryForecastResponseSchema.safeParse(response()).success).toBe(true);
  });

  it.each([
    ['legacy root', () => response().data],
    [
      'reversed week',
      () => {
        const payload = response();
        payload.data.week.start_date = '2026-06-29';
        return payload;
      },
    ],
    [
      'duplicate drug identity',
      () => {
        const payload = response();
        payload.data.drugs.push({ ...payload.data.drugs[0] });
        return payload;
      },
    ],
    [
      'contradictory stock evidence',
      () => {
        const payload = response();
        payload.data.drugs[0].stockRegistered = false;
        return payload;
      },
    ],
  ])('rejects %s forecast payloads', (_label, buildPayload) => {
    expect(inventoryForecastResponseSchema.safeParse(buildPayload()).success).toBe(false);
  });
});
