import { describe, expect, it } from 'vitest';
import { cdsAlertsResponseSchema, medicationCycleForCdsResponseSchema } from './response-schemas';

describe('cdsAlertsResponseSchema', () => {
  it('projects every approved severity and preserves bounded details', () => {
    expect(
      cdsAlertsResponseSchema.parse({
        data: {
          alerts: [
            { type: 'interaction', severity: 'critical', message: '併用禁忌です' },
            {
              type: 'renal_dose',
              severity: 'warning',
              message: '  用量を確認してください  ',
              details: { egfr: 42 },
            },
            { type: 'monitoring', severity: 'info', message: '経過を確認してください' },
          ],
        },
      }),
    ).toEqual({
      alerts: [
        { type: 'interaction', severity: 'critical', message: '併用禁忌です' },
        {
          type: 'renal_dose',
          severity: 'warning',
          message: '用量を確認してください',
          details: { egfr: 42 },
        },
        { type: 'monitoring', severity: 'info', message: '経過を確認してください' },
      ],
    });
  });

  it.each([
    ['malformed alert', { data: { alerts: [{}] } }],
    [
      'unknown severity',
      { data: { alerts: [{ type: 'interaction', severity: 'notice', message: '確認' }] } },
    ],
    [
      'blank message',
      { data: { alerts: [{ type: 'interaction', severity: 'warning', message: '   ' }] } },
    ],
    ['legacy root', { alerts: [] }],
    ['mixed root', { data: { alerts: [] }, alerts: [] }],
  ])('rejects %s instead of projecting a false-safe empty state', (_label, payload) => {
    expect(() => cdsAlertsResponseSchema.parse(payload)).toThrow();
  });
});

describe('medicationCycleForCdsResponseSchema', () => {
  const meta = {
    limit: 1,
    has_more: false,
    next_cursor: null,
    total_count: 1,
  } as const;

  it('accepts a single bounded cycle id and a genuine empty result', () => {
    expect(
      medicationCycleForCdsResponseSchema.parse({
        data: [{ id: ' cycle_1 ' }],
        meta,
      }),
    ).toEqual([{ id: 'cycle_1' }]);
    expect(
      medicationCycleForCdsResponseSchema.parse({
        data: [],
        meta: { ...meta, total_count: 0 },
      }),
    ).toEqual([]);
  });

  it.each([
    ['malformed item', { data: [{}], meta }],
    [
      'more than the requested target',
      { data: [{ id: 'cycle_1' }, { id: 'cycle_2' }], meta: { ...meta, total_count: 2 } },
    ],
    ['blank id', { data: [{ id: '   ' }], meta }],
    ['legacy root', { cycles: [{ id: 'cycle_1' }], meta }],
    ['false empty page', { data: [], meta }],
    ['item with zero total', { data: [{ id: 'cycle_1' }], meta: { ...meta, total_count: 0 } }],
    ['missing overflow state', { data: [{ id: 'cycle_1' }], meta: { ...meta, total_count: 2 } }],
    [
      'inconsistent cursor',
      { data: [{ id: 'cycle_1' }], meta: { ...meta, has_more: true, next_cursor: null } },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(() => medicationCycleForCdsResponseSchema.parse(payload)).toThrow();
  });
});
