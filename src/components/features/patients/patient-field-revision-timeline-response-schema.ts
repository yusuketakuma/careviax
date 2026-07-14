import { z } from 'zod';
import { PATIENT_FIELD_REVISION_CATEGORIES } from '@/lib/patient/field-revision-categories';

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

const MAX_REVISION_VALUE_DEPTH = 4;
const MAX_REVISION_VALUE_ITEMS = 100;
const MAX_REVISION_VALUE_KEYS = 50;
const MAX_REVISION_VALUE_STRING_LENGTH = 5_000;
const MAX_REVISION_VALUE_SERIALIZED_LENGTH = 20_000;
// The server-generated scalar label is `${old} → ${new}`. Keep the label bound
// aligned with two maximum-length scalar values plus the three-character separator.
const MAX_REVISION_VALUE_LABEL_LENGTH = MAX_REVISION_VALUE_STRING_LENGTH * 2 + 3;

function isRevisionValueWithinDisplayBounds(value: unknown, depth = 0): boolean {
  if (depth > MAX_REVISION_VALUE_DEPTH) return false;
  if (typeof value === 'string') return value.length <= MAX_REVISION_VALUE_STRING_LENGTH;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) {
    return (
      value.length <= MAX_REVISION_VALUE_ITEMS &&
      value.every((item) => isRevisionValueWithinDisplayBounds(item, depth + 1))
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return (
      entries.length <= MAX_REVISION_VALUE_KEYS &&
      entries.every(
        ([key, item]) => key.length <= 200 && isRevisionValueWithinDisplayBounds(item, depth + 1),
      )
    );
  }
  return false;
}

const revisionValueSchema = z.json().superRefine((value, context) => {
  if (
    !isRevisionValueWithinDisplayBounds(value) ||
    JSON.stringify(value).length > MAX_REVISION_VALUE_SERIALIZED_LENGTH
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Revision value exceeds safe display bounds',
    });
  }
});

export const patientFieldRevisionPresentationItemSchema = z
  .object({
    id: nonEmptyText(255),
    category: z.enum(PATIENT_FIELD_REVISION_CATEGORIES),
    field_key: nonEmptyText(255),
    field_label: z.string().max(500).nullable(),
    value_label: z.string().max(MAX_REVISION_VALUE_LABEL_LENGTH).nullable(),
    previous: revisionValueSchema,
    current: revisionValueSchema,
    source: nonEmptyText(200),
    source_visit_record_id: nonEmptyText(255).nullable(),
    change_reason: z.string().max(5_000).nullable(),
    importance: z.enum(['normal', 'caution', 'urgent']),
    confirmed_by_name: z.string().trim().min(1).max(500).nullable(),
    confirmed_at: z.string().datetime({ offset: true }).nullable(),
    valid_from: z.string().datetime({ offset: true }),
    valid_to: z.string().datetime({ offset: true }).nullable(),
    is_current: z.boolean(),
    updated_by_name: z.string().trim().min(1).max(500).nullable(),
    created_at: z.string().datetime({ offset: true }),
  })
  .strip()
  .superRefine((item, context) => {
    if (item.is_current !== (item.valid_to === null)) {
      context.addIssue({
        code: 'custom',
        path: ['valid_to'],
        message: 'Revision validity does not match current state',
      });
    }
    if (item.valid_to && Date.parse(item.valid_to) < Date.parse(item.valid_from)) {
      context.addIssue({
        code: 'custom',
        path: ['valid_to'],
        message: 'Revision validity ends before it starts',
      });
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
          selection_basis: z.literal('latest_created_at_desc_id_desc'),
          presentation_order: z.literal('created_at_asc_id_asc'),
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

        if (index > 0) {
          const previousItem = data[index - 1]!;
          const previousTime = Date.parse(previousItem.created_at);
          const currentTime = Date.parse(item.created_at);
          if (
            currentTime < previousTime ||
            (currentTime === previousTime && item.id.localeCompare(previousItem.id) < 0)
          ) {
            context.addIssue({
              code: 'custom',
              path: ['data', index, currentTime === previousTime ? 'id' : 'created_at'],
              message: 'Patient field revisions must be oldest first with a stable identity order',
            });
          }
        }
      }
    });
}

export type PatientFieldRevisionTimelineItem = z.infer<
  typeof patientFieldRevisionPresentationItemSchema
>;
