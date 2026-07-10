import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  visitScheduleProposalGenerationResponseSchema,
  visitScheduleProposalPaletteResponseSchema,
} from './visit-schedule-proposals';

const alert = {
  type: 'pharmacist_weekly_capacity',
  severity: 'warning' as const,
  message: '担当件数を確認してください',
  details: {},
  as_of: '2026-07-10T00:00:00.000Z',
};

describe('visit-schedule-proposal response schemas', () => {
  it('parses an exact generation envelope into the existing client result model', () => {
    const schema = visitScheduleProposalGenerationResponseSchema();

    expect(
      schema.parse({
        data: [{ id: 'proposal_1', proposal_status: 'proposed' }],
        meta: {
          alerts: [alert],
          diagnostics: { accepted: [], rejected: [] },
          replayed: false,
        },
      }),
    ).toEqual({
      data: [{ id: 'proposal_1', proposal_status: 'proposed' }],
      alerts: [alert],
      diagnostics: { accepted: [], rejected: [] },
      replayed: false,
    });
  });

  it('rejects generation responses with legacy or extra root metadata', () => {
    const schema = visitScheduleProposalGenerationResponseSchema();

    expect(
      schema.safeParse({ data: [{ id: 'proposal_1' }], alerts: [], replayed: false }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: [{ id: 'proposal_1' }],
        meta: { alerts: [], replayed: false },
        request_id: 'request_1',
      }).success,
    ).toBe(false);
  });

  it('rejects malformed generation metadata instead of returning a false success', () => {
    const schema = visitScheduleProposalGenerationResponseSchema();

    expect(
      schema.safeParse({
        data: [{ id: 'proposal_1' }],
        meta: { alerts: [{ ...alert, severity: 'unknown' }], replayed: false },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        data: [{ id: 'proposal_1' }],
        meta: { alerts: [], diagnostics: { accepted: [] }, replayed: false },
      }).success,
    ).toBe(false);
  });

  it('accepts exact palette metadata and rejects the legacy root hasMore field', () => {
    const schema = visitScheduleProposalPaletteResponseSchema(
      z.array(z.object({ id: z.string() })),
    );

    expect(
      schema.safeParse({
        data: [{ id: 'proposal_1' }],
        meta: { has_more: true },
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ data: [{ id: 'proposal_1' }], hasMore: true }).success).toBe(false);
  });
});
