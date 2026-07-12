import { z } from 'zod';
import { PATIENT_FIELD_REVISION_CATEGORIES } from '@/lib/patient/field-revision-categories';

const rawValueAllowedFieldKeys = new Set([
  'care_level',
  'adl_level',
  'dementia_level',
  'swallowing_route',
  'infection_isolation',
  'billing_support_flag',
  'gender',
]);
const maskedPresenceSchema = z.union([z.null(), z.literal('〔記録あり〕')]);
const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

export const patientFieldRevisionPresentationItemSchema = z
  .object({
    id: nonEmptyText(255),
    category: z.enum(PATIENT_FIELD_REVISION_CATEGORIES),
    field_key: nonEmptyText(255),
    field_label: z.string().max(500).nullable(),
    value_label: z.string().max(2_000).nullable(),
    previous: z.json().nullable(),
    current: z.json().nullable(),
    source: nonEmptyText(200),
    updated_by_name: z.string().trim().min(1).max(500).nullable(),
    created_at: z.string().datetime({ offset: true }),
  })
  .strip()
  .superRefine((item, context) => {
    if (rawValueAllowedFieldKeys.has(item.field_key)) return;

    if (item.value_label !== null) {
      context.addIssue({
        code: 'custom',
        path: ['value_label'],
        message: 'Sensitive revision labels must be omitted',
      });
    }
    for (const key of ['previous', 'current'] as const) {
      if (!maskedPresenceSchema.safeParse(item[key]).success) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Sensitive revision values must be presence-only',
        });
      }
    }
  });

export function createPatientFieldRevisionTimelineResponseSchema(expectedCategory: string | null) {
  return z
    .object({
      data: z.array(patientFieldRevisionPresentationItemSchema).max(50),
      meta: z
        .object({
          total_count: z.number().finite().int().nonnegative(),
          visible_count: z.number().finite().int().nonnegative().max(50),
          hidden_count: z.number().finite().int().nonnegative(),
          truncated: z.boolean(),
          count_basis: z.literal('patient_field_revisions'),
          filters_applied: z
            .object({
              category: z.enum(PATIENT_FIELD_REVISION_CATEGORIES).nullable(),
            })
            .strict(),
          sort_basis: z.literal('created_at_desc'),
          limit: z.literal(50),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data, meta }, context) => {
      if (meta.filters_applied.category !== expectedCategory) {
        context.addIssue({
          code: 'custom',
          path: ['meta', 'filters_applied', 'category'],
          message: 'Revision filter metadata does not match the request',
        });
      }
      if (
        meta.visible_count !== data.length ||
        meta.total_count !== meta.visible_count + meta.hidden_count ||
        meta.truncated !== meta.hidden_count > 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['meta'],
          message: 'Revision pagination metadata is inconsistent',
        });
      }

      const identities = new Set<string>();
      for (const [index, item] of data.entries()) {
        if (identities.has(item.id)) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'id'],
            message: 'Duplicate patient field revision identity',
          });
        }
        identities.add(item.id);

        if (index > 0 && Date.parse(item.created_at) > Date.parse(data[index - 1]!.created_at)) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'created_at'],
            message: 'Patient field revisions must be newest first',
          });
        }
      }
    });
}

export type PatientFieldRevisionTimelineItem = z.infer<
  typeof patientFieldRevisionPresentationItemSchema
>;
