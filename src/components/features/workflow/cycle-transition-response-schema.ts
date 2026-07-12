import { z } from 'zod';
import { MEDICATION_CYCLE_STATUSES } from '@/lib/prescription/intake-filters';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

const transitionLogSchema = z
  .object({
    id: nonEmptyText(255),
    from_status: z.enum(MEDICATION_CYCLE_STATUSES),
    to_status: z.enum(MEDICATION_CYCLE_STATUSES),
    actor_name: nonEmptyText(500),
    note: z.string().max(5_000).nullable(),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const cycleTransitionHistoryResponseSchema = z
  .object({
    data: z.array(transitionLogSchema).max(500),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const identities = new Set<string>();
    for (const [index, log] of data.entries()) {
      if (identities.has(log.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate transition-log identity',
        });
      }
      identities.add(log.id);

      if (index > 0 && Date.parse(log.created_at) < Date.parse(data[index - 1]!.created_at)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'created_at'],
          message: 'Transition history must be oldest first',
        });
      }
    }
  })
  .transform((payload) => payload.data);

export type TransitionLog = z.infer<typeof transitionLogSchema>;
