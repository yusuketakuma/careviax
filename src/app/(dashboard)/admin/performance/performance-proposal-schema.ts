import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1).max(1000);

const performanceProposalSchema = z
  .object({
    id: nonEmptyText,
    proposed_date: z.string().datetime({ offset: true }),
    priority: z.enum(['normal', 'urgent', 'emergency']),
    proposal_status: z.enum([
      'proposed',
      'patient_contact_pending',
      'confirmed',
      'rejected',
      'superseded',
      'expired',
      'reschedule_pending',
    ]),
    patient_contact_status: z.enum([
      'pending',
      'attempted',
      'confirmed',
      'declined',
      'change_requested',
      'unreachable',
    ]),
    assignment_mode: z.enum(['primary', 'fallback']),
    route_distance_score: z.number().finite().nonnegative().nullable(),
    proposal_reason: z.string().max(2000),
    visit_deadline_date: z.string().datetime({ offset: true }).nullable(),
    case_: z.object({ patient: z.object({ name: nonEmptyText }).strip() }).strip(),
  })
  .strip();

export const performanceProposalsResponseSchema = z
  .object({ data: z.array(performanceProposalSchema) })
  .strict()
  .superRefine(({ data }, context) => {
    const ids = new Set<string>();
    for (const [index, proposal] of data.entries()) {
      if (ids.has(proposal.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Performance proposal identities must be unique',
        });
      }
      ids.add(proposal.id);
    }
  });

export type PerformanceProposalsResponse = z.infer<typeof performanceProposalsResponseSchema>;
