import { z } from 'zod';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const observationKindSchema = z.enum([
  'observed_absolute',
  'usage_delta',
  'usage_frequency',
  'not_observed',
  'refill_request',
]);

export function buildVisitMedicationStockObservationResponseSchema(expectedVisitRecordId: string) {
  return z
    .object({
      data: z
        .object({
          visit_record_id: z.literal(expectedVisitRecordId),
          observations: z
            .array(
              z
                .object({
                  client_observation_id: nonEmptyText(128),
                  stock_item_id: nonEmptyText(200),
                  stock_event_id: nonEmptyText(200),
                  observation_context_id: nonEmptyText(200),
                  event_type: z.literal('visit_observation'),
                  observation_kind: observationKindSchema,
                  quantity_kind: z.enum([
                    'delta',
                    'observed_absolute',
                    'usage_rate',
                    'no_quantity',
                  ]),
                  snapshot: z
                    .object({
                      current_quantity: z.number().finite().nonnegative().nullable(),
                      stock_risk_level: z.enum([
                        'ok',
                        'watch',
                        'shortage_expected',
                        'urgent',
                        'unknown',
                      ]),
                      calculated_at: z.string().datetime({ offset: true }),
                    })
                    .strict(),
                  idempotent_replay: z.boolean(),
                })
                .strict(),
            )
            .min(1)
            .max(50),
        })
        .strict(),
      meta: z
        .object({
          generated_at: z.string().datetime({ offset: true }),
          applied_count: z.number().int().nonnegative(),
          replay_count: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      if (meta.applied_count + meta.replay_count !== data.observations.length) {
        context.addIssue({
          code: 'custom',
          path: ['meta'],
          message: 'Observation application counts do not match returned observations',
        });
      }
      const clientIds = new Set<string>();
      const eventIds = new Set<string>();
      const contextIds = new Set<string>();
      let replayCount = 0;
      for (const [index, observation] of data.observations.entries()) {
        if (clientIds.has(observation.client_observation_id)) {
          context.addIssue({
            code: 'custom',
            path: ['data', 'observations', index, 'client_observation_id'],
            message: 'Duplicate client observation identity',
          });
        }
        if (eventIds.has(observation.stock_event_id)) {
          context.addIssue({
            code: 'custom',
            path: ['data', 'observations', index, 'stock_event_id'],
            message: 'Duplicate stock event identity',
          });
        }
        if (contextIds.has(observation.observation_context_id)) {
          context.addIssue({
            code: 'custom',
            path: ['data', 'observations', index, 'observation_context_id'],
            message: 'Duplicate observation context identity',
          });
        }
        clientIds.add(observation.client_observation_id);
        eventIds.add(observation.stock_event_id);
        contextIds.add(observation.observation_context_id);
        if (observation.idempotent_replay) replayCount += 1;
      }
      if (replayCount !== meta.replay_count) {
        context.addIssue({
          code: 'custom',
          path: ['meta', 'replay_count'],
          message: 'Replay count does not match observation flags',
        });
      }
    });
}
