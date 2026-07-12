import { z } from 'zod';

const interventionTypeSchema = z.enum([
  'dose_adjustment',
  'drug_change',
  'side_effect_management',
  'adherence_support',
  'prescriber_consultation',
  'patient_education',
  'other',
]);

const offsetDateTime = z.string().datetime({ offset: true });
const boundedText = (max: number) => z.string().trim().min(1).max(max);

const interventionSchema = z
  .object({
    id: boundedText(200),
    patient_id: boundedText(200),
    issue_id: boundedText(200).nullable(),
    type: interventionTypeSchema,
    description: boundedText(10_000),
    outcome: z.string().max(10_000).nullable(),
    performed_by: boundedText(200),
    performed_at: offsetDateTime,
    created_at: offsetDateTime,
  })
  .transform((value) => value);

export function buildInterventionResponseSchema(args: { patientId: string; issueId?: string }) {
  return z
    .object({ data: interventionSchema })
    .strict()
    .superRefine(({ data }, context) => {
      if (data.patient_id !== args.patientId) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'patient_id'],
          message: 'Intervention belongs to another patient',
        });
      }
      if (data.issue_id !== (args.issueId ?? null)) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'issue_id'],
          message: 'Intervention belongs to another medication issue',
        });
      }
      if (data.created_at < data.performed_at) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'created_at'],
          message: 'Intervention creation predates performance',
        });
      }
    });
}

export function buildInterventionListResponseSchema(args: {
  patientId: string;
  issueId?: string;
  limit?: number;
}) {
  const limit = args.limit ?? 50;
  return z
    .object({
      data: z.array(interventionSchema).max(limit),
      meta: z
        .object({
          limit: z.literal(limit),
          has_more: z.literal(false),
          next_cursor: z.null(),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const identities = new Set<string>();
      let previous: { performedAt: string; id: string } | null = null;
      for (const [index, intervention] of data.entries()) {
        if (intervention.patient_id !== args.patientId) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'patient_id'],
            message: 'Intervention belongs to another patient',
          });
        }
        if (args.issueId && intervention.issue_id !== args.issueId) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'issue_id'],
            message: 'Intervention belongs to another medication issue',
          });
        }
        if (identities.has(intervention.id)) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'id'],
            message: 'Duplicate intervention identity',
          });
        }
        identities.add(intervention.id);
        if (intervention.created_at < intervention.performed_at) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'created_at'],
            message: 'Intervention creation predates performance',
          });
        }
        if (
          previous &&
          (intervention.performed_at > previous.performedAt ||
            (intervention.performed_at === previous.performedAt && intervention.id > previous.id))
        ) {
          context.addIssue({
            code: 'custom',
            path: ['data', index],
            message: 'Interventions are not newest first',
          });
        }
        previous = { performedAt: intervention.performed_at, id: intervention.id };
      }
    });
}
